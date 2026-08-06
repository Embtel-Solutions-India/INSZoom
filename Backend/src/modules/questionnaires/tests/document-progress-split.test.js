const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const Question = require("../../../models/Question");
const AuditLog = require("../../../models/AuditLog");
const questionnaireService = require("../questionnaire.service");

// Same chainable-query mock shape used by questionnaire-concurrency.test.js
// for Question.find(...).sort(...).
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

test("calculateDetailedProgress scoped to file-type questions only reports file-type completion", async (t) => {
  t.after(() => mock.restoreAll());
  const questionnaire = { _id: new mongoose.Types.ObjectId(), title: "H-1B Employee Checklist", sections: [] };
  const questions = [
    { key: "passport_upload", label: "Passport copy", type: "file", required: true },
    { key: "date_of_birth", label: "Date of Birth", type: "text", required: true },
    { key: "resume_upload", label: "Resume", type: "file", required: true },
  ];
  mock.method(Question, "find", () => queryResult(questions));
  const answerMap = {}; // nothing answered

  const combined = await questionnaireService.calculateDetailedProgress(questionnaire, answerMap, { role: "client" });
  assert.equal(combined.totalRequired, 3, "combined progress must still cover every required question, file and field alike");
  assert.ok(combined.missingRequired.some((q) => q.type === "text"), "combined progress includes field questions");

  const fileOnly = questions.filter((q) => q.type === "file");
  const documentProgress = await questionnaireService.calculateDetailedProgress(questionnaire, answerMap, { role: "client" }, fileOnly);
  assert.equal(documentProgress.totalRequired, 2, "file-scoped progress must only count the file-type questions");
  assert.ok(
    documentProgress.missingRequired.every((q) => q.type === "file"),
    "file-scoped missingRequired must never include a non-file question - this is the exact list CRMCaseDetail.jsx's " +
      "'Documents Pending'/'Missing Documents' UI renders, so a field question leaking in here reproduces the reported bug"
  );
  assert.deepEqual(documentProgress.missingRequired.map((q) => q.key).sort(), ["passport_upload", "resume_upload"]);
});

test("generateDocumentRequests does not create a duplicate when a registry document already occupies the same documentType under a different name", async (t) => {
  t.after(() => mock.restoreAll());
  const questionnaire = { _id: new mongoose.Types.ObjectId(), title: "H-1B Employee Checklist" };
  const caseData = {
    // Simulates a document already added by assignStandardDocuments under its
    // own human-readable name, with documentType "passport".
    checklistItems: [{ name: "Copy of the passport", documentType: "passport", required: true }],
    documentChecklist: [{ name: "Copy of the passport", documentType: "passport", required: true }],
    save: async () => {},
  };
  const question = { key: "passport", label: "Passport", required: true, evidenceCategory: "passport" };
  const answerMap = { passport: "yes" };

  const created = await questionnaireService.generateDocumentRequests({
    questionnaire,
    caseData,
    answerMap,
    questions: [question],
    user: { _id: new mongoose.Types.ObjectId() },
    req: {},
    persist: true,
  });

  assert.equal(created.length, 0, "a documentType collision must block the request even though the name differs");
  assert.equal(caseData.checklistItems.length, 1, "no duplicate row should have been pushed");
  assert.equal(caseData.documentChecklist.length, 1);
});

test("generateDocumentRequests still creates a request when neither name nor documentType collide", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(AuditLog, "create", async () => ({}));
  const questionnaire = { _id: new mongoose.Types.ObjectId(), title: "H-1B Employee Checklist" };
  const caseData = { checklistItems: [], documentChecklist: [], save: async () => {} };
  const question = { key: "marriage_certificate", label: "Marriage Certificate", required: true, evidenceCategory: "marriage_certificate" };
  const answerMap = { marriage_certificate: "yes" };

  const created = await questionnaireService.generateDocumentRequests({
    questionnaire,
    caseData,
    answerMap,
    questions: [question],
    user: { _id: new mongoose.Types.ObjectId() },
    req: {},
    persist: true,
  });

  assert.equal(created.length, 1);
  assert.equal(caseData.checklistItems.length, 1);
  assert.equal(caseData.documentChecklist.length, 1);
  assert.equal(caseData.checklistItems[0].documentType, "marriage_certificate");
});
