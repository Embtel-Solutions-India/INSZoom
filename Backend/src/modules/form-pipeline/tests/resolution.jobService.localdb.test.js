// Phase 7.E job service additions against the LOCAL throwaway database (pipelineDb.js refuses anything else; skipped when no local MongoDB answers).
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const { createJobService } = require("../FormPipelineJobService");
const { EVALUATOR_VERSIONS } = require("../holdContract");
const { diagnose } = require("../resolution/Diagnoser");

const codes = [];
const newCode = () => { const code = uniqueFormCode(); codes.push(code); return code; };
let db;
test.after(async () => { if (db?.ok && codes.length) await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: { $in: codes } }); });
db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineJob, require("../../../models/ErrorSolution")]);
test.beforeEach(async () => { if (db.ok) await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-PIPE-/ }); });

const make = (extra = {}) => createJobService({ now: () => new Date(), random: () => 0.5, ...extra });
const reload = (id) => FormPipelineJob.findById(id).lean();
const qpdfError = () => Object.assign(new Error('qpdf binary not found (looked for "C:\\Program Files\\qpdf 12.3.2\\bin\\qpdf.exe")'), { code: "QPDF_NOT_FOUND" });

async function running(svc) {
  const { job } = await svc.enqueue({ formCode: newCode(), trigger: "catalog_sync" });
  const claim = await svc.claimNext({ workerId: "w" });
  return { id: job._id, lease: claim.lease };
}

test("recordResolutions stores each attempt (sanitized, capped) and a worker without the lease cannot write", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const svc = make();
  const { id, lease } = await running(svc);
  await svc.recordResolutions(id, lease, [{ strategy: "reprobe", ok: false, verified: false, evidence: "no working qpdf found; token=abc12345secretvalue", stage: "import", signature: "sig1" }, { strategy: "pdf_lib_resave", ok: true, verified: true, evidence: "kept all field names", stage: "import", signature: "sig1" }]);
  const job = await reload(id);
  assert.deepEqual(job.resolutions.map((item) => [item.strategy, item.ok, item.verified]), [["reprobe", false, false], ["pdf_lib_resave", true, true]]);
  assert.ok(!/abc12345secretvalue/.test(job.resolutions[0].evidence), "secrets are redacted");
  await assert.rejects(svc.recordResolutions(id, { token: "wrong", fence: 99 }, [{ strategy: "x" }]), (error) => error.name === "LeaseLostError");
});

test("exhaust turns the job into a DOCUMENTED HOLD: reason code, release conditions, resolver version, signature, tried strategies; never a dead-letter", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const svc = make();
  const { id, lease } = await running(svc);
  const error = qpdfError();
  const diagnosis = diagnose({ error, stage: "import" });
  const result = await svc.exhaust(id, lease, { signature: diagnosis.signature, diagnosis, stage: "import", message: "qpdf binary not found", attempts: [{ strategy: "reprobe" }, { strategy: "pdf_lib_resave" }] });
  assert.equal(result.state, "held");
  const job = await reload(id);
  assert.equal(job.state, "held");
  assert.equal(job.open, true);
  assert.equal(job.attempts, 0);
  assert.equal(job.hold.reasonCode, "TOOL_UNAVAILABLE");
  assert.match(job.hold.detail, /tried: reprobe, pdf_lib_resave/);
  assert.ok(job.hold.releaseConditions.length >= 1 && /qpdf|tool/i.test(job.hold.releaseConditions[0]));
  assert.equal(job.hold.evaluatedWith.resolver, EVALUATOR_VERSIONS.resolver);
  assert.equal(job.exhausted.signature, diagnosis.signature);
  assert.equal(job.exhausted.cause, "tool_unavailable");
  assert.ok(job.nextAttemptAt, "re-checked on the held schedule");
});

test("a hold exhausted under an older resolver version is requeued once when the resolver version is bumped (a new strategy shipped)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const old = make({ evaluatorVersions: { ...EVALUATOR_VERSIONS, resolver: 1 } });
  const { id, lease } = await running(old);
  await old.exhaust(id, lease, { diagnosis: diagnose({ error: qpdfError(), stage: "import" }), stage: "import", message: "x", attempts: [] });
  const bumped = make({ evaluatorVersions: { ...EVALUATOR_VERSIONS, resolver: 2 } });
  assert.equal(await bumped.requeueOutdatedHolds(), 1);
  assert.equal((await reload(id)).state, "pending");
  assert.equal(await bumped.requeueOutdatedHolds(), 0);
});

test("fail with a diagnosis of a deterministic cause becomes a held hold; without a diagnosis nothing changes", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const svc = make();
  const withDiagnosis = await running(svc);
  const error = new Error("USCIS page fetch failed: 404");
  const out = await svc.fail(withDiagnosis.id, withDiagnosis.lease, { stage: "detect", error, diagnosis: diagnose({ error, stage: "detect" }) });
  assert.equal(out.state, "held");
  assert.equal((await reload(withDiagnosis.id)).hold.reasonCode, "NO_OFFICIAL_SOURCE");
  const plain = await running(svc);
  const out2 = await svc.fail(plain.id, plain.lease, { stage: "detect", error: new Error("USCIS page fetch failed: 404") });
  assert.notEqual(out2.state, "held", "today's behavior without the engine");
});

test("the MongoDB solution store learns, ranks by success, and demotes after two failures in a row", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ErrorSolution = require("../../../models/ErrorSolution");
  const { createMongoStore } = require("../resolution/solutionStore");
  const store = createMongoStore(ErrorSolution);
  const sig = `zz-pipe-${Date.now()}`;
  try {
    await ErrorSolution.init().catch(() => null);
    await store.recordSuccess({ signature: sig, strategyId: "pdf_lib_resave", stage: "import", cause: "tool_unavailable", formCode: "ZZ-PIPE-1" });
    await store.recordSuccess({ signature: sig, strategyId: "pdf_lib_resave", stage: "import", cause: "tool_unavailable" });
    await store.recordSuccess({ signature: sig, strategyId: "reprobe", stage: "import", cause: "tool_unavailable" });
    assert.equal((await store.best(sig)).strategyId, "pdf_lib_resave");
    assert.equal((await store.ranking("import")).pdf_lib_resave >= 2, true);
    await store.recordFailure({ signature: sig, strategyId: "pdf_lib_resave" });
    assert.equal((await store.best(sig)).strategyId, "pdf_lib_resave", "one failure does not demote");
    await store.recordFailure({ signature: sig, strategyId: "pdf_lib_resave" });
    assert.equal((await store.best(sig)).strategyId, "reprobe", "two in a row demote it");
    await store.recordSuccess({ signature: sig, strategyId: "pdf_lib_resave", stage: "import" });
    assert.equal((await store.best(sig)).strategyId, "pdf_lib_resave", "a success promotes it again");
  } finally {
    await ErrorSolution.deleteMany({ signature: sig });
  }
});
