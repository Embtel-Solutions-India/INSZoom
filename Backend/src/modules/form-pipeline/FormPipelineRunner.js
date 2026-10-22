// Phase 1: runs ONE claimed job. It does not know what the pipeline does - the `executor` (a function) does the work and reports each stage through the context
// it is given; the runner supplies the lease protection around it:
//   - a heartbeat keeps the lease alive; if the lease is lost, the executor's next stage / commit throws LeaseLostError and nothing more is written;
//   - the "promote" stage runs under a per-form promotion mutex and re-reads the job (token + fence + edition key) immediately before it commits;
//   - a failure is classified and moves the job (backoff / blocked / held / dead_letter) and is announced once through the alerter;
//   - a known repairable failure is repaired, VERIFIED, and retried once; each repair is recorded on the job with its verification result;
//   - nothing here weakens a safeguard: promotion still goes through the existing guarded activation and the edition-policy gate inside the executor.
const { LeaseLostError, classifyError, sanitizeMessage } = require("./errorClassifier");
const { ERROR_CLASSES, LIMITS, STAGES } = require("./pipeline.constants");

/** What a finished ensureCurrentUSCISForm-style result means, as a small stored summary. */
function summarizeResult(result) {
  if (!result) return { status: "no_result" };
  const template = result.template;
  let status;
  if (result.checkError) status = "uscis_unreachable";
  // result.template is the edition that is LIVE after the run (the old one when the new edition was not promoted), so "was it promoted" is the pipeline's own flag
  else if (result.versionChanged) status = result.requiresActivation ? "kept_in_review" : "activated";
  else if (result.alreadyActive === false) status = result.requiresActivation ? "kept_in_review" : "acquired";
  else status = result.checked === false ? "skipped" : "no_change";
  return {
    status, version: template?.version, templateStatus: template?.status, requiresActivation: Boolean(result.requiresActivation),
    ...(result.activationBlockedReason ? { activationBlockedReason: sanitizeMessage(result.activationBlockedReason) } : {}),
    ...(result.checkError ? { checkError: sanitizeMessage(result.checkError) } : {}),
  };
}

function defaultPromotionLock() {
  const { withJobLock } = require("../../utils/jobLock");
  return async (formCode, fn) => {
    let ran = false;
    let value;
    await withJobLock(`form-promote:${formCode}`, LIMITS.promotionMutexMs, async () => { ran = true; value = await fn(); });
    return { ran, value };
  };
}

function createRunner({ jobService, alerter = null, executor, repairs = [], inspectResult = null, promotionLock = null, heartbeatMs = LIMITS.heartbeatMs, leaseMs = LIMITS.leaseMs, logger = require("../../utils/logger") } = {}) {
  if (!jobService || typeof executor !== "function") throw new Error("createRunner needs a jobService and an executor");
  const lock = promotionLock || defaultPromotionLock();

  /** `actor` / `req` (optional): when the caller runs the job right away it passes its own user and request through to the executor. */
  async function run({ job, lease, actor, req }) {
    const jobId = job._id;
    let lost = false;
    let currentStage = null;
    const beat = setInterval(() => {
      jobService.heartbeat(jobId, lease, leaseMs).catch((error) => { if (error instanceof LeaseLostError) lost = true; else logger.warn("form_pipeline_heartbeat_failed", { jobId: String(jobId), error: error.message }); });
    }, heartbeatMs);
    beat.unref?.();
    const alive = () => { if (lost) throw new LeaseLostError(); };
    // runs an alert with the job as it is NOW; the promise (also on the run's result as `alerted`, for tests) never rejects
    const background = (id, call) => Promise.resolve().then(async () => { const current = await jobService.get(id); return current ? call(current) : null; })
      .catch((error) => { logger.warn("form_pipeline_alert_failed", { jobId: String(id), error: sanitizeMessage(error) }); return null; });

    const context = {
      job, lease, formCode: job.formCode, options: job.options || {}, actor, req,
      /** Runs one stage of the pipeline: recorded on the job; a failure is recorded and rethrown (the executor decides whether it is fatal). */
      async stage(name, fn) {
        alive();
        currentStage = name;
        await jobService.stageStart(jobId, lease, name);
        try {
          const value = name === STAGES.PROMOTE ? await promote(fn) : await fn();
          await jobService.stageFinish(jobId, lease, name);
          return value;
        } catch (error) {
          if (!(error instanceof LeaseLostError)) await jobService.stageFail(jobId, lease, name, error).catch(() => null);
          throw error;
        }
      },
      /** Proves the lease is still ours (token + fence + unexpired + same edition) right before something is committed. */
      async beforeCommit() { alive(); return jobService.assertLease(jobId, lease, { editionKey: context.editionKey }); },
      async recordEdition(info) { if (info?.editionKey) context.editionKey = info.editionKey; await jobService.setEdition(jobId, lease, info); },
      editionKey: job.editionKey,
    };

    // the promotion step: re-check the lease, take the per-form mutex, re-check again inside it, then let the existing guarded activation run
    async function promote(fn) {
      await context.beforeCommit();
      const locked = await lock(job.formCode, async () => { await context.beforeCommit(); return fn(); });
      if (!locked.ran) throw Object.assign(new Error(`Another promotion of ${job.formCode} is in progress`), { code: "PROMOTION_BUSY", status: 503 });
      return locked.value;
    }

    async function attempt() {
      return executor(job, context);
    }

    // a known repair: repair, VERIFY the repair, and only then retry the work once (per-strategy attempt limit across the whole job)
    async function repairAndRetry(error) {
      const fresh = await jobService.get(jobId);
      // the strategy sees the job as it is NOW (the edition ids recorded since the run started), not the snapshot the run was claimed with
      const strategyContext = { ...context, job: fresh };
      for (const strategy of repairs) {
        if (!strategy.matches(error)) continue;
        const tried = (fresh.repairsTried || []).filter((item) => item.strategy === strategy.name).length;
        if (tried >= LIMITS.repairAttemptsPerStrategy) continue;
        let outcome = "failed";
        let verification = "";
        try {
          await strategy.repair(error, strategyContext);
          verification = String(await strategy.verify(error, strategyContext) ?? "");
          outcome = verification && !/^fail/i.test(verification) ? "repaired" : "failed";
        } catch (repairError) {
          verification = `error: ${sanitizeMessage(repairError)}`;
        }
        await jobService.recordRepair(jobId, lease, { strategy: strategy.name, outcome, verification });
        if (outcome === "repaired") return { retried: true, result: await attempt() };
      }
      return { retried: false };
    }

    try {
      let result;
      try {
        result = await attempt();
      } catch (error) {
        if (error instanceof LeaseLostError) throw error;
        const repaired = classifyError(error).class === ERROR_CLASSES.REPAIRABLE || repairs.some((strategy) => strategy.matches(error)) ? await repairAndRetry(error) : { retried: false };
        if (!repaired.retried) throw error;
        result = repaired.result;
      }
      // Phase 4: a run can finish "successfully" with the edition left in review because its certification FAILED (that is recorded, not thrown). The inspector reads what the
      // run left behind and, when a strategy recognizes the failure, it is repaired and VERIFIED like any other; otherwise nothing changes. Never throws into the run.
      if (inspectResult && repairs.length) {
        try {
          const problem = await inspectResult(result, context);
          if (problem && repairs.some((strategy) => strategy.matches(problem))) {
            const repaired = await repairAndRetry(problem);
            if (repaired.retried) result = repaired.result;
          }
        } catch (error) {
          if (error instanceof LeaseLostError) throw error;
          logger.warn("form_pipeline_result_inspection_failed", { jobId: String(jobId), error: sanitizeMessage(error) });
        }
      }
      alive();
      // the edition was imported but the policy gate (inside the existing activation) refused to promote it: the job waits for a decision
      if (result?.activationBlockedCode === "EDITION_POLICY_HELD") {
        const held = Object.assign(new Error(result.activationBlockedReason || "The edition policy has not accepted this edition"), { name: "EditionPolicyHeldError", code: "EDITION_POLICY_HELD" });
        const transition = await jobService.fail(jobId, lease, { stage: STAGES.PROMOTE, error: held });
        // Phase 5E: ONE "imported but not promoted" e-mail per job and reason (deduped on the job); runs beside the caller's response and never throws
        const alerted = alerter ? background(jobId, async (current) => alerter.announce({ job: current, transition, stage: STAGES.PROMOTE, result })) : null;
        return { state: transition.state, transition, result, ...(alerted ? { alerted } : {}) };
      }
      const outcome = summarizeResult(result);
      await jobService.complete(jobId, lease, outcome);
      // Phase 5E: "edition promoted" (success e-mail or digest entry) or "approval required"; deduped on the job, never throws, does not delay the caller
      const alerted = alerter?.announceOutcome ? background(jobId, async (current) => alerter.announceOutcome({ job: current, outcome, result })) : null;
      return { state: "done", outcome, result, ...(alerted ? { alerted } : {}) };
    } catch (error) {
      if (error instanceof LeaseLostError) return { state: "lease_lost" };
      const transition = await jobService.fail(jobId, lease, { stage: currentStage, error }).catch((failure) => (failure instanceof LeaseLostError ? { leaseLost: true } : Promise.reject(failure)));
      if (transition.leaseLost) return { state: "lease_lost" };
      logger.warn("form_pipeline_job_failed", { jobId: String(jobId), formCode: job.formCode, stage: currentStage, state: transition.state, class: transition.classification.class, code: transition.classification.code, message: transition.message });
      if (alerter) await alerter.announce({ job: await jobService.get(jobId), transition, stage: currentStage });
      return { state: transition.state, transition, error };
    } finally {
      clearInterval(beat);
    }
  }

  return { run };
}

module.exports = { createRunner, summarizeResult };
