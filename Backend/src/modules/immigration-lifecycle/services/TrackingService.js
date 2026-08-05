const mongoose = require("mongoose");
const Document = require("../../../models/Document");
const ImmigrationTimelineService = require("./ImmigrationTimelineService");
const NotificationLifecycleService = require("./NotificationLifecycleService");

const STATUS_TO_LIFECYCLE = {
  draft: "prepared",
  ready_to_file: "ready_to_file",
  filed: "filed",
  delivered: "filed",
  receipt_issued: "received_by_uscis",
  biometrics_scheduled: "in_processing",
  biometrics_completed: "in_processing",
  interview_scheduled: "in_processing",
  interview_completed: "in_processing",
  rfe_issued: "in_processing",
  rfe_response_submitted: "in_processing",
  transferred: "in_processing",
  approved: "completed",
  denied: "rejected",
  withdrawn: "withdrawn",
  closed: "closed",
};

const NOTICE_TYPES = new Set(["uscis_notice", "approval_notice", "rfe", "noid"]);
const TRACKING_STATUSES = new Set(Object.keys(STATUS_TO_LIFECYCLE));
const FILING_METHODS = new Set(["", "paper", "online"]);
const CARRIERS = new Set(["", "fedex", "ups", "usps", "other"]);
const RFE_STATUSES = new Set(["", "pending", "preparing", "under_review", "ready_to_submit", "submitted", "accepted", "closed"]);

function validationError(message) {
  return Object.assign(new Error(message), { status: 422, code: "INVALID_USCIS_TRACKING" });
}

function dateValue(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError(`Invalid date: ${value}`);
  return date;
}

function validateReference(value, label) {
  if (value && !mongoose.isValidObjectId(value)) throw validationError(`${label} is invalid`);
}

function validatePayload(payload = {}) {
  const filing = payload.filing || {};
  const rfe = payload.rfe || {};
  if (payload.status && !TRACKING_STATUSES.has(payload.status)) throw validationError("Unsupported USCIS lifecycle status");
  if (!FILING_METHODS.has(filing.filingMethod || "")) throw validationError("Unsupported filing method");
  if (!CARRIERS.has(filing.carrier || "")) throw validationError("Unsupported shipping carrier");
  if (!RFE_STATUSES.has(rfe.responseStatus || "")) throw validationError("Unsupported RFE response status");
  const receiptNumber = String(filing.receiptNumber || "").replace(/[\s-]/g, "").toUpperCase();
  if (receiptNumber && !/^[A-Z]{3}\d{10}$/.test(receiptNumber)) throw validationError("USCIS receipt number must contain three letters followed by ten digits");
  if (filing.filingFeeCents !== undefined && (!Number.isFinite(Number(filing.filingFeeCents)) || Number(filing.filingFeeCents) < 0)) {
    throw validationError("Filing fee must be a non-negative amount");
  }
  validateReference(filing.filingAttorney, "Filing attorney");
  validateReference(rfe.responsibleCaseManager, "Responsible case manager");
  validateReference(rfe.assignedAttorney, "Assigned attorney");
  for (const reference of rfe.documentReferences || []) validateReference(reference, "RFE document reference");
  ["filingDate", "deliveryConfirmationDate"].forEach((field) => dateValue(filing[field]));
  ["issueDate", "responseDueDate", "responseSubmittedDate"].forEach((field) => dateValue(rfe[field]));
}

function normalizedTracking(caseData, payload, user) {
  const current = caseData.immigrationLifecycle?.tracking?.toObject
    ? caseData.immigrationLifecycle.tracking.toObject()
    : (caseData.immigrationLifecycle?.tracking || {});
  const filing = payload.filing || {};
  const rfe = payload.rfe || {};
  return {
    status: payload.status || current.status || "draft",
    filing: {
      ...(current.filing || {}),
      filingDate: dateValue(filing.filingDate),
      receiptNumber: filing.receiptNumber?.replace(/[\s-]/g, "").trim().toUpperCase(),
      serviceCenter: filing.serviceCenter?.trim(),
      lockbox: filing.lockbox?.trim(),
      filingMethod: filing.filingMethod || "",
      carrier: filing.carrier || "",
      trackingNumber: filing.trackingNumber?.trim(),
      deliveryConfirmationDate: dateValue(filing.deliveryConfirmationDate),
      filingAttorney: filing.filingAttorney || undefined,
      filingFeeCents: Math.max(0, Number(filing.filingFeeCents || 0)),
      premiumProcessing: Boolean(filing.premiumProcessing),
    },
    rfe: {
      ...(current.rfe || {}),
      issueDate: dateValue(rfe.issueDate),
      responseDueDate: dateValue(rfe.responseDueDate),
      responseSubmittedDate: dateValue(rfe.responseSubmittedDate),
      responsibleCaseManager: rfe.responsibleCaseManager || undefined,
      assignedAttorney: rfe.assignedAttorney || undefined,
      documentReferences: rfe.documentReferences || current.rfe?.documentReferences || [],
      aiSummary: rfe.aiSummary?.trim(),
      responseStatus: rfe.responseStatus || "",
    },
    notes: payload.notes?.trim(),
    lastUpdatedAt: new Date(),
    lastUpdatedBy: ImmigrationTimelineService.userId(user),
  };
}

function syncCaseFields(caseData, tracking) {
  caseData.filingDate = tracking.filing.filingDate;
  caseData.uscisReceiptNumber = tracking.filing.receiptNumber;
  caseData.uscisNumber = tracking.filing.receiptNumber;
  caseData.rfeDeadline = tracking.rfe.responseDueDate;
  caseData.rfeResponseDate = tracking.rfe.responseSubmittedDate;
  if (tracking.filing.receiptNumber) {
    caseData.receiptTracking = {
      ...(caseData.receiptTracking?.toObject?.() || caseData.receiptTracking || {}),
      receiptNumber: tracking.filing.receiptNumber,
      status: tracking.status,
      lastCheckedAt: new Date(),
      source: "manual",
    };
  }
  if (tracking.status === "approved") caseData.uscisDecision = "approved";
  else if (tracking.status === "denied") caseData.uscisDecision = "denied";
  else if (tracking.status === "rfe_issued") caseData.uscisDecision = "rfe";
  else if (!["withdrawn", "closed"].includes(tracking.status)) caseData.uscisDecision = "pending";
}

async function save(caseData, payload, user, req) {
  validatePayload(payload);
  const lifecycle = ImmigrationTimelineService.ensure(caseData);
  const previousStatus = lifecycle.tracking?.status || "draft";
  const tracking = normalizedTracking(caseData, payload, user);
  lifecycle.tracking = tracking;
  lifecycle.filingStatus = STATUS_TO_LIFECYCLE[tracking.status];
  lifecycle.lastLifecycleUpdatedAt = new Date();
  lifecycle.lastLifecycleUpdatedBy = ImmigrationTimelineService.userId(user);
  syncCaseFields(caseData, tracking);

  if (previousStatus !== tracking.status) {
    ImmigrationTimelineService.add(caseData, "status", `USCIS Status: ${tracking.status.replace(/_/g, " ")}`, {
      status: tracking.status,
      previousStatus,
      date: new Date(),
      description: payload.statusNote || `USCIS status changed from ${previousStatus} to ${tracking.status}`,
    }, user);
  }
  ImmigrationTimelineService.audit(caseData, "uscis_tracking_updated", user, { previousStatus, tracking }, req);
  await caseData.save();
  await ImmigrationTimelineService.writeAudit("USCIS_TRACKING_UPDATED", caseData, user, { previousStatus, tracking }, req);
  if (previousStatus !== tracking.status) {
    await NotificationLifecycleService.caseStakeholders(caseData, {
      type: "case_stage_changed",
      title: "USCIS tracking updated",
      message: `${caseData.caseNumber}: ${tracking.status.replace(/_/g, " ")}`,
      caseId: caseData._id,
      metadata: { previousStatus, status: tracking.status },
    }, user, req);
  }
  return tracking;
}

async function governmentDocuments(caseId) {
  return Document.find({
    caseId,
    deletedAt: { $exists: false },
    $or: [
      { documentType: { $in: [...NOTICE_TYPES] } },
      { category: { $in: ["government", "immigration"] }, documentType: /notice/i },
    ],
  })
    .select("originalName documentType category reviewStatus documentUrl storageKey createdAt metadata")
    .sort({ createdAt: -1 })
    .lean();
}

async function get(caseData) {
  const documents = await governmentDocuments(caseData._id);
  const timeline = [...(caseData.timeline || [])]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, 100);
  return {
    tracking: caseData.immigrationLifecycle?.tracking || { status: "draft", filing: {}, rfe: {} },
    governmentDocuments: documents,
    timeline,
  };
}

module.exports = { STATUS_TO_LIFECYCLE, get, save, validatePayload };
