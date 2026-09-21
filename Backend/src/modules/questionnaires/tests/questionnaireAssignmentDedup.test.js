const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");
const participantService = require("../../cases/case-participant.service");
const notificationService = require("../../notifications/notification.service");
const workflowService = require("../../workflows/workflow.service");
const questionnaireService = require("../questionnaire.service");

// The confirmed gap: assignQuestionnaire itself has no dedup - it
// unconditionally pushes a new questionnaireReferences entry every call.
// assignQuestionnaireIfNotActive is the shared guard extracted from
// visaFormMapping.service.js's recordConditionalDecision (which needed it
// before this fix existed only as a hand-rolled, untested copy) - used by
// every checklist assignment site so re-running case creation / a
// filing-path change / a re-approved decision can never duplicate a
// questionnaireReferences entry for the same questionnaire.
function fakeCase(overrides = {}) {
  const caseData = {
    _id: new mongoose.Types.ObjectId(),
    questionnaireReferences: [],
    participants: [],
    save: async () => {},
    ...overrides,
  };
  return caseData;
}

const fakeQuestionnaire = { _id: new mongoose.Types.ObjectId(), title: "I-130 Petitioner Checklist", checklistRole: "petitioner", analytics: { assignedCount: 0 }, save: async () => {} };
const fakeUser = { _id: new mongoose.Types.ObjectId(), role: "case_manager" };

test("assignQuestionnaireIfNotActive assigns once, then is a safe no-op on repeat calls", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase();
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  mock.method(caseService, "addAuditEntry", () => {});
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(participantService, "findParticipant", () => null);
  mock.method(participantService, "participantAssignee", () => fakeUser._id);
  mock.method(participantService, "normalizeParticipantRole", (role) => role);
  mock.method(notificationService, "createNotification", async () => {});
  mock.method(workflowService, "triggerWorkflow", async () => {});

  const first = await questionnaireService.assignQuestionnaireIfNotActive(fakeQuestionnaire, { caseData, targetRole: "petitioner" }, fakeUser, {});
  assert.ok(first, "first call should actually assign");
  assert.equal(caseData.questionnaireReferences.length, 1);

  const second = await questionnaireService.assignQuestionnaireIfNotActive(fakeQuestionnaire, { caseData, targetRole: "petitioner" }, fakeUser, {});
  assert.equal(second, null, "second call must be a no-op, not a duplicate assignment");
  assert.equal(caseData.questionnaireReferences.length, 1, "exactly one active questionnaireReferences entry, never two");

  const third = await questionnaireService.assignQuestionnaireIfNotActive(fakeQuestionnaire, { caseData, targetRole: "petitioner" }, fakeUser, {});
  assert.equal(third, null);
  assert.equal(caseData.questionnaireReferences.length, 1);
});

test("assignQuestionnaireIfNotActive re-assigns after the existing reference is marked inactive", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = fakeCase({
    questionnaireReferences: [{ questionnaireId: fakeQuestionnaire._id, active: false }],
  });
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "addTimelineEvent", () => {});
  mock.method(caseService, "addAuditEntry", () => {});
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(participantService, "findParticipant", () => null);
  mock.method(participantService, "participantAssignee", () => fakeUser._id);
  mock.method(participantService, "normalizeParticipantRole", (role) => role);
  mock.method(notificationService, "createNotification", async () => {});
  mock.method(workflowService, "triggerWorkflow", async () => {});

  const result = await questionnaireService.assignQuestionnaireIfNotActive(fakeQuestionnaire, { caseData, targetRole: "petitioner" }, fakeUser, {});
  assert.ok(result, "an inactive reference must not block a fresh assignment");
  assert.equal(caseData.questionnaireReferences.length, 2);
});
