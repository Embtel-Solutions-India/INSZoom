const assert = require("node:assert/strict");
const test = require("node:test");
const Case = require("../../../models/Case");
const access = require("../employer-view-access");
const accessRule = require("../case.service");

// The employer's READ-ONLY door to an invited employee's file: only the employer side of that employee's own principal, only while the
// employee holds the file, and never a write path. DB-free (Case.findById is stubbed).
const principal = { _id: "p1", user: "employer1", delegateEmployerUser: "delegate1" };
const invitedChild = { _id: "c1", caseRole: "employee", parentCase: "p1", user: "employee1" };

test("the principal's owner and the delegate employer may read the invited employee's file", () => {
  assert.equal(access.decide({ _id: "employer1", role: "client" }, invitedChild, principal), true);
  assert.equal(access.decide({ _id: "delegate1", role: "client" }, invitedChild, principal), true);
});

test("nobody else may: another employer, the employee's colleagues, a different principal's child, a stranger", () => {
  assert.equal(access.decide({ _id: "employer2", role: "client" }, invitedChild, principal), false, "another employer");
  assert.equal(access.decide({ _id: "employee2", role: "employee" }, invitedChild, principal), false, "another employee");
  assert.equal(access.decide({ _id: "employer1" }, { ...invitedChild, parentCase: "other" }, principal), false, "child of a different principal");
  assert.equal(access.decide({ _id: "employer1" }, { ...invitedChild, caseRole: "principal" }, principal), false, "not a child case");
  assert.equal(access.decide(null, invitedChild, principal), false);
  assert.equal(access.decide({ _id: "employer1" }, invitedChild, null), false);
});

test("while the EMPLOYER holds the file the normal owner path applies - this door is only for an employee-held file", () => {
  assert.equal(access.decide({ _id: "employer1" }, { ...invitedChild, user: "employer1" }, principal), false);
  assert.equal(access.decide({ _id: "employer1" }, { ...invitedChild, user: null }, principal), false);
});

test("canAccessCase still denies the employer on an invited employee's file, so every WRITE path stays closed", () => {
  const employerUser = { _id: "employer1", role: "client", caseIds: ["p1"] };
  assert.equal(accessRule.canAccessCase(employerUser, invitedChild), false);
});

test("canReadInvitedEmployeeCase looks the principal up only for a child case and decides from it", async () => {
  const original = Case.findById;
  let lookups = 0;
  Case.findById = () => ({ select: () => ({ lean: async () => { lookups += 1; return principal; } }) });
  try {
    assert.equal(await access.canReadInvitedEmployeeCase({ _id: "employer1" }, invitedChild), true);
    assert.equal(await access.canReadInvitedEmployeeCase({ _id: "employer2" }, invitedChild), false);
    const before = lookups;
    assert.equal(await access.canReadInvitedEmployeeCase({ _id: "employer1" }, { _id: "x", caseRole: "principal" }), false);
    assert.equal(await access.canReadInvitedEmployeeCase({ _id: "employer1" }, null), false);
    assert.equal(lookups, before, "no lookup for a case that cannot be a child");
  } finally {
    Case.findById = original;
  }
});
