// Phase 1: every operation on a FormPipelineJob. A worker claims a job with a LEASE (token + fence number); every write it makes afterwards is conditional on that
// token AND fence, so a worker whose lease expired and was taken over cannot change anything (LeaseLostError). Nothing here runs the pipeline itself.
//
//   enqueue            -> one open job per form (a second request returns the existing job)
//   recoverExpired     -> a job whose worker stopped heartbeating goes back to pending (or dead_letter when its attempts are used up)
//   claimNext          -> atomic claim of the next due job (fence++ , attempts++)
//   stageStart/Finish/Fail, setEdition, heartbeat, assertLease -> fenced writes
//   complete / fail / release -> terminal and retry transitions (fail classifies the error: transient -> backoff, blocked -> slow retry, held -> wait, repeated -> dead_letter)
//   manualRetry        -> an admin puts a blocked / held / dead-letter job back in the queue
const crypto = require("crypto");
const FormPipelineJob = require("../../models/FormPipelineJob");
const { JOB_STATES, OPEN_STATES, SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, LIMITS, ERROR_CLASSES } = require("./pipeline.constants");
const { LeaseLostError, classifyError, sanitizeMessage, backoffMs, errorSignature } = require("./errorClassifier");
const holdContract = require("./holdContract");

const normalizeCode = (formCode) => String(formCode || "").trim().toUpperCase();
const historyEntry = (at, state, stage, note) => ({ at, state, stage: stage || undefined, note: note ? String(note).slice(0, 200) : undefined });
const pushHistory = (entry) => ({ $each: [entry], $slice: -LIMITS.historyKept });

function createJobService({ model = FormPipelineJob, now = () => new Date(), random = Math.random, evaluatorVersions = holdContract.EVALUATOR_VERSIONS } = {}) {
  const leaseFilter = (jobId, lease) => ({ _id: jobId, state: JOB_STATES.RUNNING, "lease.token": lease.token, "lease.fence": lease.fence });

  /** Conditional write: only the worker that still holds the lease may change the job. */
  async function fenced(jobId, lease, update) {
    const result = await model.updateOne(leaseFilter(jobId, lease), update);
    if (result.matchedCount !== 1) throw new LeaseLostError();
    return result;
  }

  async function enqueue({ formCode, trigger = "unknown", requestedBy, options = {}, shadow = false, nextAttemptAt } = {}) {
    const code = normalizeCode(formCode);
    if (!code) throw Object.assign(new Error("formCode is required"), { status: 400 });
    const existing = await model.findOne({ formCode: code, open: true }).lean();
    if (existing) return { job: existing, created: false };
    const at = now();
    try {
      const job = await model.create({
        formCode: code, trigger, requestedBy, options: { forceCheck: Boolean(options.forceCheck) }, shadow, schemaVersion: SCHEMA_VERSION, state: JOB_STATES.PENDING,
        nextAttemptAt, history: [historyEntry(at, JOB_STATES.PENDING, null, `queued by ${trigger}`)],
      });
      return { job: job.toObject(), created: true };
    } catch (error) {
      if (error?.code === 11000) { // another process queued the same form between our read and our insert: that job is the answer
        const winner = await model.findOne({ formCode: code, open: true }).lean();
        if (winner) return { job: winner, created: false };
      }
      throw error;
    }
  }

  /** Expired running jobs go back to pending (their worker died or stalled) or, with no attempts left, to dead_letter. Atomic per job. */
  async function recoverExpired() {
    const at = now();
    const expired = await model.find({ state: JOB_STATES.RUNNING, "lease.lockedUntil": { $lt: at } }).select("_id attempts maxAttempts").limit(50).lean();
    let requeued = 0;
    let deadLettered = 0;
    for (const item of expired) {
      const exhausted = (item.attempts || 0) >= (item.maxAttempts || LIMITS.maxAttempts);
      const update = exhausted
        ? { $set: { state: JOB_STATES.DEAD_LETTER, open: false, "lease.lockedUntil": null, lastError: { class: ERROR_CLASSES.TRANSIENT, code: "WORKER_LOST", message: "The worker stopped answering and no attempts are left", at } }, $push: { history: pushHistory(historyEntry(at, JOB_STATES.DEAD_LETTER, null, "lease expired, attempts used up")) } }
        : { $set: { state: JOB_STATES.PENDING, "lease.lockedUntil": null, nextAttemptAt: new Date(at.getTime() + backoffMs(item.attempts || 1, { random })) }, $push: { history: pushHistory(historyEntry(at, JOB_STATES.PENDING, null, "lease expired, queued again")) } };
      const claimed = await model.findOneAndUpdate({ _id: item._id, state: JOB_STATES.RUNNING, "lease.lockedUntil": { $lt: at } }, update, { new: true });
      if (!claimed) continue;
      if (exhausted) deadLettered += 1; else requeued += 1;
    }
    return { requeued, deadLettered };
  }

  /** Atomically claims the next due job (or null). The returned lease is what every later write must present. */
  async function claimNext({ workerId = "worker", leaseMs = LIMITS.leaseMs } = {}) {
    const at = now();
    const token = crypto.randomUUID();
    const job = await model.findOneAndUpdate(
      {
        schemaVersion: { $in: SUPPORTED_SCHEMA_VERSIONS },
        $expr: { $lt: ["$attempts", "$maxAttempts"] },
        $or: [
          { state: JOB_STATES.PENDING, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: at } }] },
          { state: { $in: [JOB_STATES.BLOCKED, JOB_STATES.HELD] }, nextAttemptAt: { $lte: at } },
        ],
      },
      {
        $set: { state: JOB_STATES.RUNNING, open: true, startedAt: at, "lease.lockedUntil": new Date(at.getTime() + leaseMs), "lease.token": token, "lease.workerId": workerId },
        $inc: { attempts: 1, "lease.fence": 1 },
        $push: { history: pushHistory(historyEntry(at, JOB_STATES.RUNNING, null, `claimed by ${workerId}`)) },
      },
      { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } }
    ).lean();
    if (!job) return null;
    return { job, lease: { token: job.lease.token, fence: job.lease.fence } };
  }

  /** Claims ONE specific job (used when the caller runs it right away); null when it is not claimable (not pending / not due / already taken). */
  async function claimById(jobId, { workerId = "inline", leaseMs = LIMITS.leaseMs } = {}) {
    const at = now();
    const token = crypto.randomUUID();
    const job = await model.findOneAndUpdate(
      {
        _id: jobId, schemaVersion: { $in: SUPPORTED_SCHEMA_VERSIONS }, $expr: { $lt: ["$attempts", "$maxAttempts"] },
        $or: [{ state: JOB_STATES.PENDING, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: at } }] }],
      },
      {
        $set: { state: JOB_STATES.RUNNING, open: true, startedAt: at, "lease.lockedUntil": new Date(at.getTime() + leaseMs), "lease.token": token, "lease.workerId": workerId },
        $inc: { attempts: 1, "lease.fence": 1 },
        $push: { history: pushHistory(historyEntry(at, JOB_STATES.RUNNING, null, `claimed by ${workerId}`)) },
      },
      { new: true }
    ).lean();
    return job ? { job, lease: { token: job.lease.token, fence: job.lease.fence } } : null;
  }

  /** Extends the lease while the worker is alive. Throws LeaseLostError when it no longer holds it. */
  async function heartbeat(jobId, lease, leaseMs = LIMITS.leaseMs) {
    await fenced(jobId, lease, { $set: { "lease.lockedUntil": new Date(now().getTime() + leaseMs) } });
  }

  /** Reads the job fresh and proves the caller still owns a live lease (called before any commit / promotion). Returns the job. */
  async function assertLease(jobId, lease, { editionKey } = {}) {
    const job = await model.findById(jobId).lean();
    const live = job && job.state === JOB_STATES.RUNNING && job.lease?.token === lease.token && job.lease?.fence === lease.fence && job.lease?.lockedUntil && new Date(job.lease.lockedUntil) > now();
    if (!live) throw new LeaseLostError();
    if (editionKey && job.editionKey && job.editionKey !== editionKey) throw new LeaseLostError("The job now refers to a different edition; refusing to commit");
    return job;
  }

  async function stageStart(jobId, lease, stage) {
    const at = now();
    await fenced(jobId, lease, {
      $set: { currentStage: stage, [`stages.${stage}.status`]: "running", [`stages.${stage}.startedAt`]: at, [`stages.${stage}.finishedAt`]: null, [`stages.${stage}.error`]: null },
      $inc: { [`stages.${stage}.attempts`]: 1 },
    });
  }

  async function stageFinish(jobId, lease, stage, status = "done") {
    await fenced(jobId, lease, { $set: { [`stages.${stage}.status`]: status, [`stages.${stage}.finishedAt`]: now() } });
  }

  async function stageFail(jobId, lease, stage, error) {
    const classification = classifyError(error);
    await fenced(jobId, lease, {
      $set: { [`stages.${stage}.status`]: "failed", [`stages.${stage}.finishedAt`]: now(), [`stages.${stage}.error`]: { class: classification.class, code: classification.code, message: sanitizeMessage(error) } },
    });
  }

  /** Records which edition this run is about (identity for dedupe) and the artifacts it produced. */
  async function setEdition(jobId, lease, { editionKey, previousTemplateId, newTemplateId, checksum, storageKey } = {}) {
    const set = {};
    if (editionKey) set.editionKey = editionKey;
    if (previousTemplateId) set["artifacts.previousTemplateId"] = previousTemplateId;
    if (newTemplateId) set["artifacts.newTemplateId"] = newTemplateId;
    if (checksum) set["artifacts.checksum"] = checksum;
    if (storageKey) set["artifacts.storageKey"] = storageKey;
    if (Object.keys(set).length) await fenced(jobId, lease, { $set: set });
  }

  async function recordRepair(jobId, lease, { strategy, outcome, verification }) {
    await fenced(jobId, lease, { $push: { repairsTried: { strategy, outcome, verification, at: now() } } });
  }

  async function complete(jobId, lease, outcome = {}) {
    const at = now();
    await fenced(jobId, lease, {
      $set: {
        state: JOB_STATES.DONE, open: false, outcome, completedAt: at, expireAt: new Date(at.getTime() + LIMITS.doneKeptDays * 86400000), "lease.lockedUntil": null, currentStage: null,
      },
      $unset: { hold: "" }, // Phase 7.0: a finished job no longer holds anything
      $push: { history: pushHistory(historyEntry(at, JOB_STATES.DONE, null, outcome?.status || "done")) },
    });
  }

  /**
   * A stage (or the run) failed. Classifies the error and moves the job: held -> wait for a decision; blocked -> slow retry; transient / unknown -> backoff + jitter
   * until the attempts run out, then dead_letter. Returns { state, classification, signature, nextAttemptAt }. A lost lease changes nothing.
   */
  async function fail(jobId, lease, { stage, error, attempts } = {}) {
    const classification = classifyError(error);
    if (classification.class === ERROR_CLASSES.LEASE_LOST) return { state: null, classification, signature: errorSignature({ stage, classification }), leaseLost: true };
    const at = now();
    const message = sanitizeMessage(error);
    const counters = await model.findById(jobId).select("attempts maxAttempts hold").lean();
    const used = attempts ?? counters?.attempts ?? 1;
    const max = counters?.maxAttempts || LIMITS.maxAttempts;
    let state;
    let nextAttemptAt = null;
    let resetAttempts = false;
    if (classification.class === ERROR_CLASSES.HELD) {
      state = JOB_STATES.HELD;
      nextAttemptAt = new Date(at.getTime() + LIMITS.heldRecheckMs);
      resetAttempts = true; // waiting for a decision is not failing: re-checks must never use up the attempts
    } else if (classification.class === ERROR_CLASSES.FATAL || used >= max) {
      state = JOB_STATES.DEAD_LETTER;
    } else if (classification.class === ERROR_CLASSES.BLOCKED) {
      state = JOB_STATES.BLOCKED;
      nextAttemptAt = new Date(at.getTime() + LIMITS.blockedRetryMs);
    } else {
      state = JOB_STATES.PENDING;
      nextAttemptAt = new Date(at.getTime() + backoffMs(used, { random }));
    }
    // Phase 7.0: a job that cannot go on carries why, what would release it and which code versions judged it; a plain retry (pending) leaves any earlier hold alone
    const holds = [JOB_STATES.HELD, JOB_STATES.BLOCKED, JOB_STATES.DEAD_LETTER].includes(state);
    const hold = holds ? holdContract.buildHold({ classification, stage, message, previous: counters?.hold || null, at, versions: evaluatorVersions }) : null;
    await fenced(jobId, lease, {
      $set: {
        state, open: OPEN_STATES.includes(state), nextAttemptAt, "lease.lockedUntil": null, ...(resetAttempts ? { attempts: 0 } : {}), ...(hold ? { hold } : {}), lastError: { class: classification.class, code: classification.code, stage, message, at },
        ...(stage ? { [`stages.${stage}.status`]: "failed", [`stages.${stage}.finishedAt`]: at, [`stages.${stage}.error`]: { class: classification.class, code: classification.code, message } } : {}),
      },
      $push: { history: pushHistory(historyEntry(at, state, stage, `${classification.class}: ${message}`)) },
    });
    return { state, classification, signature: errorSignature({ stage, classification }), nextAttemptAt, message };
  }

  /**
   * Phase 7.0 re-evaluation: held / blocked jobs whose hold was judged with OLDER code versions than the running ones are put back in the queue once, so a code or
   * rule fix releases them without anyone clicking. Returns the number of jobs requeued. Never changes a decision itself: the requeued job runs the normal pipeline
   * and the same gates.
   */
  async function requeueOutdatedHolds(versions = evaluatorVersions) {
    const at = now();
    const outdated = Object.keys(versions).map((key) => ({ [`hold.evaluatedWith.${key}`]: { $ne: versions[key] } }));
    const result = await model.updateMany(
      { state: { $in: [JOB_STATES.HELD, JOB_STATES.BLOCKED] }, "hold.reasonCode": { $exists: true }, $or: outdated },
      { $set: { state: JOB_STATES.PENDING, open: true, attempts: 0, nextAttemptAt: at, "lease.lockedUntil": null }, $push: { history: pushHistory(historyEntry(at, JOB_STATES.PENDING, null, "re-evaluating: the code that judged this hold has changed")) } }
    );
    return result.modifiedCount || 0;
  }

  /** Holds (held / blocked / dead-letter) older than the escalation period that have not been raised yet, oldest first. */
  async function persistentHolds({ periodMs = holdContract.escalationMs(), limit = 50, includeEscalated = false } = {}) {
    const cutoff = new Date(now().getTime() - periodMs);
    const filter = { state: { $in: [JOB_STATES.HELD, JOB_STATES.BLOCKED, JOB_STATES.DEAD_LETTER] }, "hold.firstHeldAt": { $lte: cutoff }, ...(includeEscalated ? {} : { "hold.escalatedAt": { $exists: false } }) };
    return model.find(filter).sort({ "hold.firstHeldAt": 1 }).limit(Math.min(Number(limit) || 50, 200)).select("formCode state trigger editionKey hold lastError attempts updatedAt").lean();
  }

  /** True the FIRST time this job is escalated (the caller raises the alert only then). */
  async function markEscalated(jobId) {
    const result = await model.updateOne({ _id: jobId, "hold.escalatedAt": { $exists: false }, "hold.reasonCode": { $exists: true } }, { $set: { "hold.escalatedAt": now() } });
    return result.modifiedCount === 1;
  }

  /** Graceful shutdown: hand the job back untouched (not counted as an attempt). */
  async function release(jobId, lease, note = "released by worker") {
    const at = now();
    await fenced(jobId, lease, {
      $set: { state: JOB_STATES.PENDING, nextAttemptAt: at, "lease.lockedUntil": null },
      $inc: { attempts: -1 },
      $push: { history: pushHistory(historyEntry(at, JOB_STATES.PENDING, null, note)) },
    });
  }

  /** An admin puts a blocked / held / dead-letter (or waiting) job back in the queue with a fresh attempt budget. */
  async function manualRetry(jobId, actor) {
    const at = now();
    const job = await model.findById(jobId).lean();
    if (!job) throw Object.assign(new Error("Pipeline job not found"), { status: 404 });
    if (job.state === JOB_STATES.RUNNING) throw Object.assign(new Error("The job is running right now"), { status: 409 });
    if (job.state === JOB_STATES.DONE) throw Object.assign(new Error("The job already finished; start a new check instead"), { status: 409 });
    try {
      const updated = await model.findOneAndUpdate(
        { _id: jobId, state: { $in: [JOB_STATES.BLOCKED, JOB_STATES.HELD, JOB_STATES.DEAD_LETTER, JOB_STATES.PENDING] } },
        {
          $set: { state: JOB_STATES.PENDING, open: true, attempts: 0, nextAttemptAt: at, alerts: [], "lease.lockedUntil": null },
          $push: { history: pushHistory(historyEntry(at, JOB_STATES.PENDING, null, `manual retry by ${actor?.email || actor?._id || "an admin"}`)) },
        },
        { new: true }
      ).lean();
      if (!updated) throw Object.assign(new Error("The job changed state; reload and try again"), { status: 409 });
      return updated;
    } catch (error) {
      if (error?.code === 11000) throw Object.assign(new Error(`Another pipeline job for ${job.formCode} is already open`), { status: 409 });
      throw error;
    }
  }

  /** True the FIRST time this exact (kind|signature) is recorded for the job - the caller sends the alert only then. */
  async function markAlert(jobId, signature, kind) {
    const result = await model.updateOne({ _id: jobId, "alerts.signature": { $ne: signature } }, { $push: { alerts: { signature, kind, at: now() } } });
    return result.modifiedCount === 1;
  }

  async function list({ state, formCode, limit = 50 } = {}) {
    const filter = {};
    if (state) filter.state = state;
    if (formCode) filter.formCode = normalizeCode(formCode);
    return model.find(filter).sort({ updatedAt: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean();
  }

  async function get(jobId) {
    return model.findById(jobId).lean();
  }

  /** Jobs that have waited in the queue longer than `olderThanMs` (for the "no worker is running" alert). */
  async function staleQueued(olderThanMs = LIMITS.queuedAlertAfterMs) {
    const cutoff = new Date(now().getTime() - olderThanMs);
    return model.find({ state: JOB_STATES.PENDING, createdAt: { $lt: cutoff }, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now() } }] }).select("_id formCode createdAt").lean();
  }

  return { enqueue, recoverExpired, claimNext, claimById, heartbeat, assertLease, stageStart, stageFinish, stageFail, setEdition, recordRepair, complete, fail, release, manualRetry, requeueOutdatedHolds, persistentHolds, markEscalated, markAlert, list, get, staleQueued, fenced };
}

let defaultService = null;
const getService = () => (defaultService ||= createJobService());

module.exports = { createJobService, getService, normalizeCode };
