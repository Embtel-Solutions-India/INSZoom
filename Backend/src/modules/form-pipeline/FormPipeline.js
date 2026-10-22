// The one door the pipeline's entry points go through (admin Fetch, mapping-save, the 12-hour catalog sync, the edition-upgrade job).
//
//   FORM_PIPELINE_MODE=inline  (DEFAULT) - exactly today's behavior for the caller: the work runs right here and the caller gets the same result or the same
//                                          exception as before. The run is additionally RECORDED as a durable job (stages, lease, attempts, failure class), a failed
//                                          run is retried later by the worker with backoff, and the developer is alerted. If the job cannot be claimed (another run
//                                          owns it, or the job store is unavailable) the original call is made unrecorded, as before.
//   FORM_PIPELINE_MODE=queued            - the caller only ENQUEUES and gets { queued: true, jobId, state }; a worker (separate PM2 process, or the embedded one)
//                                          does the work. Worker down => jobs stay queued and an alert is raised; there is no inline fallback.
// The mode is read on every call, so switching it needs a restart only for the process that reads the environment.
const logger = require("../../utils/logger");
const { getService } = require("./FormPipelineJobService");
const { createAlerter } = require("./PipelineAlerter");
const { createRunner } = require("./FormPipelineRunner");
const { createDefaultExecutor } = require("./pipelineExecutor");
const { defaultStrategies, createCertificationInspector } = require("./repair");

const mode = (env = process.env) => (String(env.FORM_PIPELINE_MODE || "inline").toLowerCase() === "queued" ? "queued" : "inline");

let built = null;
function services() {
  if (!built) {
    const jobService = getService();
    const alerter = createAlerter({ jobService });
    // Phase 4: the concrete repair strategies (each verified; none may touch a mapping, a party or an acceptance decision - see repair/guard.js)
    const runner = createRunner({ jobService, alerter, executor: createDefaultExecutor(), repairs: defaultStrategies(), inspectResult: createCertificationInspector() });
    // Phase 5E: the digest of a scheduled / catalog-wide run is sent once the run has been quiet for a while (unref'd timer; FORM_PIPELINE_DIGEST_FLUSHER=false turns it off)
    const flusher = alerter.startDigestFlusher ? alerter.startDigestFlusher() : null;
    built = { jobService, alerter, runner, flusher };
  }
  return built;
}

/** Tests replace the wiring. */
function setServicesForTests(replacement) { built = replacement; }

/**
 * @param direct the exact call the entry point made before this phase (() => Promise); used when the run cannot be recorded
 * @returns the pipeline result (inline) or { queued: true, jobId, state, created } (queued)
 */
async function runForm({ formCode, trigger = "unknown", user, req, options = {}, direct }) {
  const { jobService, runner } = services();
  const queued = mode() === "queued";
  let enqueued;
  try {
    enqueued = await jobService.enqueue({ formCode, trigger, requestedBy: user?._id, options });
  } catch (error) {
    logger.warn("form_pipeline_enqueue_failed", { formCode, trigger, error: error.message });
    if (queued) throw error;
    return direct();
  }
  if (queued) return { queued: true, created: enqueued.created, jobId: String(enqueued.job._id), state: enqueued.job.state, formCode: enqueued.job.formCode };

  const claim = await jobService.claimById(enqueued.job._id, { workerId: `inline:${process.pid}` }).catch((error) => { logger.warn("form_pipeline_claim_failed", { formCode, error: error.message }); return null; });
  if (!claim) return direct(); // someone else owns the open job, or it is waiting out a retry delay: behave exactly as before
  const outcome = await runner.run({ ...claim, actor: user, req });
  if (outcome.state === "lease_lost") throw Object.assign(new Error(`The pipeline job for ${formCode} was taken over by another worker`), { status: 503 });
  if (outcome.error) throw outcome.error; // the same exception the caller always got (the worker will retry the job on its own schedule)
  return outcome.result;
}

module.exports = { runForm, mode, services, setServicesForTests };
