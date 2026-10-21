// Moves the checklist customisations and approvals a child (employee) case holds onto its PRINCIPAL case, and makes the child adopt the principal's.
//
// New rule (case-checklist.service.js): an employer matter's child cases carry the SAME checklists as the principal; they are approved / edited /
// removed on the principal, and every child adopts the result. Cases set up before that rule can disagree - a child holding a private copy of a checklist
// (questions removed on it) and approvals the principal never got. For one family this script:
//   1. takes each private copy the child references: when it differs from its template ONLY by retired questions, the principal's own copy gets the same
//      retirements (created if the principal has none), and the child's reference is pointed back at the template so it is served the principal's copy.
//      A copy with added / edited questions, or a principal whose copy already differs, is reported and left alone.
//   2. gives the principal every approval its children hold for a checklist the principal also carries, and gives the other children the principal's.
//      Silent: no client is notified again (they were told when it was first approved).
// Nothing is deleted: the child's old copy stays in the database, unused; answers and responses are untouched. Every case it changes is saved to a
// JSON backup first (path printed).
//
// Usage (from Backend/):
//   node src/scripts/adoptPrincipalChecklists.js                      dry run over every employer matter that has child cases
//   node src/scripts/adoptPrincipalChecklists.js --case B413          dry run for one principal case number
//   node src/scripts/adoptPrincipalChecklists.js --case B413 --apply  make the changes
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const caseArg = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : null;
const idOf = (value) => String(value?._id || value || "");

async function main() {
  const Case = require("../models/Case");
  const User = require("../models/User");
  const Question = require("../models/Question");
  const Questionnaire = require("../models/Questionnaire");
  const gate = require("../modules/questionnaires/checklist-gate");
  const checklistService = require("../modules/questionnaires/case-checklist.service");
  const questionnaireService = require("../modules/questionnaires/questionnaire.service");

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}${caseArg ? ` - principal ${caseArg}` : " - every employer matter with child cases"}`);

  const actor = await User.findOne({ role: { $in: ["super_admin", "admin"] }, isActive: { $ne: false } }).select("_id role name email").lean();
  if (!actor) throw new Error("No admin user found to act as");

  const principals = await Case.find({ ...(caseArg ? { caseNumber: caseArg } : {}), parentCase: { $exists: false }, caseStructure: "employer_employee" }).select("caseNumber").lean();
  const report = { families: 0, copiesAdopted: 0, retiredApplied: 0, approvalsAdded: 0, skipped: [], changedCases: new Set() };
  const backup = [];
  const snapshot = async (caseId) => {
    if (backup.some((item) => item.caseId === idOf(caseId))) return;
    const doc = await Case.findById(caseId).select("caseNumber checklistApproval questionnaireReferences").lean();
    backup.push({ caseId: idOf(caseId), caseNumber: doc.caseNumber, checklistApproval: doc.checklistApproval, questionnaireReferences: doc.questionnaireReferences });
  };
  const idOfEntry = (entry) => gate.checklistId({ key: entry.questionnaire.key, targetRole: entry.targetRole || entry.questionnaire.checklistRole });

  for (const principalRef of principals) {
    const children = await Case.find({ parentCase: principalRef._id }).select("caseNumber").lean();
    if (!children.length) continue;
    report.families += 1;
    console.log(`\n== ${principalRef.caseNumber} (${children.length} child case${children.length > 1 ? "s" : ""})`);
    const principalIds = new Set((await questionnaireService.resolveCaseQuestionnaires(principalRef._id)).filter((entry) => !entry.staffRequest).map(idOfEntry));

    // ── 1. private copies held by the children ──
    for (const childRef of children) {
      const child = await Case.findById(childRef._id);
      for (const reference of child.questionnaireReferences || []) {
        if (reference.active === false || reference.staffRequest || !reference.questionnaireId) continue;
        const copy = await Questionnaire.findById(reference.questionnaireId);
        if (!copy || !gate.isCaseCopyKey(copy.key) || !String(copy.key).endsWith(`__case_${child._id}`)) continue;
        const base = gate.baseKey(copy.key);
        const role = reference.targetRole || copy.checklistRole;
        const wantedId = `${base}|${role}`;
        const label = `${child.caseNumber} ${wantedId}`;
        if (!principalIds.has(wantedId)) { report.skipped.push(`${label}: the principal does not carry this checklist - left on the child`); continue; }

        const template = await Questionnaire.findOne({ key: base, latestVersion: true }).lean();
        if (!template) { report.skipped.push(`${label}: template not found`); continue; }
        const [copyQuestions, templateQuestions] = await Promise.all([Question.find({ questionnaire: copy._id }).lean(), Question.find({ questionnaire: template._id }).lean()]);
        const templateByKey = new Map(templateQuestions.map((question) => [question.key, question]));
        const copyByKey = new Map(copyQuestions.map((question) => [question.key, question]));
        const isOff = (question) => question.active === false || question.isActive === false;
        const retired = copyQuestions.filter((question) => isOff(question) && templateByKey.has(question.key) && !isOff(templateByKey.get(question.key))).map((question) => question.key).sort();
        const added = copyQuestions.filter((question) => !templateByKey.has(question.key));
        const missing = templateQuestions.filter((question) => !copyByKey.has(question.key));
        const edited = copyQuestions.filter((question) => templateByKey.has(question.key) && !isOff(question) && (
          String(question.label) !== String(templateByKey.get(question.key).label) || Boolean(question.required) !== Boolean(templateByKey.get(question.key).required)
          || JSON.stringify(question.options || []) !== JSON.stringify(templateByKey.get(question.key).options || [])));
        if (added.length || missing.length || edited.length) { report.skipped.push(`${label}: the copy has ${added.length} added / ${edited.length} edited / ${missing.length} missing question(s) - needs a person`); continue; }

        const principalCopy = await Questionnaire.findOne({ key: gate.caseCopyKey(base, principalRef._id), latestVersion: true });
        let principalRetired = [];
        if (principalCopy) {
          const principalQuestions = await Question.find({ questionnaire: principalCopy._id }).lean();
          principalRetired = principalQuestions.filter((question) => isOff(question)).map((question) => question.key).sort();
          if (JSON.stringify(principalRetired) !== JSON.stringify(retired)) { report.skipped.push(`${label}: the principal already has its own, different copy (${principalRetired.length} vs ${retired.length} removed) - needs a person`); continue; }
        }
        console.log(`  adopt  ${label}: ${retired.length} removed question(s) -> principal's copy${principalCopy ? " (already identical)" : " (created)"}; ${child.caseNumber} re-pointed to the principal's copy`);
        if (APPLY) {
          await snapshot(principalRef._id);
          await snapshot(child._id);
          let target = principalCopy;
          if (!target) {
            const forked = await checklistService.forkChecklist(principalRef._id, wantedId, actor, { headers: {}, ip: "script" });
            target = forked.questionnaire;
            if (retired.length) await Question.updateMany({ questionnaire: target._id, key: { $in: retired } }, { $set: { active: false, isActive: false } });
          }
          // the child is served the principal's copy again (its reference names the template, like any child that never customised)
          reference.questionnaireId = reference.questionnaireTemplateId || template._id;
          const approval = (child.checklistApproval?.approvals || []).find((item) => item.checklistId === wantedId);
          if (approval) approval.questionnaireId = target._id;
          await child.save();
        }
        report.copiesAdopted += 1;
        report.retiredApplied += principalCopy ? 0 : retired.length;
        report.changedCases.add(principalRef.caseNumber).add(child.caseNumber);
      }
    }

    // ── 2. approvals: children -> principal, principal -> every child (silent) ──
    const principal = await Case.findById(principalRef._id);
    const kids = await Case.find({ parentCase: principalRef._id });
    const approvedIds = new Map(); // checklistId -> an approval to copy
    const collect = (caseDoc) => (caseDoc.checklistApproval?.approvals || []).forEach((approval) => { if (principalIds.has(approval.checklistId) && !approvedIds.has(approval.checklistId)) approvedIds.set(approval.checklistId, approval); });
    collect(principal);
    kids.forEach(collect);
    for (const caseDoc of [principal, ...kids]) {
      const have = new Set((caseDoc.checklistApproval?.approvals || []).map((approval) => approval.checklistId));
      const removed = new Set((caseDoc.checklistApproval?.removed || []).map((item) => item.checklistId));
      const missing = [...approvedIds.values()].filter((approval) => !have.has(approval.checklistId) && !removed.has(approval.checklistId));
      if (!missing.length || !caseDoc.checklistApproval?.required) continue;
      console.log(`  approve ${caseDoc.caseNumber}: ${missing.map((approval) => approval.checklistId).join(", ")} (adopted, no notification)`);
      if (APPLY) {
        await snapshot(caseDoc._id);
        const fresh = await Case.findById(caseDoc._id);
        for (const approval of missing) {
          fresh.checklistApproval.approvals.push({ checklistId: approval.checklistId, questionnaireId: approval.questionnaireId, targetRole: approval.targetRole, approvedAt: approval.approvedAt || new Date(), approvedBy: approval.approvedBy });
          // the checklist counts as sent from when it was approved (an approval normally stamps this)
          const reference = (fresh.questionnaireReferences || []).find((item) => item.active !== false && !item.staffRequest && String(item.targetRole || "") === String(approval.targetRole || "") && !item.sentAt);
          if (reference) reference.sentAt = approval.approvedAt || new Date();
        }
        await fresh.save();
      }
      report.approvalsAdded += missing.length;
      report.changedCases.add(caseDoc.caseNumber);
    }
  }

  if (APPLY && backup.length) {
    const file = path.join(os.tmpdir(), `adopt-principal-checklists-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\nBackup (before-state of every changed case): ${file}`);
  }
  console.log("\n=== Report ===");
  console.log(JSON.stringify({ ...report, changedCases: [...report.changedCases], skipped: report.skipped.length }, null, 2));
  if (report.skipped.length) console.log("Skipped (left untouched):\n  " + report.skipped.join("\n  "));
  if (!APPLY) console.log("\nNothing was changed. Re-run with --apply (and --case <principal>) to make the changes.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
