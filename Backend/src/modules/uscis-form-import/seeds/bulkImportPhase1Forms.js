// node src/modules/uscis-form-import/seeds/bulkImportPhase1Forms.js
//
// Phase 1 (forms production-readiness pass) — imports and activates every
// dev-assets/uscis/*.pdf form that visaFormMappings.seed.js ALREADY
// references by formTemplateFormCode/parentForm but that has no
// USCISFormTemplate registered yet. These are net-new to the form-registry
// pipeline (see docs from the analysis pass) — the mapping ROWS across the
// visa matrix already exist and are correct; only the template import was
// missing, which is why every one of these forms silently never became
// TEMPLATE_AVAILABLE for any real case.
//
// Follows the exact pattern i129.seed.js/importLocalForm.js already
// established: import from the local dev-assets file (never touches the
// direct uscis.gov fetch path — that stays available separately for forms
// not already sitting in dev-assets, e.g. I-130A/I-864A/I-918 Supp A/B,
// fetched live in the same pass this script is part of), then activate and
// set visaTypes from the registry itself (deriveVisaTypesFromRegistry) so
// this can never hardcode a visa list that drifts from the mapping data.
// Idempotent: importLocalForm/importFromBuffer already update an existing
// formCode+version template in place rather than duplicating.
const path = require("path");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const importLocalForm = require("../scripts/importLocalForm");
const { deriveVisaTypesFromRegistry } = require("./deriveVisaTypesFromRegistry");

const DEV_ASSETS_DIR = path.resolve(__dirname, "../../../../dev-assets/uscis");

// { formCode, file, version, editionDate, title }
const FORMS = [
  { formCode: "I-90", file: "i-90_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Application to Replace Permanent Resident Card (I-90)" },
  { formCode: "I-129S", file: "i-129s_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Nonimmigrant Petition Based on Blanket L Petition (I-129S)" },
  { formCode: "I-131", file: "i-131_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Application for Travel Documents, Parole Documents, and Arrival/Departure Records (I-131)" },
  { formCode: "I-360", file: "i-360_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Petition for Amerasian, Widow(er), or Special Immigrant (I-360)" },
  { formCode: "I-485", file: "i-485_2026_04_09.pdf", version: "2026-04-09", editionDate: "2026-04-09", title: "Application to Register Permanent Residence or Adjust Status (I-485)" },
  { formCode: "I-526", file: "i-526_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Immigrant Petition by Standalone Investor (I-526)" },
  { formCode: "I-526E", file: "i-526e_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Immigrant Petition by Regional Center Investor (I-526E)" },
  { formCode: "I-612", file: "i-612_2024-01-04.pdf", version: "2024-01-04", editionDate: "2024-01-04", title: "Application for Waiver of the Foreign Residence Requirement (I-612)" },
  { formCode: "I-693", file: "i-693_2025_20_01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Report of Immigration Medical Examination and Vaccination Record (I-693)" },
  { formCode: "I-751", file: "i-751_2024-01-04.pdf", version: "2024-01-04", editionDate: "2024-01-04", title: "Petition to Remove Conditions on Residence (I-751)" },
  { formCode: "I-765", file: "i-765_2025-21-08.pdf", version: "2025-08-21", editionDate: "2025-08-21", title: "Application for Employment Authorization (I-765)" },
  { formCode: "I-824", file: "i-824_2024-01-04.pdf", version: "2024-01-04", editionDate: "2024-01-04", title: "Application for Action on an Approved Application or Petition (I-824)" },
  { formCode: "I-829", file: "i-829_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Petition by Investor to Remove Conditions on Permanent Resident Status (I-829)" },
  { formCode: "I-864", file: "i-864_2026-24-08.pdf", version: "2026-08-24", editionDate: "2026-08-24", title: "Affidavit of Support Under Section 213A of the INA (I-864)" },
  { formCode: "I-864EZ", file: "i-864ez_2026-24-08.pdf", version: "2026-08-24", editionDate: "2026-08-24", title: "Affidavit of Support Under Section 213A of the INA (I-864EZ)" },
  { formCode: "N-400", file: "n-400_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Application for Naturalization (N-400)" },
  { formCode: "N-565", file: "n-565_2025-27-02.pdf", version: "2025-02-27", editionDate: "2025-02-27", title: "Application for Replacement Naturalization/Citizenship Document (N-565)" },
  { formCode: "N-600", file: "n-600_2025-20-01.pdf", version: "2025-01-20", editionDate: "2025-01-20", title: "Application for Certificate of Citizenship (N-600)" },
];

async function run() {
  const results = [];
  for (const form of FORMS) {
    const existing = await USCISFormTemplate.findOne({ formCode: form.formCode, active: true }).lean();
    if (existing) {
      results.push({ formCode: form.formCode, skipped: true, reason: "already active" });
      continue;
    }
    try {
      const filePath = path.join(DEV_ASSETS_DIR, form.file);
      const visaTypes = await deriveVisaTypesFromRegistry(form.formCode);
      const importResult = await importLocalForm({
        file: filePath,
        formCode: form.formCode,
        version: form.version,
        editionDate: form.editionDate,
        title: form.title,
        visaTypes: visaTypes.join(","),
        activate: true,
      });
      results.push({
        formCode: form.formCode,
        templateId: String(importResult.template._id),
        fieldCount: importResult.scanResult?.fieldCount,
        visaTypes,
      });
    } catch (error) {
      results.push({ formCode: form.formCode, error: error.message, code: error.code });
    }
  }
  return results;
}

module.exports = { run, FORMS };

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(run)
    .then((results) => {
      console.log(JSON.stringify(results, null, 2));
      const failed = results.filter((r) => r.error);
      console.log(`\nDone. ${results.length - failed.length - results.filter(r=>r.skipped).length} imported, ${results.filter(r=>r.skipped).length} already active, ${failed.length} failed.`);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Bulk import failed:", error);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
