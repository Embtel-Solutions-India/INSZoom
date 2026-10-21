// DB-free: the Case model lookup and the socket gateway are stubbed.
const assert = require("node:assert/strict");
const test = require("node:test");

const Case = require("../../../models/Case");
const gateway = require("../realtime.gateway");
const { EVENT, notifyCaseDataChanged, flushPending } = require("../caseLiveUpdates");

const cases = new Map();
const userEmits = [];
const roleEmits = [];
const original = { findById: Case.findById, emitToUser: gateway.emitToUser, emitToRole: gateway.emitToRole };

test.before(() => {
  Case.findById = (id) => ({ select: () => ({ lean: async () => { if (id === "boom") throw new Error("db down"); return cases.get(String(id)) || null; } }) });
  gateway.emitToUser = (userId, event, payload) => { userEmits.push({ userId: String(userId), event, payload }); return true; };
  gateway.emitToRole = (role, event, payload) => { roleEmits.push({ role, event, payload }); return true; };
});
test.after(() => Object.assign(Case, { findById: original.findById }) && Object.assign(gateway, { emitToUser: original.emitToUser, emitToRole: original.emitToRole }));
test.beforeEach(() => { userEmits.length = 0; roleEmits.length = 0; cases.clear(); });

test("the event goes to everyone who can see the case - and only them - and carries no case data", async () => {
  cases.set("c1", {
    caseNumber: "B1", user: "owner", delegateEmployerUser: "delegate", assignedCaseManager: "cm1", additionalCaseManagers: ["cm2"],
    attorneyAccess: [{ attorneyId: "atty-active", status: "active" }, { attorneyId: "atty-revoked", status: "revoked" }],
  });
  notifyCaseDataChanged("c1", "documents", { actor: { _id: "owner" }, reason: "upload" });
  await flushPending();
  assert.deepEqual(userEmits.map((e) => e.userId).sort(), ["atty-active", "cm1", "cm2", "delegate", "owner"]);
  assert.ok(userEmits.every((e) => e.event === EVENT && e.event === "case:data_changed"));
  assert.deepEqual(roleEmits.map((e) => e.role).sort(), ["admin", "super_admin", "team_lead"]);
  const { payload } = userEmits[0];
  assert.deepEqual(Object.keys(payload).sort(), ["actorId", "at", "caseId", "caseNumber", "reason", "scope"]);
  assert.deepEqual(payload.scope, ["documents"]);
  assert.equal(payload.actorId, "owner");
});

test("an employee case also reaches the employer who holds the principal case", async () => {
  cases.set("child", { caseNumber: "B1-A", user: "employee", assignedCaseManager: "cm1", parentCase: "parent" });
  cases.set("parent", { user: "employer", delegateEmployerUser: "employer-delegate", assignedCaseManager: "cm1" });
  notifyCaseDataChanged("child", "answers");
  await flushPending();
  assert.deepEqual(userEmits.map((e) => e.userId).sort(), ["cm1", "employee", "employer", "employer-delegate"]);
});

test("a burst of changes to one case is coalesced into one event per recipient with the merged scopes", async () => {
  cases.set("c1", { caseNumber: "B1", user: "owner" });
  for (let i = 0; i < 5; i += 1) notifyCaseDataChanged("c1", i % 2 ? "documents" : "answers", { reason: `step${i}` });
  notifyCaseDataChanged({ _id: "c1" }, "checklist"); // a document / populated ref works too
  await flushPending();
  assert.equal(userEmits.length, 1);
  assert.deepEqual([...userEmits[0].payload.scope].sort(), ["answers", "checklist", "documents"]);
});

test("several cases (an employee save also touches the parent case) each get their own event", async () => {
  cases.set("a", { caseNumber: "A", user: "u-a" });
  cases.set("b", { caseNumber: "B", user: "u-b" });
  notifyCaseDataChanged(["a", "b", "a", null, undefined], "answers");
  await flushPending();
  assert.deepEqual(userEmits.map((e) => e.userId).sort(), ["u-a", "u-b"]);
});

test("it can never throw or reject: unknown case, database error, garbage input", async () => {
  assert.doesNotThrow(() => notifyCaseDataChanged(undefined, undefined));
  assert.doesNotThrow(() => notifyCaseDataChanged({ get _id() { throw new Error("bad ref"); } }, "documents"));
  notifyCaseDataChanged("missing", "documents");
  notifyCaseDataChanged("boom", "documents");
  await assert.doesNotReject(flushPending());
  assert.equal(userEmits.length, 0);
  assert.equal(roleEmits.length, 0);
});

test("with no socket server running (io not initialised) it is a harmless no-op", async () => {
  gateway.emitToUser = original.emitToUser;
  gateway.emitToRole = original.emitToRole;
  try {
    cases.set("c1", { caseNumber: "B1", user: "owner" });
    notifyCaseDataChanged("c1", "documents");
    await assert.doesNotReject(flushPending());
  } finally {
    gateway.emitToUser = (userId, event, payload) => { userEmits.push({ userId: String(userId), event, payload }); return true; };
    gateway.emitToRole = (role, event, payload) => { roleEmits.push({ role, event, payload }); return true; };
  }
});
