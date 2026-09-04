const AuditLog = require("../../models/AuditLog");
const Appointment = require("../../models/Appointment");
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
const realtimeGateway = require("../realtime/realtime.gateway");
const CaseHistoryArchive = require("../../models/CaseHistoryArchive");
const mongoose = require("mongoose");
const { dashboardCacheBump } = require("../../config/redis");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { CASE_LIFECYCLE_STAGES, CRM_STAGE_TO_INDEX, STAGE_NAMES } = require("./case.constants");
const { openRfeDeadlineFilter } = require("./case-manager-analytics.service");
const participantService = require("./case-participant.service");

const ADMIN_ROLES = ["super_admin", "admin"];
const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const RESTRICTED_PORTAL_ROLES = ["employee", "beneficiary"];
const ASSIGNMENT_FIELD_BY_ROLE = {
  primary_owner: "primaryOwner",
  secondary_owner: "secondaryOwner",
  team_lead: "assignedTeamLead",
  case_manager: "assignedCaseManager",
  agent: "assignedAgentUser",
};
const SORTABLE_CASE_FIELDS = new Set(["_id", "createdAt", "updatedAt", "caseNumber", "clientName", "visaType", "status", "stage", "priority", "filingDeadline", "rfeDeadline"]);
const CASE_LIST_POPULATE = [
  { path: "user", select: "email displayName name role" },
  { path: "clientProfile", select: "fullName email phone status user companyId" },
  { path: "beneficiary", select: "fullName email visaType status companyId user" },
  { path: "petitioner", select: "name displayName fullName email legalName role" },
  { path: "employer", select: "name legalName status" },
  { path: "organization", select: "name legalName status" },
  { path: "companyId", select: "name legalName status" },
  { path: "assignedCaseManager", select: "name displayName email department phone role" },
  { path: "primaryOwner", select: "name displayName email department phone role" },
  { path: "secondaryOwner", select: "name displayName email department phone role" },
  { path: "assignedTeamLead", select: "name displayName email department phone role" },
  { path: "createdBy", select: "name displayName email role" },
];

function isAdmin(user) {
  return user && ADMIN_ROLES.includes(normalizeRole(user.role));
}

function isStaff(user) {
  return user && STAFF_ROLES.includes(normalizeRole(user.role));
}

function sameId(left, right) {
  const leftId = left?._id || left;
  const rightId = right?._id || right;
  return leftId && rightId && leftId.toString() === rightId.toString();
}

function userCaseIdSet(user) {
  return new Set([...(user?.caseIds || []), user?.primaryCaseId].filter(Boolean).map(String));
}

function isRestrictedPortalRole(role) {
  return RESTRICTED_PORTAL_ROLES.includes(normalizeRole(role));
}

function canAccessRestrictedChildCase(user, caseData, role = normalizeRole(user?.role)) {
  if (!user || !caseData || !isRestrictedPortalRole(role)) return false;
  if (normalizeRole(caseData.caseRole) !== role) return false;

  const ids = userCaseIdSet(user);
  const ownsCase = ids.has(String(caseData._id)) || sameId(caseData.user, user._id);
  if (!ownsCase) return false;

  if (user.principalCaseId) {
    const parentId = caseData.parentCase?._id || caseData.parentCase || caseData.principalCaseId;
    if (parentId && !sameId(parentId, user.principalCaseId)) return false;
  }
  return true;
}

function buildRestrictedCaseOwnershipFilter(user, role = normalizeRole(user?.role)) {
  const ids = [...userCaseIdSet(user)].map(castObjectId);
  if (!ids.length) return { _id: null };
  return {
    _id: { $in: ids },
    caseRole: role,
    ...(user.principalCaseId ? { parentCase: castObjectId(user.principalCaseId) } : {}),
  };
}

function castObjectId(value) {
  if (!value || value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) return new mongoose.Types.ObjectId(value);
  return value;
}

function canAccessCase(user, caseData) {
  if (!user || !caseData) return false;
  const role = normalizeRole(user.role);
  if (isRestrictedPortalRole(role)) return canAccessRestrictedChildCase(user, caseData, role);
  if (isAdmin(user)) return true;
  if (sameId(caseData.user, user._id)) return true;
  if (sameId(caseData.employeeUser, user._id)) return true;
  if (sameId(caseData.employerUser, user._id)) return true;
  if (participantService.canAccessAnyParticipant(user, caseData)) return true;
  if (sameId(caseData.clientProfile, user._id)) return true;
  if (sameId(caseData.clientProfile?.user, user._id)) return true;
  if (sameId(caseData.beneficiary?.user, user._id)) return true;
  if (sameId(caseData.primaryOwner, user._id) || sameId(caseData.secondaryOwner, user._id)) return true;
  if (sameId(caseData.assignedTeamLead, user._id)) return true;
  if (role === "case_manager") return sameId(caseData.assignedCaseManager, user._id) || sameId(caseData.primaryOwner, user._id);
  if (role === "team_lead" && user.teamId) return sameId(caseData.teamId, user.teamId);
  if (role === "employer") return sameId(caseData.employerUser, user._id) || sameId(caseData.companyId, user.companyId) || sameId(caseData.employer, user.companyId) || sameId(caseData.organization, user.companyId);
  if (role === "employee") return sameId(caseData.employeeUser, user._id) || sameId(caseData.user, user._id) || sameId(caseData.beneficiary?.user, user._id);
  // Family/sponsor visa (K-1/K-3) two-party path — additive, mirrors the
  // employer/employee checks immediately above under separate field names;
  // employerUser/employeeUser are never read here.
  if (sameId(caseData.petitionerUser, user._id)) return true;
  if (role === "beneficiary") return sameId(caseData.beneficiaryUser, user._id) || sameId(caseData.user, user._id) || caseData.beneficiaryInvite?.email === user.email;
  return false;
}

function applyCaseRoleFilter(filter, user) {
  const role = normalizeRole(user.role);
  if (isAdmin(user)) return filter;
  if (role === "case_manager") filter.$and = [...(filter.$and || []), { $or: [{ assignedCaseManager: user._id }, { primaryOwner: user._id }, { secondaryOwner: user._id }] }];
  else if (role === "team_lead") filter.$and = [...(filter.$and || []), { $or: [{ assignedTeamLead: user._id }, { primaryOwner: user._id }, ...(user.teamId ? [{ teamId: user.teamId }] : [])] }];
  else if (role === "employer") filter.$and = [...(filter.$and || []), { $or: [{ employerUser: user._id }, { "participants.userId": user._id }, { "participants.email": user.email }, ...(user.companyId ? [{ companyId: user.companyId }, { employer: user.companyId }, { organization: user.companyId }, { "participants.companyId": user.companyId }] : [])] }];
  else if (role === "employee") filter.$and = [...(filter.$and || []), buildRestrictedCaseOwnershipFilter(user, role)];
  // Family/sponsor visa (K-1/K-3) two-party path — additive, mirrors the
  // employer/employee branches immediately above under separate field names.
  else if (role === "beneficiary") filter.$and = [...(filter.$and || []), buildRestrictedCaseOwnershipFilter(user, role)];
  else {
    filter.$and = [...(filter.$and || []), { $or: [{ user: user._id }, { clientProfile: user._id }, { petitionerUser: user._id }] }];
  }
  return filter;
}

function buildCaseFilterFields(query) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.visaType) filter.visaType = { $regex: query.visaType, $options: "i" };
  if (query.visaCategory) filter.visaCategory = query.visaCategory;
  if (query.stage) filter.stage = query.stage;
  if (query.priority) filter.priority = query.priority;
  if (query.package) filter.package = query.package;
  if (query.assignedCaseManager) filter.assignedCaseManager = castObjectId(query.assignedCaseManager);
  if (query.companyId) filter.companyId = castObjectId(query.companyId);
  if (query.beneficiary) filter.beneficiary = castObjectId(query.beneficiary);
  if (query.beneficiaryId) filter.beneficiary = castObjectId(query.beneficiaryId);
  if (query.clientProfile) filter.clientProfile = castObjectId(query.clientProfile);
  if (query.clientId) filter.clientProfile = castObjectId(query.clientId);
  if (query.parentCase) filter.parentCase = castObjectId(query.parentCase);
  if (query.parentCaseId) filter.parentCase = castObjectId(query.parentCaseId);
  // Phase 7 addition — lets a queue/list request exclude child cases (e.g.
  // caseRole=principal,single) so employee/beneficiary children never surface
  // as independent items in a Team Lead's pending-assignment queue.
  if (query.caseRole) {
    const roles = String(query.caseRole).split(",").map((r) => r.trim()).filter(Boolean);
    if (roles.length) filter.caseRole = roles.length > 1 ? { $in: roles } : roles[0];
  }
  if (query.caseStructure) filter.caseStructure = query.caseStructure;
  if (query.caseType) filter.caseType = query.caseType;
  if (query.petitionType) filter.petitionType = query.petitionType;
  if (query.uscisReceiptNumber) filter.uscisReceiptNumber = { $regex: query.uscisReceiptNumber, $options: "i" };
  if (query.teamId) filter.teamId = castObjectId(query.teamId);
  if (query.paymentStatus) filter["plan.paymentStatus"] = query.paymentStatus;
  // Deep-link-only flags from the case manager analytics panel (see
  // case-manager-analytics.service.js) - not exposed as UI dropdowns, just
  // targets for the panel's "Overdue RFE" / "Needs attention" cards.
  if (query.rfeOverdue) filter.$and = [...(filter.$and || []), openRfeDeadlineFilter({ dueSoonOnly: true })];
  if (query.attention) {
    filter.$and = [...(filter.$and || []), {
      $or: [
        { status: "on_hold" },
        { stage: "rfe" },
        { "plan.paymentStatus": { $in: ["not_started", "pending", "failed"] } },
      ],
    }];
  }
  return filter;
}

function buildCaseSearchOr(search) {
  return { $or: [
    { clientName: { $regex: search, $options: "i" } },
    { clientEmail: { $regex: search, $options: "i" } },
    { caseId: { $regex: search, $options: "i" } },
    { caseNumber: { $regex: search, $options: "i" } },
    { uscisReceiptNumber: { $regex: search, $options: "i" } },
    { petitionType: { $regex: search, $options: "i" } },
  ] };
}

function buildCaseFilter(query, user) {
  const filter = buildCaseFilterFields(query);
  if (query.search) {
    filter.$and = [...(filter.$and || []), buildCaseSearchOr(query.search)];
  }
  return applyCaseRoleFilter(filter, user);
}

// Fast path for the "search" box: try the indexed $text search first — far
// cheaper than the unanchored regex scan below on a large collection — and
// only fall back to the exact regex behavior (buildCaseFilter) if $text
// finds nothing, so today's partial/substring search habits keep working
// exactly as before, just usually via the faster path.
async function resolveCaseSearchFilter(query, user) {
  if (!query.search) return buildCaseFilter(query, user);
  const baseFields = buildCaseFilterFields({ ...query, search: undefined });
  const textFilter = applyCaseRoleFilter({ ...baseFields, $text: { $search: query.search } }, user);
  try {
    const hasTextHit = await Case.exists(textFilter);
    if (hasTextHit) return textFilter;
  } catch (error) {
    const message = String(error?.message || "");
    const codeName = String(error?.codeName || "");
    const noTextIndex = codeName === "IndexNotFound" || /text index required|no text index/i.test(message);
    if (!noTextIndex) throw error;
  }
  return buildCaseFilter(query, user);
}

function buildCaseSort(query = {}) {
  const sortBy = SORTABLE_CASE_FIELDS.has(query.sortBy) ? query.sortBy : "_id";
  const direction = String(query.sortOrder || query.order || "desc").toLowerCase() === "asc" ? 1 : -1;
  return sortBy === "_id" ? { _id: direction } : { [sortBy]: direction, _id: direction };
}

// Bounds Case's embedded history arrays so a long-lived case's document
// doesn't grow forever. Entries pushed out by the cap aren't discarded —
// they're moved into CaseHistoryArchive first (fire-and-forget, same
// best-effort pattern as the audit log write below), keyed by case+field so
// they can still be looked up later if ever needed.
const CASE_HISTORY_CAP = 250;

function capArrayWithArchive(caseData, fieldName) {
  const arr = caseData[fieldName];
  if (!Array.isArray(arr) || arr.length <= CASE_HISTORY_CAP) return;
  const overflow = arr.splice(0, arr.length - CASE_HISTORY_CAP);
  CaseHistoryArchive.create({
    entityType: "case",
    entityId: caseData._id,
    fieldName,
    entries: overflow,
  }).catch((error) => console.error(`Failed to archive Case.${fieldName} overflow for ${caseData._id}:`, error.message));
}

function addActivity(caseData, action, description, user) {
  if (!Array.isArray(caseData.activityLog)) caseData.activityLog = [];
  caseData.activityLog.push({ action, description, performedBy: user?._id, timestamp: new Date() });
  capArrayWithArchive(caseData, "activityLog");
}

function addTimelineEvent(caseData, type, title, description, user, metadata = {}) {
  if (!Array.isArray(caseData.timeline)) caseData.timeline = [];
  caseData.timeline.push({ type, title, description, metadata, createdBy: user?._id, createdAt: new Date() });
  capArrayWithArchive(caseData, "timeline");
}

function addAuditEntry(caseData, action, description, user, changes = {}, req) {
  const performedAt = new Date();
  if (!Array.isArray(caseData.auditHistory)) caseData.auditHistory = [];
  caseData.auditHistory.push({
    action,
    description,
    changes,
    performedBy: user?._id,
    performedAt,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
  capArrayWithArchive(caseData, "auditHistory");
  ["super_admin", "admin", "team_lead"].forEach((role) => {
    realtimeGateway.emitToRole(role, "case:activity", {
      caseId: caseData._id,
      caseNumber: caseData.caseNumber,
      clientName: caseData.clientName,
      action,
      description,
      performedBy: { _id: user?._id, name: user?.name || user?.displayName || "System" },
      performedAt,
    });
  });
  // Every case mutation goes through here — bump the shared dashboard cache
  // generation so stale aggregates never outlive a real change (fire-and-
  // forget, same as the realtime emits above; a no-op without Redis).
  dashboardCacheBump().catch(() => {});
}

function summarizeCase(caseData) {
  const data = caseData?.toObject ? caseData.toObject({ virtuals: true }) : caseData;
  if (!data) return null;
  const checklist = [...(data.documentChecklist || []), ...(data.checklistItems || [])];
  const uniqueChecklist = new Map();
  checklist.forEach((item) => {
    const key = item.documentType || item.name || item._id?.toString?.();
    if (key && !uniqueChecklist.has(key)) uniqueChecklist.set(key, item);
  });
  const requiredItems = [...uniqueChecklist.values()].filter((item) => item.required !== false);
  const missingDocuments = requiredItems.filter((item) => !["submitted", "uploaded", "approved", "accepted", "complete", "completed"].includes(String(item.status || "").toLowerCase()));
  const openTasks = (data.taskReferences || []).length || (data.journeyProgress?.metrics?.tasks?.open || 0);
  const activeStage = CASE_LIFECYCLE_STAGES.find((stage) => stage.key === data.stage);
  return {
    _id: data._id,
    caseId: data.caseId,
    caseNumber: data.caseNumber,
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    visaType: data.visaType,
    visaCategory: data.visaCategory,
    status: data.status,
    stage: data.stage,
    stageLabel: activeStage?.label || data.stage,
    priority: data.priority,
    creator: data.createdBy ? {
      _id: data.createdBy?._id || data.createdBy,
      name: data.createdBy?.name || data.createdBy?.displayName || data.createdBy?.email,
      role: data.createdBy?.role,
    } : null,
    assignedUsers: {
      primaryOwner: data.primaryOwner,
      secondaryOwner: data.secondaryOwner,
      teamLead: data.assignedTeamLead,
      caseManager: data.assignedCaseManager,
    },
    linkedEntities: {
      client: data.clientProfile,
      beneficiary: data.beneficiary,
      petitioner: data.petitioner,
      employer: data.employer || data.companyId,
      organization: data.organization || data.companyId,
      company: data.companyId,
      parentCase: data.parentCase,
      childCases: data.childCases || [],
    },
    assignedForms: (data.uscisFormReferences || []).map((reference) => ({
      id: reference.refId,
      model: reference.refModel,
      formCode: reference.label,
      status: reference.status,
      version: reference.version,
      editionDate: reference.editionDate,
    })),
    completionPercentage: data.journeyProgress?.percent ?? data.filingReadinessScore ?? 0,
    missingInformation: {
      documents: missingDocuments.map((item) => ({ name: item.name, documentType: item.documentType, status: item.status })),
      canonicalMissingFields: data.canonicalProfile?.missingFields || [],
      canonicalConflicts: (data.canonicalProfile?.conflicts || []).filter((conflict) => !conflict.resolved),
    },
    outstandingActions: {
      nextAction: data.journeyProgress?.nextAction || null,
      openTasks,
      missingDocuments: missingDocuments.length,
      pendingPayments: data.plan?.paymentStatus && !["paid", "refunded"].includes(data.plan.paymentStatus) ? 1 : 0,
    },
    recentActivity: (data.timeline || []).slice(-5).reverse(),
    updatedAt: data.updatedAt,
    createdAt: data.createdAt,
  };
}

function serializeCaseForUser(caseData, user) {
  const data = caseData?.toObject ? caseData.toObject({ virtuals: true }) : { ...(caseData || {}) };
  const role = normalizeRole(user?.role);
  if (["client", "user", ...RESTRICTED_PORTAL_ROLES].includes(role)) {
    delete data.internalNotes;
    delete data.auditHistory;
    delete data.notes;
    if (data.knowledgePlan) {
      delete data.knowledgePlan.configurationIssues;
      delete data.knowledgePlan.ruleSources;
    }
  }
  if (isRestrictedPortalRole(role)) {
    [
      "addons",
      "assignedAgentUser",
      "assignedCaseManager",
      "assignedTeamLead",
      "assignmentHistory",
      "childCases",
      "companyId",
      "employer",
      "employerUser",
      "linkedCases",
      "organization",
      "parentCase",
      "paymentReferences",
      "petitioner",
      "petitionerUser",
      "plan",
      "primaryOwner",
      "secondaryOwner",
      "taskReferences",
      "teamId",
      "workflowReferences",
    ].forEach((field) => delete data[field]);
    if (Array.isArray(data.timeline)) {
      data.timeline = data.timeline
        .filter((event) => !["assignment", "payment", "addon", "internal_note"].includes(String(event.type || "")))
        .map((event) => ({ type: event.type, title: event.title, description: event.description, createdAt: event.createdAt }));
    }
    if (Array.isArray(data.activityLog)) delete data.activityLog;
  }
  return data;
}

async function writeAuditLog(action, caseData, user, changes, req) {
  if (!user || !caseData) return;
  await AuditLog.create({
    userId: user._id,
    action,
    entityType: "case",
    entityId: caseData._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} on case ${caseData.caseNumber || caseData.caseId}`,
  }).catch(() => {});
}

function setStage(caseData, stageInput, user, note) {
  const previousStage = caseData.stage;
  const previousStageIndex = caseData.currentStage;
  const nextStageIndex = typeof stageInput === "number" ? stageInput : CRM_STAGE_TO_INDEX[stageInput];
  const nextCrmStage = typeof stageInput === "string" ? stageInput : caseData.stage;
  const stageIndex = nextStageIndex ?? caseData.currentStage;
  const stageName = STAGE_NAMES[stageIndex] || `Stage ${stageIndex}`;

  caseData.currentStage = stageIndex;
  caseData.stage = nextCrmStage || caseData.stage;
  if (!caseData.workflow) caseData.workflow = {};
  caseData.workflow.stage = caseData.stage;
  caseData.workflow.lastTransitionAt = new Date();
  caseData.workflow.lastTransitionBy = user?._id;
  if (!Array.isArray(caseData.stageHistory)) caseData.stageHistory = [];
  caseData.stageHistory.push({
    stage: stageIndex,
    stageName,
    crmStage: caseData.stage,
    enteredAt: new Date(),
    updatedBy: user?._id,
    notes: note || `Moved to ${stageName}`,
  });
  capArrayWithArchive(caseData, "stageHistory");
  addTimelineEvent(caseData, "stage", "Stage Updated", `Case moved to ${stageName}`, user, { previousStage, previousStageIndex, stage: stageIndex, crmStage: caseData.stage });
  addAuditEntry(caseData, "update_stage", "Case stage updated", user, { previousStage, previousStageIndex, nextStage: caseData.stage, nextStageIndex: stageIndex });
  addActivity(caseData, "Stage Updated", `Case advanced to ${stageName}`, user);
}

function assignUser(caseData, assignmentRole, assignedTo, assignedBy, notes) {
  const field = ASSIGNMENT_FIELD_BY_ROLE[assignmentRole];
  if (!field) return;
  const previousAssignedTo = caseData[field];
  caseData[field] = assignedTo;
  if (assignmentRole === "case_manager" || assignmentRole === "primary_owner") {
    caseData.primaryOwner = assignedTo;
    caseData.assignedCaseManager = assignedTo;
    caseData.status = caseData.status === "pending_assignment" ? "assigned" : caseData.status;
    if (caseData.workflow) caseData.workflow.status = caseData.status;
  }
  if (assignmentRole === "team_lead") caseData.assignedTeamLead = assignedTo;
  caseData.assignmentHistory.push({
    assignedTo,
    previousAssignedTo,
    assignedBy: assignedBy?._id,
    role: assignmentRole,
    notes,
    changeType: previousAssignedTo ? "reassigned" : "assigned",
  });
  addTimelineEvent(caseData, "assignment", "Assignment Updated", `${assignmentRole} assigned`, assignedBy, { role: assignmentRole, previousAssignedTo, assignedTo });
  addAuditEntry(caseData, `assign_${assignmentRole}`, `${assignmentRole} assigned`, assignedBy, { previousAssignedTo, assignedTo });
}

function populateCaseQuery(query) {
  return query.populate([
    { path: "user", select: "email displayName name role" },
    { path: "clientProfile" },
    { path: "beneficiary", select: "fullName email visaType status companyId user passportNumber visaExpirationDate passportExpirationDate" },
    { path: "petitioner", select: "name displayName fullName email legalName role" },
    { path: "employer", select: "name legalName status" },
    { path: "organization", select: "name legalName status" },
    { path: "companyId", select: "name legalName status" },
    { path: "parentCase", select: "caseNumber clientName visaType status stage" },
    { path: "childCases", select: "caseNumber clientName visaType status stage" },
    { path: "linkedCases.case", select: "caseNumber clientName visaType status stage" },
    { path: "assignedCaseManager", select: "name displayName email department phone role" },
    { path: "primaryOwner", select: "name displayName email department phone role" },
    { path: "secondaryOwner", select: "name displayName email department phone role" },
    { path: "assignedTeamLead", select: "name displayName email department phone role" },
    { path: "createdBy", select: "name displayName email role" },
    { path: "internalNotes.author", select: "name displayName role" },
    { path: "timeline.createdBy", select: "name displayName role" },
  ]);
}

// Slimmed variant of populateCaseQuery for client-portal-role requests
// (GET /cases/my). Omits every populate path that serializeCaseForUser
// deletes for restricted portal roles (petitioner, employer, organization,
// companyId, parentCase, childCases, linkedCases.case, assignedCaseManager,
// primaryOwner, secondaryOwner, assignedTeamLead, internalNotes.author) -
// those fields are populated then thrown away for this role today. Keeps
// only what the client portal actually reads: user, clientProfile,
// beneficiary, createdBy, timeline.createdBy. Staff-facing call sites must
// keep using populateCaseQuery unchanged.
function populateCaseQueryForClient(query) {
  return query.populate([
    { path: "user", select: "email displayName name role" },
    { path: "clientProfile" },
    { path: "beneficiary", select: "fullName email visaType status companyId user passportNumber visaExpirationDate passportExpirationDate" },
    { path: "createdBy", select: "name displayName email role" },
    { path: "timeline.createdBy", select: "name displayName role" },
  ]);
}

function populateCaseListQuery(query) {
  return query.populate(CASE_LIST_POPULATE);
}

function populateCaseListDocs(docs) {
  return Case.populate(docs, CASE_LIST_POPULATE);
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

async function getAccessibleCaseOrThrow(id, user) {
  const caseData = await populateCaseQuery(Case.findOne({ $or: [{ _id: id }, { caseId: id }, { caseNumber: id }, { clientPortalId: id }] }));
  if (!caseData) {
    const error = new Error("Case not found");
    error.statusCode = 404;
    throw error;
  }
  if (!canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to access this case");
    error.statusCode = 403;
    throw error;
  }
  return caseData;
}

async function hydrateCaseRelationships(caseData, user, req) {
  if (!caseData) return caseData;
  if (caseData.beneficiary && !caseData.clientProfile) {
    const beneficiary = await Beneficiary.findById(caseData.beneficiary);
    if (beneficiary) {
      caseData.user = caseData.user || beneficiary.user;
      caseData.clientProfile = caseData.clientProfile || beneficiary.client;
      caseData.companyId = caseData.companyId || beneficiary.companyId;
      caseData.clientName = caseData.clientName || beneficiary.fullName;
      caseData.clientEmail = caseData.clientEmail || beneficiary.email;
      caseData.visaCategory = caseData.visaCategory || beneficiary.visaCategory;
      caseData.visaType = caseData.visaType || beneficiary.visaType;
    }
  }
  if (caseData.clientProfile && !caseData.beneficiary) {
    const client = await Client.findById(caseData.clientProfile);
    if (client) {
      caseData.user = caseData.user || client.user;
      caseData.companyId = caseData.companyId || client.companyId;
      caseData.clientName = caseData.clientName || client.fullName;
      caseData.clientEmail = caseData.clientEmail || client.email;
      caseData.visaCategory = caseData.visaCategory || client.visaCategory;
      caseData.visaType = caseData.visaType || client.visaType;
      if (client.beneficiary) caseData.beneficiary = client.beneficiary;
    }
  }
  await Promise.all([
    caseData.parentCase
      ? Case.updateOne({ _id: caseData.parentCase }, { $addToSet: { childCases: caseData._id } }).catch(() => {})
      : null,
    caseData.beneficiary
      ? Beneficiary.updateOne({ _id: caseData.beneficiary }, { $addToSet: { caseIds: caseData._id } }).catch(() => {})
      : null,
    caseData.companyId && caseData.beneficiary
      ? Company.updateOne({ _id: caseData.companyId }, { $addToSet: { beneficiaries: caseData.beneficiary } }).catch(() => {})
      : null,
  ]);
  addAuditEntry(caseData, "sync_relationships", "Case relationships synchronized", user, {}, req);
  return caseData;
}

async function getRelatedRecords(caseData) {
  const caseId = caseData._id;
  const [documents, messages, notifications, appointments, payments, tasks, workflows, parentCase, childCases] = await Promise.all([
    Document.find(buildOrQuery([{ caseId }, { clientPortalId: caseData.clientPortalId }])).sort({ updatedAt: -1 }),
    Message.find(buildOrQuery([{ caseId }, { clientPortalId: caseData.clientPortalId }])).sort({ createdAt: -1 }).limit(100),
    Notification.find(buildOrQuery([{ caseId }, { case: caseId }, { user: caseData.user }])).sort({ createdAt: -1 }).limit(100),
    Appointment.find(buildOrQuery([{ caseId }, { linkedUser: caseData.user }, { clientId: caseData.user }])).sort({ startAt: -1 }),
    Payment.find(buildOrQuery([{ caseId }, { case: caseId }, { user: caseData.user }])).sort({ updatedAt: -1 }),
    Task.find({ caseId }).sort({ dueDate: 1 }),
    Workflow.find(buildOrQuery([{ caseId }, { entityId: caseId }, { "context.caseId": caseId }])).sort({ updatedAt: -1 }),
    caseData.parentCase ? Case.findById(caseData.parentCase).select("caseNumber clientName visaType status stage") : null,
    // Phase 7 — also select assignment fields so the child-case list UI can
    // show who's assigned and whether that assignment was individually
    // overridden (and would therefore be skipped by a future cascade).
    // Phase 9 — also select clientEmail/dataEntryMode so the invite panel
    // can tell "not yet invited" from "invited" (clientEmail is set by
    // inviteEmployee) without a second round-trip.
    Case.find({ parentCase: caseId })
      .select("caseNumber clientName clientEmail visaType status stage caseRole childIndex dataEntryMode assignedCaseManager assignmentOverridden")
      .populate("assignedCaseManager", "name displayName email")
      .sort({ childIndex: 1, createdAt: 1 }),
  ]);
  return { documents, messages, notifications, appointments, payments, tasks, workflows, parentCase, childCases };
}

async function linkCases(caseData, linkedCaseId, relationship, user, notes, req) {
  const linkedCase = await Case.findById(linkedCaseId);
  if (!linkedCase) {
    const error = new Error("Linked case not found");
    error.statusCode = 404;
    throw error;
  }
  caseData.linkedCases.addToSet({ case: linkedCase._id, relationship: relationship || "related", notes, linkedBy: user?._id });
  if (relationship === "parent") {
    caseData.parentCase = linkedCase._id;
    linkedCase.childCases.addToSet(caseData._id);
  }
  if (relationship === "child") {
    caseData.childCases.addToSet(linkedCase._id);
    linkedCase.parentCase = caseData._id;
  }
  addTimelineEvent(caseData, "linked_case", "Case Linked", `Linked ${linkedCase.caseNumber || linkedCase.caseId}`, user, { linkedCase: linkedCase._id, relationship });
  addAuditEntry(caseData, "link_case", "Linked case added", user, { linkedCase: linkedCase._id, relationship, notes }, req);
  await linkedCase.save();
  await caseData.save();
  await writeAuditLog("link_case", caseData, user, { linkedCase: linkedCase._id, relationship, notes }, req);
  return caseData;
}

async function archiveCase(caseData, user, req) {
  caseData.previousStatus = caseData.status;
  caseData.status = "archived";
  caseData.workflow.status = "archived";
  caseData.archivedAt = new Date();
  caseData.archivedBy = user?._id;
  addTimelineEvent(caseData, "archive", "Case Archived", "Case archived", user);
  addAuditEntry(caseData, "archive", "Case archived", user, {}, req);
  await caseData.save();
  await writeAuditLog("archive", caseData, user, {}, req);
  return caseData;
}

async function reopenCase(caseData, user, req) {
  caseData.status = caseData.previousStatus && caseData.previousStatus !== "archived" ? caseData.previousStatus : "active";
  caseData.workflow.status = caseData.status;
  caseData.reopenedAt = new Date();
  caseData.reopenedBy = user?._id;
  addTimelineEvent(caseData, "reopen", "Case Reopened", "Case reopened", user);
  addAuditEntry(caseData, "reopen", "Case reopened", user, {}, req);
  await caseData.save();
  await writeAuditLog("reopen", caseData, user, {}, req);
  return caseData;
}

async function bulkUpdateCases(ids, action, payload, user, req) {
  const cases = await Case.find({ _id: { $in: ids || [] } });
  // Each case is independent (own document, own audit trail) — process
  // concurrently instead of one at a time. Per-case logic/order unchanged.
  const results = await Promise.all(cases.map(async (caseData) => {
    if (!canAccessCase(user, caseData)) {
      return { id: caseData._id, success: false, message: "Not authorized" };
    }
    if (action === "archive") await archiveCase(caseData, user, req);
    else if (action === "reopen") await reopenCase(caseData, user, req);
    else if (action === "assign_case_manager" && payload.caseManagerId) assignUser(caseData, "case_manager", payload.caseManagerId, user, payload.notes);
    else if (action === "update_status" && payload.status) {
      caseData.previousStatus = caseData.status;
      caseData.status = payload.status;
      caseData.workflow.status = payload.status;
      addTimelineEvent(caseData, "status", "Status Updated", `Status changed to ${payload.status}`, user, payload);
    } else if (action === "update_priority" && payload.priority) {
      caseData.priority = payload.priority;
      addTimelineEvent(caseData, "priority", "Priority Updated", `Priority changed to ${payload.priority}`, user, payload);
    }
    addAuditEntry(caseData, `bulk_${action}`, "Bulk case action applied", user, payload, req);
    await caseData.save();
    return { id: caseData._id, success: true };
  }));
  return { count: results.length, results };
}

// Resolves which Team Lead a newly created case should be routed to, so it
// shows up in that Team Lead's "New Cases Queue" for assignment. Uses a
// simple least-recently-updated round robin among active team leads (scoped
// to a teamId when one is already known). Reused by every case-creation path
// (explicit POST /cases, and the auto-create-on-profile-completion path) so
// no case is ever created without an owner able to see and assign it.
async function resolveTeamLeadForCase(payload = {}) {
  if (payload.assignedTeamLead) return payload.assignedTeamLead;
  const query = { role: "team_lead", isActive: { $ne: false } };
  if (payload.teamId) query.teamId = payload.teamId;
  return User.findOne(query).sort({ updatedAt: 1 }).select("_id teamId");
}

module.exports = {
  addActivity,
  addAuditEntry,
  addTimelineEvent,
  assignUser,
  buildCaseFilter,
  buildRestrictedCaseOwnershipFilter,
  canAccessRestrictedChildCase,
  resolveCaseSearchFilter,
  buildCaseSort,
  canAccessCase,
  archiveCase,
  bulkUpdateCases,
  getAccessibleCaseOrThrow,
  getRelatedRecords,
  hydrateCaseRelationships,
  isAdmin,
  isRestrictedPortalRole,
  isStaff,
  linkCases,
  populateCaseListQuery,
  populateCaseListDocs,
  populateCaseQuery,
  populateCaseQueryForClient,
  reopenCase,
  resolveTeamLeadForCase,
  serializeCaseForUser,
  setStage,
  summarizeCase,
  writeAuditLog,
};
