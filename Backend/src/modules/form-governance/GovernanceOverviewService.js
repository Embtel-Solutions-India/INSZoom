// Phase 5 governance: the one-screen overview of the form pipeline (mode, worker, queue counts, oldest stuck job, retries, stage timings, blocked / held jobs, recent scheduled
// runs) and its headline metrics (counts only). Read-only; every part that cannot be read degrades to an empty value instead of failing the screen.
const { JOB_STATES } = require("../form-pipeline/pipeline.constants");
const { stageTimings, jobSummary } = require("./summaries");

const DAY = 86400000;
const RUNS_SHOWN = 20;
const LIST_LIMIT = 50;
const TIMING_WINDOW_DAYS = 7;
const TIMING_SAMPLE = 500;
const UNRESOLVED_STATES = [JOB_STATES.BLOCKED, JOB_STATES.HELD, JOB_STATES.DEAD_LETTER];
const DONE_PROMOTED = ["activated", "acquired"];

function defaultDeps() {
  const pipeline = () => require("../form-pipeline/FormPipeline");
  return {
    Job: require("../../models/FormPipelineJob"),
    Run: require("../../models/FormPipelineRunSummary"),
    Suggestion: require("../../models/FormAiMappingSuggestion"),
    mode: () => pipeline().mode(),
    placement: () => require("../form-pipeline").workerPlacement(),
    workerAlive: () => require("../form-pipeline/FormPipelineWorker").workerAlive(),
    frozenOpen: () => require("./FrozenCasesService").frozenOpenCount(),
    now: () => new Date(),
  };
}

const safely = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
const retryExpr = { $max: [{ $subtract: ["$attempts", 1] }, 0] };

async function counts(Job) {
  const out = Object.fromEntries(Object.values(JOB_STATES).map((state) => [state, 0]));
  for (const row of await Job.aggregate([{ $group: { _id: "$state", n: { $sum: 1 } } }])) if (row._id in out) out[row._id] = row.n;
  return out;
}

async function retries(Job, since) {
  const total = await Job.aggregate([{ $group: { _id: null, n: { $sum: retryExpr } } }]);
  const recent = await Job.aggregate([{ $match: { updatedAt: { $gte: since } } }, { $group: { _id: null, n: { $sum: retryExpr } } }]);
  return { total: total[0]?.n || 0, last24h: recent[0]?.n || 0 };
}

const presentRun = (run) => ({
  kind: run.kind, startedAt: run.startedAt, finishedAt: run.finishedAt || null, durationMs: run.durationMs ?? null,
  checked: run.checked || 0, changed: run.changed || 0, promoted: run.promoted || 0, held: run.held || 0, failed: run.failed || 0, ...(run.error ? { error: run.error } : {}),
});

/** Headline numbers only (also GET /metrics). `aiSuggestions24h` is left out when the suggestions collection cannot be read. */
async function metrics(deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const now = d.now();
  const since = new Date(now.getTime() - DAY);
  const [jobCounts, promotions, failures, aiSuggestions, frozen] = await Promise.all([
    safely(() => counts(d.Job), {}),
    safely(() => d.Job.countDocuments({ state: JOB_STATES.DONE, completedAt: { $gte: since }, "outcome.status": { $in: DONE_PROMOTED } }), 0),
    safely(() => d.Job.countDocuments({ state: { $in: [JOB_STATES.BLOCKED, JOB_STATES.DEAD_LETTER] }, "lastError.at": { $gte: since } }), 0),
    safely(() => d.Suggestion.countDocuments({ createdAt: { $gte: since } }), undefined),
    safely(() => d.frozenOpen(), 0),
  ]);
  return {
    promotions24h: promotions,
    failures24h: failures,
    heldNow: jobCounts[JOB_STATES.HELD] || 0,
    deadLetterNow: jobCounts[JOB_STATES.DEAD_LETTER] || 0,
    ...(aiSuggestions === undefined ? {} : { aiSuggestions24h: aiSuggestions }),
    frozenCasesOpen: frozen,
  };
}

async function overview(deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const now = d.now();
  const since24h = new Date(now.getTime() - DAY);
  const windowStart = new Date(now.getTime() - TIMING_WINDOW_DAYS * DAY);
  const select = "formCode state currentStage attempts lastError nextAttemptAt createdAt";

  const [jobCounts, oldest, retryCounts, sample, blocked, held, runs, headline, mode, placement, alive] = await Promise.all([
    safely(() => counts(d.Job), Object.fromEntries(Object.values(JOB_STATES).map((state) => [state, 0]))),
    safely(() => d.Job.findOne({ state: { $in: UNRESOLVED_STATES } }).sort({ createdAt: 1 }).select(select).lean(), null),
    safely(() => retries(d.Job, since24h), { total: 0, last24h: 0 }),
    safely(() => d.Job.find({ updatedAt: { $gte: windowStart } }).sort({ updatedAt: -1 }).limit(TIMING_SAMPLE).select("stages").lean(), []),
    safely(() => d.Job.find({ state: JOB_STATES.BLOCKED }).sort({ createdAt: 1 }).limit(LIST_LIMIT).select(select).lean(), []),
    safely(() => d.Job.find({ state: JOB_STATES.HELD }).sort({ createdAt: 1 }).limit(LIST_LIMIT).select(select).lean(), []),
    safely(() => d.Run.find({}).sort({ startedAt: -1 }).limit(RUNS_SHOWN).lean(), []),
    metrics(d),
    safely(() => d.mode(), "unknown"),
    safely(() => d.placement(), null),
    safely(() => d.workerAlive(), false),
  ]);

  return {
    generatedAt: now.toISOString(),
    pipeline: {
      mode,
      worker: { placement, alive: Boolean(alive) },
      counts: jobCounts,
      oldestUnresolved: oldest ? (({ ageMs, formCode, state, jobId }) => ({ ageMs, formCode, state, jobId }))(jobSummary(oldest, now)) : null,
      retries: retryCounts,
      stageTimings: stageTimings(sample),
    },
    blocked: blocked.map((job) => jobSummary(job, now)),
    held: held.map((job) => jobSummary(job, now)),
    runs: runs.map(presentRun),
    metrics: headline,
  };
}

module.exports = { overview, metrics, presentRun };
