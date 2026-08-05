// node src/scripts/backfillFamilyChecklistReferences.js [--dry-run]
//
// Idempotent backfill for family (K-1/K-3) cases created before
// family-workflow.controller.js#createFamilyCase started calling
// ensureFamilyChecklistReferences at creation time. Reuses that exact
// function (not a parallel path) — never creates a Questionnaire template;
// a missing template is reported as a skip. Safe to re-run: the dedup check
// inside ensureFamilyChecklistReferences means a second run reports
// everything as "already_present" and writes nothing.
const mongoose = require("mongoose");
const env = require("../config/env");
const Case = require("../models/Case");
const User = require("../models/User");
const { ensureFamilyChecklistReferences } = require("../modules/family-workflow/family-workflow.controller");

async function backfillFamilyChecklistReferences({ dryRun = false } = {}) {
  const cases = await Case.find({
    $or: [
      { petitionerUser: { $exists: true, $ne: null } },
      { beneficiaryUser: { $exists: true, $ne: null } },
    ],
  });

  const summary = { casesScanned: cases.length, already_present: 0, assigned: 0, would_assign: 0, template_not_found: 0, skipped_no_actor: 0 };
  const perCase = [];

  for (const caseData of cases) {
    const actor = caseData.petitionerUser ? await User.findById(caseData.petitionerUser) : null;
    if (!actor) {
      summary.skipped_no_actor += 1;
      perCase.push({ caseNumber: caseData.caseNumber, status: "skipped_no_actor" });
      continue;
    }
    const results = await ensureFamilyChecklistReferences(caseData, actor, null, { dryRun });
    results.forEach((result) => { summary[result.status] = (summary[result.status] || 0) + 1; });
    perCase.push({ caseNumber: caseData.caseNumber, visaType: caseData.visaType, results });
  }

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Family checklist reference backfill`);
  console.log("Cases scanned:", summary.casesScanned);
  console.log("Already present:", summary.already_present);
  console.log(dryRun ? "Would assign:" : "Assigned:", dryRun ? summary.would_assign : summary.assigned);
  console.log("Template not found:", summary.template_not_found);
  console.log("Skipped (no resolvable petitioner user):", summary.skipped_no_actor);
  console.log("\nPer-case detail:");
  perCase.forEach((entry) => console.log(`  ${entry.caseNumber || "(no case number)"} [${entry.visaType || "?"}]`, JSON.stringify(entry.results || entry.status)));

  return summary;
}

module.exports = backfillFamilyChecklistReferences;

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  mongoose
    .connect(env.mongoUri)
    .then(() => backfillFamilyChecklistReferences({ dryRun }))
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to backfill family checklist references:", error);
      process.exit(1);
    });
}
