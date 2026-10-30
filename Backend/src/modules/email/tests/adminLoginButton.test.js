// Every email to internal staff (case manager, team lead, admin, super admin) carries a "Log in to Admin" button; client / attorney
// emails and locked security emails do not. Also: the client-message email is limited to one per person per case per 30 minutes.
// DB-free: the provider and EmailLog are stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ADMIN_PORTAL_URL = "https://admin.immiglance.com";
process.env.EMAIL_SUPPRESS_STAFF_AND_ATTORNEY = "false";

const emailService = require("../email.service");
const customization = require("../emailCustomization.service");
const EmailLog = require("../../../models/EmailLog");
const { getProvider } = require("../providers");

const LOGIN = "https://admin.immiglance.com/login";

function harness(t, { recent = false, active = null } = {}) {
  const provider = getProvider();
  const original = { send: provider.send, isConfigured: provider.isConfigured, create: EmailLog.create, exists: EmailLog.exists, active: customization.findActive, context: customization.buildContext };
  const sent = [];
  const windows = [];
  provider.isConfigured = () => true;
  provider.send = async (mail) => { sent.push(mail); return { messageId: "m" }; };
  EmailLog.create = async (doc) => { const log = { ...doc, save: async () => log }; return log; };
  EmailLog.exists = async (query) => { windows.push(Date.now() - query.createdAt.$gte.getTime()); return recent ? { _id: "x" } : null; };
  customization.findActive = async () => active;
  customization.buildContext = async ({ data }) => ({ data, caseContext: {} }); // no DB in unit tests
  t.after(() => { provider.send = original.send; provider.isConfigured = original.isConfigured; EmailLog.create = original.create; EmailLog.exists = original.exists; customization.findActive = original.active; customization.buildContext = original.context; });
  return { sent, windows };
}

const send = (key, to, recipientRole, data = {}) => emailService.sendTemplateEmail(key, { to, recipientRole, caseId: "507f1f77bcf86cd799439011", data });

test("case manager, team lead, admin and super admin each get the Admin login button", async (t) => {
  const { sent } = harness(t);
  for (const role of ["case_manager", "team_lead", "admin", "super_admin"]) {
    await send("new-message-received", `${role}@immiglance.com`, role, { recipientName: "X", senderName: "Y", caseNumber: "B1", messagePreview: "hi" });
  }
  assert.equal(sent.length, 4);
  for (const mail of sent) {
    // one button only, and it opens the Admin login page (the email's own button when it has one, otherwise "Log in to Admin")
    assert.equal(mail.html.split("display:inline-block").length - 1, 1, `${mail.to} has exactly one button`);
    assert.ok(mail.html.includes(`href="${LOGIN}"`), `${mail.to} button opens the login page`);
  }
});

test("the same email to a client gets no Admin button", async (t) => {
  const { sent } = harness(t);
  await send("new-message-received", "client@immiglance.com", "client", { recipientName: "X", senderName: "Y", caseNumber: "B1" });
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].html.includes(LOGIN));
});

test("customized (admin-edited) staff emails get the button too, and it is never doubled", async (t) => {
  const { sent } = harness(t, { active: { _id: "t1", subject: "Hello", heading: "Hello", body: "<p>Body</p>", recipients: {}, sendEmail: true } });
  await send("questionnaire-progress-saved", "tl@immiglance.com", "team_lead", { clientName: "A" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].html.split(`href="${LOGIN}"`).length - 1, 1);
  const { sent: second } = harness(t);
  await send("staff-credentials", "new@immiglance.com", "admin", { name: "N", email: "new@immiglance.com", password: "pw", role: "admin" });
  assert.ok(second[0].html.includes(LOGIN) && !second[0].html.includes("Log in to Admin"), "staff-credentials already links to the login page: no second button");
});

test("every new questionnaire / message team email is sent to staff with the button, and renders without error", async (t) => {
  const { sent } = harness(t);
  const data = { recipientName: "Akash", clientName: "Acme", senderName: "Acme", caseNumber: "B195", answeredGroups: [{ title: "Checklist", labels: ["Legal name"] }], answeredMore: 0, messagePreview: "Hello" };
  for (const key of ["questionnaire-progress-saved", "questionnaire-submitted-team", "client-message-team-alert"]) await send(key, "tl@immiglance.com", "team_lead", data);
  assert.equal(sent.length, 3);
  sent.forEach((mail) => assert.ok(mail.html.includes(`href="${LOGIN}"`) && !mail.html.includes('href="#"')));
  assert.ok(sent[0].html.includes("Legal name"));
});

test("client-message email: a repeat within 30 minutes is skipped (window is 30 min), others keep their own window", async (t) => {
  let h = harness(t, { recent: true });
  const result = await send("client-message-team-alert", "tl@immiglance.com", "team_lead", { senderName: "A" });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "repeat");
  assert.equal(h.sent.length, 0);
  assert.ok(Math.abs(h.windows[0] - 30 * 60 * 1000) < 5000, "30-minute window");
  h = harness(t, { recent: true });
  await send("new-message-received", "att@immiglance.com", "attorney", { senderName: "A" });
  assert.ok(Math.abs(h.windows[0] - 2 * 60 * 1000) < 5000, "the existing message email keeps its short window");
});
