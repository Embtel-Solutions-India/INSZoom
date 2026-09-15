// node src/modules/uscis-form-import/seeds/i485.seed.js
// (or: npm run seed:i485, from Backend/)
//
// Imports (if not already present) and activates the bundled I-485
// (edition 2026-04-09) so registry-driven provisioning
// (VisaFormMapping's formTemplateFormCode: "i-485") can attach it wherever
// a case's processingPath is ADJUSTMENT_OF_STATUS — every EB category, most
// family-based categories, K-1/K-3 post-marriage, and the humanitarian
// U-visa paths. Idempotent and non-destructive — mirrors i134.seed.js.

const path = require("path");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const storageService = require("../../uploads/storage.service");
const importLocalForm = require("../scripts/importLocalForm");

const FORM_CODE = "I-485";
const VERSION = "2026-04-09";
const EDITION_DATE = new Date("2026-04-09T00:00:00.000Z");
const TITLE = "Application to Register Permanent Residence or Adjust Status (I-485)";
const DEFAULT_FILE = path.resolve(__dirname, "../../../../dev-assets/uscis/i-485_2026_04_09.pdf");
const MIN_FIELD_COUNT = 10;
// Representative set — I-485 applies broadly across every immigrant
// (green-card) pathway once processingPath=ADJUSTMENT_OF_STATUS; the
// VisaFormMapping registry (not this list) is what actually decides
// per-case applicability. This visaTypes tag only matters for the legacy
// assignmentRules fallback path, kept in sync with the registry's own
// I-485 entries.
const VISA_TYPES = [
  "EB-1A", "EB-1B", "EB-1C", "EB-2 PERM", "EB-2 NIW",
  "EB-3 Skilled Worker", "EB-3 Professional", "EB-3 Other Worker", "EB-4",
  "EB-5 Regional Center", "EB-5 Standalone",
  "K-1", "K-3", "U-1", "U derivative", "Adjustment of Status",
];

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

async function seedI485Template({ file } = {}) {
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
  template.visaTypes = Array.from(new Set([...(template.visaTypes || []), ...VISA_TYPES]));
  template.editionDate = template.editionDate || EDITION_DATE;
  template.title = TITLE;
  await template.save();

  return { template, fieldCount };
}

module.exports = seedI485Template;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI485Template({}))
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
