// node src/modules/uscis-form-import/scripts/relabelTemplate.js --formCode=I-129
//
// Re-runs FieldLabelEnrichmentService against an ALREADY-imported
// USCISFormTemplate's active version, for templates imported before that
// enrichment step existed (or after the crosswalk it reads from gained new
// edges). Re-scans the template's own stored PDF artifact to get real /TU
// tooltip text (the stored formFields don't carry it - see
// FieldLabelEnrichmentService's own note on why persisting it isn't
// viable), then merges just the derived label fields back onto the
// existing formFields subdocuments, without touching anything else
// (widgets/appearance/mappings/etc. stay exactly as originally imported).
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const PDFFieldScannerService = require("../services/PDFFieldScannerService");
const FieldLabelEnrichmentService = require("../services/FieldLabelEnrichmentService");
const storageService = require("../../uploads/storage.service");
const { normalizePdf } = require("../../../utils/normalizePdf");

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  });
  return args;
}

async function relabelTemplate(formCode, { dryRun = false } = {}) {
  const template = await USCISFormTemplate.findOne({ formCode, status: "active" });
  if (!template) {
    const error = new Error(`No active template found for formCode ${formCode}`);
    error.code = "TEMPLATE_NOT_FOUND";
    throw error;
  }
  const key = template.artifacts?.form?.storageKey || template.pdfStorageKey;
  if (!key) {
    const error = new Error(`Template ${template._id} has no stored PDF artifact to re-scan`);
    error.code = "NO_PDF_ARTIFACT";
    throw error;
  }
  // the work is TemplateLabelHealService's (the pipeline runs the same code by itself); this script only runs it on demand for one form
  const heal = require("../services/TemplateLabelHealService");
  const { enriched, changes } = await heal.computeChanges(template);
  if (dryRun) return { template, fieldCount: enriched.length, labelSourceCounts: {}, changes, dryRun: true };
  await heal.applyChanges(template, { enriched, changes });
  const labelSourceCounts = {};
  enriched.forEach((field) => {
    labelSourceCounts[field.labelSource || "uscis_use_only"] = (labelSourceCounts[field.labelSource || "uscis_use_only"] || 0) + 1;
  });
  return { template, fieldCount: enriched.length, labelSourceCounts, changes };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.formCode) {
    console.error("Usage: node relabelTemplate.js --formCode=I-129 [--dry-run]");
    process.exit(1);
  }
  mongoose
    .connect(env.mongoUri)
    .then(() => relabelTemplate(args.formCode, { dryRun: process.argv.includes("--dry-run") }))
    .then(({ template, fieldCount, labelSourceCounts, changes, dryRun }) => {
      changes.forEach((item) => console.log(`  ${item.field.split(".").slice(-2).join(".")}: "${item.from}" -> "${item.to}" (${item.source})${item.typeFrom !== item.typeTo ? ` [type ${item.typeFrom} -> ${item.typeTo}]` : ""}`));
      if (dryRun) return console.log(`DRY RUN - ${changes.length} label(s) would change; nothing was saved.`);
      console.log(`Re-labeled ${template.formCode} ${template.version} (${template._id}) - ${fieldCount} fields.`);
      console.log("Label source distribution:", JSON.stringify(labelSourceCounts, null, 2));
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Re-labeling failed:", error.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { relabelTemplate };
