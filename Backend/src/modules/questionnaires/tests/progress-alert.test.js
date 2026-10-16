// Save progress / Submit -> email + push to the case's case manager(s) AND team lead only (never admins or other team leads),
// naming the person who acted (name, registered email, party on the case) and the questions answered.
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const Answer = require("../../../models/Answer");
const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const EmailLog = require("../../../models/EmailLog");
const emailService = require("../../email/email.service");
const notificationService = require("../../notifications/notification.service");
const triggerRegistry = require("../../email/emailTriggers.registry");
const savedTemplate = require("../../email/templates/questionnaire-progress-saved");
const submittedTemplate = require("../../email/templates/questionnaire-submitted-team");
const { notifyProgressSaved, notifySubmitted, fillerLabel } = require("../progress-alert.service");

const CM = { _id: "cm-1", name: "Sarah Johnson", email: "cm@example.com", role: "case_manager", isActive: true };
const TL = { _id: "tl-1", name: "Akash", email: "tl@example.com", role: "team_lead", isActive: true };
const DEFAULT_TL = { _id: "dtl-1", name: "Default Lead", email: "teamlead@immiglance.com", role: "team_lead", isActive: true };
const ADMIN = { _id: "ad-1", name: "Admin", email: "admin@example.com", role: "admin", isActive: true };
const EMPLOYER = { _id: "u-emp", name: "Acme HR", email: "hr@acme-corp.com", role: "client" };
const CASE = { _id: "case-1", caseNumber: "B195", visaType: "O-1B", user: "u-emp", caseStructure: "employer_employee", caseRole: "principal", assignedCaseManager: "cm-1", assignedTeamLead: "tl-1", createdBy: "tl-1", petitionerName: "Acme Inc" };
const ANSWERS = [
  { question: "q1", questionnaire: "z1", value: "Acme Inc" },
  { question: "q2", questionnaire: "z1", value: "" },
  { question: "q3", questionnaire: "z1", files: [{ originalName: "ein.pdf" }] },
];

function harness(t, { caseDoc = CASE, users = [CM, TL], answers = ANSWERS, defaultLead = DEFAULT_TL } = {}) {
  t.after(() => { mock.restoreAll(); delete mongoose.connection.readyState; });
  Object.defineProperty(mongoose.connection, "readyState", { get: () => 1, configurable: true }); // the team-lead fallbacks look users up
  const emails = [];
  const pushes = [];
  const chain = (value) => { const query = { select: () => query, sort: () => query, limit: () => query, lean: async () => value }; return query; };
  mock.method(Case, "findById", () => chain(caseDoc));
  mock.method(User, "find", () => chain(users));
  // creator-is-a-team-lead lookup (by _id) and the default team lead lookup (by email)
  mock.method(User, "findOne", (query) => chain(query.email ? defaultLead : [TL].find((user) => user._id === query._id && query.role === "team_lead") || null));
  mock.method(Answer, "find", () => chain(answers));
  mock.method(Question, "find", () => chain([{ _id: "q1", label: "Employer legal name" }, { _id: "q3", label: "Employer EIN letter" }]));
  mock.method(Questionnaire, "find", () => chain([{ _id: "z1", title: "Employer Information Checklist" }]));
  mock.method(EmailLog, "findOne", () => chain(null));
  mock.method(emailService, "sendTemplateEmail", async (key, options) => { emails.push({ key, ...options }); return { sent: true }; });
  mock.method(notificationService, "createNotification", async (payload) => { pushes.push(payload); return { _id: "n" }; });
  return { emails, pushes };
}

test("Save progress emails AND pushes both the case manager and the team lead, naming the person and the answered questions", async (t) => {
  const { emails, pushes } = harness(t);
  const result = await notifyProgressSaved({ caseId: "case-1", checklistName: "Employer Information Checklist", completionPercentage: 41.6 }, EMPLOYER, {});
  assert.equal(result.sent, true);
  assert.deepEqual(emails.map((e) => e.to).sort(), ["cm@example.com", "tl@example.com"]);
  for (const email of emails) {
    assert.equal(email.key, "questionnaire-progress-saved");
    assert.equal(email.data.actorName, "Acme HR");
    assert.equal(email.data.actorEmail, "hr@acme-corp.com");
    assert.equal(email.data.actorRole, "Employer");
    assert.equal(email.data.caseNumber, "B195");
    assert.equal(email.data.completionPercentage, 42);
    assert.deepEqual(email.data.answeredGroups, [{ title: "Employer Information Checklist", labels: ["Employer legal name", "Employer EIN letter"] }], "blank answers are not listed");
  }
  assert.deepEqual(emails.map((e) => e.recipientRole).sort(), ["case_manager", "team_lead"]);
  assert.deepEqual(pushes.map((p) => p.userId).sort(), ["cm-1", "tl-1"]);
  assert.ok(pushes.every((p) => p.channels.includes("push") && p.link === "/crm-cases/case-1" && p.data.tag === "qa-case-1" && p.message.includes("hr@acme-corp.com")));
});

test("each party is named as exactly who they are: employee, petitioner, beneficiary", async (t) => {
  for (const [user, caseFields, expected] of [
    [{ _id: "u-e", name: "Jane Doe", email: "jane@x-mail.com", role: "employee" }, { employeeUser: "u-e" }, "Employee"],
    [{ _id: "u-p", name: "Pat Petitioner", email: "pat@x-mail.com", role: "client" }, { caseStructure: "family", petitionerUser: "u-p", user: "u-p" }, "Petitioner"],
    [{ _id: "u-b", name: "Bea Beneficiary", email: "bea@x-mail.com", role: "client" }, { caseStructure: "family", beneficiaryUser: "u-b", user: "u-b", petitionerUser: "u-p" }, "Beneficiary"],
  ]) {
    const { emails } = harness(t, { caseDoc: { ...CASE, caseStructure: "family", ...caseFields } });
    await notifySubmitted({ caseId: "case-1" }, user, {});
    assert.equal(emails[0].data.actorRole, expected);
    assert.equal(emails[0].data.actorName, user.name);
    assert.equal(emails[0].data.actorEmail, user.email);
    mock.restoreAll();
  }
});

test("Submit sends the submitted-team email and push to both; the already-covered case manager channels can be skipped", async (t) => {
  let h = harness(t);
  assert.equal((await notifySubmitted({ caseId: "case-1" }, EMPLOYER, {})).sent, true);
  assert.deepEqual(h.emails.map((e) => e.key), ["questionnaire-submitted-team", "questionnaire-submitted-team"]);
  assert.equal(h.pushes.length, 2);
  assert.ok(h.pushes.every((p) => p.type === "questionnaire_submitted"));
  mock.restoreAll();
  h = harness(t);
  await notifySubmitted({ caseId: "case-1", skipCaseManagerPush: true }, EMPLOYER, {});
  assert.deepEqual(h.pushes.map((p) => p.userId), ["tl-1"], "the case manager's push already came from the existing code path");
  assert.equal(h.emails.length, 2);
  mock.restoreAll();
  h = harness(t);
  await notifySubmitted({ caseId: "case-1", skipCaseManagerEmail: true, skipCaseManagerPush: true }, EMPLOYER, {});
  assert.deepEqual(h.emails.map((e) => e.to), ["tl@example.com"]);
});

test("the team lead is the case's own, else the creator (a team lead), else the default team lead teamlead@immiglance.com; never an admin", async (t) => {
  let h = harness(t, { caseDoc: { ...CASE, assignedTeamLead: null }, users: [CM, TL] });
  await notifyProgressSaved({ caseId: "case-1" }, EMPLOYER, {});
  assert.deepEqual(h.emails.map((e) => e.to).sort(), ["cm@example.com", "tl@example.com"], "creator (a team lead) is told when the case has no team lead");
  mock.restoreAll();
  // admin created it and named no team lead (also: GoHighLevel cases) -> the default team lead
  h = harness(t, { caseDoc: { ...CASE, assignedTeamLead: null, createdBy: "ad-1" }, users: [CM, DEFAULT_TL, ADMIN] });
  await notifyProgressSaved({ caseId: "case-1" }, EMPLOYER, {});
  assert.deepEqual(h.emails.map((e) => e.to).sort(), ["cm@example.com", "teamlead@immiglance.com"]);
  assert.deepEqual(h.pushes.map((p) => p.userId).sort(), ["cm-1", "dtl-1"]);
  mock.restoreAll();
  // an admin account sitting in the team-lead slot is not a team lead
  h = harness(t, { caseDoc: { ...CASE, assignedTeamLead: "ad-1", createdBy: "ad-1" }, users: [CM, ADMIN] });
  await notifyProgressSaved({ caseId: "case-1" }, EMPLOYER, {});
  assert.deepEqual(h.emails.map((e) => e.to), ["cm@example.com"]);
});

test("nothing is sent when staff act, nobody is assigned, or the user is unrelated to the case", async (t) => {
  let h = harness(t);
  assert.equal((await notifyProgressSaved({ caseId: "case-1" }, { _id: "cm-1", role: "case_manager" }, {})).reason, "staff_user");
  assert.equal((await notifySubmitted({ caseId: "case-1" }, { _id: "cm-1", role: "case_manager" }, {})).reason, "staff_user");
  assert.equal((await notifyProgressSaved({ caseId: "case-1" }, { _id: "someone", role: "client" }, {})).reason, "not_authorized");
  assert.equal(h.emails.length + h.pushes.length, 0);
  mock.restoreAll();
  h = harness(t, { users: [], defaultLead: null });
  assert.equal((await notifyProgressSaved({ caseId: "case-1" }, EMPLOYER, {})).reason, "no_recipients");
  assert.equal(h.emails.length + h.pushes.length, 0);
});

test("a failure never throws into the save/submit that triggered it", async (t) => {
  harness(t);
  mock.method(emailService, "sendTemplateEmail", async () => { throw new Error("smtp down"); });
  mock.method(notificationService, "createNotification", async () => { throw new Error("db down"); });
  assert.equal((await notifyProgressSaved({ caseId: "case-1" }, EMPLOYER, {})).sent, false);
  mock.method(Case, "findById", () => { throw new Error("db down"); });
  assert.deepEqual(await notifySubmitted({ caseId: "case-1" }, EMPLOYER, {}), { sent: false, reason: "error" });
});

test("who filled it in: employer, delegate, employee, employer-for-employee, client", () => {
  const principal = { user: "u-emp", delegateEmployerUser: "u-del" };
  assert.equal(fillerLabel({ caseStructure: "employer_employee", caseRole: "principal" }, null, { _id: "u-emp" }), "Employer");
  assert.equal(fillerLabel({ caseStructure: "employer_employee", caseRole: "principal", delegateEmployerUser: "u-del" }, null, { _id: "u-del" }), "Delegate employer");
  assert.equal(fillerLabel({ caseRole: "employee" }, principal, { _id: "u-staff-emp" }), "Employee");
  assert.equal(fillerLabel({ caseRole: "employee" }, principal, { _id: "u-emp" }), "Employer (filling in for the employee)");
  assert.equal(fillerLabel({ caseStructure: "single", caseRole: "principal" }, null, { _id: "u-1" }), "Client");
});

test("both emails are registered triggers; they lead with the person (name, email, role), keep the case number secondary and add no button of their own", () => {
  const saved = triggerRegistry.getTrigger("questionnaire-progress-saved");
  assert.ok(saved && triggerRegistry.getTrigger("questionnaire-submitted-team"));
  assert.equal(saved.cooldownMs, 30 * 60 * 1000);
  const data = { recipientName: "Akash", actorName: "Acme HR", actorEmail: "hr@acme-corp.com", actorRole: "Employer", caseNumber: "B195", visaType: "O-1B", checklistName: "Employer Information Checklist", completionPercentage: 0, answeredGroups: [{ title: "Employer Information Checklist", labels: ["Employer legal name", "<b>x</b>"] }], answeredMore: 3 };
  for (const template of [savedTemplate, submittedTemplate]) {
    const subject = template.subject(data);
    assert.ok(subject.startsWith("Acme HR ") && !subject.includes("B195"), `subject names the person, not the case: ${subject}`);
    const html = template.bodyLines(data).join(" ");
    assert.ok(html.includes("<strong>Acme HR</strong> (hr@acme-corp.com) - Employer"));
    assert.ok(html.includes("Case: <strong>B195</strong>") && html.includes("Employer legal name") && html.includes("and 3 more"));
    assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"), "question labels are escaped");
    assert.ok(!/<a\b/i.test(html), "the only button is the Log in to Admin one added by the mailer");
  }
  assert.ok(savedTemplate.bodyLines(data).join(" ").includes("Current completion: 0%"));
  assert.ok(submittedTemplate.bodyLines(data).join(" ").includes("These documents have been submitted by the client"));
  // the editor's token proxy hands templates plain strings / missing data - must not throw
  assert.doesNotThrow(() => submittedTemplate.bodyLines({ answeredGroups: "", answeredMore: "" }));
  assert.doesNotThrow(() => savedTemplate.subject({}));
});
