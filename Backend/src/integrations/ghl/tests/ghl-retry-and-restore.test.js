// GHL sync robustness (2026-11-13). DB-free: models and GHL calls are stubbed.
//   1. a change is never given up on: every error keeps retrying with a capped backoff; admins are told ONCE; a card that GHL says is gone is a deletion, not a retry;
//   2. a case restored from the recycle bin gets its card BACK in the same pipeline + stage, re-linked to the SAME case (no new case); a still-existing card is kept;
//   3. an employer's missing GHL contact is created again when an employee's card cannot be created.
const test = require("node:test");
const assert = require("node:assert/strict");

const rec = { jobUpdates: [], caseUpdates: [], linkOps: [], notifications: [], opportunityCreates: [], flagged: [], timeline: [], jobUpdateMany: [] };
const state = { caseDoc: null, goneIds: new Set(), existingCard: null, notifExists: false, needsAttentionAlreadySet: false, contactUpserts: 0, createFailures: [] };
const stub = (path, exports) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
const chain = (value) => ({ select: () => chain(value), lean: async () => value, then: (resolve) => resolve(value) });

stub("../../../models/Case", {
  findById: (id) => { const c = id === "pc1" ? { _id: "pc1", clientEmail: "employer@example.com", clientName: "Suruchi" } : state.caseDoc; const out = { ...c, save: async () => {} }; return Object.assign(Promise.resolve(out), chain(out)); },
  updateOne: async (filter, update) => {
    rec.caseUpdates.push({ filter, update });
    // the "needs attention" flag guard: modifies only the first time
    if (filter["integrations.ghl.flags.needsAttention"]?.$ne === true) return { modifiedCount: state.needsAttentionAlreadySet ? 0 : 1, matchedCount: 1 };
    return { modifiedCount: 1, matchedCount: 1 };
  },
});
stub("../../../models/GHLSyncJob", {
  updateOne: async (filter, update) => { rec.jobUpdates.push({ filter, update }); return {}; },
  updateMany: async (filter, update) => { rec.jobUpdateMany.push({ filter, update }); return {}; },
  exists: async () => false,
});
stub("../../../models/Notification", { exists: async () => state.notifExists });
stub("../../../models/GHLCaseLink", {
  deleteMany: async (filter) => { rec.linkOps.push({ op: "delete", filter }); return {}; },
  create: async (doc) => { rec.linkOps.push({ op: "create", doc }); return doc; },
});
stub("../../../models/GHLEmployerLink", { findOne: () => chain(state.employerLink || null), updateOne: async (f, u) => { rec.linkOps.push({ op: "employerLink", u }); return {}; } });
stub("../../../models/GHLIntegration", { findOne: async () => state.config });
stub("../../../models/User", { findById: () => chain(null) });
stub("../ghlDeletedInGhl", {
  opportunityIsGone: async (id) => state.goneIds.has(id),
  flagDeletedInGhl: async (caseId) => { rec.flagged.push(caseId); },
});
stub("../ghlOpportunityService", {
  getOpportunity: async (id) => { if (state.goneIds.has(id)) { const { GHLApiError } = require("../ghlClient"); throw new GHLApiError("gone", { status: 404 }); } return state.existingCard || { id }; },
  createOpportunity: async (body) => {
    rec.opportunityCreates.push(body);
    const failure = state.createFailures.shift();
    if (failure) throw failure;
    return { id: "NEWOPP", name: body.name, pipelineStageId: body.pipelineStageId, status: "open", contactId: body.contactId };
  },
  fetchAllOpportunities: async () => [],
});
stub("../ghlVisaService", { ensureEntries: async () => [] });
stub("../ghlCustomFieldService", { ensureFieldIds: async () => ({ service_type: "f1", marker: "fm" }), MARKER_FIELD: { name: "marker" } });
stub("../../../modules/cases/case.service", { addTimelineEvent: (doc, type, title) => { rec.timeline.push(title); } });
stub("../../../modules/notifications/notification.service", { createForRoles: async (...a) => { rec.notifications.push(a); } });
stub("../../../modules/realtime/realtime.gateway", { emitToRole: () => {}, emitToUser: () => {} });
stub("../ghlCaseOutbound", {
  isEnabled: () => true,
  contactDetails: async (c) => ({ email: c.clientEmail || "", name: c.clientName }),
  upsertContact: async () => { state.contactUpserts += 1; return "NEWCONTACT"; },
});
stub("../ghlAuxOutbound", {
  markerFor: (c) => `immiglance:${c.caseNumber}`,
  markerFromOpportunity: () => null,
  serviceTypeFor: () => ({ serviceType: "EB-1B", detailField: null }),
  queueJob: async () => null,
});

const { GHLApiError } = require("../ghlClient");
const outbound = require("../ghlOutboundService");
const restore = require("../ghlRestore");

const reset = () => {
  Object.keys(rec).forEach((k) => { rec[k].length = 0; });
  Object.assign(state, { goneIds: new Set(), existingCard: null, notifExists: false, needsAttentionAlreadySet: false, contactUpserts: 0, createFailures: [], employerLink: null });
  state.caseDoc = { _id: "c1", caseNumber: "B9", clientName: "Asha", caseRole: "single", visaType: "EB-1B", finance: { totalAmount: 0 }, integrations: { ghl: { opportunityId: "OLD", pipelineId: "P1", pipelineStageId: "S-submitted", unifiedStageKey: "submitted_fedex", displayName: "Asha Rao", contactId: "CT1", locationId: "LOC" } } };
  state.config = {
    mappingsConfirmedAt: new Date(),
    pipelines: [{ ghlPipelineId: "P1", ghlPipelineName: "Immigrant pipeline", category: "immigrant", enabled: true, stages: [{ key: "case_onboarded", order: 1 }, { key: "submitted_fedex", order: 5 }] }],
    stageMappings: [{ ghlPipelineId: "P1", unifiedStageKey: "case_onboarded", ghlStageId: "S-onboarded" }, { ghlPipelineId: "P1", unifiedStageKey: "submitted_fedex", ghlStageId: "S-submitted" }],
  };
};
test.beforeEach(reset);

const lastJobSet = () => rec.jobUpdates[rec.jobUpdates.length - 1].update.$set;

test("every error is retried, never terminal: a 400, a 500 and a network error all go back to pending with a capped backoff", async () => {
  for (const error of [new GHLApiError("bad request", { status: 400, retryable: false }), new GHLApiError("boom", { status: 500, retryable: true }), new Error("socket hang up")]) {
    rec.jobUpdates.length = 0;
    const result = await outbound.handleAuxFailure({ _id: "j1", caseId: "c1", type: "rename", attempts: 3 }, error);
    assert.equal(result.status, "retry");
    assert.equal(lastJobSet().status, "pending");
    assert.ok(lastJobSet().nextAttemptAt.getTime() > Date.now());
  }
  const capped = await outbound.handleAuxFailure({ _id: "j1", caseId: "c1", type: "create_opportunity", attempts: 500 }, new GHLApiError("nope", { status: 400 }));
  assert.equal(capped.status, "retry");
  assert.ok(lastJobSet().nextAttemptAt.getTime() - Date.now() <= 30 * 60 * 1000 + 1000, "never waits longer than 30 minutes");
});

test("a stage move that keeps failing: quiet for 8 tries, then flagged and admins told ONCE (not on every retry); the job never stops", async () => {
  const error = new GHLApiError("GHL is down", { status: 503, retryable: true });
  await outbound.handleSendFailure({ _id: "j1", caseId: "c1", type: "stage", opportunityId: "OLD", attempts: 3, caseSyncVersion: 1 }, error);
  assert.equal(rec.notifications.length, 0, "no alert during the quiet retries");
  await outbound.handleSendFailure({ _id: "j1", caseId: "c1", type: "stage", opportunityId: "OLD", attempts: 8, caseSyncVersion: 1 }, error);
  assert.equal(rec.notifications.length, 1, "alerted once when it needs attention");
  assert.equal(lastJobSet().status, "pending", "and it is still being retried");
  state.needsAttentionAlreadySet = true;
  await outbound.handleSendFailure({ _id: "j1", caseId: "c1", type: "stage", opportunityId: "OLD", attempts: 9, caseSyncVersion: 1 }, error);
  assert.equal(rec.notifications.length, 1, "no second alert for the same case");
});

test("a 404 on a card that GHL confirms is gone is a DELETION made in GHL (the case follows it to the recycle bin), not an endless failure; a 404 on a card that exists is retried", async () => {
  const notFound = new GHLApiError("not found", { status: 404, retryable: false });
  state.goneIds.add("OLD");
  const gone = await outbound.handleSendFailure({ _id: "j1", caseId: "c1", type: "stage", opportunityId: "OLD", attempts: 1, caseSyncVersion: 1 }, notFound);
  assert.equal(gone.status, "superseded");
  assert.deepEqual(rec.flagged, ["c1"]);
  assert.equal(lastJobSet().status, "superseded");
  reset();
  const exists = await outbound.handleSendFailure({ _id: "j2", caseId: "c1", type: "stage", opportunityId: "OLD", attempts: 1, caseSyncVersion: 1 }, notFound);
  assert.equal(exists.status, "retry");
  assert.deepEqual(rec.flagged, []);
});

test("restore: the card is recreated in the SAME pipeline and SAME stage, with the same name, and re-linked to the SAME case (old dead link replaced, no new case)", async () => {
  state.goneIds.add("OLD"); // the card was deleted in GHL
  const outcome = await restore.runRestoreOpportunity({ _id: "j1", caseId: "c1", attempts: 1 }, {});
  assert.equal(outcome, "done");
  assert.equal(rec.opportunityCreates.length, 1);
  const body = rec.opportunityCreates[0];
  assert.equal(body.pipelineId, "P1");
  assert.equal(body.pipelineStageId, "S-submitted", "back in the stage it was deleted from");
  assert.equal(body.name, "Asha Rao");
  assert.equal(body.contactId, "CT1");
  assert.equal(body.status, "open");
  const relink = rec.caseUpdates.find((u) => u.update.$set?.["integrations.ghl.opportunityId"] === "NEWOPP");
  assert.ok(relink, "the case now points at the new card");
  assert.equal(relink.update.$set["integrations.ghl.unifiedStageKey"], "submitted_fedex");
  assert.deepEqual(relink.filter["integrations.ghl.opportunityId"].$in, [null, "OLD", "NEWOPP"], "guarded by the old id: a concurrent change is never overwritten");
  assert.ok(rec.linkOps.some((o) => o.op === "delete" && o.filter.opportunityId === "OLD" && o.filter.caseId === "c1"), "the dead link is removed");
  assert.ok(rec.linkOps.some((o) => o.op === "create" && o.doc.opportunityId === "NEWOPP" && o.doc.caseId === "c1"), "one link to the same case");
  assert.ok(rec.timeline.includes("Restored to the pipeline"));
});

test("restore: if the stored stage no longer exists the card goes to the pipeline's first stage; if the old card is still in GHL it is KEPT and its pending delete cancelled", async () => {
  state.goneIds.add("OLD");
  state.caseDoc.integrations.ghl.unifiedStageKey = "a_removed_stage";
  state.caseDoc.integrations.ghl.pipelineStageId = "S-removed";
  await restore.runRestoreOpportunity({ _id: "j1", caseId: "c1", attempts: 1 }, {});
  assert.equal(rec.opportunityCreates[0].pipelineStageId, "S-onboarded");
  reset();
  state.existingCard = { id: "OLD", contactId: "CT1" };
  const kept = await restore.runRestoreOpportunity({ _id: "j2", caseId: "c1", attempts: 1 }, {});
  assert.equal(kept, "done");
  assert.equal(rec.opportunityCreates.length, 0, "no second card is created");
  assert.equal(rec.jobUpdateMany[0].filter.type, "delete_opportunity");
  assert.equal(rec.jobUpdateMany[0].update.$set.status, "superseded");
});

test("restore: an employee's card whose employer contact is gone in GHL gets the contact created again (the same self-heal that fixes failed card creation)", async () => {
  state.goneIds.add("OLD");
  state.caseDoc = { ...state.caseDoc, caseRole: "employee", parentCase: "pc1", clientEmail: "" };
  state.employerLink = { contactId: "DEADCONTACT" };
  state.createFailures = [new GHLApiError("404", { status: 404 })];
  const outcome = await restore.runRestoreOpportunity({ _id: "j1", caseId: "c1", attempts: 1 }, {});
  assert.equal(outcome, "done");
  assert.equal(state.contactUpserts, 1, "the employer contact was created again");
  assert.equal(rec.opportunityCreates.length, 2, "first try 404, second try with the new contact");
  assert.equal(rec.opportunityCreates[1].contactId, "NEWCONTACT");
  assert.ok(rec.linkOps.some((o) => o.op === "employerLink" && o.u.$set.contactId === "NEWCONTACT"), "the employer link points at the new contact");
});

test("pure helpers: pickMapping prefers the stored stage key, then the stored GHL stage id, then the first stage", () => {
  const pipeline = state.config.pipelines[0];
  assert.equal(restore.pickMapping(state.config, pipeline, { unifiedStageKey: "submitted_fedex" }).ghlStageId, "S-submitted");
  assert.equal(restore.pickMapping(state.config, pipeline, { unifiedStageKey: "zzz", pipelineStageId: "S-onboarded" }).ghlStageId, "S-onboarded");
  assert.equal(restore.pickMapping(state.config, pipeline, {}).ghlStageId, "S-onboarded");
  assert.equal(restore.pickPipeline(state.config, { pipelineId: "P1" }).ghlPipelineId, "P1");
  assert.equal(restore.pickPipeline(state.config, { pipelineId: "gone", category: "immigrant" }).ghlPipelineId, "P1");
});
