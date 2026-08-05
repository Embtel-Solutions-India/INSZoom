// node src/modules/uscis-form-import/seeds/i129.seed.js
// (or: npm run seed:i129, from Backend/)
//
// Phase H0 — imports (if not already present) and activates/tags the bundled
// I-129 (edition 02/27/26) so uscis-form.service.js's
// latestTemplatesByAssignmentRules()/templateAppliesToCase() will assign it
// to an H-1B case. Idempotent and non-destructive: re-running this updates
// the SAME template's activation/tagging fields in place - it never
// deletes, duplicates, or reseeds. If more than one I-129/2026-02-27
// template is found, or the stored PDF isn't fillable, it stops and reports
// rather than guessing or silently repairing.
//
// Deliberately reuses Backend/src/utils/normalizePdf.js (already wired into
// USCISFormImporterService.importFromBuffer, already covered by its own
// unit + integration tests) rather than introducing a second,
// near-identical qpdf-normalization service - this file only adds the
// activation/tagging step the importer intentionally leaves to a human/seed
// step (see USCISFormImporterService.js and USCISFormTemplate.js).
const path = require("path");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const storageService = require("../../uploads/storage.service");
const importLocalForm = require("../scripts/importLocalForm");

const FORM_CODE = "I-129";
const VERSION = "2026-02-27";
const EDITION_DATE = new Date("2026-02-27T00:00:00.000Z");
const TITLE = "Petition for a Nonimmigrant Worker (I-129)";
const DEFAULT_FILE = path.resolve(__dirname, "../../../../dev-assets/uscis/i-129_2026-02-27.pdf");
// Empirically ~980 on the real 02/27/26 edition; 900 leaves headroom for a
// future edition with a handful fewer fields while still catching a
// genuinely broken/truncated scan.
const MIN_FIELD_COUNT = 900;

async function verifyFillable(pdfStorageKey) {
  const buffer = await storageService.readBuffer(pdfStorageKey);
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const fieldCount = pdf.getForm().getFields().length;
  if (fieldCount < MIN_FIELD_COUNT) {
    const error = new Error(
      `Stored I-129 template PDF at "${pdfStorageKey}" only exposes ${fieldCount} fillable fields ` +
      `(expected >= ${MIN_FIELD_COUNT}). This does not look like a correctly normalized/fillable I-129 - ` +
      `stopping rather than activating a template whose stored artifact can't actually be filled. ` +
      `Investigate the stored artifact before re-running this seed.`
    );
    error.code = "I129_TEMPLATE_NOT_FILLABLE";
    throw error;
  }
  return fieldCount;
}

async function seedI129Template({ file } = {}) {
  const existing = await USCISFormTemplate.find({ formCode: FORM_CODE, version: VERSION });
  if (existing.length > 1) {
    const error = new Error(
      `Found ${existing.length} USCISFormTemplate records for ${FORM_CODE} ${VERSION} - expected at most 1. ` +
      `Refusing to guess which one is authoritative or delete either; resolve manually before re-running this seed.`
    );
    error.code = "I129_TEMPLATE_AMBIGUOUS";
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
  template.visaTypes = Array.from(new Set([...(template.visaTypes || []), "H-1B", "L-1A", "L-1B"]));
  template.editionDate = template.editionDate || EDITION_DATE;
  template.title = TITLE;
  await template.save();

  return { template, fieldCount };
}

module.exports = seedI129Template;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI129Template({}))
    .then(({ template, fieldCount }) => {
      console.log("I-129 template seeded and activated.");
      console.log("  templateId:", String(template._id));
      console.log("  status:", template.status, "| activeFlag:", template.activeFlag, "| officialStatus:", template.officialStatus);
      console.log("  visaTypes:", template.visaTypes);
      console.log("  editionDate:", template.editionDate);
      console.log("  fieldCount:", fieldCount);
      console.log("  pdfStorageKey:", template.pdfStorageKey);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Failed to seed I-129 template:", error.message);
      if (error.code) console.error("  code:", error.code);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
