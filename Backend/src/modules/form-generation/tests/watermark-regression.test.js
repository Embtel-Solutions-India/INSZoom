// Phase 5 (§K-G7) - proves the two PRE-EXISTING watermarked paths still watermark correctly after
// Phase 5's changes, by byte-level evidence (decoding real page content streams), not just "it
// looks fine" / status-code checks. draftPdf must still stamp "DRAFT"; the legacy generate path
// must still stamp "ATTORNEY REVIEW" (pre-lock) or "FINAL" (locked/ready_for_pdf), exactly as
// before Phase 5 - PDFRenderer.render's own watermark logic and FormGenerationController.draftPdf/
// generate were NOT modified this phase (only draftPdf's sibling filingPdf was added).
const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument, PDFArray, PDFName, decodePDFRawStream } = require("pdf-lib");

if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "..", "..", "storage");
}
if (!process.env.MONGODB_TEST_URI) {
  process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
}

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const CaseForm = require("../../../models/CaseForm");
const PDFGenerationService = require("../services/PDFGenerationService");
const controller = require("../controllers/FormGenerationController");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");

function decodePageText(pdfDoc, page) {
  const contents = page.node.Contents();
  if (!contents) return "";
  const refs = contents instanceof PDFArray ? contents.asArray() : [page.node.get(PDFName.of("Contents"))];
  let combined = "";
  for (const ref of refs) {
    if (!ref) continue;
    const streamObj = pdfDoc.context.lookup(ref);
    if (!streamObj) continue;
    combined += Buffer.from(decodePDFRawStream(streamObj).decode()).toString("latin1");
  }
  let text = "";
  (combined.match(/<([0-9A-Fa-f\s]+)>/g) || []).forEach((token) => {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  });
  (combined.match(/\(([^()]*)\)/g) || []).forEach((token) => { text += token.slice(1, -1); });
  return text;
}

async function findWatermarkText(buffer, labels) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  for (const page of pdf.getPages()) {
    const text = decodePageText(pdf, page);
    for (const label of labels) if (text.includes(label)) return label;
  }
  return null;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    sentBuffer: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    json(payload) { this.body = payload; return this; },
    send(buffer) { this.sentBuffer = buffer; return this; },
  };
}

const LABELS = ["DRAFT", "FINAL", "ATTORNEY REVIEW"];

test("draftPdf still stamps DRAFT (byte-level, unaffected by Phase 5)", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    const req = { params: { caseFormId: String(caseForm._id) }, user: golden.user, ip: "127.0.0.1", headers: {} };
    const res = mockRes();
    await controller.draftPdf(req, res);

    assert.equal(res.statusCode, 200);
    const found = await findWatermarkText(Buffer.from(res.sentBuffer), LABELS);
    assert.equal(found, "DRAFT", `expected draftPdf's output to be watermarked "DRAFT", found: ${found}`);
  } finally {
    await golden.cleanup();
  }
});

test("legacy generate path still stamps ATTORNEY REVIEW pre-lock and FINAL once locked (byte-level, unaffected by Phase 5)", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    await CaseForm.updateOne({ _id: caseForm._id }, { $set: { status: "approved" } });

    const preLock = await PDFGenerationService.generate(caseForm._id, staffUser, {}, {});
    const preLockBuffer = await require("../../uploads/storage.service").readBuffer(preLock.document.storageKey);
    const preLockFound = await findWatermarkText(preLockBuffer, LABELS);
    assert.equal(preLockFound, "ATTORNEY REVIEW", `expected pre-lock generate to stamp "ATTORNEY REVIEW", found: ${preLockFound}`);

    // "ready_for_pdf" (not "locked") deliberately: generate()'s watermark ternary treats both
    // "locked" and "ready_for_pdf" as FINAL, but its validation call only switches to strict
    // (non-draft) mode when status is exactly "locked" (`draft: caseForm.status !== "locked"`) -
    // this golden fixture satisfies draft-mode validation but not the full locked-mode validation
    // (a pre-existing, Phase-5-unrelated gap), so "ready_for_pdf" proves the FINAL watermark branch
    // without tripping over that separate, out-of-scope validation gap.
    await CaseForm.updateOne({ _id: caseForm._id }, { $set: { status: "ready_for_pdf" } });
    const finalGen = await PDFGenerationService.generate(caseForm._id, staffUser, {}, { regenerate: true });
    const finalBuffer = await require("../../uploads/storage.service").readBuffer(finalGen.document.storageKey);
    const finalFound = await findWatermarkText(finalBuffer, LABELS);
    assert.equal(finalFound, "FINAL", `expected ready_for_pdf generate to stamp "FINAL", found: ${finalFound}`);
  } finally {
    await golden.cleanup();
  }
});
