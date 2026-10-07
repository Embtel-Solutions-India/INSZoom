// node src/scripts/removeFilingIntakeChecklists.js [--apply]
//
// The auto-generated "<Visa> Filing Intake" questionnaire (USCIS form fields turned into a checklist, source
// "uscis_question_library") is not a client checklist and must never be sent to one. New cases no longer get it
// (immigration-knowledge-engine.service.js) and the case checklist resolver ignores it; this brings EXISTING data in
// line: it takes every reference to one off every case and archives the generated questionnaires so they drop out of
// the Admin questionnaire library. Questionnaires/Questions are protected master data, so nothing is deleted - the
// questionnaire is archived and its questions are left untouched. Idempotent. Dry run by default; --apply writes.
const mongoose = require("mongoose");
const env = require("../config/env");
const Questionnaire = require("../models/Questionnaire");
const Case = require("../models/Case");

async function run({ apply }) {
  const generated = await Questionnaire.collection.find({ "generation.source": "uscis_question_library" }, { projection: { _id: 1, title: 1, status: 1 } }).toArray();
  const ids = generated.map((item) => item._id);
  const summary = {
    generatedQuestionnaires: generated.length,
    notYetArchived: generated.filter((item) => item.status !== "archived").length,
    casesWithReference: ids.length ? await Case.collection.countDocuments({ "questionnaireReferences.questionnaireId": { $in: ids } }) : 0,
    applied: apply,
  };
  if (!apply || !ids.length) return summary;

  await Case.collection.updateMany(
    { "questionnaireReferences.questionnaireId": { $in: ids } },
    { $pull: { questionnaireReferences: { questionnaireId: { $in: ids } } } }
  );
  await Questionnaire.collection.updateMany({ _id: { $in: ids } }, { $set: { status: "archived", isActive: false, latestVersion: false } });
  summary.after = {
    casesWithReference: await Case.collection.countDocuments({ "questionnaireReferences.questionnaireId": { $in: ids } }),
    notYetArchived: await Questionnaire.collection.countDocuments({ _id: { $in: ids }, status: { $ne: "archived" } }),
  };
  return summary;
}

module.exports = run;

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  mongoose
    .connect(env.mongoUri)
    .then(() => run({ apply }))
    .then((summary) => { console.log(apply ? "Filing Intake checklists removed:" : "DRY RUN (use --apply to write):"); console.log(JSON.stringify(summary, null, 2)); })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => { console.error("Migration failed:", error.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
