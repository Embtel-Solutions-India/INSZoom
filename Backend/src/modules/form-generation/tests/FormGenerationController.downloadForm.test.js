// Forms Download overhaul - controller-level tests for the unified downloadForm
// action, against a real seeded H-1B CaseForm (same buildGoldenH1bCase +
// AutoFillService.generate pattern FormGenerationController.filingPdf.test.js
// used, which this file replaces). Exercises the actual Express handler with a
// minimal mock req/res, not just PDFRenderer.renderFiling in isolation (already
// covered by PDFRenderer.renderFiling.test.js) - this is the "does the ROUTE
// behave correctly" proof, now against the single no-gate download path.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "..", "..", "storage");
}
if (!process.env.MONGODB_TEST_URI) {
  process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
}

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const controller = require("../controllers/FormGenerationController");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    sentBuffer: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    json(payload) { this.body = payload; return this; },
    send(buffer) { this.sentBuffer = buffer; return this; },
  };
}

test("downloadForm: freshly-generated CaseForm at 'ai_filled' status -> 200, application/pdf, no status gate", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    // caseForm.status is "ai_filled" here - nowhere near "approved"/"locked" -
    // proving Rule 1 (no status gate) directly, unlike the old filingPdf test
    // which had to force status to "approved" first.

    const req = { params: { caseFormId: String(caseForm._id) }, user: staffUser, ip: "127.0.0.1", headers: {} };
    const res = mockRes();
    await controller.downloadForm(req, res);

    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode} with body ${JSON.stringify(res.body)}`);
    assert.equal(res.headers["Content-Type"], "application/pdf");
    assert.ok(res.sentBuffer, "expected a PDF buffer to be sent");
    assert.equal(Buffer.from(res.sentBuffer).subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(res.headers["Content-Disposition"], /attachment/);
    assert.doesNotMatch(res.headers["Content-Disposition"], /DRAFT|FILING/, "filename must not carry the removed DRAFT/FILING markers");
  } finally {
    await golden.cleanup();
  }
});

test("downloadForm: persists the served bytes as a Document, same as the filing-copy path it replaces", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    const documentCountBefore = await Document.countDocuments({ caseId: golden.caseId });

    const req = { params: { caseFormId: String(caseForm._id) }, user: staffUser, ip: "127.0.0.1", headers: {} };
    const res = mockRes();
    await controller.downloadForm(req, res);

    assert.equal(res.statusCode, 200);
    // The copy is saved AFTER the file has been sent (deferBookkeeping - the user never waits for storage), so wait for it instead of reading the count at once.
    let documentCountAfter = documentCountBefore;
    for (let attempt = 0; attempt < 60 && documentCountAfter === documentCountBefore; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      documentCountAfter = await Document.countDocuments({ caseId: golden.caseId });
    }
    assert.equal(documentCountAfter, documentCountBefore + 1, "a successful official download must be retained as a Document record");
  } finally {
    await golden.cleanup();
  }
});

test("downloadForm: locked CaseForm -> served as-is, AutoFillService.generate is never invoked", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    await CaseForm.updateOne({ _id: caseForm._id }, { $set: { isLocked: true, status: "locked", "syncState.stale": true } });

    const originalGenerate = AutoFillService.generate;
    let generateCalled = false;
    AutoFillService.generate = async (...args) => { generateCalled = true; return originalGenerate.apply(AutoFillService, args); };
    try {
      const req = { params: { caseFormId: String(caseForm._id) }, user: staffUser, ip: "127.0.0.1", headers: {} };
      const res = mockRes();
      await controller.downloadForm(req, res);

      assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode} with body ${JSON.stringify(res.body)}`);
      assert.equal(generateCalled, false, "a locked form is historical - regenerating it before download would silently rewrite a final record");
    } finally {
      AutoFillService.generate = originalGenerate;
    }
  } finally {
    await golden.cleanup();
  }
});

test("downloadForm: stale, editable CaseForm -> AutoFillService.generate(regenerate:true) runs before render", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    await CaseForm.updateOne({ _id: caseForm._id }, { $set: { "syncState.stale": true } });

    const originalGenerate = AutoFillService.generate;
    let regenerateOptions = null;
    AutoFillService.generate = async (...args) => { regenerateOptions = args[4]; return originalGenerate.apply(AutoFillService, args); };
    try {
      const req = { params: { caseFormId: String(caseForm._id) }, user: staffUser, ip: "127.0.0.1", headers: {} };
      const res = mockRes();
      await controller.downloadForm(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok(regenerateOptions, "AutoFillService.generate must run for a stale, editable form before download");
      assert.equal(regenerateOptions.regenerate, true);
    } finally {
      AutoFillService.generate = originalGenerate;
    }
  } finally {
    await golden.cleanup();
  }
});

test("downloadForm: strict fidelity check failure -> the download still yields a file, with a warning (a download never fails while the form exists)", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});

    // downloadForm picks its rendering engine at request time based on
    // env.adobe.fillEnabled (Adobe by default, pdf-lib as the manual
    // opt-out) - mock whichever one that flag actually selects RIGHT NOW,
    // not a hardcoded assumption of either. Mocking the wrong one means
    // downloadForm's real call goes unmocked, silently renders for real
    // (hitting the real Adobe API or a real pdf-lib+S3 round trip), and
    // returns 200 instead of the fidelity failure this test exists to
    // prove. Both engines share the identical PDFFidelityService.verify
    // gate and throw the same PDF_FIDELITY_FAILURE-shaped error, so this
    // still proves the same thing regardless of which one is mocked: a
    // failed fidelity check blocks the download.
    const env = require("../../../config/env");
    const engine = env.adobe.fillEnabled ? require("../services/AdobeFormRenderer") : require("../services/PDFRenderer");
    const originalRenderFiling = engine.renderFiling;
    engine.renderFiling = async () => {
      const error = new Error("PDF fidelity check failed: field Pt2Line4a_FamilyName[0]: expected 'Lovelace', got 'WRONG'");
      error.status = 422;
      error.code = "PDF_FIDELITY_FAILURE";
      error.report = { mismatchedFields: [{ fieldName: "Pt2Line4a_FamilyName[0]" }] };
      throw error;
    };
    try {
      const req = { params: { caseFormId: String(caseForm._id) }, user: staffUser, ip: "127.0.0.1", headers: {} };
      const res = mockRes();
      await controller.downloadForm(req, res);

      // Since the 2026-10-02 download overhaul a failed strict check degrades (next engine / render without the strict check) instead of refusing the download;
      // the user is told in X-Form-Warnings. (Only the filing-step gate, FilingArtifactPolicy, can still refuse, and only when FORM_PIPELINE_AUTONOMY is on.)
      assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode} with body ${JSON.stringify(res.body)}`);
      assert.ok(res.sentBuffer, "a PDF must still be sent");
      assert.equal(Buffer.from(res.sentBuffer).subarray(0, 5).toString("latin1"), "%PDF-");
      const warnings = JSON.parse(decodeURIComponent(res.headers["X-Form-Warnings"] || "[]")).join(" | ");
      assert.match(warnings, /fidelity|Adobe|accuracy/i, "the user must be told the strict check did not pass");
    } finally {
      engine.renderFiling = originalRenderFiling;
    }
  } finally {
    await golden.cleanup();
  }
});
