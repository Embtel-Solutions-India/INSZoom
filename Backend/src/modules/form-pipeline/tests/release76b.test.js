// Phase 7.6b without a database: the system approval actor, the queued case-migration stage (scheduling + executor), and the proof that off / shadow change nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { SYSTEM_ACTOR_ID, systemActor, isSystemActor, approvedBy } = require("../systemActor");
const queue = require("../caseMigrationQueue");
const { createDefaultExecutor, runMigrationJob, withFollowUpMigration } = require("../pipelineExecutor");
const { summarizeResult } = require("../FormPipelineRunner");

const id = () => new mongoose.Types.ObjectId();
const template = (extra = {}) => ({ _id: id(), formCode: "I-131", status: "active", version: "2026-01-01", ...extra });
const quiet = { info() {}, warn() {} };

// ── the system actor ─────────────────────────────────────────────────────
test("the system actor is a fixed, valid ObjectId that no real user can have, and is recognised", () => {
  assert.ok(mongoose.Types.ObjectId.isValid(SYSTEM_ACTOR_ID));
  assert.equal(String(systemActor()._id), SYSTEM_ACTOR_ID);
  assert.equal(Buffer.from(SYSTEM_ACTOR_ID, "hex").toString("ascii"), "system:pipel");
  assert.equal(isSystemActor(systemActor()), true);
  assert.equal(isSystemActor({ _id: id(), role: "admin" }), false);
  assert.equal(systemActor().email, "system:pipeline");
});

test("approvedBy: only the autonomy switch ON swaps in the system actor; off and shadow keep the person the run acts as", () => {
  const person = { _id: id(), role: "admin" };
  assert.equal(approvedBy(person, { mode: "off" }), person);
  assert.equal(approvedBy(person, { mode: "shadow" }), person);
  assert.equal(isSystemActor(approvedBy(person, { mode: "on" })), true);
});

// ── scheduling the migration ─────────────────────────────────────────────
const fakeJobs = (existing = null) => {
  const calls = { enqueue: [], followUp: [] };
  return {
    calls,
    jobService: {
      enqueue: async (args) => { calls.enqueue.push(args); return existing ? { job: existing, created: false } : { job: { _id: id(), trigger: args.trigger, options: args.options }, created: true }; },
      setFollowUpMigration: async (jobId, templateId) => { calls.followUp.push([String(jobId), String(templateId)]); return true; },
      get: async () => null,
    },
  };
};

test("off schedules nothing and does not even touch the job store", async () => {
  const { jobService, calls } = fakeJobs();
  const result = await queue.scheduleCaseMigration({ template: template(), mode: "off", deps: { jobService } });
  assert.deepEqual(result, { scheduled: "off" });
  assert.equal(calls.enqueue.length, 0);
});

test("shadow only logs what it would do: nothing is queued", async () => {
  const { jobService, calls } = fakeJobs();
  const result = await queue.scheduleCaseMigration({ template: template(), mode: "shadow", deps: { jobService } });
  assert.equal(result.scheduled, "shadow");
  assert.equal(calls.enqueue.length, 0);
});

test("on, no open job: ONE case_migration job for the edition, requested by nobody when the actor is the system", async () => {
  const { jobService, calls } = fakeJobs();
  const t = template();
  const result = await queue.scheduleCaseMigration({ template: t, user: systemActor(), mode: "on", deps: { jobService } });
  assert.equal(result.scheduled, "job");
  assert.equal(calls.enqueue.length, 1);
  assert.equal(calls.enqueue[0].trigger, "case_migration");
  assert.equal(String(calls.enqueue[0].options.migrateTemplateId), String(t._id));
  assert.equal(calls.enqueue[0].requestedBy, undefined);
  const person = { _id: id(), role: "admin" };
  await queue.scheduleCaseMigration({ template: t, user: person, mode: "on", deps: { jobService } });
  assert.equal(String(calls.enqueue[1].requestedBy), String(person._id));
});

test("on, a pipeline job for the form is open: NO second job - the edition becomes that job's follow-up", async () => {
  const open = { _id: id(), trigger: "admin_fetch", open: true, options: {} };
  const { jobService, calls } = fakeJobs(open);
  const t = template();
  const result = await queue.scheduleCaseMigration({ template: t, mode: "on", deps: { jobService, joinRecheckMs: 1e9 } });
  assert.deepEqual([result.scheduled, result.jobId], ["joined", String(open._id)]);
  assert.deepEqual(calls.followUp, [[String(open._id), String(t._id)]]);
});

test("on, the same migration is already queued: reported as already, nothing changes", async () => {
  const t = template();
  const open = { _id: id(), trigger: "case_migration", open: true, options: { migrateTemplateId: t._id } };
  const { jobService, calls } = fakeJobs(open);
  const result = await queue.scheduleCaseMigration({ template: t, mode: "on", deps: { jobService } });
  assert.equal(result.scheduled, "already");
  assert.equal(calls.followUp.length, 0);
});

test("scheduling never throws, even when the job store does", async () => {
  const jobService = { enqueue: async () => { throw new Error("db down"); } };
  const result = await queue.scheduleCaseMigration({ template: template(), mode: "on", deps: { jobService } });
  assert.equal(result.scheduled, "failed");
  assert.equal((await queue.scheduleCaseMigration({ mode: "on" })).scheduled, "skipped");
});

test("a follow-up whose job closed before the executor looked is re-queued as a case_migration job; a consumed one is not", async () => {
  const t = template();
  const queued = [];
  const jobs = { enqueue: async (args) => { queued.push(args); return { created: true, job: {} }; } };
  const closedUnconsumed = { ...jobs, get: async () => ({ open: false, options: { followUpMigrationTemplateId: t._id } }) };
  const closedConsumed = { ...jobs, get: async () => ({ open: false, options: {} }) };
  queue.armJoinCheck({ jobService: closedUnconsumed, jobId: id(), template: t, deps: { joinRecheckMs: 5 } });
  queue.armJoinCheck({ jobService: closedConsumed, jobId: id(), template: t, deps: { joinRecheckMs: 5 } });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].trigger, "case_migration");
});

// ── the executor ─────────────────────────────────────────────────────────
const stage = { stage: async (name, fn) => fn() };
const migrationOf = (extra = {}) => ({ considered: 3, migrated: 3, verified: 3, skippedFrozen: 0, failed: [], unresolved: [], reconciliationRequired: [], ...extra });

test("off and shadow: the executor is exactly the old one - the follow-up machinery is never consulted", async () => {
  const result = { template: template(), versionChanged: true };
  for (const mode of ["off", "shadow"]) {
    const execute = createDefaultExecutor({
      acquisition: () => ({ ensureCurrentUSCISForm: async () => result }), actorFor: async () => ({ role: "admin" }), mode: () => mode,
      migration: { JobModel: { findById() { throw new Error("must not be read"); } } },
    });
    assert.equal(await execute({ _id: id(), formCode: "I-131", trigger: "case_migration", options: {} }, stage), result, `${mode}: a case_migration job is still just a normal run`);
  }
});

test("a case_migration job moves the cases, reports a migration result, and is never reported as a release", async () => {
  const t = template();
  const recorded = [];
  const q = { runMigrationStage: async () => ({ caseMigration: migrationOf() }) };
  const result = await runMigrationJob({ _id: id(), attempts: 1, maxAttempts: 5, options: { migrateTemplateId: t._id } }, stage, { role: "admin" }, {}, { queue: q, loadTemplateFn: async () => t, record: async (x) => recorded.push(x) });
  assert.equal(result.kind, "case_migration");
  assert.equal(recorded.length, 1);
  const outcome = summarizeResult(result);
  assert.equal(outcome.status, "case_migration");
  assert.equal(outcome.migration.state, "migration_complete");
});

test("failed case forms are retried by the job's own backoff; on the last attempt the partial result is reported instead of failing", async () => {
  const t = template();
  const q = { runMigrationStage: async () => ({ caseMigration: migrationOf({ migrated: 2, failed: [{ caseFormId: "x" }] }) }) };
  const run = (attempts) => runMigrationJob({ _id: id(), attempts, maxAttempts: 5, options: { migrateTemplateId: t._id } }, stage, {}, {}, { queue: q, loadTemplateFn: async () => t, record: async () => undefined });
  await assert.rejects(run(2), (error) => error.code === "CASE_MIGRATION_INCOMPLETE");
  const last = await run(5);
  assert.equal(summarizeResult(last).migration.state, "migration_partial");
});

test("an edition that is no longer live is never migrated to, and a missing one is reported", async () => {
  const q = { runMigrationStage: async () => { throw new Error("must not run"); } };
  const retired = template({ status: "retired" });
  const skipped = await runMigrationJob({ _id: id(), options: { migrateTemplateId: retired._id } }, stage, {}, {}, { queue: q, loadTemplateFn: async () => retired });
  assert.equal(skipped.skipped, "edition_no_longer_active");
  const missing = await runMigrationJob({ _id: id(), options: { migrateTemplateId: id() } }, stage, {}, {}, { queue: q, loadTemplateFn: async () => null });
  assert.match(missing.caseMigrationError, /no longer exists/);
});

const jobModel = (followUp) => {
  const calls = { cleared: 0 };
  return { calls, model: { findById: () => ({ select: () => ({ lean: async () => ({ options: followUp ? { followUpMigrationTemplateId: followUp } : {} }) }) }), updateOne: async () => { calls.cleared += 1; return {}; } } };
};

test("a normal run with a follow-up: the migration runs as its last stage, the follow-up is consumed, and the release result keeps its release status", async () => {
  const t = template();
  const { model, calls } = jobModel(t._id);
  const q = { runMigrationStage: async () => ({ caseMigration: migrationOf({ migrated: 5 }) }) };
  const base = { template: t, versionChanged: true, requiresActivation: false, certification: { passed: true } };
  const result = await withFollowUpMigration(base, { _id: id() }, stage, {}, {}, { queue: q, JobModel: model, loadTemplateFn: async () => t, record: async () => undefined, defer: () => assert.fail("no retry needed") });
  assert.equal(calls.cleared, 1);
  const outcome = summarizeResult(result);
  assert.equal(outcome.status, "activated");
  assert.equal(outcome.migration.state, "migration_complete");
});

test("a follow-up in a run that released nothing becomes a migration result; failed case forms are queued for another try", async () => {
  const t = template();
  const { model } = jobModel(t._id);
  const q = { runMigrationStage: async () => ({ caseMigration: migrationOf({ failed: [{ caseFormId: "a" }] }) }) };
  const deferred = [];
  const result = await withFollowUpMigration({ template: t, alreadyActive: true, checked: true }, { _id: id() }, stage, {}, {}, { queue: q, JobModel: model, loadTemplateFn: async () => t, record: async () => undefined, defer: (x) => deferred.push(x) });
  assert.equal(result.kind, "case_migration");
  assert.equal(deferred.length, 1);
  assert.equal(summarizeResult(result).migration.state, "migration_partial");
});

test("no follow-up recorded: the result is returned untouched and nothing is migrated", async () => {
  const { model } = jobModel(null);
  const result = { template: template(), versionChanged: true };
  const out = await withFollowUpMigration(result, { _id: id() }, stage, {}, {}, { queue: { runMigrationStage: async () => assert.fail("must not run") }, JobModel: model });
  assert.equal(out, result);
});

test("a migration job runs through the executor only with the switch ON", async () => {
  const t = template();
  const execute = createDefaultExecutor({
    acquisition: () => ({ ensureCurrentUSCISForm: async () => assert.fail("a case_migration job does not re-import the form") }), actorFor: async () => ({ role: "admin" }), mode: () => "on",
    migration: { queue: { runMigrationStage: async () => ({ caseMigration: migrationOf() }) }, loadTemplateFn: async () => t, record: async () => undefined },
  });
  const result = await execute({ _id: id(), formCode: t.formCode, trigger: "case_migration", attempts: 1, maxAttempts: 5, options: { migrateTemplateId: t._id } }, stage);
  assert.equal(result.kind, "case_migration");
});
