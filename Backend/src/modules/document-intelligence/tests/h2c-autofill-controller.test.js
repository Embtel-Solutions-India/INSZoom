const assert = require("node:assert/strict");
const test = require("node:test");

const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");
const service = require("../services/document-intelligence.service");
const controller = require("../controllers/document-intelligence.controller");

const originalFindById = Case.findById;
const originalCanAccessCase = caseService.canAccessCase;
const originalDetailed = service.uploadAndExtractNowDetailed;

test.afterEach(() => {
  Case.findById = originalFindById;
  caseService.canAccessCase = originalCanAccessCase;
  service.uploadAndExtractNowDetailed = originalDetailed;
});

function req() {
  return {
    file: { originalname: "passport.pdf", mimetype: "application/pdf", buffer: Buffer.from("fake") },
    body: { documentType: "passport" },
    params: { caseId: "64f000000000000000000001" },
    user: { _id: "64f000000000000000000002", role: "client" },
    requestId: "req_test",
  };
}

function res() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test("autofillQuestionnaire returns structured failure when OCR stage fails", async () => {
  Case.findById = async () => ({ _id: "64f000000000000000000001", user: "64f000000000000000000002" });
  caseService.canAccessCase = () => true;
  service.uploadAndExtractNowDetailed = async () => ({
    ok: false,
    status: "failed",
    errorCode: "DOCUMENT_OCR_FAILED",
    message: "Document was uploaded, but OCR/classification/extraction failed.",
    details: { cause: "provider unavailable" },
    document: { _id: "doc1" },
    extraction: { _id: "ext1", status: "failed" },
    stages: [{ name: "ocr_pipeline", status: "failed", message: "provider unavailable" }],
    durationMs: 12,
  });

  const response = res();
  await controller.autofillQuestionnaire(req(), response, (error) => { throw error; });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.success, false);
  assert.equal(response.body.errorCode, "DOCUMENT_OCR_FAILED");
  assert.equal(response.body.details.cause, "provider unavailable");
  assert.equal(response.body.details.stages[0].name, "ocr_pipeline");
});

test("autofillQuestionnaire returns partial success when post-OCR sync fails", async () => {
  Case.findById = async () => ({ _id: "64f000000000000000000001", user: "64f000000000000000000002" });
  caseService.canAccessCase = () => true;
  service.uploadAndExtractNowDetailed = async () => ({
    ok: false,
    status: "completed_with_warnings",
    message: "Document processed with one or more synchronization warnings.",
    document: { _id: "doc1" },
    extraction: { _id: "ext1", status: "completed" },
    prefill: [],
    stages: [
      { name: "ocr_pipeline", status: "completed" },
      { name: "questionnaire_sync", status: "failed", message: "questionnaire unavailable" },
    ],
    durationMs: 34,
  });

  const response = res();
  await controller.autofillQuestionnaire(req(), response, (error) => { throw error; });

  assert.equal(response.statusCode, 207);
  assert.equal(response.body.success, true);
  assert.equal(response.body.status, "completed_with_warnings");
  assert.equal(response.body.warnings.length, 1);
  assert.equal(response.body.warnings[0].name, "questionnaire_sync");
});
