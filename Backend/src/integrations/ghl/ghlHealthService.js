// The GoHighLevel sync-health view for admins: is the sync alive, are webhooks arriving, what is stuck and why - and one action to retry everything now.
// Read-only apart from retryAll (which only moves "try again at" to now; it never changes a case). Never exposes a secret or a token.
const env = require("../../config/env");
const Case = require("../../models/Case");
const GHLIntegration = require("../../models/GHLIntegration");
const GHLSyncJob = require("../../models/GHLSyncJob");
const GHLWebhookEvent = require("../../models/GHLWebhookEvent");
const { describeSync } = require("./ghlSyncState");

const PROBLEM_LIMIT = 100;
const KIND_ORDER = ["card_deleted", "needs_attention", "waiting_email", "retrying"];
const CASE_FIELDS = "caseNumber clientName caseRole parentCase integrations.ghl.sync integrations.ghl.flags integrations.ghl.opportunityId";

async function getSyncHealth() {
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId }).lean();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [pending, retrying, processing, flaggedCases, retryingJobs, eventsTotal, events24h, eventsDead, eventsFailed] = await Promise.all([
    GHLSyncJob.countDocuments({ status: "pending" }),
    GHLSyncJob.countDocuments({ status: "pending", attempts: { $gt: 0 }, lastError: { $ne: null } }),
    GHLSyncJob.countDocuments({ status: "processing" }),
    Case.find({ $or: [{ "integrations.ghl.sync.state": "failed" }, { "integrations.ghl.flags.deletedInGhl": true }] }).select(CASE_FIELDS).limit(PROBLEM_LIMIT).lean(),
    GHLSyncJob.find({ status: "pending", attempts: { $gt: 0 }, lastError: { $ne: null }, type: { $ne: "delete_opportunity" } }).sort({ nextAttemptAt: 1 }).limit(PROBLEM_LIMIT).select("type caseId attempts lastError nextAttemptAt").lean(),
    GHLWebhookEvent.countDocuments({}),
    GHLWebhookEvent.countDocuments({ receivedAt: { $gte: since } }),
    GHLWebhookEvent.countDocuments({ status: "dead" }),
    GHLWebhookEvent.countDocuments({ status: "failed" }),
  ]);

  // one row per case, whichever of the case flags or its waiting job found it
  const jobsByCase = new Map(retryingJobs.map((job) => [String(job.caseId), job]));
  const rows = new Map();
  for (const doc of flaggedCases) rows.set(String(doc._id), { doc, job: jobsByCase.get(String(doc._id)) || null });
  const missing = retryingJobs.filter((job) => !rows.has(String(job.caseId)));
  if (missing.length) {
    const docs = await Case.find({ _id: { $in: missing.map((job) => job.caseId) } }).select(CASE_FIELDS).lean();
    docs.forEach((doc) => rows.set(String(doc._id), { doc, job: jobsByCase.get(String(doc._id)) || null }));
  }
  const problems = [...rows.values()]
    .map(({ doc, job }) => {
      const detail = describeSync(doc.integrations?.ghl, job) || { kind: "retrying", text: "Waiting to be sent", attempts: job?.attempts || 0 };
      return {
        caseId: String(doc._id),
        caseNumber: doc.caseNumber,
        name: doc.clientName || null,
        kind: detail.kind,
        text: detail.text,
        attempts: detail.attempts,
        nextAttemptAt: job?.nextAttemptAt || null,
        jobId: job ? String(job._id) : null,
        jobType: job?.type || null,
      };
    })
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const reconcileAt = config?.lastReconcileAt || null;
  const summary = config?.lastReconcileSummary || null;
  return {
    enabled: Boolean(env.ghl.enabled && env.ghl.token && env.ghl.locationId),
    status: config?.status || "unconfigured",
    lastApiOkAt: config?.lastApiOkAt || null,
    reconcile: {
      lastAt: reconcileAt,
      ageSeconds: reconcileAt ? Math.round((Date.now() - new Date(reconcileAt).getTime()) / 1000) : null,
      tookMs: summary?.tookMs ?? null,
      orphanedCards: summary?.orphaned ?? null,
      pipelines: summary?.pipelines || [],
    },
    webhooks: {
      configured: Boolean(env.ghl.webhookPublicKey),
      publicUrlSet: Boolean(env.ghl.webhookPublicUrl),
      lastReceivedAt: config?.lastWebhookAt || null,
      total: eventsTotal,
      last24h: events24h,
      dead: eventsDead,
      failed: eventsFailed,
    },
    jobs: { pending, retrying, processing },
    problems,
    problemCount: problems.length,
  };
}

/**
 * Retry everything that is waiting for its next try, now: every pending job that has failed before is made due immediately (and legacy failed jobs of cases that still exist are re-queued).
 * Returns how many were moved. The worker picks them up within seconds.
 */
async function retryAll() {
  const due = await GHLSyncJob.updateMany({ status: "pending", attempts: { $gt: 0 } }, { $set: { nextAttemptAt: new Date() } });
  const failed = await GHLSyncJob.find({ status: "failed", type: { $ne: "delete_opportunity" } }).select("_id caseId type").lean();
  const aliveIds = new Set((await Case.find({ _id: { $in: failed.map((job) => job.caseId) } }).select("_id").lean()).map((doc) => String(doc._id)));
  const requeue = failed.filter((job) => aliveIds.has(String(job.caseId)) && job.type !== "stage").map((job) => job._id);
  if (requeue.length) await GHLSyncJob.updateMany({ _id: { $in: requeue } }, { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null, completedAt: null } });
  setImmediate(() => require("./ghlOutboundService").processDueJobs().catch(() => {}));
  const healed = await healStaleFailures();
  return { moved: (due.modifiedCount || 0) + requeue.length, healed };
}

/**
 * A case whose sync state still says "failed" although nothing is waiting for it any more (its change went through later, or the job was replaced) goes back to "synced". Without this a card
 * stayed red for good. Leaves the "needs attention" flag alone: it also marks other things (an unmapped visa). Returns how many were cleared. Never throws.
 */
async function healStaleFailures() {
  try {
    const stuck = await Case.find({ "integrations.ghl.sync.state": "failed", "integrations.ghl.flags.deletedInGhl": { $ne: true } }).select("_id").lean();
    if (!stuck.length) return 0;
    const ids = stuck.map((row) => row._id);
    const busy = new Set((await GHLSyncJob.find({ caseId: { $in: ids }, status: { $in: ["pending", "processing", "failed"] }, type: { $ne: "delete_opportunity" } }).select("caseId").lean()).map((row) => String(row.caseId)));
    const free = ids.filter((id) => !busy.has(String(id)));
    if (!free.length) return 0;
    const result = await Case.updateMany({ _id: { $in: free } }, { $set: { "integrations.ghl.sync.state": "synced", "integrations.ghl.sync.lastError": null, "integrations.ghl.sync.attempts": 0 } }, { timestamps: false });
    return result.modifiedCount || 0;
  } catch (_error) {
    return 0;
  }
}

module.exports = { getSyncHealth, retryAll, healStaleFailures };
