// The Submitted e-mail is the team's choice: a move never sends it, "send" sends it once, "don't inform" sends nothing. DB-free: every model is stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");

const calls = { emails: [], saves: 0 };
const state = { caseDoc: null, already: null, client: null, emailResult: { sent: true } };

const stub = (path, exports) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };

stub("../../../models/Case", { findById: async () => state.caseDoc, updateOne: async () => ({}) });
stub("../../../models/User", { findById: () => ({ select: () => ({ lean: async () => state.client }) }) });
stub("../../../models/EmailLog", { findOne: () => ({ select: () => ({ lean: async () => state.already }) }) });
stub("../../../modules/email/email.service", { sendTemplateEmail: async (template, payload) => { calls.emails.push({ template, payload }); return state.emailResult; } });
stub("../../../modules/cases/case.service", { addTimelineEvent: (doc, type, title) => { doc.timeline.push({ type, title }); } });

const { sendOnTeamChoice, notifySubmitted } = require("../ghlSubmittedNotice");

const makeCase = (overrides = {}) => ({
  _id: "c1", caseNumber: "B1", clientName: "Asha", caseRole: "single", user: "u1", timeline: [],
  integrations: { ghl: { unifiedStageKey: "submitted_fedex" } },
  save: async () => { calls.saves += 1; },
  ...overrides,
});

test.beforeEach(() => {
  calls.emails.length = 0; calls.saves = 0;
  state.caseDoc = makeCase(); state.already = null; state.emailResult = { sent: true };
  state.client = { _id: "u1", name: "Asha", email: "asha@example.com", role: "client", isActive: true };
});

test("a move into Submitted sends nothing by itself", async () => {
  notifySubmitted({ caseDoc: makeCase(), previousKey: "draft_ready" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.emails.length, 0);
});

test("send: the client gets the e-mail once", async () => {
  const result = await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } });
  assert.equal(result.sent, true);
  assert.equal(calls.emails.length, 1);
  assert.equal(calls.emails[0].template, "case-submitted-client");
  assert.equal(calls.emails[0].payload.to, "asha@example.com");
  // EmailLog.triggeredBy is an ObjectId field: it must carry the case manager's id, never a text label (that made the log write, and so the send, fail)
  assert.equal(calls.emails[0].payload.triggeredBy, "m1");
});

test("the e-mail log accepts what is sent: triggeredBy is a real user id", () => {
  const mongoose = require("mongoose");
  delete require.cache[require.resolve("../../../models/EmailLog")];
  const EmailLog = require("../../../models/EmailLog");
  const ok = new EmailLog({ templateKey: "case-submitted-client", to: "a@b.co", subject: "s", triggeredBy: new mongoose.Types.ObjectId() });
  assert.equal(ok.validateSync(), undefined);
  const bad = new EmailLog({ templateKey: "case-submitted-client", to: "a@b.co", subject: "s", triggeredBy: "team_chose_send_submitted_email" });
  assert.ok(bad.validateSync()?.errors?.triggeredBy, "a text label is rejected by the schema");
});

test("don't inform: nothing is sent, and the choice is recorded on the case", async () => {
  const result = await sendOnTeamChoice({ caseId: "c1", send: false, user: { _id: "m1" } });
  assert.equal(result.sent, false);
  assert.equal(calls.emails.length, 0);
  assert.equal(state.caseDoc.timeline[0].title, "Client not informed of submission");
});

test("an e-mail already sent for the case is not sent twice", async () => {
  state.already = { _id: "log1" };
  const result = await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } });
  assert.deepEqual([result.sent, result.reason], [false, "already_sent"]);
  assert.equal(calls.emails.length, 0);
});

test("a case no longer at Submitted sends nothing", async () => {
  state.caseDoc = makeCase({ integrations: { ghl: { unifiedStageKey: "draft_ready" } } });
  const result = await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } });
  assert.equal(result.reason, "not_at_submitted");
  assert.equal(calls.emails.length, 0);
});

test("an employer matter and a case with no client login send nothing", async () => {
  state.caseDoc = makeCase({ caseRole: "principal", caseStructure: "employer_employee" });
  assert.equal((await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } })).reason, "employer_matter");
  state.caseDoc = makeCase(); state.client = null;
  assert.equal((await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } })).reason, "no_client_login");
  assert.equal(calls.emails.length, 0);
});

test("a family case goes to the petitioner", async () => {
  state.caseDoc = makeCase({ petitionerUser: "p1", integrations: { ghl: { unifiedStageKey: "submitted_fedex", role: "family" } } });
  state.client = { _id: "p1", name: "Pat", email: "pat@example.com", role: "client", isActive: true };
  assert.equal((await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } })).sent, true);
  assert.equal(calls.emails[0].payload.to, "pat@example.com");
});

test("a failure never throws", async () => {
  state.caseDoc = null;
  assert.equal((await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } })).reason, "case_not_found");
});
