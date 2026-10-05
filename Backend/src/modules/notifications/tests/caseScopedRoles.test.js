const test = require("node:test");
const assert = require("node:assert/strict");

const Case = require("../../../models/Case");
const User = require("../../../models/User");
const notificationService = require("../notification.service");

const USERS = [
  { _id: "cl1", role: "client" }, { _id: "cl2", role: "client" },
  { _id: "cm1", role: "case_manager" }, { _id: "cm2", role: "case_manager" },
  { _id: "tl1", role: "team_lead" }, { _id: "tl2", role: "team_lead" },
  { _id: "att1", role: "attorney" }, { _id: "att2", role: "attorney" },
  { _id: "ad1", role: "admin" }, { _id: "sa1", role: "super_admin" },
];

function setup(t, caseDoc) {
  const original = { find: User.find, findById: Case.findById, create: notificationService.createNotification };
  User.find = (query) => ({
    select: async () => {
      if (query.role?.$in) return USERS.filter((u) => query.role.$in.includes(u.role));
      const clauses = query.$or || [];
      return USERS.filter((u) => clauses.some((c) => (c._id ? c._id.$in.map(String).includes(u._id) : c.role === u.role)));
    },
  });
  Case.findById = () => ({ select: () => ({ lean: async () => caseDoc }) });
  t.after(() => { User.find = original.find; Case.findById = original.findById; });
  return original;
}

// createForRoles calls the module-internal createNotification, so capture what it
// writes via the Notification model instead of stubbing the function.
const Notification = require("../../../models/Notification");
function captureNotifications(t) {
  const written = [];
  const originalCreate = Notification.create;
  Notification.create = async (doc) => { written.push(doc); return { ...doc, save: async () => {}, toObject: () => doc, delivery: [], channels: [] }; };
  t.after(() => { Notification.create = originalCreate; });
  return written;
}

const ASSIGNED = { user: "cl1", assignedCaseManager: "cm1", assignedTeamLead: "tl1", attorneyAccess: [{ attorneyId: "att1", status: "active" }, { attorneyId: "att2", status: "revoked" }] };

async function run(t, roles, caseDoc, payload = {}) {
  setup(t, caseDoc);
  const written = captureNotifications(t);
  const originalPrefs = notificationService.getPreference;
  await notificationService.createForRoles(roles, { type: "general", title: "t", message: "m", ...payload }, { _id: "actor" }, null).catch(() => null);
  void originalPrefs;
  return written.map((doc) => doc.userId || doc.user).filter(Boolean).map(String).sort();
}

test("a case notification to client/case manager/team lead/attorney reaches only the people on that case", async (t) => {
  const ids = await run(t, ["client", "case_manager", "team_lead", "attorney"], ASSIGNED, { caseId: "c1" });
  assert.deepEqual(ids, ["att1", "cl1", "cm1", "tl1"]);
});

test("admin and super admin stay role-wide for case notifications", async (t) => {
  const ids = await run(t, ["admin", "super_admin", "case_manager"], ASSIGNED, { caseId: "c1" });
  assert.deepEqual(ids, ["ad1", "cm1", "sa1"]);
});

test("a case with no assigned case manager falls back to its team lead; unassigned cases go to team leads to triage", async (t) => {
  let ids = await run(t, ["case_manager"], { user: "cl1", assignedTeamLead: "tl2" }, { caseId: "c1" });
  assert.deepEqual(ids, ["tl2"]);
  ids = await run(t, ["case_manager", "team_lead"], { user: "cl1" }, { caseId: "c1" });
  assert.deepEqual(ids, ["tl1", "tl2"]);
});

test("clients only ever get their own case's alert (family cases reach petitioner and beneficiary)", async (t) => {
  let ids = await run(t, ["client"], ASSIGNED, { caseId: "c1" });
  assert.deepEqual(ids, ["cl1"]);
  ids = await run(t, ["client"], { user: "cl1", petitionerUser: "cl2", beneficiaryUser: "cl1" }, { caseId: "c1" });
  assert.deepEqual(ids, ["cl1", "cl2"]);
});

test("a case that no longer exists notifies nobody in case-bound roles, and creates no role-wide fallback notification", async (t) => {
  const ids = await run(t, ["case_manager", "client"], null, { caseId: "gone" });
  assert.deepEqual(ids, []);
});

test("notifications with no case keep the old system-wide behaviour", async (t) => {
  const ids = await run(t, ["case_manager"], ASSIGNED, {});
  assert.deepEqual(ids, ["cm1", "cm2"]);
});
