const test = require("node:test");
const assert = require("node:assert/strict");
const { plan } = require("../ghlCaseOutbound");

const base = { status: "assigned", visaType: "O-1B", visaSelectionStatus: "selected", caseRole: "single", caseStructure: "single", integrations: {} };

test("a single-party case with a visa needs a GHL card", () => {
  assert.equal(plan(base), "card");
});

test("a family case (no structure fields) needs a GHL card", () => {
  assert.equal(plan({ ...base, caseRole: null, caseStructure: null, visaType: "IR-1" }), "card");
});

test("an employer matter needs the employer link, never a card of its own", () => {
  assert.equal(plan({ ...base, caseRole: "principal", caseStructure: "employer_employee" }), "employer");
});

test("an employee card is left to the employee sync", () => {
  assert.equal(plan({ ...base, caseRole: "employee", caseStructure: "employer_employee" }), null);
});

test("nothing is created before a visa is chosen, or for removed cases", () => {
  assert.equal(plan({ ...base, visaSelectionStatus: "pending" }), null);
  assert.equal(plan({ ...base, visaType: "" }), null);
  assert.equal(plan({ ...base, status: "removed" }), null);
});

test("a case that already has its GHL card is not created again", () => {
  assert.equal(plan({ ...base, integrations: { ghl: { opportunityId: "opp1" } } }), null);
});
