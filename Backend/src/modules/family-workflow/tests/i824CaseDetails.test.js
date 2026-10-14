const assert = require("node:assert/strict");
const test = require("node:test");
const { buildI824Details, isI824 } = require("../i824CaseDetails");

test("recognises the I-824 case type in any spelling and nothing else", () => {
  ["I-824", "I824", "i-824", " I 824 "].forEach((value) => assert.equal(isI824(value), true, value));
  ["I-130", "IR-1", "Action on Approved Case", "", undefined].forEach((value) => assert.equal(isI824(value), false, String(value)));
});

test("everything is optional: empty input yields review flags, never an error or a made-up value", () => {
  const details = buildI824Details();
  assert.equal(details.formNumber, "");
  assert.equal(details.receiptNumber, "");
  assert.ok(details.reviewFlags.includes("underlying_petition_form_unverified"));
  assert.ok(details.reviewFlags.includes("requested_action_unverified"));
});

test("an I-130 approval with all details recorded needs no review flags", () => {
  const details = buildI824Details({ formNumber: "i-130", receiptNumber: "msc2190000001", approvalDate: "2025-03-01", requestedAction: "Replace approval notice" });
  assert.equal(details.formNumber, "I-130");
  assert.equal(details.receiptNumber, "MSC2190000001");
  assert.deepEqual(details.reviewFlags, []);
});

test("an I-824 is not assumed to be I-130 based: another underlying form is flagged", () => {
  assert.ok(buildI824Details({ formNumber: "I-140", receiptNumber: "X", approvalDate: "2025-01-01", requestedAction: "Replace" }).reviewFlags.includes("underlying_petition_not_i130_verify_workflow"));
});

test("a consular / other-agency route is flagged for staff, never turned into a DOS form", () => {
  const details = buildI824Details({ formNumber: "I-130", receiptNumber: "X", approvalDate: "2025-01-01", requestedAction: "Notify the U.S. consulate for DS-260 processing" });
  assert.ok(details.reviewFlags.includes("consular_or_other_agency_route_staff_review"));
});
