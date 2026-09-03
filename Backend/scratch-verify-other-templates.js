// V7: verify the protected-field fix against every OTHER USCIS template in
// the system (I-129 already got the full end-to-end V1-V5 pass in
// scratch-verify-barcode-fix.js). These templates have no golden CaseForm
// fixture, and the fix itself is entirely mapping-layer/name-pattern driven
// (does not depend on actual canonical data content), so this seeds a
// synthetic filledData value for EVERY field in the real template - worst
// case "every field has data available" - and confirms every real
// barcode/signature field in that template is still correctly excluded from
// mappedFields and reported in protectedFields. This directly exercises the
// same isProtectedField() code path against each template's real field
// names, without requiring a full realistic case-data fixture.
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_TEST_URI || "mongodb://localhost:27017/immigrationcrm_test");
  const USCISFormTemplate = require("./src/models/USCISFormTemplate");
  const PDFFieldMapper = require("./src/modules/form-generation/services/PDFFieldMapper");
  const MappingResolver = require("./src/modules/form-mapping/services/MappingResolver");

  const templates = await USCISFormTemplate.find({ formCode: { $ne: "I-129" } }).lean();
  console.log(`Testing ${templates.length} other templates: ${templates.map((t) => t.formCode).join(", ")}\n`);

  let overallPass = true;
  for (const template of templates) {
    const filledData = {};
    (template.formFields || []).forEach((field) => {
      const fieldId = field.fieldId || field.fieldName;
      MappingResolver.setPath(filledData, fieldId, "SYNTHETIC_TEST_VALUE");
    });
    const fakeCaseForm = { filledData };

    const { mappedFields, protectedFields } = PDFFieldMapper.mapFields(fakeCaseForm, template);

    const realBarcodeFields = (template.formFields || []).filter((f) => /barcode/i.test(f.fieldName || ""));
    const realSignatureFields = (template.formFields || []).filter((f) => f.pdfFieldType === "signature" || /signature/i.test(f.fieldName || ""));

    const barcodeLeaked = realBarcodeFields.filter((f) => Object.prototype.hasOwnProperty.call(mappedFields, f.fieldName));
    const signatureLeaked = realSignatureFields.filter((f) => Object.prototype.hasOwnProperty.call(mappedFields, f.fieldName));

    const barcodeProtectedNames = new Set((protectedFields || []).map((p) => p.pdfField));
    const barcodeConfirmedProtected = realBarcodeFields.filter((f) => barcodeProtectedNames.has(f.fieldName)).length;
    const signatureConfirmedProtected = realSignatureFields.filter((f) => barcodeProtectedNames.has(f.fieldName)).length;

    const pass = barcodeLeaked.length === 0 && signatureLeaked.length === 0 && barcodeConfirmedProtected === realBarcodeFields.length && signatureConfirmedProtected === realSignatureFields.length;
    if (!pass) overallPass = false;

    console.log(`${template.formCode} ${template.version}: barcode fields=${realBarcodeFields.length} (leaked into mappedFields: ${barcodeLeaked.length}, confirmed in protectedFields: ${barcodeConfirmedProtected}/${realBarcodeFields.length}) | signature fields=${realSignatureFields.length} (leaked: ${signatureLeaked.length}, confirmed protected: ${signatureConfirmedProtected}/${realSignatureFields.length}) -> ${pass ? "PASS" : "FAIL"}`);
    if (barcodeLeaked.length) console.log("  LEAKED BARCODE FIELDS:", barcodeLeaked.map((f) => f.fieldName));
    if (signatureLeaked.length) console.log("  LEAKED SIGNATURE FIELDS:", signatureLeaked.map((f) => f.fieldName));
  }

  console.log(`\nOVERALL: ${overallPass ? "PASS - all other templates correctly protect all their barcode/signature fields" : "FAIL"}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
