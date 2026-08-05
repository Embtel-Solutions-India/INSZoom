// Family/sponsor visa (K-1/K-3) two-party workflow — petitioner (U.S.
// citizen sponsor) + beneficiary (foreign fiancé/spouse). Mirrors
// employment-workflow.controller.js's employer/employee shape 1:1 under
// separate field names (petitionerUser/beneficiaryUser, beneficiaryInvite,
// familyWorkflow, familyCompletionMode) — that file is untouched; this is a
// parallel, additive module. Reuses shared, role-neutral utilities
// (caseService, notificationService, emailService, employeeInviteService's
// generic token helpers, generateCaseNumber) exactly as the employer/employee
// path does.
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const User = require("../../models/User");
const Questionnaire = require("../../models/Questionnaire");
const generateCaseNumber = require("../cases/caseId");
const caseService = require("../cases/case.service");
const notificationService = require("../notifications/notification.service");
const emailService = require("../email/email.service");
const questionnaireService = require("../questionnaires/questionnaire.service");
// Reused as-is (unmodified) — createInviteToken/getInviteDetails are already
// generic (operate on any User via inviteTokenHash), not employee-specific.
const inviteTokenService = require("../auth/employeeInvite.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const registry = require("./questionnaires/registry");

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function caseVisaType(caseData) {
  return caseData.visaType || caseData.petitionType;
}

// Mirrors isEmployerCapable's shape: gates who may INITIATE a family case.
// The beneficiary (invited second party) can never self-initiate — anyone
// else (a plain "client" with applicantType "individual", the common case,
// or staff creating on a client's behalf) can.
function isFamilyCapable(user) {
  return normalizeRole(user?.role) !== "beneficiary";
}

// Mirrors canAccessEmployerCase's shape: staff use the generic case-access
// check; the petitioner/beneficiary are scoped to their own case by field
// match, entirely separate from employerUser/employeeUser.
function canAccessFamilyCase(user, caseData) {
  if (!user || !caseData) return false;
  const role = normalizeRole(user.role);
  if (["super_admin", "admin", "team_lead", "case_manager"].includes(role)) return caseService.canAccessCase(user, caseData);
  const isPetitioner = String(caseData.petitionerUser || "") === String(user._id);
  if (isPetitioner) return true;
  const isBeneficiary = String(caseData.beneficiaryUser || caseData.user || "") === String(user._id) || caseData.beneficiaryInvite?.email === user.email;
  if (isBeneficiary) return true;
  return caseService.canAccessCase(user, caseData);
}

function nextFamilyWorkflowStatus(caseData) {
  const workflow = caseData.familyWorkflow || {};
  if (["filed", "rfe", "approved", "closed"].includes(workflow.caseManagerStatus)) return workflow.caseManagerStatus;
  if (workflow.beneficiaryStatus === "needs_info") return "waiting_for_beneficiary";
  if (workflow.petitionerStatus === "needs_info") return "waiting_for_petitioner";
  if (workflow.beneficiaryStatus !== "submitted" && workflow.beneficiaryStatus !== "approved") return "waiting_for_beneficiary";
  if (workflow.petitionerStatus !== "submitted" && workflow.petitionerStatus !== "approved") return "waiting_for_petitioner";
  return "ready_for_review";
}

async function notifyUser(userId, payload, actor, req) {
  if (!userId) return;
  await notificationService.createNotification({
    userId,
    type: payload.type || "case",
    title: payload.title,
    message: payload.message,
    link: payload.link,
    caseId: payload.caseId,
    source: "shared",
  }, actor, req).catch(() => {});
}

// Mirrors sendEmployeeInvite's shape exactly, under beneficiary/petitioner
// naming — passwordless account, secure invite token (reusing the existing,
// already-generic createInviteToken), and its OWN new email template
// (family-beneficiary-invitation), never the employee one.
async function sendBeneficiaryInvite(caseData, { email, name, phone }, actorUser, req) {
  let beneficiaryUser = await User.findOne({ email });
  const createdAccount = !beneficiaryUser;
  if (!beneficiaryUser) {
    beneficiaryUser = await User.create({
      email,
      name,
      displayName: name,
      phone: phone || undefined,
      role: "beneficiary",
    });
  } else if (phone && !beneficiaryUser.phone) {
    beneficiaryUser.phone = phone;
    await beneficiaryUser.save();
  }
  await Beneficiary.findOneAndUpdate(
    { email },
    { user: beneficiaryUser._id, email, fullName: beneficiaryUser.name || beneficiaryUser.displayName || name, source: "shared", visaType: caseData.visaType, type: "family" },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  caseData.beneficiaryInvite = { ...(caseData.beneficiaryInvite || {}), email, name, phone, status: "sent", invitedAt: new Date(), invitedBy: actorUser._id };
  caseData.beneficiaryUser = beneficiaryUser._id;
  caseData.familyCompletionMode = "invite_beneficiary";
  caseData.familyWorkflow.beneficiaryStatus = "invited";
  caseData.familyWorkflow.caseManagerStatus = "waiting_for_beneficiary";
  caseService.addTimelineEvent(caseData, "invitation", "Beneficiary Questionnaire Assigned", `${email} was invited to complete their beneficiary questionnaire.`, actorUser, { email, createdAccount });
  await caseData.save();

  const inviteToken = await inviteTokenService.createInviteToken(beneficiaryUser);
  const petitionerName = actorUser.name || actorUser.displayName;
  await emailService.sendTemplateEmail("family-beneficiary-invitation", {
    to: email,
    data: { beneficiaryName: name, petitionerName, caseNumber: caseData.caseNumber, token: inviteToken },
    caseId: caseData._id,
    userId: beneficiaryUser._id,
    triggeredBy: actorUser._id,
    source: "shared",
  });
  await notifyUser(beneficiaryUser._id, { title: "Family Case Information Requested", message: "Please check your email to activate your account and complete your questionnaire.", link: "/dashboard/profile", caseId: caseData._id }, actorUser, req);

  return { beneficiaryUser, createdAccount };
}

// Ensures both the petitioner and beneficiary questionnaire references exist
// on the case, regardless of familyCompletionMode — visibility (who
// currently sees what) is a separate, already-correct concern handled
// entirely by resolveApplicableChecklistRoles/visibleChecklists filtering on
// the frontend. Mirrors immigration-knowledge-engine.service.js's
// assignQuestionnaires dedup-then-assign pattern. Never creates a
// Questionnaire template — a missing template is a reported skip, not a
// fallback to creation.
async function ensureFamilyChecklistReferences(caseData, user, req, options = {}) {
  const results = [];
  const visaType = String(caseData.visaType || "").replace(/[-\s]/g, "").toUpperCase();
  for (const targetRole of ["petitioner", "beneficiary"]) {
    const hasActive = (caseData.questionnaireReferences || []).some(
      (ref) => ref.targetRole === targetRole && ref.active !== false
    );
    if (hasActive) { results.push({ targetRole, status: "already_present" }); continue; }

    const questionnaire = await Questionnaire.findOne({
      status: { $ne: "archived" }, isActive: { $ne: false }, latestVersion: true,
      isDefault: true, checklistRole: targetRole,
      $or: [{ visaType: new RegExp(`^${visaType}$`, "i") }, { visaTypes: new RegExp(`^${visaType}$`, "i") }],
    }).sort({ version: -1 });

    if (!questionnaire) { results.push({ targetRole, status: "template_not_found" }); continue; }

    // options.dryRun (backfill script only — the live createFamilyCase call
    // site never passes it, so its behavior is unchanged): report what would
    // be assigned without writing anything.
    if (options.dryRun) { results.push({ targetRole, status: "would_assign", questionnaireId: questionnaire._id }); continue; }

    const assignedTo = targetRole === "petitioner" ? caseData.petitionerUser : (caseData.beneficiaryUser || caseData.petitionerUser);
    await questionnaireService.assignQuestionnaire(questionnaire, { caseId: caseData._id, targetRole, assignedTo }, user, req);
    results.push({ targetRole, status: "assigned", questionnaireId: questionnaire._id });
  }
  return results;
}

exports.getMyWorkspace = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user.role);
    const filter = role === "beneficiary"
      ? { $or: [{ beneficiaryUser: req.user._id }, { user: req.user._id }, { "beneficiaryInvite.email": req.user.email }] }
      : { petitionerUser: req.user._id };
    const cases = await Case.find(filter).sort({ updatedAt: -1 }).populate("beneficiary", "fullName email firstName lastName");
    const casesWithMeta = cases.map((caseData) => {
      const json = caseData.toObject();
      json.supportsFamilyQuestionnaire = registry.hasDefinition(caseVisaType(caseData));
      return json;
    });
    res.json({ success: true, role, cases: casesWithMeta });
  } catch (error) {
    next(error);
  }
};

exports.createFamilyCase = async (req, res, next) => {
  try {
    // Only a non-beneficiary account may initiate — the U.S. citizen
    // petitioner, never the invited beneficiary (mirrors the employer-side
    // employee-can-never-initiate rule).
    if (!isFamilyCapable(req.user)) return res.status(403).json({ success: false, message: "Only the petitioner can start a family-visa case" });
    const beneficiaryEmail = clean(req.body.beneficiary?.email || req.body.beneficiaryEmail).toLowerCase();
    const beneficiaryName = req.body.beneficiary?.name || req.body.beneficiaryName;
    const beneficiaryPhone = clean(req.body.beneficiary?.phone || req.body.beneficiaryPhone);
    if (!beneficiaryEmail) return res.status(400).json({ success: false, message: "Beneficiary email is required" });
    const completionMode = req.body.familyCompletionMode === "petitioner_completes" ? "petitioner_completes" : "invite_beneficiary";
    if (completionMode === "invite_beneficiary" && !beneficiaryPhone) {
      return res.status(400).json({ success: false, message: "Beneficiary mobile number is required to send an invitation" });
    }
    const beneficiaryUser = await User.findOne({ email: beneficiaryEmail });
    const beneficiary = await Beneficiary.findOneAndUpdate(
      { email: beneficiaryEmail },
      { email: beneficiaryEmail, fullName: beneficiaryName, user: beneficiaryUser?._id, type: "family", source: "shared" },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const caseNumber = await generateCaseNumber();
    const visaType = req.body.visaType || "K-1";
    let caseData = await Case.create({
      caseNumber,
      caseId: caseNumber,
      visaType,
      visaCategory: req.body.visaCategory || "Family",
      petitionType: req.body.petitionType || visaType,
      clientName: beneficiary.fullName || beneficiaryName || beneficiaryEmail,
      clientEmail: beneficiaryEmail,
      user: beneficiaryUser?._id,
      beneficiaryUser: beneficiaryUser?._id,
      petitionerUser: req.user._id,
      createdBy: req.user._id,
      beneficiary: beneficiary._id,
      beneficiaryInvite: { email: beneficiaryEmail, name: beneficiaryName, phone: beneficiaryPhone, status: "", invitedBy: req.user._id },
      familyCompletionMode: completionMode,
      familyWorkflow: { petitionerStatus: "in_progress", beneficiaryStatus: "not_invited", caseManagerStatus: "waiting_for_beneficiary" },
      legacySource: "BAIS",
    });
    beneficiary.caseIds = [...new Set([...(beneficiary.caseIds || []), caseData._id].map(String))];
    await beneficiary.save();
    caseService.addTimelineEvent(caseData, "case", "Family Case Created", `${req.user.name || req.user.displayName || "Petitioner"} created a family-visa case for ${beneficiaryEmail}.`, req.user, { beneficiaryEmail });
    await caseData.save();

    if (completionMode === "invite_beneficiary") {
      await sendBeneficiaryInvite(caseData, { email: beneficiaryEmail, name: beneficiaryName, phone: beneficiaryPhone }, req.user, req);
    } else {
      caseData.familyWorkflow.beneficiaryStatus = "in_progress";
      await caseData.save();
    }
    await ensureFamilyChecklistReferences(caseData, req.user, req);
    // assignQuestionnaire (inside ensureFamilyChecklistReferences) re-fetches
    // and saves its OWN copy of this Case document, bumping __v underneath
    // us — reload before responding so the returned `case` reflects the
    // questionnaireReferences that were just pushed, instead of the stale
    // in-memory copy (same fix already applied in
    // ImmigrationKnowledgeEngineService.orchestrate for the identical cause).
    caseData = await Case.findById(caseData._id);
    res.status(201).json({ success: true, case: caseData, beneficiary });
  } catch (error) {
    next(error);
  }
};

exports.inviteBeneficiary = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessFamilyCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    const email = clean(req.body.email || caseData.beneficiaryInvite?.email || caseData.clientEmail).toLowerCase();
    const name = req.body.name || caseData.beneficiaryInvite?.name || caseData.clientName;
    const phone = clean(req.body.phone);
    if (!email) return res.status(400).json({ success: false, message: "Beneficiary email is required" });
    const { beneficiaryUser, createdAccount } = await sendBeneficiaryInvite(caseData, { email, name, phone }, req.user, req);
    res.json({ success: true, case: caseData, beneficiaryUser: beneficiaryUser.toAuthJSON ? beneficiaryUser.toAuthJSON() : beneficiaryUser, createdAccount });
  } catch (error) {
    next(error);
  }
};

exports.submitParticipantInfo = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessFamilyCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    const role = normalizeRole(req.user.role) === "beneficiary" || req.body.target === "beneficiary" ? "beneficiary" : "petitioner";
    const now = new Date();
    if (role === "petitioner") {
      caseData.familyWorkflow.petitionerStatus = "submitted";
      caseData.familyWorkflow.petitionerSubmittedAt = now;
    } else {
      caseData.familyWorkflow.beneficiaryStatus = "submitted";
      caseData.familyWorkflow.beneficiarySubmittedAt = now;
    }
    caseData.familyWorkflow.caseManagerStatus = nextFamilyWorkflowStatus(caseData);
    if (caseData.familyWorkflow.caseManagerStatus === "ready_for_review") caseData.familyWorkflow.readyForReviewAt = now;
    caseService.addTimelineEvent(caseData, role, `${role === "petitioner" ? "Petitioner" : "Beneficiary"} Information Submitted`, `${role} submitted their portion of the family case.`, req.user);
    await caseData.save();
    if (caseData.assignedCaseManager) await notifyUser(caseData.assignedCaseManager, { title: "Family Case Information Submitted", message: `${role} submitted information for ${caseData.caseNumber}.`, link: `/crm-cases/${caseData._id}`, caseId: caseData._id }, req.user, req);
    res.json({ success: true, case: caseData });
  } catch (error) {
    next(error);
  }
};

exports.isFamilyCapable = isFamilyCapable;
exports.canAccessFamilyCase = canAccessFamilyCase;
exports.ensureFamilyChecklistReferences = ensureFamilyChecklistReferences;
