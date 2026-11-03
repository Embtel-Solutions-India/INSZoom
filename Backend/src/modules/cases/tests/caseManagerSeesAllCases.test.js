// Owner decision 2026-11-04: every case manager sees and opens EVERY case, exactly like team leads (DB-free, the real access functions).
// Proves the widening AND that nothing else widened: clients, attorneys, employers and employees keep exactly their boundaries; team leads
// and admins are unchanged; the list filter and the detail check agree; every child of an employer matter is visible.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const caseService = require("../case.service");
const { scopedChildIdsFor } = require("../caseManagerAccess");

const oid = () => new Types.ObjectId();
const user = (role, extra = {}) => ({ _id: oid(), role, ...extra });
const someoneElsesCase = () => ({ _id: oid(), caseNumber: "B900", user: oid(), assignedCaseManager: oid(), additionalCaseManagers: [oid()], assignedTeamLead: oid(), attorneyAccess: [] });

test("a case manager opens a case assigned to ANOTHER case manager - like a team lead / admin", () => {
  const caseData = someoneElsesCase();
  for (const role of ["case_manager", "team_lead", "admin", "super_admin"]) assert.equal(caseService.canAccessCase(user(role), caseData), true, role);
});

test("the case LIST is not limited for a case manager (same as team lead), so the list and the detail check agree", () => {
  for (const role of ["case_manager", "team_lead", "admin"]) {
    const filter = caseService.buildCaseFilter({ status: "active" }, user(role));
    assert.equal(filter.status, "active", "the user's own filters still apply");
    assert.equal(JSON.stringify(filter).includes("assignedCaseManager"), false, `${role}: no assignment restriction`);
  }
});

test("nothing else widened: a client, an attorney without a grant, an employer and an employee still cannot open someone else's case", () => {
  const caseData = someoneElsesCase();
  for (const role of ["client", "user", "attorney", "employer", "employee", "beneficiary", "finance", "hr"]) {
    assert.ok(!caseService.canAccessCase(user(role), caseData), role); // "no match" may be false or undefined: both mean refused
  }
  const attorney = user("attorney");
  assert.equal(caseService.canAccessCase(attorney, { ...caseData, attorneyAccess: [{ attorneyId: attorney._id, status: "active" }] }), true, "an attorney with an active grant still can");
  assert.match(JSON.stringify(caseService.buildCaseFilter({}, user("attorney"))), /attorneyAccess/, "the attorney list is still limited to granted cases");
  assert.match(JSON.stringify(caseService.buildCaseFilter({}, user("employer", { companyId: oid() }))), /employerUser/, "the employer list is still limited");
});

test("employer matters: a case manager sees EVERY employee case, like a team lead (no per-child scoping)", async () => {
  const principal = { _id: oid(), caseRole: "principal", assignedCaseManager: oid(), childCaseManagers: [] };
  const cm = user("case_manager");
  principal.childCaseManagers.push(cm._id); // even one who is on only one child
  assert.equal(await scopedChildIdsFor(principal, cm), null, "null = every child is visible");
  assert.equal(await scopedChildIdsFor(principal, user("team_lead")), null);
});
