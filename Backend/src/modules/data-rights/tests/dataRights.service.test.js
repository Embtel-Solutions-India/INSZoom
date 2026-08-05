const assert = require("node:assert/strict");
const test = require("node:test");
const ctrl = require("../dataRights.controller");
const User = require("../../../models/User");

// The self-only guard rejects synchronously (no `await` runs before its
// `res.status(403)` branch) — matches this repo's established no-DB test
// convention (see family-workflow/tests/family-workflow.test.js: call the
// handler with a fake req/res and rely on the guard clause to short-circuit
// before any Mongoose query fires). For the "allowed through" cases, node:test's
// built-in mock support stubs User.findById so the request can proceed past
// the guard without needing a real DB connection; each test's `t.mock` is
// auto-restored when that test ends.
//
// DB-backed fulfilment behavior (export aggregation scoping, erasure
// redacting PII while preserving AuditLog/ledger rows, approve/reject state
// transitions) is covered by live verification against the running dev
// backend instead — see the Phase 0 report.

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test("data-rights self-only guard: a client passing someone else's subjectUserId is rejected with 403", async () => {
  const req = { user: { _id: "client1", role: "client" }, body: { type: "export", subjectUserId: "someoneElse" } };
  const res = fakeRes();
  await ctrl.createRequest(req, res, () => assert.fail("next() should not be called — the guard responds directly"));
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /only request your own data/i);
});

test("data-rights self-only guard: a client omitting subjectUserId is NOT rejected (defaults to self)", async (t) => {
  t.mock.method(User, "findById", () => ({ select: () => Promise.resolve({ _id: "client1" }) }));
  const req = { user: { _id: "client1", role: "client" }, body: { type: "export" } };
  const res = fakeRes();
  await ctrl.createRequest(req, res, () => {});
  assert.notEqual(res.statusCode, 403, "must not have been short-circuited to 403");
});

test("data-rights self-only guard: a client passing their OWN id explicitly is NOT rejected", async (t) => {
  t.mock.method(User, "findById", () => ({ select: () => Promise.resolve({ _id: "client1" }) }));
  const req = { user: { _id: "client1", role: "client" }, body: { type: "export", subjectUserId: "client1" } };
  const res = fakeRes();
  await ctrl.createRequest(req, res, () => {});
  assert.notEqual(res.statusCode, 403);
});

test("data-rights self-only guard: staff (admin) MAY pass a different subjectUserId — not rejected", async (t) => {
  t.mock.method(User, "findById", () => ({ select: () => Promise.resolve({ _id: "someoneElse" }) }));
  const req = { user: { _id: "admin1", role: "admin" }, body: { type: "export", subjectUserId: "someoneElse" } };
  const res = fakeRes();
  await ctrl.createRequest(req, res, () => {});
  assert.notEqual(res.statusCode, 403);
});

test("data-rights self-only guard: staff allow-list is exact — case_manager is NOT staff for this purpose", async () => {
  const req = { user: { _id: "cm1", role: "case_manager" }, body: { type: "export", subjectUserId: "someoneElse" } };
  const res = fakeRes();
  await ctrl.createRequest(req, res, () => {});
  assert.equal(res.statusCode, 403, "case_manager is not in the staff allow-list (super_admin/admin only) and must be rejected like any other non-staff role");
});
