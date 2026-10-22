// Phase 7.0 hold contract against the LOCAL throwaway database (pipelineDb.js refuses anything else; skipped when no local MongoDB answers).
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const { createJobService } = require("../FormPipelineJobService");
const { EVALUATOR_VERSIONS } = require("../holdContract");
const { createHoldSweep } = require("../holdSweep");

const codes = [];
const newCode = () => { const code = uniqueFormCode(); codes.push(code); return code; };
let db;
test.after(async () => { if (db?.ok && codes.length) await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: { $in: codes } }); });
db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineJob]);
test.beforeEach(async () => { if (db.ok) await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-PIPE-/ }); });

const clock = (start = new Date().toISOString()) => { let t = new Date(start).getTime(); return { now: () => new Date(t), advance: (ms) => { t += ms; } }; };
const make = (c = clock(), extra = {}) => ({ c, svc: createJobService({ now: c.now, random: () => 0.5, ...extra }) });
const reload = (id) => FormPipelineJob.findById(id).lean();
const heldError = Object.assign(new Error("USCIS acceptance not confirmed"), { name: "EditionPolicyHeldError", code: "EDITION_POLICY_HELD" });

async function heldJob(svc) {
  const { job } = await svc.enqueue({ formCode: newCode(), trigger: "catalog_sync" });
  const claim = await svc.claimNext({ workerId: "w" });
  await svc.fail(job._id, claim.lease, { stage: "promote", error: heldError });
  return job._id;
}

test("a held job records why, what would release it and which code versions judged it", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc } = make();
  const id = await heldJob(svc);
  const job = await reload(id);
  assert.equal(job.state, "held");
  assert.equal(job.hold.reasonCode, "EDITION_POLICY_HELD");
  assert.ok(job.hold.releaseConditions.length >= 1);
  assert.ok(job.hold.firstHeldAt && job.hold.lastEvaluatedAt);
  assert.deepEqual({ matcher: job.hold.evaluatedWith.matcher, gate: job.hold.evaluatedWith.gate, cert: job.hold.evaluatedWith.cert }, EVALUATOR_VERSIONS);
});

test("a held job judged again for the same reason keeps its first-held time", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const id = await heldJob(svc);
  const first = (await reload(id)).hold.firstHeldAt;
  c.advance(13 * 3600 * 1000);
  const claim = await svc.claimNext({ workerId: "w" });
  assert.ok(claim, "the held job is due again after its re-check delay");
  await svc.fail(id, claim.lease, { stage: "promote", error: heldError });
  const again = (await reload(id)).hold;
  assert.equal(new Date(again.firstHeldAt).getTime(), new Date(first).getTime());
  assert.ok(new Date(again.lastEvaluatedAt).getTime() > new Date(first).getTime());
});

test("a job that finishes no longer holds anything", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const id = await heldJob(svc);
  c.advance(13 * 3600 * 1000);
  const claim = await svc.claimNext({ workerId: "w" });
  await svc.complete(id, claim.lease, { status: "activated" });
  const job = await reload(id);
  assert.equal(job.state, "done");
  assert.equal(job.hold, undefined);
});

test("a hold judged with older code versions is put back in the queue once, with a fresh attempt budget", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const old = make(clock(), { evaluatorVersions: { matcher: 0, gate: 1, cert: 1 } });
  const id = await heldJob(old.svc);
  const current = make(old.c, { evaluatorVersions: { matcher: 1, gate: 1, cert: 1 } });
  assert.equal(await current.svc.requeueOutdatedHolds(), 1);
  const job = await reload(id);
  assert.equal(job.state, "pending");
  assert.equal(job.attempts, 0);
  assert.equal(await current.svc.requeueOutdatedHolds(), 0, "nothing left to requeue");
});

test("a hold judged with the running versions is left alone", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc } = make();
  const id = await heldJob(svc);
  assert.equal(await svc.requeueOutdatedHolds(), 0);
  assert.equal((await reload(id)).state, "held");
});

test("persistent holds appear after the period and are escalated exactly once", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc, c } = make();
  const id = await heldJob(svc);
  assert.equal((await svc.persistentHolds({ periodMs: 7 * 86400000 })).length, 0);
  c.advance(8 * 86400000);
  const list = await svc.persistentHolds({ periodMs: 7 * 86400000 });
  assert.equal(list.length, 1);
  assert.equal(String(list[0]._id), String(id));
  const raised = [];
  const sweep = createHoldSweep({ jobService: { requeueOutdatedHolds: async () => 0, persistentHolds: (o) => svc.persistentHolds({ periodMs: 7 * 86400000, ...o }), markEscalated: (x) => svc.markEscalated(x) }, alerter: { announceEscalation: async ({ job }) => { raised.push(String(job._id)); return { sent: await svc.markEscalated(job._id) }; } }, log: { info() {}, warn() {} } });
  assert.deepEqual(await sweep(), { requeued: 0, escalated: 1 });
  assert.deepEqual(await sweep(), { requeued: 0, escalated: 0 });
  assert.equal((await svc.persistentHolds({ periodMs: 7 * 86400000 })).length, 0);
  assert.equal((await svc.persistentHolds({ periodMs: 7 * 86400000, includeEscalated: true })).length, 1, "the review list still shows it");
  assert.equal(raised.length, 1);
});

test("a plain transient failure does not create a hold", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { svc } = make();
  const { job } = await svc.enqueue({ formCode: newCode() });
  const claim = await svc.claimNext({ workerId: "w" });
  await svc.fail(job._id, claim.lease, { stage: "import", error: Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }) });
  const stored = await reload(job._id);
  assert.equal(stored.state, "pending");
  assert.equal(stored.hold, undefined);
});
