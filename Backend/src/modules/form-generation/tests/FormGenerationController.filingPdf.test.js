// Phase 5 (§I.3) - controller-level tests for the new filingPdf action, against a real seeded
// H-1B CaseForm (same buildGoldenH1bCase + AutoFillService.generate pattern already proven by
// h3-pdf-generation.test.js). Exercises the actual Express handler with a minimal mock
// req/res, not just PDFRenderer.renderFiling in isolation (already covered by
// PDFRenderer.renderFiling.test.js) - this is the "does the ROUTE behave correctly" proof.
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

test("filingPdf: approved CaseForm -> 200, application/pdf, buffer starts with %PDF-", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    await CaseForm.updateOne({ _id: caseForm._id }, { $set: { status: "approved" } });

    const req = { params: { caseFormId: String(caseForm._id) }, user: staffUser, ip: "127.0.0.1", headers: {} };
    const res = mockRes();
    await controller.filingPdf(req, res);

    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode} with body ${JSON.stringify(res.body)}`);
    assert.equal(res.headers["Content-Type"], "application/pdf");
    assert.ok(res.sentBuffer, "expected a PDF buffer to be sent");
    assert.equal(Buffer.from(res.sentBuffer).subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(res.headers["Content-Disposition"], /FILING/);
  } finally {
    await golden.cleanup();
  }
});

test("filingPdf: non-approved status -> 422 with the correct message, no buffer sent", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    // caseForm.status is "ai_filled" at this point (AutoFillService.generate's own default) - not
    // in the filing-copy allowed list.

    const req = { params: { caseFormId: String(caseForm._id) }, user: golden.user, ip: "127.0.0.1", headers: {} };
    const res = mockRes();
    await controller.filingPdf(req, res);

    assert.equal(res.statusCode, 422);
    assert.match(res.body.message, /must be approved/);
    assert.equal(res.sentBuffer, null, "no PDF buffer must be sent on a status-gate rejection");
  } finally {
    await golden.cleanup();
  }
});

test("filingPdf: fidelity check failure -> 422 with the fidelity error message, no buffer sent, not stored", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    await CaseForm.updateOne({ _id: caseForm._id }, { $set: { status: "approved" } });

    const PDFRenderer = require("../services/PDFRenderer");
    const originalRenderFiling = PDFRenderer.renderFiling;
    PDFRenderer.renderFiling = async () => {
      const error = new Error("PDF fidelity check failed: field Pt2Line4a_FamilyName[0]: expected 'Lovelace', got 'WRONG'");
      error.status = 422;
      error.code = "PDF_FIDELITY_FAILURE";
      error.report = { mismatchedFields: [{ fieldName: "Pt2Line4a_FamilyName[0]" }] };
      throw error;
    };
    try {
      const documentCountBefore = await require("../../../models/Document").countDocuments({ caseId: golden.caseId });
      const req = { params: { caseFormId: String(caseForm._id) }, user: staffUser, ip: "127.0.0.1", headers: {} };
      const res = mockRes();
      await controller.filingPdf(req, res);

      assert.equal(res.statusCode, 422);
      assert.match(res.body.message, /PDF fidelity check failed/);
      assert.equal(res.sentBuffer, null, "no PDF buffer must be sent when the fidelity check fails");
      const documentCountAfter = await require("../../../models/Document").countDocuments({ caseId: golden.caseId });
      assert.equal(documentCountAfter, documentCountBefore, "a failed fidelity check must not store a Document record");
    } finally {
      PDFRenderer.renderFiling = originalRenderFiling;
    }
  } finally {
    await golden.cleanup();
  }
});
