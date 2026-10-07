// Editing the EMPLOYEE checklist on the principal (employer) case reaches every employee case under it - existing, invited, or
// filled in by the employer - without detaching a single answer, duplicating a checklist, or touching other cases/templates.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const Answer = require("../../../models/Answer");
const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const EmployerProfile = require("../../../models/EmployerProfile");
const ctrl = require("../../cases/case.controller");
const questionnaireService = require("../questionnaire.service");
const checklistService = require("../case-checklist.service");

const ADMIN = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const mockRes = () => { const res = { statusCode: 200, body: null }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (p) => { res.body = p; return res; }; return res; };

async function matter() {
  const stamp = Date.now();
  const number = `TESTSYNC${stamp}`;
  const employer = await User.create({ email: `sync-emp-${stamp}@example.com`, name: "Sync Employer", role: "client", isActive: true, caseRole: "principal" });
  const [principal] = await Case.create([{
    caseId: number, caseNumber: number, clientPortalId: number, clientName: "Sync Employer", clientEmail: employer.email,
    visaType: "H-1B", visaCategory: "H-1B", petitionType: "H-1B", petitionSubType: "New H-1B", caseType: "immigration", status: "active",
    user: employer._id, caseStructure: "employer_employee", caseRole: "principal", childCaseCount: 0, dataEntryMode: "fill_self",
    checklistApproval: { required: false },
  }]);
  const [profile] = await EmployerProfile.create([{ principalCaseId: principal._id }]);
  principal.employerProfileId = profile._id;
  await principal.save();
  await User.updateOne({ _id: employer._id }, { $set: { caseIds: [principal._id] } });
  return { employer, principal };
}

async function addEmployee(principal, employer) {
  const res = mockRes();
  await ctrl.addEmployeeSlot({ params: { principalId: String(principal._id) }, user: employer, body: { visaType: "H-1B", petitionSubType: "New H-1B" }, headers: {}, ip: "test" }, res, (e) => { if (e) throw e; });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  // released to the client already (new cases hold checklists as drafts until a case manager approves them)
  await Case.updateOne({ _id: res.body.childCaseId }, { $set: { "checklistApproval.required": false } });
  return res.body.childCaseId;
}

test("an edit to the employee checklist on the principal reaches employee cases, safely", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  await questionnaireService.ensureDefaultVisaTemplates(null, null, {}).catch(() => {});
  const { employer, principal } = await matter();
  const created = { cases: [principal._id], responseIds: new Set() };
  try {
    const childA = await addEmployee(principal, employer);
    const childB = await addEmployee(principal, employer);
    created.cases.push(childA, childB);

    // ── before: the employee case serves the template; save an answer on it ──
    const before = await questionnaireService.getQuestionnaireForCase(childA, employer, "employee");
    assert.ok(before.questionnaire, "the employee case has an employee checklist");
    const firstQuestion = before.questions.find((q) => ["text", "textarea"].includes(q.type));
    assert.ok(firstQuestion, "the employee checklist has a text question");
    const responseBefore = before.responseId;
    created.responseIds.add(responseBefore);
    await questionnaireService.saveAnswers({ questionnaireId: before.questionnaire._id, caseId: childA, targetRole: "employee", responseId: responseBefore, answers: [{ questionKey: firstQuestion.key, value: "kept answer" }] }, employer, { headers: {}, ip: "test" }, "saved");
    const templateId = String(before.questionnaire._id);

    // ── the case manager adds a question to the employee checklist on the PRINCIPAL ──
    const principalList = await questionnaireService.listCaseChecklists(principal._id, ADMIN);
    const employeeChecklist = principalList.checklists.find((item) => item.targetRole === "employee" && !item.staffRequest);
    assert.ok(employeeChecklist, "the principal lists the employee checklist for approval/editing");
    const added = await checklistService.editChecklist(principal._id, { op: "add", checklistId: employeeChecklist.checklistId, patch: { label: "Synced extra question", type: "text" } }, ADMIN, { headers: {}, ip: "test" });
    created.copyId = added.questionnaireId;

    // ── after: BOTH employee cases serve the edited checklist; nothing was detached ──
    for (const childId of [childA, childB]) {
      const after = await questionnaireService.getQuestionnaireForCase(childId, employer, "employee");
      assert.ok(String(after.questionnaire.key).includes("__case_"), "employee case is served the customised copy");
      assert.ok(after.questions.some((q) => q.label === "Synced extra question"), "the added question is on the employee case");
      assert.equal(after.questions.length, before.questions.length + 1, "exactly one question more, nothing lost");
    }
    const afterA = await questionnaireService.getQuestionnaireForCase(childA, employer, "employee");
    assert.equal(afterA.responseId, responseBefore, "same response - answers stay attached");
    assert.ok(afterA.answers.some((a) => a.questionKey === firstQuestion.key && a.value === "kept answer"), "the earlier answer is still there");

    // ── saving after the edit: with a response id AND the derived path (no response id) land on the SAME response ──
    const extra = afterA.questions.find((q) => q.label === "Synced extra question");
    await questionnaireService.saveAnswers({ questionnaireId: afterA.questionnaire._id, caseId: childA, targetRole: "employee", responseId: afterA.responseId, answers: [{ questionKey: extra.key, value: "with id" }] }, employer, { headers: {}, ip: "test" }, "saved");
    await questionnaireService.saveAnswers({ questionnaireId: afterA.questionnaire._id, caseId: childA, targetRole: "employee", answers: [{ questionKey: firstQuestion.key, value: "edited via derived id" }] }, employer, { headers: {}, ip: "test" }, "saved");
    const answersOnResponse = await Answer.find({ responseId: responseBefore }).lean();
    assert.ok(answersOnResponse.some((a) => a.questionKey === extra.key && a.value === "with id"));
    assert.ok(answersOnResponse.some((a) => a.questionKey === firstQuestion.key && a.value === "edited via derived id"), "a save without a response id edits the same response, no orphan");
    assert.equal(await Answer.countDocuments({ questionKey: firstQuestion.key, responseId: { $ne: responseBefore }, caseId: childA }), 0, "no second response was created for this employee");

    // ── no duplicate checklist on the employee case; it reads as customised ──
    const childList = await questionnaireService.listCaseChecklists(childA, ADMIN);
    const employeeEntries = childList.checklists.filter((item) => item.targetRole === "employee" && !item.staffRequest);
    assert.equal(employeeEntries.length, 1, "exactly one employee checklist - no duplicate");
    assert.equal(employeeEntries[0].caseSpecific, true);
    assert.equal(employeeEntries[0].responseId, responseBefore);

    // ── the template and an unrelated case's checklist are untouched ──
    assert.equal(await Question.countDocuments({ questionnaire: templateId, label: "Synced extra question" }), 0, "the shared template never changes");

    // ── editing ONE employee forks only that employee; the sibling keeps the shared edit ──
    const childEntry = employeeEntries[0];
    await checklistService.editChecklist(childA, { op: "remove", checklistId: childEntry.checklistId, questionKey: extra.key }, ADMIN, { headers: {}, ip: "test" });
    const a2 = await questionnaireService.getQuestionnaireForCase(childA, employer, "employee");
    const b2 = await questionnaireService.getQuestionnaireForCase(childB, employer, "employee");
    assert.ok(!a2.questions.some((q) => q.key === extra.key), "removed for this employee only");
    assert.ok(b2.questions.some((q) => q.key === extra.key), "the other employee still has the question the principal added");
    assert.ok(String(a2.questionnaire.key).endsWith(`__case_${childA}`), "this employee now has a copy of their own");
    assert.equal(a2.responseId, responseBefore, "still the same response after the per-employee fork");
    assert.ok((await Answer.find({ responseId: responseBefore }).lean()).some((a) => a.questionKey === extra.key), "a removed question's answer stays on record");

    // ── removing on the principal propagates to employees still on the shared copy, non-destructively ──
    await checklistService.editChecklist(principal._id, { op: "remove", checklistId: employeeChecklist.checklistId, questionKey: extra.key }, ADMIN, { headers: {}, ip: "test" });
    const b3 = await questionnaireService.getQuestionnaireForCase(childB, employer, "employee");
    assert.ok(!b3.questions.some((q) => q.key === extra.key), "removal on the principal reaches the other employee");

    // ── approving still works and cascades ──
    const draftPrincipal = await Case.findByIdAndUpdate(principal._id, { $set: { "checklistApproval.required": true, "checklistApproval.approvals": [] } }, { new: true });
    assert.equal(draftPrincipal.checklistApproval.required, true);
    const approved = await checklistService.approveChecklists(principal._id, { checklistIds: [employeeChecklist.checklistId] }, ADMIN, { headers: {}, ip: "test" });
    assert.ok(approved.approved.length >= 1, "approving the employee checklist still works after customisation");
  } finally {
    const copies = await Questionnaire.find({ key: { $regex: `__case_(${created.cases.join("|")})$` } }).select("_id").lean();
    await Question.deleteMany({ questionnaire: { $in: copies.map((c) => c._id) } });
    await Questionnaire.deleteMany({ _id: { $in: copies.map((c) => c._id) } });
    await Answer.deleteMany({ responseId: { $in: [...created.responseIds] } });
    await Case.deleteMany({ _id: { $in: created.cases } });
    await EmployerProfile.deleteMany({ principalCaseId: principal._id });
    await User.deleteMany({ _id: employer._id });
  }
});
