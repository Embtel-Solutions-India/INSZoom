const assert = require("node:assert/strict");
const test = require("node:test");
const { employeeOptions } = require("../ghlCaseOutbound");

// DB-free: the employees offered in the Update Stage dialog of an employer matter.
test("every employee card is offered - identified or not, invited or not - with the name and email the Employees panel shows", () => {
  const options = employeeOptions([
    // identity typed in (stored in employeeIdentity), not invited yet: the B505-A case that showed an empty dropdown
    { _id: "c1", caseNumber: "B505-A", employeeIdentity: { name: "Ishaan", email: "Ishaanoberoi04@gmail.com" }, user: "employer", integrations: { ghl: { unifiedStageKey: "case_onboarded" } } },
    // a pending invitee
    { _id: "c2", caseNumber: "B505-B", pendingEmployee: { name: "Mira Das", email: "mira@example.com" }, integrations: { ghl: { unifiedStageKey: "docs_checklist" } } },
    // an employee with their own login: the case itself holds the name / email
    { _id: "c3", caseNumber: "B505-C", clientName: "Raj Patel", clientEmail: "raj@example.com", integrations: { ghl: { unifiedStageKey: null } } },
    // a slot nobody has identified yet: still offered, listed by its case number
    { _id: "c4", caseNumber: "B505-D", integrations: { ghl: {} } },
  ]);
  assert.deepEqual(options.map((o) => [o.caseNumber, o.name, o.email, o.currentKey]), [
    ["B505-A", "Ishaan", "ishaanoberoi04@gmail.com", "case_onboarded"],
    ["B505-B", "Mira Das", "mira@example.com", "docs_checklist"],
    ["B505-C", "Raj Patel", "raj@example.com", null],
    ["B505-D", "", "", null],
  ]);
  assert.deepEqual(options.map((o) => o.caseId), ["c1", "c2", "c3", "c4"]);
  assert.deepEqual(employeeOptions([]), []);
  assert.deepEqual(employeeOptions(undefined), []);
});
