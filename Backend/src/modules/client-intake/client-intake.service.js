const AuditLog = require("../../models/AuditLog");
const Answer = require("../../models/Answer");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Document = require("../../models/Document");
const User = require("../../models/User");
const { normalizeRole } = require("../authorization/roleHierarchy");
const caseService = require("../cases/case.service");
const caseWorkflowAutomation = require("../cases/case-workflow-automation.service");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal", "reviewer"];
const COMPLETE_STATUSES = ["uploaded", "submitted", "approved", "received", "complete", "completed"];

const SECTION_RULES = [
  { key: "personalInformation", fields: ["firstName", "lastName", "dateOfBirth", "gender", "maritalStatus", "countryOfBirth", "countryOfCitizenship", "nationality"] },
  { key: "contactInformation", fields: ["email", "primaryPhone", "address", "city", "state", "zipCode", "country"] },
  { key: "passport", fields: ["passportNumber", "passportCountry", "passportExpirationDate"] },
  { key: "addresses", array: "addressHistory", minimum: 1 },
  { key: "employment", array: "employmentHistory", minimum: 1 },
  { key: "education", array: "educationHistory", minimum: 1 },
  { key: "immigration", fields: ["currentVisaStatus", "immigrationStatus"], array: "immigrationHistory" },
  { key: "travel", array: "travelHistory" },
  { key: "family", fields: ["maritalStatus"], array: "children" },
  { key: "emergencyContact", fields: ["emergencyName", "emergencyRelation", "emergencyPhone"] },
  { key: "additionalInformation", fields: ["criminalRecord", "visaDenial", "deportation", "priorApplications", "declaration"] },
];

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function sameId(left, right) {
  return Boolean(left && right && idOf(left) === idOf(right));
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function pickDefined(payload = {}) {
  return Object.entries(payload).reduce((acc, [key, value]) => {
    if (value !== undefined) acc[key] = value;
    return acc;
  }, {});
}

function flattenIntakeData(data = {}) {
  const personal = data.personalInformation || data.personalInfo || {};
  const contact = data.contactInformation || data.contactInfo || {};
  const passport = data.passport || data.passportDetails || data.passportInfo || {};
  const emergency = data.emergencyContact || {};
  const family = data.familyInformation || {};
  const immigration = data.immigration || data.immigrationInformation || {};
  const additional = data.additionalInformation || {};

  return pickDefined({
    firstName: data.firstName || personal.firstName,
    middleName: data.middleName || personal.middleName,
    lastName: data.lastName || personal.lastName,
    fullName: data.fullName || personal.fullName,
    email: data.email || contact.email,
    dateOfBirth: data.dateOfBirth || personal.dateOfBirth,
    gender: data.gender || personal.gender,
    maritalStatus: data.maritalStatus || personal.maritalStatus,
    nativeLanguage: data.nativeLanguage || personal.nativeLanguage,
    countryOfBirth: data.countryOfBirth || personal.countryOfBirth,
    countryOfCitizenship: data.countryOfCitizenship || personal.countryOfCitizenship,
    nationality: data.nationality || personal.nationality,
    primaryPhone: data.primaryPhone || contact.primaryPhone || contact.phone,
    whatsappNumber: data.whatsappNumber || contact.whatsappNumber,
    preferredContact: data.preferredContact || contact.preferredContact,
    address: data.address || contact.address,
    apartment: data.apartment || contact.apartment,
    city: data.city || contact.city,
    state: data.state || contact.state,
    zipCode: data.zipCode || contact.zipCode,
    country: data.country || contact.country,
    emergencyName: data.emergencyName || emergency.name || emergency.emergencyName,
    emergencyRelation: data.emergencyRelation || emergency.relationship || emergency.relation,
    emergencyPhone: data.emergencyPhone || emergency.phone,
    emergencyEmail: data.emergencyEmail || emergency.email,
    spouseFullName: data.spouseFullName || family.spouseFullName,
    spouseDOB: data.spouseDOB || family.spouseDOB,
    spouseNationality: data.spouseNationality || family.spouseNationality,
    spouseVisaStatus: data.spouseVisaStatus || family.spouseVisaStatus,
    spouseEmail: data.spouseEmail || family.spouseEmail,
    spousePhone: data.spousePhone || family.spousePhone,
    numberOfDependents: data.numberOfDependents ?? family.numberOfDependents,
    children: data.children || family.children,
    dependents: data.dependents || family.dependents,
    passportNumber: data.passportNumber || passport.number || passport.passportNumber,
    passportCountry: data.passportCountry || passport.country || passport.passportCountry,
    passportIssueDate: data.passportIssueDate || passport.issueDate || passport.passportIssueDate,
    passportExpirationDate: data.passportExpirationDate || passport.expirationDate || passport.passportExpirationDate,
    passportInfo: isObject(passport) ? passport : undefined,
    passportDetails: isObject(passport) ? passport : undefined,
    currentVisaStatus: data.currentVisaStatus || immigration.currentVisaStatus,
    visaExpirationDate: data.visaExpirationDate || immigration.visaExpirationDate,
    immigrationStatus: data.immigrationStatus || immigration.immigrationStatus,
    immigrationInfo: isObject(immigration) ? immigration : undefined,
    addressHistory: data.addressHistory,
    employmentHistory: data.employmentHistory || data.employment,
    educationHistory: data.educationHistory || data.education,
    immigrationHistory: data.immigrationHistory || immigration.history,
    travelHistory: data.travelHistory || data.travel,
    familyInformation: family,
    additionalInformation: additional,
    dynamicCaseInformation: data.dynamicCaseInformation || data.caseSpecificInformation || {},
    criminalRecord: data.criminalRecord || additional.criminalRecord,
    criminalDetails: data.criminalDetails || additional.criminalDetails,
    visaDenial: data.visaDenial || additional.visaDenial,
    visaDenialDetails: data.visaDenialDetails || additional.visaDenialDetails,
    deportation: data.deportation || additional.deportation,
    deportationDetails: data.deportationDetails || additional.deportationDetails,
    priorApplications: data.priorApplications || additional.priorApplications,
    priorApplicationsDetails: data.priorApplicationsDetails || additional.priorApplicationsDetails,
    declaration: data.declaration ?? additional.declaration,
    visaType: data.visaType,
    visaCategory: data.visaCategory,
  });
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  if (value && typeof value === "object") return Object.values(value).some(valuePresent);
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function sectionScore(client, rule) {
  const required = [...(rule.fields || [])];
  let complete = required.filter((field) => valuePresent(client[field])).length;
  let total = required.length;
  if (rule.array) {
    total += 1;
    if ((client[rule.array] || []).length >= (rule.minimum || 1)) complete += 1;
  }
  if (!total) return 100;
  return Math.round((complete / total) * 100);
}

async function calculateProgress(client, caseData) {
  const sections = {};
  const missingSections = [];
  const missingRequiredFields = [];
  SECTION_RULES.forEach((rule) => {
    const percent = sectionScore(client, rule);
    sections[rule.key] = percent;
    if (percent < 100) missingSections.push(rule.key);
    (rule.fields || []).forEach((field) => {
      if (!valuePresent(client[field])) missingRequiredFields.push(field);
    });
    if (rule.array && (client[rule.array] || []).length < (rule.minimum || 1)) missingRequiredFields.push(rule.array);
  });

  const checklist = [...(caseData?.documentChecklist || []), ...(caseData?.checklistItems || [])];
  const unique = new Map();
  checklist.forEach((item) => {
    const key = item.documentType || item.name || item._id?.toString?.();
    if (key && !unique.has(key)) unique.set(key, item);
  });
  const requiredDocuments = [...unique.values()].filter((item) => item.required !== false);
  const documentTypes = requiredDocuments.map((item) => item.documentType || item.name).filter(Boolean);
  const uploadedTypes = caseData?._id
    ? await Document.find({ caseId: caseData._id, deletedAt: { $exists: false }, documentType: { $in: documentTypes } }).distinct("documentType")
    : [];
  sections.documents = requiredDocuments.length ? Math.round((uploadedTypes.length / requiredDocuments.length) * 100) : 100;
  if (sections.documents < 100) missingSections.push("documents");

  const questionnaireProgress = caseData?.questionnaireData?.progress?.completionPercentage
    ?? caseData?.questionnaireData?.progress?.percent
    ?? 0;
  sections.questionnaire = questionnaireProgress || (caseData?.questionnaireData?.lastSubmittedAt ? 100 : 0);

  const overall = Math.round(Object.values(sections).reduce((sum, value) => sum + Number(value || 0), 0) / Object.keys(sections).length);
  return {
    overall,
    sections,
    missingSections: [...new Set(missingSections)],
    missingRequiredFields: [...new Set(missingRequiredFields)],
    lastCalculatedAt: new Date(),
  };
}

async function writeAudit(action, entityType, entityId, user, { previousValue, newValue, changes, details }, req) {
  await AuditLog.create({
    userId: user?._id,
    userRole: user?.role,
    action,
    entityType,
    entityId: entityId?.toString?.() || entityId,
    previousValue,
    newValue,
    changes,
    details,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  }).catch(() => null);
}

async function getMyClient(user) {
  let client = await Client.findOne({ user: user._id });
  if (!client) {
    client = await Client.create({
      user: user._id,
      email: user.email,
      fullName: user.name || user.displayName,
      firstName: user.name || user.displayName,
      source: "shared",
    });
    await writeAudit("profile_created", "client", client._id, user, { newValue: { user: user._id } });
  }
  return client;
}

async function getActiveCaseForClient(client, user) {
  const filter = {
    $or: [
      { user: client.user },
      { clientProfile: client._id },
      { clientPortalId: client.clientPortalId },
    ].filter((item) => Object.values(item)[0]),
    status: { $nin: ["closed", "archived", "cancelled", "rejected"] },
  };
  const scoped = roleOf(user) === "client" ? filter : { ...filter, ...caseService.buildCaseFilter({}, user) };
  return Case.findOne(scoped).sort({ createdAt: -1 });
}

async function assertCaseAccess(caseId, user) {
  const caseData = await caseService.getAccessibleCaseOrThrow(caseId, user);
  return caseData;
}

function canEditClientIntake(user, client, caseData) {
  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return true;
  if (["client", "user"].includes(role)) return sameId(client.user, user._id) && !["submitted", "locked"].includes(client.intakeSubmission?.status);
  if (role === "case_manager") return sameId(caseData?.assignedCaseManager, user._id);
  if (role === "team_lead") return true;
  return false;
}

function syncI907AddonIntake(caseData, data = {}) {
  const i907 = data.i907 || {};
  if (!caseData || !i907 || Object.keys(i907).length === 0) return;
  const addon = (caseData.addons || []).find((item) => item.key === "premium_processing_i907" && item.status !== "cancelled");
  if (!addon) return;
  const pointOfContact = [i907.pointOfContactGivenName, i907.pointOfContactFamilyName].filter(Boolean).join(" ").trim();
  addon.intake = {
    ...(addon.intake || {}),
    ...i907,
    relatedReceiptNumber: i907.relatedReceiptNumber || addon.intake?.relatedReceiptNumber,
    relatedFormNumber: i907.relatedFormNumber || addon.intake?.relatedFormNumber,
    companyContact: pointOfContact || addon.intake?.companyContact,
    pointOfContact: pointOfContact || addon.intake?.pointOfContact,
    ein: i907.ein || addon.intake?.ein,
  };
  if (["payment_pending", "paid", "waiting_for_information"].includes(addon.status)) {
    addon.status = "waiting_for_information";
  }
}

async function saveClientIntake({ user, caseId, payload, req, autoSave = false }) {
  const client = await getMyClient(user);
  const caseData = caseId ? await assertCaseAccess(caseId, user) : await getActiveCaseForClient(client, user);
  if (!caseData) {
    const error = new Error("No active case found for intake");
    error.statusCode = 404;
    throw error;
  }
  if (!canEditClientIntake(user, client, caseData)) {
    const error = new Error("Intake is locked or you do not have permission to edit it");
    error.statusCode = 403;
    throw error;
  }

  const previousValue = client.toObject ? client.toObject() : { ...client };
  const data = payload.data || payload;
  Object.assign(client, flattenIntakeData(data));
  client.intakeData = { ...(client.intakeData || {}), ...data };
  client.completed = Boolean(payload.completed ?? client.completed);
  client.lastStep = payload.lastStep || data.lastStep || client.lastStep || 1;
  client.intakeSubmission = {
    ...(client.intakeSubmission || {}),
    status: client.intakeSubmission?.status === "submitted" ? "submitted" : "draft",
    caseId: caseData._id,
    lastDraftSavedAt: new Date(),
    lastAutoSavedAt: autoSave ? new Date() : client.intakeSubmission?.lastAutoSavedAt,
    version: (client.intakeSubmission?.version || 0) + 1,
  };
  client.profileCompletion = (await calculateProgress(client, caseData)).overall;
  client.intakeProgress = await calculateProgress(client, caseData);
  client.timeline.push({ type: autoSave ? "profile_autosaved" : "profile_saved", title: autoSave ? "Profile Auto Saved" : "Profile Draft Saved", description: "Client intake draft saved", createdBy: user._id, metadata: { caseId: caseData._id } });
  client.activityHistory.push({ type: "profile_saved", title: "Profile Draft Saved", description: "Client intake draft saved", createdBy: user._id, metadata: { caseId: caseData._id } });
  client.auditHistory.push({ action: "profile_updated", changes: data, performedBy: user._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await client.save();

  if (!caseData.clientProfile) caseData.clientProfile = client._id;
  caseData.user = caseData.user || client.user;
  caseData.clientName = caseData.clientName || client.fullName;
  caseData.clientEmail = caseData.clientEmail || client.email;
  // Case.visaType is a required field, so it's always already set from case
  // creation - a client explicitly picking a specific visa type/category in
  // their Profile must actually correct the case, not just backfill a blank
  // that never occurs. Only overrides when the client sent an explicit value
  // in this save (not on every unrelated autosave).
  if (data.visaType) caseData.visaType = data.visaType;
  else caseData.visaType = caseData.visaType || client.visaType;
  if (data.visaCategory) caseData.visaCategory = data.visaCategory;
  else caseData.visaCategory = caseData.visaCategory || client.visaCategory;
  // Mutate the existing subdocument's own fields directly rather than
  // reassigning the whole `journeyProgress` object — spreading a Mongoose
  // subdocument (`{...caseData.journeyProgress}`) surfaces every schema path
  // as an own enumerable property, including unset ones (e.g. `nextAction`)
  // as an explicit `undefined`, which then fails re-casting against
  // `nextAction`'s nested-object schema on save (CastError, not just a no-op).
  const existingMetrics = caseData.journeyProgress?.metrics;
  caseData.journeyProgress.metrics = {
    ...(existingMetrics?.toObject ? existingMetrics.toObject() : existingMetrics || {}),
    intake: client.intakeProgress,
  };
  caseData.journeyProgress.lastCalculatedAt = new Date();
  syncI907AddonIntake(caseData, data);
  caseService.addTimelineEvent(caseData, "client_profile_draft", "Client Intake Draft Saved", "Client saved intake information.", user, { clientId: client._id, progress: client.intakeProgress });
  await caseData.save();

  await writeAudit("profile_updated", "client", client._id, user, { previousValue, newValue: client.toObject(), changes: data }, req);
  return buildIntakePayload(client, caseData, user);
}

async function notifySubmission(caseData, client, user, req) {
  const caseManagerId = caseData.assignedCaseManager || caseData.primaryOwner;
  if (!caseManagerId) return;
  const caseManager = await User.findById(caseManagerId).select("name displayName email").lean().catch(() => null);
  await notificationService.createNotification({
    userId: caseManagerId,
    type: "client_intake_submitted",
    category: "case",
    title: "Client Intake Submitted",
    message: `${client.fullName || caseData.clientName || "Client"} submitted intake information for ${caseData.caseNumber || caseData.caseId}.`,
    caseId: caseData._id,
    link: `/crm-cases/${caseData._id}`,
    priority: "high",
    emailTemplate: caseManager?.email ? "client-intake-submitted-case-manager" : undefined,
    emailTo: caseManager?.email,
    emailData: {
      caseManagerName: caseManager?.name || caseManager?.displayName || "Case Manager",
      clientName: client.fullName || caseData.clientName,
      caseNumber: caseData.caseNumber || caseData.caseId,
      completionPercentage: client.intakeProgress?.overall || 0,
    },
    metadata: { clientId: client._id, completionPercentage: client.intakeProgress?.overall },
    source: "shared",
  }, user, req).catch(() => null);
  realtimeGateway.emitToUser(caseManagerId, "case:client_submitted", {
    _id: caseData._id,
    caseNumber: caseData.caseNumber,
    clientName: client.fullName || caseData.clientName,
    isFirstSubmission: true,
  });
}

async function submitClientIntake({ user, caseId, req }) {
  const client = await getMyClient(user);
  const caseData = caseId ? await assertCaseAccess(caseId, user) : await getActiveCaseForClient(client, user);
  if (!caseData) {
    const error = new Error("No active case found for submission");
    error.statusCode = 404;
    throw error;
  }
  if (!sameId(client.user, user._id) && !STAFF_ROLES.includes(roleOf(user))) {
    const error = new Error("You do not have permission to submit this intake");
    error.statusCode = 403;
    throw error;
  }

  client.intakeProgress = await calculateProgress(client, caseData);
  if (client.intakeProgress.missingRequiredFields.length) {
    const error = new Error("Intake has incomplete required sections");
    error.statusCode = 422;
    error.details = client.intakeProgress;
    throw error;
  }
  client.completed = true;
  client.profileCompletion = client.intakeProgress.overall;
  client.intakeSubmission = {
    ...(client.intakeSubmission || {}),
    status: "submitted",
    caseId: caseData._id,
    submittedAt: new Date(),
    submittedBy: user._id,
    lockedAt: new Date(),
    lockedBy: user._id,
    version: (client.intakeSubmission?.version || 0) + 1,
  };
  client.timeline.push({ type: "submission_completed", title: "Submission Completed", description: "Client submitted intake information.", createdBy: user._id, metadata: { caseId: caseData._id } });
  client.activityHistory.push({ type: "submission_completed", title: "Submission Completed", description: "Client submitted intake information.", createdBy: user._id, metadata: { caseId: caseData._id } });
  client.auditHistory.push({ action: "submission_completed", changes: { caseId: caseData._id, progress: client.intakeProgress }, performedBy: user._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await client.save();

  caseService.addTimelineEvent(caseData, "client_submission", "Client Intake Submitted", "Client submitted profile and intake information for review.", user, { clientId: client._id, progress: client.intakeProgress });
  caseService.addActivity(caseData, "Client Intake Submitted", "Client submitted profile and intake information for review.", user);
  caseService.addAuditEntry(caseData, "client_intake_submitted", "Client intake submitted", user, { clientId: client._id, progress: client.intakeProgress }, req);
  // Mutate the existing subdocument's own fields directly rather than
  // reassigning the whole journeyProgress object - see the identical
  // workaround (and its rationale) above in saveClientIntake: spreading a
  // Mongoose subdocument surfaces every schema path as an own enumerable
  // property, including unset ones (e.g. nextAction) as an explicit
  // `undefined`, which then fails re-casting against its nested-object
  // schema on save (CastError, not just a no-op).
  const existingSubmitMetrics = caseData.journeyProgress?.metrics;
  caseData.journeyProgress.metrics = {
    ...(existingSubmitMetrics?.toObject ? existingSubmitMetrics.toObject() : existingSubmitMetrics || {}),
    intake: client.intakeProgress,
  };
  caseData.journeyProgress.currentMilestone = caseData.journeyProgress.currentMilestone || "client_intake_submitted";
  caseData.journeyProgress.lastCalculatedAt = new Date();
  await caseData.save();
  await caseService.writeAuditLog("client_intake_submitted", caseData, user, { clientId: client._id, progress: client.intakeProgress }, req);
  await writeAudit("submission_completed", "client", client._id, user, { newValue: client.intakeSubmission, changes: client.intakeProgress }, req);
  // Fire-and-forget: notifySubmission's internal createNotification() chain
  // (DB writes + SMTP + push) must never block the 201 - the submission
  // itself is already durably committed by client.save()/caseData.save()
  // above.
  notifySubmission(caseData, client, user, req).catch((error) => {
    console.error("[submitClientIntake] notifySubmission failed (non-fatal):", error?.message);
  });
  // setImmediate defers past the current event-loop iteration (i.e. past
  // res.json()) - same pattern already used for initializeCase in
  // case.controller.js. runPostClientSubmission's Drive sync/workbook
  // generation/USCIS form regeneration are heavy and must never block the
  // response; it was already .catch()-wrapped but still awaited, so a slow
  // one of the three Promise.all branches still delayed the 201.
  setImmediate(() => {
    caseWorkflowAutomation.runPostClientSubmission(caseData._id, user, req).catch((error) => {
      console.error("[submitClientIntake] Post-submission automation failed (non-fatal):", { caseId: caseData._id, message: error.message });
    });
  });
  return buildIntakePayload(client, caseData, user);
}

async function buildIntakePayload(client, caseData, user) {
  const documents = caseData?._id
    ? await Document.find({ caseId: caseData._id, deletedAt: { $exists: false } }).sort({ uploadDate: -1 }).lean()
    : [];
  const answers = caseData?._id
    ? await Answer.find({ caseId: caseData._id }).sort({ updatedAt: -1 }).limit(200).lean()
    : [];
  const progress = await calculateProgress(client, caseData);
  return {
    client,
    case: caseData,
    progress,
    submission: client.intakeSubmission,
    documents,
    questionnaire: {
      references: caseData?.questionnaireReferences || [],
      data: caseData?.questionnaireData || {},
      answers,
    },
    missingDocuments: (caseData?.checklistItems || caseData?.documentChecklist || []).filter((item) => item.required !== false && !COMPLETE_STATUSES.includes(String(item.status || "").toLowerCase())),
    recentActivity: [
      ...(client.activityHistory || []),
      ...(caseData?.timeline || []),
    ].sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0)).slice(0, 25),
  };
}

async function getMyIntake(user) {
  const client = await getMyClient(user);
  const caseData = await getActiveCaseForClient(client, user);
  return buildIntakePayload(client, caseData, user);
}

async function getCaseIntake(caseId, user) {
  const caseData = await assertCaseAccess(caseId, user);
  const client = caseData.clientProfile?._id ? caseData.clientProfile : await Client.findOne({ $or: [{ _id: caseData.clientProfile }, { user: caseData.user }, { clientPortalId: caseData.clientPortalId }].filter((item) => Object.values(item)[0]) });
  if (!client) return buildIntakePayload({}, caseData, user);
  return buildIntakePayload(client, caseData, user);
}

module.exports = {
  calculateProgress,
  getCaseIntake,
  getMyIntake,
  saveClientIntake,
  submitClientIntake,
};
