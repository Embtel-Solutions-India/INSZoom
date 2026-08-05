const Task = require("../../../models/Task");
const TimelineService = require("./TimelineService");
const NotificationOrchestrator = require("./NotificationOrchestrator");

class TaskManagementService {
  static async create(caseData, payload, user, req) {
    const task = await Task.create({
      title: payload.title,
      description: payload.description,
      caseId: caseData._id,
      clientId: caseData.user,
      assignedTo: payload.assignedTo,
      assignedBy: user?._id,
      dueDate: payload.dueDate,
      priority: payload.priority || "medium",
      status: payload.status || "assigned",
      category: payload.category || "case_preparation",
      dependencies: payload.dependencies || [],
      tags: payload.tags || ["case-collaboration"],
      companyId: caseData.companyId,
      teamId: caseData.teamId,
      source: "shared",
      auditHistory: [{ action: "created", performedBy: user?._id, changes: payload, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }],
    });
    TimelineService.add(caseData, "task", "Task Created", task.title, user, { taskId: task._id, assignedTo: task.assignedTo, priority: task.priority });
    TimelineService.addAudit(caseData, "task_assigned", user, { taskId: task._id, assignedTo: task.assignedTo }, req);
    await caseData.save();
    await TimelineService.writeAudit("TASK_ASSIGNED", "Task", task._id, user, { caseId: caseData._id }, req);
    await NotificationOrchestrator.taskAssigned(caseData, task, user, req);
    return task;
  }
}

module.exports = TaskManagementService;
