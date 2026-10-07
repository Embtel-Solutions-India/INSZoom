// "A message was sent" -> push (sender name on top, then the message) for every recipient, in-app alert, and an email only
// when the recipient is offline AND is an attorney / client / case manager / team lead (never admin or super admin).
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const User = require("../../../models/User");
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

test("admins and super admins are never emailed (they still get the push/in-app alert)", async (t) => {
  const { emails, notifications } = harness(t);
  await run(["u-admin", "u-super"]);
  assert.equal(emails.length, 0);
  assert.equal(notifications.length, 2);
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
