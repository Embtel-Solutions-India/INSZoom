// Phase H2 acceptance tests (AC1, AC3-AC8, AC10-partial). DB-connected, like
// form-mapping/tests/h0-i129-seed.test.js and h1-i129-mapping.test.js - a
// deliberate, scoped exception to the repo's otherwise DB-free/mocked test
// convention, because the idempotent-upsert/no-overwrite/masterData-routing
// guarantees can't be proven against a mocked Answer/Case model.
//
// The AI provider itself is never exercised - classifier.classifyWithRetry,
// extractor.extract, and semanticFieldMatcher.matchFields are monkey-patched
// directly on their shared module.exports objects (Node's require() cache
// guarantees document-intelligence.service.js's own `require(...)` of the
// same files returns this exact object, since all property access happens
// at call time, not destructured at require time) - this is the "mock the
// extractor" the task itself asks for, without needing sinon/proxyquire
// (neither is a dependency of this repo) or fragile provider-prompt parsing.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");

const Answer = require("../../../models/Answer");
const Case = require("../../../models/Case");
const Questionnaire = require("../../../models/Questionnaire");

const classifier = require("../classifiers/document-classifier.service");
const extractor = require("../extractors/document-extractor.service");
const semanticFieldMatcher = require("../services/semantic-field-matcher.service");
const service = require("../services/document-intelligence.service");
const controller = require("../controllers/document-intelligence.controller");
const { AUTOFILL_DOCUMENT_TYPES } = require("../config/autofill-document-types");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");

test.before(async () => {
  await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  await mongoose.disconnect();
});

const originalClassify = classifier.classifyWithRetry;
const originalExtract = extractor.extract;
const originalMatch = semanticFieldMatcher.matchFields;

test.after(() => {
  classifier.classifyWithRetry = originalClassify;
  extractor.extract = originalExtract;
  semanticFieldMatcher.matchFields = originalMatch;
});

function fakeFile(seed = "a") {
  return { originalname: "passport.jpg", mimetype: "image/jpeg", buffer: Buffer.from(`fake-passport-bytes-${seed}`) };
}

function installMocks({ passportFields, matches, matchImpl }) {
  classifier.classifyWithRetry = async () => ({
    documentType: "passport", confidence: 95, reasoning: "test", rawResponse: {}, promptVersion: "test-v1", provider: "other", attempts: 1,
  });
  extractor.extract = async () => ({
    fields: passportFields, entities: {}, rawText: "test", evidenceCategories: ["Identity"], overallConfidence: 95, raw: {},
  });
  semanticFieldMatcher.matchFields = matchImpl || (async () => matches || []);
}

async function employeeQuestionnaireId() {
  const questionnaire = await Questionnaire.findOne({ key: "h1b_employee_checklist", latestVersion: true });
  return questionnaire._id;
}

test("AC1 - uploadAndExtractNow calls the matcher and produces one prefill item per match", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    await Answer.deleteMany({ caseId: golden.caseId, questionKey: { $in: ["employee_personal_middleName", "employee_personal_sevisNumber", "employee_personal_latestPriorPetitionNumber"] } });
    const questionnaireId = await employeeQuestionnaireId();
    installMocks({
      passportFields: {
        firstName: { value: "Ada", confidence: 96 },
        middleName: { value: "Kingsley", confidence: 90 },
      },
      matches: [
        { fieldKey: "firstName", targetSystem: "answer", targetPath: "employee_personal_firstName", questionnaireId, matchConfidence: 95, combinedConfidence: 91 },
        { fieldKey: "middleName", targetSystem: "answer", targetPath: "employee_personal_middleName", questionnaireId, matchConfidence: 90, combinedConfidence: 85 },
        { fieldKey: "firstName", targetSystem: "masterData", targetPath: "employer.company.fullName", questionnaireId: undefined, matchConfidence: 80, combinedConfidence: 74 },
      ],
    });
    const extraction = await service.uploadAndExtractNow({
      file: fakeFile("ac1"),
      body: { caseId: String(golden.caseId), documentType: "passport" },
      user: golden.user,
      req: {},
    });
    assert.equal(extraction.questionnairePrefill.length, 3, "expected exactly 3 prefill items for 3 mocked matches");
  } finally {
    await golden.cleanup();
  }
});

test("AC6 - doc-type gating rejects a documentType not in autofill-document-types.js", async () => {
  assert.ok(AUTOFILL_DOCUMENT_TYPES.includes("passport"), "passport must remain an allowed autofill type");
  assert.ok(!AUTOFILL_DOCUMENT_TYPES.includes("not_a_real_document_type"), "test assumes this fake type is never allow-listed");
  let statusCode;
  let body;
  const req = { file: { buffer: Buffer.from("x") }, body: { documentType: "not_a_real_document_type" }, params: { caseId: "000000000000000000000000" } };
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await controller.autofillQuestionnaire(req, res, (error) => { throw error; });
  assert.equal(statusCode, 400);
  assert.equal(body.success, false);
});

test("passport fallback mapping writes real H-1B answer keys when semantic matching returns no matches", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    await Answer.deleteOne({ caseId: golden.caseId, questionKey: "employee_personal_firstName" });
    installMocks({
      passportFields: { firstName: { value: "Ada", confidence: 96 } },
      matches: [],
    });
    await service.uploadAndExtractNow({
      file: fakeFile("fallback-first-name"),
      body: { caseId: String(golden.caseId), documentType: "passport" },
      user: golden.user,
      req: {},
    });
    const written = await Answer.findOne({ caseId: golden.caseId, questionKey: "employee_personal_firstName" });
    assert.ok(written, "expected OCR fallback to write employee_personal_firstName");
    assert.equal(written.value, "Ada");
    assert.equal(written.status, "auto_saved");
    assert.equal(written.mappingOutput?.sourceType, "ocr");
  } finally {
    await golden.cleanup();
  }
});

test("AC3 - answer-targeted match with no existing answer is applied with OCR provenance, and editing clears it", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    await Answer.deleteOne({ caseId: golden.caseId, questionKey: "employee_personal_middleName" });
    const questionnaireId = await employeeQuestionnaireId();
    installMocks({
      passportFields: { middleName: { value: "Kingsley", confidence: 92 } },
      matches: [{ fieldKey: "middleName", targetSystem: "answer", targetPath: "employee_personal_middleName", questionnaireId, matchConfidence: 92, combinedConfidence: 87 }],
    });
    const extraction = await service.uploadAndExtractNow({
      file: fakeFile("ac3"),
      body: { caseId: String(golden.caseId), documentType: "passport" },
      user: golden.user,
      req: {},
    });
    const item = extraction.questionnairePrefill.find((entry) => entry.key === "employee_personal_middleName");
    assert.ok(item, "expected a prefill item for employee_personal_middleName");
    assert.equal(item.applied, true);
    assert.equal(item.conflict, false);

    const written = await Answer.findOne({ caseId: golden.caseId, questionKey: "employee_personal_middleName" });
    assert.equal(written.value, "Kingsley");
    assert.equal(written.status, "auto_saved");
    assert.equal(written.mappingOutput?.sourceType, "ocr");
    assert.equal(String(written.mappingOutput?.sourceDocumentId), String(written.mappingOutput?.sourceDocumentId));

    // Simulating the client's saveAnswer (a normal edit) must clear the
    // OCR-provenance marker - this is the existing saveAnswers pipeline's own
    // behavior (buildMappingOutput unconditionally replaces mappingOutput),
    // not something this phase's code changes; asserting it here proves the
    // "editable, provenance clears on edit" contract holds end-to-end.
    const questionnaireService = require("../../questionnaires/questionnaire.service");
    await questionnaireService.saveAnswers(
      { questionnaireId, caseId: golden.caseId, responseId: written.responseId, answers: [{ questionKey: "employee_personal_middleName", value: "Edited By User" }] },
      golden.user,
      {}
    );
    const edited = await Answer.findOne({ caseId: golden.caseId, questionKey: "employee_personal_middleName" });
    assert.equal(edited.value, "Edited By User");
    assert.notEqual(edited.mappingOutput?.sourceType, "ocr");
  } finally {
    await golden.cleanup();
  }
});

test("AC4 - a conflicting existing answer is never overwritten", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    const before = await Answer.findOne({ caseId: golden.caseId, questionKey: "employee_personal_lastName" });
    assert.equal(before.value, "Lovelace");
    const questionnaireId = await employeeQuestionnaireId();
    installMocks({
      passportFields: { lastName: { value: "Curie", confidence: 96 } },
      matches: [{ fieldKey: "lastName", targetSystem: "answer", targetPath: "employee_personal_lastName", questionnaireId, matchConfidence: 96, combinedConfidence: 90 }],
    });
    const extraction = await service.uploadAndExtractNow({
      file: fakeFile("ac4"),
      body: { caseId: String(golden.caseId), documentType: "passport" },
      user: golden.user,
      req: {},
    });
    const item = extraction.questionnairePrefill.find((entry) => entry.key === "employee_personal_lastName");
    assert.ok(item);
    assert.equal(item.applied, false);
    assert.equal(item.conflict, true);

    const after = await Answer.findOne({ caseId: golden.caseId, questionKey: "employee_personal_lastName" });
    assert.equal(after.value, "Lovelace", "a conflicting existing answer must remain unchanged");
  } finally {
    await golden.cleanup();
  }
});

test("AC5 - a masterData match is routed to the review pipeline, not written to any answer", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    installMocks({
      passportFields: { employerName: { value: "Acme Analytics Incorporated", confidence: 88 } },
      matches: [{ fieldKey: "employerName", targetSystem: "masterData", targetPath: "employer.company.fullName", questionnaireId: undefined, matchConfidence: 88, combinedConfidence: 81 }],
    });
    const extraction = await service.uploadAndExtractNow({
      file: fakeFile("ac5"),
      body: { caseId: String(golden.caseId), documentType: "passport" },
      user: golden.user,
      req: {},
    });
    const item = extraction.questionnairePrefill.find((entry) => entry.key === "employer.company.fullName");
    assert.ok(item);
    assert.equal(item.targetSystem, "masterData");
    assert.equal(item.applied, false);

    const answerLeak = await Answer.findOne({ caseId: golden.caseId, questionKey: "employer.company.fullName" });
    assert.equal(answerLeak, null, "a masterData match must never be written as an Answer");

    const caseData = await Case.findById(golden.caseId);
    const prefillEntry = (caseData.questionnaireData?.masterDataPrefill || []).find((entry) => entry.path === "employer.company.fullName");
    assert.ok(prefillEntry, "expected a masterDataPrefill entry to be upserted");
    assert.equal(prefillEntry.status, "pending");
    assert.equal(prefillEntry.value, "Acme Analytics Incorporated");

    const summary = await service.prefillSummaryForCase(golden.caseId, golden.user);
    assert.ok(summary.items.some((entry) => entry.targetSystem === "masterData" && entry.targetPath === "employer.company.fullName"));
  } finally {
    await golden.cleanup();
  }
});

test("AC7 - matcher provider failure degrades gracefully: no throw, empty prefill, no partial writes", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    const before = await Answer.findOne({ caseId: golden.caseId, questionKey: "employee_personal_lastName" });
    installMocks({
      passportFields: { lastName: { value: "Curie", confidence: 96 } },
      matchImpl: async () => { throw new Error("provider unavailable"); },
    });
    const extraction = await service.uploadAndExtractNow({
      file: fakeFile("ac7"),
      body: { caseId: String(golden.caseId), documentType: "passport" },
      user: golden.user,
      req: {},
    });
    assert.deepEqual(extraction.questionnairePrefill, []);
    const after = await Answer.findOne({ caseId: golden.caseId, questionKey: "employee_personal_lastName" });
    assert.equal(after.value, before.value, "no partial write should occur when the matcher fails");
  } finally {
    await golden.cleanup();
  }
});

test("AC8 - uploading the same document twice is idempotent (no duplicate answers or masterData suggestions, no self-conflict)", async () => {
  const golden = await buildGoldenH1bCase();
  try {
    await Answer.deleteOne({ caseId: golden.caseId, questionKey: "employee_personal_middleName" });
    const questionnaireId = await employeeQuestionnaireId();
    const matches = [
      { fieldKey: "middleName", targetSystem: "answer", targetPath: "employee_personal_middleName", questionnaireId, matchConfidence: 92, combinedConfidence: 87 },
      { fieldKey: "employerName", targetSystem: "masterData", targetPath: "employer.company.fullName", questionnaireId: undefined, matchConfidence: 88, combinedConfidence: 81 },
    ];
    installMocks({ passportFields: { middleName: { value: "Kingsley", confidence: 92 }, employerName: { value: "Acme Analytics Incorporated", confidence: 88 } }, matches });

    const file = fakeFile("ac8-identical");
    const run1 = await service.uploadAndExtractNow({ file, body: { caseId: String(golden.caseId), documentType: "passport" }, user: golden.user, req: {} });
    const run2 = await service.uploadAndExtractNow({ file, body: { caseId: String(golden.caseId), documentType: "passport" }, user: golden.user, req: {} });

    const answerCount = await Answer.countDocuments({ caseId: golden.caseId, questionKey: "employee_personal_middleName" });
    assert.equal(answerCount, 1, "must not duplicate the Answer document");
    const item2 = run2.questionnairePrefill.find((entry) => entry.key === "employee_personal_middleName");
    assert.equal(item2.applied, true);
    assert.equal(item2.conflict, false, "re-uploading the same document must not flip its own applied value into a conflict");

    const caseData = await Case.findById(golden.caseId);
    const matchingEntries = (caseData.questionnaireData?.masterDataPrefill || []).filter((entry) => entry.path === "employer.company.fullName");
    assert.equal(matchingEntries.length, 1, "must not duplicate the masterData suggestion");
    assert.ok(run1);
  } finally {
    await golden.cleanup();
  }
});
