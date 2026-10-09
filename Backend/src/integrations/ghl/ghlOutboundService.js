const crypto = require("crypto");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const GHLIntegration = require("../../models/GHLIntegration");
const GHLSyncJob = require("../../models/GHLSyncJob");
const caseService = require("../../modules/cases/case.service");
const notificationService = require("../../modules/notifications/notification.service");
const realtimeGateway = require("../../modules/realtime/realtime.gateway");
const { normalizeRole } = require("../../modules/authorization/roleHierarchy");
const { createClient, GHLApiError } = require("./ghlClient");
const { resolveGhlStage } = require("./ghlPipelineService");
const opportunityService = require("./ghlOpportunityService");
const { presentCard } = require("./ghlPresenter");

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60 * 1000;
const backoffMs = (attempts) => [10, 30, 120, 600, 1800, 1800, 1800, 1800][Math.min(attempts, 8) - 1] * 1000 || 1800000;

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

// The worker already retries with its own backoff, so the HTTP client only makes
// one quick extra attempt instead of multiplying retries.
let workerClient;
const getWorkerClient = () => (workerClient ||= createClient({ maxAttempts: 2, baseDelayMs: 300 }));

const BOARD_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager"]);

// Same visibility the Cases list uses (admin / super_admin / team_lead see all;
// a case manager only cases assigned to them). Deliberately NOT canAccessCase:
// that is the looser "may open this case" check, which lets any staff role in.
async function assertCanWorkCase(user, caseId) {
  if (!user || !BOARD_ROLES.has(normalizeRole(user.role))) throw httpError(403, "Not authorized to move this case");
  const scope = caseService.buildCaseFilter({}, user); // applyCaseRoleFilter, via its exported wrapper
  if (!(await Case.exists({ $and: [{ _id: caseId }, scope] }))) throw httpError(403, "Not authorized to move this case");
}

// ---------------------------------------------------------------------------
// CRM -> GHL: the drag. Saves locally, queues the GHL write, returns at once.
// ---------------------------------------------------------------------------

async function moveCaseStage({ caseId, unifiedStageKey, moveId, user }) {
  let caseDoc = await Case.findById(caseId);
  if (!caseDoc) throw httpError(404, "Case not found", "NOT_A_GHL_CASE");
  await assertCanWorkCase(user, caseDoc._id);
  // A case created in the CRM (or before the GHL link existed) gets its GHL card the first time it is staged.
  if (!caseDoc.integrations?.ghl?.opportunityId) {
    try {
      caseDoc = await require("./ghlCaseOutbound").ensureLinked(caseDoc._id);
    } catch (error) {
      throw httpError(error.status || 409, error.message, error.code || "NOT_A_GHL_CASE");
    }
  }

  const config = await GHLIntegration.findOne({ locationId: caseDoc.integrations.ghl.locationId });
  if (!config?.mappingsConfirmedAt) throw httpError(409, "GHL stage mapping has not been confirmed", "MAPPING_UNCONFIRMED");
  if (config.status === "config_mismatch") throw httpError(409, "GHL stage configuration needs admin review", "CONFIG_MISMATCH");
  // The case's OWN pipeline decides which stages exist for it; the key is never sent to GHL.
  const ghl = caseDoc.integrations.ghl;
  const pipeline = config.pipelines.find((p) => p.enabled && p.ghlPipelineId === ghl.pipelineId);
  if (!pipeline) throw httpError(409, "This case's GHL pipeline is not configured", "PIPELINE_NOT_CONFIGURED");
  if (!pipeline.stages.some((s) => s.key === unifiedStageKey)) throw httpError(400, "Unknown pipeline stage", "UNKNOWN_STAGE");
  const target = resolveGhlStage(config.stageMappings, ghl.pipelineId, unifiedStageKey);
  if (!target) throw httpError(400, "This stage does not exist in the case's GHL pipeline", "STAGE_NOT_IN_PIPELINE");

  if (ghl.unifiedStageKey === unifiedStageKey && ghl.pipelineStageId === target.ghlStageId) {
    return { card: presentCard(caseDoc, user), unchanged: true };
  }

  const operationId = crypto.randomUUID();
  const now = new Date();
  const version = ghl.sync?.version || 0;
  // Compare-and-set on the sync version: two simultaneous drags can't both win silently.
  const cas = await Case.updateOne(
    { _id: caseDoc._id, "integrations.ghl.sync.version": version },
    {
      $set: {
        "integrations.ghl.unifiedStageKey": unifiedStageKey,
        "integrations.ghl.pipelineStageId": target.ghlStageId,
        "integrations.ghl.sync.state": "pending",
        "integrations.ghl.sync.source": "immiglance",
        "integrations.ghl.sync.changedAt": now,
        "integrations.ghl.sync.operationId": operationId,
        "integrations.ghl.sync.attempts": 0,
        "integrations.ghl.sync.lastError": null,
      },
      $inc: { "integrations.ghl.sync.version": 1 },
    }
  );
  if (cas.matchedCount === 0) throw httpError(409, "The case was just updated; please retry", "CONCURRENT_MOVE");

  const job = await GHLSyncJob.create({
    caseId: caseDoc._id,
    opportunityId: ghl.opportunityId,
    pipelineId: ghl.pipelineId,
    pipelineStageId: target.ghlStageId,
    caseSyncVersion: version + 1,
    operationId,
    status: "pending",
    nextAttemptAt: now,
  });
  // Older queued writes for this case are now stale: never send them.
  await GHLSyncJob.updateMany({ caseId: caseDoc._id, status: "pending", _id: { $ne: job._id } }, { $set: { status: "superseded", completedAt: now } });

  const fresh = await Case.findById(caseDoc._id);
  try {
    caseService.addTimelineEvent(fresh, "case", "Pipeline stage changed", `Moved to "${target.unifiedStageName}"`, user, {
      source: "immiglance",
      unifiedStageKey,
      ghlPipelineId: ghl.pipelineId,
      ghlStageId: target.ghlStageId,
    });
    caseService.addAuditEntry(fresh, "update", "Pipeline stage changed", user, { unifiedStageKey, from: ghl.unifiedStageKey });
    await fresh.save();
  } catch (error) {
    logger.warn("ghl_move_timeline_failed", { caseId: String(caseDoc._id), error: error.message });
  }

  emitMove(fresh, moveId);
  processJobSoon(job._id);
  return { card: presentCard(fresh, user), unchanged: false, moveId };
}

function emitMove(caseDoc, moveId) {
  try {
    const ghl = caseDoc.integrations?.ghl || {};
    const payload = { caseId: caseDoc._id, kind: "stage", unifiedStageKey: ghl.unifiedStageKey, pipelineId: ghl.pipelineId, source: "immiglance", moveId };
    ["super_admin", "admin", "team_lead"].forEach((role) => realtimeGateway.emitToRole(role, "ghl:pipeline:updated", payload));
    if (caseDoc.assignedCaseManager) realtimeGateway.emitToUser(caseDoc.assignedCaseManager, "ghl:pipeline:updated", payload);
  } catch (error) {
    logger.warn("ghl_realtime_emit_failed", { error: error.message });
  }
}

// ---------------------------------------------------------------------------
// Worker: atomic claim -> stale check -> GHL write -> settle
// ---------------------------------------------------------------------------

async function claimJob(jobId) {
  const now = new Date();
  const filter = jobId
    ? { _id: jobId, status: "pending" }
    : {
        $or: [
          { status: "pending", nextAttemptAt: { $lte: now } },
          { status: "processing", lockedUntil: { $lte: now } }, // crashed worker's expired lease
        ],
      };
  return GHLSyncJob.findOneAndUpdate(
    filter,
    { $set: { status: "processing", lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true }
  );
}

async function release(job, delayMs) {
  // Hand a claimed job back untouched (the claim's attempt is not a real attempt).
  await GHLSyncJob.updateOne(
    { _id: job._id, status: "processing" },
    { $set: { status: "pending", lockedUntil: null, nextAttemptAt: new Date(Date.now() + delayMs) }, $inc: { attempts: -1 } }
  );
}

async function supersede(job, reason) {
  await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "superseded", completedAt: new Date(), lockedUntil: null, lastError: reason } });
}

// Updates the case's sync fields only if the case is still at the job's version.
const settleCase = (job, set) =>
  Case.updateOne({ _id: job.caseId, "integrations.ghl.sync.version": job.caseSyncVersion }, { $set: set });

async function processJob(job, { client } = {}) {
  // One write per case at a time, so an older request can never land after a newer one.
  const sibling = await GHLSyncJob.exists({ caseId: job.caseId, status: "processing", _id: { $ne: job._id }, lockedUntil: { $gt: new Date() } });
  if (sibling) return release(job, 2000);

  // Employee-sync jobs (create opportunity / status / rename) have their own runner. Stage moves continue below, unchanged.
  if (job.type && job.type !== "stage") return processAuxJob(job, { client });

  const caseDoc = await Case.findById(job.caseId).lean();
  const ghl = caseDoc?.integrations?.ghl;
  if (!ghl) return supersede(job, "case no longer linked to GHL");

  // HARD INVARIANT: re-check immediately before the GHL mutation. A newer drag
  // (higher version) or an inbound GHL change makes this write stale: send nothing.
  const stillCurrent = job.caseSyncVersion === (ghl.sync?.version || 0) && job.pipelineStageId === ghl.pipelineStageId;
  if (!stillCurrent) return supersede(job, "superseded by a newer change");

  try {
    await opportunityService.updateOpportunityStage(job.opportunityId,{ pipelineId: job.pipelineId, pipelineStageId: job.pipelineStageId }, client || getWorkerClient());
  } catch (error) {
    return handleSendFailure(job, error);
  }

  await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "done", completedAt: new Date(), lockedUntil: null, lastError: null } });
  // Only mark the case synced if no newer change arrived while we were sending.
  await settleCase(job, {
    "integrations.ghl.sync.state": "synced",
    "integrations.ghl.sync.lastSyncedStageId": job.pipelineStageId,
    "integrations.ghl.sync.attempts": 0,
    "integrations.ghl.sync.lastError": null,
    "integrations.ghl.lastSyncedAt": new Date(),
  });
  return { status: "done" };
}

// ---- employee-sync jobs (see ghlAuxOutbound.js) ----

async function processAuxJob(job, { client } = {}) {
  let outcome;
  try {
    outcome = await require("./ghlAuxOutbound").runAuxJob(job, { client: client || getWorkerClient() });
  } catch (error) {
    return handleAuxFailure(job, error);
  }
  if (outcome === "skipped") {
    await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "superseded", completedAt: new Date(), lockedUntil: null, lastError: "nothing to do (state already matches or no longer applies)" } });
    return { status: "skipped" };
  }
  await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "done", completedAt: new Date(), lockedUntil: null, lastError: null } });
  return { status: "done" };
}

// Same retry policy as a stage move: transient errors back off and retry; anything else (or too many tries) is flagged
// on the card, shown to admins as FAILED, and an admin is alerted. Nothing the user did is ever rolled back.
async function handleAuxFailure(job, error) {
  const message = String(error.message || error).slice(0, 300);
  const retryable = error instanceof GHLApiError ? error.retryable : true;
  if (retryable && job.attempts < MAX_ATTEMPTS) {
    const delay = error.retryAfterMs ?? backoffMs(job.attempts);
    await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "pending", lockedUntil: null, nextAttemptAt: new Date(Date.now() + delay), lastError: message } });
    logger.warn("ghl_employee_sync_retry_scheduled", { jobId: String(job._id), type: job.type, attempt: job.attempts, status: error.status, delayMs: delay });
    return { status: "retry" };
  }
  await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "failed", completedAt: new Date(), lockedUntil: null, lastError: message } });
  await Case.updateOne(
    { _id: job.caseId },
    { $set: { "integrations.ghl.flags.needsAttention": true, "integrations.ghl.sync.state": "failed", "integrations.ghl.sync.lastError": message, ...(error.status === 404 ? { "integrations.ghl.flags.deletedInGhl": true } : {}) } }
  );
  logger.error("ghl_employee_sync_failed", { jobId: String(job._id), caseId: String(job.caseId), type: job.type, status: error.status, error: message });
  await alertAdmins(job, message);
  return { status: "failed" };
}

async function handleSendFailure(job, error) {
  const message = String(error.message || error).slice(0, 300);
  const retryable = error instanceof GHLApiError ? error.retryable : true;

  if (retryable && job.attempts < MAX_ATTEMPTS) {
    const delay = error.retryAfterMs ?? backoffMs(job.attempts);
    await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "pending", lockedUntil: null, nextAttemptAt: new Date(Date.now() + delay), lastError: message } });
    await settleCase(job, { "integrations.ghl.sync.attempts": job.attempts, "integrations.ghl.sync.lastError": message });
    logger.warn("ghl_outbound_retry_scheduled", { jobId: String(job._id), attempt: job.attempts, status: error.status, delayMs: delay });
    return { status: "retry" };
  }

  // Permanent: a 404 means the opportunity is gone in GHL; other 4xx/exhausted retries need a human.
  await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "failed", completedAt: new Date(), lockedUntil: null, lastError: message } });
  await settleCase(job, {
    "integrations.ghl.sync.state": "failed",
    "integrations.ghl.sync.lastError": message,
    "integrations.ghl.flags.needsAttention": true,
    ...(error.status === 404 ? { "integrations.ghl.flags.deletedInGhl": true } : {}),
  });
  logger.error("ghl_outbound_failed", { jobId: String(job._id), caseId: String(job.caseId), status: error.status, error: message });
  await alertAdmins(job, message);
  return { status: "failed" };
}

async function alertAdmins(job, message) {
  try {
    const caseDoc = await Case.findById(job.caseId).select("caseNumber").lean();
    await notificationService.createForRoles(
      ["admin", "super_admin"],
      {
        type: "general",
        category: "general",
        title: "GoHighLevel sync failed",
        message: `Case ${caseDoc?.caseNumber || job.caseId} could not be moved in GHL. It will be retried by an admin or reconciliation.`,
        caseId: job.caseId,
        priority: "high",
        source: "shared",
        metadata: { jobId: String(job._id) },
      },
      null,
      null
    );
    realtimeGateway.emitToRole("admin", "ghl:sync:failed", { caseId: job.caseId });
    realtimeGateway.emitToRole("super_admin", "ghl:sync:failed", { caseId: job.caseId });
  } catch (error) {
    logger.warn("ghl_admin_alert_failed", { error: error.message });
  }
}

async function runClaimed(job, options) {
  try {
    return await processJob(job, options);
  } catch (error) {
    logger.error("ghl_outbound_job_crashed", { jobId: String(job._id), error: error.message });
    // Unexpected error: put it back for another try rather than stranding it as "processing".
    await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "pending", lockedUntil: null, nextAttemptAt: new Date(Date.now() + 30000), lastError: String(error.message).slice(0, 300) } });
    return { status: "crashed" };
  }
}

async function processDueJobs(limit = 25, options) {
  let handled = 0;
  while (handled < limit) {
    const job = await claimJob();
    if (!job) break;
    await runClaimed(job, options);
    handled += 1;
  }
  return handled;
}

function processJobSoon(jobId) {
  setImmediate(async () => {
    try {
      const job = await claimJob(jobId);
      if (job) await runClaimed(job);
    } catch (error) {
      logger.error("ghl_outbound_fast_path_failed", { error: error.message });
    }
  });
}

// Admin: re-queue a failed write, but only if it is still the latest change for the case.
async function retryJob(jobId) {
  const job = await GHLSyncJob.findById(jobId);
  if (!job) throw httpError(404, "Job not found");
  if (job.status !== "failed") throw httpError(409, "Only failed jobs can be retried");
  if (job.type && job.type !== "stage") {
    // Employee-sync jobs recompute what to do when they run, so a retry needs no version check.
    await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null, completedAt: null } });
    await Case.updateOne({ _id: job.caseId }, { $set: { "integrations.ghl.sync.state": "synced", "integrations.ghl.sync.lastError": null } });
    processJobSoon(job._id);
    return { status: "queued" };
  }
  const caseDoc = await Case.findById(job.caseId).select("integrations.ghl.sync.version").lean();
  if ((caseDoc?.integrations?.ghl?.sync?.version || 0) !== job.caseSyncVersion) {
    await supersede(job, "superseded by a newer change");
    throw httpError(409, "A newer change exists for this case; nothing to retry");
  }
  await GHLSyncJob.updateOne({ _id: job._id }, { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null, completedAt: null } });
  await Case.updateOne({ _id: job.caseId, "integrations.ghl.sync.version": job.caseSyncVersion }, { $set: { "integrations.ghl.sync.state": "pending", "integrations.ghl.sync.lastError": null } });
  processJobSoon(job._id);
  return { status: "queued" };
}

module.exports = { getWorkerClient, assertCanWorkCase, moveCaseStage, processDueJobs, processJob, claimJob, processJobSoon, retryJob, MAX_ATTEMPTS };
