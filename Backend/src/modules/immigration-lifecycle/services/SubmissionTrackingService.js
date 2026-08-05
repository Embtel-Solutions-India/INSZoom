const ImmigrationTimelineService = require("./ImmigrationTimelineService");
const NotificationLifecycleService = require("./NotificationLifecycleService");

const SERVICE_CENTER_PREFIX = {
  WAC: "California Service Center",
  SRC: "Texas Service Center",
  LIN: "Nebraska Service Center",
  IOE: "USCIS Electronic Immigration System",
  MSC: "National Benefits Center",
  EAC: "Vermont Service Center",
};

class SubmissionTrackingService {
  static serviceCenter(receiptNumber = "") {
    return SERVICE_CENTER_PREFIX[String(receiptNumber).slice(0, 3).toUpperCase()] || "Unknown";
  }

  static async recordReceipt(caseData, payload, user, req) {
    const lifecycle = ImmigrationTimelineService.ensure(caseData);
    const receipt = {
      receiptNumber: payload.receiptNumber,
      receiptDate: payload.receiptDate ? new Date(payload.receiptDate) : new Date(),
      serviceCenter: payload.serviceCenter || this.serviceCenter(payload.receiptNumber),
      formCode: payload.formCode,
      filingId: payload.filingId,
      source: payload.source || "manual",
      notes: payload.notes,
      recordedBy: ImmigrationTimelineService.userId(user),
      recordedAt: new Date(),
    };
    lifecycle.receipts.push(receipt);
    lifecycle.filingStatus = "received_by_uscis";
    caseData.uscisReceiptNumber = receipt.receiptNumber;
    caseData.uscisNumber = receipt.receiptNumber;
    caseData.receiptTracking = {
      receiptNumber: receipt.receiptNumber,
      status: "case_received",
      lastCheckedAt: new Date(),
      source: receipt.source,
      history: [...(caseData.receiptTracking?.history || []), { status: "case_received", checkedAt: new Date(), source: receipt.source, notes: receipt.notes }],
    };
    ImmigrationTimelineService.add(caseData, "receipt", "USCIS Receipt Recorded", receipt, user);
    ImmigrationTimelineService.audit(caseData, "receipt_recorded", user, receipt, req);
    await caseData.save();
    await ImmigrationTimelineService.writeAudit("RECEIPT_RECORDED", caseData, user, receipt, req);
    await NotificationLifecycleService.caseStakeholders(caseData, { type: "receipt_number_generated", title: "USCIS receipt recorded", message: `Receipt ${receipt.receiptNumber} recorded for case ${caseData.caseNumber}.`, caseId: caseData._id, metadata: receipt }, user, req);
    return receipt;
  }
}

module.exports = SubmissionTrackingService;
