const caseService = require("./case.service");
const workflowEngine = require("../workflows/workflow.service");

async function recordWorkflow(caseData, type, title, description, user, metadata = {}) {
  caseService.addTimelineEvent(caseData, type, title, description, user, metadata);
  caseService.addActivity(caseData, title, description, user);
}

async function caseCreated(caseData, user) {
  await recordWorkflow(caseData, "workflow", "Case Created", `Case ${caseData.caseNumber} created`, user);
  await workflowEngine.startCaseWorkflow(caseData, user).catch(() => {});
  await workflowEngine.triggerWorkflow("case.created", { caseId: caseData._id, entityId: caseData._id, caseNumber: caseData.caseNumber }, user).catch(() => {});
}

async function statusChanged(caseData, oldStatus, newStatus, user) {
  if (!newStatus || oldStatus === newStatus) return;
  const stageByStatus = {
    rfe: "rfe",
    processing: "processing",
    pending_approval: "form_preparation",
    ready_for_filing: "filing",
    approved: "approved",
    rejected: "denied",
    closed: "closed",
  };
  if (stageByStatus[newStatus]) {
    caseService.setStage(caseData, stageByStatus[newStatus], user, `Status changed from ${oldStatus} to ${newStatus}`);
  }
  await recordWorkflow(caseData, "workflow", "Status Changed", `Case status changed from ${oldStatus} to ${newStatus}`, user, { oldStatus, newStatus });
  const eventByStatus = {
    rfe: "rfe.received",
    processing: oldStatus === "rfe" ? "rfe.submitted" : "case.processing",
    pending_approval: "petition.draft.completed",
    ready_for_filing: "filing.approved",
    approved: "case.approved",
    rejected: "case.rejected",
    closed: "case.closed",
  };
  if (eventByStatus[newStatus]) {
    await workflowEngine.triggerWorkflow(eventByStatus[newStatus], { caseId: caseData._id, entityId: caseData._id, oldStatus, newStatus }, user).catch(() => {});
  }
}

async function questionnaireSent(caseData, user, metadata = {}) {
  await recordWorkflow(caseData, "questionnaire", "Questionnaire Sent", "Questionnaire sent to client", user, metadata);
  await workflowEngine.triggerWorkflow("questionnaire.sent", { caseId: caseData._id, entityId: caseData._id, ...metadata }, user).catch(() => {});
}

async function documentsRequested(caseData, user, metadata = {}) {
  await recordWorkflow(caseData, "document_request", "Documents Requested", "Documents requested from client", user, metadata);
  await workflowEngine.triggerWorkflow("documents.requested", { caseId: caseData._id, entityId: caseData._id, ...metadata }, user).catch(() => {});
}

module.exports = {
  caseCreated,
  documentsRequested,
  questionnaireSent,
  statusChanged,
};
