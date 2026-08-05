const Appointment = require("../../models/Appointment");
const Answer = require("../../models/Answer");
const AuditLog = require("../../models/AuditLog");
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Company = require("../../models/Company");
const Document = require("../../models/Document");
const Message = require("../../models/Message");
const Notification = require("../../models/Notification");
const Payment = require("../../models/Payment");
const Task = require("../../models/Task");
const User = require("../../models/User");
const Workflow = require("../../models/Workflow");
const { normalizeRole } = require("../authorization/roleHierarchy");

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const WRITE_ROLES = ["super_admin", "admin", "case_manager"];

function sameId(left, right) {
  const leftId = left?._id || left;
  const rightId = right?._id || right;
  return leftId && rightId && leftId.toString() === rightId.toString();
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function cleanPayload(payload = {}) {
  return Object.entries(payload).reduce((picked, [key, value]) => {
    if (value !== undefined) picked[key] = value;
    return picked;
  }, {});
}

function addTimeline(beneficiary, type, title, description, user, metadata = {}) {
  const event = { type, title, description, metadata, createdBy: user?._id };
  beneficiary.timeline.push(event);
  beneficiary.activityHistory.push(event);
}

async function writeAuditLog(action, beneficiary, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "beneficiary",
    entityId: beneficiary?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} beneficiary ${beneficiary?.fullName || beneficiary?.email || beneficiary?._id}`,
  }).catch(() => {});
}

function mapClientToBeneficiary(client = {}) {
  const emergencyContacts = [];
  if (client.emergencyName || client.emergencyPhone || client.emergencyEmail) {
    emergencyContacts.push({
      name: client.emergencyName,
      relationship: client.emergencyRelation,
      phone: client.emergencyPhone,
      email: client.emergencyEmail,
      isPrimary: true,
    });
  }
  const familyMembers = [];
  if (client.spouseFullName) {
    familyMembers.push({
      name: client.spouseFullName,
      relationship: "spouse",
      dob: client.spouseDOB,
      nationality: client.spouseNationality,
      immigrationStatus: client.spouseVisaStatus,
      email: client.spouseEmail,
      phone: client.spousePhone,
    });
  }
  return cleanPayload({
    user: client.user,
    client: client._id,
    companyId: client.companyId,
    clientPortalId: client.clientPortalId,
    status: client.status,
    firstName: client.firstName,
    middleName: client.middleName,
    lastName: client.lastName,
    fullName: client.fullName,
    email: client.email,
    primaryPhone: client.primaryPhone,
    whatsappNumber: client.whatsappNumber,
    preferredContact: client.preferredContact,
    dateOfBirth: client.dateOfBirth,
    gender: client.gender,
    maritalStatus: client.maritalStatus,
    nativeLanguage: client.nativeLanguage,
    countryOfBirth: client.countryOfBirth,
    countryOfCitizenship: client.countryOfCitizenship,
    nationality: client.nationality,
    address: client.address,
    apartment: client.apartment,
    city: client.city,
    state: client.state,
    zipCode: client.zipCode,
    country: client.country,
    addressHistory: client.addressHistory,
    emergencyContacts,
    familyMembers,
    dependents: client.dependents || client.children,
    numberOfDependents: client.numberOfDependents,
    passport: {
      number: client.passportNumber || client.passportInfo?.number,
      country: client.passportCountry || client.passportInfo?.country,
      issueDate: client.passportIssueDate || client.passportInfo?.issueDate,
      expirationDate: client.passportExpirationDate || client.passportInfo?.expirationDate,
      metadata: client.passportInfo,
    },
    passportNumber: client.passportNumber || client.passportInfo?.number,
    passportCountry: client.passportCountry || client.passportInfo?.country,
    passportIssueDate: client.passportIssueDate || client.passportInfo?.issueDate,
    passportExpirationDate: client.passportExpirationDate || client.passportInfo?.expirationDate,
    visa: {
      category: client.visaCategory,
      type: client.visaType,
      status: client.currentVisaStatus || client.immigrationStatus,
      expirationDate: client.visaExpirationDate,
      metadata: client.immigrationInfo,
    },
    visaCategory: client.visaCategory,
    visaType: client.visaType,
    currentVisaStatus: client.currentVisaStatus,
    visaExpirationDate: client.visaExpirationDate,
    immigrationStatus: client.immigrationStatus,
    immigrationInfo: client.immigrationInfo,
    employmentHistory: client.employmentHistory,
    educationHistory: client.educationHistory,
    criminalRecord: client.criminalRecord,
    criminalDetails: client.criminalDetails,
    visaDenial: client.visaDenial,
    visaDenialDetails: client.visaDenialDetails,
    deportation: client.deportation,
    deportationDetails: client.deportationDetails,
    priorApplications: client.priorApplications,
    priorApplicationsDetails: client.priorApplicationsDetails,
    assignedCaseManager: client.assignedCaseManager,
    teamId: client.teamId,
    profileCompletion: client.profileCompletion,
    source: client.source || "shared",
  });
}

function mapPayload(payload = {}) {
  const personalInfo = payload.personalInfo || {};
  const contactInfo = payload.contactInfo || {};
  const passport = payload.passport || payload.passportInfo || {};
  const visa = payload.visa || payload.visaSelection || {};
  return cleanPayload({
    user: payload.user || payload.userId,
    client: payload.client || payload.clientId,
    companyId: payload.companyId,
    caseIds: payload.caseIds,
    beneficiaryNumber: payload.beneficiaryNumber,
    clientPortalId: payload.clientPortalId,
    type: payload.type || payload.beneficiaryType,
    status: payload.status,
    firstName: payload.firstName || personalInfo.firstName,
    middleName: payload.middleName || personalInfo.middleName,
    lastName: payload.lastName || personalInfo.lastName,
    fullName: payload.fullName || payload.name,
    email: payload.email || contactInfo.email,
    primaryPhone: payload.primaryPhone || payload.phone || contactInfo.phone,
    whatsappNumber: payload.whatsappNumber || contactInfo.whatsappNumber,
    preferredContact: payload.preferredContact || contactInfo.preferredContact,
    dateOfBirth: payload.dateOfBirth || payload.dob || personalInfo.dateOfBirth,
    gender: payload.gender || personalInfo.gender,
    maritalStatus: payload.maritalStatus || personalInfo.maritalStatus,
    nativeLanguage: payload.nativeLanguage || personalInfo.nativeLanguage,
    countryOfBirth: payload.countryOfBirth || personalInfo.countryOfBirth,
    countryOfCitizenship: payload.countryOfCitizenship || personalInfo.countryOfCitizenship,
    nationality: payload.nationality || personalInfo.nationality,
    address: payload.address || contactInfo.address,
    apartment: payload.apartment || contactInfo.apartment,
    city: payload.city || contactInfo.city,
    state: payload.state || contactInfo.state,
    zipCode: payload.zipCode || contactInfo.zipCode,
    country: payload.country || contactInfo.country,
    addressHistory: payload.addressHistory,
    emergencyContacts: payload.emergencyContacts,
    familyMembers: payload.familyMembers,
    dependents: payload.dependents,
    numberOfDependents: payload.numberOfDependents,
    passport,
    passportNumber: payload.passportNumber || passport.number,
    passportCountry: payload.passportCountry || passport.country,
    passportIssueDate: payload.passportIssueDate || passport.issueDate,
    passportExpirationDate: payload.passportExpirationDate || passport.expirationDate,
    visa,
    visaCategory: payload.visaCategory || visa.category || visa.visaCategory,
    visaType: payload.visaType || visa.type || visa.visaType,
    currentVisaStatus: payload.currentVisaStatus || visa.status,
    visaExpirationDate: payload.visaExpirationDate || visa.expirationDate,
    immigrationStatus: payload.immigrationStatus,
    sevisId: payload.sevisId,
    i94Number: payload.i94Number || payload.i94,
    i94ExpirationDate: payload.i94ExpirationDate,
    alienRegistrationNumber: payload.alienRegistrationNumber || payload.aNumber,
    ssnLast4: payload.ssnLast4,
    ssnEncrypted: payload.ssnEncrypted,
    immigrationInfo: payload.immigrationInfo,
    immigrationHistory: payload.immigrationHistory,
    travelHistory: payload.travelHistory,
    employmentHistory: payload.employmentHistory,
    educationHistory: payload.educationHistory,
    criminalRecord: payload.criminalRecord,
    criminalDetails: payload.criminalDetails,
    visaDenial: payload.visaDenial,
    visaDenialDetails: payload.visaDenialDetails,
    deportation: payload.deportation,
    deportationDetails: payload.deportationDetails,
    priorApplications: payload.priorApplications,
    priorApplicationsDetails: payload.priorApplicationsDetails,
    assignedCaseManager: payload.assignedCaseManager,
    teamId: payload.teamId,
    profileCompletion: payload.profileCompletion,
    source: payload.source,
  });
}

function completionScore(beneficiary) {
  const fields = ["firstName", "lastName", "email", "primaryPhone", "dateOfBirth", "countryOfCitizenship", "visaType", "passportNumber", "address", "city", "country"];
  const complete = fields.filter((field) => Boolean(beneficiary[field])).length;
  return Math.round((complete / fields.length) * 100);
}

function buildBaseFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.visaType) filter.visaType = query.visaType;
  if (query.visaCategory) filter.visaCategory = query.visaCategory;
  if (query.companyId) filter.companyId = query.companyId;
  if (query.teamId) filter.teamId = query.teamId;
  if (query.assignedCaseManager) filter.assignedCaseManager = query.assignedCaseManager;
  if (query.expiringPassportBefore) filter.passportExpirationDate = { $lte: query.expiringPassportBefore };
  if (query.expiringVisaBefore) filter.visaExpirationDate = { $lte: query.expiringVisaBefore };
  if (query.search) {
    const search = { $regex: query.search, $options: "i" };
    filter.$or = [{ fullName: search }, { email: search }, { beneficiaryNumber: search }, { clientPortalId: search }, { visaType: search }, { passportNumber: search }];
  }
  return filter;
}

function applyAccessFilter(filter, user) {
  const role = roleOf(user);
  if (role === "client") return { ...filter, user: user._id };
  if (role === "case_manager") return { ...filter, assignedCaseManager: user._id };
  if (role === "team_lead" && user.teamId) return { ...filter, teamId: user.teamId };
  return filter;
}

function pagination(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

function sortFor(query = {}) {
  const allowed = new Set(["fullName", "email", "status", "visaType", "visaExpirationDate", "passportExpirationDate", "createdAt", "updatedAt", "profileCompletion"]);
  const sortBy = allowed.has(query.sortBy) ? query.sortBy : "updatedAt";
  return { [sortBy]: query.sortOrder === "asc" ? 1 : -1 };
}

function populateBeneficiaryQuery(query) {
  return query.populate([
    { path: "user", select: "name displayName email role status companyId" },
    { path: "client", select: "fullName email status visaType profileCompletion" },
    { path: "companyId", select: "name legalName status" },
    { path: "assignedCaseManager", select: "name displayName email role" },
  ]);
}

function hasQueryValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object" && "$in" in value) return Array.isArray(value.$in) && value.$in.length > 0;
  return value !== undefined && value !== null && value !== "";
}

function buildOrQuery(conditions) {
  const picked = conditions.filter((condition) => Object.values(condition).every(hasQueryValue));
  return picked.length ? { $or: picked } : { _id: null };
}

function canAccessBeneficiary(user, beneficiary) {
  if (!user || !beneficiary) return false;
  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return true;
  if (sameId(beneficiary.user, user._id)) return true;
  if (role === "case_manager" && sameId(beneficiary.assignedCaseManager, user._id)) return true;
  if (role === "team_lead" && user.teamId && sameId(beneficiary.teamId, user.teamId)) return true;
  return STAFF_ROLES.includes(role);
}

function canModifyBeneficiary(user, beneficiary) {
  if (!user || !beneficiary) return false;
  const role = roleOf(user);
  if (WRITE_ROLES.includes(role)) return true;
  if (sameId(beneficiary.user, user._id)) return true;
  if (role === "team_lead" && user.teamId && sameId(beneficiary.teamId, user.teamId)) return true;
  return false;
}

async function syncFromClient(client, user, req) {
  if (!client) return null;
  let beneficiary = await Beneficiary.findOne({ $or: [{ client: client._id }, { user: client.user }].filter((item) => Object.values(item)[0]) });
  const mapped = mapClientToBeneficiary(client);
  if (!beneficiary) {
    beneficiary = await Beneficiary.create(mapped);
    addTimeline(beneficiary, "beneficiary_created", "Beneficiary Created", "Beneficiary profile created from client profile", user);
  } else {
    Object.assign(beneficiary, mapped);
    addTimeline(beneficiary, "beneficiary_synced", "Beneficiary Synced", "Beneficiary profile synchronized from client profile", user);
  }
  beneficiary.profileCompletion = completionScore(beneficiary);
  beneficiary.auditHistory.push({ action: "sync_from_client", changes: mapped, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await beneficiary.save();
  if (!client.beneficiary || !sameId(client.beneficiary, beneficiary._id)) {
    client.beneficiary = beneficiary._id;
    await client.save();
  }
  if (client.companyId) {
    await Company.updateOne({ _id: client.companyId }, { $addToSet: { beneficiaries: beneficiary._id } }).catch(() => {});
  }
  await writeAuditLog("sync_from_client", beneficiary, user, mapped, req);
  return beneficiary;
}

async function getMyBeneficiary(user, req) {
  let beneficiary = await Beneficiary.findOne({ user: user._id });
  if (beneficiary) return beneficiary;
  const client = await Client.findOne({ user: user._id });
  if (client) return syncFromClient(client, user, req);
  beneficiary = await Beneficiary.create({
    user: user._id,
    email: user.email,
    fullName: user.name || user.displayName,
    firstName: user.name || user.displayName,
    companyId: user.companyId,
    source: "shared",
  });
  addTimeline(beneficiary, "beneficiary_created", "Beneficiary Created", "Beneficiary profile initialized", user);
  await beneficiary.save();
  return beneficiary;
}

async function getAccessibleBeneficiaryOrThrow(id, user) {
  const beneficiary = await populateBeneficiaryQuery(Beneficiary.findOne({ $or: [{ _id: id }, { user: id }, { client: id }, { clientPortalId: id }, { beneficiaryNumber: id }] }));
  if (!beneficiary) {
    const error = new Error("Beneficiary not found");
    error.status = 404;
    throw error;
  }
  if (!canAccessBeneficiary(user, beneficiary)) {
    const error = new Error("Not authorized to access this beneficiary");
    error.status = 403;
    throw error;
  }
  return beneficiary;
}

async function listBeneficiaries(query, user) {
  const filter = applyAccessFilter(buildBaseFilter(query), user);
  const { page, limit, skip } = pagination(query);
  const [beneficiaries, total] = await Promise.all([
    populateBeneficiaryQuery(Beneficiary.find(filter).sort(sortFor(query)).skip(skip).limit(limit)),
    Beneficiary.countDocuments(filter),
  ]);
  return { beneficiaries, count: beneficiaries.length, total, pagination: { page, limit, pages: Math.ceil(total / limit) || 1 } };
}

async function createBeneficiary(payload, user, req) {
  const data = payload.data || payload;
  const mapped = mapPayload(data);
  if (mapped.email && !mapped.user) {
    const existingUser = await User.findOne({ email: mapped.email.toLowerCase() });
    if (existingUser) mapped.user = existingUser._id;
  }
  if (mapped.client) {
    const client = await Client.findById(mapped.client);
    if (client) Object.assign(mapped, cleanPayload({ user: mapped.user || client.user, companyId: mapped.companyId || client.companyId, clientPortalId: mapped.clientPortalId || client.clientPortalId }));
  }
  const beneficiary = await Beneficiary.create(mapped);
  beneficiary.profileCompletion = completionScore(beneficiary);
  addTimeline(beneficiary, "beneficiary_created", "Beneficiary Created", "Beneficiary profile created", user);
  beneficiary.auditHistory.push({ action: "create", changes: mapped, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await beneficiary.save();
  if (beneficiary.client) await Client.updateOne({ _id: beneficiary.client }, { beneficiary: beneficiary._id, companyId: beneficiary.companyId }).catch(() => {});
  if (beneficiary.companyId) await Company.updateOne({ _id: beneficiary.companyId }, { $addToSet: { beneficiaries: beneficiary._id } }).catch(() => {});
  await writeAuditLog("create", beneficiary, user, mapped, req);
  return beneficiary;
}

async function updateBeneficiary(id, payload, user, req) {
  const beneficiary = await getAccessibleBeneficiaryOrThrow(id, user);
  if (!canModifyBeneficiary(user, beneficiary)) {
    const error = new Error("Not authorized to modify this beneficiary");
    error.status = 403;
    throw error;
  }
  const mapped = mapPayload(payload.data || payload);
  Object.assign(beneficiary, mapped);
  beneficiary.profileCompletion = completionScore(beneficiary);
  addTimeline(beneficiary, "beneficiary_updated", "Beneficiary Updated", "Beneficiary profile updated", user);
  beneficiary.auditHistory.push({ action: "update", changes: mapped, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await beneficiary.save();
  if (beneficiary.client) await Client.updateOne({ _id: beneficiary.client }, { beneficiary: beneficiary._id, companyId: beneficiary.companyId }).catch(() => {});
  if (beneficiary.companyId) await Company.updateOne({ _id: beneficiary.companyId }, { $addToSet: { beneficiaries: beneficiary._id } }).catch(() => {});
  await writeAuditLog("update", beneficiary, user, mapped, req);
  return beneficiary;
}

async function addNote(id, payload, user, req) {
  const beneficiary = await updateBeneficiary(id, {}, user, req);
  beneficiary.notes.push({ note: payload.note, isInternal: payload.isInternal !== false, author: user._id });
  addTimeline(beneficiary, "note", "Beneficiary Note Added", payload.note, user);
  await beneficiary.save();
  return beneficiary;
}

async function getRelated(id, user) {
  const beneficiary = await getAccessibleBeneficiaryOrThrow(id, user);
  const caseFilter = buildOrQuery([
    { beneficiary: beneficiary._id },
    { clientProfile: beneficiary.client },
    { user: beneficiary.user },
    { clientPortalId: beneficiary.clientPortalId },
  ]);
  const cases = await Case.find(caseFilter).sort({ updatedAt: -1 });
  const caseIds = [...new Set([...(beneficiary.caseIds || []), ...cases.map((item) => item._id)].map((item) => item.toString()))];
  const [documents, messages, notifications, appointments, payments, questionnaires, tasks, workflows] = await Promise.all([
    Document.find(buildOrQuery([{ user: beneficiary.user }, { caseId: { $in: caseIds } }, { beneficiary: beneficiary._id }])).sort({ updatedAt: -1 }),
    Message.find(buildOrQuery([{ caseId: { $in: caseIds } }, { senderId: beneficiary.user }, { receiverId: beneficiary.user }, { beneficiary: beneficiary._id }])).sort({ createdAt: -1 }).limit(50),
    Notification.find(buildOrQuery([{ user: beneficiary.user }, { userId: beneficiary.user }, { caseId: { $in: caseIds } }, { beneficiary: beneficiary._id }])).sort({ createdAt: -1 }).limit(50),
    Appointment.find(buildOrQuery([{ clientId: beneficiary.user }, { linkedUser: beneficiary.user }, { caseId: { $in: caseIds } }, { beneficiary: beneficiary._id }])).sort({ startAt: -1 }),
    Payment.find(buildOrQuery([{ user: beneficiary.user }, { case: { $in: caseIds } }, { caseId: { $in: caseIds } }, { beneficiary: beneficiary._id }])).sort({ updatedAt: -1 }),
    Answer.find(buildOrQuery([{ user: beneficiary.user }, { clientId: beneficiary.user }, { caseId: { $in: caseIds } }, { beneficiary: beneficiary._id }])).sort({ updatedAt: -1 }).limit(100),
    Task.find(buildOrQuery([{ clientId: beneficiary.user }, { caseId: { $in: caseIds } }, { beneficiary: beneficiary._id }])).sort({ dueDate: 1 }),
    Workflow.find(buildOrQuery([{ "context.beneficiaryId": beneficiary._id }, { "context.caseId": { $in: caseIds } }])).sort({ updatedAt: -1 }),
  ]);
  return { beneficiary, cases, documents, messages, notifications, appointments, payments, questionnaires, tasks, workflows };
}

async function getDashboard(user, req) {
  const role = roleOf(user);
  if (role === "client") {
    const beneficiary = await getMyBeneficiary(user, req);
    const related = await getRelated(beneficiary._id, user);
    return {
      beneficiary,
      stats: {
        cases: related.cases.length,
        documents: related.documents.length,
        messages: related.messages.length,
        unreadNotifications: related.notifications.filter((item) => !item.read && !item.isRead).length,
        appointments: related.appointments.length,
        payments: related.payments.length,
        profileCompletion: beneficiary.profileCompletion,
      },
      recentActivity: beneficiary.activityHistory.slice(-20).reverse(),
    };
  }
  const filter = applyAccessFilter({}, user);
  const [total, active, passportExpiring, visaExpiring] = await Promise.all([
    Beneficiary.countDocuments(filter),
    Beneficiary.countDocuments({ ...filter, status: "active" }),
    Beneficiary.countDocuments({ ...filter, passportExpirationDate: { $lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }, status: { $ne: "archived" } }),
    Beneficiary.countDocuments({ ...filter, visaExpirationDate: { $lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }, status: { $ne: "archived" } }),
  ]);
  return { stats: { total, active, passportExpiring, visaExpiring } };
}

module.exports = {
  addNote,
  canAccessBeneficiary,
  canModifyBeneficiary,
  createBeneficiary,
  getAccessibleBeneficiaryOrThrow,
  getDashboard,
  getMyBeneficiary,
  getRelated,
  listBeneficiaries,
  mapClientToBeneficiary,
  syncFromClient,
  updateBeneficiary,
};
