// Employer + Delegate Employer: ONE employer entity, ONE employer data set, TWO employer-side logins.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const AuditLog = require("../../../models/AuditLog");
const caseService = require("../case.service");
const delegateService = require("../delegate-employer.service");

const STAMP = Date.now();
const created = { cases: [], users: [] };
let employer;
let principal;
let child;
let outsider;
let delegate;

test.before(async () => {
  await connectTestDB();
  employer = await User.create({ email: `emp-${STAMP}@example.com`, name: "Acme Employer", role: "client", isActive: true, caseRole: "principal" });
  outsider = await User.create({ email: `out-${STAMP}@example.com`, name: "Other Client", role: "client", isActive: true, caseRole: "principal" });
  const number = `TESTDLG${STAMP}`;
  [principal] = await Case.create([{
    caseId: number, caseNumber: number, clientPortalId: number, clientName: "Acme", clientEmail: employer.email, visaType: "L-1A",
    caseType: "immigration", status: "active", user: employer._id, caseStructure: "employer_employee", caseRole: "principal", childCaseCount: 1,
  }]);
  [child] = await Case.create([{
    caseId: `${number}-A`, caseNumber: `${number}-A`, clientPortalId: `${number}-A`, clientName: "", clientEmail: "", visaType: "L-1A",
    caseType: "immigration", status: "pending_assignment", user: employer._id, parentCase: principal._id, caseStructure: "employer_employee",
    caseRole: "employee", childIndex: "A",
  }]);
  created.cases.push(principal._id, child._id);
  created.users.push(employer._id, outsider._id);
});

test.after(async () => {
  await Case.deleteMany({ _id: { $in: created.cases } });
  await User.deleteMany({ _id: { $in: created.users } });
  await AuditLog.deleteMany({ entityId: String(principal?._id) });
  await disconnectTestDB();
});

test("input validation: optional, needs name + email, never the employer's own email", () => {
  assert.equal(delegateService.parseDelegateInput({}, "a@b.com"), null);
  assert.throws(() => delegateService.parseDelegateInput({ delegateEmployerName: "X" }, "a@b.com"), { code: "INVALID_DELEGATE_EMAIL" });
  assert.throws(() => delegateService.parseDelegateInput({ delegateEmployerEmail: "d@b.com" }, "a@b.com"), { code: "INVALID_DELEGATE_NAME" });
  assert.throws(() => delegateService.parseDelegateInput({ delegateEmployerName: "X", delegateEmployerEmail: "A@B.com" }, "a@b.com"), { code: "DELEGATE_EMAIL_MATCHES_EMPLOYER" });
  assert.deepEqual(delegateService.parseDelegateInput({ delegateEmployerName: " X ", delegateEmployerEmail: "D@B.com" }, "a@b.com"), { name: "X", email: "d@b.com", phone: "" });
});

test("attach creates a separate login on the SAME case; no company data is stored for the delegate", async () => {
  const input = { name: "Dana Delegate", email: `dlg-${STAMP}@example.com`, phone: "" };
  const result = await delegateService.attachDelegateEmployer(principal, [child], input, employer);
  delegate = result.user;
  created.users.push(delegate._id);
  assert.equal(result.created, true);
  assert.ok(result.setupToken, "a set-password invitation token is issued, like the employer's");
  assert.notEqual(String(delegate._id), String(employer._id), "separate credentials");

  const fresh = await Case.findById(principal._id).lean();
  assert.equal(String(fresh.delegateEmployerUser), String(delegate._id));
  assert.equal(String(fresh.user), String(employer._id), "the employer remains the owner of the one employer record");
  assert.deepEqual(Object.keys(fresh.delegateEmployer).filter((k) => !["name", "email", "phone", "invitedAt", "invitedBy", "_id"].includes(k)), [], "contact only - no company/petitioner data");
  const freshChild = await Case.findById(child._id).lean();
  assert.equal(String(freshChild.delegateEmployerUser), String(delegate._id));
});

test("delegate reaches exactly what the employer reaches; an unrelated client reaches nothing", async () => {
  const freshPrincipal = await Case.findById(principal._id);
  assert.equal(await caseService.canAccessCase(delegate, freshPrincipal), true);
  assert.equal(await caseService.canAccessCase(employer, freshPrincipal), true);
  assert.equal(await caseService.canAccessCase(outsider, freshPrincipal), false);
  assert.equal(delegateService.isEmployerSide(freshPrincipal, delegate), true);
  assert.equal(delegateService.isEmployerSide(freshPrincipal, employer), true);
  assert.equal(delegateService.isEmployerSide(freshPrincipal, outsider), false);
});

test("delegate follows the employer on employee cases: out on invite, back on hand-back", async () => {
  const freshPrincipal = await Case.findById(principal._id);
  const freshChild = await Case.findById(child._id);
  await delegateService.followEmployerHolding(freshPrincipal, freshChild, false);
  await freshChild.save();
  assert.equal(freshChild.delegateEmployerUser, null);
  assert.equal((await User.findById(delegate._id).lean()).caseIds.map(String).includes(String(child._id)), false);

  await delegateService.followEmployerHolding(freshPrincipal, freshChild, true);
  await freshChild.save();
  assert.equal(String(freshChild.delegateEmployerUser), String(delegate._id));
  assert.equal((await User.findById(delegate._id).lean()).caseIds.map(String).includes(String(child._id)), true);
});

test("audit trail names the person and labels the delegate capacity", async () => {
  const freshPrincipal = await Case.findById(principal._id);
  await caseService.writeAuditLog("employer_info_updated", freshPrincipal, delegate, { field: "x" }, { ip: "127.0.0.1", headers: {} });
  await caseService.writeAuditLog("employer_info_updated", freshPrincipal, employer, { field: "y" }, { ip: "127.0.0.1", headers: {} });
  const logs = await AuditLog.find({ entityId: String(principal._id) }).lean();
  const byDelegate = logs.find((l) => String(l.userId) === String(delegate._id));
  const byEmployer = logs.find((l) => String(l.userId) === String(employer._id));
  assert.equal(byDelegate.userRole, "delegate_employer");
  assert.notEqual(byEmployer.userRole, "delegate_employer");
});

test("an existing active account re-used as delegate is not re-invited and keeps its password", async () => {
  const existing = await User.create({ email: `exist-${STAMP}@example.com`, name: "Existing", role: "client", isActive: true, password: "Passw0rd!x", caseRole: "principal" });
  created.users.push(existing._id);
  const result = await delegateService.attachDelegateEmployer(await Case.findById(principal._id), [], { name: "Existing", email: existing.email, phone: "" }, employer);
  assert.equal(result.created, false);
  assert.equal(result.setupToken, null);
});

test("a staff email can never become a delegate", async () => {
  const staff = await User.create({ email: `staff-${STAMP}@example.com`, name: "Staff", role: "case_manager", isActive: true });
  created.users.push(staff._id);
  await assert.rejects(delegateService.assertDelegateEmailUsable(staff.email), { code: "DELEGATE_EMAIL_IN_USE" });
  void mongoose;
});
