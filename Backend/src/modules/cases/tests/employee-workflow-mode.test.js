// Per-employee workflow switch (PATCH /cases/:principalId/employees/:childCaseId/data-entry-mode).
// DB-free: Case/User/notification/audit are stubbed, the REAL controller logic runs. Covers the two directions
// (fill_self <-> invite), authorization, and that nothing is lost or left reachable after a switch.
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const caseService = require("../case.service");
const notificationService = require("../../notifications/notification.service");
const ctrl = require("../case.controller");

const EMPLOYER_ID = "employer-1";
const EMPLOYEE_ID = "employee-1";

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function setup(t, { principal = {}, child = {}, employeeUser } = {}) {
  t.after(() => mock.restoreAll());
  const principalDoc = { _id: "principal-1", user: EMPLOYER_ID, dataEntryMode: "invite", ...principal };
  const childDoc = {
    _id: "child-1", parentCase: "principal-1", caseRole: "employee", status: "active", caseNumber: "C-1A",
    user: EMPLOYEE_ID, clientName: "Jane Doe", clientEmail: "jane@example.com", employeeDataEntryMode: "invite",
    saves: 0, async save() { this.saves += 1; }, ...child,
  };
  const users = { updates: [] };
  const employee = employeeUser === undefined ? { _id: EMPLOYEE_ID, email: "jane@example.com", password: null, primaryCaseId: "child-1" } : employeeUser;
  mock.method(Case, "findById", async () => principalDoc);
  mock.method(Case, "findOne", async () => childDoc);
  mock.method(User, "findById", () => ({ select: async () => employee }));
  mock.method(User, "updateOne", async (filter, update) => { users.updates.push({ filter, update }); return {}; });
  const audits = [];
  mock.method(caseService, "addTimelineEvent", () => {});
  mock.method(caseService, "writeAuditLog", async (...args) => { audits.push(args); });
  mock.method(caseService, "canAccessCase", () => true);
  const notifications = [];
  mock.method(notificationService, "createNotification", async (payload) => { notifications.push(payload); return {}; });
  return { principalDoc, childDoc, users, audits, notifications };
}

const call = async (req) => {
  const res = mockRes();
  await ctrl.setEmployeeDataEntryMode({ params: { principalId: "principal-1", childCaseId: "child-1" }, ...req }, res, (error) => { if (error) throw error; });
  return res;
};
const EMPLOYER = { _id: EMPLOYER_ID, role: "client" };

test("invite -> fill_self: file goes back to the employer, invitation revoked, employee loses access", async (t) => {
  const { childDoc, users, audits, notifications } = setup(t);
  const res = await call({ user: EMPLOYER, body: { mode: "fill_self" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, "fill_self");
  assert.equal(res.body.previousMode, "invite");
  assert.equal(childDoc.user, EMPLOYER_ID);
  assert.equal(childDoc.employeeDataEntryMode, "fill_self");
  assert.ok(childDoc.saves >= 1);
  const employerGrant = users.updates.find((u) => u.filter._id === EMPLOYER_ID);
  assert.deepEqual(employerGrant.update, { $addToSet: { caseIds: "child-1" } });
  const employeeRevoke = users.updates.find((u) => u.filter._id === EMPLOYEE_ID);
  assert.deepEqual(employeeRevoke.update.$pull, { caseIds: "child-1" });
  // never-accepted invitation: the setup link dies immediately
  assert.equal(employeeRevoke.update.$set.inviteTokenHash, null);
  assert.equal(employeeRevoke.update.$set.isActive, false);
  assert.equal(employeeRevoke.update.$set.primaryCaseId, null);
  assert.equal(audits[0][0], "employee_data_entry_mode_changed");
  assert.equal(notifications.length, 1);
});

test("invite -> fill_self for an employee who already accepted keeps their account active", async (t) => {
  const { users } = setup(t, { employeeUser: { _id: EMPLOYEE_ID, email: "jane@example.com", password: "hash", primaryCaseId: "other-case" } });
  const res = await call({ user: EMPLOYER, body: { mode: "fill_self" } });
  assert.equal(res.statusCode, 200);
  const revoke = users.updates.find((u) => u.filter._id === EMPLOYEE_ID);
  assert.equal(revoke.update.$set, undefined, "an active account must not be deactivated or have its primary case cleared");
  assert.deepEqual(revoke.update.$pull, { caseIds: "child-1" });
});

test("fill_self when the employer already fills it is an idempotent no-op that records the explicit choice", async (t) => {
  const { childDoc, users } = setup(t, { child: { user: EMPLOYER_ID, employeeDataEntryMode: "" } });
  const res = await call({ user: EMPLOYER, body: { mode: "fill_self" } });
  assert.equal(res.statusCode, 200);
  assert.equal(childDoc.employeeDataEntryMode, "fill_self");
  assert.equal(users.updates.length, 0);
});

test("fill_self -> invite on an employee that is already invited is refused", async (t) => {
  setup(t);
  const res = await call({ user: EMPLOYER, body: { mode: "invite", employeeEmail: "x@example.com", employeeName: "X" } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "ALREADY_INVITED");
});

test("fill_self -> invite needs the employee's name and email", async (t) => {
  setup(t, { child: { user: EMPLOYER_ID, employeeDataEntryMode: "fill_self", clientName: "" } });
  const res = await call({ user: EMPLOYER, body: { mode: "invite" } });
  assert.equal(res.statusCode, 400);
});

test("authorization: another client cannot switch someone else's employee; a bad mode is rejected", async (t) => {
  setup(t);
  assert.equal((await call({ user: { _id: "stranger", role: "client" }, body: { mode: "fill_self" } })).statusCode, 403);
  assert.equal((await call({ user: EMPLOYER, body: { mode: "nonsense" } })).statusCode, 400);
});

test("staff may switch an employee they can access; the employer must have chosen a mode first; removed employees are blocked", async (t) => {
  setup(t);
  assert.equal((await call({ user: { _id: "cm-1", role: "case_manager" }, body: { mode: "fill_self" } })).statusCode, 200);
  mock.restoreAll();
  setup(t, { principal: { dataEntryMode: "not_set" } });
  assert.equal((await call({ user: EMPLOYER, body: { mode: "fill_self" } })).statusCode, 409);
  mock.restoreAll();
  setup(t, { child: { status: "removed" } });
  assert.equal((await call({ user: EMPLOYER, body: { mode: "fill_self" } })).body.code, "EMPLOYEE_REMOVED");
});

test("the principal's case-wide default may be changed after it was first chosen (no ALREADY_SET lock)", async (t) => {
  t.after(() => mock.restoreAll());
  const principalDoc = { _id: "principal-1", user: EMPLOYER_ID, dataEntryMode: "fill_self", async save() { this.saved = true; } };
  mock.method(Case, "findById", async () => principalDoc);
  mock.method(caseService, "writeAuditLog", async () => {});
  const res = mockRes();
  await ctrl.setDataEntryMode({ params: { principalId: "principal-1" }, user: EMPLOYER, body: { mode: "invite" } }, res, (error) => { if (error) throw error; });
  assert.equal(res.statusCode, 200);
  assert.equal(principalDoc.dataEntryMode, "invite");
});
