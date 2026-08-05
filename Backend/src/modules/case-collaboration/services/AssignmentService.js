const TimelineService = require("./TimelineService");
const NotificationOrchestrator = require("./NotificationOrchestrator");
const caseService = require("../../cases/case.service");

class AssignmentService {
  static fieldFor(role) {
    return {
      case_manager: "assignedCaseManager",
      finance: "assignedFinance",
      documentation_specialist: "assignedDocumentationSpecialist",
      paralegal: "assignedAgentUser",
      reviewer: "assignedAgentUser",
      support: "assignedAgentUser",
    }[role] || "assignedAgentUser";
  }

  static async assign(caseData, payload, user, req) {
    const role = payload.role || payload.assignmentRole || "case_manager";
    const field = this.fieldFor(role);
    const assignmentRole = ["paralegal", "reviewer", "support"].includes(role) ? "agent" : role;
    caseService.assignUser(caseData, assignmentRole, payload.userId, user, payload.notes);
    if (!caseData[field]) caseData[field] = payload.userId;
    TimelineService.add(caseData, "assignment", "Case Assignment Updated", `${role.replace("_", " ")} assigned`, user, { assignedTo: payload.userId, role, field });
    TimelineService.addAudit(caseData, "case_reassigned", user, { assignedTo: payload.userId, role, field }, req);
    await caseData.save();
    await TimelineService.writeAudit("CASE_REASSIGNED", "Case", caseData._id, user, { assignedTo: payload.userId, role }, req);
    await NotificationOrchestrator.notifyUser(payload.userId, {
      type: "case_assigned",
      category: "case",
      title: "Case assigned",
      message: `You were assigned to case ${caseData.caseNumber}.`,
      caseId: caseData._id,
    }, user, req);
    await require("../../cases/case-lifecycle-orchestrator.service").onAssignment(caseData, user, req).catch(() => null);
    return caseData;
  }
}

module.exports = AssignmentService;
