// The SLA-breach alerts are paused on every channel (bell, live pop-up, browser push, e-mail) - and one environment value reopens them. DB-free: the pause is decided before anything is read or written.
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("../notification.service");

test("the SLA-breach alert type is paused by default: createNotification returns null and touches nothing", async () => {
  delete process.env.NOTIFICATIONS_PAUSED_TYPES;
  assert.equal(service.isPausedNotificationType("workflow_sla_breached"), true);
  for (const payload of [
    { type: "workflow_sla_breached", userId: "u1", caseId: "c1", title: "Case escalated", channels: ["in_app", "socket", "push", "email"], emailTemplate: "case.escalated:team_lead" },
    { type: "workflow_sla_breached", userId: "u2", title: "Case SLA breached" },
    { type: "workflow_sla_breached", title: "Workflow SLA Breached" },
  ]) assert.equal(await service.createNotification(payload), null);
});

test("other alert types are not paused", () => {
  delete process.env.NOTIFICATIONS_PAUSED_TYPES;
  for (const type of ["document_uploaded", "case_updated", "message", "task_assigned", undefined, ""]) assert.equal(service.isPausedNotificationType(type), false);
});

test("NOTIFICATIONS_PAUSED_TYPES reopens (empty) or changes the paused list without a code change", () => {
  process.env.NOTIFICATIONS_PAUSED_TYPES = "";
  try {
    assert.equal(service.isPausedNotificationType("workflow_sla_breached"), false);
    process.env.NOTIFICATIONS_PAUSED_TYPES = "workflow_sla_breached, other_type";
    assert.equal(service.isPausedNotificationType("other_type"), true);
    assert.equal(service.isPausedNotificationType("workflow_sla_breached"), true);
  } finally { delete process.env.NOTIFICATIONS_PAUSED_TYPES; }
});
