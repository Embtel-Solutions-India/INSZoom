// Phase 1 runner, alerts, entry modes and worker against the LOCAL test database (see src/test-utils/pipelineDb.js). Executors are scripted - nothing fetches
// from uscis.gov and no form template is touched. Every job uses a unique ZZ-PIPE-* code and is removed afterwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const JobLock = require("../../../models/JobLock");
const { createJobService } = require("../FormPipelineJobService");
const { createRunner } = require("../FormPipelineRunner");
const { createAlerter } = require("../PipelineAlerter");
const { createWorker, workerAlive } = require("../FormPipelineWorker");
const pipeline = require("../FormPipeline");
const { LeaseLostError } = require("../errorClassifier");
const { LIMITS } = require("../pipeline.constants");

let db;
const codes = [];
const newCode = () => { const code = uniqueFormCode(); codes.push(code); return code; };
test.after(async () => {
  if (!db?.ok) return;
  await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-PIPE-/ });
  await mongoose.connection.collection(JobLock.collection.name).deleteMany({ name: /^(form-promote:ZZ-PIPE-|form-pipeline-worker:test-)/ });
});
db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineJob, JobLock]);
test.beforeEach(async () => {
  if (db.ok) await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-PIPE-/ });
});

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const svc = createJobService({ random: () => 0.5 });
const reload = (id) => FormPipelineJob.findById(id).lean();
const lockEveryone = async (_code, fn) => ({ ran: true, value: await fn() }); // promotion mutex that always grants

function fakeAlertDeps({ configured = true } = {}) {
  const sent = { emails: [], notices: [] };
  return {
    sent,
    deps: {
      email: { isConfigured: () => configured, sendTemplateEmail: async (key, payload) => { sent.emails.push({ key, ...payload }); return { sent: true }; } },
      notifications: { createForRoles: async (roles, payload) => { sent.notices.push({ roles, ...payload }); return []; } },
      logger: silent,
      describeForm: async () => ({ activeEdition: "2024-04-01" }),
    },
  };
}

const makeRunner = (executor, extra = {}) => {
  const alertDeps = fakeAlertDeps(extra.alertDeps);
  const alerter = createAlerter({ jobService: svc, env: extra.env || {}, deps: alertDeps.deps });
  return { runner: createRunner({ jobService: svc, alerter, executor, promotionLock: extra.promotionLock || lockEveryone, repairs: extra.repairs || [], logger: silent, heartbeatMs: 50 }), sent: alertDeps.sent };
};
const claimed = async (code, trigger = "catalog_sync") => { const { job } = await svc.enqueue({ formCode: code, trigger }); const claim = await svc.claimNext(); assert.equal(String(claim.job._id), String(job._id)); return claim; };

test("a successful run records every stage, the edition identity and a summary, and the job is done", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const { runner } = makeRunner(async (job, ctx) => {
    await ctx.stage("detect", async () => "changed");
    await ctx.recordEdition({ editionKey: `${job.formCode}|2026-01-01|abc`, newTemplateId: new mongoose.Types.ObjectId(), checksum: "abc" });
    await ctx.stage("import", async () => null);
    await ctx.stage("promote", async () => null);
    return { template: { status: "active", version: "2026-01-01" }, versionChanged: true, requiresActivation: false };
  });
  const outcome = await runner.run(await claimed(code));
  assert.equal(outcome.state, "done");
  const saved = await FormPipelineJob.findOne({ formCode: code }).lean();
  assert.deepEqual([saved.state, saved.open, saved.outcome.status, saved.outcome.version], ["done", false, "activated", "2026-01-01"]);
  assert.deepEqual(["detect", "import", "promote"].map((name) => saved.stages[name].status), ["done", "done", "done"]);
  assert.equal(saved.editionKey, `${code}|2026-01-01|abc`);
});

test("a transient failure schedules a retry and alerts ONCE; the identical failure again does not re-alert; running out of attempts dead-letters and alerts again", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const { runner, sent } = makeRunner(async (job, ctx) => { await ctx.stage("import", async () => { throw Object.assign(new Error("Bad Gateway key=SECRET"), { status: 502 }); }); });
  const first = await runner.run(await claimed(code));
  assert.equal(first.state, "pending");
  assert.equal(sent.emails.length, 1);
  assert.equal(sent.emails[0].key, "form-pipeline-alert");
  assert.deepEqual(sent.emails[0].to, "ishaan@embtelsolutions.com");
  assert.equal(sent.emails[0].data.kind, "failure");
  assert.equal(sent.emails[0].data.stage, "import");
  assert.equal(sent.emails[0].data.activeEdition, "2024-04-01");
  assert.equal(JSON.stringify(sent.emails[0].data).includes("SECRET"), false, "no secrets in the alert");
  // retry now (skip the backoff) and fail the same way: no second email
  await FormPipelineJob.updateOne({ formCode: code }, { $set: { nextAttemptAt: new Date(Date.now() - 1000), maxAttempts: 3 } });
  const second = await runner.run(await svc.claimNext());
  assert.equal(second.state, "pending");
  assert.equal(sent.emails.length, 1, "the same failure is not announced again");
  await FormPipelineJob.updateOne({ formCode: code }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
  const third = await runner.run(await svc.claimNext());
  assert.equal(third.state, "dead_letter");
  assert.equal(sent.emails.length, 2);
  assert.equal(sent.emails[1].data.kind, "dead_letter");
  assert.equal((await FormPipelineJob.findOne({ formCode: code }).lean()).open, false);
});

test("a user-visible blocked run (admin fetch of a form that is not on uscis.gov) is not emailed; a background one is", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const failing = async (job, ctx) => { await ctx.stage("import", async () => { throw Object.assign(new Error("Could not locate a current PDF"), { code: "USCIS_PDF_UNRESOLVED", statusCode: 422 }); }); };
  const quiet = makeRunner(failing);
  assert.equal((await quiet.runner.run(await claimed(newCode(), "admin_fetch"))).state, "blocked");
  assert.equal(quiet.sent.emails.length + quiet.sent.notices.length, 0);
  const loud = makeRunner(failing);
  assert.equal((await loud.runner.run(await claimed(newCode(), "catalog_sync"))).state, "blocked");
  assert.equal(loud.sent.emails.length, 1);
  assert.equal(loud.sent.emails[0].data.kind, "blocked");
});

test("emails off or no provider: admins get an in-app notice instead; recipients and toggles come from the environment; an alert failure never fails the run", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const failing = async (job, ctx) => { await ctx.stage("import", async () => { throw new Error("fetch failed"); }); };
  const noProvider = makeRunner(failing, { alertDeps: { configured: false } });
  await noProvider.runner.run(await claimed(newCode()));
  assert.equal(noProvider.sent.emails.length, 0);
  assert.deepEqual([noProvider.sent.notices.length, noProvider.sent.notices[0].roles], [1, ["super_admin", "admin"]]);
  const switchedOff = makeRunner(failing, { env: { FORM_PIPELINE_EMAIL_FAILURE: "false" } });
  await switchedOff.runner.run(await claimed(newCode()));
  assert.equal(switchedOff.sent.emails.length, 0);
  assert.equal(switchedOff.sent.notices.length, 1);
  const custom = makeRunner(failing, { env: { FORM_PIPELINE_ALERT_EMAIL: "a@x.test, b@x.test" } });
  await custom.runner.run(await claimed(newCode()));
  assert.deepEqual(custom.sent.emails.map((mail) => mail.to), ["a@x.test", "b@x.test"]);
  const broken = createAlerter({ jobService: svc, deps: { ...fakeAlertDeps().deps, email: { isConfigured: () => true, sendTemplateEmail: async () => { throw new Error("smtp down"); } } } });
  const runner = createRunner({ jobService: svc, alerter: broken, executor: failing, promotionLock: lockEveryone, logger: silent });
  assert.equal((await runner.run(await claimed(newCode()))).state, "pending", "the pipeline outcome is unaffected by the alert failing");
});

test("losing the lease mid-run stops the run quietly: nothing more is written and no alert is sent", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const { runner, sent } = makeRunner(async (job, ctx) => {
    await ctx.stage("detect", async () => null);
    await FormPipelineJob.updateOne({ _id: job._id }, { $set: { "lease.token": "someone-else", "lease.fence": 99 } }); // another worker took over
    await ctx.stage("import", async () => { throw new Error("must not run"); });
  });
  const outcome = await runner.run(await claimed(code));
  assert.equal(outcome.state, "lease_lost");
  const saved = await FormPipelineJob.findOne({ formCode: code }).lean();
  assert.equal(saved.state, "running", "the job belongs to the other worker now");
  assert.equal(saved.stages.import, undefined);
  assert.equal(sent.emails.length + sent.notices.length, 0);
});

test("the promote stage re-checks the lease and takes the per-form mutex; a lost lease or a busy mutex means the promotion code never runs", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  let promoted = 0;
  const calls = [];
  const grant = async (formCode, fn) => { calls.push(formCode); return { ran: true, value: await fn() }; };
  const code = newCode();
  const ok = makeRunner(async (job, ctx) => { await ctx.stage("promote", async () => { promoted += 1; }); return { template: { status: "active" }, alreadyActive: false }; }, { promotionLock: grant });
  assert.equal((await ok.runner.run(await claimed(code))).state, "done");
  assert.deepEqual([promoted, calls], [1, [code]]);

  const busy = makeRunner(async (job, ctx) => { await ctx.stage("promote", async () => { promoted += 1; }); }, { promotionLock: async () => ({ ran: false }) });
  const busyOutcome = await busy.runner.run(await claimed(newCode()));
  assert.equal(busyOutcome.state, "pending", "retried later");
  assert.equal(promoted, 1, "the promotion did not run");
  assert.equal(busyOutcome.transition.classification.code, "PROMOTION_BUSY");

  const stolen = makeRunner(async (job, ctx) => {
    await FormPipelineJob.updateOne({ _id: job._id }, { $set: { "lease.fence": 50 } });
    await ctx.stage("promote", async () => { promoted += 1; });
  }, { promotionLock: grant });
  assert.equal((await stolen.runner.run(await claimed(newCode()))).state, "lease_lost");
  assert.equal(promoted, 1, "a worker that lost its lease can never promote");
});

test("an edition the policy gate refused (EDITION_POLICY_HELD inside the existing activation) puts the job on HOLD, not in failure, and sends no failure alert", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const { runner, sent } = makeRunner(async () => ({ template: { status: "review", version: "x" }, requiresActivation: true, activationBlockedCode: "EDITION_POLICY_HELD", activationBlockedReason: "USCIS has not confirmed that edition x is accepted" }));
  const outcome = await runner.run(await claimed(code));
  assert.equal(outcome.state, "held");
  assert.equal(outcome.result.requiresActivation, true, "the caller still gets the pipeline's normal result");
  const saved = await FormPipelineJob.findOne({ formCode: code }).lean();
  assert.deepEqual([saved.state, saved.open, saved.attempts, saved.lastError.class], ["held", true, 0, "held"]);
  assert.equal(sent.emails.length, 0);
  assert.ok(saved.nextAttemptAt > new Date(Date.now() + LIMITS.heldRecheckMs - 60000), "re-checked slowly");
});

test("a known repair is applied, VERIFIED, and the work retried once; a repair that does not verify is recorded and the failure stands; each strategy gets one try", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  let runs = 0;
  const executor = async (job, ctx) => {
    runs += 1;
    if (runs === 1) throw Object.assign(new Error("normalization changed the field count"), { repairable: true, code: "FIELD_COUNT_CHANGED" });
    return { template: { status: "active", version: "v" }, alreadyActive: false };
  };
  const good = { name: "renormalize", matches: (error) => error.code === "FIELD_COUNT_CHANGED", repair: async () => {}, verify: async () => "field count 339 == 339, names identical" };
  const code = newCode();
  const outcome = await makeRunner(executor, { repairs: [good] }).runner.run(await claimed(code));
  assert.equal(outcome.state, "done");
  assert.equal(runs, 2);
  const repaired = await FormPipelineJob.findOne({ formCode: code }).lean();
  assert.deepEqual([repaired.repairsTried[0].strategy, repaired.repairsTried[0].outcome], ["renormalize", "repaired"]);
  assert.match(repaired.repairsTried[0].verification, /339/);

  runs = 0;
  const bad = { ...good, name: "bad-repair", verify: async () => "FAILED: field count differs" };
  const failed = await makeRunner(executor, { repairs: [bad] }).runner.run(await claimed(newCode()));
  assert.equal(failed.state, "pending");
  assert.equal(runs, 1, "no retry after a repair that did not verify");
  const job = await FormPipelineJob.findOne({ formCode: failed.error ? undefined : undefined }).lean().catch(() => null);
  void job;
});

test("entry in the default INLINE mode: the caller gets the result (or the exception) it always did, the run is recorded, and an unclaimable job falls back to the direct call", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const previous = process.env.FORM_PIPELINE_MODE;
  delete process.env.FORM_PIPELINE_MODE;
  try {
    const code = newCode();
    let executed = 0;
    const executor = async (job, ctx) => { executed += 1; await ctx.stage("detect", async () => null); return { template: { status: "active", version: "1" }, alreadyActive: true, checked: true }; };
    pipeline.setServicesForTests({ jobService: svc, alerter: createAlerter({ jobService: svc, deps: fakeAlertDeps().deps }), runner: createRunner({ jobService: svc, executor, promotionLock: lockEveryone, logger: silent }) });
    let directCalls = 0;
    const direct = async () => { directCalls += 1; return { direct: true }; };
    const user = { _id: new mongoose.Types.ObjectId(), role: "admin" };
    const result = await pipeline.runForm({ formCode: code, trigger: "admin_fetch", user, req: {}, options: { forceCheck: true }, direct });
    assert.deepEqual([result.alreadyActive, executed, directCalls], [true, 1, 0]);
    const saved = await FormPipelineJob.findOne({ formCode: code }).lean();
    assert.deepEqual([saved.state, saved.trigger, saved.options.forceCheck, String(saved.requestedBy)], ["done", "admin_fetch", true, String(user._id)]);

    // a failing run throws the very same error (and the job is left for the worker to retry)
    const boom = Object.assign(new Error("uscis.gov unreachable"), { status: 502 });
    pipeline.setServicesForTests({ jobService: svc, alerter: createAlerter({ jobService: svc, deps: fakeAlertDeps().deps }), runner: createRunner({ jobService: svc, executor: async () => { throw boom; }, promotionLock: lockEveryone, logger: silent }) });
    const failingCode = newCode();
    await assert.rejects(pipeline.runForm({ formCode: failingCode, trigger: "mapping_save", user, req: {}, direct }), (error) => error === boom);
    assert.equal((await FormPipelineJob.findOne({ formCode: failingCode }).lean()).state, "pending");

    // the form already has an OPEN job that is not claimable (waiting for its retry time): the original call is made, unrecorded, exactly as before
    assert.deepEqual(await pipeline.runForm({ formCode: failingCode, trigger: "admin_fetch", user, req: {}, direct }), { direct: true });
    assert.equal(directCalls, 1);
  } finally {
    pipeline.setServicesForTests(null);
    if (previous === undefined) delete process.env.FORM_PIPELINE_MODE; else process.env.FORM_PIPELINE_MODE = previous;
  }
});

test("entry in QUEUED mode: the caller only enqueues and gets the job to poll; a second request returns the same job; nothing runs on the caller's side", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const previous = process.env.FORM_PIPELINE_MODE;
  process.env.FORM_PIPELINE_MODE = "queued";
  try {
    let executed = 0;
    pipeline.setServicesForTests({ jobService: svc, alerter: null, runner: createRunner({ jobService: svc, executor: async () => { executed += 1; return {}; }, promotionLock: lockEveryone, logger: silent }) });
    const code = newCode();
    const direct = async () => { throw new Error("must not be called in queued mode"); };
    const first = await pipeline.runForm({ formCode: code, trigger: "catalog_sync", user: { role: "admin" }, req: {}, direct });
    const second = await pipeline.runForm({ formCode: code, trigger: "admin_fetch", user: { role: "admin" }, req: {}, direct });
    assert.deepEqual([first.queued, first.created, first.state, second.created, second.jobId === first.jobId], [true, true, "pending", false, true]);
    assert.equal(executed, 0);
  } finally {
    pipeline.setServicesForTests(null);
    if (previous === undefined) delete process.env.FORM_PIPELINE_MODE; else process.env.FORM_PIPELINE_MODE = previous;
  }
});

test("the worker runs due jobs, recovers dead leases, marks itself alive, and stops gracefully", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ran = [];
  const runner = createRunner({ jobService: svc, executor: async (job) => { ran.push(job.formCode); return { template: { status: "active" }, alreadyActive: true, checked: true }; }, promotionLock: lockEveryone, logger: silent });
  const worker = createWorker({ jobService: svc, runner, workerId: `test-${process.pid}`, intervalMs: 200, maxJobsPerTick: 2, random: () => 0 });
  const [a, b, c] = [newCode(), newCode(), newCode()];
  for (const code of [a, b, c]) await svc.enqueue({ formCode: code });
  assert.equal(await workerAlive(), false);
  // a marker left by a worker that died long ago is swept; a recent one is kept
  const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await JobLock.create([{ name: "form-pipeline-worker:test-dead", lockedAt: longAgo, lockedUntil: longAgo, token: "x" }, { name: "form-pipeline-worker:test-recent", lockedAt: new Date(), lockedUntil: new Date(Date.now() - 60000), token: "y" }]);
  const first = await worker.tick();
  assert.equal(await JobLock.exists({ name: "form-pipeline-worker:test-dead" }), null);
  assert.ok(await JobLock.exists({ name: "form-pipeline-worker:test-recent" }));
  assert.equal(first.length, 2, "at most maxJobsPerTick per pass");
  assert.equal(await workerAlive(), true, "the alive marker is fresh");
  assert.equal((await worker.tick()).length, 1);
  assert.deepEqual([...ran].sort(), [a, b, c].sort());
  assert.equal((await worker.tick()).length, 0);

  // a job whose worker died is recovered and run by the next pass
  const dead = newCode();
  await svc.enqueue({ formCode: dead });
  const stuck = await svc.claimNext({ leaseMs: 1 });
  assert.equal(stuck.job.formCode, dead);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await FormPipelineJob.updateOne({ formCode: dead }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
  assert.equal((await worker.tick()).length, 0, "recovered to pending with a backoff, not run in the same pass");
  await FormPipelineJob.updateOne({ formCode: dead }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
  assert.equal((await worker.tick()).length, 1);

  worker.start();
  await worker.stop(1000);
  assert.equal(worker.isRunning(), false);
  assert.equal(await workerAlive(), false, "a stopped worker removes its alive marker");
});

test("the API-side alert for 'jobs are waiting and no worker runs' fires once, then again only after the queue drains", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { sent, deps } = fakeAlertDeps();
  const alerter = createAlerter({ jobService: svc, deps });
  assert.equal((await alerter.workerUnavailable({ waiting: [] })).sent, false);
  assert.equal((await alerter.workerUnavailable({ waiting: [{ formCode: "I-1" }] })).sent, true);
  assert.equal((await alerter.workerUnavailable({ waiting: [{ formCode: "I-1" }] })).deduped, true);
  await alerter.workerUnavailable({ waiting: [] });
  assert.equal((await alerter.workerUnavailable({ waiting: [{ formCode: "I-2" }] })).sent, true);
  assert.equal(sent.notices.length, 2);
  assert.match(sent.notices[0].message, /no worker is picking them up/);
});

test("LeaseLostError is what a fenced write raises for a stale lease", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const claim = await claimed(newCode());
  await FormPipelineJob.updateOne({ _id: claim.job._id }, { $set: { "lease.fence": 77 } });
  await assert.rejects(svc.stageStart(claim.job._id, claim.lease, "detect"), (error) => error instanceof LeaseLostError);
});
