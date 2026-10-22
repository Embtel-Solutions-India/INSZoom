// Phase 1 worker: polls the queue (cheap indexed claim), runs ONE job at a time (concurrency 1), recovers jobs whose worker died, and stops gracefully.
//   - The same code runs embedded in the API process (default, which is today's behavior: the work happens in this process) or as its own supervised process
//     (src/workers/formPipelineWorker.js, FORM_PIPELINE_WORKER=external on the API) so heavy PDF work never shares the API's event loop.
//   - It writes an "alive" marker (JobLock row `form-pipeline-worker:<id>`) each tick; the API raises an alert when jobs wait and no marker is fresh.
//   - Start-up is jittered so several workers do not poll in lockstep; the poll interval is modest (FORM_PIPELINE_WORKER_INTERVAL_MS, default 15 s).
const os = require("os");
const JobLock = require("../../models/JobLock");
const logger = require("../../utils/logger");

const WORKER_LOCK_PREFIX = "form-pipeline-worker:";

function createWorker({ jobService, runner, workerId = `${os.hostname()}:${process.pid}`, intervalMs = Number(process.env.FORM_PIPELINE_WORKER_INTERVAL_MS || 15000), maxJobsPerTick = 3, sweeps = [], canClaim = () => true, random = Math.random, now = () => new Date() } = {}) {
  if (!jobService || !runner) throw new Error("createWorker needs a jobService and a runner");
  let timer = null;
  let stopping = false;
  let current = null;
  let started = false;

  async function beat() {
    const at = now();
    await JobLock.updateOne(
      { name: `${WORKER_LOCK_PREFIX}${workerId}` },
      { $set: { lockedAt: at, lockedUntil: new Date(at.getTime() + intervalMs * 3), token: workerId } },
      { upsert: true }
    ).catch((error) => logger.warn("form_pipeline_worker_beat_failed", { error: error.message }));
    // markers of workers that died without stopping (a killed process, a dev restart) are removed an hour after they expired
    await JobLock.deleteMany({ name: new RegExp(`^${WORKER_LOCK_PREFIX}`), lockedUntil: { $lt: new Date(at.getTime() - 60 * 60 * 1000) } }).catch(() => null);
  }

  /** One pass: mark alive, recover dead leases, run due jobs (at most maxJobsPerTick so a long queue cannot starve the beat). Returns the outcomes. */
  async function tick() {
    const outcomes = [];
    if (stopping) return outcomes;
    await beat();
    await jobService.recoverExpired().catch((error) => logger.warn("form_pipeline_recover_failed", { error: error.message }));
    // Phase 7.0: housekeeping that must never stop the queue (re-evaluate outdated holds, escalate persistent ones); every sweep catches its own errors
    for (const sweep of sweeps) await Promise.resolve().then(sweep).catch((error) => logger.warn("form_pipeline_sweep_failed", { error: error.message }));
    // Phase 7.1: when the start-up self-check found a critical problem (and enforcement is switched on) the worker keeps its marker and sweeps but claims nothing
    if (!canClaim()) { logger.warn("form_pipeline_worker_not_claiming", { reason: "preflight" }); return outcomes; }
    for (let i = 0; i < maxJobsPerTick && !stopping; i += 1) {
      const claim = await jobService.claimNext({ workerId });
      if (!claim) break;
      current = runner.run(claim);
      try {
        outcomes.push({ formCode: claim.job.formCode, ...(await current) });
      } finally {
        current = null;
      }
    }
    return outcomes;
  }

  function start() {
    if (started) return;
    started = true;
    stopping = false;
    const loop = async () => {
      try {
        await tick();
      } catch (error) {
        logger.error("form_pipeline_worker_tick_failed", { error: error.message });
      } finally {
        if (!stopping) { timer = setTimeout(loop, intervalMs); timer.unref?.(); }
      }
    };
    timer = setTimeout(loop, Math.round(random() * intervalMs * 0.5)); // jittered first poll
    timer.unref?.();
    logger.info("form_pipeline_worker_started", { workerId, intervalMs });
  }

  /** Graceful stop: no new job is claimed; the running one gets `timeoutMs` to finish (its lease expires on its own if it does not). */
  async function stop(timeoutMs = 30000) {
    stopping = true;
    started = false;
    if (timer) clearTimeout(timer);
    if (current) await Promise.race([current.catch(() => null), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    await JobLock.deleteOne({ name: `${WORKER_LOCK_PREFIX}${workerId}` }).catch(() => null);
    logger.info("form_pipeline_worker_stopped", { workerId });
  }

  return { start, stop, tick, workerId, isRunning: () => started };
}

/** True when some worker's alive marker is fresh (used by the API-side availability check and the status endpoint). */
async function workerAlive(at = new Date()) {
  try {
    return Boolean(await JobLock.exists({ name: new RegExp(`^${WORKER_LOCK_PREFIX}`), lockedUntil: { $gt: at } }));
  } catch (error) {
    logger.warn("form_pipeline_worker_status_failed", { error: error.message });
    return false;
  }
}

module.exports = { createWorker, workerAlive, WORKER_LOCK_PREFIX };
