// node src/scripts/dedupeGeneratedQuestionnaires.js
//
// A bug in IntelligentQuestionnaireService.ensureGeneratedForCase (fixed
// alongside this script) never superseded the previous
// "uscis_question_library"-generated questionnaire for a visa type whenever
// its content fingerprint changed - every edit to a QuestionLibraryItem or
// USCIS form template touched by that visa type left one more full
// ~900-1000-question duplicate "<Visa> Filing Intake" questionnaire behind,
// all simultaneously latestVersion:true. That made questionnaire selection
// non-deterministic (getQuestionnaireForCase's fallback / resolveCaseQuestionnaires
// pick whichever the DB happens to return first among ties) and bloated the
// questions collection with dead duplicate weight.
//
// This migration is read-and-patch only - it NEVER deletes a Questionnaire
// or Question document, and it never changes which questionnaireId an
// existing case's questionnaireReferences points to (that stays exactly as
// assigned). For each generated visaType lineage with more than one
// latestVersion:true record, it:
//   1. Orders the duplicates by createdAt (oldest first).
//   2. Rewrites version/parentVersion/rootQuestionnaire into an honest,
//      ordered version chain instead of 18 unrelated "version 1"s.
//   3. Sets latestVersion:true on only the newest, latestVersion:false on
//      every earlier one.
//
// Idempotent: re-running finds nothing left to change once every lineage
// already has exactly one latestVersion:true record in chain order.
const mongoose = require("mongoose");
const env = require("../config/env");
const Questionnaire = require("../models/Questionnaire");

async function main() {
  await mongoose.connect(env.mongoUri);

  const generated = await Questionnaire.find({ "generation.source": "uscis_question_library" })
    .select("_id visaType version parentVersion rootQuestionnaire latestVersion createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const byVisaType = new Map();
  generated.forEach((questionnaire) => {
    const key = questionnaire.visaType || "";
    if (!byVisaType.has(key)) byVisaType.set(key, []);
    byVisaType.get(key).push(questionnaire);
  });

  let lineagesChanged = 0;
  let recordsPatched = 0;

  for (const [visaType, lineage] of byVisaType) {
    if (lineage.length < 2) continue;
    let changed = false;
    for (let index = 0; index < lineage.length; index += 1) {
      const current = lineage[index];
      const root = lineage[0]._id;
      const parent = index > 0 ? lineage[index - 1]._id : undefined;
      const nextVersion = index + 1;
      const nextLatestVersion = index === lineage.length - 1;
      const needsUpdate = current.version !== nextVersion
        || String(current.rootQuestionnaire || "") !== String(root)
        || String(current.parentVersion || "") !== String(parent || "")
        || Boolean(current.latestVersion) !== nextLatestVersion;
      if (!needsUpdate) continue;
      await Questionnaire.updateOne(
        { _id: current._id },
        { $set: { version: nextVersion, rootQuestionnaire: root, parentVersion: parent, latestVersion: nextLatestVersion } }
      );
      changed = true;
      recordsPatched += 1;
    }
    if (changed) {
      lineagesChanged += 1;
      console.log(`Reconciled ${lineage.length} duplicate generated questionnaires for visaType "${visaType}" into one version chain.`);
    }
  }

  console.log(`Done. Lineages changed: ${lineagesChanged}, records patched: ${recordsPatched}.`);
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("Failed to dedupe generated questionnaires:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
