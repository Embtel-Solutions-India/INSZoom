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
const questionnaireService = require("../../questionnaires/questionnaire.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");

// N-400 (Naturalization) optional add-on process - visa-agnostic, attached
// to an EXISTING case of any visaType via case.controller.js's
// approveN400Process (not through the VisaFormMapping CONDITIONAL/
// recordConditionalDecision mechanism, which requires an exact
// caseData.visaType match). Fully mocked, no real DB connection - mirrors
// questionnaireAssignmentDedup.test.js's own established convention for
// testing this exact class of controller action.

function fakeCase(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    visaType: "EB-2 NIW",
    processingPath: "",
    questionnaireReferences: [],
    participants: [],
    n400Process: undefined,
    save: async () => {},
    ...overrides,
  };
}

const fakeQuestionnaire = { _id: new mongoose.Types.ObjectId(), key: "n400_checklist", title: "Naturalization / U.S. Citizenship Checklist", checklistRole: "client", analytics: { assignedCount: 0 }, save: async () => {} };
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

test("approveN400Process is attachable to ANY visa type - not gated by visaType/processingPath", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase({ visaType: "IR-1", processingPath: "PETITION_ONLY" });
  setupMocks(caseData);
  const req = { params: { id: caseData._id }, user: fakeUser };
  const res = mockRes();
  await caseController.approveN400Process(req, res, (err) => { throw err; });
  assert.equal(res.statusCode ?? 200, 200);
  assert.equal(caseData.n400Process.approved, true);
  assert.equal(caseData.questionnaireReferences.length, 1);
});

test("approving N-400 assigns exactly one active checklist reference, never a duplicate on repeat approval", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  setupMocks(caseData);
  const req = { params: { id: caseData._id }, user: fakeUser };

  await caseController.approveN400Process(req, mockRes(), (err) => { throw err; });
  assert.equal(caseData.questionnaireReferences.length, 1);
  assert.equal(caseData.n400Process.approved, true);
  const firstApprovedAt = caseData.n400Process.approvedAt;

  await caseController.approveN400Process(req, mockRes(), (err) => { throw err; });
  assert.equal(caseData.questionnaireReferences.length, 1, "must not create a second active questionnaireReferences entry");
  assert.equal(caseData.n400Process.approved, true);
  assert.equal(caseData.n400Process.approvedAt, firstApprovedAt, "re-approval must not overwrite the original approval timestamp");

  await caseController.approveN400Process(req, mockRes(), (err) => { throw err; });
  assert.equal(caseData.questionnaireReferences.length, 1);
});

test("approveN400Process provisions the Form N-400 CaseForm through the existing generic USCIS form path when a template is available", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  const template = { formCode: "n-400", title: "Application for Naturalization" };
  const ensureAssignedFormsCalls = [];
  setupMocks(caseData, { template, onEnsureAssignedForms: (args) => ensureAssignedFormsCalls.push(args) });

  const req = { params: { id: caseData._id }, user: fakeUser };
  await caseController.approveN400Process(req, mockRes(), (err) => { throw err; });

  assert.equal(ensureAssignedFormsCalls.length, 1);
  const [, , , options] = ensureAssignedFormsCalls[0];
  assert.equal(options.templates.length, 1);
  assert.equal(options.templates[0].formCode, "n-400");
});

test("existing questionnaire references on the case are preserved when N-400 is approved", async (t) => {
  t.after(() => mock.restoreAll());
  const existingRef = { _id: new mongoose.Types.ObjectId(), questionnaireId: new mongoose.Types.ObjectId(), targetRole: "client", active: true };
  const caseData = fakeCase({ questionnaireReferences: [existingRef] });
  setupMocks(caseData);
  const req = { params: { id: caseData._id }, user: fakeUser };

  await caseController.approveN400Process(req, mockRes(), (err) => { throw err; });

  assert.equal(caseData.questionnaireReferences.length, 2, "existing checklist reference must remain, N-400 only adds a second");
  assert.ok(caseData.questionnaireReferences.includes(existingRef));
});

test("returns 404 when the N-400 checklist template does not exist", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  mock.method(Case, "findById", async () => caseData);
  mock.method(Questionnaire, "findOne", () => ({ sort: async () => null }));
  mock.method(caseService, "canAccessCase", () => true);

  const req = { params: { id: caseData._id }, user: fakeUser };
  const res = mockRes();
  await caseController.approveN400Process(req, res, (err) => { throw err; });
  assert.equal(res.statusCode, 404);
  assert.equal(caseData.n400Process, undefined, "must not mark approved when the template is missing");
});
