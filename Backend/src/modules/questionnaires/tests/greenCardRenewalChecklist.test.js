const assert = require("node:assert/strict");
const test = require("node:test");
const { GREEN_CARD_RENEWAL_DEFINITIONS } = require("../greenCardRenewalChecklist");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");

// "Renew, Replace, Correct or Update Green Card" (Form I-90) - a service
// for an EXISTING Green Card holder, single-party (checklistRole "client"),
// completely separate from the I-130/Green-Card-AOS/GC-NVC family
// workflows. DB-free, following this module's established convention.

const def = GREEN_CARD_RENEWAL_DEFINITIONS[0];

test("exactly one Green Card Renewal checklist is registered, client-owned, always default", () => {
  assert.equal(GREEN_CARD_RENEWAL_DEFINITIONS.length, 1);
  assert.equal(def.checklistRole, "client");
  assert.equal(def.isDefault, true);
  assert.equal(def.visaType, "GreenCardRenewal");
});

test("client-facing title is the general-language service name, never 'I-90'", () => {
  assert.equal(def.title, "Renew, Replace, Correct or Update Green Card");
  assert.doesNotMatch(def.title, /I-90/i);
});

test("structured reason field exists as a real select question, not free text, with the four required options", () => {
  const reason = def.questions.find((q) => q.key === "client_greenCardUpdateReason");
  assert.ok(reason, "reason question must exist");
  assert.equal(reason.type, "select");
  assert.deepEqual(
    reason.options.map((o) => o.value).sort(),
    ["CORRECTION", "RENEWAL", "REPLACEMENT", "UPDATE"]
  );
  assert.deepEqual(
    reason.options.map((o) => o.label).sort(),
    ["Correct information on my Green Card", "Renew my Green Card", "Replace my Green Card", "Update my Green Card"].sort()
  );
});

test("document list matches the source exactly (7 documents, no invented ones)", () => {
  const docTypes = def.questions.filter((q) => q.type === "file").map((q) => q.key).sort();
  assert.deepEqual(docTypes, [
    "gc_renewal_birth_certificate",
    "gc_renewal_drivers_license_or_state_id",
    "gc_renewal_passport_copy",
    "gc_renewal_passport_photos",
    "gc_renewal_previous_green_card",
    "gc_renewal_ssn_copy",
    "gc_renewal_tax_returns",
  ].sort());
});

test("field catalog spot-check: personal info + Green Card history fields present", () => {
  const keys = new Set(def.questions.map((q) => q.key));
  ["client_aNumber", "client_gcSsn", "client_gcUscisOnlineAccountNumber", "client_gcLastName", "client_gcMothersName", "client_gcFathersName", "client_gcClassOfAdmission", "client_gcPortOfEntry"]
    .forEach((key) => assert.ok(keys.has(key), `${key} missing from Green Card Renewal checklist`));
});

test("checklist visibility is client-only (never petitioner/beneficiary/employer/employee/joint_sponsor)", () => {
  def.questions.forEach((q) => {
    assert.ok(q.visibility.roles.includes("client"));
    ["petitioner", "beneficiary", "employer", "employee", "joint_sponsor"].forEach((role) => {
      assert.ok(!q.visibility.roles.includes(role), `${q.key} must not be visible to ${role}`);
    });
  });
});

test("no duplicate question keys", () => {
  const keys = def.questions.map((q) => q.key);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});

test("VisaFormMapping: 'Green Card Renewal' resolves to I-90 only - no I-130/I-485/DS-260/I-864/I-765/I-131", () => {
  const rows = mappings.filter((m) => m.visaType === "Green Card Renewal");
  assert.ok(rows.length > 0, "Green Card Renewal must have VisaFormMapping rows");
  assert.deepEqual(rows.map((r) => r.formNumber), ["I-90"]);
  const forbidden = ["I-130", "I-485", "DS-260", "I-864", "I-765", "I-131"];
  rows.forEach((r) => assert.ok(!forbidden.includes(r.formNumber)));
});

test("VisaFormMapping: I-90 is AUTO_CREATE only for 'Green Card Renewal', not attached to I-130/AOS/GC-NVC visa types", () => {
  const i90Rows = mappings.filter((m) => m.formNumber === "I-90");
  assert.deepEqual(i90Rows.map((r) => r.visaType), ["Green Card Renewal"]);
});
