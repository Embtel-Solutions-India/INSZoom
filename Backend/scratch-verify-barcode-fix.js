// Mandatory verification for the barcode-corruption fix (Section 11-14 of
// the task). Compares the ORIGINAL unfilled I-129 template against a freshly
// rendered PDF (same CaseForm, post-fix) for all 38 PDF417BarCode1[0]
// occurrences: image XObject presence (V1), raw stream byte hash (V2 -
// hashing the RAW, still-filter-encoded stream bytes rather than a
// filter-specific "decoded" form: identical raw bytes deterministically
// imply an identical decoded image, which is what actually matters here -
// this app never touching/re-encoding the XObject at all), and /V field
// value preservation (V3). Also runs V4 (signature fields) and V5 (normal
// field regression) against the same two documents.
require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_TEST_URI || "mongodb://localhost:27017/immigrationcrm_test");
  const AutoFillService = require("./src/modules/form-mapping/services/AutoFillService");
  const CaseForm = require("./src/models/CaseForm");
  const PDFRenderer = require("./src/modules/form-generation/services/PDFRenderer");
  const { buildGoldenH1bCase } = require("./src/modules/form-mapping/tests/i129-h1b-golden-case");
  const { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFRef } = require("pdf-lib");

  const golden = await buildGoldenH1bCase();
  try {
    const { caseForm } = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    const reloaded = await CaseForm.findById(caseForm._id).populate("formTemplateId").lean();
    const template = reloaded.formTemplateId;

    // ---- Original, unfilled template (the authoritative source of the real barcode images) ----
    const originalPdf = await PDFRenderer.loadTemplatePdf(template, PDFDocument);

    // ---- Freshly rendered PDF from this exact CaseForm, through the actual (now-fixed) render pipeline ----
    const { buffer, renderReport } = await PDFRenderer.render({ caseForm: reloaded, template, watermark: null, flatten: false });
    const generatedPdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });

    console.log("=== renderReport.protectedFields (should list all 38 barcode fields as filtered, plus signature fields) ===");
    console.log(`protectedFields count: ${renderReport.protectedFields?.length}`);
    const barcodeProtectedCount = (renderReport.protectedFields || []).filter((p) => /barcode/i.test(p.pdfField)).length;
    const sigProtectedCount = (renderReport.protectedFields || []).filter((p) => /signature/i.test(p.pdfField)).length;
    console.log("barcode entries in protectedFields:", barcodeProtectedCount, "| signature-named entries in protectedFields:", sigProtectedCount);

    function resolveXObjectImages(pdfDoc, field) {
      // Returns [{ subtype, rawBytes }] for every image XObject referenced by
      // this field's normal (/N) appearance, across all its widgets.
      const images = [];
      const widgets = field.acroField.getWidgets();
      for (const widget of widgets) {
        const apDict = widget.dict.get(PDFName.of("AP"));
        if (!apDict || !(apDict instanceof PDFDict)) continue;
        let normal = apDict.get(PDFName.of("N"));
        // /N can be a direct stream ref, or (for checkboxes/radios) a
        // sub-dictionary of state-name -> stream. Text fields (what barcode
        // fields actually are) always use the direct-stream form, but handle
        // both defensively.
        const candidates = [];
        if (normal instanceof PDFRef) {
          const resolved = pdfDoc.context.lookup(normal);
          candidates.push(resolved);
        } else if (normal instanceof PDFDict) {
          for (const value of normal.values()) {
            candidates.push(pdfDoc.context.lookup(value));
          }
        }
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

    function fieldValue(pdfDoc, field) {
      try {
        return field.acroField.getValue()?.decodeText?.() ?? field.acroField.getValue()?.asString?.() ?? null;
      } catch (e) {
        return `<error: ${e.message}>`;
      }
    }

    const originalForm = originalPdf.getForm();
    const generatedForm = generatedPdf.getForm();
    const barcodeFields = originalForm.getFields().filter((f) => /barcode/i.test(f.getName()));
    console.log(`\nTotal barcode field occurrences found: ${barcodeFields.length}`);

    let v1Pass = 0, v1Fail = [];
    let v2Pass = 0, v2Fail = [];
    let v3Pass = 0, v3Fail = [];

    for (const origField of barcodeFields) {
      const name = origField.getName();
      let genField;
      try { genField = generatedForm.getField(name); } catch (e) { genField = null; }
      if (!genField) { v1Fail.push({ name, reason: "field not found in generated PDF" }); v2Fail.push({ name, reason: "field not found" }); v3Fail.push({ name, reason: "field not found" }); continue; }

      const origImages = resolveXObjectImages(originalPdf, origField);
      const genImages = resolveXObjectImages(generatedPdf, genField);

      // V1: generated field's appearance still contains an /Image XObject
      const genHasImage = genImages.some((img) => img.subtype === "/Image");
      if (genHasImage) v1Pass++; else v1Fail.push({ name, reason: "no /Subtype /Image XObject found in generated PDF's appearance", genImages: genImages.map((i) => i.subtype) });

      // V2: raw stream bytes of the image XObject are byte-identical between original template and generated PDF
      const origImage = origImages.find((img) => img.subtype === "/Image");
      const genImage = genImages.find((img) => img.subtype === "/Image");
      if (origImage && genImage) {
        const origHash = crypto.createHash("sha256").update(origImage.rawBytes).digest("hex");
        const genHash = crypto.createHash("sha256").update(genImage.rawBytes).digest("hex");
        if (origHash === genHash) v2Pass++; else v2Fail.push({ name, origHash, genHash });
      } else {
        v2Fail.push({ name, reason: "missing image XObject in original or generated", origHasImage: Boolean(origImage), genHasImage: Boolean(genImage) });
      }

      // V3: field /V value unchanged from the original template
      const origValue = fieldValue(originalPdf, origField);
      const genValue = fieldValue(generatedPdf, genField);
      if (origValue === genValue) v3Pass++; else v3Fail.push({ name, origValue, genValue });
    }

    console.log(`\n=== V1 - Image XObject present in generated PDF's appearance ===`);
    console.log(`${v1Pass}/${barcodeFields.length} passed`);
    if (v1Fail.length) console.log("FAILURES:", JSON.stringify(v1Fail, null, 2));

    console.log(`\n=== V2 - SHA-256 raw image-stream bytes identical (original template vs generated) ===`);
    console.log(`${v2Pass}/${barcodeFields.length} passed`);
    if (v2Fail.length) console.log("FAILURES:", JSON.stringify(v2Fail, null, 2));

    console.log(`\n=== V3 - Field /V value unchanged ===`);
    console.log(`${v3Pass}/${barcodeFields.length} passed`);
    if (v3Fail.length) console.log("FAILURES:", JSON.stringify(v3Fail, null, 2));

    // ---- V4: signature fields - must also be untouched (no XObject comparison needed, just confirm not in mappedFields / no mutation attempted) ----
    const sigFieldsTemplate = (template.formFields || []).filter((f) => f.pdfFieldType === "signature" || /signature/i.test(f.fieldName || ""));
    console.log(`\n=== V4 - Signature fields (${sigFieldsTemplate.length} discovered) ===`);
    let v4Pass = 0, v4Fail = [];
    for (const sf of sigFieldsTemplate) {
      const name = sf.fieldName;
      let origField, genField;
      try { origField = originalForm.getField(name); } catch (e) { origField = null; }
      try { genField = generatedForm.getField(name); } catch (e) { genField = null; }
      if (!origField || !genField) { v4Fail.push({ name, reason: "field not found" }); continue; }
      const origVal = fieldValue(originalPdf, origField);
      const genVal = fieldValue(generatedPdf, genField);
      if (origVal === genVal) v4Pass++; else v4Fail.push({ name, origVal, genVal });
    }
    console.log(`${v4Pass}/${sigFieldsTemplate.length} passed`);
    if (v4Fail.length) console.log("FAILURES:", JSON.stringify(v4Fail, null, 2));

    // ---- V5: normal field regression - 5 text, 5 checkbox from the ACTUAL mappedFields the render produced ----
    console.log(`\n=== V5 - Normal field regression ===`);
    const PDFFieldMapper = require("./src/modules/form-generation/services/PDFFieldMapper");
    const { mappedFields } = PDFFieldMapper.mapFields(reloaded, template);
    const textSamples = [];
    const checkboxSamples = [];
    for (const [pdfField, mapped] of Object.entries(mappedFields)) {
      let genField;
      try { genField = generatedForm.getField(pdfField); } catch (e) { continue; }
      const ctor = genField?.constructor?.name || "";
      if (ctor.includes("CheckBox") && checkboxSamples.length < 5) {
        checkboxSamples.push({ pdfField, expected: Boolean(mapped.value), actual: genField.isChecked() });
      } else if (ctor.includes("TextField") && textSamples.length < 5) {
        textSamples.push({ pdfField, expected: String(mapped.value), actual: genField.getText() });
      }
      if (textSamples.length >= 5 && checkboxSamples.length >= 5) break;
    }
    const textPass = textSamples.filter((s) => s.actual === s.expected).length;
    const checkboxPass = checkboxSamples.filter((s) => s.actual === s.expected).length;
    console.log(`Text fields tested: ${textSamples.length}, passed: ${textPass}`);
    console.log(JSON.stringify(textSamples, null, 2));
    console.log(`Checkbox fields tested: ${checkboxSamples.length}, passed: ${checkboxPass}`);
    console.log(JSON.stringify(checkboxSamples, null, 2));

    console.log(`\n=== SUMMARY ===`);
    console.log(`Barcode occurrences discovered: ${barcodeFields.length}`);
    console.log(`V1 (image XObject present): ${v1Pass}/${barcodeFields.length}`);
    console.log(`V2 (SHA-256 image bytes match): ${v2Pass}/${barcodeFields.length}`);
    console.log(`V3 (field value unchanged): ${v3Pass}/${barcodeFields.length}`);
    console.log(`V4 (signature fields untouched): ${v4Pass}/${sigFieldsTemplate.length}`);
    console.log(`V5 (text field regression): ${textPass}/${textSamples.length}`);
    console.log(`V5 (checkbox field regression): ${checkboxPass}/${checkboxSamples.length}`);
  } finally {
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await golden.cleanup();
    await mongoose.disconnect();
  }
}

main().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
