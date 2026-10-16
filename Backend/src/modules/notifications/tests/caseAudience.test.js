// "Only the people working a case hear about it": the case's case manager(s) + team lead (the default team lead teamlead@immiglance.com
// when the case has none). Another team lead, another case manager, any admin / super admin is skipped for that case. DB-free (mocked).
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const EmailLog = require("../../../models/EmailLog");
const caseAudience = require("../caseAudience");
const notificationService = require("../notification.service");
const triggerEvents = require("../triggerEvents.service");
const emailService = require("../../email/email.service");
const customization = require("../../email/emailCustomization.service");
const { getProvider } = require("../../email/providers");

const USERS = {
  cm: { _id: "cm-1", role: "case_manager", email: "cm@immiglance.com" },
  otherCm: { _id: "cm-2", role: "case_manager", email: "cm2@immiglance.com" },
  tl: { _id: "tl-1", role: "team_lead", email: "madaan@immiglance.com" },
  otherTl: { _id: "tl-2", role: "team_lead", email: "akash@immiglance.com" },
  defaultTl: { _id: "dtl-1", role: "team_lead", email: "teamlead@immiglance.com" },
  admin: { _id: "ad-1", role: "admin", email: "admin@immiglance.com" },
  superAdmin: { _id: "su-1", role: "super_admin", email: "super@immiglance.com" },
  client: { _id: "cl-1", role: "client", email: "client@acme-corp.com" },
  attorney: { _id: "at-1", role: "attorney", email: "att@lawfirm.com" },
};
const BY_EMAIL = Object.fromEntries(Object.values(USERS).map((user) => [user.email, user]));
const CASE_WITH_TL = { _id: "case-1", assignedCaseManager: "cm-1", assignedTeamLead: "tl-1", createdBy: "tl-1" };
const CASE_NO_TL = { _id: "case-2", assignedCaseManager: "cm-1", createdBy: "ad-1" }; // created by an admin, no team lead named

function harness(t, { caseDoc = CASE_WITH_TL, connected = true } = {}) {
  t.after(() => { mock.restoreAll(); delete mongoose.connection.readyState; });
  Object.defineProperty(mongoose.connection, "readyState", { get: () => (connected ? 1 : 0), configurable: true });
  const chain = (value) => { const query = { select: () => query, lean: async () => value }; return query; };
  mock.method(Case, "findById", () => chain(caseDoc));
  mock.method(User, "findById", (id) => chain(Object.values(USERS).find((user) => user._id === id) || null));
  mock.method(User, "findOne", (query) => {
    if (query.email) return chain(query.role && BY_EMAIL[query.email]?.role !== query.role ? null : BY_EMAIL[query.email] || null);
    return chain(Object.values(USERS).find((user) => user._id === query._id && user.role === query.role) || null);
  });
}
const outside = (user, caseId = "case-1", extra = {}) => caseAudience.isOutsideCaseTeam({ userId: user._id, caseId, ...extra });

test("only the case's own case manager and team lead are inside; other team leads, case managers, admins and super admins are outside", async (t) => {
  harness(t);
  assert.equal(await outside(USERS.cm), false);
  assert.equal(await outside(USERS.tl), false);
  assert.equal(await outside(USERS.otherTl), true);
  assert.equal(await outside(USERS.otherCm), true);
  assert.equal(await outside(USERS.admin), true);
  assert.equal(await outside(USERS.superAdmin), true);
  assert.equal(await outside(USERS.defaultTl), true, "the default team lead only covers cases that have none");
});

test("clients, employers, attorneys etc. are never filtered by this rule", async (t) => {
  harness(t);
  assert.equal(await outside(USERS.client), false);
  assert.equal(await outside(USERS.attorney), false);
});

test("a case with no team lead (admin-created, GoHighLevel) has teamlead@immiglance.com as its team lead; nobody else", async (t) => {
  harness(t, { caseDoc: CASE_NO_TL });
  assert.equal(await outside(USERS.defaultTl, "case-2"), false);
  assert.equal(await outside(USERS.cm, "case-2"), false);
  assert.equal(await outside(USERS.otherTl, "case-2"), true);
  assert.equal(await outside(USERS.admin, "case-2"), true, "the admin who created it is not told unless assigned");
});

test("recipients can be identified by email (as sendTemplateEmail does)", async (t) => {
  harness(t);
  assert.equal(await caseAudience.isOutsideCaseTeam({ email: "AKASH@immiglance.com", caseId: "case-1" }), true);
  assert.equal(await caseAudience.isOutsideCaseTeam({ email: "madaan@immiglance.com", caseId: "case-1" }), false);
});

test("fails open: no database, no case, assignment notices, or an error never block a notice", async (t) => {
  harness(t, { connected: false });
  assert.equal(await outside(USERS.admin), false, "database not reachable");
  mock.restoreAll();
  harness(t, { caseDoc: null });
  assert.equal(await outside(USERS.admin), false, "case not found");
  mock.restoreAll();
  harness(t);
  assert.equal(await outside(USERS.otherCm, "case-1", { type: "case_assigned" }), false, "assignment notices reach the person being (un)assigned");
  assert.equal(await caseAudience.isOutsideCaseTeam({ userId: USERS.admin._id }), false, "no case = not a case notice");
  mock.method(Case, "findById", () => { throw new Error("db down"); });
  assert.equal(await outside(USERS.admin), false);
});

test("createNotification returns nothing - and writes nothing - for someone outside the case's team", async (t) => {
  harness(t);
  mock.method(caseAudience, "isOutsideCaseTeam", async () => true);
  const result = await notificationService.createNotification({ userId: "ad-1", caseId: "case-1", type: "case_created", title: "x", message: "y" }, null, {});
  assert.equal(result, null);
});

test("event notices about a case never fan out to admins / super admins", async (t) => {
  harness(t);
  mock.method(User, "find", () => { throw new Error("must not query admins for a case notice"); });
  assert.deepEqual(await triggerEvents.resolveAudienceUsers("admin", { people: { team_lead: [] } }, undefined, true), []);
  assert.deepEqual(await triggerEvents.resolveAudienceUsers("super_admin", { people: {} }, undefined, true), []);
});

test("sendTemplateEmail skips staff outside the case's team (logged as skipped) but sends to the team, clients and attorneys", async (t) => {
  harness(t);
  const provider = getProvider();
  const original = { send: provider.send, isConfigured: provider.isConfigured, create: EmailLog.create, exists: EmailLog.exists, active: customization.findActive, context: customization.buildContext };
  const sent = [];
  const logs = [];
  provider.isConfigured = () => true;
  provider.send = async (mail) => { sent.push(mail.to); return { messageId: "m" }; };
  EmailLog.create = async (doc) => { logs.push(doc); const log = { ...doc, save: async () => log }; return log; };
  EmailLog.exists = async () => null;
  customization.findActive = async () => null;
  customization.buildContext = async ({ data }) => ({ data, caseContext: {} });
  t.after(() => { provider.send = original.send; provider.isConfigured = original.isConfigured; EmailLog.create = original.create; EmailLog.exists = original.exists; customization.findActive = original.active; customization.buildContext = original.context; });

  const send = (user, role) => emailService.sendTemplateEmail("client-message-team-alert", { to: user.email, recipientRole: role, caseId: "case-1", userId: user._id, data: { recipientName: "X", actorName: "Acme HR" } });
  const results = {};
  for (const [name, role] of [["cm", "case_manager"], ["tl", "team_lead"], ["otherTl", "team_lead"], ["otherCm", "case_manager"], ["admin", "admin"], ["superAdmin", "super_admin"], ["client", "client"], ["attorney", "attorney"]]) {
    results[name] = await send(USERS[name], role);
  }
  assert.deepEqual(sent.sort(), ["att@lawfirm.com", "client@acme-corp.com", "cm@immiglance.com", "madaan@immiglance.com"]);
  for (const name of ["otherTl", "otherCm", "admin", "superAdmin"]) {
    assert.equal(results[name].reason, "not_case_team", name);
    assert.equal(results[name].sent, false);
  }
  assert.ok(logs.some((log) => log.status === "skipped" && /not on this case's team/.test(log.error)), "the skip is logged");
});
