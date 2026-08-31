/**
 * f4-clean-checklist-role-contamination.js
 *
 * F-4 fix: immigration-knowledge-engine.service.js's questionnaireApplies()
 * never checked checklistRole against the case being orchestrated, so
 * orchestrate() -> mergeChecklist() (run automatically right after every
 * case creation, via initializeCase) merged BOTH the employer's and the
 * employee's full document/evidence requirement lists onto every case in
 * the family - undoing case.controller.js's own per-case role filtering
 * moments after it ran. That's now fixed at the source
 * (questionnaireApplies checks expectedChecklistRoleForCase). This script
 * removes the already-wrongly-merged, wrong-role items from B003/B003-A's
 * stored checklistItems/documentChecklist - metadata cleanup of a bug's
 * side effect, not a rewrite of any real answer/canonical data.
 *
 * Only removes an item when:
 *   - it has a targetRole set, AND
 *   - that targetRole does not match this case's expected role, AND
 *   - it has no uploaded file / non-pending status (never touches anything
 *     the user actually interacted with)
 *
 * Idempotent - safe to run multiple times.
 * Run: node Backend/scripts/f4-clean-checklist-role-contamination.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected\n");

  const Case = require("../src/models/Case");
  const ImmigrationKnowledgeEngineService = require("../src/modules/cases/immigration-knowledge-engine.service");

  const cases = await Case.find({ caseNumber: { $in: ["B003", "B003-A"] } });

  for (const caseDoc of cases) {
    const expectedRole = ImmigrationKnowledgeEngineService.expectedChecklistRoleForCase(caseDoc);
    console.log(`\n${caseDoc.caseNumber} - expected checklist role: ${expectedRole}`);

    const before = caseDoc.checklistItems.length;
    const keep = (item) => {
      if (!item.targetRole) return true; // shared/generic items stay
      if (!expectedRole) return true; // no restriction for this case shape
      if (item.targetRole === expectedRole) return true;
      const untouched = !item.status || item.status === "pending";
      if (!untouched) {
        console.log(`  KEEPING mismatched-role item "${item.documentType || item.name}" (targetRole=${item.targetRole}) - has status "${item.status}", not touching`);
        return true;
      }
      console.log(`  removing "${item.documentType || item.name}" (targetRole=${item.targetRole}, expected ${expectedRole})`);
      return false;
    };

    caseDoc.checklistItems = caseDoc.checklistItems.filter(keep);
    caseDoc.documentChecklist = caseDoc.documentChecklist.filter(keep);
    await caseDoc.save();
    console.log(`  ${before} -> ${caseDoc.checklistItems.length} items`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
