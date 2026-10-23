const assert = require("node:assert/strict");
const mock = require("node:test").mock;
const test = require("node:test");

const Case = require("../../../models/Case");
const Task = require("../../../models/Task");
const notificationService = require("../../notifications/notification.service");
const workflowService = require("../workflow.service");

// Tasks are created only by a person on the Tasks page. A workflow's "create_task" step must notify the person, never create a Task.
test("a workflow create_task action sends a notification and creates no Task", async (t) => {
  const managerId = "64b000000000000000000001";
  const caseId = "64b000000000000000000002";
  const caseData = { _id: caseId, assignedCaseManager: managerId, timeline: [], save: async () => {} };
  t.mock.method(Case, "findById", async () => caseData);
  const created = t.mock.method(Task, "create", async () => { throw new Error("a workflow must not create a Task"); });
  const sent = [];
  t.mock.method(notificationService, "createNotification", async (payload) => { sent.push(payload); return payload; });

  const workflow = { name: "Case lifecycle", caseId, executions: [], metrics: { notificationsSent: 0, tasksCreated: 0, actionsSucceeded: 0, actionsFailed: 0 }, context: {} };
  await workflowService.executeAction(workflow, { type: "create_task", config: { title: "Review questionnaire", assignTo: "case_manager", dueInHours: 24, priority: "high" } }, {}, null, null);

  assert.equal(created.mock.callCount(), 0);
  assert.equal(workflow.metrics.tasksCreated, 0);
  assert.equal(workflow.metrics.actionsFailed, 0);
  assert.equal(sent.length, 1);
  assert.equal(String(sent[0].userId), managerId);
  assert.equal(sent[0].link, `/cases/${caseId}`);
  assert.match(sent[0].message, /Review questionnaire/);
  assert.equal(workflow.executions[0].status, "succeeded");
  assert.equal(workflow.executions[0].output.taskId, undefined);
});
