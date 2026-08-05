const crypto = require("node:crypto");
const DataRightsRequest = require("../../models/DataRightsRequest");
const User = require("../../models/User");
const Client = require("../../models/Client");
const Case = require("../../models/Case");
const Document = require("../../models/Document");
const Message = require("../../models/Message");
const Answer = require("../../models/Answer");
const Payment = require("../../models/Payment");
const DisclaimerAcceptance = require("../../models/DisclaimerAcceptance");
const TelemetryEvent = require("../../models/TelemetryEvent");
const auditService = require("../audit/audit.service");
const storageService = require("../uploads/storage.service");

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

async function createRequest({ subjectUserId, type, requestedBy, reason }) {
  if (!["export", "erasure"].includes(type)) throw badRequest("type must be 'export' or 'erasure'");
  const subject = await User.findById(subjectUserId).select("_id");
  if (!subject) throw notFound("Subject user not found");
  return DataRightsRequest.create({ subjectUserId, type, requestedBy, reason: reason || "" });
}

async function listRequests(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.subjectUserId) filter.subjectUserId = query.subjectUserId;
  return DataRightsRequest.find(filter).sort({ createdAt: -1 }).populate("subjectUserId", "name email role").lean();
}

async function getRequest(id) {
  return DataRightsRequest.findById(id);
}

// Every collection a subject's data can live in, scoped conservatively:
// direct ownership fields (uploadedByUser, senderId) for Document/Message so
// an export never includes another party's content from a shared case;
// Answer/Payment are scoped at the case level since they carry no direct
// per-user field on this schema — see the Phase 0 report's documented
// assumption for the multi-party (family/employer) case edge.
async function aggregateSubjectData(subjectUserId) {
  const user = await User.findById(subjectUserId).select("-password -twoFactorSecret -emailVerificationTokenHash -passwordResetTokenHash -inviteTokenHash").lean();
  if (!user) throw notFound("Subject user not found");

  const client = await Client.findOne({ user: subjectUserId }).lean();

  const cases = await Case.find({
    $or: [
      { user: subjectUserId },
      { employeeUser: subjectUserId },
      { employerUser: subjectUserId },
      { petitionerUser: subjectUserId },
      { beneficiaryUser: subjectUserId },
    ],
  }).lean();
  const caseIds = cases.map((c) => c._id);

  const [documents, messages, answers, payments, disclaimerAcceptances, telemetryEvents] = await Promise.all([
    Document.find({ uploadedByUser: subjectUserId }).select("-storageKey").lean(),
    Message.find({ senderId: subjectUserId }).lean(),
    caseIds.length ? Answer.find({ caseId: { $in: caseIds } }).lean() : [],
    caseIds.length ? Payment.find({ caseId: { $in: caseIds } }).lean() : [],
    DisclaimerAcceptance.find({ userId: subjectUserId }).lean(),
    TelemetryEvent.find({ userId: subjectUserId }).lean(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    subjectUserId: String(subjectUserId),
    user,
    client,
    cases,
    documents,
    messages,
    answers,
    payments,
    disclaimerAcceptances,
    telemetryEvents,
  };
}

async function approve(requestId, actor, req) {
  const request = await DataRightsRequest.findById(requestId);
  if (!request) throw notFound("Data rights request not found");
  if (request.status !== "pending") throw badRequest(`Request is already ${request.status}`);

  request.status = "approved";
  request.approvedBy = actor?._id;
  await request.save();

  await auditService.recordAuditEvent({
    req,
    action: "data_rights.approve",
    entityType: "DataRightsRequest",
    entityId: String(request._id),
    severity: request.type === "erasure" ? "critical" : "medium",
    metadata: { subjectUserId: String(request.subjectUserId), type: request.type },
  });

  try {
    if (request.type === "export") await fulfilExport(request._id, req);
    else await fulfilErasure(request._id, actor, req);
  } catch (error) {
    request.status = "failed";
    request.failureReason = error.message;
    await request.save();
    throw error;
  }

  return DataRightsRequest.findById(requestId);
}

async function reject(requestId, actor, reason, req) {
  const request = await DataRightsRequest.findById(requestId);
  if (!request) throw notFound("Data rights request not found");
  if (request.status !== "pending") throw badRequest(`Request is already ${request.status}`);

  request.status = "rejected";
  request.rejectedBy = actor?._id;
  request.reason = reason || request.reason;
  await request.save();

  await auditService.recordAuditEvent({
    req,
    action: "data_rights.reject",
    entityType: "DataRightsRequest",
    entityId: String(request._id),
    details: reason,
    severity: "medium",
  });

  return request;
}

async function fulfilExport(requestId, req) {
  const request = await DataRightsRequest.findById(requestId);
  if (!request) throw notFound("Data rights request not found");

  const data = await aggregateSubjectData(request.subjectUserId);
  const buffer = Buffer.from(JSON.stringify(data, null, 2));
  const key = `data-rights-exports/${request.subjectUserId}/${crypto.randomUUID()}.json`;
  const stored = await storageService.storeBuffer(key, buffer);

  request.resultRef = stored.key;
  request.status = "completed";
  request.completedAt = new Date();
  await request.save();

  await auditService.recordAuditEvent({
    req,
    action: "data_rights.export_completed",
    entityType: "DataRightsRequest",
    entityId: String(request._id),
    severity: "medium",
    metadata: { subjectUserId: String(request.subjectUserId) },
  });

  return request;
}

const REDACTED = "[redacted — data subject exercised right to erasure]";

// Soft anonymization: redacts PII on the User record and Client profile,
// keeps the account row (and every immutable/financial record) intact so
// case history, AuditLog, and ledger entries stay legally consistent —
// erasure must never delete AuditLog or financial ledger rows.
async function fulfilErasure(requestId, actor, req) {
  const request = await DataRightsRequest.findById(requestId);
  if (!request) throw notFound("Data rights request not found");

  const user = await User.findById(request.subjectUserId);
  if (!user) throw notFound("Subject user not found");

  const anonymizedEmail = `erased-${user._id}@erased.invalid`;
  user.email = anonymizedEmail;
  user.name = REDACTED;
  user.displayName = REDACTED;
  user.phone = "";
  user.avatar = "";
  user.profileImage = "";
  user.isActive = false;
  user.deactivatedAt = new Date();
  user.deactivatedBy = actor?._id;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // invalidate any live sessions
  await user.save();

  await Client.updateMany(
    { user: request.subjectUserId },
    { $set: { firstName: REDACTED, lastName: REDACTED, fullName: REDACTED, email: anonymizedEmail } }
  ).catch(() => null); // best-effort — never fail erasure on a secondary collection

  request.status = "completed";
  request.completedAt = new Date();
  await request.save();

  await auditService.recordAuditEvent({
    req,
    action: "data_rights.erasure_completed",
    entityType: "DataRightsRequest",
    entityId: String(request._id),
    severity: "critical",
    metadata: { subjectUserId: String(request.subjectUserId) },
  });

  return request;
}

async function getExportArtifact(requestId, actor) {
  const request = await DataRightsRequest.findById(requestId);
  if (!request) throw notFound("Data rights request not found");
  if (request.type !== "export" || request.status !== "completed" || !request.resultRef) {
    throw badRequest("This request has no completed export artifact yet");
  }
  const isOwner = String(request.subjectUserId) === String(actor?._id);
  const isStaff = ["super_admin", "admin"].includes(actor?.role);
  if (!isOwner && !isStaff) throw forbidden("Not authorized to download this export");
  const buffer = await storageService.readBuffer(request.resultRef);
  return buffer;
}

module.exports = {
  createRequest,
  listRequests,
  getRequest,
  approve,
  reject,
  fulfilExport,
  fulfilErasure,
  getExportArtifact,
  aggregateSubjectData,
};
