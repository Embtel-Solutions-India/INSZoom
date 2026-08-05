const assert = require("node:assert/strict");
const { test } = require("node:test");

const Task = require("../../../models/Task");
const WorkflowTemplate = require("../../../models/WorkflowTemplate");
const { DEFAULT_CASE_WORKFLOW_TEMPLATE } = require("../workflow.defaults");

test("task schema supports enterprise workflow assignment and SLA metadata", () => {
  const paths = Task.schema.paths;
  assert.ok(paths.assignedTeam, "assigned team is available for team-based routing");
  assert.ok(paths.assignedRole, "assigned role is available for role-based routing");
  assert.ok(paths.department, "department is available for operational routing");
  assert.ok(paths["sla.warningAt"], "SLA warning deadline is tracked");
  assert.ok(paths["sla.breachedAt"], "SLA breach deadline is tracked");
  assert.ok(paths["escalation.level"], "escalation level is tracked");
  assert.ok(paths.completionHistory, "completion history is retained");
  assert.ok(paths.attachments, "task attachments are retained");
});

test("workflow template schema accepts automation actions used by default rules", () => {
  const actionEnum = WorkflowTemplate.schema.path("transitions.actions.type").enumValues;
  // updated: assign_attorney removed — no default rule assigns an attorney
  // (attorney collaboration descoped), so it's no longer a supported action type.
  for (const action of ["create_task", "notify", "assign_case_manager", "set_case_status", "trigger_ocr", "wait"]) {
    assert.ok(actionEnum.includes(action), `${action} action is supported`);
  }
});

test("default lifecycle template contains configurable operational events", () => {
  for (const event of ["case.created", "payment.completed", "payment.failed", "document.uploaded", "document.rejected", "uscis.form.generated", "uscis.form.approved", "pdf.generated", "pdf.approved", "rfe.received"]) {
    assert.ok(DEFAULT_CASE_WORKFLOW_TEMPLATE.triggers.includes(event), `${event} trigger is configured`);
    assert.ok(DEFAULT_CASE_WORKFLOW_TEMPLATE.transitions.some((transition) => transition.event === event), `${event} transition is configured`);
  }
});
