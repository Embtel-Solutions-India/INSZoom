/**
 * f4-backfill-document-records.js
 *
 * F-4 fix for N1: saveFileAnswer (questionnaire.service.js) previously wrote
 * uploaded files only into Answer.files, never into the Document collection
 * that CaseLifecycleOrchestrator.metrics()'s documentsComplete gate actually
 * reads. That's now fixed going forward (syncDocumentRecordsFromFileAnswer,
 * called from saveAnswers on every file-type answer). This script backfills
 * Document records for file answers that were saved BEFORE that fix existed
 * - specifically B003 (employer) and B003-A (employee) from the F-3 run.
 *
 * Idempotent - reuses questionnaire.service.js's own sync function, which
 * already matches on caseId + documentType + storageKey before creating.
 *
 * Run: node Backend/scripts/f4-backfill-document-records.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected\n");

  const Case = require("../src/models/Case");
  const Answer = require("../src/models/Answer");
  const Document = require("../src/models/Document");
  const { syncDocumentRecordsFromFileAnswer } = require("../src/modules/questionnaires/questionnaire.service");

  const cases = await Case.find({ caseNumber: { $in: ["B003", "B003-A"] } }).lean();

  for (const caseDoc of cases) {
    console.log(`\n${caseDoc.caseNumber} (${caseDoc._id})`);
    const answersWithFiles = await Answer.find({ caseId: caseDoc._id, "files.0": { $exists: true } })
      .populate({ path: "question", select: "key type fileConstraints metadata evidenceCategory" })
      .lean();
    console.log(`  ${answersWithFiles.length} file answers found`);

    for (const answer of answersWithFiles) {
      if (!answer.question) {
        console.log(`  SKIP (question not populated) for questionKey ${answer.questionKey}`);
        continue;
      }
      const synced = await syncDocumentRecordsFromFileAnswer(answer.question, answer.files, caseDoc._id, { _id: answer.user }, {});
      console.log(`  ${answer.questionKey}: ${synced.length} Document record(s) ensured`);
    }
  }

  const b003 = cases.find((c) => c.caseNumber === "B003");
  const b003a = cases.find((c) => c.caseNumber === "B003-A");
  console.log("\n=== Verification ===");
  console.log("B003 Document count:", await Document.countDocuments({ caseId: b003._id }));
  console.log("B003-A Document count:", await Document.countDocuments({ caseId: b003a._id }));

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
