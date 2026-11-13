// "Submitted online": the team's e-mail choice with method "online" sends the NEW template (USCIS receipt number instead of the FedEx section, receipt shown only when on file),
// FedEx stays exactly as it was, one case-submitted e-mail per case across both versions, and the receipt number setter validates / saves quietly. DB-free (stubs).
const test = require("node:test");
const assert = require("node:assert/strict");

const calls = { emails: [], updates: [], logQueries: [] };
const state = { caseDoc: null, existingLog: null, receiptLog: null, client: null };
const stub = (path, exports) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };

stub("../../../models/Case", { findById: async () => state.caseDoc, updateOne: async (...args) => { calls.updates.push(args); return {}; } });
stub("../../../models/User", { findById: () => ({ select: () => ({ lean: async () => state.client }) }) });
stub("../../../models/EmailLog", { findOne: (query) => { calls.logQueries.push(query); const log = query.templateKey === "case-uscis-receipt-number-client" ? state.receiptLog : state.existingLog; return { select: () => ({ lean: async () => log }) }; } });
stub("../../../modules/email/email.service", { sendTemplateEmail: async (template, payload) => { calls.emails.push({ template, payload }); return { sent: true }; } });
stub("../../../modules/cases/case.service", { addTimelineEvent: () => {} });

const { sendOnTeamChoice, sendReceiptNumberNotice } = require("../ghlSubmittedNotice");
const online = require("../../../modules/email/templates/case-submitted-online-client");
const fedexSubmitted = require("../../../modules/email/templates/case-submitted-client");
const { receiptLines } = require("../../../modules/email/templates/receiptSection");
const TrackingService = require("../../../modules/immigration-lifecycle/services/TrackingService");

const makeCase = (filing) => ({
  _id: "c1", caseNumber: "B1", clientName: "Asha", caseRole: "single", user: "u1", timeline: [],
  integrations: { ghl: { unifiedStageKey: "submitted_fedex" } },
  immigrationLifecycle: filing ? { tracking: { filing } } : undefined,
  save: async () => {},
});

test.beforeEach(() => {
  calls.emails.length = 0; calls.updates.length = 0; calls.logQueries.length = 0;
  state.caseDoc = makeCase(); state.existingLog = null; state.receiptLog = null;
  state.client = { _id: "u1", name: "Asha", email: "asha@example.com", role: "client", isActive: true };
});

test("online + send: the NEW template goes out with the receipt number when it is on file", async () => {
  state.caseDoc = makeCase({ receiptNumber: "IOE1234567890" });
  const result = await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" }, method: "online" });
  assert.equal(result.sent, true);
  assert.equal(calls.emails[0].template, "case-submitted-online-client");
  assert.equal(calls.emails[0].payload.data.receiptNumber, "IOE1234567890");
  assert.equal(calls.emails[0].payload.data.trackingNumber, undefined);
});

test("online + send without a receipt number: still sent, the receipt section is simply absent", async () => {
  await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" }, method: "online" });
  assert.equal(calls.emails[0].template, "case-submitted-online-client");
  assert.equal(calls.emails[0].payload.data.receiptNumber, undefined);
  const lines = online.bodyLines(calls.emails[0].payload.data).join("\n");
  assert.ok(!/receipt number is/i.test(lines) && !/IOE/.test(lines));
  assert.ok(/submitted online/i.test(lines));
});

test("FedEx (method fedex, or no method at all) is exactly the original e-mail", async () => {
  state.caseDoc = makeCase({ carrier: "fedex", trackingNumber: "794644790138", receiptNumber: "IOE1234567890" });
  for (const method of ["fedex", undefined]) {
    calls.emails.length = 0;
    await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" }, method });
    assert.equal(calls.emails[0].template, "case-submitted-client");
    assert.equal(calls.emails[0].payload.data.trackingNumber, "794644790138");
    assert.equal(calls.emails[0].payload.data.receiptNumber, undefined);
  }
});

test("one case-submitted e-mail per case across BOTH versions; choosing not to inform sends nothing", async () => {
  state.existingLog = { _id: "x" };
  const again = await sendOnTeamChoice({ caseId: "c1", send: true, user: { _id: "m1" }, method: "online" });
  assert.deepEqual([again.sent, again.reason], [false, "already_sent"]);
  assert.deepEqual(calls.logQueries[0].templateKey.$in.sort(), ["case-submitted-client", "case-submitted-online-client"]);
  state.existingLog = null; calls.emails.length = 0;
  const skipped = await sendOnTeamChoice({ caseId: "c1", send: false, user: { _id: "m1" }, method: "online" });
  assert.deepEqual([skipped.sent, calls.emails.length], [false, 0]);
});

test("the online e-mail: wording, receipt block only for a valid number, FedEx e-mail text unchanged", () => {
  assert.equal(online.subject({ caseNumber: "B9" }), "Congratulations - your case has been submitted online (B9)");
  const withReceipt = online.bodyLines({ clientName: "Asha", receiptNumber: "ioe 1234567890" }).join("\n");
  assert.ok(withReceipt.includes("IOE1234567890") && /receipt number is/i.test(withReceipt));
  assert.deepEqual(receiptLines({ receiptNumber: "12345" }), []);
  assert.deepEqual(receiptLines({}), []);
  assert.ok(!/fedex/i.test(withReceipt), "no FedEx section in the online e-mail");
  assert.equal(fedexSubmitted.subject({ caseNumber: "B9" }), "Congratulations - your case has been submitted (B9)", "the FedEx e-mail is untouched");
});

test("receipt number setter: validates three letters + ten digits, saves quietly with filing method online", async () => {
  assert.equal(TrackingService.cleanReceiptNumber(" ioe-1234567890 "), "IOE1234567890");
  for (const bad of ["", "IOE123", "1234567890123", "IOE12345678901", null]) assert.equal(TrackingService.cleanReceiptNumber(bad), null, String(bad));
  await assert.rejects(() => TrackingService.setReceiptNumber({ _id: "c1" }, "nope", { _id: "m1" }), (error) => error.status === 400 && error.code === "INVALID_RECEIPT_NUMBER");
  assert.equal(calls.updates.length, 0, "nothing is written for an invalid number");
  const saved = await TrackingService.setReceiptNumber({ _id: "c1", immigrationLifecycle: {} }, "ioe1234567890", { _id: "m1" });
  assert.deepEqual(saved, { receiptNumber: "IOE1234567890", filingMethod: "online" });
  const set = calls.updates[0][1].$set;
  assert.equal(set["immigrationLifecycle.tracking.filing.receiptNumber"], "IOE1234567890");
  assert.equal(set["immigrationLifecycle.tracking.filing.filingMethod"], "online");
  assert.equal(set.uscisReceiptNumber, "IOE1234567890");
  assert.ok(!Object.keys(set).some((key) => /status/i.test(key) && key.includes("tracking.status")), "the USCIS status is never touched");
});

test("a receipt number added AFTER the online e-mail went out gets its own e-mail (once per number)", async () => {
  state.existingLog = { _id: "online-sent" };
  const first = await sendReceiptNumberNotice({ caseId: "c1", receiptNumber: "ioe1234567890", previous: "", user: { _id: "m1" } });
  assert.equal(first.sent, true);
  assert.equal(calls.emails[0].template, "case-uscis-receipt-number-client");
  assert.equal(calls.emails[0].payload.data.receiptNumber, "IOE1234567890");
  calls.emails.length = 0;
  state.receiptLog = { _id: "r1" };
  assert.equal((await sendReceiptNumberNotice({ caseId: "c1", receiptNumber: "IOE1234567890", previous: "", user: { _id: "m1" } })).reason, "already_sent");
  assert.equal((await sendReceiptNumberNotice({ caseId: "c1", receiptNumber: "IOE1234567890", previous: "IOE1234567890", user: { _id: "m1" } })).reason, "unchanged");
  assert.equal(calls.emails.length, 0);
});

test("no receipt e-mail when the team did not send the online submitted e-mail, for a bad number, or for an employer matter", async () => {
  state.existingLog = null; // the online e-mail was NOT sent (the team chose not to inform the client, or not yet)
  assert.equal((await sendReceiptNumberNotice({ caseId: "c1", receiptNumber: "IOE1234567890", previous: "", user: {} })).reason, "submitted_email_not_sent");
  state.existingLog = { _id: "online-sent" };
  assert.equal((await sendReceiptNumberNotice({ caseId: "c1", receiptNumber: "12345", previous: "", user: {} })).reason, "unchanged");
  state.caseDoc = { ...makeCase(), caseRole: "principal", caseStructure: "employer_employee" };
  assert.equal((await sendReceiptNumberNotice({ caseId: "c1", receiptNumber: "IOE1234567890", previous: "", user: {} })).reason, "employer_matter");
  assert.equal(calls.emails.length, 0);
});

test("the receipt follow-up e-mail: subject and body", () => {
  const t = require("../../../modules/email/templates/case-uscis-receipt-number-client");
  assert.equal(t.subject({ caseNumber: "B9" }), "Your USCIS receipt number (B9)");
  assert.ok(t.bodyLines({ clientName: "Asha", receiptNumber: "IOE1234567890" }).join(" ").includes("IOE1234567890"));
});
