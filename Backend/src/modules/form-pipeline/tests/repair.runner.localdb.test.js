// Phase 4: the runner's result-inspection hook + the registered repair strategies, against the LOCAL test database only (src/test-utils/pipelineDb.js; skipped without a local
// MongoDB). Executors, strategies' work and the inspector are scripted - nothing fetches from uscis.gov and no form template is touched.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const JobLock = require("../../../models/JobLock");
const { createJobService } = require("../FormPipelineJobService");
const { createRunner } = require("../FormPipelineRunner");
const { defaultStrategies } = require("../repair");

let db;
test.after(async () => {
  if (!db?.ok) return;
  await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-PIPE-/ });
});
db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineJob, JobLock]);
test.beforeEach(async () => { if (db.ok) await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-PIPE-/ }); });

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const svc = createJobService({ random: () => 0.5 });
const lockEveryone = async (_code, fn) => ({ ran: true, value: await fn() });
const claimed = async () => { const { job } = await svc.enqueue({ formCode: uniqueFormCode(), trigger: "catalog_sync" }); const claim = await svc.claimNext(); assert.equal(String(claim.job._id), String(job._id)); return claim; };
const runnerWith = (executor, extra) => createRunner({ jobService: svc, executor, promotionLock: lockEveryone, logger: silent, heartbeatMs: 50, ...extra });

const certificationError = (...checks) => Object.assign(new Error("certification failed"), { name: "CertificationFailed", code: "CERTIFICATION_FAILED", failedChecks: checks.map(([name, detail]) => ({ name, detail })) });
const strategy = (over = {}) => ({ name: "fake_repair", matches: (error) => error.code === "CERTIFICATION_FAILED" && error.failedChecks.some((c) => c.name === "pdf_fillable"), repair: async () => {}, verify: async () => "repaired: pdf_fillable passes now", ...over });

test("a failed certification is inspected, repaired, VERIFIED, and the run retried once; the repair is recorded on the job with its verification", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  let runs = 0;
  let seenContext = null;
  const templateId = new mongoose.Types.ObjectId();
  const executor = async (job, ctx) => {
    runs += 1;
    await ctx.recordEdition({ editionKey: `${job.formCode}|2025-01-20|abc`, newTemplateId: templateId, checksum: "abc" });
    return runs === 1 ? { requiresActivation: true, newTemplateId: templateId, template: { version: "2025-01-20", status: "review" } } : { template: { version: "2025-01-20", status: "active" }, alreadyActive: false, requiresActivation: false, versionChanged: true };
  };
  const claim = await claimed();
  const outcome = await runnerWith(executor, {
    repairs: [strategy({ repair: async (error, context) => { seenContext = context; } })],
    inspectResult: async (result) => (result.requiresActivation ? certificationError(["pdf_fillable", "the stored PDF exposes 0 fillable fields"]) : null),
  }).run(claim);
  assert.equal(runs, 2, "the work was retried once after the verified repair");
  assert.equal(outcome.state, "done");
  assert.equal(outcome.outcome.status, "activated", "the summary is the RETRY's result");
  const job = await FormPipelineJob.findById(claim.job._id).lean();
  assert.deepEqual([job.repairsTried[0].strategy, job.repairsTried[0].outcome], ["fake_repair", "repaired"]);
  assert.match(job.repairsTried[0].verification, /pdf_fillable passes now/);
  assert.equal(String(seenContext.job.artifacts.newTemplateId), String(templateId), "the strategy was given the job as it is NOW (with the edition recorded during the run)");
});

test("nothing to repair (the inspector finds nothing): the run behaves exactly as before - one run, no repair recorded", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  let runs = 0;
  const claim = await claimed();
  const outcome = await runnerWith(async () => { runs += 1; return { template: { version: "v", status: "active" }, alreadyActive: true, checked: true }; }, { repairs: [strategy()], inspectResult: async () => null }).run(claim);
  assert.deepEqual([runs, outcome.state], [1, "done"]);
  assert.equal((await FormPipelineJob.findById(claim.job._id).lean()).repairsTried.length, 0);
});

test("a repair that cannot be verified is recorded as failed, nothing is retried, and the first result stands (the edition stays in review as it was)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  let runs = 0;
  const claim = await claimed();
  const outcome = await runnerWith(async () => { runs += 1; return { requiresActivation: true, alreadyActive: false, template: { version: "v", status: "review" } }; }, {
    repairs: [strategy({ verify: async () => "FAILED: pdf_fillable still fails after the repair" })],
    inspectResult: async () => certificationError(["pdf_fillable", "0 fillable fields"]),
  }).run(claim);
  assert.deepEqual([runs, outcome.state, outcome.outcome.status], [1, "done", "kept_in_review"]);
  const job = await FormPipelineJob.findById(claim.job._id).lean();
  assert.deepEqual([job.repairsTried[0].outcome, /FAILED/.test(job.repairsTried[0].verification)], ["failed", true]);
});

test("the registered strategies refuse a party / widget / mapping failure: no repair is attempted and nothing is retried", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  for (const check of [["party_markers", "1 box would receive the wrong party's data"], ["widget_inputs", "a tick box was given text"], ["mapping_valid", "2 mapping errors"]]) {
    let runs = 0;
    const claim = await claimed();
    const outcome = await runnerWith(async () => { runs += 1; return { requiresActivation: true, alreadyActive: false, template: { version: "v", status: "review" } }; }, {
      repairs: defaultStrategies(),
      inspectResult: async () => certificationError(["pdf_fillable", "the stored PDF exposes 0 fillable fields"], check), // a repairable check AND a never-repair one
    }).run(claim);
    assert.deepEqual([runs, outcome.state], [1, "done"], check[0]);
    assert.equal((await FormPipelineJob.findById(claim.job._id).lean()).repairsTried.length, 0, `${check[0]}: no strategy even tried`);
  }
});

test("an inspector that throws never breaks the run", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const claim = await claimed();
  const outcome = await runnerWith(async () => ({ template: { version: "v", status: "active" }, checked: true }), { repairs: [strategy()], inspectResult: async () => { throw new Error("database blip"); } }).run(claim);
  assert.equal(outcome.state, "done");
});
