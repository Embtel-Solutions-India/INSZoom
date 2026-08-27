const Appointment = require("../../models/Appointment");
const Answer = require("../../models/Answer");
const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Document = require("../../models/Document");
const Message = require("../../models/Message");
const Notification = require("../../models/Notification");
const Payment = require("../../models/Payment");
const Task = require("../../models/Task");
const User = require("../../models/User");
const beneficiaryService = require("../beneficiaries/beneficiary.service");
const { resolveDocumentRequirements } = require("../document-requirements/document-requirement.resolver");
const generateCaseNumber = require("../cases/caseId");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { normalizePackageName } = require("../../config/packages");
const caseService = require("../cases/case.service");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");

const CLIENT_SELECT = "";
const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];

function sameId(left, right) {
  return left && right && left.toString() === right.toString();
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function canAccessClient(user, client) {
  if (!user || !client) return false;
  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return true;
  if (sameId(client.user, user._id)) return true;
  if (role === "case_manager" && sameId(client.assignedCaseManager, user._id)) return true;
  if (role === "team_lead" && user.teamId && sameId(client.teamId, user.teamId)) return true;
  return STAFF_ROLES.includes(role);
}

function canModifyClient(user, client) {
  if (!user || !client) return false;
  const role = roleOf(user);
  if (["super_admin", "admin", "case_manager"].includes(role)) return true;
  if (sameId(client.user, user._id)) return true;
  if (role === "team_lead" && user.teamId && sameId(client.teamId, user.teamId)) return true;
  return false;
}

function mapLegacyProfile(data = {}, userId) {
  const personalInfo = data.personalInfo || {};
  const contactInfo = data.contactInfo || {};
  const visaSelection = data.visaSelection || {};
  return {
    user: data.user || userId,
    clientPortalId: data.clientPortalId,
    firstName: data.firstName || personalInfo.firstName,
    middleName: data.middleName || personalInfo.middleName,
    lastName: data.lastName || personalInfo.lastName,
    fullName: data.fullName || data.clientName,
    email: data.email || contactInfo.email,
    dateOfBirth: data.dateOfBirth || personalInfo.dateOfBirth,
    gender: data.gender || personalInfo.gender,
    maritalStatus: data.maritalStatus || personalInfo.maritalStatus,
    nativeLanguage: data.nativeLanguage || personalInfo.nativeLanguage,
    countryOfBirth: data.countryOfBirth || personalInfo.countryOfBirth,
    countryOfCitizenship: data.countryOfCitizenship || personalInfo.countryOfCitizenship,
    nationality: data.nationality || personalInfo.nationality,
    primaryPhone: data.primaryPhone || contactInfo.phone || contactInfo.primaryPhone,
    whatsappNumber: data.whatsappNumber || contactInfo.whatsappNumber,
    preferredContact: data.preferredContact || contactInfo.preferredContact,
    address: data.address || contactInfo.address,
    apartment: data.apartment || contactInfo.apartment,
    city: data.city || contactInfo.city,
    state: data.state || contactInfo.state,
    zipCode: data.zipCode || contactInfo.zipCode,
    country: data.country || contactInfo.country,
    emergencyName: data.emergencyName || contactInfo.emergencyName,
    emergencyRelation: data.emergencyRelation || contactInfo.emergencyRelation,
    emergencyPhone: data.emergencyPhone || contactInfo.emergencyPhone,
    emergencyEmail: data.emergencyEmail || contactInfo.emergencyEmail,
    spouseFullName: data.spouseFullName,
    spouseDOB: data.spouseDOB,
    spouseNationality: data.spouseNationality,
    spouseVisaStatus: data.spouseVisaStatus,
    spouseEmail: data.spouseEmail,
    spousePhone: data.spousePhone,
    numberOfDependents: data.numberOfDependents,
    children: data.children,
    dependents: data.dependents,
    passportNumber: data.passportNumber || data.passportInfo?.number,
    passportCountry: data.passportCountry || data.passportInfo?.country,
    passportIssueDate: data.passportIssueDate || data.passportInfo?.issueDate,
    passportExpirationDate: data.passportExpirationDate || data.passportInfo?.expirationDate,
    passportInfo: data.passportInfo,
    visaCategory: data.visaCategory || visaSelection.visaCategory,
    visaType: data.visaType || visaSelection.visaType,
    selectedPlan: normalizePackageName(data.selectedPlan || visaSelection.package || data.package),
    employmentHistory: data.employmentHistory || data.employment,
    educationHistory: data.educationHistory || data.education,
    assessmentCompleted: data.assessmentCompleted,
    assessmentAnswers: data.assessmentAnswers,
    assessmentRecommendedVisa: data.assessmentRecommendedVisa,
    assessmentMatchPercentage: data.assessmentMatchPercentage,
    completed: data.completed,
    lastStep: data.lastStep,
    assignedCaseManager: data.assignedCaseManager,
    companyId: data.companyId,
    teamId: data.teamId,
    syncStatus: data.syncStatus,
    lastSyncedAt: data.lastSyncedAt,
    source: data.source,
  };
}

function cleanPayload(payload = {}) {
  return Object.entries(payload).reduce((picked, [key, value]) => {
    if (value !== undefined) picked[key] = value;
    return picked;
  }, {});
}

function completionScore(client) {
  const fields = ["firstName", "lastName", "email", "primaryPhone", "dateOfBirth", "countryOfCitizenship", "visaType", "address", "city", "country", "declaration"];
  const complete = fields.filter((field) => Boolean(client[field])).length;
  return Math.round((complete / fields.length) * 100);
}

function buildClientFilter(query = {}, user) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.visaType) filter.visaType = query.visaType;
  if (query.visaCategory) filter.visaCategory = query.visaCategory;
  if (query.companyId) filter.companyId = query.companyId;
  if (query.teamId) filter.teamId = query.teamId;
  if (query.assignedCaseManager) filter.assignedCaseManager = query.assignedCaseManager;
  if (query.search) {
    const search = { $regex: query.search, $options: "i" };
    filter.$or = [{ fullName: search }, { email: search }, { clientPortalId: search }, { visaType: search }];
  }
  const role = roleOf(user);
  if (role === "client") filter.user = user._id;
  else if (role === "case_manager") filter.assignedCaseManager = user._id;
  else if (role === "team_lead" && user.teamId) filter.teamId = user.teamId;
  return filter;
}

function pagination(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

function sortFor(query = {}) {
  const allowed = new Set(["fullName", "email", "status", "visaType", "createdAt", "updatedAt", "profileCompletion"]);
  const sortBy = allowed.has(query.sortBy) ? query.sortBy : "updatedAt";
  return { [sortBy]: query.sortOrder === "asc" ? 1 : -1 };
}

async function writeAuditLog(action, client, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "client",
    entityId: client?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} client ${client?.fullName || client?.email || client?._id}`,
  }).catch(() => {});
}

function addTimeline(client, type, title, description, user, metadata = {}) {
  client.timeline.push({ type, title, description, metadata, createdBy: user?._id });
  client.activityHistory.push({ type, title, description, metadata, createdBy: user?._id });
}

async function ensureCaseForCompletedClient(client, data = {}, user, req) {
  // ARCHITECTURE NOTE (Phase Pre-2B): This function previously auto-created a Case
  // when a client completed their intake profile. Case creation is now a staff-only
  // action performed through the admin portal. This function is intentionally a no-op.
  // It will be removed entirely in Phase 4 when the client intake flow is redesigned.
  console.warn(
    `[ensureCaseForCompletedClient] Called for client ${client?._id} but case auto-creation ` +
    `is disabled. No case was created. This is expected behavior post-architecture-change.`
  );
  return null;
}

// Ensures the Case Manager immediately sees that the client has submitted
// (or updated) their intake information, without needing a manual refresh:
// adds a Case timeline entry, an in-app notification, and a realtime push.
// The notification is only sent at "high" priority on the client's first
// completed submission to avoid spamming the case manager on every
// subsequent edit; later edits still record a (quieter) timeline entry.
async function notifyCaseOfClientSubmission(caseData, client, user, req, { isFirstSubmission }) {
  const title = isFirstSubmission ? "Client Submitted Information" : "Client Updated Profile Information";
  const description = isFirstSubmission
    ? `${client.fullName || "The client"} submitted their profile information for review.`
    : `${client.fullName || "The client"} updated their profile information.`;

  caseService.addTimelineEvent(caseData, "client_submission", title, description, user, { clientId: client._id, isFirstSubmission });
  caseService.addActivity(caseData, title, description, user);
  caseService.addAuditEntry(caseData, "client_profile_submitted", description, user, { clientId: client._id, isFirstSubmission }, req);
  await caseData.save();
  await caseService.writeAuditLog("client_profile_submitted", caseData, user, { clientId: client._id, isFirstSubmission }, req);

  const caseManagerId = caseData.assignedCaseManager || caseData.primaryOwner;
  if (!caseManagerId) return;

  await notificationService.createNotification({
    userId: caseManagerId,
    type: isFirstSubmission ? "questionnaire_submitted" : "general",
    category: "case",
    title,
    message: `${caseData.caseNumber || caseData.caseId} · ${description}`,
    caseId: caseData._id,
    link: `/crm-cases/${caseData._id}`,
    priority: isFirstSubmission ? "high" : "medium",
    source: "shared",
  }, user, req).catch(() => null);

  realtimeGateway.emitToUser(caseManagerId, "case:client_submitted", {
    _id: caseData._id,
    caseNumber: caseData.caseNumber,
    clientName: caseData.clientName,
    isFirstSubmission,
  });
}

async function createClient(payload, user, req) {
  const mapped = cleanPayload(mapLegacyProfile(payload.data || payload, payload.user || payload.userId));
  if (mapped.email) {
    let clientUser = await User.findOne({ email: mapped.email.toLowerCase() });
    if (!clientUser && payload.createUser) {
      clientUser = await User.create({ email: mapped.email, name: mapped.fullName, displayName: mapped.fullName, role: "client", isEmailVerified: false });
    }
    if (clientUser && !mapped.user) mapped.user = clientUser._id;
  }
  const client = await Client.create(mapped);
  client.profileCompletion = completionScore(client);
  addTimeline(client, "client_created", "Client Created", "Client profile created", user);
  client.auditHistory.push({ action: "create", changes: mapped, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await client.save();
  await beneficiaryService.syncFromClient(client, user, req);
  await writeAuditLog("create", client, user, mapped, req);
  return client;
}

async function getAccessibleClientOrThrow(id, user) {
  const client = await Client.findOne({ $or: [{ _id: id }, { user: id }, { clientPortalId: id }] }).select(CLIENT_SELECT);
  if (!client) {
    const error = new Error("Client not found");
    error.status = 404;
    throw error;
  }
  if (!canAccessClient(user, client)) {
    const error = new Error("Not authorized to access this client");
    error.status = 403;
    throw error;
  }
  return client;
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
  }
  return client;
}

async function saveProfile(user, targetUserId, payload, req) {
  if (roleOf(user) === "client" && !sameId(user._id, targetUserId)) {
    const error = new Error("Access denied");
    error.status = 403;
    throw error;
  }
  const previousState = await Client.findOne({ user: targetUserId }).select("completed").lean();
  const wasCompleted = Boolean(previousState?.completed);

  const data = payload.data || payload;
  const mapped = cleanPayload(mapLegacyProfile({ ...data, completed: Boolean(payload.completed), lastStep: payload.lastStep || data.lastStep || 1 }, targetUserId));
  let client = await Client.findOneAndUpdate({ user: targetUserId }, { $set: mapped }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  client.profileCompletion = completionScore(client);
  addTimeline(client, "profile_saved", "Profile Saved", "Client profile updated", user, { completed: client.completed, lastStep: client.lastStep });
  client.auditHistory.push({ action: "save_profile", changes: mapped, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await client.save();
  await beneficiaryService.syncFromClient(client, user, req);
  const relatedCase = await ensureCaseForCompletedClient(client, data, user, req);
  if (relatedCase && client.completed) {
    await notifyCaseOfClientSubmission(relatedCase, client, user, req, { isFirstSubmission: !wasCompleted }).catch(() => null);
  }
  await writeAuditLog("save_profile", client, user, mapped, req);
  return client;
}

async function updateClient(id, payload, user, req) {
  const client = await getAccessibleClientOrThrow(id, user);
  if (!canModifyClient(user, client)) {
    const error = new Error("Not authorized to modify this client");
    error.status = 403;
    throw error;
  }
  const mapped = cleanPayload(mapLegacyProfile(payload.data || payload, payload.user || payload.userId));
  Object.assign(client, mapped);
  client.profileCompletion = completionScore(client);
  addTimeline(client, "client_updated", "Client Updated", "Client profile updated", user);
  client.auditHistory.push({ action: "update", changes: mapped, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await client.save();
  await beneficiaryService.syncFromClient(client, user, req);
  await writeAuditLog("update", client, user, mapped, req);
  return client;
}

async function listClients(query, user) {
  const filter = buildClientFilter(query, user);
  const { page, limit, skip } = pagination(query);
  const [clients, total] = await Promise.all([
    Client.find(filter).sort(sortFor(query)).skip(skip).limit(limit),
    Client.countDocuments(filter),
  ]);
  return { clients, count: clients.length, total, pagination: { page, limit, pages: Math.ceil(total / limit) || 1 } };
}

async function addNote(id, payload, user, req) {
  const client = await updateClient(id, {}, user, req);
  client.notes.push({ note: payload.note, isInternal: payload.isInternal !== false, author: user._id });
  addTimeline(client, "note", "Client Note Added", payload.note, user);
  await client.save();
  return client;
}

async function getRelated(id, user) {
  const client = await getAccessibleClientOrThrow(id, user);
  const caseFilter = { $or: [{ clientProfile: client._id }, { user: client.user }, { clientPortalId: client.clientPortalId }].filter((item) => Object.values(item)[0]) };
  const cases = await Case.find(caseFilter).sort({ updatedAt: -1 });
  const caseIds = cases.map((item) => item._id);
  const [documents, messages, notifications, appointments, payments, questionnaires, tasks] = await Promise.all([
    Document.find({ $or: [{ user: client.user }, { caseId: { $in: caseIds } }] }).sort({ updatedAt: -1 }),
    Message.find({ $or: [{ caseId: { $in: caseIds } }, { senderId: client.user }, { receiverId: client.user }] }).sort({ createdAt: -1 }).limit(50),
    Notification.find({ $or: [{ user: client.user }, { userId: client.user }, { caseId: { $in: caseIds } }] }).sort({ createdAt: -1 }).limit(50),
    Appointment.find({ $or: [{ clientId: client.user }, { linkedUser: client.user }, { caseId: { $in: caseIds } }] }).sort({ startAt: -1 }),
    Payment.find({ $or: [{ user: client.user }, { case: { $in: caseIds } }, { caseId: { $in: caseIds } }] }).sort({ updatedAt: -1 }),
    Answer.find({ $or: [{ user: client.user }, { clientId: client.user }, { caseId: { $in: caseIds } }] }).sort({ updatedAt: -1 }).limit(100),
    Task.find({ $or: [{ clientId: client.user }, { caseId: { $in: caseIds } }] }).sort({ dueDate: 1 }),
  ]);
  const beneficiary = client.beneficiary ? await beneficiaryService.getAccessibleBeneficiaryOrThrow(client.beneficiary, user).catch(() => null) : await beneficiaryService.syncFromClient(client, user).catch(() => null);
  return { client, beneficiary, cases, documents, messages, notifications, appointments, payments, questionnaires, tasks };
}

async function getDashboard(user) {
  const client = await getMyClient(user);
  const related = await getRelated(client._id, user);
  const missingDocuments = related.cases.flatMap((caseData) => (caseData.checklistItems || caseData.documentChecklist || []).filter((item) => item.required && !["uploaded", "approved", "submitted"].includes(item.status)));
  return {
    client,
    stats: {
      cases: related.cases.length,
      documents: related.documents.length,
      messages: related.messages.length,
      unreadNotifications: related.notifications.filter((item) => !item.read && !item.isRead).length,
      appointments: related.appointments.length,
      payments: related.payments.length,
      missingDocuments: missingDocuments.length,
      profileCompletion: client.profileCompletion,
    },
    missingDocuments,
    recentActivity: [...client.activityHistory, ...related.notifications.map((notification) => ({
      type: "notification",
      title: notification.title,
      description: notification.message,
      createdAt: notification.createdAt,
    }))].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20),
  };
}

module.exports = {
  addNote,
  canAccessClient,
  canModifyClient,
  createClient,
  getAccessibleClientOrThrow,
  getDashboard,
  getMyClient,
  getRelated,
  listClients,
  saveProfile,
  updateClient,
};
