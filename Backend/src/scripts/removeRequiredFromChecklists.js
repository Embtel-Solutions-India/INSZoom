// node src/scripts/removeRequiredFromChecklists.js [--apply]   (or: npm run migrate:no-required-checklists -- --apply)
//
// Nothing a client fills in is mandatory any more: every checklist question, and every document row stored on a case,
// is saved with required:false, and "required" validation rules are removed. Completeness is a separate rule - Submit
// needs every visible question answered (questionnaire.service.js submitResponse); Save progress never needs anything.
// New data is forced to required:false by the Question schema itself; this script only brings EXISTING data in line.
// Idempotent. Dry run by default; --apply writes.
const mongoose = require("mongoose");
const env = require("../config/env");
const Question = require("../models/Question");
const Case = require("../models/Case");

async function run({ apply }) {
  const summary = { questionsRequired: 0, questionsWithRequiredRule: 0, casesWithRequiredItems: 0, applied: apply };
  summary.questionsRequired = await Question.collection.countDocuments({ required: true });
  summary.questionsWithRequiredRule = await Question.collection.countDocuments({ "validationRules.type": "required" });
  summary.casesWithRequiredItems = await Case.collection.countDocuments({ $or: [{ "checklistItems.required": true }, { "documentChecklist.required": true }] });
  if (!apply) return summary;

  // Raw collection writes: the schema setter already forces false for documents saved through Mongoose, and these
  // updates must touch every existing row regardless of casting/validation.
  await Question.collection.updateMany({ required: true }, { $set: { required: false } });
  await Question.collection.updateMany({ "validationRules.type": "required" }, { $pull: { validationRules: { type: "required" } } });
  await Case.collection.updateMany({ "checklistItems.required": true }, { $set: { "checklistItems.$[item].required": false } }, { arrayFilters: [{ "item.required": true }] });
  await Case.collection.updateMany({ "documentChecklist.required": true }, { $set: { "documentChecklist.$[item].required": false } }, { arrayFilters: [{ "item.required": true }] });
  summary.after = {
    questionsRequired: await Question.collection.countDocuments({ required: true }),
    questionsWithRequiredRule: await Question.collection.countDocuments({ "validationRules.type": "required" }),
    casesWithRequiredItems: await Case.collection.countDocuments({ $or: [{ "checklistItems.required": true }, { "documentChecklist.required": true }] }),
  };
  return summary;
}

module.exports = run;

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  mongoose
    .connect(env.mongoUri)
    .then(() => run({ apply }))
    .then((summary) => { console.log(apply ? "Required flags removed:" : "DRY RUN (use --apply to write):"); console.log(JSON.stringify(summary, null, 2)); })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => { console.error("Migration failed:", error.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
