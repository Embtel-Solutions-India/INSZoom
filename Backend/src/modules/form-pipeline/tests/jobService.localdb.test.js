// Phase 1 job service against the LOCAL test database (src/test-utils/pipelineDb.js refuses anything else; skipped when no local MongoDB answers).
// Real model, real indexes, a controllable clock. Every job uses a unique ZZ-PIPE-* form code and is deleted afterwards by that code.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const { createJobService } = require("../FormPipelineJobService");
const { LeaseLostError } = require("../errorClassifier");
const { LIMITS } = require("../pipeline.constants");

const codes = [];
const newCode = () => { const code = uniqueFormCode(); codes.push(code); return code; };
let db;
test.after(async () => {
  if (db?.ok && codes.length) await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: { $in: codes } });
});
db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineJob]);
// every test starts with an empty queue: jobs left by an earlier test would otherwise be claimed by this one (the database is dedicated to pipeline tests)
test.beforeEach(async () => {
  if (db.ok) await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-PIPE-/ });
});

// a clock the tests move; random fixed so backoff is exact (jitter 0)
const clock = (start = new Date().toISOString()) => { let t = new Date(start).getTime(); return { now: () => new Date(t), advance: (ms) => { t += ms; } }; };
const make = (c = clock()) => ({ c, svc: createJobService({ now: c.now, random: () => 0.5 }) });
const reload = (id) => FormPipelineJob.findById(id).lean();

test("one open job per form: a second request returns the same job, and another form gets its own", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc } = make();
  const code = newCode();
  const first = await svc.enqueue({ formCode: code.toLowerCase(), trigger: "catalog_sync" });
  const second = await svc.enqueue({ formCode: code, trigger: "admin_fetch" });
  assert.deepEqual([first.created, second.created], [true, false]);
  assert.equal(String(first.job._id), String(second.job._id));
  assert.equal(first.job.formCode, code);
  const other = await svc.enqueue({ formCode: newCode() });
  assert.equal(other.created, true);
  // the database itself enforces it, not just the read-before-insert
  await assert.rejects(FormPipelineJob.create({ formCode: code, state: "pending" }), (error) => error.code === 11000);
});

test("two workers racing for one job: exactly one claims it (fence 1, attempts 1)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc } = make();
  const code = newCode();
  const { job } = await svc.enqueue({ formCode: code });
  // other test files' jobs do not exist (own database); claims may also pick other tests' open jobs, so compare by id
  const claims = (await Promise.all(Array.from({ length: 6 }, (_, i) => svc.claimNext({ workerId: `w${i}` })))).filter(Boolean).filter((claim) => String(claim.job._id) === String(job._id));
  assert.equal(claims.length, 1);
  assert.deepEqual([claims[0].job.state, claims[0].job.attempts, claims[0].lease.fence], ["running", 1, 1]);
  assert.ok(claims[0].lease.token);
});

test("every write needs the lease: a worker that lost it changes nothing and gets LeaseLostError", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const { job } = await svc.enqueue({ formCode: newCode() });
  const first = await svc.claimNext({ workerId: "old" });
  assert.equal(String(first.job._id), String(job._id));
  // the first worker stalls; its lease runs out and the job is taken over
  c.advance(LIMITS.leaseMs + 1000);
  assert.deepEqual(await svc.recoverExpired(), { requeued: 1, deadLettered: 0 });
  c.advance(LIMITS.backoffMaxMs);
  const second = await svc.claimNext({ workerId: "new" });
  assert.equal(String(second.job._id), String(job._id));
  assert.equal(second.lease.fence, 2);
  // the old worker wakes up: every kind of write is refused
  for (const write of [
    () => svc.heartbeat(job._id, first.lease), () => svc.stageStart(job._id, first.lease, "import"), () => svc.complete(job._id, first.lease, { status: "x" }),
    () => svc.setEdition(job._id, first.lease, { editionKey: "k" }), () => svc.fail(job._id, first.lease, { stage: "import", error: new Error("boom") }).then((r) => { if (r.leaseLost) throw new LeaseLostError(); }),
    () => svc.assertLease(job._id, first.lease),
  ]) await assert.rejects(write(), (error) => error instanceof LeaseLostError || error.name === "LeaseLostError");
  const now = await reload(job._id);
  assert.equal(now.state, "running");
  assert.equal(now.lease.workerId, "new");
  assert.equal(now.editionKey, undefined, "the stale worker's edition write did not land");
  // the new owner can
  await svc.stageStart(job._id, second.lease, "import");
  assert.equal((await reload(job._id)).stages.import.status, "running");
  assert.equal((await svc.assertLease(job._id, second.lease)).currentStage, "import");
});

test("stages are recorded with attempts, timestamps and errors; the edition identity is stored", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc } = make();
  const { job } = await svc.enqueue({ formCode: newCode() });
  const { lease } = await svc.claimNext();
  await svc.stageStart(job._id, lease, "detect");
  await svc.stageFinish(job._id, lease, "detect");
  await svc.stageStart(job._id, lease, "import");
  await svc.stageFail(job._id, lease, "import", Object.assign(new Error("fetch failed at https://x.test/a?key=SECRET123"), { code: "ECONNRESET" }));
  await svc.stageStart(job._id, lease, "import"); // the second try of the same stage
  await svc.setEdition(job._id, lease, { editionKey: `${job.formCode}|2026-01-01|abc`, newTemplateId: new mongoose.Types.ObjectId(), checksum: "abc" });
  const saved = await reload(job._id);
  assert.equal(saved.stages.detect.status, "done");
  assert.equal(saved.stages.import.attempts, 2);
  assert.equal(saved.stages.import.status, "running");
  assert.equal(saved.currentStage, "import");
  assert.equal(saved.editionKey, `${job.formCode}|2026-01-01|abc`);
  assert.equal(saved.artifacts.checksum, "abc");
  const failedText = JSON.stringify((await (async () => { await svc.stageFail(job._id, lease, "import", new Error("api_key=SECRET123 failed")); return reload(job._id); })()).stages.import.error);
  assert.equal(failedText.includes("SECRET123"), false, "stored messages are sanitized");
});

test("a transient failure is retried later with backoff; when the attempts run out the job becomes dead_letter and closes", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const { job } = await svc.enqueue({ formCode: newCode() });
  await FormPipelineJob.updateOne({ _id: job._id }, { $set: { maxAttempts: 3 } });
  const delays = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    c.advance(LIMITS.backoffMaxMs + 1000);
    const claim = await svc.claimNext();
    assert.equal(String(claim.job._id), String(job._id), `attempt ${attempt} claimed`);
    const outcome = await svc.fail(job._id, claim.lease, { stage: "import", error: Object.assign(new Error("Bad Gateway"), { status: 502 }) });
    if (attempt < 3) {
      assert.equal(outcome.state, "pending");
      delays.push(outcome.nextAttemptAt.getTime() - c.now().getTime());
    } else {
      assert.equal(outcome.state, "dead_letter");
    }
  }
  assert.deepEqual(delays, [60000, 120000], "exponential backoff");
  const saved = await reload(job._id);
  assert.deepEqual([saved.state, saved.open, saved.lastError.class, saved.lastError.stage], ["dead_letter", false, "transient", "import"]);
  // closed: the form can have a new job again, and the dead one is never claimed
  c.advance(LIMITS.backoffMaxMs);
  assert.equal((await svc.enqueue({ formCode: job.formCode })).created, true);
  assert.notEqual(String((await svc.claimNext())?.job?._id), String(job._id));
});

test("a bad PDF is BLOCKED with a slow retry, and it stays the form's one open job so repeated requests do not pile up", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const blocked = await svc.enqueue({ formCode: newCode() });
  const claim = await svc.claimNext();
  const outcome = await svc.fail(blocked.job._id, claim.lease, { stage: "import", error: Object.assign(new Error("Could not locate a current PDF"), { code: "USCIS_PDF_UNRESOLVED", statusCode: 422 }) });
  assert.equal(outcome.state, "blocked");
  assert.equal(outcome.nextAttemptAt.getTime() - c.now().getTime(), LIMITS.blockedRetryMs);
  assert.equal((await reload(blocked.job._id)).open, true);
  const again = await svc.enqueue({ formCode: blocked.job.formCode });
  assert.deepEqual([again.created, String(again.job._id)], [false, String(blocked.job._id)]);
});

test("blocked jobs come back after their delay; held jobs look again only after the long re-check delay (or a manual retry)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const a = await svc.enqueue({ formCode: newCode() });
  const claimA = await svc.claimNext();
  await svc.fail(a.job._id, claimA.lease, { stage: "import", error: Object.assign(new Error("not found"), { status: 404 }) });
  assert.equal(await svc.claimNext(), null, "not due yet");
  c.advance(LIMITS.blockedRetryMs + 1000);
  const again = await svc.claimNext();
  assert.equal(String(again.job._id), String(a.job._id));
  assert.equal(again.lease.fence, 2);
  await svc.fail(a.job._id, again.lease, { stage: "promote", error: Object.assign(new Error("held"), { code: "EDITION_POLICY_HELD" }) });
  assert.equal(await svc.claimNext(), null, "held waits");
  c.advance(LIMITS.heldRecheckMs - 1000);
  assert.equal(await svc.claimNext(), null, "still not due");
  assert.equal((await reload(a.job._id)).attempts, 0, "waiting for a decision does not use up attempts");
  const retried = await svc.manualRetry(a.job._id, { email: "admin@example.com" });
  assert.deepEqual([retried.state, retried.attempts, retried.open], ["pending", 0, true]);
  assert.match(retried.history.at(-1).note, /manual retry by admin@example.com/);
  const third = await svc.claimNext();
  assert.equal(String(third.job._id), String(a.job._id));
});

test("manual retry refuses a running or finished job, and a dead-letter job when another job for the form is already open", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const running = await svc.enqueue({ formCode: newCode() });
  const claim = await svc.claimNext();
  await assert.rejects(svc.manualRetry(running.job._id), (error) => error.status === 409 && /running/.test(error.message));
  await svc.complete(running.job._id, claim.lease, { status: "no_change" });
  const finished = await reload(running.job._id);
  assert.deepEqual([finished.state, finished.open, finished.outcome.status], ["done", false, "no_change"]);
  assert.ok(finished.expireAt > c.now(), "finished jobs expire (TTL)");
  await assert.rejects(svc.manualRetry(running.job._id), (error) => error.status === 409 && /already finished/.test(error.message));
  await assert.rejects(svc.manualRetry(new mongoose.Types.ObjectId()), (error) => error.status === 404);

  const dead = await svc.enqueue({ formCode: newCode() });
  await FormPipelineJob.updateOne({ _id: dead.job._id }, { $set: { state: "dead_letter", open: false } });
  await svc.enqueue({ formCode: dead.job.formCode }); // a newer job for the same form is now open
  await assert.rejects(svc.manualRetry(dead.job._id), (error) => error.status === 409 && /already open/.test(error.message));
});

test("a worker that crashed too many times is dead-lettered by recoverExpired instead of looping forever", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const { job } = await svc.enqueue({ formCode: newCode() });
  await FormPipelineJob.updateOne({ _id: job._id }, { $set: { maxAttempts: 2 } });
  for (let i = 0; i < 2; i += 1) {
    c.advance(LIMITS.backoffMaxMs);
    await svc.claimNext();
    c.advance(LIMITS.leaseMs + 1000);
    await svc.recoverExpired();
  }
  const saved = await reload(job._id);
  assert.deepEqual([saved.state, saved.open, saved.lastError.code], ["dead_letter", false, "WORKER_LOST"]);
});

test("release hands a job back without counting the attempt; the heartbeat keeps a live lease from expiring", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const { job } = await svc.enqueue({ formCode: newCode() });
  const claim = await svc.claimNext();
  c.advance(LIMITS.leaseMs - 1000);
  await svc.heartbeat(job._id, claim.lease);
  c.advance(LIMITS.leaseMs - 1000); // past the ORIGINAL expiry, inside the extended one
  assert.deepEqual(await svc.recoverExpired(), { requeued: 0, deadLettered: 0 });
  await svc.release(job._id, claim.lease);
  const saved = await reload(job._id);
  assert.deepEqual([saved.state, saved.attempts], ["pending", 0]);
  assert.equal((await svc.claimNext()).job.attempts, 1);
});

test("alerts are announced once per signature; unknown schema versions are left alone", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc } = make();
  const { job } = await svc.enqueue({ formCode: newCode() });
  assert.equal(await svc.markAlert(job._id, "import|transient|HTTP_502", "failure"), true);
  assert.equal(await svc.markAlert(job._id, "import|transient|HTTP_502", "failure"), false, "the same failure again is not announced again");
  assert.equal(await svc.markAlert(job._id, "import|blocked|HTTP_404", "blocked"), true, "a different signature is");
  const future = await svc.enqueue({ formCode: newCode() });
  await FormPipelineJob.updateOne({ _id: future.job._id }, { $set: { schemaVersion: 99 } });
  const claims = [];
  for (let i = 0; i < 4; i += 1) { const claim = await svc.claimNext(); if (claim) claims.push(String(claim.job._id)); }
  assert.equal(claims.includes(String(future.job._id)), false, "a job written by a newer worker version is not touched");
});

test("list and get return plain, filterable job records; staleQueued finds jobs nobody picked up", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const code = newCode();
  const { job } = await svc.enqueue({ formCode: code, trigger: "admin_fetch" });
  assert.equal((await svc.get(job._id)).trigger, "admin_fetch");
  assert.equal((await svc.list({ formCode: code })).length, 1);
  assert.equal((await svc.list({ formCode: code, state: "done" })).length, 0);
  assert.equal((await svc.staleQueued()).filter((item) => item.formCode === code).length, 0, "fresh");
  c.advance(LIMITS.queuedAlertAfterMs + 1000);
  assert.equal((await svc.staleQueued()).filter((item) => item.formCode === code).length, 1);
});
