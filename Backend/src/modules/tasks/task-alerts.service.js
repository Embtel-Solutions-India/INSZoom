// Task notifications: who is told what, and when.
//
//   assigned        -> the assignee (browser push + in-app + email). When the creator assigned it to themselves the email says
//                      "you created a task for yourself" instead.
//   deadline near   -> (open task, due within DUE_SOON_HOURS) the assignee, and the creator too when it is someone else.
//   deadline passed -> (open task, due date reached) the assignee, and the creator too when it is someone else.
//
// Each stage is sent once per task and deadline: Task.alerts.* records it, claimed atomically so two sweeps (or two backend instances)
// can never send the same email twice. Changing the deadline or the assignee clears the marks, so the reminders run again.
// Everything here is best-effort: it logs and returns, never throws into the code that created or updated the task.
const Task = require("../../models/Task");
const User = require("../../models/User");
const logger = require("../../utils/logger");
const { portalUrl } = require("../email/portalUrls");

const HOUR_MS = 60 * 60 * 1000;
const DUE_SOON_HOURS = Number(process.env.TASK_DUE_SOON_HOURS || 48);
// A task whose deadline passed longer ago than this is old news, not "just overdue": the first sweep after this feature goes live
// (or after downtime) must not email people about every long-overdue task in the database.
const OVERDUE_LOOKBACK_HOURS = Number(process.env.TASK_OVERDUE_LOOKBACK_HOURS || 48);
const SWEEP_BATCH = Number(process.env.TASK_ALERT_BATCH_SIZE || 200);
const TIMEZONE = process.env.TASK_ALERT_TIMEZONE || "Asia/Kolkata";
const OPEN = { $nin: ["completed", "cancelled"] };

const idOf = (value) => String(value?._id || value || "");
const titleCase = (value) => String(value || "").split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
const enabled = () => process.env.TASK_ALERTS_ENABLED !== "false";

function formatDeadline(date) {
  if (!date) return "No deadline";
  return new Date(date).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TIMEZONE, timeZoneName: "short" });
}

function timeLeft(dueDate, now) {
  const hours = (new Date(dueDate).getTime() - now.getTime()) / HOUR_MS;
  if (hours < 1) return "in less than an hour";
  if (hours < 24) return `in ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function portalLinkFor(user, task) {
  const portal = user.role === "attorney" ? "attorney" : ["client", "user"].includes(user.role) ? "client" : "admin";
  return `${portalUrl(portal)}/tasks/${task._id}`;
}

const loadUsers = async (ids) => {
  const unique = [...new Set(ids.map(idOf).filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique }, isActive: { $ne: false } }).select("_id email role name displayName").lean();
  return new Map(users.map((user) => [idOf(user), user]));
};

const nameOf = (user) => user?.name || user?.displayName || user?.email || "";

// Push + in-app + email for one person about one task.
async function deliver({ user, task, actor, type, emailTemplate, title, message, priority, assignee, creator, now }) {
  const notificationService = require("../notifications/notification.service");
  const caseRef = task.caseId && typeof task.caseId === "object" && task.caseId.caseNumber ? task.caseId : null;
  const emailData = {
    recipientName: nameOf(user),
    taskTitle: task.title,
    taskDescription: String(task.description || "").slice(0, 400),
    priority: titleCase(task.priority || "medium"),
    dueDate: formatDeadline(task.dueDate),
    timeLeft: task.dueDate ? timeLeft(task.dueDate, now || new Date()) : "",
    assigneeName: nameOf(assignee),
    creatorName: nameOf(creator),
    caseLabel: caseRef ? `${caseRef.caseNumber}${caseRef.clientName ? ` - ${caseRef.clientName}` : ""}` : "",
    portalLink: portalLinkFor(user, task),
  };
  return notificationService.createNotification({
    userId: user._id,
    recipientRole: user.role,
    type,
    category: "workflow",
    title,
    message,
    link: `/tasks/${task._id}`,
    priority,
    source: "shared",
    taskId: task._id,
    channels: ["in_app", "socket", "push"],
    emailTemplate,
    emailData,
    metadata: { taskId: String(task._id), stage: emailTemplate },
  }, actor);
}

// A task was created (or handed to someone new): tell the assignee.
async function notifyAssigned(task, actor, { reassignedFrom } = {}) {
  if (!enabled() || !task?.assignedTo) return;
  const creatorId = task.assignedBy || actor?._id;
  const users = await loadUsers([task.assignedTo, creatorId]);
  const assignee = users.get(idOf(task.assignedTo));
  if (!assignee) return;
  const creator = users.get(idOf(creatorId)) || actor;
  const self = idOf(assignee) === idOf(creatorId);
  const due = task.dueDate ? `Due ${formatDeadline(task.dueDate)}.` : "No deadline set.";
  await deliver({
    user: assignee, task, actor, assignee, creator,
    type: "task_assigned",
    emailTemplate: self ? "task-self-created" : "task-assigned",
    title: self ? "You created a task" : "New task assigned to you",
    message: `${task.title}. ${due}`,
    priority: task.priority === "urgent" ? "high" : "medium",
  });
  await Task.updateOne({ _id: task._id }, { $set: { "alerts.assignedAt": new Date() } });
  logger.info("task_assigned_notified", { taskId: String(task._id), self, reassigned: Boolean(reassignedFrom) });
}

const onTaskCreated = (task, actor) => notifyAssigned(task, actor).catch((error) => logger.error("task_assigned_notify_failed", { error }));

// A task was edited: a new assignee is told; a moved deadline or new assignee re-arms the reminders.
async function onTaskUpdated(task, previous, actor) {
  try {
    const reassigned = idOf(task.assignedTo) !== idOf(previous?.assignedTo);
    const deadlineMoved = new Date(task.dueDate || 0).getTime() !== new Date(previous?.dueDate || 0).getTime();
    if (reassigned || deadlineMoved) {
      await Task.updateOne({ _id: task._id }, { $unset: { "alerts.dueSoonAt": 1, "alerts.overdueAt": 1 } });
    }
    if (reassigned) await notifyAssigned(task, actor, { reassignedFrom: previous?.assignedTo });
  } catch (error) {
    logger.error("task_update_notify_failed", { error });
  }
}

// Claim a stage for a task; false when another sweep already took it (or the task changed meanwhile).
async function claim(task, field, extra = {}) {
  const result = await Task.updateOne({ _id: task._id, status: OPEN, [`alerts.${field}`]: null, ...extra }, { $set: { [`alerts.${field}`]: new Date() } });
  return result.modifiedCount === 1;
}

async function alertStage(task, users, now, stage) {
  const assignee = users.get(idOf(task.assignedTo));
  if (!assignee) return 0;
  const creatorId = task.assignedBy;
  const creator = users.get(idOf(creatorId));
  const selfAssigned = !creatorId || idOf(creatorId) === idOf(task.assignedTo);
  const soon = stage === "dueSoon";
  let sent = 0;

  await deliver({
    user: assignee, task, assignee, creator, now,
    type: soon ? "task_reminder" : "task_overdue",
    emailTemplate: soon ? "task-deadline-reminder" : "task-overdue",
    title: soon ? "Task deadline approaching" : "Task overdue",
    message: soon
      ? `${task.title} is due ${timeLeft(task.dueDate, now)}. Please complete it now.`
      : `${task.title} was due ${formatDeadline(task.dueDate)} and is not finished.`,
    priority: "high",
  });
  sent += 1;

  if (!selfAssigned && creator) {
    await deliver({
      user: creator, task, assignee, creator, now,
      type: soon ? "task_reminder" : "task_overdue",
      emailTemplate: soon ? "task-deadline-creator" : "task-overdue-creator",
      title: soon ? "Assigned task nearing its deadline" : "Assigned task overdue",
      message: soon
        ? `${nameOf(assignee) || "The assignee"} has not completed "${task.title}", due ${timeLeft(task.dueDate, now)}.`
        : `"${task.title}" assigned to ${nameOf(assignee) || "the assignee"} passed its deadline without being completed.`,
      priority: "high",
    });
    sent += 1;
  }
  return sent;
}

// One pass over open tasks. Safe to run as often as you like; each stage fires once per task and deadline.
async function runDeadlineSweep({ now = new Date() } = {}) {
  if (!enabled()) return { enabled: false };
  const result = { dueSoon: 0, overdue: 0, notices: 0 };

  const stages = [
    ["dueSoon", { dueDate: { $gt: now, $lte: new Date(now.getTime() + DUE_SOON_HOURS * HOUR_MS) }, "alerts.dueSoonAt": null }],
    ["overdue", { dueDate: { $lte: now, $gte: new Date(now.getTime() - OVERDUE_LOOKBACK_HOURS * HOUR_MS) }, "alerts.overdueAt": null }],
  ];
  for (const [stage, window] of stages) {
    const tasks = await Task.find({ status: OPEN, assignedTo: { $ne: null }, ...window })
      .sort({ dueDate: 1 })
      .limit(SWEEP_BATCH)
      .populate("caseId", "caseNumber clientName")
      .lean();
    if (!tasks.length) continue;
    const users = await loadUsers(tasks.flatMap((task) => [task.assignedTo, task.assignedBy]));
    for (const task of tasks) {
      try {
        if (!(await claim(task, stage === "dueSoon" ? "dueSoonAt" : "overdueAt", { dueDate: task.dueDate }))) continue;
        // A task that is already past due when first seen skips the "approaching" notice: it is now simply overdue.
        if (stage === "overdue") await Task.updateOne({ _id: task._id, "alerts.dueSoonAt": null }, { $set: { "alerts.dueSoonAt": now } });
        result.notices += await alertStage(task, users, now, stage);
        result[stage] += 1;
      } catch (error) {
        logger.error("task_deadline_alert_failed", { taskId: String(task._id), stage, error: error.message });
      }
    }
  }
  return result;
}

module.exports = { notifyAssigned, onTaskCreated, onTaskUpdated, runDeadlineSweep, DUE_SOON_HOURS };
