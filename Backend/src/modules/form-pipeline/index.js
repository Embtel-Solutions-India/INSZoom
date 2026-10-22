// Assembly of the durable form pipeline: the singletons the API process, the embedded worker and the standalone worker process all share.
const { services, mode } = require("./FormPipeline");
const { createWorker, workerAlive } = require("./FormPipelineWorker");
const { LIMITS } = require("./pipeline.constants");
const logger = require("../../utils/logger");
const { createHoldSweep } = require("./holdSweep");

/** FORM_PIPELINE_WORKER: "embedded" (default - the worker runs inside the API process, as the work always did), "external" (a separate process runs it), "off". */
const workerPlacement = (env = process.env) => {
  const value = String(env.FORM_PIPELINE_WORKER || "embedded").toLowerCase();
  return ["embedded", "external", "off"].includes(value) ? value : "embedded";
};

function buildWorker() {
  const { jobService, runner, alerter } = services();
  return createWorker({ jobService, runner, sweeps: [createHoldSweep({ jobService, alerter })], canClaim: () => !require("./preflight/pipelinePreflight").isBlocking() });
}

/**
 * Called by the API process at start-up: starts the embedded worker (unless the worker is external or off) and the availability check that alerts when jobs wait
 * and no worker is alive. Returns { worker, stop }.
 */
function startFormPipeline({ withJobLock } = {}) {
  const placement = workerPlacement();
  const handle = { placement, worker: null, timer: null, stop: async () => {} };
  if (placement === "embedded") {
    handle.worker = buildWorker();
    handle.worker.start();
  }
  const { jobService, alerter } = services();
  const check = async () => {
    const waiting = await jobService.staleQueued(LIMITS.queuedAlertAfterMs);
    if (!waiting.length) return alerter.workerUnavailable({ waiting: [] });
    if (await workerAlive()) return null;
    return alerter.workerUnavailable({ waiting });
  };
  const run = () => (withJobLock ? withJobLock("form-pipeline-availability", 10 * 60 * 1000, check) : check()).catch((error) => logger.warn("form_pipeline_availability_check_failed", { error: error.message }));
  handle.timer = setInterval(run, 5 * 60 * 1000);
  handle.timer.unref?.();
  handle.stop = async () => {
    clearInterval(handle.timer);
    if (handle.worker) await handle.worker.stop();
  };
  logger.info("form_pipeline_started", { mode: mode(), worker: placement });
  return handle;
}

module.exports = { startFormPipeline, buildWorker, workerPlacement };
