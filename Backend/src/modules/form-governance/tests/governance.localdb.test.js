// Phase 5 governance against the LOCAL test database (src/test-utils/pipelineDb.js refuses anything else; skipped when no local MongoDB answers).
// Real models, real recorder store, real aggregations. Every row uses a unique ZZ-PIPE-* form code and is deleted afterwards by that code.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const FormPipelineRunSummary = require("../../../models/FormPipelineRunSummary");
const FormMigrationReport = require("../../../models/FormMigrationReport");
const { recordRun, recordMigrationOutcome, defaultStore } = require("../GovernanceRecorder");
const { frozenCases, frozenOpenCount } = require("../FrozenCasesService");
const { overview, metrics } = require("../GovernanceOverviewService");

const codes = [];
const newCode = () => { const code = uniqueFormCode(); codes.push(code); return code; };
const oid = () => new mongoose.Types.ObjectId();
const db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineJob, FormPipelineRunSummary, FormMigrationReport]);

test.afterEach(async () => {
  if (!db.ok) return;
  await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: { $in: codes } });
  await mongoose.connection.collection(FormMigrationReport.collection.name).deleteMany({ formCode: { $in: codes } });
  await mongoose.connection.collection(FormPipelineRunSummary.collection.name).deleteMany({});
});

test("run summaries are stored, and only the newest N per kind are kept", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  for (let i = 0; i < 5; i += 1) {
    const at = new Date(Date.UTC(2026, 0, 1, i));
    await recordRun("autopilot", { startedAt: at, finishedAt: new Date(at.getTime() + 1000), checked: i });
  }
  await recordRun("catalog_sync", { checked: 1 });
  const store = defaultStore();
  await store.pruneRuns("autopilot", 2);
  const rows = await FormPipelineRunSummary.find({ kind: "autopilot" }).sort({ startedAt: -1 }).lean();
  assert.deepEqual(rows.map((row) => row.checked), [4, 3]);
  assert.equal(await FormPipelineRunSummary.countDocuments({ kind: "catalog_sync" }), 1, "another kind is untouched");
  assert.ok(rows[0].expireAt > rows[0].finishedAt);
});

test("frozen case forms: one open row per case form, resolved once a later migration stops reporting it (then it may expire); unresolved never expires", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const template = { _id: oid(), formCode: code, version: "10/01/25" };
  const [a, b] = [oid(), oid()];
  const report = (caseFormId) => ({ caseFormId: String(caseFormId), caseId: String(oid()), caseNumber: `C-${String(caseFormId).slice(-4)}`, status: "filed", fromEdition: "04/01/24", toEdition: "10/01/25", priority: false });
  await recordMigrationOutcome({ template, caseMigration: { considered: 2, skippedFrozen: 2, frozenReport: [report(a), report(b)], unresolved: [], reconciliationRequired: [], failed: [] }, lostEdges: [{ targetPdfField: "f[0]", sourcePath: "petitioner.x" }] });
  await recordMigrationOutcome({ template, caseMigration: { considered: 2, skippedFrozen: 2, frozenReport: [report(a), report(b)], unresolved: [], reconciliationRequired: [], failed: [] } });
  assert.equal(await FormMigrationReport.countDocuments({ kind: "frozen", formCode: code }), 2, "the same case form is updated, not duplicated");
  assert.equal(await FormMigrationReport.countDocuments({ kind: "frozen", formCode: code, expireAt: { $exists: true } }), 0, "an unresolved frozen row never expires");
  let out = await frozenCases();
  assert.equal(out.items.filter((item) => item.formCode === code).length, 2);
  assert.equal(await frozenOpenCount(), 2);

  // the next migration no longer reports case form b (it was unlocked / moved)
  await recordMigrationOutcome({ template, caseMigration: { considered: 1, skippedFrozen: 1, frozenReport: [report(a)], unresolved: [], reconciliationRequired: [], failed: [] } });
  out = await frozenCases();
  assert.deepEqual(out.items.filter((item) => item.formCode === code).map((item) => item.caseFormId), [String(a)]);
  const resolved = await FormMigrationReport.findOne({ kind: "frozen", caseFormId: b }).lean();
  assert.equal(resolved.resolved, true);
  assert.ok(resolved.expireAt, "a resolved row may expire");
  assert.equal(await frozenOpenCount(), 1);

  // the outcome rows carry the lost edges and the counts, never an answer
  const outcome = await FormMigrationReport.findOne({ kind: "outcome", formCode: code, lostEdges: { $exists: true } }).lean();
  assert.deepEqual(outcome.lostEdges.map((edge) => edge.sourcePath), ["petitioner.x"]);
  assert.ok(outcome.expireAt);
});

test("the overview aggregates the real job collection: counts, oldest unresolved, retries, blocked / held lists", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const blocked = newCode();
  const held = newCode();
  const old = new Date(Date.now() - 3 * 3600000);
  await FormPipelineJob.collection.insertMany([
    { formCode: blocked, state: "blocked", open: true, attempts: 4, createdAt: old, updatedAt: new Date(), currentStage: "import", lastError: { class: "blocked", code: "BAD_PDF", stage: "import", message: "bad pdf", at: new Date() },
      stages: { import: { status: "failed", startedAt: new Date(old.getTime()), finishedAt: new Date(old.getTime() + 2000), attempts: 4 } } },
    { formCode: held, state: "held", open: true, attempts: 1, createdAt: new Date(), updatedAt: new Date(), currentStage: "promote" },
  ]);
  const out = await overview();
  assert.ok(out.pipeline.counts.blocked >= 1 && out.pipeline.counts.held >= 1);
  assert.equal(out.pipeline.oldestUnresolved.formCode, blocked);
  assert.ok(out.pipeline.oldestUnresolved.ageMs >= 3 * 3600000 - 1000);
  assert.ok(out.pipeline.retries.total >= 3 && out.pipeline.retries.last24h >= 3);
  assert.deepEqual(out.blocked.filter((job) => job.formCode === blocked).map((job) => [job.currentStage, job.lastError.code]), [["import", "BAD_PDF"]]);
  assert.ok(out.held.some((job) => job.formCode === held));
  assert.ok(out.pipeline.stageTimings.some((item) => item.stage === "import" && item.avgMs >= 2000));
  assert.ok(["inline", "queued"].includes(out.pipeline.mode));
  assert.equal(typeof out.pipeline.worker.alive, "boolean");
  const headline = await metrics();
  assert.ok(headline.heldNow >= 1 && headline.failures24h >= 1);
  assert.equal(typeof headline.frozenCasesOpen, "number");
});
