// node src/scripts/mergeFamilyChildCase.js <PRINCIPAL_CASE_NUMBER> [--apply]
//
// One-off, non-destructive merge of a LEGACY family (K-1/K-3) matter - a
// principal case plus a lettered "-A" beneficiary child case, the shape the
// generic POST /cases used to create - into the single shared two-party Case
// that family-workflow.controller.js#createFamilyCase produces today
// (petitionerUser + beneficiaryUser, no children, caseRole null).
//
// Nothing is deleted: the child Case is archived (not removed), every record
// that belonged to it is re-pointed at the principal, and a JSON backup of
// every document touched is written to Backend/backups/ before any write.
// Dry-run by default; pass --apply to write. Safe to re-run.
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const env = require("../config/env");
const Case = require("../models/Case");
const CaseForm = require("../models/CaseForm");
const PetitionPackage = require("../models/PetitionPackage");
const EmployeeProfile = require("../models/EmployeeProfile");
const Notification = require("../models/Notification");
const Beneficiary = require("../models/Beneficiary");
const User = require("../models/User");
const caseService = require("../modules/cases/case.service");

const log = (...args) => console.log(...args);

async function mergeFamilyChildCase(principalNumber, { apply = false } = {}) {
  const principal = await Case.findOne({ caseNumber: principalNumber });
  if (!principal) throw new Error(`Case ${principalNumber} not found`);
  if (!principal.petitionerUser || !principal.beneficiaryUser) {
    throw new Error("Principal must already carry petitionerUser and beneficiaryUser - refusing to guess");
  }
  const children = await Case.find({ _id: { $in: principal.childCases || [] } });
  if (children.length !== 1) throw new Error(`Expected exactly 1 child case, found ${children.length}`);
  const child = children[0];
  if (child.caseRole !== "beneficiary" || String(child.parentCase) !== String(principal._id)) {
    throw new Error("Child is not this principal's beneficiary child case");
  }

  const beneficiaryUser = await User.findById(principal.beneficiaryUser);
  const petitionerUser = await User.findById(principal.petitionerUser);
  const beneficiaryEmail = String(principal.beneficiaryInvite?.email || beneficiaryUser?.email || "").toLowerCase();
  const beneficiaryDoc = await Beneficiary.findOne({ email: beneficiaryEmail });

  const counts = {
    caseForms: await CaseForm.countDocuments({ caseId: child._id }),
    petitionPackages: await PetitionPackage.countDocuments({ caseId: child._id }),
    notifications: await Notification.countDocuments({ caseId: child._id }),
    employeeProfiles: await EmployeeProfile.countDocuments({ caseId: child._id }),
  };
  log(`${apply ? "[APPLY]" : "[DRY RUN]"} merge ${child.caseNumber} -> ${principal.caseNumber}`);
  log("to re-point:", counts);
  log("principal: user", String(principal.user), "->", String(beneficiaryUser._id), "| clientName", principal.clientName, "->", beneficiaryDoc?.fullName || beneficiaryUser.name);
  if (!apply) return;

  // Backup first.
  const dir = path.join(__dirname, "..", "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `merge-${principal.caseNumber}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    principal: principal.toObject(),
    child: child.toObject(),
    caseForms: await CaseForm.find({ caseId: child._id }).lean(),
    petitionPackages: await PetitionPackage.find({ caseId: child._id }).lean(),
    employeeProfiles: await EmployeeProfile.find({ caseId: child._id }).lean(),
    notificationIds: (await Notification.find({ caseId: child._id }).select("_id").lean()).map((n) => n._id),
    users: [petitionerUser?.toObject?.(), beneficiaryUser?.toObject?.()],
    beneficiary: beneficiaryDoc?.toObject?.() || null,
  }, null, 2));
  log("backup written:", file);

  // 1. Records that belong to the filing move to the one case. (EmployeeProfile
  //    is deliberately NOT moved: it is the employee-case store, and its mere
  //    existence for a caseId changes AutoFillService's reverse-sync path; a
  //    family case never has one. It stays attached to the archived child.)
  await CaseForm.updateMany({ caseId: child._id }, { $set: { caseId: principal._id } });
  const hasCurrentPackage = await PetitionPackage.exists({ caseId: principal._id, isCurrent: true });
  await PetitionPackage.updateMany({ caseId: child._id }, { $set: { caseId: principal._id, ...(hasCurrentPackage ? { isCurrent: false } : {}) } });
  await Notification.collection.updateMany({ caseId: child._id }, { $set: { caseId: principal._id } });
  await Notification.collection.updateMany({ case: child._id }, { $set: { case: principal._id } });

  // 2. Principal becomes the single shared case.
  principal.childCases = [];
  principal.childCaseCount = 0;
  principal.caseRole = null;
  // Case.user / clientName / clientEmail are the BENEFICIARY on a family case
  // (CanonicalBuilderService reads Case.user as the beneficiary account).
  principal.user = beneficiaryUser._id;
  principal.clientName = beneficiaryDoc?.fullName || beneficiaryUser.name || principal.beneficiaryInvite?.name || principal.clientName;
  principal.clientEmail = beneficiaryEmail;
  if (beneficiaryDoc) principal.beneficiary = beneficiaryDoc._id;
  if (!principal.clientProfile && child.clientProfile) principal.clientProfile = child.clientProfile;
  caseService.addTimelineEvent(principal, "case", "Beneficiary Case Merged", `Legacy beneficiary case ${child.caseNumber} was merged into this single shared petitioner/beneficiary case.`, null, { mergedChildCaseId: String(child._id), mergedChildCaseNumber: child.caseNumber });
  await principal.save();

  if (beneficiaryDoc) {
    beneficiaryDoc.caseIds = [...new Set([...(beneficiaryDoc.caseIds || []), principal._id].map(String))];
    await beneficiaryDoc.save();
  }

  // 3. Child is archived, never deleted.
  if (child.status !== "archived") {
    child.previousStatus = child.status;
    child.status = "archived";
    if (child.workflow) child.workflow.status = "archived";
    child.archivedAt = new Date();
    caseService.addTimelineEvent(child, "archive", "Merged Into Principal Case", `Merged into ${principal.caseNumber}; kept for reference only.`, null, { mergedInto: String(principal._id) });
    await child.save();
  }

  // 4. The petitioner's account must stop listing the archived child.
  await User.updateOne({ _id: petitionerUser._id }, { $pull: { caseIds: child._id } });

  // 5. Beneficiary checklist/forms/petition on the merged case, via the same
  //    code createFamilyCase uses (idempotent - no duplicates).
  const actor = await User.findOne({ role: { $in: ["super_admin", "admin"] } }) || petitionerUser;
  const { ensureFamilyChecklistReferences } = require("../modules/family-workflow/family-workflow.controller");
  const orchestrator = require("../modules/cases/case-lifecycle-orchestrator.service");
  const fresh = await Case.findById(principal._id);
  log("checklists:", JSON.stringify(await ensureFamilyChecklistReferences(fresh, actor, null)));
  const fresh2 = await Case.findById(principal._id);
  await orchestrator.provisionRequiredForms(fresh2, actor, null);
  log("done.");
}

(async () => {
  const [number, ...flags] = process.argv.slice(2);
  if (!number) { console.error("usage: node src/scripts/mergeFamilyChildCase.js <CASE_NUMBER> [--apply]"); process.exit(1); }
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  try {
    await mergeFamilyChildCase(number, { apply: flags.includes("--apply") });
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
