// node src/modules/uscis-form-import/seeds/i134.seed.js
// (or: npm run seed:i134, from Backend/)
//
// Imports (if not already present) and activates the bundled I-134
// (edition 2025-01-20) so uscis-form.service.js's
// latestTemplatesByAssignmentRules()/templateAppliesToCase() will assign it
// to K-1 and K-3 cases. Idempotent and non-destructive.

const path = require("path");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const storageService = require("../../uploads/storage.service");
const importLocalForm = require("../scripts/importLocalForm");

const FORM_CODE = "I-134";
const VERSION = "2025-01-20";
const EDITION_DATE = new Date("2025-01-20T00:00:00.000Z");
const TITLE = "Declaration of Financial Support (I-134)";
const DEFAULT_FILE = path.resolve(__dirname, "../../../../dev-assets/uscis/i-134_2025-01-20.pdf");
const MIN_FIELD_COUNT = 10;

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

async function seedI134Template({ file } = {}) {
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

  const fieldCount = await verifyFillable(template.pdfStorageKey);

  template.status = "active";
  template.activeFlag = true;
  template.officialStatus = "current";
  template.visaTypes = Array.from(new Set([...(template.visaTypes || []), "K-1", "K-3"]));
  template.editionDate = template.editionDate || EDITION_DATE;
  template.title = TITLE;
  await template.save();

  return { template, fieldCount };
}

module.exports = seedI134Template;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI134Template({}))
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
