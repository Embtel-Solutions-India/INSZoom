// Owner rules (2026-11-05): whoever assigns sees everyone at their own level and below; a case manager never assigns a case. DB-free.
const assert = require("node:assert/strict");
const test = require("node:test");
const { assignableStaffRoles } = require("../../users/user.service");
const { teamHelpers } = require("../case.controller");

test("assign lists: own level and below", () => {
  assert.deepEqual(assignableStaffRoles({ role: "team_lead" }), ["case_manager", "team_lead"], "a team lead sees every team lead, not only their team");
  assert.deepEqual(assignableStaffRoles({ role: "admin" }), ["case_manager", "team_lead", "admin"]);
  assert.deepEqual(assignableStaffRoles({ role: "super_admin" }), ["case_manager", "team_lead", "admin", "super_admin"]);
  assert.deepEqual(assignableStaffRoles({ role: "client" }), []);
});

test("a case manager can never assign (assign, team lead, transfer, add / remove case manager all use this check)", () => {
  const caseData = { _id: "c1", assignedCaseManager: "u-cm" };
  assert.equal(teamHelpers.canAssignCase({ _id: "u-cm", role: "case_manager" }, caseData), false, "not even on their own case");
  assert.equal(teamHelpers.canAssignCase({ _id: "u-tl", role: "team_lead" }, caseData), true);
  assert.equal(teamHelpers.canAssignCase({ _id: "u-ad", role: "admin" }, caseData), true);
});
