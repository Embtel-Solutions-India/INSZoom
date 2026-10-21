// An employer matter's employee (child) cases carry the SAME checklists as the principal (the petitioner's and the employee one), held on two case ids.
// They are approved, edited and removed on the PRINCIPAL only: asked for on a child they are carried out on the principal, and every child adopts the result.
// Runs on the local test database (never the real one); the notification sender is faked.
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
const REQ = { headers: {}, ip: "test" };
const mockRes = () => { const res = { statusCode: 200, body: null }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (p) => { res.body = p; return res; }; return res; };

async function matter() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const number = `TESTSHARE${stamp}`;
  const employer = await User.create({ email: `share-emp-${stamp}@example.com`, name: "Share Employer", role: "client", isActive: true, caseRole: "principal" });
  const [principal] = await Case.create([{
    caseId: number, caseNumber: number, clientPortalId: number, clientName: "Share Employer", clientEmail: employer.email,
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
  return res.body.childCaseId;
}

// every case of the matter held back for approval, as a new case is
const gate = (ids) => Case.updateMany({ _id: { $in: ids } }, { $set: { "checklistApproval.required": true, "checklistApproval.approvals": [], "checklistApproval.removed": [] } });
const approvalIds = async (id) => ((await Case.findById(id).select("checklistApproval").lean()).checklistApproval?.approvals || []).map((a) => a.checklistId).sort();
const removedIds = async (id) => ((await Case.findById(id).select("checklistApproval").lean()).checklistApproval?.removed || []).map((a) => a.checklistId).sort();

async function withMatter(t, run) {
  t.after(disconnectTestDB);
  await connectTestDB();
  await questionnaireService.ensureDefaultVisaTemplates(null, null, {}).catch(() => {});
  const { employer, principal } = await matter();
  const cases = [principal._id];
  const notified = [];
  const realNotify = questionnaireService.notifyChecklistAssigned;
  questionnaireService.notifyChecklistAssigned = async (questionnaire, caseDoc) => { notified.push({ caseId: String(caseDoc._id), role: questionnaire.checklistRole }); };
  try {
    const childA = await addEmployee(principal, employer);
    const childB = await addEmployee(principal, employer);
    cases.push(childA, childB);
    const list = await questionnaireService.listCaseChecklists(principal._id, ADMIN);
    const petitioner = list.checklists.find((c) => c.targetRole === "employer" && !c.staffRequest);
    const employee = list.checklists.find((c) => c.targetRole === "employee" && !c.staffRequest);
    assert.ok(petitioner && employee, "the principal lists the petitioner and the employee checklist");
    await run({ employer, principal, childA, childB, petitionerId: petitioner.checklistId, employeeId: employee.checklistId, notified });
  } finally {
    questionnaireService.notifyChecklistAssigned = realNotify;
    const copies = await Questionnaire.find({ key: { $regex: `__case_(${cases.join("|")})$` } }).select("_id").lean();
    await Question.deleteMany({ questionnaire: { $in: copies.map((c) => c._id) } });
    await Questionnaire.deleteMany({ _id: { $in: copies.map((c) => c._id) } });
    await Answer.deleteMany({ caseId: { $in: cases } });
    await Case.deleteMany({ _id: { $in: cases } });
    await EmployerProfile.deleteMany({ principalCaseId: principal._id });
    await User.deleteMany({ _id: employer._id });
  }
}

test("approving on a child case approves on the principal and on every child; employer-side checklists are not sent again", async (t) => {
  await withMatter(t, async ({ principal, childA, childB, petitionerId, employeeId, notified }) => {
    await gate([principal._id, childA, childB]);
    const result = await checklistService.approveChecklists(childA, { checklistIds: [petitionerId, employeeId] }, ADMIN, REQ);
    assert.ok(result.approved.length >= 2);
    for (const id of [principal._id, childA, childB]) assert.deepEqual(await approvalIds(id), [petitionerId, employeeId].sort(), `approved on ${id}`);
    // the employee checklist goes to each employee's client; the petitioner's goes to the employer on the principal only - never again per child
    const childIds = [String(childA), String(childB)];
    assert.ok(notified.some((n) => n.caseId === String(childA) && n.role === "employee"));
    assert.ok(notified.some((n) => n.caseId === String(childB) && n.role === "employee"));
    assert.ok(!notified.some((n) => childIds.includes(n.caseId) && n.role === "employer"), "no repeat employer notification per child");
    assert.ok(notified.some((n) => n.caseId === String(principal._id) && n.role === "employer"), "the employer is told once, on the principal");
    // idempotent: doing it again from the other child changes nothing
    const again = await checklistService.approveChecklists(childB, { checklistIds: [petitionerId, employeeId] }, ADMIN, REQ);
    assert.equal(again.approved.length, 0);
    for (const id of [principal._id, childA, childB]) assert.equal((await approvalIds(id)).length, 2, "no duplicate approval");
  });
});

test("approving everything from a child works the same way", async (t) => {
  await withMatter(t, async ({ principal, childA, childB, petitionerId, employeeId }) => {
    await gate([principal._id, childA, childB]);
    await checklistService.approveChecklists(childA, { all: true }, ADMIN, REQ);
    for (const id of [principal._id, childA, childB]) {
      const ids = await approvalIds(id);
      assert.ok(ids.includes(petitionerId) && ids.includes(employeeId), `both checklists approved on ${id}`);
    }
  });
});

test("approving on the principal is adopted by every child, petitioner checklist included", async (t) => {
  await withMatter(t, async ({ principal, childA, childB, petitionerId, employeeId }) => {
    await gate([principal._id, childA, childB]);
    await checklistService.approveChecklists(principal._id, { checklistIds: [petitionerId] }, ADMIN, REQ);
    assert.deepEqual(await approvalIds(principal._id), [petitionerId]);
    assert.deepEqual(await approvalIds(childA), [petitionerId]);
    assert.deepEqual(await approvalIds(childB), [petitionerId]);
    assert.ok(!(await approvalIds(childA)).includes(employeeId), "only what was approved is adopted");
  });
});

test("removing on a child removes the shared checklist on the principal and on every child", async (t) => {
  await withMatter(t, async ({ principal, childA, childB, petitionerId, employeeId }) => {
    await gate([principal._id, childA, childB]);
    await checklistService.removeChecklist(childA, { checklistId: petitionerId, reason: "not needed" }, ADMIN, REQ);
    for (const id of [principal._id, childA, childB]) assert.deepEqual(await removedIds(id), [petitionerId], `removed on ${id}`);
    for (const id of [principal._id, childA, childB]) {
      const left = (await questionnaireService.resolveCaseQuestionnaires(id)).map((e) => `${e.questionnaire.key.split("__case_")[0]}|${e.targetRole || e.questionnaire.checklistRole}`);
      assert.ok(!left.includes(petitionerId), `hidden on ${id}`);
    }
    await checklistService.removeChecklist(childB, { checklistId: employeeId }, ADMIN, REQ);
    for (const id of [principal._id, childA, childB]) assert.ok((await removedIds(id)).includes(employeeId));
  });
});

test("editing the petitioner checklist from a child edits the principal's copy, which every child is served", async (t) => {
  await withMatter(t, async ({ principal, childA, childB, petitionerId }) => {
    const entry = (await questionnaireService.listCaseChecklists(childA, ADMIN)).checklists.find((c) => c.checklistId === petitionerId);
    const question = (await Question.find({ questionnaire: entry.questionnaireId, active: { $ne: false } }).sort({ order: 1 }).lean())[0];
    assert.ok(question, "the checklist has a question");
    await checklistService.editChecklist(childA, { op: "remove", checklistId: petitionerId, questionKey: question.key }, ADMIN, REQ);
    assert.equal(await Questionnaire.countDocuments({ key: { $regex: `__case_(${childA}|${childB})$` } }), 0, "no private copy on any child");
    const copy = await Questionnaire.findOne({ key: { $regex: `__case_${principal._id}$` } }).lean();
    assert.ok(copy, "the principal holds the customised copy");
    assert.equal((await Question.findOne({ questionnaire: copy._id, key: question.key }).lean()).active, false);
    for (const id of [principal._id, childA, childB]) {
      const served = (await questionnaireService.resolveCaseQuestionnaires(id)).find((e) => `${e.questionnaire.key.split("__case_")[0]}|${e.targetRole || e.questionnaire.checklistRole}` === petitionerId);
      assert.ok(String(served.questionnaire.key).endsWith(`__case_${principal._id}`), `${id} is served the principal's copy`);
    }
  });
});

test("a user who cannot reach the principal still works on the child alone, as before", async (t) => {
  await withMatter(t, async ({ principal, childA, childB, petitionerId, employeeId }) => {
    await gate([principal._id, childA, childB]);
    // an attorney granted access to this one child case only (case access for attorneys is per granted case)
    const manager = { _id: new mongoose.Types.ObjectId(), role: "attorney" };
    await Case.updateOne({ _id: childA }, { $push: { attorneyAccess: { attorneyId: manager._id, status: "active", assignedBy: ADMIN._id } } });
    await checklistService.approveChecklists(childA, { checklistIds: [petitionerId, employeeId] }, manager, REQ);
    assert.deepEqual(await approvalIds(childA), [petitionerId, employeeId].sort(), "approved on the child they can reach");
    assert.deepEqual(await approvalIds(principal._id), [], "the principal they cannot reach is untouched");
    assert.deepEqual(await approvalIds(childB), [], "and so is the sibling");
  });
});
