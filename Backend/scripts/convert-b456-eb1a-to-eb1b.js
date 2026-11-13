/**
 * convert-b456-eb1a-to-eb1b.js
 *
 * ONE-OFF, locked to ONE case id: B456 (Jayadev Sureddi, single-person EB-1A). Changes its case type EB-1A -> EB-1B, which in this system is an employer-sponsored type
 * (employer matter + employee case). Per the owner's decision: this case becomes the EMPLOYEE case "B456-A" and a new EMPLOYER matter "B456" is created for it with
 * BLANK employer name / email and NO employer login (the employer is not confirmed yet; the employer details are added afterwards). Nothing else is touched:
 * every write is by this case's _id or by records created here.
 *
 *   1. refuses unless B456 is still single / EB-1A with no answers, documents, forms, tasks or children (nothing real to lose), and "B456-A" is free
 *   2. backs the case and the client's user record up (full JSON) before anything is written
 *   3. renames the case B456 -> B456-A, then creates the empty employer matter B456 (+ its empty employer profile) with the same team / case manager / plan
 *   4. makes B456-A an employee case under it (visa type EB-1B, parentCase, child index A, employee profile, EB-1B employee document list)
 *   5. takes the EB-1A checklist off the case with the app's own removeChecklist; the app's own orchestration then assigns the EB-1B checklists (employer + employee)
 *   NO EMAIL / NOTIFICATION: every e-mail / notification function of THIS process is replaced by a no-op before the app code loads.
 *
 * DRY RUN by default (the new employer matter is validated, never saved). Add --apply to write.
 *   node Backend/scripts/convert-b456-eb1a-to-eb1b.js
 *   node Backend/scripts/convert-b456-eb1a-to-eb1b.js --apply
 */
"use strict";

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

const CASE_ID = "6aeaa1ab292d0a964be3a449"; // B456
const CASE_NUMBER = "B456";
const CHILD_NUMBER = "B456-A";
const TARGET_VISA = "EB-1B";
const APPLY = process.argv.includes("--apply");

function silence(modulePath) {
  const mod = require(modulePath);
  for (const key of Object.keys(mod)) {
    if (typeof mod[key] === "function" && !/^(is|get|build|render|normalize|format)/i.test(key)) mod[key] = async () => ({ sent: false, skipped: true, reason: "silenced_for_b456_conversion" });
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
  const Questionnaire = require("../src/models/Questionnaire");
  const EmployerProfile = require("../src/models/EmployerProfile");
  const EmployeeProfile = require("../src/models/EmployeeProfile");
  const caseService = require("../src/modules/cases/case.service");
  const employerService = require("../src/integrations/ghl/ghlEmployerService");
  const { resolveDocumentRequirements } = require("../src/modules/document-requirements/document-requirement.resolver");
  const { checklistId } = require("../src/modules/questionnaires/checklist-gate");
  const id = new mongoose.Types.ObjectId(CASE_ID);

  const child = await Case.findById(id);
  if (!child) throw new Error("B456 not found");
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${child.caseNumber} (${child.visaType}, ${child.caseStructure}/${child.caseRole}) -> ${TARGET_VISA} employee case ${CHILD_NUMBER} under a new employer matter ${CASE_NUMBER}`);
  if (child.caseNumber !== CASE_NUMBER || child.clientName !== "Jayadev Sureddi") throw new Error(`unexpected case ${child.caseNumber} / ${child.clientName}`);
  if (child.visaType !== "EB-1A" || child.caseStructure !== "single") throw new Error("the case is not a single EB-1A any more: nothing to do");
  if ((child.childCases || []).length || child.parentCase) throw new Error("the case already has a parent or children");
  if (await Case.countDocuments({ caseNumber: CHILD_NUMBER })) throw new Error(`${CHILD_NUMBER} already exists`);
  if ((await Case.countDocuments({ caseNumber: CASE_NUMBER })) !== 1) throw new Error(`${CASE_NUMBER} is not unique`);

  const counts = {};
  for (const [name, Model] of [["answers", Answer], ["documents", Document], ["caseForms", CaseForm], ["tasks", Task]]) counts[name] = await Model.countDocuments({ caseId: id });
  console.log("existing records on the case:", counts);
  if (Object.values(counts).some(Boolean)) throw new Error("the case already holds answers / documents / forms / tasks: refusing to convert automatically");
  const before = { emails: await EmailLog.countDocuments({ caseId: id }), notifications: await Notification.countDocuments({ caseId: id }) };
  console.log("e-mails / notifications on this case before:", before);
  console.log("checklists now:", (child.questionnaireReferences || []).map((r) => `${r.title || r.questionnaireKey}[${r.targetRole || "-"}] active=${r.active}`));

  const requirements = await resolveDocumentRequirements(TARGET_VISA);
  const employerList = employerService.checklistForRole(requirements, "employer");
  const employeeList = employerService.checklistForRole(requirements, "employee");
  console.log(`EB-1B document rows: employer ${employerList.length}, employee ${employeeList.length}`);

  const principalId = new mongoose.Types.ObjectId();
  const principalDoc = new Case({
    _id: principalId,
    isDemoData: false,
    caseId: CASE_NUMBER,
    caseNumber: CASE_NUMBER,
    clientPortalId: CASE_NUMBER,
    clientName: "", // employer not confirmed yet
    clientEmail: "",
    petitionerName: "",
    visaType: TARGET_VISA,
    visaCategory: TARGET_VISA,
    petitionType: TARGET_VISA,
    visaSelectionStatus: "selected",
    caseType: "immigration",
    caseStructure: "employer_employee",
    caseRole: "principal",
    childCases: [child._id],
    childCaseCount: 1,
    childIndex: null,
    dataEntryMode: "fill_self",
    creationSource: child.creationSource || "admin_direct",
    status: child.status,
    assignedTeamLead: child.assignedTeamLead,
    teamId: child.teamId,
    assignedCaseManager: child.assignedCaseManager,
    additionalCaseManagers: child.additionalCaseManagers || [],
    primaryOwner: child.primaryOwner,
    assignedAgent: child.assignedAgent,
    plan: child.plan,
    checklistItems: employerList,
    documentChecklist: employerList,
  });
  await principalDoc.validate();
  console.log("the new employer matter validates (blank employer name / email, no login).");
  console.log("will keep on the employee case: client name / e-mail / login (Jayadev), GHL card + stage", child.integrations?.ghl?.unifiedStageKey, ", team and case manager.");

  if (!APPLY) { console.log("\nnothing written. Run again with --apply."); await mongoose.disconnect(); return; }

  const backupFile = path.join(process.env.B456_BACKUP_DIR || __dirname, `b456-eb1a-backup-${Date.now()}.json`);
  const client = await User.findById(child.user).lean();
  fs.writeFileSync(backupFile, JSON.stringify({ takenAt: new Date(), case: child.toObject(), user: client }, null, 1));
  console.log("backup written:", backupFile);

  const actor = await User.findOne({ email: "superadmin@immiglance.com" }).select("_id role name email").lean();
  if (!actor) throw new Error("super admin actor not found");
  actor.role = actor.role || "super_admin";

  // the checklist reference of the EB-1A questionnaire, noted before the case is reshaped
  const refs = [...(child.questionnaireReferences || [])];
  const eb1aRefs = [];
  for (const ref of refs) {
    const questionnaire = await Questionnaire.findById(ref.questionnaireTemplateId || ref.questionnaireId).select("key").lean();
    if (questionnaire?.key === "eb1a_questionnaire") eb1aRefs.push({ key: questionnaire.key, targetRole: ref.targetRole });
  }

  // 3. rename the case first (case numbers are unique), then create the employer matter with the number B456
  await Case.updateOne({ _id: id }, { $set: { caseId: CHILD_NUMBER, caseNumber: CHILD_NUMBER, clientPortalId: CHILD_NUMBER } });
  let employerProfile;
  let employeeProfile;
  try {
    await principalDoc.save();
    [employerProfile] = await EmployerProfile.create([{ principalCaseId: principalId, canonicalData: {} }]);
    await Case.updateOne({ _id: principalId }, { $set: { employerProfileId: employerProfile._id } });
    [employeeProfile] = await EmployeeProfile.create([{ caseId: id, principalCaseId: principalId, profileType: "employee", updatedAt: new Date() }]);
  } catch (error) {
    await Case.updateOne({ _id: id }, { $set: { caseId: CASE_NUMBER, caseNumber: CASE_NUMBER, clientPortalId: CASE_NUMBER } }); // put the number back
    await Case.deleteOne({ _id: principalId });
    await EmployerProfile.deleteMany({ principalCaseId: principalId });
    throw error;
  }

  // 4. the employee case
  await Case.updateOne({ _id: id }, { $set: {
    visaType: TARGET_VISA,
    visaCategory: TARGET_VISA,
    petitionType: TARGET_VISA,
    caseStructure: "employer_employee",
    caseRole: "employee",
    parentCase: principalId,
    childIndex: "A",
    childCaseCount: 0,
    employerProfileId: employerProfile._id,
    personProfileId: employeeProfile._id,
    dataEntryMode: "fill_self",
    checklistItems: employeeList,
    documentChecklist: employeeList,
    "integrations.ghl.role": "employee",
  } });
  const fresh = await Case.findById(id);
  caseService.addTimelineEvent(fresh, "case", "Case type changed to EB-1B", `Changed from EB-1A: now the EB-1B employee case ${CHILD_NUMBER} under employer matter ${CASE_NUMBER} (employer details not confirmed yet)`, actor, { from: "EB-1A", to: TARGET_VISA });
  await fresh.save();
  console.log("case reshaped:", CHILD_NUMBER, "under", CASE_NUMBER);

  // 5. the EB-1A checklist off, the EB-1B ones on (the app's own functions)
  const { removeChecklist } = require("../src/modules/questionnaires/case-checklist.service");
  for (const ref of eb1aRefs) {
    const wanted = checklistId({ key: ref.key, targetRole: ref.targetRole });
    try {
      const result = await removeChecklist(CASE_ID, { checklistId: wanted, reason: "Case type changed from EB-1A to EB-1B" }, actor, null);
      console.log("removed", wanted, result.removed);
    } catch (error) {
      console.log("remove", wanted, "->", error.message);
    }
  }
  const Engine = require("../src/modules/cases/immigration-knowledge-engine.service");
  for (const caseId of [String(principalId), CASE_ID]) {
    const result = await Engine.orchestrate(caseId, actor, null, { reason: "case_classification_changed" });
    console.log("orchestrated", caseId, "questionnaires assigned:", (result.assignedQuestionnaires || []).length);
  }

  const after = { emails: await EmailLog.countDocuments({ caseId: id }), notifications: await Notification.countDocuments({ caseId: id }) };
  console.log("e-mails / notifications on the case after:", after, after.emails === before.emails && after.notifications === before.notifications ? "(unchanged: none were sent)" : "(CHANGED - check)");
  for (const c of await Case.find({ _id: { $in: [principalId, id] } }).select("caseNumber visaType caseStructure caseRole parentCase childCases clientName clientEmail questionnaireReferences.title questionnaireReferences.targetRole questionnaireReferences.active").lean()) {
    console.log("\n" + c.caseNumber, c.visaType, c.caseStructure, c.caseRole, "| client:", JSON.stringify(c.clientName), JSON.stringify(c.clientEmail));
    console.log(" checklists:", (c.questionnaireReferences || []).map((r) => `${r.title}[${r.targetRole}]${r.active === false ? " (inactive)" : ""}`).join("; "));
  }
  await mongoose.disconnect();
}

main().catch(async (error) => { console.error("FAILED:", error); try { await mongoose.disconnect(); } catch (_e) { /* */ } process.exit(1); });
