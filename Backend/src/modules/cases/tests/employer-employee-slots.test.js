// Real per-employee child-Case architecture (caseStructure:'employer_employee',
// childIndex, EmployerProfile/EmployeeProfile) already existed before this
// suite - see case.controller.js's createCase and case.constants.js's
// CASE_STATUSES "removed" entry. This file covers the gaps closed on top of
// it: N9 (invite status must reflect the real email-provider result, not
// just "sent" unconditionally), restoreEmployee (undo removeEmployee), and
// addEmployeeSlot (mutable expected employee count, N5's never-reused
// suffix guarantee).
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const EmployeeProfile = require("../../../models/EmployeeProfile");
const EmployerProfile = require("../../../models/EmployerProfile");
const ctrl = require("../case.controller");

const STAFF_ACTOR = { _id: new mongoose.Types.ObjectId(), role: "admin" };

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

async function makeEmployerMatterWithNChildren(n) {
  const principalCaseNumber = `TESTB${Date.now()}`;
  const employer = await User.create({
    email: `employer${Date.now()}@example.com`, name: "ACME Employer", role: "client",
    isActive: true, caseRole: "principal",
  });
  const [principal] = await Case.create([{
    caseId: principalCaseNumber, caseNumber: principalCaseNumber, clientPortalId: principalCaseNumber,
    clientName: "ACME Employer", clientEmail: employer.email, visaType: "E-3", caseType: "immigration",
    status: "active", user: employer._id, caseStructure: "employer_employee", caseRole: "principal",
    childCaseCount: n, childIndex: null, dataEntryMode: "invite",
  }]);
  const [employerProfile] = await EmployerProfile.create([{ principalCaseId: principal._id }]);
  principal.employerProfileId = employerProfile._id;

  const childCases = [];
  const CaseNumberService = require("../../../services/CaseNumberService");
  for (let index = 0; index < n; index += 1) {
    const childIndex = CaseNumberService.indexToSuffix(index);
    const childCaseNumber = CaseNumberService.childCaseNumber(principalCaseNumber, index);
    const [childCase] = await Case.create([{
      caseId: childCaseNumber, caseNumber: childCaseNumber, clientPortalId: childCaseNumber,
      clientName: "", clientEmail: "", visaType: "E-3", caseType: "immigration", status: "pending_assignment",
      user: employer._id, parentCase: principal._id, caseStructure: "employer_employee", caseRole: "employee",
      childIndex, childCaseCount: 0, employerProfileId: employerProfile._id, dataEntryMode: "invite",
    }]);
    const [profile] = await EmployeeProfile.create([{ caseId: childCase._id, principalCaseId: principal._id, profileType: "employee" }]);
    childCase.personProfileId = profile._id;
    await childCase.save();
    childCases.push(childCase);
  }
  principal.childCases = childCases.map((c) => c._id);
  await principal.save();
  return { employer, principal, childCases };
}

test("employer/employee slots suite", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();

  await t.test("N9: inviteEmployee reports inviteStatus 'pending' (never a false 'sent') when the email provider is not configured", async () => {
    const { employer, principal, childCases } = await makeEmployerMatterWithNChildren(2);
    const res = mockRes();
    await ctrl.inviteEmployee(
      { params: { principalId: String(principal._id) }, body: { childCaseId: String(childCases[0]._id), employeeEmail: `emp${Date.now()}@example.com`, employeeName: "John Smith" }, user: { _id: employer._id, role: "client" } },
      res,
      (err) => { if (err) throw err; }
    );
    assert.equal(res.statusCode, 200);
    assert.notEqual(res.body.inviteStatus, "sent", "must not falsely claim 'sent' when no provider is configured in the test env");
    assert.ok(["pending", "failed"].includes(res.body.inviteStatus));
    const reloaded = await Case.findById(childCases[0]._id);
    assert.equal(reloaded.clientName, "John Smith", "the child case is still identified/invited regardless of email delivery outcome");
  });

  await t.test("removeEmployee then restoreEmployee round-trips status via previousStatus, staff-only", async () => {
    const { principal, childCases } = await makeEmployerMatterWithNChildren(1);
    const child = childCases[0];
    const removeRes = mockRes();
    await ctrl.removeEmployee({ params: { caseId: String(child._id) }, user: STAFF_ACTOR }, removeRes, (err) => { if (err) throw err; });
    assert.equal(removeRes.statusCode, 200);
    assert.equal(removeRes.body.status, "removed");

    const clientAttemptRes = mockRes();
    await ctrl.restoreEmployee({ params: { caseId: String(child._id) }, user: { _id: principal.user, role: "client" } }, clientAttemptRes, (err) => { if (err) throw err; });
    assert.equal(clientAttemptRes.statusCode, 403, "only staff may restore");

    const restoreRes = mockRes();
    await ctrl.restoreEmployee({ params: { caseId: String(child._id) }, user: STAFF_ACTOR }, restoreRes, (err) => { if (err) throw err; });
    assert.equal(restoreRes.statusCode, 200);
    const reloaded = await Case.findById(child._id);
    assert.notEqual(reloaded.status, "removed");

    const alreadyRestoredRes = mockRes();
    await ctrl.restoreEmployee({ params: { caseId: String(child._id) }, user: STAFF_ACTOR }, alreadyRestoredRes, (err) => { if (err) throw err; });
    assert.equal(alreadyRestoredRes.statusCode, 409, "restoring a non-removed case is rejected");
  });

  await t.test("N3/N5: addEmployeeSlot appends the next suffix and never reuses a withdrawn one", async () => {
    const { employer, principal, childCases } = await makeEmployerMatterWithNChildren(2);
    assert.deepEqual(childCases.map((c) => c.childIndex), ["A", "B"]);

    // Remove B, then add a new slot - the new slot must be "C", never "B" again.
    await ctrl.removeEmployee({ params: { caseId: String(childCases[1]._id) }, user: STAFF_ACTOR }, mockRes(), (err) => { if (err) throw err; });

    const addRes = mockRes();
    await ctrl.addEmployeeSlot({ params: { principalId: String(principal._id) }, user: { _id: employer._id, role: "client" } }, addRes, (err) => { if (err) throw err; });
    assert.equal(addRes.statusCode, 201);
    assert.ok(addRes.body.childCaseNumber.endsWith("-C"), `expected suffix C, got ${addRes.body.childCaseNumber}`);

    const reloadedPrincipal = await Case.findById(principal._id);
    assert.equal(reloadedPrincipal.childCases.length, 3);
    assert.equal(reloadedPrincipal.childCaseCount, 3);

    const newChild = await Case.findById(addRes.body.childCaseId);
    assert.equal(newChild.caseRole, "employee");
    assert.equal(newChild.caseStructure, "employer_employee");
    assert.ok(newChild.personProfileId, "a paired EmployeeProfile must exist for the new slot");
  });

  await t.test("addEmployeeSlot rejects a non-employer-employee case and a non-owner client", async () => {
    const singleCaseNumber = `TESTS${Date.now()}`;
    const [single] = await Case.create([{ caseId: singleCaseNumber, caseNumber: singleCaseNumber, clientPortalId: singleCaseNumber, clientName: "Solo", clientEmail: `solo${Date.now()}@example.com`, visaType: "O-1", caseType: "immigration", status: "active", caseStructure: "single", caseRole: "single" }]);
    const notEmployerRes = mockRes();
    await ctrl.addEmployeeSlot({ params: { principalId: String(single._id) }, user: STAFF_ACTOR }, notEmployerRes, (err) => { if (err) throw err; });
    assert.equal(notEmployerRes.statusCode, 400);
    assert.equal(notEmployerRes.body.code, "NOT_EMPLOYER_MATTER");

    const { principal } = await makeEmployerMatterWithNChildren(1);
    const strangerRes = mockRes();
    await ctrl.addEmployeeSlot({ params: { principalId: String(principal._id) }, user: { _id: new mongoose.Types.ObjectId(), role: "client" } }, strangerRes, (err) => { if (err) throw err; });
    assert.equal(strangerRes.statusCode, 403);
  });

  await t.test("resendEmployeeInvite rejects an employee who has not been invited yet, and one who already accepted", async () => {
    const { employer, principal, childCases } = await makeEmployerMatterWithNChildren(1);
    const notYetRes = mockRes();
    await ctrl.resendEmployeeInvite({ params: { principalId: String(principal._id) }, body: { childCaseId: String(childCases[0]._id) }, user: { _id: employer._id, role: "client" } }, notYetRes, (err) => { if (err) throw err; });
    assert.equal(notYetRes.statusCode, 409);
    assert.equal(notYetRes.body.code, "NOT_YET_INVITED");

    // Invite, then simulate acceptance (a real password set), then resend must be rejected.
    await ctrl.inviteEmployee({ params: { principalId: String(principal._id) }, body: { childCaseId: String(childCases[0]._id), employeeEmail: `acc${Date.now()}@example.com`, employeeName: "Accepted Employee" }, user: { _id: employer._id, role: "client" } }, mockRes(), (err) => { if (err) throw err; });
    const reloadedChild = await Case.findById(childCases[0]._id);
    await User.updateOne({ _id: reloadedChild.user }, { $set: { password: "hashed-fake-password-value-not-a-real-hash" } });

    const alreadyAcceptedRes = mockRes();
    await ctrl.resendEmployeeInvite({ params: { principalId: String(principal._id) }, body: { childCaseId: String(childCases[0]._id) }, user: { _id: employer._id, role: "client" } }, alreadyAcceptedRes, (err) => { if (err) throw err; });
    assert.equal(alreadyAcceptedRes.statusCode, 409);
    assert.equal(alreadyAcceptedRes.body.code, "ALREADY_ACCEPTED");
  });
});
