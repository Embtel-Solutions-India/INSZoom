const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const Case = require("../../../models/Case");
const Questionnaire = require("../../../models/Questionnaire");
const caseController = require("../case.controller");
const caseService = require("../case.service");
const participantService = require("../case-participant.service");
const notificationService = require("../../notifications/notification.service");
const workflowService = require("../../workflows/workflow.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");

// N-600 (Certificate of Citizenship) optional add-on process - mirrors
// n400ProcessApproval.test.js's own established convention exactly. Fully
// mocked, no real DB connection.

function fakeCase(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    visaType: "EB-1A",
    processingPath: "",
    questionnaireReferences: [],
    participants: [],
    n600Process: undefined,
    save: async () => {},
    ...overrides,
  };
}

const fakeQuestionnaire = { _id: new mongoose.Types.ObjectId(), key: "n600_checklist", title: "Certificate of Citizenship Checklist", checklistRole: "client", analytics: { assignedCount: 0 }, save: async () => {} };
const fakeUser = { _id: new mongoose.Types.ObjectId(), role: "case_manager" };

function mockRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function setupMocks(caseData, { template = null, onEnsureAssignedForms } = {}) {
  mock.method(Case, "findById", async () => caseData);
  mock.method(Questionnaire, "findOne", () => ({ sort: async () => fakeQuestionnaire }));
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  mock.method(caseService, "addAuditEntry", () => {});
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(participantService, "findParticipant", () => null);
  mock.method(participantService, "participantAssignee", () => fakeUser._id);
  mock.method(participantService, "normalizeParticipantRole", (role) => role);
  mock.method(notificationService, "createNotification", async () => {});
  mock.method(workflowService, "triggerWorkflow", async () => {});
  mock.method(uscisFormService, "findLatestActiveTemplate", async () => template);
  mock.method(uscisFormService, "ensureAssignedForms", async (...args) => {
    if (onEnsureAssignedForms) onEnsureAssignedForms(args);
    return [];
  });
}

test("approveN600Process is attachable to ANY visa type - not gated by visaType/processingPath", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase({ visaType: "CR-1", processingPath: "ADJUSTMENT_OF_STATUS" });
  setupMocks(caseData);
  const req = { params: { id: caseData._id }, user: fakeUser };
  const res = mockRes();
  await caseController.approveN600Process(req, res, (err) => { throw err; });
  assert.equal(res.statusCode ?? 200, 200);
  assert.equal(caseData.n600Process.approved, true);
  assert.equal(caseData.questionnaireReferences.length, 1);
});

test("approving N-600 assigns exactly one active checklist reference, never a duplicate on repeat approval", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  setupMocks(caseData);
  const req = { params: { id: caseData._id }, user: fakeUser };

  await caseController.approveN600Process(req, mockRes(), (err) => { throw err; });
  assert.equal(caseData.questionnaireReferences.length, 1);
  const firstApprovedAt = caseData.n600Process.approvedAt;

  await caseController.approveN600Process(req, mockRes(), (err) => { throw err; });
  assert.equal(caseData.questionnaireReferences.length, 1, "must not create a second active questionnaireReferences entry");
  assert.equal(caseData.n600Process.approvedAt, firstApprovedAt);

  await caseController.approveN600Process(req, mockRes(), (err) => { throw err; });
  assert.equal(caseData.questionnaireReferences.length, 1);
});

test("approveN600Process provisions the Form N-600 CaseForm through the existing generic USCIS form path when a template is available", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  const template = { formCode: "n-600", title: "Application for Certificate of Citizenship" };
  const ensureAssignedFormsCalls = [];
  setupMocks(caseData, { template, onEnsureAssignedForms: (args) => ensureAssignedFormsCalls.push(args) });

  const req = { params: { id: caseData._id }, user: fakeUser };
  await caseController.approveN600Process(req, mockRes(), (err) => { throw err; });

  assert.equal(ensureAssignedFormsCalls.length, 1);
  const [, , , options] = ensureAssignedFormsCalls[0];
  assert.equal(options.templates[0].formCode, "n-600");
});

test("existing questionnaire references on the case (e.g. its own visa checklist, or N-400) are preserved when N-600 is approved", async (t) => {
  t.after(() => mock.restoreAll());
  const existingVisaChecklistRef = { _id: new mongoose.Types.ObjectId(), questionnaireId: new mongoose.Types.ObjectId(), targetRole: "client", active: true };
  const existingN400Ref = { _id: new mongoose.Types.ObjectId(), questionnaireId: new mongoose.Types.ObjectId(), targetRole: "client", active: true };
  const caseData = fakeCase({ questionnaireReferences: [existingVisaChecklistRef, existingN400Ref] });
  setupMocks(caseData);
  const req = { params: { id: caseData._id }, user: fakeUser };

  await caseController.approveN600Process(req, mockRes(), (err) => { throw err; });

  assert.equal(caseData.questionnaireReferences.length, 3, "existing checklist references must remain, N-600 only adds one more");
  assert.ok(caseData.questionnaireReferences.includes(existingVisaChecklistRef));
  assert.ok(caseData.questionnaireReferences.includes(existingN400Ref));
});

test("returns 404 when the N-600 checklist template does not exist", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  mock.method(Case, "findById", async () => caseData);
  mock.method(Questionnaire, "findOne", () => ({ sort: async () => null }));
  mock.method(caseService, "canAccessCase", () => true);

  const req = { params: { id: caseData._id }, user: fakeUser };
  const res = mockRes();
  await caseController.approveN600Process(req, res, (err) => { throw err; });
  assert.equal(res.statusCode, 404);
  assert.equal(caseData.n600Process, undefined, "must not mark approved when the template is missing");
});
