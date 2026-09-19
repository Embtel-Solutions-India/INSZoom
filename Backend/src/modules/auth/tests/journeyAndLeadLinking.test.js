// DB-free, mocked-model style (this repo's default test convention — see
// data-rights/tests/dataRights.service.test.js), covering the new
// checkEmail (email-first login's UX-hint endpoint) and findLinkableLead
// (anonymous Lead -> new-account association at signup) logic added this
// session. Live-DB verification (real check-email calls, real admin-role
// exclusion, real signup linking) was also run manually against the
// running dev backend — see the session's own notes; this file locks the
// pure-logic contract in for regression purposes.
const assert = require("node:assert/strict");
const test = require("node:test");
const authService = require("../auth.service");
const User = require("../../../models/User");
const Lead = require("../../../models/Lead");

function fakeQuery(result) {
  // Mongoose query chains (.select(), .sort()) — a bare thenable covers
  // every chain shape this code actually calls.
  const q = Promise.resolve(result);
  q.select = () => q;
  q.sort = () => q;
  return q;
}

test("checkEmail: unknown email returns exists:false, no other fields leaked", async (t) => {
  t.mock.method(User, "findOne", () => fakeQuery(null));
  const result = await authService.checkEmail("nobody@example.com");
  assert.deepEqual(result, { exists: false, hasPassword: false, pendingInvite: false });
});

test("checkEmail: role-scoped query — a staff/admin email must not be looked up outside CLIENT_PORTAL_ROLES", async (t) => {
  let capturedQuery = null;
  t.mock.method(User, "findOne", (query) => { capturedQuery = query; return fakeQuery(null); });
  await authService.checkEmail("admin@example.com");
  assert.ok(capturedQuery.role, "expected the lookup to filter by role");
  assert.deepEqual(capturedQuery.role.$in, ["client", "user", "employer", "employee", "beneficiary"]);
});

test("checkEmail: existing client account with a password", async (t) => {
  t.mock.method(User, "findOne", () => fakeQuery({ role: "client", password: "hashed", email: "known@example.com" }));
  const result = await authService.checkEmail("known@example.com");
  assert.deepEqual(result, { exists: true, hasPassword: true, pendingInvite: false });
});

test("checkEmail: existing client account with no password and no inviteTokenHash (Google-only) is never reported as a pending invite", async (t) => {
  t.mock.method(User, "findOne", () => fakeQuery({ role: "client", password: null, inviteTokenHash: undefined, email: "google@example.com" }));
  const result = await authService.checkEmail("google@example.com");
  assert.deepEqual(result, { exists: true, hasPassword: false, pendingInvite: false });
});

test("checkEmail: a real staff-issued invite (no password, inviteTokenHash set) reports pendingInvite:true", async (t) => {
  t.mock.method(User, "findOne", () => fakeQuery({ role: "client", password: null, inviteTokenHash: "some-hash", email: "invited@example.com" }));
  const result = await authService.checkEmail("invited@example.com");
  assert.deepEqual(result, { exists: true, hasPassword: false, pendingInvite: true });
});

test("findLinkableLead: sessionId match takes priority — email lookup is never attempted when sessionId already resolved", async (t) => {
  const bySessionLead = { _id: "lead-by-session", status: "new" };
  const leadFindOne = t.mock.method(Lead, "findOne", (query) => fakeQuery(query.sessionId ? bySessionLead : { _id: "lead-by-email" }));
  t.mock.method(User, "findOne", () => fakeQuery(null)); // no existing User has claimed this lead

  const result = await authService.findLinkableLead("sess-123", "someone@example.com");
  assert.equal(result, bySessionLead);
  assert.equal(leadFindOne.mock.callCount(), 1, "email fallback must not run once sessionId already found a Lead");
});

test("findLinkableLead: falls back to email when sessionId finds nothing", async (t) => {
  const byEmailLead = { _id: "lead-by-email", status: "contacted" };
  t.mock.method(Lead, "findOne", (query) => fakeQuery(query.sessionId ? null : byEmailLead));
  t.mock.method(User, "findOne", () => fakeQuery(null));

  const result = await authService.findLinkableLead("sess-with-no-lead", "someone@example.com");
  assert.equal(result, byEmailLead);
});

test("findLinkableLead: a Lead already claimed by another User is not re-linked (double-link guard)", async (t) => {
  const lead = { _id: "lead-1", status: "new" };
  t.mock.method(Lead, "findOne", () => fakeQuery(lead));
  t.mock.method(User, "findOne", (query) => fakeQuery(query.leadId ? { _id: "other-user" } : null));

  const result = await authService.findLinkableLead("sess-1", "someone@example.com");
  assert.equal(result, null, "a Lead another User already claims must never be linked again");
});

test("findLinkableLead: no sessionId and no email match returns null without throwing", async (t) => {
  t.mock.method(Lead, "findOne", () => fakeQuery(null));
  const result = await authService.findLinkableLead(undefined, "nobody@example.com");
  assert.equal(result, null);
});
