const ImmigrationTimelineService = require("./ImmigrationTimelineService");
const NotificationLifecycleService = require("./NotificationLifecycleService");
const notificationService = require("../../notifications/notification.service");
const User = require("../../../models/User");

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

    // Client-facing email only - caseStakeholders() above already sent the
    // in-app/socket notification to client + case manager + attorney alike
    // with one shared payload; email needs client-voiced copy and a single
    // real recipient address, so it's a separate, additive call (channels:
    // ["email"] only, to avoid a second duplicate in-app notification for
    // the client).
    const clientUserId = caseData.user || caseData.clientProfile;
    if (clientUserId) {
      const clientUser = await User.findById(clientUserId).select("name displayName email").catch(() => null);
      if (clientUser?.email) {
        await notificationService.createNotification({
          userId: clientUserId,
          type: "case_stage_changed",
          category: "case",
          title: "Your case status has been updated",
          message: `${caseData.caseNumber}: ${payload.status}`,
          caseId: caseData._id,
          priority: "high",
          source: "shared",
          channels: ["email"],
          emailTemplate: "case-stage-changed",
          emailTo: clientUser.email,
          emailData: { clientName: clientUser.name || clientUser.displayName, caseNumber: caseData.caseNumber, stage: payload.status, stageName: payload.status },
        }, user, req).catch(() => null);
      }
    }
    return statusEvent;
  }
}

module.exports = CaseStatusService;
