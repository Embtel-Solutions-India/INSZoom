const Case = require("../../../models/Case");
const Document = require("../../../models/Document");
const Task = require("../../../models/Task");
const CaseForm = require("../../../models/CaseForm");
const Message = require("../../../models/Message");
const caseService = require("../../cases/case.service");
const CommentService = require("./CommentService");
const RequestManagementService = require("./RequestManagementService");
const TaskManagementService = require("./TaskManagementService");
const AssignmentService = require("./AssignmentService");
const TimelineService = require("./TimelineService");

class CollaborationService {
  static async getCase(caseId, user) {
    const caseData = await Case.findById(caseId);
    if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Access denied"), { status: 403 });
    return caseData;
  }

  static timeline(caseData, user) {
    return TimelineService.list(caseData, user).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  static addComment(caseData, payload, user, req) {
    return CommentService.addComment(caseData, payload, user, req);
  }

  static createRequest(caseData, payload, user, req) {
    return RequestManagementService.create(caseData, payload, user, req);
  }

  static createTask(caseData, payload, user, req) {
    return TaskManagementService.create(caseData, payload, user, req);
  }

  static assign(caseData, payload, user, req) {
    return AssignmentService.assign(caseData, payload, user, req);
  }

  static async readiness(caseId, user) {
    const caseData = await this.getCase(caseId, user);
    const lifecycle = await require("../../cases/case-lifecycle-orchestrator.service").recalculate(caseData, user, null, "readiness_requested");
    const [documents, tasks, forms, comments] = await Promise.all([
      Document.find({ caseId, deletedAt: { $exists: false } }).lean(),
      Task.find({ caseId }).lean(),
      CaseForm.find({ caseId }).lean(),
      Message.find({ caseId, deletedAt: { $exists: false } }).lean(),
    ]);
    const checklist = [...(caseData.documentChecklist || []), ...(caseData.checklistItems || [])];
    const missingDocuments = checklist.filter((item) => ["pending", "requested", "missing", "overdue"].includes(item.status));
    const pendingRequests = checklist.filter((item) => ["requested", "missing", "overdue"].includes(item.status));
    const openTasks = tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
    const pendingReviews = documents.filter((doc) => ["pending", "under_review", "needs_revision"].includes(doc.reviewStatus));
    const readyForms = forms.filter((form) => ["approved", "ready_for_pdf", "generated", "locked", "filed"].includes(form.status));
    const eligibilityScore = caseData.eligibility?.latestEvaluation?.recommendations?.[0]?.eligibilityScore || caseData.assessmentMatchPercentage || 0;
    const completionPercent = lifecycle.progress.percent;
    return {
      caseId,
      completionPercent,
      caseHealthScore: Math.max(0, completionPercent - Math.min(30, openTasks.length * 5 + pendingRequests.length * 5)),
      missingDocuments,
      pendingRequests,
      openTasks,
      pendingReviews,
      readyForms,
      eligibilityStatus: caseData.eligibility?.latestEvaluation ? "evaluated" : "not_evaluated",
      submissionReadiness: lifecycle.metrics.filed ? "filed" : lifecycle.metrics.attorneyReviewComplete ? "ready_to_file" : lifecycle.metrics.formsGenerated ? "ready_for_attorney_review" : completionPercent >= 60 ? "needs_work" : "not_ready",
      journeyProgress: lifecycle.progress,
      lifecycleMetrics: lifecycle.metrics,
      counts: { documents: documents.length, tasks: tasks.length, forms: forms.length, comments: comments.length },
    };
  }
}

module.exports = CollaborationService;
