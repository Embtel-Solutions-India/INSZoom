// node src/modules/uscis-form-import/seeds/i140.seed.js
// (or: npm run seed:i140, from Backend/)
//
// Imports (if not already present) and activates the bundled I-140
// (edition 2024-07-06) so uscis-form.service.js's registry-driven
// provisioning (VisaFormMapping's formTemplateFormCode: "i-140") can attach
// it to every AUTO_CREATE mapping row that references it (EB-1A, EB-1B,
// EB-1C, EB-2 NIW at initial case creation; EB-2 PERM/EB-3/EB-4 at their
// own LATER_STAGE). Idempotent and non-destructive — mirrors i134.seed.js.

const path = require("path");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const storageService = require("../../uploads/storage.service");
const importLocalForm = require("../scripts/importLocalForm");
const { deriveVisaTypesFromRegistry } = require("./deriveVisaTypesFromRegistry");

const FORM_CODE = "I-140";
const VERSION = "2024-07-06";
const EDITION_DATE = new Date("2024-07-06T00:00:00.000Z");
const TITLE = "Immigrant Petition for Alien Worker (I-140)";
const DEFAULT_FILE = path.resolve(__dirname, "../../../../dev-assets/uscis/i-140_2024_07_06.pdf");
const MIN_FIELD_COUNT = 10;
const VISA_TYPES = ["EB-1A", "EB-1B", "EB-1C", "EB-2 PERM", "EB-2 NIW", "EB-3 Skilled Worker", "EB-3 Professional", "EB-3 Other Worker"];

async function verifyFillable(pdfStorageKey) {
  const buffer = await storageService.readBuffer(pdfStorageKey);
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const fieldCount = pdf.getForm().getFields().length;
  if (fieldCount < MIN_FIELD_COUNT) {
    const error = new Error(
      `Stored ${FORM_CODE} template PDF at "${pdfStorageKey}" only exposes ${fieldCount} fillable fields ` +
      `(expected >= ${MIN_FIELD_COUNT}). Stopping rather than activating an unfillable template.`
    );
    error.code = `${FORM_CODE.replace("-", "")}_TEMPLATE_NOT_FILLABLE`;
    throw error;
  }
  return fieldCount;
}

function storedFieldCount(template) {
  return Array.isArray(template?.formFields) ? template.formFields.length : 0;
}

function canTrustStoredFieldCount(template) {
  return template?.status === "active"
    && template?.activeFlag === true
    && template?.officialStatus === "current"
    && storedFieldCount(template) >= MIN_FIELD_COUNT;
}

async function seedI140Template({ file } = {}) {
  const existing = await USCISFormTemplate.find({ formCode: FORM_CODE, version: VERSION });
  if (existing.length > 1) {
    const error = new Error(
      `Found ${existing.length} USCISFormTemplate records for ${FORM_CODE} ${VERSION} - expected at most 1. ` +
      `Refusing to guess; resolve manually before re-running.`
    );
    error.code = `${FORM_CODE.replace("-", "")}_TEMPLATE_AMBIGUOUS`;
    throw error;
  }

  let template = existing[0];
  if (!template) {
    const result = await importLocalForm({ file: file || DEFAULT_FILE, formCode: FORM_CODE, version: VERSION });
    template = await USCISFormTemplate.findById(result.template._id);
  }

  const fieldCount = canTrustStoredFieldCount(template)
    ? storedFieldCount(template)
    : await verifyFillable(template.pdfStorageKey);

  template.status = "active";
  template.activeFlag = true;
  template.officialStatus = "current";
  // Registry-derived, not hardcoded-only (final phase durability fix - see
  // deriveVisaTypesFromRegistry.js). VISA_TYPES above is kept as a floor.
  const registryVisaTypes = await deriveVisaTypesFromRegistry(FORM_CODE);
  template.visaTypes = Array.from(new Set([...(template.visaTypes || []), ...VISA_TYPES, ...registryVisaTypes]));
  template.editionDate = template.editionDate || EDITION_DATE;
  template.title = TITLE;
  await template.save();

  return { template, fieldCount };
}

module.exports = seedI140Template;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI140Template({}))
    .then(({ template, fieldCount }) => {
      console.log(`${FORM_CODE} template seeded and activated.`);
      console.log("  templateId:", String(template._id));
      console.log("  status:", template.status, "| activeFlag:", template.activeFlag);
      console.log("  visaTypes:", template.visaTypes);
      console.log("  editionDate:", template.editionDate);
      console.log("  fieldCount:", fieldCount);
      console.log("  pdfStorageKey:", template.pdfStorageKey);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error(`Failed to seed ${FORM_CODE} template:`, error.message);
      if (error.code) console.error("  code:", error.code);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
