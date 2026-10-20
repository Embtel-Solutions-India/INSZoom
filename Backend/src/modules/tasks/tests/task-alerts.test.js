// Task notifications: assignment, deadline-near and deadline-passed. Uses the local isolated test database only (test-utils/db.js) and removes
// every user and task it creates. The notification service is replaced by a recorder, so nothing is pushed or emailed.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const notificationPath = require.resolve("../../notifications/notification.service");
const sent = [];
require.cache[notificationPath] = { id: notificationPath, filename: notificationPath, loaded: true, exports: { createNotification: async (payload) => { sent.push(payload); return payload; } } };

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Task = require("../../../models/Task");
const User = require("../../../models/User");
const alerts = require("../task-alerts.service");
const templates = require("../../email/templates/task-alerts");

const HOUR = 60 * 60 * 1000;
const userIds = [];
const taskIds = [];
const makeUser = async (name, role) => {
  const _id = new mongoose.Types.ObjectId();
  await User.collection.insertOne({ _id, name, email: `${name.toLowerCase()}.${_id}@example.test`, role, isActive: true });
  userIds.push(_id);
  return { _id, name, role };
};
const makeTask = async (fields) => {
  const task = await Task.create({ title: "Prepare filing", priority: "high", status: "assigned", ...fields });
  taskIds.push(task._id);
  return task;
};
const cleanup = async () => {
  await Task.deleteMany({ _id: { $in: taskIds } });
  await User.collection.deleteMany({ _id: { $in: userIds } });
};
const forTask = (task) => sent.filter((item) => String(item.taskId) === String(task._id));

test("emails: every task template renders its details and escapes typed text", () => {
  const data = { recipientName: "Asha", taskTitle: "<b>Review</b> I-129", taskDescription: "Check <script>", priority: "High", dueDate: "Oct 22, 2026, 5:00 PM IST", timeLeft: "in 2 days", assigneeName: "Asha", creatorName: "Ravi", caseLabel: "B399 - Michelle", portalLink: "https://admin.immiglance.com/tasks/1" };
  Object.values(templates).filter((tpl) => tpl.key).forEach((tpl) => {
    const html = tpl.bodyLines(data).join("\n");
    assert.ok(tpl.subject(data).length > 5, tpl.key);
    assert.ok(html.includes("Oct 22, 2026"), `${tpl.key} shows the deadline`);
    assert.ok(html.includes("https://admin.immiglance.com/tasks/1"), `${tpl.key} links to the task`);
    assert.ok(!html.includes("<script>") && !html.includes("<b>Review"), `${tpl.key} escapes typed text`);
  });
  assert.match(templates.assigned.bodyLines(data).join(""), /Ravi/);
  assert.match(templates.dueSoonCreator.bodyLines(data).join(""), /Asha/);
});

test("DB: assignment tells the assignee by push + email; a task created for yourself says so", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  sent.length = 0;
  const lead = await makeUser("Lead", "team_lead");
  const junior = await makeUser("Junior", "case_manager");

  const forJunior = await makeTask({ assignedTo: junior._id, assignedBy: lead._id, dueDate: new Date(Date.now() + 5 * 24 * HOUR) });
  await alerts.onTaskCreated(forJunior, lead);
  const [assigned] = forTask(forJunior);
  assert.equal(forTask(forJunior).length, 1, "only the assignee is told at creation");
  assert.equal(String(assigned.userId), String(junior._id));
  assert.equal(assigned.emailTemplate, "task-assigned");
  assert.ok(assigned.channels.includes("push") && assigned.channels.includes("in_app"));
  assert.equal(assigned.emailData.creatorName, "Lead");
  assert.equal(assigned.link, `/tasks/${forJunior._id}`);

  const forSelf = await makeTask({ assignedTo: lead._id, assignedBy: lead._id });
  await alerts.onTaskCreated(forSelf, lead);
  assert.equal(forTask(forSelf)[0].emailTemplate, "task-self-created");
});

test("DB: due within 2 days -> assignee AND creator once; passed -> both once; self-created -> only that person; done / old tasks ignored", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  sent.length = 0;
  const lead = await makeUser("Lead", "team_lead");
  const junior = await makeUser("Junior", "case_manager");
  const now = new Date();

  const soon = await makeTask({ assignedTo: junior._id, assignedBy: lead._id, dueDate: new Date(now.getTime() + 20 * HOUR) });
  const soonSelf = await makeTask({ assignedTo: junior._id, assignedBy: junior._id, dueDate: new Date(now.getTime() + 30 * HOUR) });
  const far = await makeTask({ assignedTo: junior._id, assignedBy: lead._id, dueDate: new Date(now.getTime() + 6 * 24 * HOUR) });
  const done = await makeTask({ assignedTo: junior._id, assignedBy: lead._id, status: "completed", dueDate: new Date(now.getTime() + 10 * HOUR) });
  const late = await makeTask({ assignedTo: junior._id, assignedBy: lead._id, dueDate: new Date(now.getTime() - 2 * HOUR) });
  const lateSelf = await makeTask({ assignedTo: junior._id, assignedBy: junior._id, dueDate: new Date(now.getTime() - 3 * HOUR) });
  const ancient = await makeTask({ assignedTo: junior._id, assignedBy: lead._id, dueDate: new Date(now.getTime() - 10 * 24 * HOUR) });

  await alerts.runDeadlineSweep({ now });
  const who = (task) => forTask(task).map((item) => `${String(item.userId) === String(junior._id) ? "junior" : "lead"}:${item.emailTemplate}`).sort();
  assert.deepEqual(who(soon), ["junior:task-deadline-reminder", "lead:task-deadline-creator"]);
  assert.deepEqual(who(soonSelf), ["junior:task-deadline-reminder"]);
  assert.deepEqual(who(far), []);
  assert.deepEqual(who(done), []);
  assert.deepEqual(who(late), ["junior:task-overdue", "lead:task-overdue-creator"]);
  assert.deepEqual(who(lateSelf), ["junior:task-overdue"]);
  assert.deepEqual(who(ancient), [], "long-overdue tasks are not emailed about after the fact");
  assert.ok(forTask(soon)[0].channels.includes("push"));

  const before = sent.length;
  await alerts.runDeadlineSweep({ now: new Date(now.getTime() + 60 * 1000) });
  assert.equal(sent.length, before, "a second sweep sends nothing new");

  // the deadline passes for the 'soon' task: it is now overdue and both people hear it once
  await alerts.runDeadlineSweep({ now: new Date(now.getTime() + 21 * HOUR) });
  assert.deepEqual(who(soon).filter((entry) => entry.includes("overdue")), ["junior:task-overdue", "lead:task-overdue-creator"]);
});

test("DB: moving the deadline (or reassigning) re-arms the reminders and tells a new assignee", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  sent.length = 0;
  const lead = await makeUser("Lead", "team_lead");
  const junior = await makeUser("Junior", "case_manager");
  const other = await makeUser("Other", "case_manager");
  const now = new Date();
  const task = await makeTask({ assignedTo: junior._id, assignedBy: lead._id, dueDate: new Date(now.getTime() + 10 * HOUR) });
  await alerts.runDeadlineSweep({ now });
  assert.equal(forTask(task).length, 2);

  const previous = await Task.findById(task._id);
  const moved = await Task.findByIdAndUpdate(task._id, { dueDate: new Date(now.getTime() + 15 * HOUR), assignedTo: other._id }, { new: true });
  await alerts.onTaskUpdated(moved, previous, lead);
  const cleared = await Task.findById(task._id).lean();
  assert.ok(!cleared.alerts?.dueSoonAt && !cleared.alerts?.overdueAt);
  assert.equal(forTask(task).filter((item) => item.emailTemplate === "task-assigned" && String(item.userId) === String(other._id)).length, 1);
  await alerts.runDeadlineSweep({ now });
  assert.equal(forTask(task).filter((item) => item.emailTemplate === "task-deadline-reminder").length, 2, "the new assignee is reminded for the new deadline");
});
