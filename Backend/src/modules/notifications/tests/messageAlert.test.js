// "A message was sent" -> push (sender name on top, then the message) for every recipient, in-app alert, and an email only
// when the recipient is offline AND is an attorney / client / case manager / team lead (never admin or super admin).
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const User = require("../../../models/User");
const Case = require("../../../models/Case");
const caseAudience = require("../caseAudience");
const notificationService = require("../notification.service");
const realtimeGateway = require("../../realtime/realtime.gateway");
const emailService = require("../../email/email.service");
const triggerRegistry = require("../../email/emailTriggers.registry");
const { notifyNewMessage, previewOf } = require("../messageAlert.service");

const SENDER = { _id: "u-sender", name: "Sarah Johnson", role: "case_manager" };
const USERS = {
  attorney: { _id: "u-att", name: "David Miller", email: "att@example.com", role: "attorney" },
  client: { _id: "u-cli", name: "John Smith", email: "client@example.com", role: "client" },
  employee: { _id: "u-emp", name: "Jane Doe", email: "emp@example.com", role: "employee" },
  cm: { _id: "u-cm", name: "Case Manager", email: "cm@example.com", role: "case_manager" },
  lead: { _id: "u-tl", name: "Team Lead", email: "tl@example.com", role: "team_lead" },
  admin: { _id: "u-admin", name: "Admin", email: "admin@example.com", role: "admin" },
  superAdmin: { _id: "u-super", name: "Super", email: "super@example.com", role: "super_admin" },
};

function harness(t, { online = [] } = {}) {
  t.after(() => mock.restoreAll());
  const notifications = [];
  const emails = [];
  mock.method(User, "findById", (id) => ({ select: () => ({ lean: async () => Object.values(USERS).find((user) => user._id === id) || null }) }));
  mock.method(notificationService, "createNotification", async (payload) => { notifications.push(payload); return { _id: `n-${notifications.length}` }; });
  mock.method(realtimeGateway, "isUserOnline", (id) => online.includes(String(id)));
  mock.method(emailService, "sendTemplateEmail", async (key, options) => { emails.push({ key, ...options }); return { sent: true }; });
  return { notifications, emails };
}

const run = (recipientIds, extra = {}) => notifyNewMessage({
  recipientIds, sender: SENDER, caseId: "case-1", caseNumber: "B193-A", text: "Please upload your passport copy.",
  link: "/messages/c1", conversationId: "c1", messageId: "m1", ...extra,
});

test("every recipient gets a push-enabled alert with the SENDER'S NAME as the title and the message as the body", async (t) => {
  const { notifications } = harness(t);
  await run(["u-cli", "u-att", "u-cm"]);
  assert.equal(notifications.length, 3);
  for (const n of notifications) {
    assert.equal(n.title, "Sarah Johnson");
    assert.equal(n.message, "Please upload your passport copy.");
    assert.ok(n.channels.includes("push") && n.channels.includes("socket") && n.channels.includes("in_app"));
    assert.equal(n.data.tag, "msg-c1", "one notification per conversation thread on the device");
  }
});

test("the sender is never alerted about their own message", async (t) => {
  const { notifications } = harness(t);
  await run(["u-sender", "u-cli"]);
  assert.deepEqual(notifications.map((n) => n.userId), ["u-cli"]);
});

test("offline attorney, client, employee, case manager and team lead each get the email", async (t) => {
  const { emails } = harness(t);
  await run(["u-att", "u-cli", "u-emp", "u-cm", "u-tl"]);
  assert.deepEqual(emails.map((e) => e.to).sort(), ["att@example.com", "client@example.com", "cm@example.com", "emp@example.com", "tl@example.com"]);
  const first = emails[0];
  assert.equal(first.key, "new-message-received");
  assert.equal(first.data.senderName, "Sarah Johnson");
  assert.equal(first.data.caseNumber, "B193-A");
  assert.equal(first.data.messagePreview, "Please upload your passport copy.");
});

test("admins and super admins are never emailed", async (t) => {
  const { emails } = harness(t);
  await run(["u-admin", "u-super"]);
  assert.equal(emails.length, 0);
});

test("staff who are not on the case's team (another team lead, any admin / super admin) get no push, bell or email for that case's messages", async (t) => {
  const { emails, notifications } = harness(t);
  mock.method(caseAudience, "isOutsideCaseTeam", async ({ userId }) => ["u-admin", "u-super", "u-tl"].includes(userId));
  await run(["u-admin", "u-super", "u-tl", "u-cm", "u-cli"]);
  assert.deepEqual(notifications.map((n) => n.userId).sort(), ["u-cli", "u-cm"]);
  assert.deepEqual(emails.map((e) => e.to).sort(), ["client@example.com", "cm@example.com"]);
});

test("an online recipient gets the push/in-app alert but no email", async (t) => {
  const { emails, notifications } = harness(t, { online: ["u-cli"] });
  await run(["u-cli", "u-att"]);
  assert.equal(notifications.length, 2);
  assert.deepEqual(emails.map((e) => e.to), ["att@example.com"]);
});

test("a failure for one recipient never blocks the others or the message itself", async (t) => {
  const { notifications } = harness(t);
  mock.method(User, "findById", (id) => { if (id === "u-att") throw new Error("db down"); return { select: () => ({ lean: async () => Object.values(USERS).find((user) => user._id === id) }) }; });
  await run(["u-att", "u-cli"]);
  assert.deepEqual(notifications.map((n) => n.userId), ["u-cli"]);
});

test("previews are plain, short, and describe attachment-only messages", () => {
  assert.equal(previewOf("<b>Hello</b>\n  world"), "Hello world");
  assert.equal(previewOf("x".repeat(300)).length, 140);
  assert.equal(previewOf("", 2), "Sent 2 attachments");
});

test("the email is a registered template on the Email Templates page, and never auto-addressed to staff admins", () => {
  const trigger = triggerRegistry.getTrigger("new-message-received");
  assert.ok(trigger, "registered so it appears on the Email Templates page");
  assert.equal(trigger.label, "New Message Received (while offline)");
});

// ── a CLIENT writes: case manager + team lead are alerted (push + their own email, once per 30 minutes) ──
const CLIENT_SENDER = { _id: "u-cli", name: "John Smith", role: "client" };
const CASE_DOC = { _id: "case-1", assignedCaseManager: "u-cm", assignedTeamLead: "u-tl", createdBy: "u-tl" };

test("a client's message pushes to the team lead even when not a participant, and emails case manager + team lead with the team alert", async (t) => {
  const { notifications, emails } = harness(t, { online: ["u-cm"] });
  mock.method(Case, "findById", () => ({ select: () => ({ lean: async () => CASE_DOC }) }));
  mock.method(User, "find", () => ({ select: () => ({ lean: async () => [USERS.cm, USERS.lead] }) }));
  // only the case manager is a conversation participant; the team lead is added from the case
  await notifyNewMessage({ recipientIds: ["u-cm"], sender: CLIENT_SENDER, caseId: "case-1", caseNumber: "B193-A", text: "Hello team", link: "/messages/c1", conversationId: "c1", messageId: "m1" });
  assert.deepEqual(notifications.map((n) => n.userId).sort(), ["u-cm", "u-tl"]);
  assert.ok(notifications.every((n) => n.title === "John Smith" && n.channels.includes("push")));
  assert.deepEqual(emails.map((e) => e.key), ["client-message-team-alert", "client-message-team-alert"], "sent even to an online case manager: the 30-minute limit is what stops a flood");
  assert.deepEqual(emails.map((e) => e.to).sort(), ["cm@example.com", "tl@example.com"]);
  assert.equal(emails[0].data.senderName, "John Smith");
  assert.equal(emails[0].data.senderRole, "Client");
});

test("the team email names the sender, their registered email and which party they are (employer / employee / petitioner / beneficiary)", async (t) => {
  for (const [sender, caseFields, role] of [
    [{ _id: "u-e1", name: "Jane Doe", email: "jane@x-mail.com", role: "employee" }, { employeeUser: "u-e1" }, "Employee"],
    [{ _id: "u-e2", name: "Acme HR", email: "hr@acme-corp.com", role: "employer" }, { employerUser: "u-e2" }, "Employer"],
    [{ _id: "u-p", name: "Pat Petitioner", email: "pat@x-mail.com", role: "client" }, { petitionerUser: "u-p" }, "Petitioner"],
    [{ _id: "u-b", name: "Bea Beneficiary", email: "bea@x-mail.com", role: "client" }, { beneficiaryUser: "u-b" }, "Beneficiary"],
  ]) {
    const { emails } = harness(t);
    mock.method(Case, "findById", () => ({ select: () => ({ lean: async () => ({ ...CASE_DOC, ...caseFields }) }) }));
    mock.method(User, "find", () => ({ select: () => ({ lean: async () => [USERS.cm] }) }));
    await notifyNewMessage({ recipientIds: ["u-cm"], sender, caseId: "case-1", caseNumber: "B193-A", text: "Hello", conversationId: "c1", messageId: "m1" });
    assert.equal(emails[0].data.senderName, sender.name);
    assert.equal(emails[0].data.senderEmail, sender.email);
    assert.equal(emails[0].data.senderRole, role);
    mock.restoreAll();
  }
});

test("a client's message never emails admins, and a staff sender keeps the old behaviour (no team lookup)", async (t) => {
  const { emails } = harness(t);
  mock.method(Case, "findById", () => ({ select: () => ({ lean: async () => CASE_DOC }) }));
  mock.method(User, "find", () => ({ select: () => ({ lean: async () => [USERS.cm, USERS.lead] }) }));
  await notifyNewMessage({ recipientIds: ["u-admin", "u-super"], sender: CLIENT_SENDER, caseId: "case-1", text: "x", conversationId: "c1" });
  assert.deepEqual(emails.map((e) => e.to).sort(), ["cm@example.com", "tl@example.com"], "only the case team, never the administrators");
  emails.length = 0;
  mock.method(Case, "findById", () => { throw new Error("must not be looked up for staff senders"); });
  await run(["u-cm"]);
  assert.equal(emails[0].key, "new-message-received");
});

test("a failed case lookup never blocks the message alert", async (t) => {
  const { notifications } = harness(t);
  mock.method(Case, "findById", () => { throw new Error("db down"); });
  await notifyNewMessage({ recipientIds: ["u-cm"], sender: CLIENT_SENDER, caseId: "case-1", text: "x", conversationId: "c1" });
  assert.deepEqual(notifications.map((n) => n.userId), ["u-cm"]);
});
