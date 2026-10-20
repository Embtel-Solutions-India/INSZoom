/**
 * apply-party-checklist-paths.js
 *
 * Moves checklists onto the generic party model (see docs/GENERIC_PARTY_CANONICAL_MODEL.md and
 * src/modules/canonical/config/partyChecklistPaths.js):
 *   1. every listed checklist question stores its answer under petitioner.* / beneficiary.* (Question.mapping.canonicalPath);
 *   2. every active form's raw question-key edges read those generic paths instead (new mapping version; the old key stays as the edge's fallback).
 *
 * DRY RUN by default - it prints exactly what would change and writes nothing.
 *   node scripts/apply-party-checklist-paths.js                       dry run on the database in Backend/.env
 *   node scripts/apply-party-checklist-paths.js --local               dry run on the local test database
 *   node scripts/apply-party-checklist-paths.js --apply               write (draft checklists + every form graph)
 *   node scripts/apply-party-checklist-paths.js --apply --include-published   ALSO change published checklists (their answers keep working; only the stored
 *                                                                              path of each question changes - the questions themselves are not touched)
 *   node scripts/apply-party-checklist-paths.js --rollback [--apply]  restores the previous paths and graph edges exactly
 *   --checklists a,b   limit to some checklists        --forms I-129,I-907   limit to some forms
 *
 * Never creates a case, user or company. Safe to run again (nothing is written twice).
 */
"use strict";

const path = require("path");
const mongoose = require("mongoose");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = has("--apply");
const ROLLBACK = has("--rollback");
const INCLUDE_PUBLISHED = has("--include-published");

async function connect() {
  if (has("--local")) {
    await mongoose.connect(process.env.MONGODB_TEST_URI || "mongodb://localhost:27017/immigrationcrm_test", { serverSelectionTimeoutMS: 8000 });
    return "local test database";
  }
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  return "database in Backend/.env";
}

async function migrateQuestions(table, onlyChecklists) {
  const Questionnaire = require("../src/models/Questionnaire");
  const Question = require("../src/models/Question");
  const summary = { changed: 0, unchanged: 0, skippedPublished: 0, missing: 0, byChecklist: {} };
  for (const [checklistKey, questions] of Object.entries(table)) {
    if (onlyChecklists && !onlyChecklists.includes(checklistKey)) continue;
    const versions = await Questionnaire.find({ key: checklistKey }).select("_id version status").lean();
    const line = summary.byChecklist[checklistKey] = { versions: versions.length, change: 0, same: 0, skippedPublished: 0, missing: 0 };
    if (!versions.length) { console.log(`  ${checklistKey}: not in this database`); continue; }
    for (const version of versions) {
      const rows = await Question.find({ questionnaire: version._id, key: { $in: Object.keys(questions) } }).select("key mapping.canonicalPath metadata adminEditedFields").lean();
      const found = new Set(rows.map((row) => row.key));
      line.missing += Object.keys(questions).filter((key) => !found.has(key)).length;
      const published = version.status === "published";
      const ops = [];
      for (const row of rows) {
        const target = questions[row.key].path;
        const current = row.mapping?.canonicalPath || "";
        if (ROLLBACK) {
          if (!row.metadata?.legacyCanonicalPathRecorded) { line.same += 1; continue; }
          const original = row.metadata.legacyCanonicalPath || "";
          ops.push({ updateOne: { filter: { _id: row._id }, update: original
            ? { $set: { "mapping.canonicalPath": original }, $unset: { "metadata.legacyCanonicalPath": "", "metadata.legacyCanonicalPathRecorded": "" }, $pull: { adminEditedFields: "mapping" } }
            : { $unset: { "mapping.canonicalPath": "", "metadata.legacyCanonicalPath": "", "metadata.legacyCanonicalPathRecorded": "" }, $pull: { adminEditedFields: "mapping" } } } });
          line.change += 1;
          continue;
        }
        if (current === target) {
          // already on the generic path (e.g. carried by the definitions): only make sure the reconciler is told it was set by hand
          if (!(row.adminEditedFields || []).includes("mapping") && (!published || INCLUDE_PUBLISHED)) { ops.push({ updateOne: { filter: { _id: row._id }, update: { $addToSet: { adminEditedFields: "mapping" } } } }); line.change += 1; } else line.same += 1;
          continue;
        }
        if (published && !INCLUDE_PUBLISHED) { line.skippedPublished += 1; continue; }
        const set = { "mapping.canonicalPath": target };
        if (!row.metadata?.legacyCanonicalPathRecorded) { set["metadata.legacyCanonicalPath"] = current; set["metadata.legacyCanonicalPathRecorded"] = true; }
        // "mapping" is marked as set by hand, so the background definition reconciler leaves the generic path alone (it would otherwise put the old path back)
        ops.push({ updateOne: { filter: { _id: row._id }, update: { $set: set, $addToSet: { adminEditedFields: "mapping" } } } });
        line.change += 1;
      }
      if (APPLY && ops.length) await Question.bulkWrite(ops, { ordered: false });
      console.log(`  ${checklistKey} v${version.version} (${version.status}): ${ops.length} question(s) ${APPLY ? (ROLLBACK ? "restored" : "updated") : "would change"}${published && !INCLUDE_PUBLISHED && !ROLLBACK ? ` - published: ${line.skippedPublished} left for --include-published` : ""}`);
    }
    for (const key of ["change", "same", "skippedPublished", "missing"]) summary[{ change: "changed", same: "unchanged", skippedPublished: "skippedPublished", missing: "missing" }[key]] += line[key];
  }
  return summary;
}

async function migrateForms(onlyForms) {
  const USCISFormTemplate = require("../src/models/USCISFormTemplate");
  const User = require("../src/models/User");
  const Rewire = require("../src/modules/form-mapping/services/ChecklistPartyRewireService");
  const actor = APPLY ? ((await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { role: "super_admin" }) : null;
  const templates = await USCISFormTemplate.find({ status: "active" }).select("_id formCode activeMappingVersionId latestMappingVersionId").lean();
  const results = [];
  for (const entry of templates) {
    if (onlyForms && !onlyForms.map((code) => code.toUpperCase()).includes(String(entry.formCode).toUpperCase())) continue;
    // the small active graph first: the full template (10-16 MB) is loaded only for a form that really changes
    if (!(await Rewire.needsChange(entry, { rollback: ROLLBACK }))) continue;
    const template = await USCISFormTemplate.findById(entry._id);
    const run = ROLLBACK ? Rewire.rollback : Rewire.apply;
    const result = await run(template, actor, { ip: "script", headers: {} }, { dryRun: !APPLY });
    if (result.skipped && !result.error) continue;
    results.push(result);
    const amount = ROLLBACK ? `${result.restored} edge(s) restored` : `${result.rewired} edge(s) rewired${result.retargeted ? `, ${result.retargeted} retargeted` : ""} (+${result.conditionsRewired} conditions)`;
    console.log(`  ${result.formCode}: ${amount}; ${result.saved ? `saved as mapping version ${result.mappingVersion}${result.activated ? " and activated" : " (not activated: needs review)"}` : result.error ? `NOT SAVED - ${result.error}` : result.wouldSave === false ? "would NOT validate" : "would save a new mapping version"}`);
  }
  return results;
}

async function main() {
  const where = await connect();
  const { CHECKLIST_PARTY_PATHS } = require("../src/modules/canonical/config/partyChecklistPaths");
  const onlyChecklists = valueOf("--checklists")?.split(",").map((item) => item.trim()).filter(Boolean);
  const onlyForms = valueOf("--forms")?.split(",").map((item) => item.trim()).filter(Boolean);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}${ROLLBACK ? " (rollback)" : ""} on the ${where}${INCLUDE_PUBLISHED ? " - published checklists included" : ""}`);
  console.log("\nChecklist questions");
  const questions = await migrateQuestions(CHECKLIST_PARTY_PATHS, onlyChecklists);
  console.log(`  total: ${questions.changed} to change, ${questions.unchanged} already right, ${questions.skippedPublished} published (left alone), ${questions.missing} listed but not in the database`);
  console.log("\nForm mapping graphs");
  const forms = await migrateForms(onlyForms);
  if (!forms.length) console.log("  no active form reads any listed question");
  if (!APPLY) console.log("\nNothing was written. Re-run with --apply to write.");
  else require("../src/modules/uscis-forms/uscis-form.service").invalidateTemplateCache?.();
  await mongoose.disconnect();
}

main().catch(async (error) => { console.error("FAILED:", error.stack || error.message); try { await mongoose.disconnect(); } catch (e) { /* ignore */ } process.exit(1); });
