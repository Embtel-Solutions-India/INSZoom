const test = require("node:test");
const assert = require("node:assert/strict");

const aux = require("../ghlAuxOutbound");
const { employeeName } = require("../ghlEmployeeIdentity");

const principal = { clientName: "ABC Technologies", user: "u-employer" };
const link = { createdAt: new Date("2026-01-01") };
const child = (over = {}) => ({ caseRole: "employee", status: "active", user: "u-employer", clientName: "", createdAt: new Date("2026-02-01"), integrations: { ghl: {} }, ...over });

test("employee name: the employer contact's own name is never the employee", () => {
  assert.equal(employeeName(child({ canonicalProfile: { profile: { person: { fullName: "ABC Technologies" } } } }), "u-employer", "ABC Technologies"), "");
  assert.equal(employeeName(child({ clientName: "Jane HR" }), "u-employer", "Jane HR"), ""); // copied, no own login
});

test("employee name: invited employee (own login) uses the typed name; profile first/last beats a stale full name", () => {
  assert.equal(employeeName(child({ user: "u-emp", clientName: "John Smith" }), "u-employer", "X"), "John Smith");
  const person = { firstName: "Sarah", lastName: "Williams", fullName: "Jane HR" };
  assert.equal(employeeName(child({ canonicalProfile: { profile: { person } } }), "u-employer", "Jane HR"), "Sarah Williams");
});

test("desired GHL name is 'Employer, Employee' once identified, else null", () => {
  assert.equal(aux.desiredEmployeeName(child(), principal), null);
  assert.equal(aux.desiredEmployeeName(child({ user: "u-emp", clientName: "John Smith" }), principal), "ABC Technologies, John Smith");
});

test("plan: create when unlinked, never for removed or pre-existing employees or non-employees", () => {
  assert.deepEqual(aux.planJobsForChild(child(), principal, link), ["create_opportunity"]);
  assert.deepEqual(aux.planJobsForChild(child({ status: "removed" }), principal, link), []);
  assert.deepEqual(aux.planJobsForChild(child({ createdAt: new Date("2025-01-01") }), principal, link), []);
  assert.deepEqual(aux.planJobsForChild(child({ caseRole: "principal" }), principal, link), []);
  assert.deepEqual(aux.planJobsForChild(child(), principal, null), []);
});

test("plan: an employee created AFTER CRM sync was switched on is never history, even when the employer link is a few seconds newer than the slot", () => {
  const syncSince = new Date("2026-01-15");
  const lateLink = { createdAt: new Date("2026-02-01T10:00:30Z") }; // written 25s after the slot (not backdated to the matter)
  const slot = child({ createdAt: new Date("2026-02-01T10:00:05Z") });
  assert.deepEqual(aux.planJobsForChild(slot, principal, lateLink), [], "without the sync start the old rule still applies (unchanged behavior)");
  assert.deepEqual(aux.planJobsForChild(slot, principal, lateLink, syncSince), ["create_opportunity"]);
  // an employee that predates the sync itself is still history
  assert.deepEqual(aux.planJobsForChild(child({ createdAt: new Date("2026-01-01") }), principal, lateLink, syncSince), []);
  // removed / non-employee rules are unaffected
  assert.deepEqual(aux.planJobsForChild({ ...slot, status: "removed" }, principal, lateLink, syncSince), []);
});

test("plan: remove abandons, restore reopens only what we abandoned, rename only on change", () => {
  const linked = (ghl, over) => child({ integrations: { ghl: { opportunityId: "O1", ...ghl } }, ...over });
  assert.deepEqual(aux.planJobsForChild(linked({ opportunityStatus: "open" }, { status: "removed" }), principal, link), ["set_status"]);
  assert.deepEqual(aux.planJobsForChild(linked({ opportunityStatus: "abandoned" }, { status: "removed" }), principal, link), []);
  assert.deepEqual(aux.planJobsForChild(linked({ opportunityStatus: "abandoned", abandonedByImmiglance: true }), principal, link), ["set_status"]);
  assert.deepEqual(aux.planJobsForChild(linked({ opportunityStatus: "abandoned" }), principal, link), []); // abandoned in GHL itself
  const named = { user: "u-emp", clientName: "John Smith" };
  assert.deepEqual(aux.planJobsForChild(linked({ opportunityStatus: "open" }, named), principal, link), ["rename"]);
  assert.deepEqual(aux.planJobsForChild(linked({ opportunityStatus: "open", displayName: "ABC Technologies, John Smith" }, named), principal, link), []);
});

test("category + service type come from the visa table; markers read from source or the custom field", () => {
  const entries = [{ visaType: "TN", petitionSubType: "", field: "work_visa", value: "TN - NAFTA Professionals", category: "non_immigrant" }];
  assert.equal(aux.categoryForVisa("TN", "", entries), "non_immigrant");
  assert.equal(aux.categoryForVisa("EB-2", "", []), "immigrant");
  assert.equal(aux.categoryForVisa("H-1B", "", []), "non_immigrant");
  assert.deepEqual(aux.serviceTypeFor("TN", "", entries), { serviceType: "Work Visa", detailField: "work_visa", detailValue: "TN - NAFTA Professionals" });
  assert.deepEqual(aux.serviceTypeFor("ZZ", "", entries), {});
  const marker = aux.markerFor({ caseNumber: "C-1" });
  assert.equal(aux.markerFromOpportunity({ source: marker }, {}), marker);
  assert.equal(aux.markerFromOpportunity({ source: "web" }, {}), null);
});
