const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Company = require("../../models/Company");
const Task = require("../../models/Task");
const User = require("../../models/User");
const generateCaseNumber = require("../cases/caseId");
const caseService = require("../cases/case.service");
const notificationService = require("../notifications/notification.service");
const emailService = require("../email/email.service");
const employeeInviteService = require("../auth/employeeInvite.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const participantService = require("../cases/case-participant.service");
const registry = require("./questionnaires/registry");

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function caseVisaType(caseData) {
  return caseData.visaType || caseData.petitionType;
}

// `caseData.questionnaireData` is a Mongoose single-nested subdocument, not a
// plain object — spreading it directly (`{...caseData.questionnaireData}`)
// carries over live nested-subdocument references (e.g. `validation`) that
// break when re-assigned back onto the same document, throwing a spurious
// "Cast to Object failed... at path questionnaireData.validation" error.
// Always go through `.toObject()` first to get a clean plain object.
function plainQuestionnaireData(caseData) {
  const questionnaireData = caseData.questionnaireData;
  return questionnaireData?.toObject ? questionnaireData.toObject() : (questionnaireData || {});
}

function assignStandardDocuments(caseData) {
  const documents = registry.standardDocuments(caseVisaType(caseData));
  if (!documents.length) return;
  const existing = new Set([...(caseData.documentChecklist || []), ...(caseData.checklistItems || [])].map((item) => item.documentType));
  documents.forEach((item) => {
    if (existing.has(item.documentType)) return;
    const next = { ...item, requestedDate: new Date() };
    caseData.documentChecklist.push(next);
    caseData.checklistItems.push(next);
    existing.add(item.documentType);
  });
}

function employeeAssignment(mode, user, extra = {}) {
  return {
    mode,
    assignedAt: new Date(),
    assignedBy: user?._id,
    ...extra,
  };
}

// Ownership-based, not account-role-based: a case's employer side is
// whoever actually owns it (caseData.employerUser / matching companyId),
// regardless of whether their account role is literally "employer" or a
// plain "client" acting as the employer (the common case — see
// BAIS's resolveApplicableChecklistRoles for the same reasoning on the
// frontend). Gating this on `role === "employer"` previously locked every
// "client"-role employer out of their own cases.
function canAccessEmployerCase(user, caseData) {
  if (!user || !caseData) return false;
  const role = normalizeRole(user.role);
  if (["super_admin", "admin", "team_lead", "case_manager"].includes(role)) return caseService.canAccessCase(user, caseData);
  const isEmployerOwner = String(caseData.employerUser || "") === String(user._id) ||
    String(caseData.companyId || "") === String(user.companyId || "") ||
    Boolean(participantService.findParticipant(caseData, { role: "employer", userId: user._id, email: user.email }));
  if (isEmployerOwner) return true;
  const isEmployeeOwner = String(caseData.employeeUser || caseData.user || "") === String(user._id) ||
    caseData.employeeInvite?.email === user.email ||
    Boolean(participantService.findParticipant(caseData, { role: "employee", userId: user._id, email: user.email }));
  if (isEmployeeOwner) return true;
  return caseService.canAccessCase(user, caseData);
}

// Server-side security boundary for pre-case, account-level employer
// features (adding a new employee/case, editing the company profile) — NOT
// nav visibility, which is only a convenience mirror of this. A "client"
// account must have explicitly selected applicantType "employer" (see
// PlanSelection.jsx / Profile.jsx); a dedicated "employer"-role account is
// always employer-capable. A real invited employee (role "employee") is
// never employer-capable regardless of applicantType, enforcing the
// employer-centric rule that an employee can never self-initiate a case.
function isEmployerCapable(user) {
  const role = normalizeRole(user?.role);
  if (role === "employee") return false;
  return user?.applicantType === "employer" || role === "employer";
}

function nextWorkflowStatus(caseData) {
  const workflow = caseData.employerEmployeeWorkflow || {};
  if (workflow.caseManagerStatus === "filed" || workflow.caseManagerStatus === "rfe" || workflow.caseManagerStatus === "approved" || workflow.caseManagerStatus === "closed") return workflow.caseManagerStatus;
  const employeeParticipants = participantService.activeParticipants(caseData, "employee");
  if (employeeParticipants.some((participant) => participant.progress?.status === "needs_info" || participant.status === "needs_info")) return "waiting_for_employee";
  if (employeeParticipants.length && employeeParticipants.some((participant) => !["submitted", "approved"].includes(participant.progress?.status || participant.status))) return "waiting_for_employee";
  if (workflow.employeeStatus === "needs_info") return "waiting_for_employee";
  if (workflow.employerStatus === "needs_info") return "waiting_for_employer";
  if (workflow.employeeStatus !== "submitted" && workflow.employeeStatus !== "approved") return "waiting_for_employee";
  if (workflow.employerStatus !== "submitted" && workflow.employerStatus !== "approved") return "waiting_for_employer";
  return "ready_for_review";
}

async function ensureEmployerCompany(user, payload = {}) {
  if (user.companyId) {
    const company = await Company.findById(user.companyId);
    if (company) return company;
  }
  const name = clean(payload.name || payload.companyName || user.displayName || user.name || "Employer Company");
  const company = await Company.create({
    name,
    legalName: payload.legalName,
    ein: payload.ein || payload.fein,
    website: payload.website,
    industry: payload.industry,
    numberOfEmployees: payload.numberOfEmployees,
    address: payload.businessAddress || payload.address,
    businessAddress: payload.businessAddress || payload.address,
    mailingAddress: payload.mailingAddress,
    authorizedSignatory: payload.authorizedSignatory,
    hrContact: payload.hrContact || { name: user.name || user.displayName, email: user.email, phone: user.phone, user: user._id, isPrimary: true },
    contact: { email: payload.email || user.email, phone: payload.phone || user.phone, website: payload.website },
    hrManager: user._id,
    hrUsers: [user._id],
    source: "BAIS",
  });
  user.companyId = company._id;
  await user.save();
  return company;
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
    companyId: payload.companyId,
    source: "shared",
  }, actor, req).catch(() => {});
}

exports.getMyWorkspace = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user.role);
    // Only a real invited employee (always created with role "employee" —
    // see sendEmployeeInvite) gets the employee-side filter; every other
    // caller (employer, or a "client" acting as employer) gets the
    // employer-side filter, since account role alone can't distinguish them.
    const filter = role === "employee"
      ? { $or: [{ employeeUser: req.user._id }, { user: req.user._id }, { "employeeInvite.email": req.user.email }, { "participants.userId": req.user._id }, { "participants.email": req.user.email }] }
      : { $or: [{ employerUser: req.user._id }, { "participants.userId": req.user._id }, { "participants.email": req.user.email }, ...(req.user.companyId ? [{ companyId: req.user.companyId }, { employer: req.user.companyId }, { "participants.companyId": req.user.companyId }] : [])] };
    const [company, cases] = await Promise.all([
      req.user.companyId ? Company.findById(req.user.companyId) : null,
      Case.find(filter).sort({ updatedAt: -1 }).populate("beneficiary", "fullName email firstName lastName").populate("companyId", "name legalName ein"),
    ]);
    const casesWithMeta = cases.map((caseData) => {
      const json = caseData.toObject();
      json.supportsEmployerQuestionnaire = registry.hasDefinition(caseVisaType(caseData));
      json.participants = (json.participants || []).filter((participant) => participant.status !== "deleted" && participant.status !== "replaced");
      return json;
    });
    res.json({ success: true, role, company, cases: casesWithMeta });
  } catch (error) {
    next(error);
  }
};

exports.saveCompanyProfile = async (req, res, next) => {
  try {
    // Self-scoped (always the caller's own req.user.companyId) — requires
    // applicantType "employer" (a "client" account must have chosen it), not
    // just any non-employee role.
    if (!isEmployerCapable(req.user)) return res.status(403).json({ success: false, message: "Switch to \"Employer sponsoring employees\" in your profile to manage a company profile" });
    const company = await ensureEmployerCompany(req.user, req.body);
    const allowed = ["name", "legalName", "ein", "industry", "numberOfEmployees", "website", "businessAddress", "mailingAddress", "authorizedSignatory", "hrContact"];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) company[field] = req.body[field];
    });
    if (req.body.fein !== undefined) company.ein = req.body.fein;
    company.contact = { ...(company.contact || {}), email: req.body.email || company.contact?.email || req.user.email, phone: req.body.phone || company.contact?.phone || req.user.phone, website: company.website };
    if (!company.hrUsers?.some((id) => String(id) === String(req.user._id))) company.hrUsers.push(req.user._id);
    await company.save();
    res.json({ success: true, company });
  } catch (error) {
    next(error);
  }
};

// Shared by createEmployerCase (adding another employee's case) and
// inviteEmployee (inviting on an already-created case): finds or creates a
// passwordless employee account, generates a secure invite token, and emails
// it — the employer never sees or sets the employee's password.
async function sendEmployeeInvite(caseData, { email, name, phone, participantId }, actorUser, req) {
  let employeeUser = await User.findOne({ email });
  const createdAccount = !employeeUser;
  if (!employeeUser) {
    employeeUser = await User.create({
      email,
      name,
      displayName: name,
      phone: phone || undefined,
      role: "employee",
      companyId: caseData.companyId,
    });
  } else if (phone && !employeeUser.phone) {
    employeeUser.phone = phone;
    await employeeUser.save();
  }
  await Client.findOneAndUpdate(
    { user: employeeUser._id },
    { user: employeeUser._id, email, fullName: employeeUser.name || employeeUser.displayName || name, source: "shared", visaType: caseData.visaType },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const participant = participantService.ensureParticipant(caseData, {
    role: "employee",
    participantId,
    userId: employeeUser._id,
    email,
    name,
    phone,
    status: "invited",
    invite: { email, name, phone, status: "sent", invitedAt: new Date(), invitedBy: actorUser._id },
    progress: { status: "invited", percent: 0 },
  }, actorUser);
  if (!caseData.employeeUser) caseData.employeeUser = employeeUser._id;
  if (!caseData.employeeInvite?.email) caseData.employeeInvite = { ...(caseData.employeeInvite || {}), email, name, phone, status: "sent", invitedAt: new Date(), invitedBy: actorUser._id };
  caseData.user = caseData.user || employeeUser._id;
  caseData.clientEmail = caseData.clientEmail || email;
  caseData.clientName = caseData.clientName || name || email;
  caseData.questionnaireData = {
    ...plainQuestionnaireData(caseData),
    masterData: {
      ...(caseData.questionnaireData?.masterData || {}),
      employeeQuestionnaireAssignment: employeeAssignment("invite_employee", actorUser, {
        employeeUser: employeeUser._id,
        employeeEmail: email,
        participantId: participant._id,
        createdAccount,
      }),
    },
  };
  caseData.markModified("questionnaireData");
  caseData.employerEmployeeWorkflow.employeeStatus = "invited";
  caseData.employerEmployeeWorkflow.caseManagerStatus = "waiting_for_employee";
  caseService.addTimelineEvent(caseData, "invitation", "Employee Questionnaire Assigned", `${email} was invited to complete their employee questionnaire.`, actorUser, { email, createdAccount, participantId: participant._id });
  await caseData.save();

  const inviteToken = await employeeInviteService.createInviteToken(employeeUser);
  const employerName = actorUser.companyId
    ? (await Company.findById(actorUser.companyId))?.name
    : (actorUser.name || actorUser.displayName);
  await emailService.sendTemplateEmail("employee-case-invitation", {
    to: email,
    data: { employeeName: name, employerName, caseNumber: caseData.caseNumber, token: inviteToken },
    caseId: caseData._id,
    userId: employeeUser._id,
    triggeredBy: actorUser._id,
    source: "shared",
  });
  await notifyUser(employeeUser._id, { title: "Case Information Requested", message: "Please check your email to activate your account and complete your questionnaire.", link: "/dashboard/profile", caseId: caseData._id, companyId: caseData.companyId }, actorUser, req);

  return { employeeUser, participant, createdAccount };
}

exports.createEmployerCase = async (req, res, next) => {
  try {
    // A "client" account that has chosen applicantType "employer" (the
    // common case — see PlanSelection.jsx / Profile.jsx) may self-serve
    // create an employer-sponsored case for their own employee. A real
    // invited employee (role "employee") is always blocked here regardless
    // of applicantType, per the employer-centric rule that an employee can
    // never initiate a case.
    if (!isEmployerCapable(req.user)) return res.status(403).json({ success: false, message: "Switch to \"Employer sponsoring employees\" in your profile to add an employee" });
    const company = await ensureEmployerCompany(req.user, req.body.company || {});
    const employeeEmail = clean(req.body.employee?.email || req.body.employeeEmail).toLowerCase();
    const employeeName = req.body.employee?.name || req.body.employeeName;
    const employeePhone = clean(req.body.employee?.phone || req.body.employeePhone);
    if (!employeeEmail) return res.status(400).json({ success: false, message: "Employee email is required" });
    // "invite" (default): the employee gets their own account + secure emailed
    // link. "employer_completes": the employer fills the employee's
    // questionnaire themselves — no account or email is created for them.
    const completionMode = req.body.employeeCompletionMode === "employer_completes" ? "employer_completes" : "invite";
    if (completionMode === "invite" && !employeePhone) {
      return res.status(400).json({ success: false, message: "Employee mobile number is required to send an invitation" });
    }
    const employeeUser = await User.findOne({ email: employeeEmail });
    const beneficiary = await Beneficiary.findOneAndUpdate(
      { email: employeeEmail },
      {
        email: employeeEmail,
        fullName: employeeName,
        firstName: req.body.employee?.firstName,
        lastName: req.body.employee?.lastName,
        user: employeeUser?._id,
        companyId: company._id,
        type: "employee",
        source: "BAIS",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const caseNumber = await generateCaseNumber();
    const visaType = req.body.visaType || req.body.petitionType || "H-1B";
    const definition = registry.getDefinition(visaType);
    const caseData = await Case.create({
      caseNumber,
      caseId: caseNumber,
      visaType,
      visaCategory: req.body.visaCategory || "Employment",
      petitionType: req.body.petitionType || req.body.visaType,
      clientName: beneficiary.fullName || employeeName || employeeEmail,
      clientEmail: employeeEmail,
      user: employeeUser?._id,
      employeeUser: employeeUser?._id,
      employerUser: req.user._id,
      createdBy: req.user._id,
      beneficiary: beneficiary._id,
      petitioner: company._id,
      petitionerModel: "Company",
      employer: company._id,
      organization: company._id,
      companyId: company._id,
      jobPosition: req.body.jobPosition || {},
      employeeInvite: { email: employeeEmail, name: employeeName, phone: employeePhone, status: "", invitedBy: req.user._id },
      employerEmployeeWorkflow: { employerStatus: "in_progress", employeeStatus: "not_invited", caseManagerStatus: "waiting_for_employee" },
      participants: [
        { role: "employer", status: "active", userId: req.user._id, companyId: company._id, name: company.name, progress: { status: "in_progress", percent: 0 }, createdBy: req.user._id },
        { role: "employee", status: completionMode === "invite" ? "invited" : "active", userId: employeeUser?._id, beneficiaryId: beneficiary._id, email: employeeEmail, name: employeeName, phone: employeePhone, invite: { email: employeeEmail, name: employeeName, phone: employeePhone, status: completionMode === "invite" ? "sent" : "", invitedBy: req.user._id }, progress: { status: completionMode === "invite" ? "invited" : "in_progress", percent: 0 }, createdBy: req.user._id },
      ],
      questionnaireData: {
        masterData: {
          employer: definition ? registry.normalizeEmployer(visaType, req.body.employerQuestionnaire || req.body.h1bEmployer || {}) : undefined,
        },
        questionnaireKey: definition ? `${definition.key}_employer_case_questionnaire` : undefined,
      },
      participantApprovals: [
        { role: "employer", user: req.user._id, status: "not_requested" },
        { role: "employee", user: employeeUser?._id, status: "not_requested" },
      ],
      legacySource: "BAIS",
    });
    assignStandardDocuments(caseData);
    beneficiary.caseIds = [...new Set([...(beneficiary.caseIds || []), caseData._id].map(String))];
    await beneficiary.save();
    caseService.addTimelineEvent(caseData, "case", "Employer Case Created", `${company.name} created a case for ${employeeEmail}.`, req.user, { companyId: company._id, employeeEmail });
    await caseData.save();

    if (completionMode === "invite") {
      await sendEmployeeInvite(caseData, { email: employeeEmail, name: employeeName, phone: employeePhone }, req.user, req);
    } else {
      caseData.questionnaireData = {
        ...plainQuestionnaireData(caseData),
        masterData: {
          ...(caseData.questionnaireData?.masterData || {}),
          employeeQuestionnaireAssignment: employeeAssignment("employer_completes", req.user),
        },
      };
      caseData.markModified("questionnaireData");
      await caseData.save();
    }
    res.status(201).json({ success: true, case: caseData, company, beneficiary });
  } catch (error) {
    next(error);
  }
};

exports.inviteEmployee = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    const email = clean(req.body.email || caseData.employeeInvite?.email || caseData.clientEmail).toLowerCase();
    const name = req.body.name || caseData.employeeInvite?.name || caseData.clientName;
    const phone = clean(req.body.phone);
    if (!email) return res.status(400).json({ success: false, message: "Employee email is required" });
    const { employeeUser, participant, createdAccount } = await sendEmployeeInvite(caseData, { email, name, phone, participantId: req.body.participantId }, req.user, req);
    res.json({ success: true, case: caseData, participant: participantService.participantSnapshot(participant), employeeUser: employeeUser.toAuthJSON ? employeeUser.toAuthJSON() : employeeUser, createdAccount });
  } catch (error) {
    next(error);
  }
};

exports.listParticipants = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    res.json({ success: true, participants: participantService.activeParticipants(caseData).map(participantService.participantSnapshot) });
  } catch (error) {
    next(error);
  }
};

exports.addEmployeeParticipant = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    if (normalizeRole(req.user.role) === "employee") return res.status(403).json({ success: false, message: "Employees cannot add other employees to a case" });
    const email = clean(req.body.email || req.body.employee?.email).toLowerCase();
    const name = req.body.name || req.body.employee?.name;
    const phone = clean(req.body.phone || req.body.employee?.phone);
    const mode = req.body.mode === "employer_completes" ? "employer_completes" : "invite";
    if (!email && mode === "invite") return res.status(400).json({ success: false, message: "Employee email is required" });
    if (mode === "invite") {
      const { employeeUser, participant, createdAccount } = await sendEmployeeInvite(caseData, { email, name, phone }, req.user, req);
      return res.status(201).json({ success: true, participant: participantService.participantSnapshot(participant), employeeUser: employeeUser.toAuthJSON ? employeeUser.toAuthJSON() : employeeUser, createdAccount, case: caseData });
    }
    const participant = participantService.ensureParticipant(caseData, {
      role: "employee",
      email,
      name,
      phone,
      status: "active",
      invite: { email, name, phone, status: "" },
      progress: { status: "in_progress", percent: 0 },
      metadata: { completionMode: "employer_completes" },
    }, req.user);
    caseService.addTimelineEvent(caseData, "employee", "Employee Participant Added", `${name || email || "Employee"} added for employer completion.`, req.user, { participantId: participant._id });
    await caseData.save();
    res.status(201).json({ success: true, participant: participantService.participantSnapshot(participant), case: caseData });
  } catch (error) {
    next(error);
  }
};

exports.declineParticipant = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    const participant = participantService.findParticipant(caseData, { participantId: req.params.participantId });
    if (!caseData || !participant || !participantService.canAccessParticipant(req.user, caseData, participant)) return res.status(404).json({ success: false, message: "Participant not found" });
    participant.status = "declined";
    participant.submissionStatus = "rejected";
    participant.progress = { ...(participant.progress?.toObject?.() || participant.progress || {}), status: "declined" };
    if (participant.invite) participant.invite.status = "declined";
    caseService.addTimelineEvent(caseData, "employee", "Participant Declined", `${participant.name || participant.email || "Participant"} declined the invitation.`, req.user, { participantId: participant._id });
    await caseData.save();
    res.json({ success: true, participant: participantService.participantSnapshot(participant), case: caseData });
  } catch (error) {
    next(error);
  }
};

exports.deleteParticipant = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData) || normalizeRole(req.user.role) === "employee") return res.status(404).json({ success: false, message: "Participant not found" });
    const participant = participantService.findParticipant(caseData, { participantId: req.params.participantId });
    if (!participant) return res.status(404).json({ success: false, message: "Participant not found" });
    participant.status = "deleted";
    participant.deletedAt = new Date();
    caseService.addTimelineEvent(caseData, "employee", "Participant Deleted", `${participant.name || participant.email || "Participant"} removed from the case.`, req.user, { participantId: participant._id });
    await caseData.save();
    res.json({ success: true, participant: participantService.participantSnapshot(participant), case: caseData });
  } catch (error) {
    next(error);
  }
};

exports.replaceParticipant = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData) || normalizeRole(req.user.role) === "employee") return res.status(404).json({ success: false, message: "Participant not found" });
    const previous = participantService.findParticipant(caseData, { participantId: req.params.participantId });
    if (!previous) return res.status(404).json({ success: false, message: "Participant not found" });
    previous.status = "replaced";
    previous.replacedAt = new Date();
    const { employeeUser, participant, createdAccount } = await sendEmployeeInvite(caseData, {
      email: clean(req.body.email).toLowerCase(),
      name: req.body.name,
      phone: clean(req.body.phone),
    }, req.user, req);
    previous.replacedBy = participant._id;
    await caseData.save();
    res.json({ success: true, previous: participantService.participantSnapshot(previous), participant: participantService.participantSnapshot(participant), employeeUser: employeeUser.toAuthJSON ? employeeUser.toAuthJSON() : employeeUser, createdAccount, case: caseData });
  } catch (error) {
    next(error);
  }
};

// Regenerates a fresh invite token and re-sends the employee-case-invitation
// email — for an employee who never saw the original email, or whose 7-day
// token expired. Reuses sendEmployeeInvite exactly (finds the existing
// employeeUser by email, never creates a second account) so this is never a
// duplicate-invite path, just a refresh of the same one.
exports.resendEmployeeInvite = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    const email = clean(caseData.employeeInvite?.email || caseData.clientEmail).toLowerCase();
    const name = caseData.employeeInvite?.name || caseData.clientName;
    const phone = clean(caseData.employeeInvite?.phone);
    if (!email) return res.status(400).json({ success: false, message: "No employee has been invited on this case yet" });
    const { employeeUser, participant } = await sendEmployeeInvite(caseData, { email, name, phone, participantId: req.body.participantId }, req.user, req);
    caseService.addAuditEntry(caseData, "employee_invite_resent", `Invitation re-sent to ${email}.`, req.user, { email }, req);
    await caseData.save();
    res.json({ success: true, message: "Invitation re-sent", case: caseData, participant: participantService.participantSnapshot(participant), employeeUser: employeeUser.toAuthJSON ? employeeUser.toAuthJSON() : employeeUser });
  } catch (error) {
    next(error);
  }
};

exports.saveJobInfo = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    if (normalizeRole(req.user.role) === "employee") return res.status(403).json({ success: false, message: "Only employer can edit job information" });
    caseData.jobPosition = { ...(caseData.jobPosition || {}), ...(req.body.jobPosition || req.body) };
    assignStandardDocuments(caseData);
    caseData.employerEmployeeWorkflow.employerStatus = "in_progress";
    caseService.addTimelineEvent(caseData, "employer", "Job Information Updated", "Employer updated company/job information.", req.user);
    await caseData.save();
    res.json({ success: true, case: caseData });
  } catch (error) {
    next(error);
  }
};

exports.saveEmployeeQuestionnaire = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    const role = normalizeRole(req.user.role);
    if (!["employee", "client", "employer"].includes(role)) return res.status(403).json({ success: false, message: "Only an assigned participant can edit employee information" });
    if (role !== "employee" && String(caseData.employerUser || "") !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Only the sponsoring employer can complete this employee questionnaire" });
    }
    const visaType = caseVisaType(caseData);
    const definition = registry.getDefinition(visaType);
    if (!definition) return res.status(400).json({ success: false, message: "The employee questionnaire is not available for this visa type" });

    // Employee questionnaire *content* now lives in the Questionnaire/Answer
    // system (see questionnaires module) — this endpoint only assigns which
    // side completes the packet and requests the visa's standard documents.
    // It must never write questionnaire content to masterData.employee: that
    // field is unused by any current reader and writing to it here previously
    // clobbered it with an empty/defaulted object on every "employer
    // completes the packet" assignment.
    const assignmentMode = role !== "employee" ? "employer_completes" : "invite_employee";
    caseData.questionnaireData = {
      ...plainQuestionnaireData(caseData),
      questionnaireKey: `${definition.key}_employee_case_questionnaire`,
      masterData: {
        ...(caseData.questionnaireData?.masterData || {}),
        employeeQuestionnaireAssignment: {
          ...(caseData.questionnaireData?.masterData?.employeeQuestionnaireAssignment || {}),
          ...employeeAssignment(assignmentMode, req.user),
        },
      },
    };
    caseData.markModified("questionnaireData");
    assignStandardDocuments(caseData);
    const participant = participantService.ensureParticipant(caseData, {
      role: "employee",
      participantId: req.body.participantId,
      userId: role === "employee" ? req.user._id : caseData.employeeUser || caseData.user,
      email: role === "employee" ? req.user.email : caseData.employeeInvite?.email || caseData.clientEmail,
      name: caseData.employeeInvite?.name || caseData.clientName,
      progress: { status: "in_progress" },
    }, req.user);
    caseData.employerEmployeeWorkflow.employeeStatus = "in_progress";
    caseService.addTimelineEvent(caseData, role !== "employee" ? "employer" : "employee", "Employee Questionnaire Updated", `${role !== "employee" ? "Employer" : "Employee"} updated the employee case questionnaire.`, req.user, { participantId: participant._id });
    await caseData.save();
    res.json({ success: true, case: caseData });
  } catch (error) {
    next(error);
  }
};

exports.submitParticipantInfo = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !canAccessEmployerCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    const role = normalizeRole(req.user.role) === "employer" || req.body.target === "employer" ? "employer" : "employee";
    const now = new Date();
    const participant = participantService.findParticipant(caseData, { role, participantId: req.body.participantId, userId: req.user._id, email: req.user.email }) ||
      participantService.ensureParticipant(caseData, { role, participantId: req.body.participantId, userId: role === "employee" ? req.user._id : caseData.employerUser, email: req.user.email }, req.user);
    participant.status = "submitted";
    participant.progress = { ...(participant.progress?.toObject?.() || participant.progress || {}), status: "submitted", percent: 100, lastCalculatedAt: now };
    participant.submissionStatus = "submitted";
    if (role === "employer") {
      caseData.employerEmployeeWorkflow.employerStatus = "submitted";
      caseData.employerEmployeeWorkflow.employerSubmittedAt = now;
    } else {
      caseData.employerEmployeeWorkflow.employeeStatus = "submitted";
      caseData.employerEmployeeWorkflow.employeeSubmittedAt = now;
    }
    caseData.informationRequests.forEach((request) => {
      if (request.target === role && request.status === "open") {
        request.status = "submitted";
        request.submittedAt = now;
      }
    });
    caseData.employerEmployeeWorkflow.caseManagerStatus = nextWorkflowStatus(caseData);
    if (caseData.employerEmployeeWorkflow.caseManagerStatus === "ready_for_review") caseData.employerEmployeeWorkflow.readyForReviewAt = now;
    caseService.addTimelineEvent(caseData, role, `${role === "employer" ? "Employer" : "Employee"} Information Submitted`, `${role} submitted their portion of the case.`, req.user, { participantId: participant._id });
    await caseData.save();
    if (caseData.assignedCaseManager) await notifyUser(caseData.assignedCaseManager, { title: "Case Information Submitted", message: `${role} submitted information for ${caseData.caseNumber}.`, link: `/crm-cases/${caseData._id}`, caseId: caseData._id, companyId: caseData.companyId }, req.user, req);
    res.json({ success: true, case: caseData });
  } catch (error) {
    next(error);
  }
};

exports.createInformationRequest = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData || !caseService.canAccessCase(req.user, caseData)) return res.status(404).json({ success: false, message: "Case not found" });
    const target = req.body.target === "employer" ? "employer" : "employee";
    const participant = participantService.findParticipant(caseData, { role: target, participantId: req.body.participantId });
    const assignedTo = participant?.userId || (target === "employer" ? caseData.employerUser : (caseData.employeeUser || caseData.user));
    const task = await Task.create({
      title: req.body.title || "Information requested",
      description: req.body.description,
      caseId: caseData._id,
      companyId: caseData.companyId,
      assignedTo,
      assignedBy: req.user._id,
      category: "client_communication",
      documentation: { workType: req.body.requestType === "document" ? "document_request" : "client_follow_up", documentType: req.body.documentType, instructions: req.body.description },
      priority: req.body.priority || "medium",
      status: assignedTo ? "assigned" : "pending",
      dueDate: req.body.dueDate,
      source: "shared",
    });
    caseData.informationRequests.push({
      target,
      title: req.body.title || "Information requested",
      description: req.body.description,
      requestType: req.body.requestType || "other",
      documentType: req.body.documentType,
      dueDate: req.body.dueDate,
      assignedTo,
      requestedBy: req.user._id,
      task: task._id,
      participantId: participant?._id,
    });
    if (participant) {
      participant.status = "needs_info";
      participant.progress = { ...(participant.progress?.toObject?.() || participant.progress || {}), status: "needs_info" };
    }
    caseData.employerEmployeeWorkflow[`${target}Status`] = "needs_info";
    caseData.employerEmployeeWorkflow.caseManagerStatus = target === "employer" ? "waiting_for_employer" : "waiting_for_employee";
    caseService.addTimelineEvent(caseData, "request", "Information Requested", `${target} was asked for ${req.body.title || "additional information"}.`, req.user, { target, taskId: task._id });
    await caseData.save();
    if (assignedTo) await notifyUser(assignedTo, { title: "Information Requested", message: req.body.description || req.body.title, link: target === "employer" ? "/dashboard/employer" : "/dashboard/profile", caseId: caseData._id, companyId: caseData.companyId }, req.user, req);
    res.status(201).json({ success: true, request: caseData.informationRequests[caseData.informationRequests.length - 1], task, case: caseData });
  } catch (error) {
    next(error);
  }
};
