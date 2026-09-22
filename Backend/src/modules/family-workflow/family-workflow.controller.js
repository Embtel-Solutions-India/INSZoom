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
const questionnaireService = require("../questionnaires/questionnaire.service");
// Reused as-is (unmodified) — createInviteToken/getInviteDetails are already
// generic (operate on any User via inviteTokenHash), not employee-specific.
const inviteTokenService = require("../auth/employeeInvite.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const registry = require("./questionnaires/registry");
const familyChecklists = require("../questionnaires/familyChecklists");
// Same find-or-create-client-user helpers case.controller.js's createCase
// already uses for the employer/employee path - reused here rather than
// re-invented, so a newly created petitioner gets the identical account
// setup (invite token, referral code) any other client does.
const { generateOpaqueToken, hashToken } = require("../auth/password.service");
const { generateUniqueReferralCode } = require("../../utils/referralCode");

const VALID_PROCESSING_PATHS = new Set(["PETITION_ONLY", "ADJUSTMENT_OF_STATUS", "CONSULAR", ""]);
const CLIENT_SETUP_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

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
  // Single unified call (in_app + socket + push + email together) - was
  // previously two decoupled calls (a direct emailService.sendTemplateEmail
  // plus a separate no-email notifyUser), which produced two uncoordinated
  // in-app notifications and left the email send unaudited alongside them.
  await notificationService.createNotification({
    userId: beneficiaryUser._id,
    type: "case_created",
    category: "case",
    title: "You've Been Invited to Complete Your Immigration Case",
    message: `${caseData.caseNumber} — please activate your account to get started.`,
    caseId: caseData._id,
    link: "/accept-invite",
    priority: "high",
    source: "shared",
    channels: ["in_app", "socket", "push", "email"],
    emailTemplate: "family-beneficiary-invitation",
    emailTo: email,
    emailData: { beneficiaryName: name, petitionerName, caseNumber: caseData.caseNumber, token: inviteToken },
  }, actorUser, req).catch(() => null);

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
// K-1/K-3 (registry.hasDefinition true) keep the original simple
// "one petitioner checklist + one beneficiary checklist, matched by
// checklistRole+visaType" behavior, unchanged. Every other family visaType
// (IR-1/CR-1/F2A/F2B/IR-2..5/CR-2/F1/F3/F4 - familyBased() in
// visaFormMappings.seed.js) instead uses familyChecklists.js's
// resolveFamilyChecklistKeys(), which returns the EXACT checklist keys for
// the case's chosen filing path (Case.processingPath) - I-130-only for
// Petition Only, or I-130 petitioner + Green Card + I-864 sponsor for the
// Green Card path (deliberately never the I-130 beneficiary checklist
// alongside Green Card - see familyChecklists.js's own comment). Looking
// up by exact key (not a checklistRole+visaType regex) also avoids any
// ambiguity between the three separate checklists that can share a
// checklistRole for the same visaType.
async function ensureFamilyChecklistReferences(caseData, user, req, options = {}) {
  const results = [];
  const visaType = String(caseData.visaType || "").replace(/[-\s]/g, "").toUpperCase();

  const assign = async (targetRole, questionnaire) => {
    if (!questionnaire) return null;
    const hasActive = (caseData.questionnaireReferences || []).some(
      (ref) => String(ref.questionnaireId) === String(questionnaire._id) && ref.active !== false
    );
    if (hasActive) { results.push({ targetRole, status: "already_present", questionnaireId: questionnaire._id }); return null; }
    if (options.dryRun) { results.push({ targetRole, status: "would_assign", questionnaireId: questionnaire._id }); return null; }
    const assignedTo = targetRole === "petitioner" ? caseData.petitionerUser
      : targetRole === "joint_sponsor" ? (caseData.jointSponsorUser || caseData.petitionerUser)
      : (caseData.beneficiaryUser || caseData.petitionerUser);
    await questionnaireService.assignQuestionnaireIfNotActive(questionnaire, { caseData, targetRole, assignedTo }, user, req);
    results.push({ targetRole, status: "assigned", questionnaireId: questionnaire._id });
    return questionnaire;
  };

  if (registry.hasDefinition(visaType)) {
    for (const targetRole of ["petitioner", "beneficiary"]) {
      const questionnaire = await Questionnaire.findOne({
        status: { $ne: "archived" }, isActive: { $ne: false }, latestVersion: true,
        isDefault: true, checklistRole: targetRole,
        $or: [{ visaType: new RegExp(`^${visaType}$`, "i") }, { visaTypes: new RegExp(`^${visaType}$`, "i") }],
      }).sort({ version: -1 });
      if (!questionnaire) { results.push({ targetRole, status: "template_not_found" }); continue; }
      await assign(targetRole, questionnaire);
    }
    return results;
  }

  const keys = familyChecklists.resolveFamilyChecklistKeys(caseData.visaType, caseData.processingPath);
  for (const key of keys) {
    const questionnaire = await Questionnaire.findOne({ key, status: { $ne: "archived" }, isActive: { $ne: false }, latestVersion: true }).sort({ version: -1 });
    if (!questionnaire) { results.push({ key, status: "template_not_found" }); continue; }
    await assign(questionnaire.checklistRole, questionnaire);
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
    // The route itself (family-workflow.routes.js) restricts this to staff
    // roles - a Case Manager creates the case ON BEHALF OF the actual
    // petitioner, who is never the logged-in staff user. petitionerUser is
    // therefore resolved from req.body's petitioner contact info (find an
    // existing client User by email, else create one with a setup-invite
    // token), mirroring case.controller.js's createCase's own
    // find-or-create-clientUser pattern exactly - req.user._id only ever
    // becomes createdBy below, never petitionerUser. (isFamilyCapable's
    // "never a beneficiary account" check is kept as a defensive no-op for
    // this staff-only route; it was written for a since-superseded
    // client-self-initiation design.)
    if (!isFamilyCapable(req.user)) return res.status(403).json({ success: false, message: "Only the petitioner can start a family-visa case" });
    const petitionerEmail = clean(req.body.petitioner?.email || req.body.petitionerEmail || req.body.clientEmail).toLowerCase();
    const petitionerName = req.body.petitioner?.name || req.body.petitionerName || req.body.clientName;
    const petitionerPhone = clean(req.body.petitioner?.phone || req.body.petitionerPhone || req.body.clientPhone);
    if (!petitionerEmail) return res.status(400).json({ success: false, message: "Petitioner email is required" });

    let petitionerUser = await User.findOne({ email: petitionerEmail });
    let petitionerSetupToken = null;
    if (petitionerUser) {
      petitionerUser.name = petitionerUser.name || petitionerName;
      petitionerUser.displayName = petitionerUser.displayName || petitionerName;
      if (petitionerPhone && !petitionerUser.phone) petitionerUser.phone = petitionerPhone;
      await petitionerUser.save();
    } else {
      petitionerSetupToken = generateOpaqueToken();
      const referralCode = await generateUniqueReferralCode(User);
      [petitionerUser] = await User.create([{
        email: petitionerEmail,
        name: petitionerName,
        displayName: petitionerName,
        phone: petitionerPhone || undefined,
        role: "client",
        referralCode,
        isActive: false,
        isEmailVerified: false,
        mustSetPassword: true,
        inviteTokenHash: hashToken(petitionerSetupToken),
        inviteTokenExpiresAt: new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS),
      }]);
    }

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
    // Client-facing wording never says "I-130"/"processingPath" (see
    // Immiglance intake) - it maps its own plain-language choice onto this
    // same enum before the request reaches here, so this stays the single
    // source of truth for both the client and staff-facing (Admin
    // CreateCaseModal) surfaces. Invalid/unrecognized values are rejected
    // rather than silently coerced - never guess the client's intent.
    if (req.body.processingPath !== undefined && !VALID_PROCESSING_PATHS.has(req.body.processingPath)) {
      return res.status(400).json({ success: false, message: `Invalid processingPath "${req.body.processingPath}"` });
    }
    let caseData = await Case.create({
      caseNumber,
      caseId: caseNumber,
      visaType,
      visaCategory: req.body.visaCategory || "Family",
      petitionType: req.body.petitionType || visaType,
      // "I am filing for my: ..." (Phase 3) - structured, synced onto the
      // same field VisaFormMapping's trigger DSL already whitelists, so
      // I-130A's spouse-only trigger can key off it for visa types (F2A/
      // F2B) where the classification alone doesn't imply "spouse".
      petitionSubType: req.body.relationship || req.body.petitionSubType || "",
      processingPath: req.body.processingPath || "",
      clientName: beneficiary.fullName || beneficiaryName || beneficiaryEmail,
      clientEmail: beneficiaryEmail,
      user: beneficiaryUser?._id,
      beneficiaryUser: beneficiaryUser?._id,
      petitionerUser: petitionerUser._id,
      createdBy: req.user._id,
      beneficiary: beneficiary._id,
      beneficiaryInvite: { email: beneficiaryEmail, name: beneficiaryName, phone: beneficiaryPhone, status: "", invitedBy: req.user._id },
      familyCompletionMode: completionMode,
      familyWorkflow: { petitionerStatus: "in_progress", beneficiaryStatus: "not_invited", caseManagerStatus: "waiting_for_beneficiary" },
      legacySource: "Immiglance",
    });
    beneficiary.caseIds = [...new Set([...(beneficiary.caseIds || []), caseData._id].map(String))];
    await beneficiary.save();
    petitionerUser.primaryCaseId = petitionerUser.primaryCaseId || caseData._id;
    petitionerUser.caseIds = [...new Set([...(petitionerUser.caseIds || []), caseData._id].map(String))];
    await petitionerUser.save();
    caseService.addTimelineEvent(caseData, "case", "Family Case Created", `${req.user.name || req.user.displayName || "Staff"} created a family-visa case for petitioner ${petitionerEmail} / beneficiary ${beneficiaryEmail}.`, req.user, { petitionerEmail, beneficiaryEmail });
    await caseData.save();

    if (completionMode === "invite_beneficiary") {
      await sendBeneficiaryInvite(caseData, { email: beneficiaryEmail, name: beneficiaryName, phone: beneficiaryPhone }, req.user, req);
    } else {
      caseData.familyWorkflow.beneficiaryStatus = "in_progress";
      await caseData.save();
    }
    await ensureFamilyChecklistReferences(caseData, req.user, req);
    // A newly created petitioner (petitionerSetupToken set) needs the same
    // "set up your account" email case.controller.js's createCase sends its
    // own new clientUser - fire-and-forget, mirrors that call site exactly
    // (setImmediate + .catch(() =&gt; null), never blocks the response).
    if (petitionerSetupToken) {
      setImmediate(async () => {
        await notificationService.createNotification({
          userId: petitionerUser._id,
          type: "case_created",
          category: "case",
          title: "Your Immigration Case Is Ready",
          message: `${caseData.caseNumber} - ${caseData.visaType}`,
          caseId: caseData._id,
          link: "/accept-invite",
          priority: "medium",
          source: "shared",
          emailTemplate: "client-portal-invitation",
          emailTo: petitionerEmail,
          emailData: { clientName: petitionerName, caseNumber: caseData.caseNumber, token: petitionerSetupToken },
        }, req.user, req).catch(() => null);
      });
    }
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

// Case Manager approval gate for the optional "Green Card – National Visa
// Center (NVC) / Consular Processing Checklist" (gc_nvc_<slug>_checklist).
// This checklist exists as a real, registered Questionnaire template for
// every CONSULAR-eligible family visa (see familyChecklists.js) but is
// deliberately excluded from resolveFamilyChecklistKeys()'s automatic
// composition - it is never assigned, and therefore never visible to the
// beneficiary (resolveApplicableChecklistRoles filters purely on which
// checklists are actually assigned), until a Case Manager explicitly hits
// this endpoint. Reuses the existing dedup-safe assignQuestionnaireIfNotActive
// - clicking "Approve" a second time assigns nothing new and simply
// re-confirms the same already-approved state, never duplicating the
// questionnaireReferences entry.
exports.approveGcNvcChecklist = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessFamilyCase(req.user, caseData)) {
      return res.status(404).json({ success: false, message: "Case not found" });
    }
    if (caseData.processingPath !== "CONSULAR") {
      return res.status(400).json({
        success: false,
        code: "NOT_CONSULAR_PATH",
        message: "The GC-NVC checklist only applies to cases whose filing path is Consular Processing / NVC.",
      });
    }
    const key = familyChecklists.resolveGcNvcChecklistKey(caseData.visaType);
    const questionnaire = await Questionnaire.findOne({ key, status: { $ne: "archived" }, isActive: { $ne: false }, latestVersion: true }).sort({ version: -1 });
    if (!questionnaire) {
      return res.status(404).json({ success: false, code: "TEMPLATE_NOT_FOUND", message: `No GC-NVC checklist template found for visa type ${caseData.visaType}` });
    }
    const assignedTo = caseData.beneficiaryUser || caseData.petitionerUser;
    await questionnaireService.assignQuestionnaireIfNotActive(questionnaire, { caseData, targetRole: "beneficiary", assignedTo }, req.user, req);
    caseData.gcNvcChecklist = { approved: true, approvedAt: caseData.gcNvcChecklist?.approvedAt || new Date(), approvedBy: caseData.gcNvcChecklist?.approvedBy || req.user._id };
    caseService.addTimelineEvent(caseData, "case_manager", "GC-NVC Checklist Approved", "Green Card – National Visa Center (NVC) / Consular Processing Checklist enabled for the beneficiary.", req.user);
    await caseData.save();
    res.json({ success: true, case: caseData, gcNvcChecklist: caseData.gcNvcChecklist });
  } catch (error) {
    next(error);
  }
};

exports.isFamilyCapable = isFamilyCapable;
exports.canAccessFamilyCase = canAccessFamilyCase;
exports.ensureFamilyChecklistReferences = ensureFamilyChecklistReferences;
