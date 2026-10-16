#!/usr/bin/env node
// node src/scripts/fillMissingEditionDatesFromPdfFooter.js            # dry run (default): reads, reports, writes nothing
// node src/scripts/fillMissingEditionDatesFromPdfFooter.js --apply    # writes
//
// Templates imported before editions were always recorded have no editionDate. For each one this reads the edition USCIS prints in the footer of the template's OWN
// stored PDF (the only source used) and, when it is unambiguous, sets editionDate and importMetadata.editionDateSource = "pdf". Nothing else changes: not the version, not
// the stored file, not the status. The update only applies while editionDate is still empty, so it never overwrites a date. Templates whose PDF prints no unambiguous
// edition are listed and left alone. Idempotent.
const { extractEditionDate, readPdfText } = require("../modules/uscis-form-import/services/FormMetadataService");

const iso = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const USCISFormTemplate = require("../models/USCISFormTemplate");
  const storageService = require("../modules/uploads/storage.service");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const missing = { $or: [{ editionDate: null }, { editionDate: { $exists: false } }] };
    const rows = await USCISFormTemplate.find(missing).select("formCode version status pdfStorageKey importMetadata.editionDateSource").lean();
    const report = { candidates: rows.length, filled: [], skipped: [] };
    for (const row of rows) {
      const label = `${row.formCode} (${row.status}, version ${row.version})`;
      try {
        if (!row.pdfStorageKey) { report.skipped.push(`${label}: no stored PDF`); continue; }
        const footer = extractEditionDate(await readPdfText(await storageService.readBuffer(row.pdfStorageKey)));
        if (!footer) { report.skipped.push(`${label}: the PDF prints no unambiguous edition`); continue; }
        if (apply) {
          const result = await USCISFormTemplate.updateOne({ _id: row._id, ...missing }, { $set: { editionDate: footer, "importMetadata.editionDateSource": "pdf" } });
          if (result.modifiedCount !== 1) { report.skipped.push(`${label}: changed while running, left alone`); continue; }
        }
        report.filled.push(`${label} -> ${iso(footer)}`);
      } catch (error) {
        report.skipped.push(`${label}: ${error.message}`);
      }
    }
    console.log(JSON.stringify({ mode: apply ? "APPLIED" : "dry run (nothing written)", candidates: report.candidates, filled: report.filled, skipped: report.skipped }, null, 1));
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.message); process.exit(1); });

module.exports = { main };
