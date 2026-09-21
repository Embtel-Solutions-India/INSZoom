/**
 * eb1a-criteria-migration.js
 *
 * EB-1A moved from a throwaway 4-item flat checklist (Passport, Awards /
 * Recognition, Publications, Recommendation Letters — the old
 * VISA_CHECKLISTS["EB-1A"] entry) to a real 10-criteria checklist (see
 * src/config/eb1a.js). Existing EB-1A cases created before this change are
 * still on the old flat items and need the new criteria items appended.
 *
 * For already-uploaded legacy files, this script only auto-maps a legacy
 * item onto a new criterion when the mapping is unambiguous
 * (UNAMBIGUOUS_LEGACY_MAP). Ambiguous ones (AMBIGUOUS_LEGACY_NAMES —
 * "Publications" could be Criterion 3 (about the beneficiary) or Criterion 6
 * (authored by the beneficiary); "Recommendation Letters" could support
 * several different criteria depending on content) are only ever flagged in
 * the report for a Case Manager to reassign by hand — same "flag, don't
 * guess" convention as f4-clean-checklist-role-contamination.js. The legacy
 * item itself is never deleted, only annotated once its files are copied.
 *
 * Defaults to a DRY RUN (prints the report, writes nothing). Pass --apply to
 * actually save changes. Idempotent - safe to run multiple times; a case
 * that already has criterion-tagged items is left alone.
 *
 * Run (dry run):  node Backend/scripts/eb1a-criteria-migration.js
 * Run (apply):    node Backend/scripts/eb1a-criteria-migration.js --apply
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

const UNAMBIGUOUS_LEGACY_MAP = {
  "Awards / Recognition": "EB1A_CRITERION_1",
};
const AMBIGUOUS_LEGACY_NAMES = new Set(["Publications", "Recommendation Letters"]);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected (${APPLY ? "APPLY" : "DRY RUN — pass --apply to write changes"})\n`);

  const Case = require("../src/models/Case");
  const { normalizeVisaType } = require("../src/config/visaTypes");
  const eb1a = require("../src/config/eb1a");

  const candidates = await Case.find({});
  const eb1aCases = candidates.filter((caseDoc) => normalizeVisaType(caseDoc.visaType) === "EB1A");
  console.log(`Found ${eb1aCases.length} EB-1A case(s)\n`);

  const newTemplates = eb1a.toCaseChecklistItems();

  for (const caseDoc of eb1aCases) {
    console.log(`\n${caseDoc.caseNumber || caseDoc._id} —`);
    const alreadyCriteriaBased = caseDoc.checklistItems.some((item) => item.criterionId);
    if (alreadyCriteriaBased) {
      console.log("  already has criterion-tagged items — skipping (idempotent no-op)");
      continue;
    }

    const existingTypes = new Set(caseDoc.checklistItems.map((item) => item.documentType).filter(Boolean));
    const toAppend = newTemplates.filter((template) => !existingTypes.has(template.documentType));
    console.log(`  will append ${toAppend.length} new criteria checklist item(s)`);

    const fileMoves = [];
    for (const legacyItem of caseDoc.checklistItems) {
      const uploadedCount = (legacyItem.uploadedFiles || []).length;
      if (!uploadedCount) continue;
      const mappedCriterion = UNAMBIGUOUS_LEGACY_MAP[legacyItem.name];
      if (mappedCriterion) {
        console.log(`  MAP: "${legacyItem.name}" (${uploadedCount} file(s)) -> ${mappedCriterion}`);
        fileMoves.push({ legacyItem, mappedCriterion });
      } else if (AMBIGUOUS_LEGACY_NAMES.has(legacyItem.name)) {
        console.log(`  FLAG for manual review: "${legacyItem.name}" has ${uploadedCount} uploaded file(s) but no unambiguous criterion mapping — a Case Manager must reassign these`);
      }
    }

    if (!APPLY) continue;

    caseDoc.checklistItems.push(...toAppend);
    for (const { legacyItem, mappedCriterion } of fileMoves) {
      const target = caseDoc.checklistItems.find((item) => item.criterionId === mappedCriterion && !(item.uploadedFiles || []).length);
      if (!target) {
        console.log(`  (no empty target item found for ${mappedCriterion} — left "${legacyItem.name}" as-is)`);
        continue;
      }
      target.uploadedFiles.push(...legacyItem.uploadedFiles);
      target.status = "submitted";
      target.submittedAt = target.submittedAt || new Date();
      legacyItem.adminNotes = [legacyItem.adminNotes, `[eb1a-criteria-migration] files copied onto ${mappedCriterion}`].filter(Boolean).join("\n");
    }
    caseDoc.documentChecklist = caseDoc.checklistItems;
    await caseDoc.save();
    console.log("  saved.");
  }

  await mongoose.disconnect();
  console.log(`\nDone. ${APPLY ? "Changes applied." : "Dry run only — re-run with --apply to write changes."}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
