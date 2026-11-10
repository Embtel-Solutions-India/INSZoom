// The FedEx number in the client's e-mails. DB-free: every model and the mail service are stubbed.
//   - inside the "case submitted" e-mail when the number is on file (the section is left out when it is not);
//   - its own e-mail only when the number is added AFTER the submitted e-mail went out.
const test = require("node:test");
const assert = require("node:assert/strict");

const calls = { emails: [] };
const state = { caseDoc: null, submittedLog: null, numberLog: null, client: null };
const stub = (path, exports) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };

stub("../../../models/Case", { findById: async () => state.caseDoc, updateOne: async () => ({}) });
stub("../../../models/User", { findById: () => ({ select: () => ({ lean: async () => state.client }) }) });
stub("../../../models/EmailLog", {
  findOne: (query) => ({ select: () => ({ lean: async () => (query.templateKey === "case-fedex-number-client" ? state.numberLog : state.submittedLog) }) }),
});
stub("../../../modules/email/email.service", { sendTemplateEmail: async (template, payload) => { calls.emails.push({ template, payload }); return { sent: true }; } });
stub("../../../modules/cases/case.service", { addTimelineEvent: () => {} });

const { sendOnTeamChoice, sendFedexNumberNotice } = require("../ghlSubmittedNotice");
const submitted = require("../../../modules/email/templates/case-submitted-client");
const fedex = require("../../../modules/email/templates/case-fedex-number-client");

const makeCase = (number) => ({
  _id: "c1", caseNumber: "B1", clientName: "Asha", caseRole: "single", user: "u1", timeline: [],
  integrations: { ghl: { unifiedStageKey: "submitted_fedex" } },
  immigrationLifecycle: number ? { tracking: { filing: { carrier: "fedex", trackingNumber: number } } } : undefined,
  save: async () => {},
});

test.beforeEach(() => {
  calls.emails.length = 0;
  state.caseDoc = makeCase(); state.submittedLog = null; state.numberLog = null;
  state.client = { _id: "u1", name: "Asha", email: "asha@example.com", role: "client", isActive: true };
});

test("the submitted e-mail carries the FedEx number when it is on file", async () => {
  state.caseDoc = makeCase("794644790138");
  await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } });
  assert.equal(calls.emails[0].template, "case-submitted-client");
  assert.equal(calls.emails[0].payload.data.trackingNumber, "794644790138");
  const html = submitted.bodyLines({ ...calls.emails[0].payload.data, portalLink: "https://client.example.com/dashboard" }).join("\n");
  assert.match(html, /7946 4479 0138/);
  assert.match(html, /background:#f3f4f6[^>]*>7946 4479 0138</); // the number sits in a grey box
  assert.match(html, /background:#1A4589[^>]*>Track My FedEx Shipment</); // a blue button...
  assert.match(html, /href="https:\/\/client\.example\.com\/dashboard"/); // ...to the client portal (the mail service turns it into the sign-in page)
  assert.doesNotMatch(html, /fedex\.com/);
  assert.match(html, /FedEx tracking area/);
});

test("without a number the FedEx section is left out of the submitted e-mail", async () => {
  await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" } });
  assert.equal(calls.emails[0].payload.data.trackingNumber, undefined);
  const html = submitted.bodyLines(calls.emails[0].payload.data).join("\n");
  assert.doesNotMatch(html, /FedEx/i);
  assert.match(html, /Congratulations/);
});

test("a number added after the submitted e-mail was sent goes in its own e-mail", async () => {
  state.submittedLog = { _id: "log1" };
  const result = await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "7946 4479 0138", previous: "", user: { _id: "m1" } });
  assert.equal(result.sent, true);
  assert.equal(calls.emails.length, 1);
  assert.equal(calls.emails[0].template, "case-fedex-number-client");
  assert.equal(calls.emails[0].payload.to, "asha@example.com");
  assert.equal(calls.emails[0].payload.data.trackingNumber, "794644790138");
  const html = fedex.bodyLines(calls.emails[0].payload.data).join("\n");
  assert.match(html, /FedEx tracking area/);
  assert.match(fedex.subject(calls.emails[0].payload.data), /FedEx tracking number/);
});

test("no separate e-mail while the submitted e-mail has not been sent (the number rides inside it)", async () => {
  const result = await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790138", previous: "" });
  assert.equal(result.reason, "submitted_email_not_sent");
  assert.equal(calls.emails.length, 0);
});

test("no e-mail when the number is unchanged or that number was already e-mailed", async () => {
  state.submittedLog = { _id: "log1" };
  assert.equal((await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790138", previous: "7946 4479 0138" })).reason, "unchanged");
  state.numberLog = { _id: "log2" };
  assert.equal((await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790138", previous: "" })).reason, "already_sent");
  assert.equal(calls.emails.length, 0);
});

test("employer matter and a case without a client login get nothing, and a failure never throws", async () => {
  state.submittedLog = { _id: "log1" };
  state.caseDoc = { ...makeCase(), caseRole: "principal", caseStructure: "employer_employee" };
  assert.equal((await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790138" })).reason, "employer_matter");
  state.caseDoc = makeCase(); state.client = null;
  assert.equal((await sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790138" })).reason, "no_client_login");
  state.caseDoc = null;
  assert.doesNotReject(sendFedexNumberNotice({ caseId: "c1", trackingNumber: "794644790138" }));
  assert.equal(calls.emails.length, 0);
});
