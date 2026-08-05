const CaseForm = require("../../../models/CaseForm");
const ImmigrationTimelineService = require("./ImmigrationTimelineService");
const DeadlineService = require("./DeadlineService");
const NotificationLifecycleService = require("./NotificationLifecycleService");

class FilingService {
  static async file(caseData, payload, user, req) {
    const lifecycle = ImmigrationTimelineService.ensure(caseData);
    const formVersions = payload.formVersions || await CaseForm.find({ caseId: caseData._id }).select("formCode formVersion formEditionDate versionNumber generatedPdfDocument").lean();
    const filing = {
      packageVersion: payload.packageVersion || lifecycle.filings.length + 1,
      status: payload.status || "filed",
      submissionDate: payload.submissionDate ? new Date(payload.submissionDate) : new Date(),
      submissionMethod: payload.submissionMethod || "mail",
      trackingNumbers: payload.trackingNumbers || [],
      formVersions,
      supportingEvidence: payload.supportingEvidence || [],
      attorneyApproval: payload.attorneyApproval || { approvedBy: caseData.assignedAttorney, approvedAt: new Date() },
      filedBy: ImmigrationTimelineService.userId(user),
      notes: payload.notes,
      createdAt: new Date(),
    };
    lifecycle.filings.push(filing);
    lifecycle.filingStatus = filing.status;
    caseData.filingDate = filing.submissionDate;
    caseData.stage = "uscis_pending";
    caseData.workflow.stage = "uscis_pending";
    ImmigrationTimelineService.add(caseData, "filing", `${caseData.visaType || "Case"} Filed`, filing, user);
    ImmigrationTimelineService.audit(caseData, "case_filed", user, filing, req);
    DeadlineService.generateFromCase(caseData, user);
    await caseData.save();
    await ImmigrationTimelineService.writeAudit("CASE_FILED", caseData, user, filing, req);
    await NotificationLifecycleService.caseStakeholders(caseData, { type: "petition_filed", title: "Case filed", message: `${caseData.caseNumber} was filed.`, caseId: caseData._id, metadata: filing }, user, req);
    await require("../../cases/case-lifecycle-orchestrator.service").recalculate(caseData._id, user, req, "case_filed");
    return filing;
  }
}

module.exports = FilingService;
