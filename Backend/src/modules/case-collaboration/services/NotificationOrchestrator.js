const notificationService = require("../../notifications/notification.service");

class NotificationOrchestrator {
  static async notifyRoles(roles, payload, user, req) {
    return notificationService.createForRoles(roles, { source: "shared", channels: ["in_app", "socket"], ...payload }, user, req).catch(() => []);
  }

  static async notifyUser(userId, payload, user, req) {
    if (!userId) return null;
    return notificationService.createNotification({ source: "shared", userId, channels: ["in_app", "socket"], ...payload }, user, req).catch(() => null);
  }

  static requestCreated(caseData, request, user, req) {
    return this.notifyUser(caseData.user || caseData.clientProfile, {
      type: "document_requested",
      category: "document",
      title: "Document requested",
      message: `${request.name} was requested for case ${caseData.caseNumber}.`,
      caseId: caseData._id,
      metadata: { requestId: request._id, documentType: request.documentType },
    }, user, req);
  }

  static taskAssigned(caseData, task, user, req) {
    return this.notifyUser(task.assignedTo, {
      type: "task_assigned",
      category: "task",
      title: "Task assigned",
      message: `${task.title} was assigned for case ${caseData.caseNumber}.`,
      caseId: caseData._id,
      taskId: task._id,
      metadata: { taskId: task._id, priority: task.priority },
    }, user, req);
  }

  static commentAdded(caseData, comment, user, req) {
    const roles = comment.isInternal ? ["case_manager", "paralegal"] : ["case_manager", "paralegal", "client"];
    return this.notifyRoles(roles, {
      type: "message_received",
      category: "message",
      title: "Case comment added",
      message: `A comment was added to case ${caseData.caseNumber}.`,
      caseId: caseData._id,
      metadata: { commentId: comment._id, targetType: comment.targetType },
    }, user, req);
  }
}

module.exports = NotificationOrchestrator;
