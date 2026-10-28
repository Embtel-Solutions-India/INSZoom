// DB-free: links to cases that no longer exist are dropped, links to live cases never are, and a failure leaves the account untouched.
const assert = require("node:assert/strict");
const test = require("node:test");
const { pruneStaleCaseLinks } = require("../staleCaseLinks");

const fakeDeps = (liveIds, calls = []) => ({
  CaseModel: { find: (query) => ({ select: () => ({ lean: async () => query._id.$in.filter((id) => liveIds.includes(String(id))).map((id) => ({ _id: id })) }) }) },
  UserModel: { updateOne: async (...args) => { calls.push(args); } },
});

test("an account whose only case was deleted loses the dead links, so a new case for the email is allowed", async () => {
  const calls = [];
  const user = { _id: "u1", primaryCaseId: "c1", caseIds: ["c1"] };
  await pruneStaleCaseLinks(user, fakeDeps([], calls));
  assert.deepEqual(user.caseIds, []);
  assert.equal(user.primaryCaseId, undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].$set, { caseIds: [] });
  assert.deepEqual(calls[0][1].$unset, { primaryCaseId: "" });
});

test("only the dead link goes: a live case stays, and a live primary is kept", async () => {
  const calls = [];
  const user = { _id: "u1", primaryCaseId: "c2", caseIds: ["c1", "c2"] };
  await pruneStaleCaseLinks(user, fakeDeps(["c2"], calls));
  assert.deepEqual(user.caseIds, ["c2"]);
  assert.equal(user.primaryCaseId, "c2");
  assert.equal(calls[0][1].$unset, undefined);
});

test("nothing is written when every link is live, or there are no links", async () => {
  const calls = [];
  await pruneStaleCaseLinks({ _id: "u1", primaryCaseId: "c1", caseIds: ["c1"] }, fakeDeps(["c1"], calls));
  await pruneStaleCaseLinks({ _id: "u2", caseIds: [] }, fakeDeps([], calls));
  assert.equal(calls.length, 0);
});

test("a database failure never throws and leaves the account as it was", async () => {
  const user = { _id: "u1", primaryCaseId: "c1", caseIds: ["c1"] };
  const deps = { CaseModel: { find: () => { throw new Error("db down"); } }, UserModel: { updateOne: async () => { throw new Error("must not write"); } } };
  const result = await pruneStaleCaseLinks(user, deps);
  assert.equal(result, user);
  assert.deepEqual(user.caseIds, ["c1"]);
  assert.equal(user.primaryCaseId, "c1");
});

test("a missing user is returned as is", async () => {
  assert.equal(await pruneStaleCaseLinks(null, fakeDeps([])), null);
});

const { reclaimOrphanClientSideAccount } = require("../staleCaseLinks");
const reclaimDeps = (hasLiveCase, calls = []) => ({ CaseModel: { exists: async (query) => { calls.push(["exists", query]); return hasLiveCase ? { _id: "x" } : null; } }, UserModel: { updateOne: async (...args) => { calls.push(["update", ...args]); } } });

test("a leftover client account with no live case becomes the employee the invite needs", async () => {
  const calls = [];
  const user = { _id: "u1", email: "a@b.com", role: "client", caseIds: [], primaryCaseId: null };
  const ok = await reclaimOrphanClientSideAccount(user, "employee", { exceptCaseId: "child1", ...reclaimDeps(false, calls) });
  assert.equal(ok, true);
  assert.equal(user.role, "employee");
  assert.equal(calls[0][1]._id.$ne, "child1", "the case being invited into does not count as the account's own case");
  assert.deepEqual(calls[1][2].$set, { role: "employee", caseIds: [] });
});

test("an account that still has a live case keeps its role (the 'another account type' refusal stays)", async () => {
  const calls = [];
  const user = { _id: "u1", email: "a@b.com", role: "client" };
  assert.equal(await reclaimOrphanClientSideAccount(user, "employee", reclaimDeps(true, calls)), false);
  assert.equal(user.role, "client");
  assert.equal(calls.some((call) => call[0] === "update"), false);
});

test("staff, attorney and admin accounts are never reclaimed", async () => {
  for (const role of ["admin", "super_admin", "team_lead", "case_manager", "attorney"]) {
    const calls = [];
    assert.equal(await reclaimOrphanClientSideAccount({ _id: "u1", role }, "client", reclaimDeps(false, calls)), false);
    assert.equal(calls.length, 0);
  }
});

test("a database failure leaves the account alone and reports it as not reclaimed", async () => {
  const user = { _id: "u1", role: "client" };
  const ok = await reclaimOrphanClientSideAccount(user, "employee", { CaseModel: { exists: async () => { throw new Error("db down"); } }, UserModel: {} });
  assert.equal(ok, false);
  assert.equal(user.role, "client");
});

test("a withdrawn (removed) case does not count as live, so its email is released", async () => {
  const calls = [];
  const user = { _id: "u1", email: "a@b.com", role: "employee" };
  await reclaimOrphanClientSideAccount(user, "client", reclaimDeps(false, calls));
  assert.deepEqual(calls[0][1].status, { $ne: "removed" });
  let seen;
  const deps = { CaseModel: { find: (query) => { seen = query; return { select: () => ({ lean: async () => [] }) }; } }, UserModel: { updateOne: async () => {} } };
  await pruneStaleCaseLinks({ _id: "u1", primaryCaseId: "c1", caseIds: ["c1"] }, deps);
  assert.deepEqual(seen.status, { $ne: "removed" });
});
