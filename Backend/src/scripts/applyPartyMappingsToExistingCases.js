// node src/scripts/applyPartyMappingsToExistingCases.js [--apply] [--forms I-129,I-907,I-539,G-28] [--case <caseId>]
// Brings EXISTING cases up to the generic party mapping (see form-mapping/services/PartyFieldMappingService):
//   1. TN checklist questions stored before they carried canonical paths get them (answers are never touched);
//   2. every open case form of the named forms is re-pointed at the form's current mapping version and re-autofilled from the rebuilt canonical
//      profile. Values a person typed (manual overrides) are preserved by autofill; finalized / filed / locked forms are never touched.
// Dry run by default (reports what would change); --apply writes. Idempotent.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/User");
const CaseForm = require("../models/CaseForm");
const Question = require("../models/Question");
const Questionnaire = require("../models/Questionnaire");
const USCISFormTemplate = require("../models/USCISFormTemplate");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../modules/questionnaires/employmentChecklists");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AutoFillService = require("../modules/form-mapping/services/AutoFillService");
const MappingResolver = require("../modules/form-mapping/services/MappingResolver");
const { leaves } = require("../modules/form-mapping/services/CaseFormEditionMigrationService");
const blank = (value) => value === undefined || value === null || value === "" || value === false;

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const apply = args.includes("--apply");
const formCodes = (flag("--forms") || "I-129,I-907,I-539,G-28").split(",").map((code) => code.trim().toUpperCase());
const onlyCase = flag("--case");
const { isFrozen } = require("../modules/form-mapping/config/caseFormFreeze");

async function refreshQuestionPaths() {
  const out = { questionnaires: 0, questionsUpdated: 0 };
  for (const definition of EMPLOYMENT_CHECKLIST_DEFINITIONS.filter((item) => /^tn_(employer|employee)_checklist$/.test(item.key))) {
    const wanted = new Map(definition.questions.filter((question) => question.mapping?.canonicalPath).map((question) => [question.key, question.mapping.canonicalPath]));
    // the template and every per-case copy of it
    const questionnaires = await Questionnaire.find({ key: new RegExp(`^${definition.key}(__case_.*)?$`) }).select("_id").lean();
    for (const questionnaire of questionnaires) {
      out.questionnaires += 1;
      for (const [key, canonicalPath] of wanted) {
        const question = await Question.findOne({ questionnaire: questionnaire._id, key }).select("mapping").lean();
        if (!question || question.mapping?.canonicalPath === canonicalPath) continue;
        out.questionsUpdated += 1;
        if (apply) await Question.updateOne({ _id: question._id }, { $set: { "mapping.canonicalPath": canonicalPath } });
      }
    }
  }
  return out;
}

async function refreshForms(actor) {
  const out = { considered: 0, relocked: 0, autofilled: 0, skippedFrozen: 0, valuesRestored: 0, failed: [] };
  const backup = [];
  const templates = await USCISFormTemplate.find({ formCode: { $in: formCodes }, status: "active" }).select("_id formCode version activeMappingVersion activeMappingVersionId").lean();
  for (const template of templates) {
    const filter = { formTemplateId: template._id, ...(onlyCase ? { caseId: onlyCase } : {}), $or: [{ formCode: template.formCode }, { parentFormCode: template.formCode }] };
    const caseForms = await CaseForm.find(filter);
    for (const caseForm of caseForms) {
      out.considered += 1;
      if (isFrozen(caseForm)) { out.skippedFrozen += 1; continue; }
      // nothing a person or the client entered may be lost: snapshot the form's data first (also saved to a backup file)
      const before = JSON.parse(JSON.stringify({ filledData: caseForm.filledData || {}, fieldValues: caseForm.fieldValues || {}, manualOverrides: caseForm.manualOverrides || {} }));
      backup.push({ _id: String(caseForm._id), formCode: caseForm.formCode, caseId: String(caseForm.caseId), mappingVersion: caseForm.mappingVersion, ...before });
      if (Number(caseForm.mappingVersion) !== Number(template.activeMappingVersion)) {
        out.relocked += 1;
        if (apply) {
          caseForm.mappingVersion = template.activeMappingVersion;
          caseForm.mappingVersionId = template.activeMappingVersionId;
          caseForm.set("formVersionLock.mappingVersion", template.activeMappingVersion);
          caseForm.set("formVersionLock.mappingVersionId", template.activeMappingVersionId);
          await caseForm.save();
        }
      }
      if (!apply) continue;
      try {
        await AutoFillService.generate(caseForm.caseId, caseForm.formCode, actor, { ip: "script", headers: {} }, { regenerate: true });
        out.autofilled += 1;
        // a value that was filled before and came back blank is put back (autofill never blanks existing data)
        const after = await CaseForm.findById(caseForm._id);
        let restored = 0;
        for (const bag of ["filledData", "fieldValues"]) {
          for (const [leafPath, value] of leaves(before[bag])) {
            if (blank(value)) continue;
            const current = bag === "filledData" ? (MappingResolver.resolvePath(after.filledData || {}, leafPath) ?? (after.filledData || {})[leafPath]) : (after.fieldValues || {})[leafPath];
            if (!blank(current)) continue;
            if (bag === "filledData") { after.filledData = after.filledData || {}; MappingResolver.setPath(after.filledData, leafPath, value); } else { after.fieldValues = after.fieldValues || {}; after.fieldValues[leafPath] = value; }
            restored += 1;
          }
        }
        if (restored) { after.markModified("filledData"); after.markModified("fieldValues"); await after.save(); out.valuesRestored += restored; }
      } catch (error) {
        out.failed.push({ caseId: String(caseForm.caseId), formCode: caseForm.formCode, error: error.message.slice(0, 120) });
      }
    }
  }
  if (apply && backup.length) {
    const file = path.join(os.tmpdir(), `party-mapping-backup-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(backup));
    out.backupFile = file;
  }
  return out;
}

mongoose
  .connect(env.mongoUri)
  .then(async () => {
    const actor = (await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { role: "super_admin" };
    console.log(apply ? "APPLYING" : "DRY RUN (use --apply)");
    console.log("questions:", JSON.stringify(await refreshQuestionPaths()));
    console.log("case forms:", JSON.stringify(await refreshForms(actor)));
  })
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
