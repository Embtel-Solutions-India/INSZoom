// Creates the Document record (what the Admin case page lists under "Uploaded Documents") for every file a client already uploaded to a checklist
// question but that never got one - e.g. questions whose category name was not an allowed Document category (O-1A/O-1B, EB-1B, P, E-2 ...),
// whose Document.create used to fail silently. Additive and idempotent: it only CREATES missing records (matched by case + document type +
// storage key, exactly like the live sync) - no answer, file or existing document is changed or removed.
//   node scripts/sync-missing-answer-documents.js            DRY RUN: lists what would be created
//   node scripts/sync-missing-answer-documents.js --apply    creates the missing Document records
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

(async () => {
  const env = require("../src/config/env");
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 15000 });
  const Answer = require("../src/models/Answer");
  const Document = require("../src/models/Document");
  const Question = require("../src/models/Question");
  const Case = require("../src/models/Case");
  const questionnaireService = require("../src/modules/questionnaires/questionnaire.service");

  console.log(APPLY ? "APPLY" : "DRY RUN", "| db:", mongoose.connection.name);
  const answers = await Answer.find({ "files.0": { $exists: true } }).select("caseId question questionKey files user").lean();
  const caseIds = [...new Set(answers.map((answer) => String(answer.caseId)).filter(Boolean))];
  const existing = await Document.find({ caseId: { $in: caseIds } }).select("caseId storageKey").lean();
  const have = new Set(existing.map((doc) => `${doc.caseId}|${doc.storageKey}`));
  const questions = new Map((await Question.find({ _id: { $in: [...new Set(answers.map((answer) => String(answer.question)))] } }).lean()).map((q) => [String(q._id), q]));
  const cases = new Map((await Case.find({ _id: { $in: caseIds } }).select("caseNumber visaType").lean()).map((c) => [String(c._id), `${c.caseNumber} ${c.visaType}`]));

  let missing = 0;
  let created = 0;
  for (const answer of answers) {
    const question = questions.get(String(answer.question));
    if (!question || !answer.caseId) continue;
    const todo = answer.files.filter((file) => file.storageKey && !have.has(`${answer.caseId}|${file.storageKey}`));
    if (!todo.length) continue;
    missing += todo.length;
    const { category } = questionnaireService.documentCategoryFor(question);
    console.log(`  ${cases.get(String(answer.caseId)) || answer.caseId} | ${question.key} | ${todo.length} file(s) -> category "${category}"`);
    if (APPLY) {
      const synced = await questionnaireService.syncDocumentRecordsFromFileAnswer(question, todo, answer.caseId, { _id: answer.user }, undefined);
      created += synced.length;
    }
  }
  console.log(`files without a Document record: ${missing}${APPLY ? ` | Document records now present: ${created}` : " (re-run with --apply to create them)"}`);
  await mongoose.disconnect();
})().catch((error) => { console.error("Failed:", error.message); process.exit(1); });
