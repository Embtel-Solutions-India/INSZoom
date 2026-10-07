// Data continuity across workflow switches (test database). Whatever has been entered for an employee must survive a
// switch in BOTH directions and be visible to whoever works on the file next - employer, employee and (via the same
// records) the Admin portal:
//   employer fills some  -> invites the employee -> the employee sees it, edits it, adds the rest
//   employee fills some  -> employer takes it back -> the employer sees everything the employee entered
const assert = require("node:assert/strict");
const test = require("node:test");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const Answer = require("../../../models/Answer");
const EmployeeProfile = require("../../../models/EmployeeProfile");
const EmployerProfile = require("../../../models/EmployerProfile");
const CaseNumberService = require("../../../services/CaseNumberService");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const ctrl = require("../case.controller");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
const next = (error) => { if (error) throw error; };
const REQ = { headers: {}, ip: "test" };

async function matter() {
  const stamp = Date.now();
  const principalNumber = `TESTC${stamp}`;
  const employer = await User.create({ email: `employer${stamp}@example.com`, name: "ACME Employer", role: "client", isActive: true, caseRole: "principal" });
  const [principal] = await Case.create([{
    caseId: principalNumber, caseNumber: principalNumber, clientPortalId: principalNumber, clientName: "ACME Employer", clientEmail: employer.email,
    visaType: "E-3", caseType: "immigration", status: "active", user: employer._id, caseStructure: "employer_employee", caseRole: "principal",
    childCaseCount: 1, dataEntryMode: "fill_self", checklistApproval: { required: false },
  }]);
  const [employerProfile] = await EmployerProfile.create([{ principalCaseId: principal._id }]);
  const number = CaseNumberService.childCaseNumber(principalNumber, 0);
  const [child] = await Case.create([{
    caseId: number, caseNumber: number, clientPortalId: number, clientName: "", clientEmail: "", visaType: "E-3", caseType: "immigration",
    status: "pending_assignment", user: employer._id, parentCase: principal._id, caseStructure: "employer_employee", caseRole: "employee",
    childIndex: CaseNumberService.indexToSuffix(0), employerProfileId: employerProfile._id, dataEntryMode: "fill_self", checklistApproval: { required: false },
  }]);
  await EmployeeProfile.create([{ caseId: child._id, principalCaseId: principal._id, profileType: "employee" }]);
  await User.updateOne({ _id: employer._id }, { $set: { caseIds: [principal._id, child._id] } });
  return { employer, principal, child };
}

const switchMode = async (principal, child, user, body) => {
  const res = mockRes();
  await ctrl.setEmployeeDataEntryMode({ params: { principalId: String(principal._id), childCaseId: String(child._id) }, user, body, headers: {}, ip: "test" }, res, next);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res;
};

const load = (child, user) => questionnaireService.getQuestionnaireForCase(child._id, user, "employee");
const answerOf = (state, key) => (state.answers || []).find((answer) => answer.question?.key === key || answer.questionKey === key)?.value;

test("no data is lost when an employee's workflow is switched in either direction", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const { employer, principal, child } = await matter();
  const email = `emp${Date.now()}@example.com`;
  let invitedId;
  try {
    // --- the employer fills part of the employee's checklist first ---
    let state = await load(child, employer);
    const questions = (state.fieldQuestions || state.questions || []).filter((q) => ["text", "textarea"].includes(q.type));
    assert.ok(questions.length >= 3, "the employee checklist needs at least three text questions for this test");
    const [q1, q2, q3] = questions;
    await questionnaireService.saveAnswers({ questionnaireId: state.questionnaire._id, caseId: child._id, responseId: state.responseId, answers: [{ questionKey: q1.key, value: "FilledByEmployer" }] }, employer, REQ);

    // --- employer changes their mind: invite the employee ---
    await switchMode(principal, child, employer, { mode: "invite", employeeEmail: email, employeeName: "Jane Doe" });
    const employee = await User.findOne({ email });
    invitedId = employee._id;
    state = await load(child, employee);
    assert.equal(answerOf(state, q1.key), "FilledByEmployer", "the employee sees what the employer already entered");

    // --- the employee edits that value and fills more, but not everything ---
    await questionnaireService.saveAnswers({ questionnaireId: state.questionnaire._id, caseId: child._id, responseId: state.responseId, answers: [{ questionKey: q1.key, value: "EditedByEmployee" }, { questionKey: q2.key, value: "FilledByEmployee" }] }, employee, REQ);

    // --- employer takes it back: sees the employee's partial work, nothing vanished ---
    const owner = await User.findById(employer._id);
    await switchMode(principal, child, owner, { mode: "fill_self" });
    state = await load(child, owner);
    assert.equal(answerOf(state, q1.key), "EditedByEmployee");
    assert.equal(answerOf(state, q2.key), "FilledByEmployee");

    // --- employer completes the rest; a later invite shows the full picture to the employee again ---
    await questionnaireService.saveAnswers({ questionnaireId: state.questionnaire._id, caseId: child._id, responseId: state.responseId, answers: [{ questionKey: q3.key, value: "FilledByEmployerAgain" }] }, owner, REQ);
    await switchMode(principal, child, owner, { mode: "invite", employeeEmail: email, employeeName: "Jane Doe" });
    state = await load(child, await User.findById(invitedId));
    assert.equal(answerOf(state, q1.key), "EditedByEmployee");
    assert.equal(answerOf(state, q2.key), "FilledByEmployee");
    assert.equal(answerOf(state, q3.key), "FilledByEmployerAgain");

    // the Admin portal (staff read of the same file) sees the same, complete response
    const adminView = await load(child, { _id: "000000000000000000000001", role: "admin" });
    assert.equal(adminView.responseId, state.responseId);
    assert.equal(answerOf(adminView, q3.key), "FilledByEmployerAgain");

    // one response record set for the whole journey - never split per account
    assert.equal(new Set((await Answer.find({ caseId: child._id }).select("responseId").lean()).map((a) => a.responseId)).size, 1);
  } finally {
    await Answer.deleteMany({ caseId: child._id });
    await Case.deleteMany({ _id: { $in: [principal._id, child._id] } });
    await EmployeeProfile.deleteMany({ principalCaseId: principal._id });
    await EmployerProfile.deleteMany({ principalCaseId: principal._id });
    await User.deleteMany({ _id: { $in: [employer._id, ...(invitedId ? [invitedId] : [])] } });
  }
});
