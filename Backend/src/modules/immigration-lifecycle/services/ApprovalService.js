const DeadlineService = require("./DeadlineService");
const ImmigrationTimelineService = require("./ImmigrationTimelineService");
const NotificationLifecycleService = require("./NotificationLifecycleService");

class ApprovalService {
  static async approve(caseData, payload, user, req) {
    const lifecycle = ImmigrationTimelineService.ensure(caseData);
    const approval = {
      approvalDate: payload.approvalDate ? new Date(payload.approvalDate) : new Date(),
      noticeType: payload.noticeType || "approval_notice",
      validityStart: payload.validityStart ? new Date(payload.validityStart) : undefined,
      validityEnd: payload.validityEnd ? new Date(payload.validityEnd) : undefined,
      approvalDocument: payload.approvalDocument,
      receiptNumber: payload.receiptNumber || caseData.uscisReceiptNumber,
      notes: payload.notes,
      recordedBy: ImmigrationTimelineService.userId(user),
      recordedAt: new Date(),
    };
    lifecycle.approvals.push(approval);
    lifecycle.filingStatus = "completed";
    caseData.uscisDecision = "approved";
    caseData.uscisDecisionDate = approval.approvalDate;
    if (approval.validityEnd) {
      caseData.visaExpirationDate = approval.validityEnd;
      DeadlineService.addDeadline(caseData, { type: "visa_expiration", label: "Visa/Status Expiration", dueDate: approval.validityEnd, source: "approval", priority: "high" }, user);
    }
    ImmigrationTimelineService.add(caseData, "approval", "Case Approved", approval, user);
    ImmigrationTimelineService.audit(caseData, "approval_recorded", user, approval, req);
    await caseData.save();
    await ImmigrationTimelineService.writeAudit("APPROVAL_RECORDED", caseData, user, approval, req);
    await NotificationLifecycleService.caseStakeholders(caseData, { type: "case_approved", title: "Case approved", message: `${caseData.caseNumber} was approved.`, caseId: caseData._id, metadata: approval }, user, req);
    return approval;
  }

  static async deny(caseData, payload, user, req) {
    const lifecycle = ImmigrationTimelineService.ensure(caseData);
    const denial = {
      denialDate: payload.denialDate ? new Date(payload.denialDate) : new Date(),
      denialReasons: payload.denialReasons || [],
      appealDeadline: payload.appealDeadline ? new Date(payload.appealDeadline) : undefined,
      motions: payload.motions || [],
      reconsiderationRequests: payload.reconsiderationRequests || [],
      attorneyNotes: payload.attorneyNotes,
      riskAnalysis: payload.riskAnalysis,
      recordedBy: ImmigrationTimelineService.userId(user),
      recordedAt: new Date(),
    };
    lifecycle.denials.push(denial);
    lifecycle.filingStatus = "rejected";
    caseData.uscisDecision = "denied";
    caseData.uscisDecisionDate = denial.denialDate;
    if (denial.appealDeadline) DeadlineService.addDeadline(caseData, { type: "appeal_deadline", label: "Appeal/Motion Deadline", dueDate: denial.appealDeadline, source: "denial", priority: "urgent" }, user);
    ImmigrationTimelineService.add(caseData, "denial", "Case Denied", denial, user);
    ImmigrationTimelineService.audit(caseData, "denial_recorded", user, denial, req);
    await caseData.save();
    await ImmigrationTimelineService.writeAudit("DENIAL_RECORDED", caseData, user, denial, req);
    await NotificationLifecycleService.caseStakeholders(caseData, { type: "case_rejected", title: "Case denied", message: `${caseData.caseNumber} was denied. Attorney review required.`, caseId: caseData._id, metadata: denial, priority: "urgent" }, user, req);
    return denial;
  }
}

module.exports = ApprovalService;
