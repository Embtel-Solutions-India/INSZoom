// Regression coverage for the barcode/signature-field corruption bug: USCIS
// PDF417 barcode fields (and signature fields) were being auto-populated by
// FormMappingService.normalizeMappings()'s defaultValue fallback (a barcode
// field's own scanned text, fed back in as if it were resolved case data),
// which PDFRenderer.setFormField()'s field.setText() then wrote - destroying
// the field's real image-XObject appearance and replacing it with plain
// text. Root cause and fix documented in Backend/docs/ISSUES.md and
// ProtectedFieldPolicy.js. This file promotes the two ad-hoc verification
// scripts that first proved the fix (scratch-verify-barcode-fix.js,
// scratch-verify-other-templates.js) into permanent regression coverage.
const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFRef } = require("pdf-lib");

if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "..", "..", "storage");
}
if (!process.env.MONGODB_TEST_URI) {
  process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
}

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const PDFRenderer = require("../services/PDFRenderer");
const PDFFieldMapper = require("../services/PDFFieldMapper");
const MappingResolver = require("../../form-mapping/services/MappingResolver");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");

// Returns every image XObject a field's /AP /N normal appearance references,
// across all its widgets. Text fields (what a PDF417 barcode field actually
// is here) always use the direct-stream /N form; handled defensively for
// the dict-of-states form too, since it costs nothing.
function resolveXObjectImages(pdfDoc, field) {
  const images = [];
  for (const widget of field.acroField.getWidgets()) {
    const apDict = widget.dict.get(PDFName.of("AP"));
    if (!apDict || !(apDict instanceof PDFDict)) continue;
    const normal = apDict.get(PDFName.of("N"));
    const candidates = [];
    if (normal instanceof PDFRef) candidates.push(pdfDoc.context.lookup(normal));
    else if (normal instanceof PDFDict) for (const value of normal.values()) candidates.push(pdfDoc.context.lookup(value));
    for (const stream of candidates) {
      if (!stream || !(stream instanceof PDFRawStream)) continue;
      const resources = stream.dict.get(PDFName.of("Resources"));
      const resourcesDict = resources instanceof PDFRef ? pdfDoc.context.lookup(resources) : resources;
      if (!resourcesDict || !(resourcesDict instanceof PDFDict)) continue;
      const xObjectDict = resourcesDict.get(PDFName.of("XObject"));
      const xObjects = xObjectDict instanceof PDFRef ? pdfDoc.context.lookup(xObjectDict) : xObjectDict;
      if (!xObjects || !(xObjects instanceof PDFDict)) continue;
      for (const [, xoRef] of xObjects.entries()) {
        const xo = xoRef instanceof PDFRef ? pdfDoc.context.lookup(xoRef) : xoRef;
        if (!xo || !(xo instanceof PDFRawStream)) continue;
        const subtype = xo.dict.get(PDFName.of("Subtype"));
        images.push({ subtype: subtype ? subtype.toString() : null, rawBytes: xo.contents });
      }
    }
  }
  return images;
}

function fieldValue(field) {
  try {
    return field.acroField.getValue()?.decodeText?.() ?? field.acroField.getValue()?.asString?.() ?? null;
  } catch {
    return null;
  }
}

// ISSUE-003 follow-up: barcode fields are now FLATTENED (baked into page
// content, removed as widgets) rather than left as live, untouched fields -
// see BarcodeAppearanceGuard.js. Finds the page a field's widget lived on in
// the (unflattened) source document, reusing pdf-lib's own public
// PDFForm.findWidgetPage() (handles both the direct /P case and the
// annotation-search fallback) rather than reimplementing it.
function widgetPageIndex(pdfDoc, form, field) {
  const widget = field.acroField.getWidgets()[0];
  const page = form.findWidgetPage(widget);
  return pdfDoc.getPages().indexOf(page);
}

// Recursively finds every /Image XObject's raw bytes reachable from a given
// XObject stream - handles both a direct /Image (a normal field's /AP /N)
// and a /Form XObject wrapping an image in its own /Resources (what a
// flattened field's page-level "FlatWidget" XObject actually is: pdf-lib's
// flatten() reuses the field's original appearance stream object as-is, so
// the embedded image is one level deeper, not the FlatWidget entry itself).
function resolveImagesDeep(pdfDoc, stream, depth = 0) {
  if (!(stream instanceof PDFRawStream) || depth > 3) return [];
  const subtype = stream.dict.get(PDFName.of("Subtype"))?.toString();
  if (subtype === "/Image") return [stream.contents];
  const resources = stream.dict.get(PDFName.of("Resources"));
  const resourcesDict = resources instanceof PDFRef ? pdfDoc.context.lookup(resources) : resources;
  if (!resourcesDict || !(resourcesDict instanceof PDFDict)) return [];
  const xObjectDict = resourcesDict.get(PDFName.of("XObject"));
  const xObjects = xObjectDict instanceof PDFRef ? pdfDoc.context.lookup(xObjectDict) : xObjectDict;
  if (!xObjects || !(xObjects instanceof PDFDict)) return [];
  const images = [];
  for (const [, ref] of xObjects.entries()) {
    const xo = ref instanceof PDFRef ? pdfDoc.context.lookup(ref) : ref;
    images.push(...resolveImagesDeep(pdfDoc, xo, depth + 1));
  }
  return images;
}

// Every image reachable from a page's "FlatWidget"-prefixed XObject entries
// (the resource keys pdf-lib's flatten algorithm always generates).
function flatWidgetImagesOnPage(pdfDoc, pageIndex) {
  const page = pdfDoc.getPages()[pageIndex];
  const resources = page.node.Resources();
  const xObjectDict = resources?.lookup?.(PDFName.of("XObject"), PDFDict);
  if (!xObjectDict) return [];
  const images = [];
  for (const [key, ref] of xObjectDict.entries()) {
    if (!/^\/FlatWidget/i.test(key.toString())) continue;
    const xo = ref instanceof PDFRef ? pdfDoc.context.lookup(ref) : ref;
    images.push(...resolveImagesDeep(pdfDoc, xo));
  }
  return images;
}

test("I-129: every barcode field's image appearance and value survives a real autofill + render, untouched", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    const reloaded = await CaseForm.findById(caseForm._id).populate("formTemplateId").lean();
    const template = reloaded.formTemplateId;

    const originalPdf = await PDFRenderer.loadTemplatePdf(template, PDFDocument);
    const { buffer } = await PDFRenderer.render({ caseForm: reloaded, template, watermark: null, flatten: false });
    const generatedPdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });

    const originalForm = originalPdf.getForm();
    const generatedForm = generatedPdf.getForm();
    const barcodeFields = originalForm.getFields().filter((f) => /barcode/i.test(f.getName()));
    assert.ok(barcodeFields.length > 0, "golden I-129 template must actually contain barcode fields for this test to mean anything");

    for (const origField of barcodeFields) {
      const name = origField.getName();

      // ISSUE-003 follow-up: a barcode field is now FLATTENED (baked into
      // the page, widget removed) rather than left as a live field - because
      // leaving it live meant the AcroForm-wide /NeedAppearances flag
      // (required for ordinary filled text fields to render correctly
      // everywhere) also made every viewer rebuild the barcode's own
      // untouched appearance as plain text. See BarcodeAppearanceGuard.js.
      assert.throws(() => generatedForm.getField(name), `barcode field ${name} must be flattened (no longer a live AcroForm field) in the generated PDF`);

      const origImage = resolveXObjectImages(originalPdf, origField).find((img) => img.subtype === "/Image");
      assert.ok(origImage, `template's own ${name} must have an /Image XObject appearance (sanity check on the fixture)`);

      const pageIndex = widgetPageIndex(originalPdf, originalForm, origField);
      assert.ok(pageIndex >= 0, `could not determine which page ${name} was on`);
      const genImages = flatWidgetImagesOnPage(generatedPdf, pageIndex);
      const genImage = genImages.find((bytes) => crypto.createHash("sha256").update(bytes).digest("hex") === crypto.createHash("sha256").update(origImage.rawBytes).digest("hex"));
      assert.ok(genImage, `generated PDF's page ${pageIndex} must contain ${name}'s original barcode image, byte-identical, baked into a FlatWidget XObject`);
    }

    const sigFieldsTemplate = (template.formFields || []).filter((f) => f.pdfFieldType === "signature" || /signature/i.test(f.fieldName || ""));
    for (const sf of sigFieldsTemplate) {
      const origField = originalForm.getField(sf.fieldName);
      const genField = generatedForm.getField(sf.fieldName);
      assert.equal(fieldValue(genField), fieldValue(origField), `signature field ${sf.fieldName} must be untouched`);
    }

    // Regression check: the protection must not have collaterally broken
    // ordinary field autofill for ordinary fields.
    const { mappedFields } = PDFFieldMapper.mapFields(reloaded, template);
    let checkedText = 0;
    let checkedCheckbox = 0;
    for (const [pdfField, mapped] of Object.entries(mappedFields)) {
      if (checkedText >= 3 && checkedCheckbox >= 3) break;
      let genField;
      try { genField = generatedForm.getField(pdfField); } catch { continue; }
      const ctor = genField?.constructor?.name || "";
      if (ctor.includes("TextField") && checkedText < 3) {
        assert.equal(genField.getText(), String(mapped.value), `ordinary text field ${pdfField} should still autofill correctly`);
        checkedText += 1;
      } else if (ctor.includes("CheckBox") && checkedCheckbox < 3) {
        assert.equal(genField.isChecked(), Boolean(mapped.value), `ordinary checkbox ${pdfField} should still autofill correctly`);
        checkedCheckbox += 1;
      }
    }
  } finally {
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await golden.cleanup();
  }
});

test("every seeded USCIS template: every barcode/signature field is excluded from mappedFields, never leaked", async (t) => {
  t.after(async () => { await disconnectTestDB(); });
  await connectTestDB();
  const templates = await USCISFormTemplate.find({}).lean();
  assert.ok(templates.length > 0, "expected at least one seeded USCIS template in the test DB");

  for (const template of templates) {
    const filledData = {};
    (template.formFields || []).forEach((field) => {
      const fieldId = field.fieldId || field.fieldName;
      MappingResolver.setPath(filledData, fieldId, "SYNTHETIC_TEST_VALUE");
    });
    const { mappedFields, protectedFields } = PDFFieldMapper.mapFields({ filledData }, template);

    const realBarcodeFields = (template.formFields || []).filter((f) => /barcode/i.test(f.fieldName || ""));
    const realSignatureFields = (template.formFields || []).filter((f) => f.pdfFieldType === "signature" || /signature/i.test(f.fieldName || ""));
    const protectedNames = new Set((protectedFields || []).map((p) => p.pdfField));

    for (const f of [...realBarcodeFields, ...realSignatureFields]) {
      assert.ok(!Object.prototype.hasOwnProperty.call(mappedFields, f.fieldName), `${template.formCode}: ${f.fieldName} must never appear in mappedFields`);
      assert.ok(protectedNames.has(f.fieldName), `${template.formCode}: ${f.fieldName} must be reported in protectedFields`);
    }
  }
});
