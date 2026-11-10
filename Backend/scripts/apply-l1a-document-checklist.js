/**
 * apply-l1a-document-checklist.js
 *
 * Puts the single "L1A Document Checklist" in place for L-1A and L-1A Extension in the shared database, WITHOUT touching any existing case:
 *   1. creates / reconciles the two new templates (l1a_document_checklist, l1aext_document_checklist) from their code definitions, through the app's own template reconcile.
 *      They are ordinary templates (type template, module cases), so they are listed on the Questionnaire page like every other checklist.
 *   2. switches the four retired templates (l1a / l1aext employer + employee) OFF as defaults (isDefault=false). Nothing else about them changes: they stay in the database,
 *      stay visible, and every case that already carries one keeps resolving it with all its answers. (questionnaire.service also refuses to assign them to any case that
 *      does not already have one.)
 *   3. ADDS the new document checklist to the L-1A / L-1A Extension form mappings (I-129, I-129S, I-539, I-907). Existing mapping entries are never removed, so the cases
 *      that still use the old checklists keep feeding these forms from their own answers.
 * No case, answer, document or form is read or written. Before writing anything it saves a restore file (previous isDefault values and mapping lists).
 *
 * DRY RUN by default. Add --apply to write.
 *   node Backend/scripts/apply-l1a-document-checklist.js
 *   node Backend/scripts/apply-l1a-document-checklist.js --apply
 */
"use strict";

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const NEW_KEYS = ["l1a_document_checklist", "l1aext_document_checklist"];
const RETIRED_KEYS = ["l1a_employer_checklist", "l1a_employee_checklist", "l1aext_employer_checklist", "l1aext_employee_checklist"];
const VISAS = ["L-1A", "L-1A Extension"];
const FORMS = ["I-129", "I-129S", "I-539", "I-907"];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const host = new URL(process.env.MONGODB_URI.replace(/\/\/[^@]*@/, "//x@")).host;
  console.log(APPLY ? "APPLY" : "DRY RUN", "db:", mongoose.connection.name, "host:", host);
  const Questionnaire = require("../src/models/Questionnaire");
  const Question = require("../src/models/Question");
  const Case = require("../src/models/Case");
  const VisaFormMapping = require("../src/models/VisaFormMapping");
  const questionnaireService = require("../src/modules/questionnaires/questionnaire.service");
  const { ENTRIES } = require("../src/modules/form-registry/seeds/checklistMappings.seed");

  // 1. new templates
  for (const key of NEW_KEYS) {
    const q = await Questionnaire.findOne({ key, latestVersion: true }).select("title isDefault checklistRole").lean();
    console.log(`template ${key}:`, q ? `exists (${q.title}, default=${q.isDefault})` : "NOT in the database yet -> will be created");
  }
  // 2. retired templates
  const retired = await Questionnaire.find({ key: { $in: RETIRED_KEYS }, latestVersion: true }).select("key title isDefault status isActive").lean();
  for (const q of retired) {
    const cases = await Case.countDocuments({ "questionnaireReferences.questionnaireTemplateId": q._id });
    console.log(`retired ${q.key}: default=${q.isDefault} status=${q.status} -> default OFF; ${cases} case(s) carry it and keep it`);
  }
  // 3. mappings
  const plan = [];
  for (const visaType of VISAS) for (const formNumber of FORMS) {
    const seed = ENTRIES.find((e) => e.visaType === visaType && e.formNumber === formNumber);
    const rows = await VisaFormMapping.find({ visaType, formNumber, active: true }).select("checklistMappings componentType").lean();
    for (const row of rows) {
      const have = new Set((row.checklistMappings || []).map((m) => m.checklistKey));
      const add = (seed?.checklistMappings || []).filter((m) => NEW_KEYS.includes(m.checklistKey) && !have.has(m.checklistKey));
      console.log(`mapping ${visaType} ${formNumber} (${row.componentType || "-"}): has [${[...have].join(", ")}]${add.length ? ` -> add ${add.map((m) => m.checklistKey).join(", ")}` : " (nothing to add)"}`);
      if (add.length) plan.push({ id: row._id, add, before: row.checklistMappings || [] });
    }
  }

  if (!APPLY) { console.log("\nnothing written. Run again with --apply."); await mongoose.disconnect(); return; }

  const restore = path.join(process.env.L1A_RESTORE_DIR || __dirname, `l1a-document-checklist-restore-${Date.now()}.json`);
  fs.writeFileSync(restore, JSON.stringify({ takenAt: new Date(), retiredBefore: retired, mappingsBefore: plan.map((p) => ({ _id: p.id, checklistMappings: p.before })) }, null, 1));
  console.log("restore file written:", restore);

  // 1. create the templates (the app's own reconcile; idempotent)
  for (const key of NEW_KEYS) {
    await questionnaireService.ensureTemplate(key, undefined, undefined, { wait: true });
    const q = await Questionnaire.findOne({ key, latestVersion: true }).select("_id title isDefault isTemplate checklistRole visaTypes").lean();
    const questions = q ? await Question.countDocuments({ questionnaire: q._id, active: true }) : 0;
    console.log(`created/verified ${key}:`, q ? `${q.title} | role=${q.checklistRole} | default=${q.isDefault} | listed=${q.isTemplate} | ${questions} questions | visas ${q.visaTypes.join(",")}` : "MISSING");
  }
  // 2. retire the old defaults
  const off = await Questionnaire.updateMany({ key: { $in: RETIRED_KEYS }, latestVersion: true }, { $set: { isDefault: false } });
  console.log("retired templates switched off as defaults:", off.modifiedCount);
  // 3. additive mapping entries
  for (const item of plan) {
    await VisaFormMapping.updateOne({ _id: item.id }, { $push: { checklistMappings: { $each: item.add } } });
  }
  console.log("mapping rows extended:", plan.length);
  await mongoose.disconnect();
}

main().catch(async (error) => { console.error("FAILED:", error); try { await mongoose.disconnect(); } catch (_e) { /* */ } process.exit(1); });
