// Repairs answers / uploaded files that staff saved into a response nothing reads.
//
// The bug: a staff member saving an answer or uploading a file on a checklist panel that had no responseId yet (and named no reference) landed in a
// response derived from their OWN user id - sha1(questionnaireId:caseId:staffUserId) - instead of the response the case's checklist reference holds.
// The Documents tab showed the file (it is a Document record) but the Detailed Questionnaire / Required Documents sections, which read the
// reference's response, still said "Needed". New saves are fixed (questionnaire.service.js, staffReferenceMatch); this moves the rows already orphaned.
//
// Only a row that is provably that case is touched: its responseId equals sha1(its questionnaire : its case : a STAFF user), the case has exactly one
// active, non-staff-request reference for that questionnaire (and role), and that reference holds a different response. Anything else is reported, not changed.
//   - the reference's response has no answer for that question  -> the answer moves there (responseId, assignedTo / participantId as the fix does)
//   - it already has one, both are file answers                 -> files / values are merged (no duplicate stored file), the orphan row is removed
//   - it already has one and it is not a file answer            -> skipped, reported (needs a person)
//
// Usage (from Backend/):
//   node src/scripts/repairOrphanedAnswerResponses.js                      dry run over every case (writes nothing)
//   node src/scripts/repairOrphanedAnswerResponses.js --case B413-A        dry run for one case number
//   node src/scripts/repairOrphanedAnswerResponses.js --apply [--case ..]  repair; the rows it changes are first saved to a JSON backup (path printed)
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const caseArg = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : null;
const STAFF_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager"]);

const idStr = (value) => (value ? String(value._id || value) : "");
const asArray = (value) => (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]);

async function main() {
  const Case = require("../models/Case");
  const Answer = require("../models/Answer");
  const User = require("../models/User");
  const { responseIdFor } = require("../modules/questionnaires/questionnaire.service");

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}${caseArg ? ` - case ${caseArg}` : " - all cases"}`);

  const staffCache = new Map();
  const isStaff = async (userId) => {
    const id = idStr(userId);
    if (!id) return false;
    if (!staffCache.has(id)) {
      const user = await User.findById(id).select("role").lean();
      staffCache.set(id, STAFF_ROLES.has(String(user?.role || "").toLowerCase()));
    }
    return staffCache.get(id);
  };

  const filter = { "questionnaireReferences.0": { $exists: true }, ...(caseArg ? { caseNumber: caseArg } : {}) };
  const report = { casesScanned: 0, orphaned: 0, moved: 0, merged: 0, skipped: [], changedCases: new Set() };
  const backup = [];

  for await (const caseDoc of Case.find(filter).select("caseNumber questionnaireReferences").lean().cursor()) {
    report.casesScanned += 1;
    const references = (caseDoc.questionnaireReferences || []).filter((reference) => reference.active !== false && !reference.staffRequest && reference.responseId);
    const knownResponses = new Set(references.map((reference) => reference.responseId));
    if (!knownResponses.size) continue;
    const orphans = await Answer.find({ caseId: caseDoc._id, responseId: { $nin: [...knownResponses] } }).lean();

    for (const orphan of orphans) {
      // 1. is it the staff-fallback response? (hash of questionnaire:case:<a staff user on the row>)
      const owners = [orphan.assignedTo, orphan.user, orphan.assignedBy].map(idStr).filter(Boolean);
      const owner = owners.find((candidate) => responseIdFor(orphan.questionnaire, caseDoc._id, candidate) === orphan.responseId);
      if (!owner || !(await isStaff(owner))) continue; // some other, deliberate response: not ours to move
      report.orphaned += 1;
      const label = `${caseDoc.caseNumber} / ${orphan.questionKey}`;

      // 2. exactly one reference it belongs to
      const matches = references.filter((reference) => (
        [reference.questionnaireId, reference.questionnaireTemplateId].some((id) => id && idStr(id) === idStr(orphan.questionnaire))
        && (!reference.targetRole || !orphan.participantRole || reference.targetRole === orphan.participantRole)
      ));
      if (matches.length !== 1) { report.skipped.push(`${label}: ${matches.length ? "several" : "no"} matching checklist reference`); continue; }
      const reference = matches[0];

      const existing = await Answer.findOne({ responseId: reference.responseId, questionKey: orphan.questionKey });
      const orphanFiles = orphan.files || [];
      if (!existing) {
        console.log(`  move   ${label}  ${orphan.responseId.slice(0, 8)}… -> ${reference.responseId.slice(0, 8)}…  (${orphanFiles.length} file(s))`);
        backup.push({ action: "move", before: orphan });
        if (APPLY) {
          const set = { responseId: reference.responseId };
          if (reference.assignedTo) set.assignedTo = reference.assignedTo;
          if (reference.participantId && !orphan.participantId) set.participantId = reference.participantId;
          await Answer.updateOne({ _id: orphan._id }, { $set: set });
        }
        report.moved += 1;
        report.changedCases.add(caseDoc.caseNumber);
        continue;
      }
      // a merge only makes sense for two file answers; a typed answer on either side is a person's call
      const existingHasValue = asArray(existing.value).length > 0;
      if (!orphanFiles.length) { report.skipped.push(`${label}: the checklist's response already has an answer and this one is not a file - needs a person`); continue; }
      if (!(existing.files || []).length && existingHasValue) { report.skipped.push(`${label}: the checklist's response already has a typed answer - needs a person`); continue; }

      const known = new Set((existing.files || []).map((file) => file.storageKey || file.originalName));
      const added = orphanFiles.filter((file) => !known.has(file.storageKey || file.originalName));
      console.log(`  merge  ${label}  +${added.length} file(s) into the existing answer, orphan row removed`);
      backup.push({ action: "merge", before: orphan, targetBefore: existing.toObject() });
      if (APPLY) {
        const values = [...new Set([...asArray(existing.value), ...asArray(orphan.value)])];
        existing.files.push(...added);
        existing.value = values;
        if (existing.normalizedValue !== undefined) existing.normalizedValue = values;
        existing.markModified("value");
        await existing.save();
        await Answer.deleteOne({ _id: orphan._id });
      }
      report.merged += 1;
      report.changedCases.add(caseDoc.caseNumber);
    }
  }

  if (APPLY && backup.length) {
    const file = path.join(os.tmpdir(), `answer-repair-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\nBackup of every changed row: ${file}`);
  }
  console.log("\n=== Report ===");
  console.log(JSON.stringify({ ...report, changedCases: [...report.changedCases], skipped: report.skipped.length }, null, 2));
  if (report.skipped.length) console.log("Skipped (left untouched):\n  " + report.skipped.join("\n  "));
  if (!APPLY) console.log("\nNothing was changed. Re-run with --apply to repair.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
