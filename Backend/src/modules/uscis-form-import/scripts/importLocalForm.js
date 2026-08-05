// node src/modules/uscis-form-import/scripts/importLocalForm.js \
//   --file Backend/dev-assets/uscis/i-129_2026-02-27.pdf \
//   --formCode I-129 --version 2026-02-27 \
//   --editionDate 2026-02-27 --title "Petition for a Nonimmigrant Worker (I-129)" \
//   --visaTypes H-1B --activate
// (also exposed as `npm run import:form -- <same flags>`)
//
// Local-file import branch for the USCIS form library — a dev-time entry
// point for ingesting an already-downloaded official PDF from disk, for
// cases where the file was reviewed/committed locally rather than pulled
// live from uscis.gov. Reuses importFromBuffer() exactly (the same
// validate -> checksum -> normalize -> scan -> store flow the URL-based
// importer.importFromUrl() uses) — no parallel/weakened logic, and
// importantly no change to assertOfficialUscisUrl or the download path.
//
// --activate is optional and, when present, tags/activates the resulting
// template the same way i129.seed.js already does for I-129 specifically
// (status/activeFlag/officialStatus/visaTypes/editionDate/title) - generic
// here rather than hardcoding I-129's own field-count threshold, since this
// entry point is meant to import any local form, not just I-129. Idempotent:
// importFromBuffer() already updates an existing formCode+version template
// in place rather than duplicating it, and this activation step is a plain
// field assignment + save, safe to re-run.
const path = require("path");
const fs = require("fs/promises");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const User = require("../../../models/User");
const storageService = require("../../uploads/storage.service");
const importer = require("../services/USCISFormImporterService");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
    args[key] = value;
    if (value !== true) i += 1;
  }
  return args;
}

async function resolveSystemActor() {
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  return admin || { _id: undefined, role: "super_admin" };
}

async function activateTemplate(template, { editionDate, title, visaTypes }) {
  const buffer = await storageService.readBuffer(template.pdfStorageKey);
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const fieldCount = pdf.getForm().getFields().length;
  if (fieldCount === 0) {
    const error = new Error(
      `Stored template PDF at "${template.pdfStorageKey}" exposes 0 fillable fields - refusing to activate ` +
      `a template whose stored artifact can't actually be filled. Investigate the stored artifact first.`
    );
    error.code = "FORM_TEMPLATE_NOT_FILLABLE";
    throw error;
  }
  template.status = "active";
  template.activeFlag = true;
  template.officialStatus = "current";
  if (visaTypes) {
    const requested = String(visaTypes).split(",").map((item) => item.trim()).filter(Boolean);
    template.visaTypes = Array.from(new Set([...(template.visaTypes || []), ...requested]));
  }
  if (editionDate) template.editionDate = new Date(editionDate);
  if (title) template.title = title;
  await template.save();
  return fieldCount;
}

async function importLocalForm({ file, formCode, version, category, description, editionDate, title, visaTypes, activate } = {}) {
  if (!file) throw new Error("--file <path> is required");
  const absolutePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  const buffer = await fs.readFile(absolutePath);

  const actor = await resolveSystemActor();
  const result = await importer.importFromBuffer(buffer, {
    formType: formCode,
    formCode,
    version,
    category,
    description,
    // Matches the value already used elsewhere in the codebase for a
    // human-provided (non-uscis.gov-download) PDF.
    source: "manual_upload",
  }, actor, null);

  console.log(result.duplicate ? "Duplicate detected — existing template updated." : "Imported new USCISFormTemplate.");
  console.log("  formCode:", result.template.formCode);
  console.log("  version:", result.template.version);
  console.log("  templateId:", String(result.template._id));
  console.log("  fieldCount:", result.scanResult.fieldCount);
  console.log("  pdfStorageKey:", result.template.pdfStorageKey);

  if (activate) {
    const template = await require("../../../models/USCISFormTemplate").findById(result.template._id);
    const fieldCount = await activateTemplate(template, { editionDate, title, visaTypes });
    console.log("Template activated.");
    console.log("  status:", template.status, "| activeFlag:", template.activeFlag, "| officialStatus:", template.officialStatus);
    console.log("  visaTypes:", template.visaTypes);
    console.log("  editionDate:", template.editionDate);
    console.log("  title:", template.title);
    console.log("  verifiedFieldCount:", fieldCount);
    result.template = template;
  }
  return result;
}

module.exports = importLocalForm;

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  mongoose
    .connect(env.mongoUri)
    .then(() => importLocalForm(args))
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to import local USCIS form:", error.message);
      if (error.code) console.error("  code:", error.code);
      process.exit(1);
    });
}
