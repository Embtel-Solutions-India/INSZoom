const DeadlineService = require("./DeadlineService");
const ImmigrationTimelineService = require("./ImmigrationTimelineService");
const NotificationLifecycleService = require("./NotificationLifecycleService");

class RFEService {
  static async create(caseData, payload, user, req) {
    const lifecycle = ImmigrationTimelineService.ensure(caseData);
    const rfe = {
      rfeDate: payload.rfeDate ? new Date(payload.rfeDate) : new Date(),
      responseDeadline: payload.responseDeadline ? new Date(payload.responseDeadline) : payload.responseDeadline,
      requestedEvidence: payload.requestedEvidence || [],
      assignedAttorney: payload.assignedAttorney || caseData.assignedAttorney,
      assignedCaseManager: payload.assignedCaseManager || caseData.assignedCaseManager,
      responseStatus: payload.responseStatus || "pending",
      supportingDocuments: payload.supportingDocuments || [],
      notes: payload.notes,
      createdBy: ImmigrationTimelineService.userId(user),
      createdAt: new Date(),
    };
    lifecycle.rfes.push(rfe);
    lifecycle.filingStatus = "in_processing";
    caseData.uscisDecision = "rfe";
    caseData.rfeDeadline = rfe.responseDeadline;
    DeadlineService.addDeadline(caseData, { type: "rfe_deadline", label: "RFE Response Deadline", dueDate: rfe.responseDeadline, source: "rfe", priority: "urgent", relatedEntity: { type: "rfe" } }, user);
    ImmigrationTimelineService.add(caseData, "rfe", "Request for Evidence Issued", rfe, user);
    ImmigrationTimelineService.audit(caseData, "rfe_issued", user, rfe, req);
    await caseData.save();
    await ImmigrationTimelineService.writeAudit("RFE_ISSUED", caseData, user, rfe, req);
    await NotificationLifecycleService.caseStakeholders(caseData, { type: "rfe_received", title: "RFE issued", message: `RFE issued for case ${caseData.caseNumber}.`, caseId: caseData._id, metadata: rfe, priority: "high" }, user, req);
    return rfe;
  }

  static progress(rfe = {}) {
    const total = Math.max((rfe.requestedEvidence || []).length, 1);
    const completed = (rfe.supportingDocuments || []).length;
    return Math.min(100, Math.round((completed / total) * 100));
  }
}

module.exports = RFEService;
