// node src/scripts/restoreRequiredFromDefinitions.js [--apply]
//
// Restores the `required` flag of the built-in checklist questions to what their code definitions say. The flag had been forced to false for every
// question (Question schema setter + scripts/removeRequiredFromChecklists.js); the setter is gone, and this puts the stored flags back WITHOUT
// touching anything else - no label, option, order, condition or answer is changed (unlike a full definition re-seed, which would also overwrite
// anything an admin edited). Only questions whose definition says `required: true` and that are not flagged metadata.optional are set, and only on
// the CURRENT version of each checklist. Questions that are not part of a built-in definition (custom checklists) are left exactly as they are.
// A question a designer changed on the Questionnaire page (adminEditedFields has "required" or "metadata") is never touched.
// The checklists that used to be authored fully optional (EB-1C, O-1A/O-1B, COS H-4, I-824 ...) now have required questions in their
// definitions (requirementLogic.js); their stored questions still carry metadata.optional, which wins over `required` - so for those the flag is
// cleared as well (and metadata.requirement is brought in line).
// Idempotent. Dry run by default; --apply writes.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const Question = require("../models/Question");
const Questionnaire = require("../models/Questionnaire");
const { VISA_TEMPLATE_DEFINITIONS } = require("../modules/questionnaires/questionnaire.service");

async function run({ apply }) {
  const summary = { checklists: 0, definitionsWithRequired: 0, questionsToRestore: 0, restored: 0, skippedNoStoredChecklist: [], perChecklist: [] };
  for (const definition of VISA_TEMPLATE_DEFINITIONS) {
    const keys = (definition.questions || []).filter((question) => question.required === true && !question.metadata?.optional).map((question) => question.key);
    if (!keys.length) continue;
    summary.definitionsWithRequired += 1;
    const questionnaire = await Questionnaire.findOne({ key: definition.key, latestVersion: true }).select("_id").lean();
    if (!questionnaire) { summary.skippedNoStoredChecklist.push(definition.key); continue; }
    summary.checklists += 1;
    const base = { questionnaire: questionnaire._id, key: { $in: keys }, adminEditedFields: { $nin: ["required", "metadata"] } };
    const wasOptional = { ...base, "metadata.optional": true };
    const notRequired = { ...base, required: { $ne: true }, "metadata.optional": { $ne: true } };
    const pending = (await Question.countDocuments(wasOptional)) + (await Question.countDocuments(notRequired));
    summary.questionsToRestore += pending;
    if (pending) summary.perChecklist.push(`${definition.key}: ${pending}/${keys.length}`);
    if (apply && pending) {
      const cleared = await Question.updateMany(wasOptional, { $set: { required: true, "metadata.requirement": "required" }, $unset: { "metadata.optional": "" } }, { timestamps: false });
      const restored = await Question.updateMany(notRequired, { $set: { required: true } }, { timestamps: false });
      summary.restored += (cleared.modifiedCount || 0) + (restored.modifiedCount || 0);
    }
  }
  return summary;
}

module.exports = run;

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  mongoose
    .connect(env.mongoUri)
    .then(() => run({ apply }))
    .then((summary) => { console.log(apply ? "Required flags restored:" : "DRY RUN (use --apply to write):"); console.log(JSON.stringify(summary, null, 1)); })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => { console.error("Failed:", error.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
