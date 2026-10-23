// One-off, per case: puts back the questions that edits switched off in ONE case's private copy of ONE checklist, so the case is served the checklist as it was
// before the edits. Only questions that are active in the shared template and inactive in the case copy are touched (a removal is just active=false, so this
// is exactly the undo). Nothing else changes: no labels, answers, references or other cases. Dry run unless --apply; a backup file is written before applying.
//
//   node src/scripts/restoreCaseChecklistQuestions.js <caseId like B420> <checklist template key>          (dry run)
//   node src/scripts/restoreCaseChecklistQuestions.js <caseId like B420> <checklist template key> --apply
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const isActive = (question) => question.active !== false && question.isActive !== false;

async function main() {
  const [caseLabel, templateKey] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const apply = process.argv.includes("--apply");
  if (!caseLabel || !templateKey) throw new Error("usage: <caseId like B420> <checklist template key> [--apply]");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const Case = require("../models/Case");
  const Questionnaire = require("../models/Questionnaire");
  const Question = require("../models/Question");

  const caseDoc = await Case.findOne({ caseId: caseLabel }).select("caseId questionnaireReferences").lean();
  if (!caseDoc) throw new Error(`case ${caseLabel} not found`);
  const copyKey = `${templateKey}__case_${caseDoc._id}`;
  const copy = await Questionnaire.findOne({ key: copyKey, latestVersion: true }).lean();
  if (!copy) throw new Error(`${caseLabel} has no private copy of ${templateKey} (${copyKey})`);
  const template = await Questionnaire.findOne({ key: templateKey, latestVersion: true }).lean();
  if (!template) throw new Error(`template ${templateKey} not found`);

  const [copyQuestions, templateQuestions] = await Promise.all([Question.find({ questionnaire: copy._id }).lean(), Question.find({ questionnaire: template._id }).lean()]);
  const templateByKey = new Map(templateQuestions.map((question) => [question.key, question]));
  const toRestore = copyQuestions.filter((question) => !isActive(question) && templateByKey.has(question.key) && isActive(templateByKey.get(question.key)));
  const stillOff = copyQuestions.filter((question) => !isActive(question) && !toRestore.includes(question));

  console.log(`${caseLabel} (${caseDoc._id}) - copy ${copy.key}: ${copyQuestions.length} questions, ${copyQuestions.filter(isActive).length} active; template has ${templateQuestions.filter(isActive).length} active`);
  console.log(`to restore: ${toRestore.length}; inactive and left alone (not active in the template either): ${stillOff.length}`);
  toRestore.forEach((question) => console.log(`  ${question.key} | ${String(question.label || "").slice(0, 70)}`));
  if (!apply) { console.log("DRY RUN - nothing written. Add --apply to restore."); return; }

  const dir = path.join(__dirname, "..", "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `checklist-restore-${caseLabel}-${templateKey}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(toRestore.map((question) => ({ _id: question._id, key: question.key, active: question.active, isActive: question.isActive })), null, 2));
  const result = await Question.updateMany({ _id: { $in: toRestore.map((question) => question._id) } }, { $set: { active: true, isActive: true } });
  console.log(`restored ${result.modifiedCount} questions. Backup of their previous state: ${file}`);
}

main().then(() => process.exit(0)).catch((error) => { console.error("ERR", error.message); process.exit(1); });
