// Phase 5E: the digest store on the real FormPipelineDigest model, and the runner -> alerter hooks on real jobs. LOCAL throwaway test database only (src/test-utils/pipelineDb.js);
// the mail provider is a mock - nothing is sent. Tests clean up exactly the documents they created (ZZ-PIPE-* form codes, test:* digest keys).
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const FormPipelineDigest = require("../../../models/FormPipelineDigest");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const JobLock = require("../../../models/JobLock");
const { createDigestStore } = require("../alerts/digestStore");
const { createJobService } = require("../FormPipelineJobService");
const { createRunner } = require("../FormPipelineRunner");
const { createAlerter } = require("../PipelineAlerter");

const silent = { info() {}, warn() {}, error() {}, debug() {} };
let db;
const run = `test:${process.pid}:${Date.now()}`;
const keyFor = (name) => `${run}:${name}`;
test.after(async () => {
  if (!db.ok) return;
  await mongoose.connection.collection(FormPipelineDigest.collection.name).deleteMany({ key: new RegExp(`^${run}`) });
  await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-PIPE-/ });
});
db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineDigest, FormPipelineJob, JobLock]);

test("the per-run cap is counted atomically: concurrent reservations never exceed it", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const store = createDigestStore();
  const key = keyFor("cap");
  const results = await Promise.all(Array.from({ length: 12 }, () => store.reserveIndividual(key, 5)));
  assert.equal(results.filter(Boolean).length, 5);
  assert.equal(await store.reserveIndividual(key, 0), false);
  const docs = await FormPipelineDigest.find({ key, state: "open" }).lean();
  assert.equal(docs.length, 1, "one open window per key");
  assert.equal(docs[0].individualSent, 5);
});

test("entries are collected, claimed once after the quiet period, marked sent (and expire later); a failed send releases the window", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const store = createDigestStore();
  const key = keyFor("collect");
  await store.addEntry(key, { formCode: "ZZ-PIPE-1", fromEdition: "2024", toEdition: "2025", release: "promoted", jobId: "j1", trigger: "catalog_sync" });
  await store.addEntry(key, { formCode: "ZZ-PIPE-2", toEdition: "2025", release: "degraded", jobId: "j2", trigger: "catalog_sync" });
  assert.deepEqual(await store.claimDue({ quietMs: 10 * 60 * 1000 }), [], "still within the quiet period");
  const later = new Date(Date.now() + 11 * 60 * 1000);
  const [first, second] = await Promise.all([store.claimDue({ quietMs: 10 * 60 * 1000, now: later }), store.claimDue({ quietMs: 10 * 60 * 1000, now: later })]);
  const claimed = [...first, ...second].filter((doc) => doc.key === key);
  assert.equal(claimed.length, 1, "two processes can never claim the same window");
  assert.deepEqual([claimed[0].count, claimed[0].entries.map((item) => item.formCode), claimed[0].state], [2, ["ZZ-PIPE-1", "ZZ-PIPE-2"], "sending"]);
  await store.release(claimed[0]._id);
  assert.equal((await FormPipelineDigest.findById(claimed[0]._id).lean()).state, "open");
  const again = (await store.claimDue({ quietMs: 10 * 60 * 1000, now: later })).filter((doc) => doc.key === key);
  assert.equal(again.length, 1);
  await store.markSent(again[0]._id);
  const sent = await FormPipelineDigest.findById(again[0]._id).lean();
  assert.equal(sent.state, "sent");
  assert.ok(sent.sentAt && sent.expiresAt > sent.sentAt, "finished windows expire");
  // the next success starts a NEW window
  await store.addEntry(key, { formCode: "ZZ-PIPE-3", toEdition: "2026", release: "promoted", jobId: "j3", trigger: "catalog_sync" });
  assert.equal(await FormPipelineDigest.countDocuments({ key, state: "open" }), 1);
});

test("the unique partial index allows ONE open window per key but any number of finished ones", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const key = keyFor("unique");
  await FormPipelineDigest.collection.createIndex({ key: 1 }, { unique: true, partialFilterExpression: { state: "open" }, name: "one_open_digest_per_key" }).catch(() => null);
  await FormPipelineDigest.create({ key, state: "open" });
  await assert.rejects(FormPipelineDigest.create({ key, state: "open" }), /E11000|duplicate/);
  await FormPipelineDigest.create({ key, state: "sent" });
  await FormPipelineDigest.create({ key, state: "sent" });
  // the store tolerates the race: a concurrent creator losing the unique index is not an error
  const store = createDigestStore();
  await Promise.all(Array.from({ length: 6 }, (_, index) => store.addEntry(key, { formCode: `ZZ-PIPE-U${index}`, toEdition: "x", jobId: `u${index}`, trigger: "script" })));
  const open = await FormPipelineDigest.findOne({ key, state: "open" }).lean();
  assert.equal(open.count, 6);
});

// ---- the runner hooks, on real jobs ----------------------------------------------------------------------------------------------------------------------------------
const svc = createJobService({ random: () => 0.5 });
const lockEveryone = async (_code, fn) => ({ ran: true, value: await fn() });
function harness(env = {}) {
  const sent = { emails: [], notices: [] };
  const alerter = createAlerter({
    jobService: svc, env,
    deps: {
      email: { isConfigured: () => true, sendTemplateEmail: async (key, payload) => { sent.emails.push({ key, ...payload }); return { sent: true }; } },
      notifications: { createForRoles: async (roles, payload) => { sent.notices.push({ roles, ...payload }); return []; } },
      logger: silent, describeForm: async () => ({ activeEdition: "2024-04-01" }),
      outcomeLookups: { visaTypes: async () => ["H-1B"], coverage: async () => ({ total: 10, mapped: 10, requiredUnmapped: 0 }) },
    },
  });
  return { sent, alerter, runnerFor: (executor) => createRunner({ jobService: svc, alerter, executor, promotionLock: lockEveryone, logger: silent, heartbeatMs: 50 }) };
}
const claimedJob = async (code, trigger) => { const { job } = await svc.enqueue({ formCode: code, trigger }); const claim = await svc.claimNext(); assert.equal(String(claim.job._id), String(job._id)); return claim; };
const promotedResult = (code) => ({ template: { formCode: code, status: "active", version: "2025-01-20", editionDate: new Date("2025-01-20") }, previousTemplate: { version: "2024-04-01", editionDate: new Date("2024-04-01") }, versionChanged: true, requiresActivation: false });

test("runner: an on-demand success e-mails once, records the dedupe on the job, and the e-mail does not block the result", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = uniqueFormCode();
  const { runnerFor, sent } = harness();
  const outcome = await runnerFor(async () => promotedResult(code)).run(await claimedJob(code, "admin_fetch"));
  assert.equal(outcome.state, "done");
  await outcome.alerted;
  assert.deepEqual(sent.emails.map((mail) => mail.key), ["form-pipeline-success"]);
  assert.deepEqual([sent.emails[0].data.previousEdition, sent.emails[0].data.newEdition, sent.emails[0].data.visaTypes], ["2024-04-01", "2025-01-20", ["H-1B"]]);
  const saved = await FormPipelineJob.findOne({ formCode: code }).lean();
  assert.ok(saved.alerts.some((alert) => alert.signature === "success|2025-01-20" && alert.kind === "success"));
});

test("runner: a catalog sync success goes to the digest, not to an e-mail", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = uniqueFormCode();
  const { runnerFor, sent, alerter } = harness();
  const outcome = await runnerFor(async () => promotedResult(code)).run(await claimedJob(code, "catalog_sync"));
  const alerted = await outcome.alerted;
  assert.deepEqual([alerted.sent, alerted.route], [false, "digest"]);
  assert.equal(sent.emails.length, 0);
  assert.equal((await alerter.flushDigests({ now: new Date(Date.now() + 11 * 60 * 1000) })).flushed >= 0, true);
});

test("runner: a policy hold sends one held e-mail (and no failure alert); an approval-required finish sends a held e-mail too; a quiet finish sends nothing", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { runnerFor, sent } = harness();
  const heldCode = uniqueFormCode();
  const held = await runnerFor(async () => ({ template: { status: "review", version: "x" }, requiresActivation: true, activationBlockedCode: "EDITION_POLICY_HELD", activationBlockedReason: "USCIS has not confirmed that edition x is accepted" })).run(await claimedJob(heldCode, "catalog_sync"));
  assert.equal(held.state, "held");
  await held.alerted;
  assert.deepEqual(sent.emails.map((mail) => [mail.key, mail.data.reasonKind]), [["form-pipeline-held", "policy_hold"]]);
  assert.match(sent.emails[0].data.reason, /has not confirmed/);

  const reviewCode = uniqueFormCode();
  const review = await runnerFor(async () => ({ template: { status: "active", version: "2024-04-01" }, versionChanged: true, requiresActivation: true, activationBlockedReason: "Mapping review is required" })).run(await claimedJob(reviewCode, "admin_fetch"));
  assert.equal(review.state, "done");
  await review.alerted;
  assert.deepEqual(sent.emails.slice(1).map((mail) => [mail.key, mail.data.reasonKind]), [["form-pipeline-held", "approval_required"]]);

  const quietCode = uniqueFormCode();
  const quiet = await runnerFor(async () => ({ template: { status: "active", version: "2024-04-01" }, alreadyActive: true, checked: true })).run(await claimedJob(quietCode, "admin_fetch"));
  assert.equal(quiet.state, "done");
  assert.equal((await quiet.alerted).sent, false);
  assert.equal(sent.emails.length, 2);
});

test("runner: an alerter that throws or has no announceOutcome never changes the run's result", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = uniqueFormCode();
  const exploding = { announce: async () => { throw new Error("boom"); }, announceOutcome: async () => { throw new Error("boom"); } };
  const runner = createRunner({ jobService: svc, alerter: exploding, executor: async () => promotedResult(code), promotionLock: lockEveryone, logger: silent, heartbeatMs: 50 });
  const outcome = await runner.run(await claimedJob(code, "admin_fetch"));
  assert.equal(outcome.state, "done");
  assert.equal(await outcome.alerted, null);
  const legacyCode = uniqueFormCode();
  const legacy = createRunner({ jobService: svc, alerter: { announce: async () => ({}) }, executor: async () => promotedResult(legacyCode), promotionLock: lockEveryone, logger: silent, heartbeatMs: 50 });
  assert.equal((await legacy.run(await claimedJob(legacyCode, "admin_fetch"))).state, "done");
});
