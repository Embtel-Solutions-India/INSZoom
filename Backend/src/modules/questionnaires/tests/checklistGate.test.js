// Checklist approval gate: who sees what, grandfathering of existing cases, per-case copy identity.
// Pure tests - no database.
const test = require("node:test");
const assert = require("node:assert/strict");

const gate = require("../checklist-gate");
const Case = require("../../../models/Case");

const gatedCase = (approvals = []) => ({ checklistApproval: { required: true, approvals } });
const entry = (key, targetRole = "employer", extra = {}) => ({ key, targetRole, ...extra });

test("a new case is gated; an existing case (no value stored) is not", async () => {
  const fresh = new Case({ caseNumber: "G1", clientName: "t", visaType: "H-1B" });
  await fresh.validate().catch(() => {});
  assert.equal(fresh.checklistApproval.required, true, "new cases start with draft checklists");
  const existing = Case.hydrate({ caseNumber: "G2", visaType: "H-1B" });
  assert.equal(existing.checklistApproval?.required, undefined);
  assert.equal(gate.isGated(existing), false);
  assert.equal(gate.isApproved(existing, entry("h1b_employer_checklist")), true, "existing cases are grandfathered as approved");
});

test("on a gated case a checklist is a draft until its own approval exists", () => {
  const caseData = gatedCase([{ checklistId: "h1b_employer_checklist|employer" }]);
  assert.equal(gate.isApproved(caseData, entry("h1b_employer_checklist")), true);
  assert.equal(gate.isApproved(caseData, entry("h1b_employee_checklist", "employee")), false, "approval is per checklist");
  assert.equal(gate.isApproved(gatedCase(), entry("h1b_employer_checklist")), false);
});

test("approval is per role: the same template under another role is a different checklist", () => {
  const caseData = gatedCase([{ checklistId: "x_checklist|employer" }]);
  assert.equal(gate.isApproved(caseData, entry("x_checklist", "employee")), false);
});

test("staff-requested checklists (information requests, Premium Processing add-on) are never gated", () => {
  assert.equal(gate.isApproved(gatedCase(), entry("i907_premium_processing_profile", "client", { staffRequest: true })), true);
});

test("a per-case copy is the same checklist as its template for approval purposes", () => {
  const copyKey = gate.caseCopyKey("perm_employer_information", "abc123");
  assert.equal(copyKey, "perm_employer_information__case_abc123");
  assert.equal(gate.isCaseCopyKey(copyKey), true);
  assert.equal(gate.isCaseCopyKey("perm_employer_information"), false);
  assert.equal(gate.baseKey(copyKey), "perm_employer_information");
  assert.equal(gate.checklistId({ key: copyKey, targetRole: "employer" }), gate.checklistId({ key: "perm_employer_information", targetRole: "employer" }));
  const caseData = gatedCase([{ checklistId: "perm_employer_information|employer" }]);
  assert.equal(gate.isApproved(caseData, entry(copyKey)), true, "approval survives forking");
});

test("only internal staff are exempt: client, employer, employee, beneficiary, petitioner are all client-side", () => {
  for (const role of ["client", "employer", "employee", "beneficiary", "petitioner", "joint_sponsor", "user", undefined]) {
    assert.equal(gate.isClientSideUser({ role }), true, String(role));
  }
  for (const role of ["super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal", "Case Manager"]) {
    assert.equal(gate.isClientSideUser({ role }), false, String(role));
  }
});
