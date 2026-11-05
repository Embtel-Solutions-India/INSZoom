// The separate "Immiglance Pipeline" (leads only). DB-free: the Lead model and every GoHighLevel call are stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const env = require("../../../config/env");
const { GHLApiError } = require("../ghlClient");
const pipelineService = require("../ghlPipelineService");
const opportunityService = require("../ghlOpportunityService");
const lp = require("../ghlLeadPipeline");

const saved = {};
function configure(t, on = true) {
  Object.assign(saved, { enabled: env.ghl.enabled, token: env.ghl.token, locationId: env.ghl.locationId, leadPipelineId: env.ghl.leadPipelineId });
  Object.assign(env.ghl, on ? { enabled: true, token: "t", locationId: "loc", leadPipelineId: "pipe-1" } : { leadPipelineId: "" });
  lp._resetStageCache();
  t.after(() => Object.assign(env.ghl, saved));
}

// A tiny stand-in for the Lead model: findOneAndUpdate (the claim) returns the document, updateOne merges $set into it.
function fakeLead(doc) {
  const lead = { _id: "L1", isDraft: false, ...doc };
  const model = {
    updates: [],
    async findOneAndUpdate() { lead.ghl = { ...(lead.ghl || {}), status: "syncing" }; return lead; },
    async updateOne(_filter, update) {
      model.updates.push(update);
      for (const [path, value] of Object.entries(update.$set || {})) {
        const [, key] = path.split(".");
        lead.ghl = { ...(lead.ghl || {}), [key]: value };
      }
    },
  };
  return { lead, model };
}

const sampleLead = {
  fullName: "Asha Rao", email: "Asha@Example.com", phone: "+1 555 0100", leadNumber: "L-007", visaPathway: "H-1B", visaInterest: "H-1B", source: "quiz",
  message: "Need help", scoreResult: { tier: "A", routing: "attorney" },
  profileAnswers: { country: "India", education: { degree: "MS", years: 6 }, tags: ["stem", "it"] }, status: "new",
};

test("the card: name, contact columns, and a note holding everything else", () => {
  assert.equal(lp.opportunityName(sampleLead), "Asha Rao - H-1B (L-007)");
  assert.deepEqual(lp.contactFields(sampleLead), { email: "asha@example.com", name: "Asha Rao", phone: "+1 555 0100" });
  const note = lp.composeNote(sampleLead);
  for (const expected of ["Immiglance lead L-007", "Source: quiz", "Visa pathway: H-1B", "Message: Need help", "Quiz tier: A", "country: India", "education.degree: MS", "tags: stem, it"]) assert.ok(note.includes(expected), expected);
  assert.ok(!note.includes("Visa interest"), "interest equal to the pathway is not repeated");
  assert.ok(lp.composeNote({ ...sampleLead, message: "x".repeat(9000) }).length <= 6000, "the note is capped");
});

test("the first stage is the one with the lowest position", () => {
  assert.deepEqual(lp.firstStageOf({ stages: [{ id: "b", name: "Second", position: 1 }, { id: "a", name: "First", position: 0 }] }), { stageId: "a", name: "First" });
  assert.equal(lp.firstStageOf({ stages: [] }), null);
});

test("not configured: nothing is sent, nothing throws", async (t) => {
  configure(t, false);
  assert.equal(lp.isConfigured(), false);
  assert.deepEqual(await lp.pushLead("L1"), { skipped: "not_configured" });
  assert.equal(lp.leadCreated({ _id: "x" }), undefined);
  assert.equal(await lp.handleOpportunityEvent({ eventType: "OpportunityDelete" }, { id: "o1" }), null, "the case webhook logic is untouched");
});

test("a new lead becomes ONE contact, ONE card in the first stage, and one note; a retry makes no second one", async (t) => {
  configure(t);
  const { lead, model } = fakeLead(sampleLead);
  const posts = [];
  const client = { async post(path, body) { posts.push({ path, body }); return path === "/contacts/upsert" ? { contact: { id: "c1" } } : {}; } };
  t.mock.method(pipelineService, "listPipelines", async () => [{ id: "pipe-1", stages: [{ id: "s2", name: "Two", position: 1 }, { id: "s1", name: "One", position: 0 }] }]);
  const created = [];
  t.mock.method(opportunityService, "createOpportunity", async (body) => { created.push(body); return { id: "o1" }; });

  const result = await lp.pushLead("L1", { Lead: model, client });
  assert.equal(result.synced, true);
  assert.equal(created.length, 1);
  assert.deepEqual({ pipelineId: created[0].pipelineId, pipelineStageId: created[0].pipelineStageId, contactId: created[0].contactId, status: created[0].status }, { pipelineId: "pipe-1", pipelineStageId: "s1", contactId: "c1", status: "open" });
  assert.equal(posts.filter((p) => p.path === "/contacts/upsert").length, 1);
  const note = posts.find((p) => p.path === "/contacts/c1/notes");
  assert.ok(note && note.body.body.includes("L-007"));
  assert.equal(lead.ghl.status, "synced");

  // a retry after a partial failure resumes: ids already saved are reused
  const again = fakeLead({ ...sampleLead, ghl: { contactId: "c1", opportunityId: "o1", noteSent: true } });
  again.model.findOneAndUpdate = async () => again.lead;
  posts.length = 0; created.length = 0;
  await lp.pushLead("L1", { Lead: again.model, client });
  assert.equal(posts.length, 0);
  assert.equal(created.length, 0);
});

test("a failure is recorded, never thrown; a lead without e-mail or phone is skipped with the reason", async (t) => {
  configure(t);
  t.mock.method(pipelineService, "listPipelines", async () => [{ id: "pipe-1", stages: [{ id: "s1", name: "One", position: 0 }] }]);
  const down = fakeLead(sampleLead);
  const failing = { async post() { throw new GHLApiError("boom", { status: 503, retryable: true }); } };
  const r1 = await lp.pushLead("L1", { Lead: down.model, client: failing });
  assert.equal(r1.failed, true);
  assert.equal(down.lead.ghl.status, "failed");

  const empty = fakeLead({ ...sampleLead, email: "", phone: "" });
  const r2 = await lp.pushLead("L1", { Lead: empty.model, client: { async post() { return {}; } } });
  assert.equal(r2.permanent, true);
  assert.equal(empty.lead.ghl.status, "skipped");
  assert.match(empty.lead.ghl.error, /no e-mail or phone/);
});

test("webhook: events of the Immiglance pipeline never reach the case logic; other pipelines are left to it", async (t) => {
  configure(t);
  const none = { async findOne() { return { select() { return { lean: async () => null }; } }; } };
  none.findOne = () => ({ select: () => ({ lean: async () => null }) });
  const update = await lp.handleOpportunityEvent({ eventType: "OpportunityStageUpdate" }, { id: "o1", pipelineId: "pipe-1" }, { Lead: none });
  assert.equal(update.outcome, "ignored");
  assert.equal(await lp.handleOpportunityEvent({ eventType: "OpportunityUpdate" }, { id: "o2", pipelineId: "some-case-pipeline" }, { Lead: none }), null);
});

test("webhook: a card deleted in GoHighLevel deletes its lead (after confirming it is gone); a card that still exists keeps it", async (t) => {
  configure(t);
  const withLead = { findOne: () => ({ select: () => ({ lean: async () => ({ _id: "L1", ghl: { opportunityId: "o1" } }) }) }) };
  const removed = [];
  const gone = { async getOpportunity() { throw new GHLApiError("nf", { status: 404 }); } };
  const r = await lp.handleOpportunityEvent({ eventType: "OpportunityDelete" }, { id: "o1" }, { Lead: withLead, opportunities: gone, removeLead: async (id) => removed.push(id) });
  assert.equal(r.outcome, "processed");
  assert.deepEqual(removed, ["L1"]);

  const still = { async getOpportunity() { return { id: "o1" }; } };
  removed.length = 0;
  const r2 = await lp.handleOpportunityEvent({ eventType: "OpportunityDelete" }, { id: "o1" }, { Lead: withLead, opportunities: still, removeLead: async (id) => removed.push(id) });
  assert.equal(r2.outcome, "ignored");
  assert.equal(removed.length, 0);

  const flaky = { async getOpportunity() { throw new GHLApiError("busy", { status: 429, retryable: true }); } };
  const r3 = await lp.handleOpportunityEvent({ eventType: "OpportunityDelete" }, { id: "o1" }, { Lead: withLead, opportunities: flaky, removeLead: async (id) => removed.push(id) });
  assert.equal(r3.outcome, "failed", "could not confirm: retried by the webhook queue, never deleted on doubt");
  assert.equal(removed.length, 0);
});

test("reconcile: a missing card is flagged first and deleted only on the second sighting after the confirm window, with the same switch as cases", async (t) => {
  configure(t);
  t.after(() => { delete process.env.GHL_DELETE_CASES_REMOVED_IN_GHL; delete process.env.GHL_DELETE_CONFIRM_MS; });
  process.env.GHL_DELETE_CONFIRM_MS = "0";
  const rows = [{ _id: "L1", ghl: { opportunityId: "o1" } }];
  const updates = [];
  const Lead = { find: () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => rows }) }) }) }), async updateOne(filter, update) { updates.push(update); } };
  const gone = { async getOpportunity() { throw new GHLApiError("nf", { status: 404 }); } };
  const removed = [];
  const deps = { Lead, opportunities: gone, removeLead: async (id) => removed.push(id), noPause: true };

  assert.deepEqual(await lp.reconcileDeleted(deps), { checked: 1, flagged: 1, deleted: 0 });
  rows[0].ghl.missingSince = new Date(Date.now() - 1000);
  process.env.GHL_DELETE_CASES_REMOVED_IN_GHL = "false";
  assert.equal((await lp.reconcileDeleted(deps)).deleted, 0, "flag only unless the case switch is on");
  process.env.GHL_DELETE_CASES_REMOVED_IN_GHL = "true";
  assert.equal((await lp.reconcileDeleted(deps)).deleted, 1);
  assert.deepEqual(removed, ["L1"]);
});

test("deleting a lead removes its card first; a lead with no card needs no GoHighLevel call; a failure keeps the lead", async (t) => {
  configure(t);
  const calls = [];
  t.mock.method(opportunityService, "deleteOpportunity", async (id) => { calls.push(id); });
  assert.deepEqual(await lp.deleteCardFor({ ghl: { opportunityId: "o9" } }), { deleted: true });
  assert.deepEqual(calls, ["o9"]);
  assert.deepEqual(await lp.deleteCardFor({}), { skipped: true });
  t.mock.method(opportunityService, "deleteOpportunity", async () => { throw new GHLApiError("down", { status: 503, retryable: true }); });
  await assert.rejects(() => lp.deleteCardFor({ ghl: { opportunityId: "o9" } }));
});

test("the lead pipeline is NOT one of the two case pipelines (the case pipeline selection ignores it)", () => {
  const picked = pipelineService.selectPipelines(
    [{ id: "im", name: "Immigrant Documentation pipeline", stages: [] }, { id: "nim", name: "Non-Immigrant Documentation pipeline", stages: [] }, { id: "pipe-1", name: "Immiglance Pipeline", stages: [] }],
    { immigrantPipelineId: "", nonImmigrantPipelineId: "", immigrantPipelineName: "Immigrant Documentation pipeline", nonImmigrantPipelineName: "Non-Immigrant Documentation pipeline" }
  );
  assert.deepEqual(picked.selected.map((s) => s.pipeline.id), ["im", "nim"]);
  assert.deepEqual(picked.errors, []);
});
