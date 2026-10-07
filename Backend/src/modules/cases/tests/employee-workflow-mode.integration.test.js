// Round trip against a real (test) database: invite an employee, switch them back to "employer fills", invite again -
// checking ownership, caseIds and the invitation link at every step, and that a second employee on the same matter
// keeps their own, different workflow the whole time.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const EmployeeProfile = require("../../../models/EmployeeProfile");
const EmployerProfile = require("../../../models/EmployerProfile");
const CaseNumberService = require("../../../services/CaseNumberService");
const ctrl = require("../case.controller");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
const next = (error) => { if (error) throw error; };

async function matterWithTwoEmployees() {
  const stamp = Date.now();
  const principalNumber = `TESTW${stamp}`;
  const employer = await User.create({ email: `employer${stamp}@example.com`, name: "ACME Employer", role: "client", isActive: true, caseRole: "principal" });
  const [principal] = await Case.create([{
    caseId: principalNumber, caseNumber: principalNumber, clientPortalId: principalNumber, clientName: "ACME Employer", clientEmail: employer.email,
    visaType: "E-3", caseType: "immigration", status: "active", user: employer._id, caseStructure: "employer_employee", caseRole: "principal",
    childCaseCount: 2, dataEntryMode: "fill_self",
  }]);
  const [employerProfile] = await EmployerProfile.create([{ principalCaseId: principal._id }]);
  const children = [];
  for (let index = 0; index < 2; index += 1) {
    const number = CaseNumberService.childCaseNumber(principalNumber, index);
    const [child] = await Case.create([{
      caseId: number, caseNumber: number, clientPortalId: number, clientName: "", clientEmail: "", visaType: "E-3", caseType: "immigration",
      status: "pending_assignment", user: employer._id, parentCase: principal._id, caseStructure: "employer_employee", caseRole: "employee",
      childIndex: CaseNumberService.indexToSuffix(index), employerProfileId: employerProfile._id, dataEntryMode: "fill_self",
    }]);
    await EmployeeProfile.create([{ caseId: child._id, principalCaseId: principal._id, profileType: "employee" }]);
    children.push(child);
  }
  await User.updateOne({ _id: employer._id }, { $set: { caseIds: [principal._id, ...children.map((c) => c._id)] } });
  return { employer, principal, children };
}

test("employee workflow can be switched back and forth per employee without losing access control", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const { employer, principal, children } = await matterWithTwoEmployees();
  const [first, second] = children;
  const params = (child) => ({ principalId: String(principal._id), childCaseId: String(child._id) });
  const email = `jane${Date.now()}@example.com`;

  // 1. employer starts by filling in themselves (default), then invites ONLY the first employee
  let res = mockRes();
  await ctrl.setEmployeeDataEntryMode({ params: params(first), user: employer, body: { mode: "invite", employeeEmail: email, employeeName: "Jane Doe" } }, res, next);
  assert.equal(res.statusCode, 200);
  let firstDoc = await Case.findById(first._id);
  const invitedUser = await User.findOne({ email });
  assert.equal(String(firstDoc.user), String(invitedUser._id));
  assert.equal(firstDoc.employeeDataEntryMode, "invite");
  assert.equal(String((await Case.findById(second._id)).user), String(employer._id), "the other employee is untouched");
  assert.ok(!(await User.findById(employer._id)).caseIds.map(String).includes(String(first._id)), "employer no longer holds the invited employee's file");

  // 2. employer changes their mind: they will fill this employee in themselves
  res = mockRes();
  await ctrl.setEmployeeDataEntryMode({ params: params(first), user: employer, body: { mode: "fill_self" } }, res, next);
  assert.equal(res.statusCode, 200);
  firstDoc = await Case.findById(first._id);
  assert.equal(String(firstDoc.user), String(employer._id));
  assert.equal(firstDoc.employeeDataEntryMode, "fill_self");
  assert.ok((await User.findById(employer._id)).caseIds.map(String).includes(String(first._id)));
  const revoked = await User.findById(invitedUser._id).select("+inviteTokenHash");
  assert.equal(revoked.isActive, false);
  assert.ok(!revoked.inviteTokenHash, "the emailed invitation link no longer works");
  assert.ok(!(revoked.caseIds || []).map(String).includes(String(first._id)));

  // 3. ...and later invites them again (same account is reused, no duplicate)
  res = mockRes();
  await ctrl.setEmployeeDataEntryMode({ params: params(first), user: employer, body: { mode: "invite", employeeEmail: email, employeeName: "Jane Doe" } }, res, next);
  assert.equal(res.statusCode, 200);
  assert.equal(await User.countDocuments({ email }), 1);
  assert.equal(String((await Case.findById(first._id)).user) !== String(employer._id), true);

  // cleanup (test database only)
  await Case.deleteMany({ _id: { $in: [principal._id, ...children.map((c) => c._id)] } });
  await EmployeeProfile.deleteMany({ principalCaseId: principal._id });
  await EmployerProfile.deleteMany({ principalCaseId: principal._id });
  await User.deleteMany({ _id: { $in: [employer._id, invitedUser._id] } });
  void mongoose;
});
