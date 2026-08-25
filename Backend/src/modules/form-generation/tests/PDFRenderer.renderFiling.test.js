// Phase 5 (§I.2/§I.6) - integration test for PDFRenderer.renderFiling against a REAL seeded H-1B
// case (buildGoldenH1bCase + the real AutoFillService.generate pipeline, same pattern already
// proven by h1-i129-mapping.test.js), not a hand-built fixture. Covers §K-G3's requirements:
// - returns a buffer starting with the %PDF- magic bytes
// - the buffer contains NO watermark text ("DRAFT"/"FINAL"/"ATTORNEY REVIEW") on any page, proven
//   by decoding each page's actual content stream (not just checking form field values) - this is
//   the "search page content streams, not just form fields" proof §C explicitly demands
// - fidelityReport is present and valid:true
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const { PDFDocument, PDFArray, PDFName, decodePDFRawStream } = require("pdf-lib");

if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "..", "..", "storage");
}
if (!process.env.MONGODB_TEST_URI) {
  process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
}

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const CaseForm = require("../../../models/CaseForm");
const PDFRenderer = require("../services/PDFRenderer");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");

const WATERMARK_LABELS = ["DRAFT", "FINAL", "ATTORNEY REVIEW"];

// Decodes one page's actual rendered text (form-field widget appearances are separate objects,
// not page content - this only ever sees text the page itself DRAWS, e.g. WatermarkService's
// page.drawText call). Handles the empty/no-content-stream case (a page with only form-field
// annotations and no drawText calls at all has no Contents entry whatsoever).
function decodePageText(pdfDoc, page) {
  const contents = page.node.Contents();
  if (!contents) return "";
  const refs = contents instanceof PDFArray ? contents.asArray() : [page.node.get(PDFName.of("Contents"))];
  let combined = "";
  for (const ref of refs) {
    if (!ref) continue;
    const streamObj = pdfDoc.context.lookup(ref);
    if (!streamObj) continue;
    const bytes = decodePDFRawStream(streamObj).decode();
    combined += Buffer.from(bytes).toString("latin1");
  }
  let text = "";
  (combined.match(/<([0-9A-Fa-f\s]+)>/g) || []).forEach((token) => {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  });
  (combined.match(/\(([^()]*)\)/g) || []).forEach((token) => { text += token.slice(1, -1); });
  return text;
}

async function findWatermarkText(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  for (const page of pdf.getPages()) {
    const text = decodePageText(pdf, page);
    for (const label of WATERMARK_LABELS) {
      if (text.includes(label)) return label;
    }
  }
  return null;
}

test("PDFRenderer.renderFiling produces a clean, watermark-free, fidelity-verified PDF from a real seeded case", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    const template = await USCISFormTemplate.findById(caseForm.formTemplateId).lean();
    const caseFormDoc = await CaseForm.findById(caseForm._id);

    const result = await PDFRenderer.renderFiling({ caseForm: caseFormDoc, template });

    assert.ok(Buffer.isBuffer(result.buffer));
    assert.equal(result.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(result.fidelityReport, "renderFiling must return a fidelityReport");
    assert.ok(result.fidelityReport.sampledFields > 0, "expected at least one real field to have been sampled against this golden case's data");

    const watermarkFound = await findWatermarkText(result.buffer);
    assert.equal(watermarkFound, null, `expected NO watermark text on any page, but found "${watermarkFound}"`);

    // Sanity check the detector itself isn't a silent no-op: the SAME template rendered through
    // the watermarked path (render(), not renderFiling()) on the SAME data must be detected.
    const watermarked = await PDFRenderer.render({ caseForm: caseFormDoc, template, watermark: "DRAFT", flatten: false });
    const watermarkedFound = await findWatermarkText(watermarked.buffer);
    assert.equal(watermarkedFound, "DRAFT", "the watermark-detection helper must actually detect a real watermark when one is present");
  } finally {
    await golden.cleanup();
  }
});

test("PDFRenderer.renderFiling throws PDF_FIDELITY_FAILURE and does not return a buffer when the fidelity check fails", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    const template = await USCISFormTemplate.findById(caseForm.formTemplateId).lean();
    const caseFormDoc = await CaseForm.findById(caseForm._id);
    // Simulate a template whose formFields metadata claims far more fields than the real PDF has -
    // this is the same structural mismatch PDFFidelityService.verify's field-count check exists to
    // catch, exercised here through the real renderFiling path rather than PDFFidelityService in
    // isolation (already covered by PDFFidelityService.test.js).
    const tamperedTemplate = { ...template, formFields: [...template.formFields, ...template.formFields, ...template.formFields] };

    await assert.rejects(
      () => PDFRenderer.renderFiling({ caseForm: caseFormDoc, template: tamperedTemplate }),
      (error) => {
        assert.equal(error.code, "PDF_FIDELITY_FAILURE");
        assert.equal(error.status, 422);
        assert.ok(error.report, "the thrown error must carry the fidelity report");
        return true;
      }
    );
  } finally {
    await golden.cleanup();
  }
});
