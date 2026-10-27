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
  const raw = await storageService.readBuffer(key);
  const normalized = await normalizePdf(raw);
  const scanner = new PDFFieldScannerService();
  const scanResult = await scanner.scan(normalized);

  const tooltipQueueByName = new Map();
  scanResult.fields.forEach((field) => {
    const queue = tooltipQueueByName.get(field.fieldName) || [];
    queue.push({ tooltip: field.tooltip, type: field.type });
    tooltipQueueByName.set(field.fieldName, queue);
  });
  const cursorByName = new Map();
  const withTooltip = template.formFields.map((field) => {
    const plain = field.toObject ? field.toObject() : field;
    const cursor = cursorByName.get(plain.fieldName) || 0;
    cursorByName.set(plain.fieldName, cursor + 1);
    const rescanned = (tooltipQueueByName.get(plain.fieldName) || [])[cursor] || {};
    return { ...plain, tooltip: rescanned.tooltip, rescannedType: rescanned.type };
  });

  // the text printed beside a box wins over a tooltip / name it contradicts (VisibleTextLabelService)
  const visibleLabels = await require("../services/VisibleTextLabelService").collect(normalized, withTooltip);
  const enriched = FieldLabelEnrichmentService.enrichFields(withTooltip, template.formCode, { visibleLabels }).map(({ rescannedType, ...field }) => {
    // a box stored as an SSN only because its name contains the letters "ssn" (BusiNESSName) goes back to what a fresh scan says it is
    if (field.type === "ssn" && rescannedType && rescannedType !== "ssn") {
      const fix = (value) => (value === "ssn" ? rescannedType : value);
      return { ...field, type: rescannedType, fieldType: fix(field.fieldType), semanticType: fix(field.semanticType) };
    }
    return field;
  });
  const changes = enriched.map((field, index) => ({ field: field.fieldName, from: template.formFields[index]?.label, to: field.label, source: field.labelSource, typeFrom: template.formFields[index]?.type, typeTo: field.type })).filter((item) => item.from !== item.to || item.typeFrom !== item.typeTo);
  if (dryRun) return { template, fieldCount: enriched.length, labelSourceCounts: {}, changes, dryRun: true };
  template.formFields = enriched;
  template.markModified("formFields");
  await template.save();

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
