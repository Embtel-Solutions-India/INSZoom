// Phase 7.0: the hold contract (reason, release conditions, re-evaluation, escalation) and the stage ladder (migration is never hidden behind a release).
const test = require("node:test");
const assert = require("node:assert/strict");
const hold = require("../holdContract");
const { buildLadder, summarizeMigration } = require("../stageLadder");
const { summarizeResult } = require("../FormPipelineRunner");
const { createHoldSweep } = require("../holdSweep");
const { createAlerter } = require("../PipelineAlerter");

const T0 = new Date("2026-10-01T00:00:00Z");
const DAY = 86400000;

test("a hold records why, what would release it, when it was judged and with which code versions", () => {
  const record = hold.buildHold({ classification: { class: "held", code: "EDITION_POLICY_HELD" }, stage: "promote", message: "USCIS acceptance not confirmed", at: T0 });
  assert.equal(record.reasonCode, "EDITION_POLICY_HELD");
  assert.equal(record.firstHeldAt, T0);
  assert.ok(record.releaseConditions.length >= 1 && /acceptance/i.test(record.releaseConditions[0]));
  assert.deepEqual(record.evaluatedWith, hold.EVALUATOR_VERSIONS);
  const blocked = hold.buildHold({ classification: { class: "blocked", code: "NORMALIZE_INPUT_NOT_PDF" }, stage: "import", message: "not a pdf", at: T0 });
  assert.ok(/24 hours|changes|fix/i.test(blocked.releaseConditions.join(" ")));
});

test("the same hold keeps its first-held time and escalation; a different reason starts again", () => {
  const first = hold.buildHold({ classification: { class: "held", code: "X" }, at: T0 });
  const later = new Date(T0.getTime() + 3 * DAY);
  const again = hold.buildHold({ classification: { class: "held", code: "X" }, previous: { ...first, escalatedAt: later }, at: later });
  assert.equal(again.firstHeldAt, T0);
  assert.equal(again.escalatedAt, later);
  assert.equal(again.lastEvaluatedAt, later);
  const other = hold.buildHold({ classification: { class: "blocked", code: "Y" }, previous: first, at: later });
  assert.equal(other.firstHeldAt, later);
  assert.equal(other.escalatedAt, undefined);
});

test("a hold judged with older code versions is outdated; current versions are not", () => {
  const record = hold.buildHold({ classification: { class: "held", code: "X" }, at: T0 });
  assert.equal(hold.isOutdated(record), false);
  assert.equal(hold.isOutdated(record, { ...hold.EVALUATOR_VERSIONS, matcher: hold.EVALUATOR_VERSIONS.matcher + 1 }), true);
  assert.equal(hold.isOutdated(null), false);
});

test("escalation happens once, only after the period, and the period is configurable", () => {
  const record = hold.buildHold({ classification: { class: "held", code: "X" }, at: T0 });
  assert.equal(hold.needsEscalation(record, new Date(T0.getTime() + 6 * DAY)), false);
  assert.equal(hold.needsEscalation(record, new Date(T0.getTime() + 7 * DAY)), true);
  assert.equal(hold.needsEscalation({ ...record, escalatedAt: T0 }, new Date(T0.getTime() + 30 * DAY)), false);
  assert.equal(hold.escalationMs({ FORM_PIPELINE_HOLD_ESCALATION_DAYS: "2" }), 2 * DAY);
  assert.equal(hold.escalationMs({ FORM_PIPELINE_HOLD_ESCALATION_DAYS: "bogus" }), 7 * DAY);
});

test("migration state: not run, failed, partial and complete are four different answers", () => {
  assert.equal(summarizeMigration({ released: false }).state, "not_applicable");
  assert.equal(summarizeMigration({ released: true, error: "boom" }).state, "migration_failed");
  assert.equal(summarizeMigration({ released: true, caseMigration: null }).state, "migration_pending");
  const complete = summarizeMigration({ released: true, caseMigration: { considered: 5, migrated: 4, verified: 4, skippedFrozen: 1, failed: [], unresolved: [], reconciliationRequired: [], restored: 0, inProgress: 0 } });
  assert.equal(complete.state, "migration_complete");
  const partial = summarizeMigration({ released: true, caseMigration: { considered: 5, migrated: 3, skippedFrozen: 0, failed: [{}], unresolved: [{}], reconciliationRequired: [], restored: 1, inProgress: 0 } });
  assert.equal(partial.state, "migration_partial");
  assert.equal(partial.counts.failed, 1);
  assert.equal(partial.counts.unresolved, 1);
  assert.match(partial.reason, /not on the new edition/);
});

const released = (extra = {}) => ({
  template: { version: "2026-10-01", status: "active", mappingStatus: "active" }, versionChanged: true, requiresActivation: false, checked: true, certification: { passed: true, checks: [] }, ...extra,
});

test("a released edition whose migration failed is still reported as released, with the failure on its own line", () => {
  const outcome = summarizeResult(released({ caseMigrationError: "database timeout" }));
  assert.equal(outcome.status, "activated"); // the existing status is unchanged
  assert.equal(outcome.migration.state, "migration_failed");
  assert.equal(outcome.ladder.released.status, "done");
  assert.equal(outcome.ladder.migration_partial.status, "failed");
  assert.match(outcome.ladder.migration_partial.reason, /database timeout/);
  assert.equal(outcome.levels.approvedForNewCases, true);
});

test("a clean run reports migration complete and no failed stage", () => {
  const outcome = summarizeResult(released({ caseMigration: { considered: 2, migrated: 2, verified: 2, skippedFrozen: 0, failed: [], unresolved: [], reconciliationRequired: [], restored: 0, inProgress: 0 } }));
  assert.equal(outcome.migration.state, "migration_complete");
  assert.equal(outcome.ladder.migration_complete.status, "done");
  assert.equal(outcome.ladder.migration_partial.status, "skipped");
});

test("an edition kept in review is not released and its migration is not applicable", () => {
  const outcome = summarizeResult({ template: { version: "old", status: "active" }, versionChanged: false, alreadyActive: false, requiresActivation: true, activationBlockedReason: "USCIS acceptance not confirmed", certification: { passed: true } });
  assert.equal(outcome.status, "kept_in_review");
  assert.equal(outcome.migration.state, "not_applicable");
  assert.equal(outcome.ladder.released.status, "held");
  assert.equal(outcome.levels.approvedForNewCases, false);
});

test("a component discovery error after activation is its own visible answer", () => {
  const outcome = summarizeResult(released({ caseMigration: { considered: 0 }, componentDiscovery: { componentsDiscovered: 0, error: "no active component" } }));
  assert.equal(outcome.components.error, "no active component");
});

test("buildLadder never throws on odd input", () => {
  assert.deepEqual(buildLadder(null).stages, {});
  assert.doesNotThrow(() => buildLadder({ template: 5, certification: "x" }));
});

test("the sweep re-queues outdated holds, escalates persistent ones once, and survives a failing step", async () => {
  const calls = [];
  const jobService = {
    requeueOutdatedHolds: async () => 2,
    persistentHolds: async () => [{ _id: "j1" }, { _id: "j2" }],
    markEscalated: async (id) => { calls.push(["mark", id]); return true; },
  };
  const alerter = { announceEscalation: async ({ job }) => { calls.push(["escalate", job._id]); return { sent: true }; } };
  const quiet = { info() {}, warn() {} };
  const summary = await createHoldSweep({ jobService, alerter, log: quiet })();
  assert.deepEqual(summary, { requeued: 2, escalated: 2 });
  assert.deepEqual(calls.map((item) => item[0]), ["escalate", "escalate"]);
  const broken = await createHoldSweep({ jobService: { requeueOutdatedHolds: async () => { throw new Error("db"); }, persistentHolds: async () => { throw new Error("db"); } }, alerter, log: quiet })();
  assert.deepEqual(broken, { requeued: 0, escalated: 0 });
});

test("the alerter raises a migration gap once per job and state, and an escalation once, in-app only", async () => {
  const marks = new Set();
  const sent = [];
  const jobService = { markAlert: async (id, signature) => { const key = `${id}|${signature}`; if (marks.has(key)) return false; marks.add(key); return true; }, markEscalated: async () => !marks.has("esc") && marks.add("esc") };
  const alerter = createAlerter({
    jobService, env: {},
    deps: {
      email: { isConfigured: () => false, sendTemplateEmail: async () => ({}) }, notifications: { createNotification: async (payload) => { sent.push(payload); }, createForRoles: async () => [] },
      logger: { info() {}, warn() {}, error() {}, debug() {} }, listAdmins: async () => [{ _id: "a1", role: "admin" }, { _id: "a2", role: "admin" }], audit: null, describeForm: async () => ({}),
    },
  });
  const job = { _id: "j1", formCode: "I-131", state: "done", hold: { reasonCode: "X", detail: "stuck", releaseConditions: ["it clears"] } };
  const outcome = { migration: { state: "migration_partial", reason: "2 case form(s) are not on the new edition yet", counts: { failed: 2 } } };
  assert.equal((await alerter.announceMigrationGap({ job, outcome })).sent, true);
  assert.equal(sent.length, 2); // one notice per admin
  assert.equal((await alerter.announceMigrationGap({ job, outcome })).deduped, true);
  assert.equal((await alerter.announceMigrationGap({ job, outcome: { migration: { state: "migration_complete" } } })).sent, false);
  assert.equal((await alerter.announceEscalation({ job })).sent, true);
  assert.equal((await alerter.announceEscalation({ job })).deduped, true);
});

test("the worker claims nothing while the start-up self-check blocks it, but still runs its sweeps", async () => {
  const { createWorker } = require("../FormPipelineWorker");
  const JobLock = require("../../../models/JobLock");
  const saved = { updateOne: JobLock.updateOne, deleteMany: JobLock.deleteMany };
  JobLock.updateOne = async () => ({}); // the alive marker needs no database in this test
  JobLock.deleteMany = async () => ({});
  let claims = 0;
  let swept = 0;
  const jobService = { recoverExpired: async () => 0, claimNext: async () => { claims += 1; return null; } };
  const blocked = createWorker({ jobService, runner: { run: async () => ({}) }, sweeps: [async () => { swept += 1; }], canClaim: () => false, workerId: "t1", now: () => new Date() });
  await blocked.tick().catch(() => null);
  assert.equal(claims, 0);
  assert.equal(swept, 1);
  const open = createWorker({ jobService, runner: { run: async () => ({}) }, canClaim: () => true, workerId: "t2", now: () => new Date() });
  await open.tick().catch(() => null);
  assert.equal(claims, 1);
  Object.assign(JobLock, saved);
});
