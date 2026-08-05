const ImmigrationTimelineService = require("./ImmigrationTimelineService");
const NotificationLifecycleService = require("./NotificationLifecycleService");

class CaseStatusService {
  static async updateStatus(caseData, payload, user, req) {
    const lifecycle = ImmigrationTimelineService.ensure(caseData);
    const statusEvent = {
      status: payload.status,
      statusDate: payload.statusDate ? new Date(payload.statusDate) : new Date(),
      source: payload.source || "manual",
      receiptNumber: payload.receiptNumber || caseData.uscisReceiptNumber,
      description: payload.description,
      rawStatus: payload.rawStatus,
      recordedBy: ImmigrationTimelineService.userId(user),
      recordedAt: new Date(),
    };
    lifecycle.governmentStatusHistory.push(statusEvent);
    lifecycle.filingStatus = payload.lifecycleStatus || lifecycle.filingStatus || "in_processing";
    caseData.receiptTracking = {
      ...(caseData.receiptTracking || {}),
      receiptNumber: statusEvent.receiptNumber,
      status: statusEvent.status,
      lastCheckedAt: new Date(),
      source: statusEvent.source,
      history: [...(caseData.receiptTracking?.history || []), { status: statusEvent.status, checkedAt: new Date(), source: statusEvent.source, notes: statusEvent.description }],
    };
    if (payload.status === "request_for_evidence") caseData.uscisDecision = "rfe";
    if (payload.status === "case_approved") caseData.uscisDecision = "approved";
    if (payload.status === "case_denied") caseData.uscisDecision = "denied";
    ImmigrationTimelineService.add(caseData, "status", `USCIS Status: ${payload.status}`, statusEvent, user);
    ImmigrationTimelineService.audit(caseData, "uscis_status_updated", user, statusEvent, req);
    await caseData.save();
    await ImmigrationTimelineService.writeAudit("USCIS_STATUS_UPDATED", caseData, user, statusEvent, req);
    await NotificationLifecycleService.caseStakeholders(caseData, { type: "case_stage_changed", title: "USCIS status updated", message: `${caseData.caseNumber}: ${payload.status}`, caseId: caseData._id, metadata: statusEvent }, user, req);
    return statusEvent;
  }
}

module.exports = CaseStatusService;
