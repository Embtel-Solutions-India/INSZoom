const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");

const Answer = require("../../../models/Answer");
const AuditLog = require("../../../models/AuditLog");
const Case = require("../../../models/Case");
const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const caseService = require("../../cases/case.service");
const canonicalSyncService = require("../../canonical/services/CanonicalSyncService");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const questionnaireService = require("../questionnaire.service");

function queryResult(value) {
  const promise = Promise.resolve(value);
  return {
    sort: () => promise,
    populate: () => queryResult(value),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
}

test("saveAnswers synchronizes Case with atomic updates instead of stale case.save()", async (t) => {
  const caseId = new mongoose.Types.ObjectId();
  const questionnaireId = new mongoose.Types.ObjectId();
  const questionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const responseId = "case-questionnaire-user";
  let caseSaveCalled = false;
  const updateCalls = [];

  t.after(() => mock.restoreAll());

  const questionnaire = {
    _id: questionnaireId,
    key: "h1b_employee_checklist",
    title: "H-1B Employee Checklist",
    version: 1,
    settings: { defaultLocale: "en" },
    analytics: { averageCompletionPercent: 0, startedCount: 0 },
    documentRules: [],
    save: mock.fn(async () => questionnaire),
  };
  const question = {
    _id: questionId,
    key: "beneficiary_first_name",
    label: "First name",
    type: "text",
    required: true,
    validationRules: [],
    mapping: { masterDataPath: "beneficiary.firstName", canonicalPath: "beneficiary.firstName" },
  };
  const caseData = {
    _id: caseId,
    user: userId,
    questionnaireData: { masterData: { beneficiary: { lastName: "Existing" } } },
    journeyProgress: { metrics: {} },
    questionnaireReferences: [{
      questionnaireId,
      responseId,
      active: true,
      status: "not_started",
      targetRole: "employee",
    }],
    timeline: [],
    auditHistory: [],
    save: async () => {
      caseSaveCalled = true;
      const error = new Error("stale document");
      error.name = "VersionError";
      throw error;
    },
  };

  mock.method(Questionnaire, "findById", async () => questionnaire);
  mock.method(Case, "findById", async () => caseData);
  mock.method(Case, "updateOne", async (filter, update, options) => {
    updateCalls.push({ filter, update, options });
    return { matchedCount: 1, modifiedCount: 1 };
  });
  mock.method(Question, "find", () => queryResult([question]));
  mock.method(Answer, "find", () => queryResult([]));
  mock.method(Answer, "findOneAndUpdate", async (_filter, update) => ({
    responseId,
    questionKey: question.key,
    question,
    value: update.$set.value,
    status: update.$set.status,
  }));
  mock.method(Answer, "updateMany", async () => ({ modifiedCount: 1 }));
  mock.method(AuditLog, "create", async () => ({}));
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(canonicalSyncService, "syncCase", async () => ({}));
  mock.method(uscisFormService, "markCaseFormsStale", async () => ({}));

  const result = await questionnaireService.saveAnswers({
    questionnaireId,
    caseId,
    responseId,
    answers: [{ questionKey: question.key, value: "Ada" }],
  }, { _id: userId, role: "client" }, { headers: { "idempotency-key": "op-save-1" }, ip: "127.0.0.1" });

  assert.equal(caseSaveCalled, false);
  assert.equal(result.responseId, responseId);
  assert.ok(updateCalls.some((call) => call.update?.$set?.["questionnaireData.masterData.beneficiary.firstName"] === "Ada"));
  assert.ok(updateCalls.some((call) => call.update?.$push?.timeline?.metadata?.operationId === "op-save-1"));
});
