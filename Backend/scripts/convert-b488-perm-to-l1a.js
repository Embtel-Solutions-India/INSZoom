/**
 * convert-b488-perm-to-l1a.js
 *
 * ONE-OFF, locked to two case ids only: B488 (Onestone Holdings Inc., employer matter) and its employee case B488-A. Changes the case type PERM -> L-1A and swaps the PERM
 * checklists for the L-1A ones. Nothing else is touched, and no other case can be affected (every write is by one of those two _ids).
 *
 *   1. backs both cases up (full JSON) before anything is written
 *   2. refuses to run if either case already has answers, uploaded documents, forms or tasks (nothing real to lose is the precondition)
 *   3. sets visaType / visaCategory / petitionType = "L-1A" (exactly what the existing L-1A cases carry)
 *   4. takes the PERM checklists off the case with the app's own removeChecklist (answers would stay on record; there are none)
 *   5. runs the app's own orchestration so the L-1A checklists, document list and requirement plan are built the way a new L-1A case gets them
 *   6. drops the leftover PERM document-checklist rows
 *   NO EMAIL / NOTIFICATION: every e-mail and notification function of this process is replaced by a no-op BEFORE the app code loads, and the script re-counts
 *   e-mails / notifications for these two cases at the end. (This is a separate process: the running server is not affected.)
 *
 * DRY RUN by default. Add --apply to write.
 *   node Backend/scripts/convert-b488-perm-to-l1a.js
 *   node Backend/scripts/convert-b488-perm-to-l1a.js --apply
 */
"use strict";

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

const PRINCIPAL_ID = "6aebcc097dbd4ecb19625269"; // B488
const CHILD_ID = "6aebcc097dbd4ecb19625274"; // B488-A
const TARGET_VISA = "L-1A";
const APPLY = process.argv.includes("--apply");

// 1. silence every outgoing message of THIS process before any app module loads (modules that destructure these functions at load time then get the no-ops)
function silence(modulePath) {
  const mod = require(modulePath);
  for (const key of Object.keys(mod)) {
    if (typeof mod[key] === "function" && !/^(is|get|build|render|normalize|format)/i.test(key)) mod[key] = async () => ({ sent: false, skipped: true, reason: "silenced_for_b488_conversion" });
  }
}
silence("../src/modules/email/email.service");
silence("../src/modules/notifications/notification.service");
try { silence("../src/modules/notifications/pushNotification.service"); } catch (_error) { /* module may not exist */ }

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Case = require("../src/models/Case");
  const Answer = require("../src/models/Answer");
  const Document = require("../src/models/Document");
  const CaseForm = require("../src/models/CaseForm");
  const Task = require("../src/models/Task");
  const EmailLog = require("../src/models/EmailLog");
  const Notification = require("../src/models/Notification");
  const User = require("../src/models/User");
  const { checklistId } = require("../src/modules/questionnaires/checklist-gate");
  const ids = [PRINCIPAL_ID, CHILD_ID].map((id) => new mongoose.Types.ObjectId(id));

  const cases = await Case.find({ _id: { $in: ids } });
  const principal = cases.find((c) => String(c._id) === PRINCIPAL_ID);
  const child = cases.find((c) => String(c._id) === CHILD_ID);
  if (!principal || !child) throw new Error("B488 / B488-A not found");
  if (principal.caseNumber !== "B488" || child.caseNumber !== "B488-A") throw new Error(`unexpected case numbers ${principal.caseNumber} / ${child.caseNumber}`);
  if (String(child.parentCase) !== PRINCIPAL_ID) throw new Error("B488-A is not under B488");
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${principal.caseNumber} (${principal.visaType}) and ${child.caseNumber} (${child.visaType}) -> ${TARGET_VISA}`);
  if (principal.visaType !== "PERM" || child.visaType !== "PERM") throw new Error("a case is not PERM any more: nothing to do");

  const counts = {};
  for (const [name, Model] of [["answers", Answer], ["documents", Document], ["caseForms", CaseForm], ["tasks", Task]]) counts[name] = await Model.countDocuments({ caseId: { $in: ids } });
  console.log("existing records on the two cases:", counts);
  if (Object.values(counts).some(Boolean)) throw new Error("the cases already hold answers / documents / forms / tasks: refusing to convert automatically");

  const before = { emails: await EmailLog.countDocuments({ caseId: { $in: ids } }), notifications: await Notification.countDocuments({ caseId: { $in: ids } }) };
  console.log("e-mails / notifications on these cases before:", before);

  const permRefs = (doc) => (doc.questionnaireReferences || []).filter((r) => /^PERM/i.test(r.title || "")).map((r) => `${r.title} [${r.targetRole}]`);
  console.log("PERM checklists now:", { B488: permRefs(principal), "B488-A": permRefs(child) });
  console.log("PERM document rows on B488-A:", (child.documentChecklist || []).length);

  if (!APPLY) { console.log("\nnothing written. Run again with --apply."); await mongoose.disconnect(); return; }

  // backup first
  const backupFile = path.join(process.env.B488_BACKUP_DIR || __dirname, `b488-perm-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ takenAt: new Date(), cases: cases.map((c) => c.toObject()) }, null, 1));
  console.log("backup written:", backupFile);

  const actor = await User.findOne({ email: "superadmin@immiglance.com" }).select("_id role name email").lean();
  if (!actor) throw new Error("super admin actor not found");
  actor.role = actor.role || "super_admin";

  // 3. the type
  for (const id of ids) {
    await Case.updateOne({ _id: id }, { $set: { visaType: TARGET_VISA, visaCategory: TARGET_VISA, petitionType: TARGET_VISA } });
  }
  console.log("visa type set to", TARGET_VISA);

  // 4. the PERM checklists off the case (the employee checklist cascades to B488-A from the matter)
  const { removeChecklist } = require("../src/modules/questionnaires/case-checklist.service");
  for (const ref of [...(principal.questionnaireReferences || []), ...(child.questionnaireReferences || [])]) {
    if (!/^PERM/i.test(ref.title || "")) continue;
    const questionnaire = await require("../src/models/Questionnaire").findById(ref.questionnaireTemplateId || ref.questionnaireId).select("key").lean();
    const wanted = checklistId({ key: questionnaire.key, targetRole: ref.targetRole });
    try {
      const result = await removeChecklist(PRINCIPAL_ID, { checklistId: wanted, reason: "Case type changed from PERM to L-1A" }, actor, null);
      console.log("removed", wanted, result.removed);
    } catch (error) {
      console.log("remove", wanted, "->", error.message);
    }
  }

  // 5. the L-1A checklists, documents and requirement plan, built by the app's own orchestration (principal first, then the employee case)
  const Engine = require("../src/modules/cases/immigration-knowledge-engine.service");
  for (const id of [PRINCIPAL_ID, CHILD_ID]) {
    const result = await Engine.orchestrate(id, actor, null, { reason: "case_classification_changed" });
    console.log("orchestrated", String(id), "questionnaires assigned:", (result.assignedQuestionnaires || []).length);
  }

  // 6. leftover PERM document rows
  const fresh = await Case.findById(CHILD_ID);
  const isPerm = (row) => /^perm_/i.test(row?.documentType || "");
  fresh.documentChecklist = (fresh.documentChecklist || []).filter((row) => !isPerm(row));
  fresh.checklistItems = (fresh.checklistItems || []).filter((row) => !isPerm(row));
  await fresh.save();

  // report
  const after = { emails: await EmailLog.countDocuments({ caseId: { $in: ids } }), notifications: await Notification.countDocuments({ caseId: { $in: ids } }) };
  console.log("e-mails / notifications on these cases after:", after, after.emails === before.emails && after.notifications === before.notifications ? "(unchanged: none were sent)" : "(CHANGED - check)");
  for (const c of await Case.find({ _id: { $in: ids } }).select("caseNumber visaType visaCategory petitionType questionnaireReferences.title questionnaireReferences.targetRole questionnaireReferences.active documentChecklist.documentType checklistApproval.removed.checklistId").lean()) {
    console.log("\n" + c.caseNumber, c.visaType, c.visaCategory, c.petitionType);
    console.log(" checklists:", (c.questionnaireReferences || []).map((r) => `${r.title}[${r.targetRole}]${r.active === false ? " (inactive)" : ""}`).join("; "));
    console.log(" removed:", (c.checklistApproval?.removed || []).map((r) => r.checklistId).join("; "));
    console.log(" document rows:", (c.documentChecklist || []).length, (c.documentChecklist || []).slice(0, 8).map((r) => r.documentType).join(", "));
  }
  await mongoose.disconnect();
}

main().catch(async (error) => { console.error("FAILED:", error); try { await mongoose.disconnect(); } catch (_e) { /* */ } process.exit(1); });
