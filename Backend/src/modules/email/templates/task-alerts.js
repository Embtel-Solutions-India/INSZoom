// Task emails: assignment, deadline-approaching and deadline-passed notices (modules/tasks/task-alerts.service.js).
// Every value arrives already formatted as text (dates, "in 2 days", names); the only work here is wording and HTML-escaping, because
// email.service injects these lines into the page as HTML and a task title / description is typed by a person.
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const NAVY = "#1e3a5f";
const RED = "#dc2626";

const button = (data, label, color = NAVY) =>
  `<a href="${escapeHtml(data.portalLink || "#")}" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">${label}</a>`;

// The task's details as one tidy box: title, priority, deadline, case and (when typed) the description.
function detailsBox(data, { accent = NAVY } = {}) {
  const row = (label, value) => (value ? `<tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 0;color:#111827;font-size:14px;">${escapeHtml(value)}</td></tr>` : "");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${accent};border-radius:8px;padding:14px 18px;margin:0 0 16px;width:100%;">
      ${row("Task", data.taskTitle)}
      ${row("Priority", data.priority)}
      ${row("Deadline", data.dueDate)}
      ${row("Assigned to", data.assigneeName)}
      ${row("Assigned by", data.creatorName)}
      ${row("Case", data.caseLabel)}
      ${row("Details", data.taskDescription)}
    </table>`;
}

const hi = (data) => `Hi ${escapeHtml(data.recipientName || "there")},`;

const assigned = {
  key: "task-assigned",
  subject: (data = {}) => `New task assigned to you: ${data.taskTitle || "Task"}`,
  bodyLines: (data = {}) => [
    hi(data),
    `<strong>${escapeHtml(data.creatorName || "A colleague")}</strong> has assigned a new task to you. Here is what is needed and by when:`,
    detailsBox(data),
    "Please plan your time so it is finished before the deadline, and mark it complete once it is done.",
    button(data, "Open Task"),
  ],
};

const selfCreated = {
  key: "task-self-created",
  subject: (data = {}) => `You created a task: ${data.taskTitle || "Task"}`,
  bodyLines: (data = {}) => [
    hi(data),
    "You added a task for yourself. It is saved with the details below.",
    detailsBox(data),
    "We will remind you two days before the deadline if it is still open.",
    button(data, "Open Task"),
  ],
};

const dueSoon = {
  key: "task-deadline-reminder",
  subject: (data = {}) => `Deadline approaching: ${data.taskTitle || "Task"} (${data.timeLeft || "soon"})`,
  bodyLines: (data = {}) => [
    hi(data),
    `<p style="color:${RED};font-weight:700;font-size:16px;margin:0 0 16px;">Your task is due ${escapeHtml(data.timeLeft || "soon")} and is not marked complete.</p>`,
    detailsBox(data, { accent: "#d97706" }),
    "Please finish it now and mark it complete. If you cannot make the deadline, tell the person who assigned it as early as you can.",
    button(data, "Complete Task"),
  ],
};

const dueSoonCreator = {
  key: "task-deadline-creator",
  subject: (data = {}) => `Assigned task nearing its deadline: ${data.taskTitle || "Task"}`,
  bodyLines: (data = {}) => [
    hi(data),
    `The task you assigned to <strong>${escapeHtml(data.assigneeName || "a team member")}</strong> is due ${escapeHtml(data.timeLeft || "soon")} and has not been completed yet.`,
    detailsBox(data, { accent: "#d97706" }),
    "They have been reminded. You may want to check in with them or move the deadline if the work needs more time.",
    button(data, "View Task"),
  ],
};

const overdue = {
  key: "task-overdue",
  subject: (data = {}) => `Task overdue: ${data.taskTitle || "Task"}`,
  bodyLines: (data = {}) => [
    hi(data),
    `<p style="color:${RED};font-weight:700;font-size:16px;margin:0 0 16px;">The deadline for your task has passed and it is still not finished.</p>`,
    detailsBox(data, { accent: RED }),
    "Please complete it as soon as possible and mark it complete. If something is blocking you, let the person who assigned it know.",
    button(data, "Complete Task", RED),
  ],
};

const overdueCreator = {
  key: "task-overdue-creator",
  subject: (data = {}) => `Assigned task overdue: ${data.taskTitle || "Task"}`,
  bodyLines: (data = {}) => [
    hi(data),
    `<p style="color:${RED};font-weight:700;font-size:16px;margin:0 0 16px;">A task you assigned to ${escapeHtml(data.assigneeName || "a team member")} has passed its deadline without being completed.</p>`,
    detailsBox(data, { accent: RED }),
    "They have been told it is overdue. Please follow up, extend the deadline, or reassign the task if needed.",
    button(data, "View Task", RED),
  ],
};

module.exports = { assigned, selfCreated, dueSoon, dueSoonCreator, overdue, overdueCreator, escapeHtml };
