// Orchestration of a case rename with every model stubbed (DB-free): who may rename, what is written where, retries, and what is never touched.
const test = require("node:test");
const assert = require("node:assert/strict");

const stub = (path, exports) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };

const calls = { caseUpdates: [], userUpdates: [], profileEdits: [], audits: [], timeline: [], cacheInvalidated: [], ghl: [] };
const state = { cases: {}, users: {}, children: [], matched: true, canAccess: true };

const clone = (value) => JSON.parse(JSON.stringify(value));
const chain = (value) => ({ select: () => ({ lean: async () => (value ? clone(value) : value) }) });

stub("../../../models/Case", {
  findById: (id) => {
    const doc = state.cases[String(id)];
    const base = chain(doc);
    base.then = (resolve) => resolve(doc ? { ...clone(doc), save: async () => { calls.saved = true; } } : null);
    return base;
  },
  find: (query) => ({ select: () => ({ lean: async () => (query?.parentCase ? state.children.map((child) => ({ _id: child._id })) : []) }) }),
  updateOne: async (filter, update) => { calls.caseUpdates.push({ filter, update }); return { matchedCount: state.matched ? 1 : 0 }; },
});
stub("../../../models/User", {
  findById: (id) => chain(state.users[String(id)]),
  updateOne: async (filter, update) => { calls.userUpdates.push({ filter, update }); return { matchedCount: 1 }; },
});
stub("../../../models/Client", { findById: () => chain(null), updateOne: async () => ({ matchedCount: 1 }) });
stub("../../../models/Beneficiary", { findById: () => chain(null), updateOne: async () => ({ matchedCount: 1 }) });
stub("../../../config/redis", { invalidateUserCache: async (id) => { calls.cacheInvalidated.push(String(id)); } });
stub("../../../utils/logger", { warn() {}, info() {}, error() {} });
stub("../case.service", {
  canAccessCase: () => state.canAccess,
  addTimelineEvent: (doc, type, title) => { calls.timeline.push(title); },
  writeAuditLog: async (action, doc, user, changes) => { calls.audits.push({ action, changes }); },
});
stub("../../canonical/services/CanonicalProfileService", { applyStaffEdit: async (id, edits) => { calls.profileEdits.push({ id: String(id), edits }); return {}; } });
stub("../../../integrations/ghl/ghlOutboundHooks", { employeeChanged: (id) => calls.ghl.push(String(id)), caseSaved() {} });
stub("../../../config/env", { ghl: { enabled: false } });

const { renameCase } = require("../caseRename.service");
const P1 = "a".repeat(23) + "1", C1 = "a".repeat(23) + "2", E1 = "a".repeat(23) + "3";
const ADMIN = { _id: "admin1", role: "admin" };

const employer = () => ({
  _id: P1, caseNumber: "B197", caseRole: "principal", caseStructure: "employer_employee", clientName: "Vindham LLC", petitionerName: "Vindham LLC", user: "uEmp",
  participants: [{ role: "employer", name: "Vindham LLC" }],
  questionnaireData: { masterData: { employer: { company: { fullName: "Vindham LLC" } } } },
  canonicalProfile: { profile: { company: { name: "Vindham LLC" }, petitioner: { name: "Vindham LLC" } } },
  updatedAt: "2026-11-01",
});
const person = () => ({
  _id: C1, caseNumber: "B1", clientName: "Leslie Ane", user: "uCli", participants: [{ role: "client", name: "Leslie Ane" }],
  questionnaireData: { masterData: { person: { firstName: "Leslie", lastName: "Ane" }, spouse: { firstName: "Leslie", lastName: "Other" } } },
  canonicalProfile: { profile: { person: { firstName: "Leslie", lastName: "Ane", fullName: "Leslie Ane" } } },
});

test.beforeEach(() => {
  Object.keys(calls).forEach((key) => { calls[key] = Array.isArray(calls[key]) ? [] : undefined; });
  calls.caseUpdates = []; calls.userUpdates = []; calls.profileEdits = []; calls.audits = []; calls.timeline = []; calls.cacheInvalidated = []; calls.ghl = [];
  state.cases = {}; state.users = {}; state.children = []; state.matched = true; state.canAccess = true;
});

test("an employer matter: company name replaced on the case, in the profile, on the account, and its employees' copies", async () => {
  state.cases[P1] = employer();
  state.children = [{ _id: E1 }];
  state.cases[E1] = { _id: E1, caseRole: "employee", parentCase: P1, participants: [], questionnaireData: { masterData: { employer: { company: { fullName: "Vindham LLC" } } } }, canonicalProfile: { profile: { person: { fullName: "Vindham LLC" } } } };
  state.users.uEmp = { _id: "uEmp", name: "Vindham LLC", displayName: "Vindham LLC" };

  const result = await renameCase({ caseId: P1, input: { name: "SURUCHI INC." }, actor: ADMIN });
  assert.equal(result.success, true);
  assert.equal(result.name, "SURUCHI INC.");

  const main = calls.caseUpdates.find((u) => u.filter._id === P1);
  assert.equal(main.update.$set.clientName, "SURUCHI INC.");
  assert.equal(main.update.$set.petitionerName, "SURUCHI INC.");
  assert.equal(main.update.$set["participants.0.name"], "SURUCHI INC.");
  assert.equal(main.update.$set["questionnaireData.masterData.employer.company.fullName"], "SURUCHI INC.");
  assert.equal(main.update.$set["nameEdit.previousName"], "Vindham LLC");
  assert.deepEqual(main.update.$addToSet, { "nameEdit.previousNames": "Vindham LLC" });
  assert.equal(main.filter.clientName, "Vindham LLC", "compare-and-set: only if the value is still what was read");

  const editedPaths = calls.profileEdits.find((e) => e.id === P1).edits.map((e) => e.path).sort();
  assert.deepEqual(editedPaths, ["company.name", "petitioner.name"]);
  assert.ok(calls.profileEdits.find((e) => e.id === E1), "the employee's profile copy is renamed through the same writer");
  assert.ok(calls.caseUpdates.find((u) => u.filter._id === E1), "the employee's questionnaire copy is renamed");
  assert.equal(calls.userUpdates[0].update.$set.name, "SURUCHI INC.");
  assert.deepEqual(calls.cacheInvalidated, ["uEmp"]);
  assert.deepEqual(calls.ghl, [E1], "the employee card is queued for a GoHighLevel rename");
  assert.equal(calls.audits[0].action, "case_renamed");
  assert.equal(calls.timeline[0], "Case name changed");
});

test("a person: parts change only on that person's own data, never a spouse with the same first name", async () => {
  state.cases[C1] = person();
  state.users.uCli = { _id: "uCli", name: "Leslie Ane", displayName: "Leslie Ane" };
  const result = await renameCase({ caseId: C1, input: { firstName: "Leslie", lastName: "Anne" }, actor: ADMIN });
  assert.equal(result.name, "Leslie Anne");
  const main = calls.caseUpdates.find((u) => u.filter._id === C1).update.$set;
  assert.equal(main.clientName, "Leslie Anne");
  assert.equal(main["questionnaireData.masterData.person.lastName"], "Anne");
  assert.equal("questionnaireData.masterData.spouse.lastName" in main, false);
  const edits = Object.fromEntries(calls.profileEdits[0].edits.map((e) => [e.path, e.value]));
  assert.deepEqual(edits, { "person.lastName": "Anne", "person.fullName": "Leslie Anne" });
});

test("an account is renamed only when it carries exactly the old name (an employer-filled slot shares the employer's login)", async () => {
  state.cases[C1] = person();
  state.users.uCli = { _id: "uCli", name: "Employer Corp", displayName: "Employer Corp" };
  await renameCase({ caseId: C1, input: { firstName: "Leslie", lastName: "Anne" }, actor: ADMIN });
  assert.equal(calls.userUpdates.length, 0);
  assert.equal(calls.cacheInvalidated.length, 0);
});

test("who may rename: staff only, and only a case they can open", async () => {
  state.cases[C1] = person();
  await assert.rejects(() => renameCase({ caseId: C1, input: { firstName: "A", lastName: "B" }, actor: { _id: "x", role: "client" } }), (e) => e.status === 403);
  state.canAccess = false;
  await assert.rejects(() => renameCase({ caseId: C1, input: { firstName: "A", lastName: "B" }, actor: ADMIN }), (e) => e.status === 403);
  await assert.rejects(() => renameCase({ caseId: "not-an-id", input: {}, actor: ADMIN }), (e) => e.status === 400);
  state.canAccess = true;
  await assert.rejects(() => renameCase({ caseId: "000000000000000000000001", input: { firstName: "A", lastName: "B" }, actor: ADMIN }), (e) => e.status === 404);
  assert.equal(calls.caseUpdates.length + calls.profileEdits.length, 0, "nothing was written");
});

test("bad input is refused before anything is written", async () => {
  state.cases[P1] = employer();
  await assert.rejects(() => renameCase({ caseId: P1, input: { name: "   " }, actor: ADMIN }), (e) => e.status === 400);
  state.cases[C1] = person();
  await assert.rejects(() => renameCase({ caseId: C1, input: { firstName: "Only" }, actor: ADMIN }), (e) => e.status === 400);
  assert.equal(calls.caseUpdates.length + calls.profileEdits.length, 0);
});

test("a dry run reports and writes nothing", async () => {
  state.cases[P1] = employer();
  const result = await renameCase({ caseId: P1, input: { name: "SURUCHI INC." }, actor: ADMIN, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.wouldChange.profile, 2);
  assert.equal(calls.caseUpdates.length + calls.profileEdits.length + calls.userUpdates.length, 0);
});

test("a concurrent edit is retried once, then reported (never overwritten)", async () => {
  state.cases[P1] = employer();
  state.matched = false;
  await assert.rejects(() => renameCase({ caseId: P1, input: { name: "SURUCHI INC." }, actor: ADMIN }), (e) => e.status === 409 && e.code === "CONCURRENT_EDIT");
  assert.equal(calls.caseUpdates.filter((u) => u.filter._id === P1).length, 2, "one retry");
  assert.equal(calls.userUpdates.length, 0, "linked accounts are not touched when the case itself was not renamed");
});

test("the same name is a no-op", async () => {
  state.cases[P1] = { ...employer(), canonicalProfile: undefined, questionnaireData: {}, participants: [], petitionerName: undefined };
  const result = await renameCase({ caseId: P1, input: { name: "  Vindham   LLC " }, actor: ADMIN });
  assert.equal(result.unchanged, true);
  assert.equal(calls.caseUpdates.length, 0);
});

test("a capitalisation-only fix is a real rename", async () => {
  state.cases[P1] = { ...employer(), canonicalProfile: undefined, questionnaireData: {}, participants: [], petitionerName: undefined };
  const result = await renameCase({ caseId: P1, input: { name: "VINDHAM LLC" }, actor: ADMIN });
  assert.equal(result.name, "VINDHAM LLC");
  assert.equal(calls.caseUpdates.find((u) => u.filter._id === P1).update.$set.clientName, "VINDHAM LLC");
});
