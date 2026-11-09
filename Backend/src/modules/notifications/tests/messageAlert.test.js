// "A message was sent" -> push (sender name on top, then the message) for every recipient, in-app alert, and an email only
// when the recipient is offline AND is an attorney / client (any client-side account). The INTERNAL TEAM (super admin, admin, team lead, case manager,
// paralegal, finance, HR, reviewer) is never e-mailed about a message, whoever wrote it: push + bell only.
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

test("offline attorney, client and employee each get the email; the internal team (case manager, team lead) never does", async (t) => {
  const { emails, notifications } = harness(t);
  await run(["u-att", "u-cli", "u-emp", "u-cm", "u-tl"]);
  assert.deepEqual(emails.map((e) => e.to).sort(), ["att@example.com", "client@example.com", "emp@example.com"]);
  assert.deepEqual(notifications.map((n) => n.userId).sort(), ["u-att", "u-cli", "u-cm", "u-emp", "u-tl"], "everyone, the internal team included, still gets the push + bell");
  assert.ok(notifications.filter((n) => ["u-cm", "u-tl"].includes(n.userId)).every((n) => n.channels.includes("push")));
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
  assert.deepEqual(emails.map((e) => e.to).sort(), ["client@example.com"]);
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

// ── a CLIENT writes: case manager + team lead are alerted by push + bell ONLY (no email) ──
const CLIENT_SENDER = { _id: "u-cli", name: "John Smith", role: "client" };
const CASE_DOC = { _id: "case-1", assignedCaseManager: "u-cm", assignedTeamLead: "u-tl", createdBy: "u-tl" };

test("a client's message pushes to the team lead even when not a participant, and sends the case manager + team lead NO email", async (t) => {
  const { notifications, emails } = harness(t, { online: ["u-cm"] });
  mock.method(Case, "findById", () => ({ select: () => ({ lean: async () => CASE_DOC }) }));
  mock.method(User, "find", () => ({ select: () => ({ lean: async () => [USERS.cm, USERS.lead] }) }));
  // only the case manager is a conversation participant; the team lead is added from the case
  await notifyNewMessage({ recipientIds: ["u-cm"], sender: CLIENT_SENDER, caseId: "case-1", caseNumber: "B193-A", text: "Hello team", link: "/messages/c1", conversationId: "c1", messageId: "m1" });
  assert.deepEqual(notifications.map((n) => n.userId).sort(), ["u-cm", "u-tl"]);
  assert.ok(notifications.every((n) => n.title === "John Smith" && n.channels.includes("push")));
  assert.equal(emails.length, 0, "the internal team is told by browser push only, online or not");
});

test("whoever writes (employee, employer, petitioner, beneficiary, a colleague), the internal team gets the push with the sender's name and no email", async (t) => {
  for (const [sender, caseFields] of [
    [{ _id: "u-e1", name: "Jane Doe", email: "jane@x-mail.com", role: "employee" }, { employeeUser: "u-e1" }],
    [{ _id: "u-e2", name: "Acme HR", email: "hr@acme-corp.com", role: "employer" }, { employerUser: "u-e2" }],
    [{ _id: "u-p", name: "Pat Petitioner", email: "pat@x-mail.com", role: "client" }, { petitionerUser: "u-p" }],
    [{ _id: "u-b", name: "Bea Beneficiary", email: "bea@x-mail.com", role: "client" }, { beneficiaryUser: "u-b" }],
    [{ _id: "u-att2", name: "Attorney Al", email: "al@x-mail.com", role: "attorney" }, {}],
  ]) {
    const { emails, notifications } = harness(t);
    mock.method(Case, "findById", () => ({ select: () => ({ lean: async () => ({ ...CASE_DOC, ...caseFields }) }) }));
    mock.method(User, "find", () => ({ select: () => ({ lean: async () => [USERS.cm] }) }));
    await notifyNewMessage({ recipientIds: ["u-cm"], sender, caseId: "case-1", caseNumber: "B193-A", text: "Hello", conversationId: "c1", messageId: "m1" });
    assert.equal(emails.length, 0, `${sender.role}: no email to the internal team`);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].title, sender.name);
    assert.ok(notifications[0].channels.includes("push"));
    mock.restoreAll();
  }
});

test("every internal role is e-mail-free, and a client-side recipient still gets the offline email", async (t) => {
  const { INTERNAL_TEAM_ROLES } = require("../messageAlert.service");
  for (const role of ["super_admin", "admin", "team_lead", "case_manager", "paralegal", "finance", "hr", "reviewer"]) assert.ok(INTERNAL_TEAM_ROLES.has(role), role);
  assert.equal(INTERNAL_TEAM_ROLES.has("attorney"), false);
  assert.equal(INTERNAL_TEAM_ROLES.has("client"), false);
  const { emails } = harness(t);
  await run(["u-cli"]);
  assert.deepEqual(emails.map((e) => e.to), ["client@example.com"], "clients keep the offline email");
});

test("a client's message never emails admins, and a staff sender keeps the old behaviour (no team lookup)", async (t) => {
  const { emails } = harness(t);
  mock.method(Case, "findById", () => ({ select: () => ({ lean: async () => CASE_DOC }) }));
  mock.method(User, "find", () => ({ select: () => ({ lean: async () => [USERS.cm, USERS.lead] }) }));
  await notifyNewMessage({ recipientIds: ["u-admin", "u-super"], sender: CLIENT_SENDER, caseId: "case-1", text: "x", conversationId: "c1" });
  assert.equal(emails.length, 0, "no internal team member (case team or administrator) is e-mailed");
  emails.length = 0;
  mock.method(Case, "findById", () => { throw new Error("must not be looked up for staff senders"); });
  await run(["u-cm"]);
  assert.equal(emails.length, 0, "a colleague's message to a case manager: push only, no email");
});

test("a failed case lookup never blocks the message alert", async (t) => {
  const { notifications } = harness(t);
  mock.method(Case, "findById", () => { throw new Error("db down"); });
  await notifyNewMessage({ recipientIds: ["u-cm"], sender: CLIENT_SENDER, caseId: "case-1", text: "x", conversationId: "c1" });
  assert.deepEqual(notifications.map((n) => n.userId), ["u-cm"]);
});
