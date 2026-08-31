/**
 * f4-remove-legacy-evidence-items.js
 *
 * The generic "Education"/"Employment"/"business"/"immigration"/"employment"/
 * "identity" checklist items on B003/B003-A came from the now-deactivated
 * legacy h1b_questionnaire and uscis_library_* references (see
 * f4-deactivate-redundant-references.js) - mergeChecklist() had already
 * copied them into checklistItems/documentChecklist before those references
 * were deactivated, and deactivating a reference doesn't retroactively
 * remove items it already merged. These items have no real upload path in
 * either checklist UI (they belong to a superseded questionnaire), so they
 * block documentsComplete indefinitely. Removing them here, now that their
 * source questionnaire is confirmed redundant.
 *
 * Run: node Backend/scripts/f4-remove-legacy-evidence-items.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

const LEGACY_ITEM_NAMES = new Set(["education", "employment", "business", "immigration", "identity"]);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected\n");

  const Case = require("../src/models/Case");
  const cases = await Case.find({ caseNumber: { $in: ["B003", "B003-A"] } });

  for (const caseDoc of cases) {
    console.log(`\n${caseDoc.caseNumber}`);
    const keep = (item) => {
      const key = String(item.documentType || item.name || "").toLowerCase();
      if (LEGACY_ITEM_NAMES.has(key)) {
        console.log(`  removing legacy evidence item "${item.documentType || item.name}"`);
        return false;
      }
      return true;
    };
    const before = caseDoc.checklistItems.length;
    caseDoc.checklistItems = caseDoc.checklistItems.filter(keep);
    caseDoc.documentChecklist = caseDoc.documentChecklist.filter(keep);
    await caseDoc.save();
    console.log(`  ${before} -> ${caseDoc.checklistItems.length} items`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
