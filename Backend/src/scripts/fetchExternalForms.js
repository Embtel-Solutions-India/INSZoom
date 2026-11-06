// Runs the DOL ETA-9089 forms (uscis-form-import/config/externalForms.js) through the SAME pipeline the 12-hourly sync uses, once, now - instead of waiting for the next scheduled sync.
// Append-only: it imports / checks the two forms and activates them through the normal gates; it never touches any other form and never creates a case.
//
//   node src/scripts/fetchExternalForms.js            DRY RUN: shows what is installed now for the two forms and whether the official files can be fetched (read-only)
//   node src/scripts/fetchExternalForms.js --apply    runs the pipeline for the two forms (fetch, normalize, import, map, certify, activate)
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

async function main() {
  const { externalFormCodes } = require("../modules/uscis-form-import/config/externalForms");
  const USCISFormTemplate = require("../models/USCISFormTemplate");
  const User = require("../models/User");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const show = async (label) => {
    console.log(`\n${label}`);
    for (const formCode of externalFormCodes()) {
      const rows = await USCISFormTemplate.find({ formCode }).select("formCode version status mappingStatus editionDate importMetadata.editionDateSource lifecycle.external.internalVersion formFields").lean();
      if (!rows.length) { console.log(`  ${formCode}: not installed`); continue; }
      for (const row of rows) console.log(`  ${formCode} ${row.version}  status=${row.status} mapping=${row.mappingStatus} boxes=${(row.formFields || []).length} edition=${row.editionDate ? new Date(row.editionDate).toISOString().slice(0, 10) : "-"} (${row.importMetadata?.editionDateSource || "-"}) ${row.lifecycle?.external?.internalVersion || ""}`);
    }
  };
  await show(APPLY ? "BEFORE" : "DRY RUN - installed now");
  if (!APPLY) { console.log("\nnothing written (add --apply to run the pipeline for these two forms)"); return; }
  const actor = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  const { runExternalFormsSync } = require("../modules/uscis-form-import/services/ExternalFormsSyncService");
  const result = await runExternalFormsSync({ user: actor || { role: "super_admin" } });
  console.log("\nRESULT", JSON.stringify(result, null, 1));
  await show("AFTER");
}

main().then(() => mongoose.disconnect().then(() => process.exit(0))).catch(async (error) => { console.error("FAILED:", error.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
