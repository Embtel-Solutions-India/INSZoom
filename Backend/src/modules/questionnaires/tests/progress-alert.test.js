// Save progress -> one email to the case's assigned case manager only (never admins), throttled, on its own trigger.
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const emailService = require("../../email/email.service");
const triggerRegistry = require("../../email/emailTriggers.registry");
const template = require("../../email/templates/questionnaire-progress-saved");
const { notifyProgressSaved, fillerLabel } = require("../progress-alert.service");

const CM = { _id: "cm-1", name: "Sarah Johnson", email: "cm@example.com", role: "case_manager", isActive: true };
const EMPLOYER = { _id: "u-emp", name: "Acme HR", role: "client" };
const CASE = { _id: "case-1", caseNumber: "B195", visaType: "O-1B", user: "u-emp", caseStructure: "employer_employee", caseRole: "principal", assignedCaseManager: "cm-1", petitionerName: "Acme Inc" };

function harness(t, { caseDoc = CASE, manager = CM } = {}) {
  t.after(() => mock.restoreAll());
  const sent = [];
  const query = (value) => ({ select: () => ({ lean: async () => value }) });
  mock.method(Case, "findById", () => query(caseDoc));
  mock.method(User, "findById", () => query(manager));
  mock.method(emailService, "sendTemplateEmail", async (key, options) => { sent.push({ key, ...options }); return { sent: true }; });
  return sent;
}

test("Save progress emails the assigned case manager, naming who filled what", async (t) => {
  const sent = harness(t);
  const result = await notifyProgressSaved({ caseId: "case-1", checklistName: "Employer Information Checklist", completionPercentage: 41.6 }, EMPLOYER, {});
  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, "questionnaire-progress-saved");
  assert.equal(sent[0].to, "cm@example.com");
  assert.equal(sent[0].recipientRole, "case_manager");
  assert.equal(sent[0].data.filledBy, "Employer");
  assert.equal(sent[0].data.clientName, "Acme HR");
  assert.equal(sent[0].data.caseNumber, "B195");
  assert.equal(sent[0].data.completionPercentage, 42);
});

test("nothing is sent when staff save, when no case manager is assigned, or for an unrelated user", async (t) => {
  let sent = harness(t);
  assert.equal((await notifyProgressSaved({ caseId: "case-1" }, { _id: "cm-1", role: "case_manager" }, {})).sent, false);
  assert.equal((await notifyProgressSaved({ caseId: "case-1" }, { _id: "someone", role: "client" }, {})).reason, "not_authorized");
  assert.equal(sent.length, 0);
  mock.restoreAll();
  sent = harness(t, { caseDoc: { ...CASE, assignedCaseManager: null } });
  assert.equal((await notifyProgressSaved({ caseId: "case-1" }, EMPLOYER, {})).reason, "no_case_manager");
  mock.restoreAll();
  sent = harness(t, { manager: { ...CM, role: "admin" } });
  assert.equal((await notifyProgressSaved({ caseId: "case-1" }, EMPLOYER, {})).reason, "no_case_manager", "administrators are never emailed");
  assert.equal(sent.length, 0);
});

test("a failure never throws into the save that triggered it", async (t) => {
  harness(t);
  mock.method(emailService, "sendTemplateEmail", async () => { throw new Error("smtp down"); });
  const result = await notifyProgressSaved({ caseId: "case-1" }, EMPLOYER, {});
  assert.deepEqual(result, { sent: false, reason: "error" });
});

test("who filled it in: employer, delegate, employee, employer-for-employee, client", () => {
  const principal = { user: "u-emp", delegateEmployerUser: "u-del" };
  assert.equal(fillerLabel({ caseStructure: "employer_employee", caseRole: "principal" }, null, { _id: "u-emp" }), "Employer");
  assert.equal(fillerLabel({ caseStructure: "employer_employee", caseRole: "principal", delegateEmployerUser: "u-del" }, null, { _id: "u-del" }), "Delegate employer");
  assert.equal(fillerLabel({ caseRole: "employee" }, principal, { _id: "u-staff-emp" }), "Employee");
  assert.equal(fillerLabel({ caseRole: "employee" }, principal, { _id: "u-emp" }), "Employer (filling in for the employee)");
  assert.equal(fillerLabel({ caseStructure: "single", caseRole: "principal" }, null, { _id: "u-1" }), "Client");
});

test("the email is a registered trigger on the Email Templates page, with a 30-minute cooldown, and renders", () => {
  const trigger = triggerRegistry.getTrigger("questionnaire-progress-saved");
  assert.ok(trigger, "registered so it appears on the Email Templates page");
  assert.equal(trigger.label, "Questionnaire Progress Saved (Case Manager)");
  assert.equal(trigger.cooldownMs, 30 * 60 * 1000);
  assert.equal(trigger.audience, "case_manager");
  const lines = template.bodyLines({ caseManagerName: "Sarah", clientName: "Acme HR", filledBy: "Employer", caseNumber: "B195", checklistName: "Employer Information Checklist", completionPercentage: 0, portalLink: "https://x/y" });
  assert.ok(lines.join(" ").includes("Acme HR") && lines.join(" ").includes("Employer Information Checklist"));
  assert.ok(lines.some((line) => line.includes("Current completion: 0%")));
  assert.match(template.subject({ caseNumber: "B195", filledBy: "Employer" }), /Employer saved progress on case B195/);
});
