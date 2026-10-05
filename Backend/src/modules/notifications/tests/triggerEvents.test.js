const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../../../models/User");
const triggers = require("../../email/emailTriggers.registry");
const registry = require("../../email/emailVariables.registry");
const customization = require("../../email/emailCustomization.service");
const emailService = require("../../email/email.service");
const EmailLog = require("../../../models/EmailLog");
const { getProvider } = require("../../email/providers");
const notificationService = require("../notification.service");
const { withPushForTriggerTypes } = require("../notificationRules");
const triggerEvents = require("../triggerEvents.service");

// ── fixtures ────────────────────────────────────────────────────────────
const ADMINS = [{ _id: "a1", email: "admin1@x.com", role: "admin", name: "Admin One" }, { _id: "a2", email: "admin2@x.com", role: "admin", name: "Admin Two" }];
const USERS = {
  tl1: { _id: "tl1", email: "tl@x.com", role: "team_lead", name: "Tee Lead" },
  cm1: { _id: "cm1", email: "cm@x.com", role: "case_manager", name: "Cee Em" },
  att1: { _id: "att1", email: "att@x.com", role: "attorney", name: "Att One" },
  att2: { _id: "att2", email: "att2@x.com", role: "attorney", name: "Att Two" },
  cl1: { _id: "cl1", email: "client@x.com", role: "client", name: "Client One" },
};

function setup(t, { custom = null, people } = {}) {
  const created = [];
  const emails = [];
  const original = {
    find: User.find, build: customization.buildContext, active: customization.findActive,
    create: notificationService.createNotification, send: emailService.sendTemplateEmail,
  };
  User.find = (query) => ({
    select: () => ({
      lean: async () => {
        if (query.role) return ADMINS.filter((u) => u.role === query.role);
        const ids = (query._id?.$in || []).map(String);
        return Object.values(USERS).filter((u) => ids.includes(u._id));
      },
    }),
  });
  customization.buildContext = async ({ data }) => ({
    data, caseContext: { client: { name: "John Smith" }, case: { id: "B1", visaType: "H-1B" } },
    people: people || { client: ["cl1"], case_manager: ["cm1"], team_lead: ["tl1"], attorney: ["att1", "att2"] },
  });
  customization.findActive = async (key) => (custom && custom.key === key ? custom : custom === "all" ? { _id: "c" } : null);
  notificationService.createNotification = async (payload) => { created.push(payload); return payload; };
  emailService.sendTemplateEmail = async (key, options) => { emails.push({ key, ...options }); return { sent: true }; };
  t.after(() => {
    User.find = original.find; customization.buildContext = original.build; customization.findActive = original.active;
    notificationService.createNotification = original.create; emailService.sendTemplateEmail = original.send;
  });
  return { created, emails };
}
let caseCounter = 0;
const freshCase = () => `case-${++caseCounter}`; // the 60s repeat-guard is per event+case

// ── catalog ─────────────────────────────────────────────────────────────
test("catalog: unique keys, valid variables, nothing unbuildable listed, no duplicate moments, super admin only gets critical/system alerts", () => {
  const keys = triggers.TRIGGERS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  triggers.TRIGGERS.filter((t) => !t.builtIn).forEach((trigger) => {
    const check = registry.validateTokens([trigger.push.title, trigger.push.message], trigger.groups);
    assert.deepEqual([check.unknown, check.unavailable], [[], []], `${trigger.key}: ${JSON.stringify(check)}`);
  });
  const superAdminEvents = triggers.TRIGGERS.filter((t) => t.audience === "super_admin").map((t) => t.event);
  assert.deepEqual([...new Set(superAdminEvents)].sort(), ["case.escalated", "system.account_locked", "system.email_failed"]);
  assert.ok(triggers.TRIGGERS.every((t) => t.available !== false), "events the app cannot produce must not be listed");
  // one visible entry per (audience, event-or-built-in email): hidden duplicates point at the built-in they share
  triggers.TRIGGERS.filter((t) => t.hidden).forEach((t) => assert.ok(triggers.getTrigger(t.emailKey)?.builtIn, `${t.key} must point at a built-in email`));
  const visibleEvents = triggers.listVisible().filter((t) => !t.builtIn).map((t) => `${t.event}:${t.audience}`);
  assert.equal(new Set(visibleEvents).size, visibleEvents.length);
  ["case-on-hold", "document-rejected", "payment-required", "questionnaire-assigned", "quiz-lead-confirmation", "signature-required", "staff-invitation"].forEach((key) => assert.equal(triggers.getTrigger(key), null, `${key} should be gone`));
});

// ── dispatcher ──────────────────────────────────────────────────────────
test("RFE received alerts team lead, every admin and the attorneys with access - in-app + socket + push, never email by default", async (t) => {
  const { created, emails } = setup(t);
  await triggerEvents.emit("rfe.received", { caseId: freshCase(), actor: { _id: "someone" }, data: { rfeDeadline: "Dec 15, 2026" } });
  const byUser = Object.fromEntries(created.map((p) => [p.userId, p]));
  assert.deepEqual(Object.keys(byUser).sort(), ["a1", "a2", "att1", "att2", "tl1"]);
  created.forEach((payload) => {
    assert.deepEqual(payload.channels, ["in_app", "socket", "push"]);
    assert.equal(payload.type, "rfe_received");
    assert.equal(payload.priority, "urgent");
    assert.match(payload.message, /\[?B1\]?|B1/);
    assert.match(payload.message, /Dec 15, 2026/);
    assert.equal(payload.emailTemplate, undefined);
  });
  assert.match(byUser.att1.link, /^\/cases\//);
  assert.match(byUser.tl1.link, /^\/crm-cases\//);
  assert.equal(emails.length, 0);
});

test("the actor is never notified of their own action, and nobody is notified twice for one event", async (t) => {
  const { created } = setup(t, { people: { client: [], case_manager: [], team_lead: ["tl1"], attorney: ["tl1", "att1"] } }); // tl1 is also on the attorney list
  await triggerEvents.emit("rfe.received", { caseId: freshCase(), actor: { _id: "a1" } });
  const ids = created.map((p) => p.userId);
  assert.ok(!ids.includes("a1"));
  assert.equal(ids.filter((id) => id === "tl1").length, 1);
});

test("covered audiences get no second notification; users listed in skipUserIds are skipped", async (t) => {
  const { created } = setup(t);
  await triggerEvents.emit("rfe.received", { caseId: freshCase(), skipUserIds: ["att1", "tl1"] });
  assert.deepEqual(created.map((p) => p.userId).sort(), ["a1", "a2", "att2"]);
});

test("recipients can be pinned (only the attorney just assigned, not every attorney), and an empty pin means nobody", async (t) => {
  const { created } = setup(t);
  await triggerEvents.emit("attorney.assigned", { caseId: freshCase(), recipients: { attorney: ["att2"] }, data: { attorneyName: "Att Two" }, covered: { attorney: { notified: false, emailed: true } } });
  const byAudienceUser = created.map((p) => p.userId).sort();
  assert.deepEqual(byAudienceUser, ["a1", "a2", "att2", "cl1"]); // attorney (pinned), client, both admins
  assert.match(created.find((p) => p.userId === "cl1").message, /Att Two has been assigned/);
  created.length = 0;
  await triggerEvents.emit("attorney.feedback", { caseId: freshCase(), recipients: { case_manager: ["cm1"], attorney: [] }, covered: { case_manager: { notified: true, emailed: false }, attorney: { notified: true, emailed: false } } });
  assert.equal(created.length, 0, "covered + no active customization = nothing new");
});

test("email: only added when an admin has ACTIVATED a customized template for that trigger", async (t) => {
  const { created } = setup(t, { custom: { key: "rfe.received:team_lead", _id: "c1" } });
  await triggerEvents.emit("rfe.received", { caseId: freshCase() });
  const tl = created.find((p) => p.userId === "tl1");
  assert.deepEqual(tl.channels, ["in_app", "socket", "push", "email"]);
  assert.equal(tl.emailTemplate, "rfe.received:team_lead");
  assert.deepEqual(created.find((p) => p.userId === "a1").channels, ["in_app", "socket", "push"]);
});

test("covered + active customization sends ONLY the email (no duplicate in-app/push); not if the existing code already emailed", async (t) => {
  const { created, emails } = setup(t, { custom: "all" });
  await triggerEvents.emit("lead.approved", { data: { fullName: "Lee" }, covered: { admin: { notified: true, emailed: false } } });
  assert.equal(created.length, 0);
  assert.deepEqual(emails.map((e) => e.to).sort(), ["admin1@x.com", "admin2@x.com"]);
  emails.length = 0;
  // the internal lead email already went out at the call site -> never a second one
  await triggerEvents.emit("lead.created", { data: {}, covered: { admin: { notified: true, emailed: true } } });
  assert.equal(emails.length, 0);
  assert.equal(created.length, 0);
  // attorney granted: the existing attorney-assignment email already went out, so no second email even if customized
  created.length = 0;
  await triggerEvents.emit("attorney.assigned", { caseId: freshCase(), recipients: { attorney: ["att1"] }, covered: { attorney: { notified: false, emailed: true } } });
  const attorneyAlert = created.find((p) => p.userId === "att1");
  assert.deepEqual(attorneyAlert.channels, ["in_app", "socket", "push"]);
});

test("the same event on the same case within a minute is reported once; different cases are independent", async (t) => {
  const { created } = setup(t);
  const caseId = freshCase();
  await triggerEvents.emit("case.closed", { caseId });
  const first = created.length;
  assert.ok(first > 0);
  const again = await triggerEvents.emit("case.closed", { caseId });
  assert.equal(again.deduped, true);
  assert.equal(created.length, first);
  await triggerEvents.emit("case.closed", { caseId: freshCase() });
  assert.equal(created.length, first * 2);
});

test("emit never throws, and unknown events deliver nothing", async (t) => {
  setup(t);
  const original = customization.buildContext;
  customization.buildContext = async () => { throw new Error("db down"); };
  t.after(() => { customization.buildContext = original; });
  const result = await triggerEvents.emit("case.created", { caseId: freshCase() });
  assert.equal(result.delivered, 0);
  assert.ok(result.error);
  assert.deepEqual(await triggerEvents.emit("case.ready_for_tl_review", { caseId: freshCase() }), { event: "case.ready_for_tl_review", delivered: 0 }); // not an event the app has
});

test("critical alerts reach super admins, ordinary case events do not", () => {
  const audiencesFor = (event) => triggers.forEvent(event).map((t) => t.audience);
  assert.ok(audiencesFor("case.escalated").includes("super_admin"));
  assert.ok(audiencesFor("system.email_failed").includes("super_admin"));
  assert.ok(!audiencesFor("case.created").includes("super_admin"));
  assert.ok(!audiencesFor("rfe.received").includes("super_admin"));
});

// ── push on existing alerts ─────────────────────────────────────────────
test("existing alert types that hard-code in-app/socket now also push; role-wide workflow broadcasts never do", () => {
  assert.deepEqual(withPushForTriggerTypes("case_assigned", "shared", ["in_app", "socket"]), ["in_app", "socket", "push"]);
  assert.deepEqual(withPushForTriggerTypes("rfe_received", undefined, ["in_app", "socket"]), ["in_app", "socket", "push"]);
  assert.deepEqual(withPushForTriggerTypes("case_assigned", "workflow", ["in_app", "socket"]), ["in_app", "socket"]);
  assert.deepEqual(withPushForTriggerTypes("task_overdue", "shared", ["in_app"]), ["in_app"]);
  assert.deepEqual(withPushForTriggerTypes("case_approved", "shared", ["in_app", "push"]), ["in_app", "push"]);
});

// ── email.service for event-based triggers ──────────────────────────────
function stubProvider(t) {
  const sent = [];
  const provider = getProvider();
  const original = { send: provider.send, isConfigured: provider.isConfigured, create: EmailLog.create };
  provider.send = async (message) => { sent.push(message); return { messageId: "m" }; };
  provider.isConfigured = () => true;
  EmailLog.create = async (doc) => { const log = { ...doc, save: async () => log }; return log; };
  t.after(() => { provider.send = original.send; provider.isConfigured = original.isConfigured; EmailLog.create = original.create; });
  return sent;
}

test("event trigger with no active template sends nothing; with one, sends the customized email to the dispatcher's recipient only", async (t) => {
  const sent = stubProvider(t);
  const original = customization.findActive;
  const originalCtx = customization.buildContext;
  t.after(() => { customization.findActive = original; customization.buildContext = originalCtx; });
  customization.buildContext = async ({ data }) => ({ data, caseContext: { case: { id: "B1" }, attorney: { email: "att@x.com" } } });

  customization.findActive = async () => null;
  let result = await emailService.sendTemplateEmail("rfe.received:admin", { to: "admin1@x.com", data: {}, recipientRole: "client" });
  assert.equal(result.skipped, true);
  assert.equal(sent.length, 0);

  customization.findActive = async () => ({ _id: "c", subject: "RFE on [case.id]", heading: "", body: "<p>x</p>", recipients: { to: [{ type: "attorney" }], cc: [{ type: "attorney" }], bcc: [{ type: "custom", value: "audit@x.com" }] } });
  result = await emailService.sendTemplateEmail("rfe.received:admin", { to: "admin1@x.com", data: {}, recipientRole: "client" });
  assert.equal(result.sent, true);
  assert.equal(sent[0].to, "admin1@x.com", "To rules never redirect an event trigger's email");
  assert.deepEqual(sent[0].cc, ["att@x.com"]);
  assert.deepEqual(sent[0].bcc, ["audit@x.com"]);
  assert.equal(sent[0].subject, "RFE on B1");
});

test("a failed email send tells super admins, but a failed system alert or a test send does not", async (t) => {
  const events = [];
  const original = triggerEvents.emitInBackground;
  triggerEvents.emitInBackground = (event, options) => events.push([event, options.data?.details]);
  t.after(() => { triggerEvents.emitInBackground = original; });
  const provider = getProvider();
  const originalSend = provider.send; const originalConfigured = provider.isConfigured; const originalCreate = EmailLog.create;
  provider.send = async () => { throw new Error("smtp down"); };
  provider.isConfigured = () => true;
  EmailLog.create = async (doc) => { const log = { ...doc, save: async () => log }; return log; };
  const originalFind = customization.findActive;
  customization.findActive = async () => null;
  t.after(() => { provider.send = originalSend; provider.isConfigured = originalConfigured; EmailLog.create = originalCreate; customization.findActive = originalFind; });

  await emailService.sendTemplateEmail("case-created-client", { to: "c@x.com", data: { caseNumber: "B1" } });
  assert.equal(events.length, 1);
  assert.equal(events[0][0], "system.email_failed");
  assert.match(events[0][1], /case-created-client to c@x\.com \(smtp down\)/);
});

test("each audience's email button deep-links into its own portal and case", async (t) => {
  const { created } = setup(t, { custom: "all" });
  process.env.ATTORNEY_PORTAL_URL = "https://attorney.example.com";
  process.env.ADMIN_PORTAL_URL = "https://admin.example.com";
  const caseId = freshCase();
  await triggerEvents.emit("attorney.assigned", { caseId, recipients: { attorney: ["att1"] }, covered: { attorney: { notified: true, emailed: false } } });
  await triggerEvents.emit("rfe.received", { caseId: freshCase(), actor: { _id: "x" } });
  const link = (user, event) => created.find((p) => p.userId === user && p.metadata.event === event)?.emailData.portalLink;
  assert.match(link("cl1", "attorney.assigned"), /\/dashboard$/);
  assert.match(link("a1", "rfe.received"), /^https:\/\/admin\.example\.com\/crm-cases\/case-/);
  assert.match(link("att1", "rfe.received"), /^https:\/\/attorney\.example\.com\/cases\/case-/);
});
