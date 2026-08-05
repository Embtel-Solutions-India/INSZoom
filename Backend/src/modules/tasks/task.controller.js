const Task = require("../../models/Task");
const User = require("../../models/User");
const { createCrudController } = require("../../utils/crudFactory");
const { normalizeRole } = require("../authorization/roleHierarchy");

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function taskScope(user) {
  const role = normalizeRole(user?.role);
  if (["super_admin", "admin"].includes(role)) return {};
  if (role === "team_lead" && user.teamId) {
    return {
      $or: [
        { teamId: user.teamId },
        { assignedTeam: user.teamId },
        { assignedTo: user._id },
      ],
    };
  }
  if (["client", "user"].includes(role)) {
    return { $or: [{ assignedTo: user._id }, { clientId: user._id }] };
  }
  return { assignedTo: user._id };
}

function canAccessTask(task, req) {
  const role = normalizeRole(req.user?.role);
  if (["super_admin", "admin"].includes(role)) return true;
  if (role === "team_lead") {
    return idOf(task.assignedTo) === idOf(req.user._id)
      || (req.user.teamId && [task.teamId, task.assignedTeam].some((value) => idOf(value) === idOf(req.user.teamId)));
  }
  if (["client", "user"].includes(role)) {
    return [task.assignedTo, task.clientId].some((value) => idOf(value) === idOf(req.user._id));
  }
  return idOf(task.assignedTo) === idOf(req.user._id);
}

function taskError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function resolveAssignment(payload, req) {
  const role = normalizeRole(req.user?.role);
  const requestedAssigneeId = payload.assignedTo || req.user._id;
  const assignee = await User.findOne({ _id: requestedAssigneeId, isActive: { $ne: false } })
    .select("_id role teamId department");
  if (!assignee) throw taskError("Selected assignee is not available");

  if (!["super_admin", "admin", "team_lead"].includes(role) && idOf(assignee._id) !== idOf(req.user._id)) {
    throw taskError("Staff members may only create tasks assigned to themselves", 403);
  }
  if (role === "team_lead") {
    if (!req.user.teamId || idOf(assignee.teamId) !== idOf(req.user.teamId)) {
      throw taskError("Team leads may only assign tasks to members of their own team", 403);
    }
  }

  return {
    ...payload,
    assignedTo: assignee._id,
    assignedRole: assignee.role,
    assignedBy: req.user._id,
    department: payload.department || assignee.department || "case_management",
    teamId: assignee.teamId || payload.teamId,
    assignedTeam: assignee.teamId || payload.assignedTeam,
  };
}

async function protectAssignmentChanges(payload, req) {
  const role = normalizeRole(req.user?.role);
  if (["super_admin", "admin", "team_lead"].includes(role) && payload.assignedTo) {
    return resolveAssignment(payload, req);
  }
  const protectedFields = ["assignedTo", "assignedBy", "assignedRole", "assignedTeam", "teamId"];
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !protectedFields.includes(key)));
}

const base = createCrudController(Task, {
  label: "Task",
  collectionName: "tasks",
  singleName: "task",
  searchFields: ["title", "description", "category", "tags"],
  filterFields: ["status", "priority", "category", "caseId", "assignedTo", "companyId", "teamId"],
  populate: ["assignedTo assignedBy caseId companyId teamId"],
  dateField: "dueDate",
  buildFilter(req) {
    return taskScope(req.user);
  },
  canAccess: canAccessTask,
  beforeCreate: resolveAssignment,
  beforeUpdate: protectAssignmentChanges,
});

async function stats(req, res, next) {
  try {
    const scope = taskScope(req.user);
    const [total, byStatus, byPriority, overdueCount, upcomingCount] = await Promise.all([
      Task.countDocuments(scope),
      Task.aggregate([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Task.aggregate([{ $match: scope }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
      Task.countDocuments({ ...scope, status: { $nin: ["completed", "cancelled"] }, dueDate: { $lt: new Date() } }),
      Task.countDocuments({
        ...scope,
        status: { $nin: ["completed", "cancelled"] },
        dueDate: { $gte: new Date(), $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);
    const statusCounts = ["pending", "assigned", "in_progress", "waiting", "blocked", "completed", "cancelled"]
      .reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
    const priorityCounts = ["low", "medium", "high", "urgent"]
      .reduce((acc, priority) => ({ ...acc, [priority]: 0 }), {});
    byStatus.forEach((item) => {
      if (item._id) statusCounts[item._id] = item.count;
    });
    byPriority.forEach((item) => {
      if (item._id) priorityCounts[item._id] = item.count;
    });
    res.json({
      success: true,
      stats: {
        total,
        statusCounts,
        priorityCounts,
        overdueCount,
        upcomingCount,
        byStatus,
        byPriority,
        overdue: overdueCount,
        dueToday: upcomingCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function myTasks(req, res, next) {
  req.query.assignedTo = req.user._id.toString();
  return base.list(req, res, next);
}

async function calendar(req, res, next) {
  if (req.query.startDate || req.query.endDate) {
    req.query.from = req.query.startDate;
    req.query.to = req.query.endDate;
  }
  return base.list(req, res, next);
}

async function addComment(req, res, next) {
  try {
    const existing = await Task.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Task not found" });
    if (!canAccessTask(existing, req)) return res.status(403).json({ success: false, message: "Access denied" });
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { text: req.body.text || req.body.comment, author: req.user._id } } },
      { new: true }
    );
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    res.status(201).json({ success: true, comment: task.comments.at(-1), task });
  } catch (error) {
    next(error);
  }
}

async function bulkStatus(req, res, next) {
  try {
    const { taskIds, status } = req.body;
    if (!Array.isArray(taskIds) || !taskIds.length || !status) return res.status(400).json({ success: false, message: "taskIds and status are required" });
    const result = await Task.updateMany({ _id: { $in: taskIds }, ...taskScope(req.user) }, { status });
    res.json({ success: true, message: `Updated ${result.modifiedCount} tasks`, modifiedCount: result.modifiedCount });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  ...base,
  addComment,
  bulkStatus,
  calendar,
  myTasks,
  stats,
  teamTasks: base.list,
  taskScope,
  canAccessTask,
};
