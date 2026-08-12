// Real-HTTP acceptance tests for the official-PDF generation pipeline.
// h3-pdf-generation.test.js already proves the SERVICE layer exhaustively
// (20+ exact field values, checkbox correctness, versioning, template
// immutability) by calling PDFGenerationService directly - this file proves
// the layer on top of it that h3 never touches: the actual HTTP
// routes/controllers a real Download/Draft button hits, including auth, and
// two gaps flagged during the pipeline trace that had zero coverage:
// draft-pdf's own contract (fillable, no Document written) and a real
// fillability round-trip (modify a field after download and confirm it
// persists - proof the PDF was not silently flattened).
// Connects to the real configured MongoDB, like h3/h0/h1 - the acceptance
// criteria here (real HTTP response bytes, real auth rejection) are
// inherently integration-level.
const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const User = require("../../../models/User");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const AuditLog = require("../../../models/AuditLog");
const storageService = require("../../uploads/storage.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const seedI129H1bMapping = require("../../form-mapping/seeds/i129-h1b-mapping.seed");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");
const { generateAccessToken } = require("../../auth/token.service");
const app = require("../../../app");

const FORM_CODE = "I-129";

let server;
let baseUrl;

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
  await seedI129H1bMapping({});
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

async function staffAuthHeader() {
  const user = await User.findOne({ role: "case_manager", isActive: true }).select("_id role tokenVersion");
  assert.ok(user, "expected at least one active case_manager user");
  return `Bearer ${generateAccessToken(user)}`;
}

test("form-generation HTTP pipeline: generate, download, draft-pdf, fillability, and failure-safety against a real I-129 CaseForm", async () => {
  const golden = await buildGoldenH1bCase();
  const authorization = await staffAuthHeader();
  try {
    const { caseForm: aiFilled } = await AutoFillService.generate(golden.caseId, FORM_CODE, golden.user, {});
    const caseFormId = String(aiFilled._id);

    // --- Auth must actually be enforced on the real route, not just present in the router table ---
    const unauthed = await fetch(`${baseUrl}/forms/${caseFormId}/download`, {});
    assert.equal(unauthed.status, 401, "download without a token must be rejected");

    // --- Failure-safety (TEST 9): generation on a CaseForm that hasn't cleared review must refuse cleanly, no side effects ---
    const docsBefore = await Document.countDocuments({ caseId: golden.caseId });
    const refused = await fetch(`${baseUrl}/forms/${caseFormId}/generate`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(refused.status, 422, "generation on a non-approved CaseForm must be refused, not silently produce a PDF");
    const refusedBody = await refused.json();
    assert.equal(refusedBody.success, false);
    const docsAfterRefusal = await Document.countDocuments({ caseId: golden.caseId });
    assert.equal(docsAfterRefusal, docsBefore, "a refused generation must create zero Document records - no partial/broken artifact left behind");

    // Test-setup shortcut identical to h3-pdf-generation.test.js: stamp the
    // status the real review workflow would eventually set; only the HTTP
    // layer on top of PDFGenerationService is under test here.
    await CaseForm.updateOne({ _id: caseFormId }, { $set: { status: "approved" } });

    // --- TEST 6 (download, real HTTP): generate with flatten:true (exactly what the frontend's Download button sends) ---
    const generateRes = await fetch(`${baseUrl}/forms/${caseFormId}/generate`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ flatten: true, watermark: "FINAL" }),
    });
    assert.equal(generateRes.status, 201, `generate failed: ${await generateRes.text()}`);

    const downloadRes = await fetch(`${baseUrl}/forms/${caseFormId}/download`, { headers: { authorization } });
    assert.equal(downloadRes.status, 200);
    assert.match(downloadRes.headers.get("content-type") || "", /application\/pdf/, "download must be a real PDF response, not JSON/HTML");
    assert.match(downloadRes.headers.get("content-disposition") || "", /attachment/, "download must be a real file attachment, not an inline preview");
    const downloadedBuffer = Buffer.from(await downloadRes.arrayBuffer());
    assert.equal(downloadedBuffer.subarray(0, 5).toString("latin1"), "%PDF-", "the downloaded bytes must be a real PDF, not an HTML/React page");
    const downloadedPdf = await PDFDocument.load(downloadedBuffer, { ignoreEncryption: true, updateMetadata: false });
    assert.equal(downloadedPdf.getPageCount(), 38, "downloaded PDF must be the full, un-truncated 38-page official I-129");
    assert.equal(downloadedPdf.getForm().getFields().length, 0, "the Download button's flatten:true output must actually be flattened (no interactive fields left)");

    // --- TEST 5 (fillability) + draft-pdf's own contract: draft-pdf is a SEPARATE, always-fillable render that writes no Document ---
    const docsBeforeDraft = await Document.countDocuments({ caseId: golden.caseId });
    const draftRes = await fetch(`${baseUrl}/forms/${caseFormId}/draft-pdf`, { headers: { authorization } });
    assert.equal(draftRes.status, 200);
    assert.match(draftRes.headers.get("content-type") || "", /application\/pdf/);
    const draftBuffer = Buffer.from(await draftRes.arrayBuffer());
    assert.equal(draftBuffer.subarray(0, 5).toString("latin1"), "%PDF-");
    const docsAfterDraft = await Document.countDocuments({ caseId: golden.caseId });
    assert.equal(docsAfterDraft, docsBeforeDraft, "draft-pdf must not create a Document record - it is a throwaway working copy, not a stored version");

    const draftPdf = await PDFDocument.load(draftBuffer, { ignoreEncryption: true, updateMetadata: false });
    const draftForm = draftPdf.getForm();
    assert.ok(draftForm.getFields().length > 0, "draft-pdf must remain fillable (real AcroForm fields), unlike the flattened download");
    const knownField = draftForm.getTextField("form1[0].#subform[1].Part3_Line2_FamilyName[0]");
    assert.equal(knownField.getText(), "Lovelace", "draft-pdf must still contain the pre-filled canonical value");

    // Fillability round-trip: modify the known field, save, reopen, confirm
    // the edit truly persists in a normal PDF viewer/editor sense (pdf-lib
    // round-trip), proving this PDF is genuinely interactive and not a
    // flattened image masquerading as one.
    knownField.setText("MODIFIED_BY_FILLABILITY_TEST");
    const resavedBuffer = await draftPdf.save();
    const reopened = await PDFDocument.load(resavedBuffer, { ignoreEncryption: true, updateMetadata: false });
    assert.equal(
      reopened.getForm().getTextField("form1[0].#subform[1].Part3_Line2_FamilyName[0]").getText(),
      "MODIFIED_BY_FILLABILITY_TEST",
      "a manual edit to the fillable PDF must persist across save/reopen - proof it was not accidentally flattened"
    );
  } finally {
    const generatedDocuments = await Document.find({ caseId: golden.caseId }).select("storageKey").lean();
    await Promise.all(generatedDocuments.map((doc) => storageService.deleteObject(doc.storageKey).catch(() => null)));
    await Document.deleteMany({ caseId: golden.caseId });
    await AuditLog.deleteMany({ entityType: "CaseForm", entityId: { $in: await CaseForm.find({ caseId: golden.caseId }).distinct("_id") } });
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await golden.cleanup();
  }
});
