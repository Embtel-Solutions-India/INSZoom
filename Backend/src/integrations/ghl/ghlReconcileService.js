// Reconciliation: the safety net under the webhooks. Every so often (and on demand) it reads every opportunity of each
// enabled pipeline from GHL and brings Immiglance in line, so a missed, delayed or never-delivered webhook can never leave
// the two systems apart for long.
//
//   - an opportunity Immiglance has no card for is created (same factory as the webhook and the initial sync; emails only
//     if GHL_IMPORT_SENDS_EMAILS is on, so a first run never floods anyone);
//   - an existing card whose stage differs from GHL's is decided by the SAME conflict rule the webhook uses (an unresolved
//     outbound move wins; an older GHL change never overwrites a newer local one) and applied by the same code;
//   - an opportunity that has disappeared from GHL is only FLAGGED (deletedInGhl + needs attention), never deleted;
//   - each pipeline is independent: one failing pipeline is marked degraded and never blocks the other.
// Idempotent and safe to repeat; one instance at a time via the shared job lock (see ghlWorkers.js).

const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const GHLCaseLink = require("../../models/GHLCaseLink");
const pipelineService = require("./ghlPipelineService");
const syncService = require("./ghlSyncService");
const opportunityService = require("./ghlOpportunityService");
const { resolveContact } = require("./ghlContactService");
const { createCaseFromOpportunity, findCaseByOpportunity } = require("./ghlCaseFactory");
const visaService = require("./ghlVisaService");
const { GHLApiError } = require("./ghlClient");

const MAX_MISSING_CHECKS = Number(process.env.GHL_RECONCILE_MISSING_CHECKS || 50);
const PACE_MS = Number(process.env.GHL_RECONCILE_PACE_MS || 0); // optional pause between per-opportunity API calls (rate limits)
// The "is it deleted in GHL?" lookups are the expensive part, so on the frequent timer they run only every Nth pass.
const MISSING_EVERY = Number(process.env.GHL_RECONCILE_MISSING_EVERY || 10);
let passes = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reconcilePipeline(pipeline, config, client, summary) {
  const result = { pipeline: pipeline.ghlPipelineName, fetched: 0, created: 0, stageUpdated: 0, unchanged: 0, skippedUnmapped: 0, failed: 0, errors: [] };
  summary.pipelines.push(result);
  const seen = new Set();
  let opportunities;
  try {
    opportunities = await opportunityService.fetchAllOpportunities(pipeline.ghlPipelineId, { client });
    pipeline.lastFetchOkAt = new Date();
    pipeline.lastFetchError = undefined;
  } catch (error) {
    pipeline.lastFetchError = error.message;
    result.failed += 1;
    result.errors.push({ message: error.message });
    summary.complete = false;
    logger.error("ghl_reconcile_pipeline_failed", { pipeline: pipeline.ghlPipelineName, error: error.message });
    return seen;
  }
  result.fetched = opportunities.length;
  const { applyStageChange } = require("./ghlWebhookService"); // lazy: the webhook service requires this module's neighbours

  for (const opportunity of opportunities) {
    seen.add(opportunity.id);
    try {
      const mapping = pipelineService.resolveUnifiedStage(config.stageMappings, opportunity.pipelineId, opportunity.pipelineStageId);
      if (!mapping) { result.skippedUnmapped += 1; continue; }
      const existing = await findCaseByOpportunity(config.locationId, opportunity.id);
      if (!existing) {
        const contact = await resolveContact(opportunity, client);
        const visaResolution = await visaService.resolveForOpportunity({ opportunity, config, client, pipelineCategory: pipeline.category });
        const outcome = await createCaseFromOpportunity({
          opportunity, contact, category: pipeline.category, mapping, origin: "reconciliation",
          sendNotifications: env.ghl.importSendsEmails, locationId: config.locationId, visaResolution,
        });
        if (outcome.created) result.created += 1; else result.unchanged += 1;
        continue;
      }
      // A flagged "deleted in GHL" case that is back: clear the flag.
      if (existing.integrations?.ghl?.flags?.deletedInGhl) {
        await Case.updateOne({ _id: existing._id }, { $set: { "integrations.ghl.flags.deletedInGhl": false } });
      }
      const decision = await applyStageChange({ deferrals: 0, eventTimestamp: null }, existing, opportunity, pipeline, mapping);
      if (decision.outcome === "processed") result.stageUpdated += 1; else result.unchanged += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ opportunityId: opportunity.id, message: error.message });
      logger.error("ghl_reconcile_opportunity_failed", { opportunityId: opportunity.id, error: error.message });
    }
    if (PACE_MS) await sleep(PACE_MS);
  }
  return seen;
}

// Linked opportunities that no pipeline returned: confirm each one is really gone (404) before flagging it.
async function flagMissing(config, client, seenIds, summary) {
  const links = await GHLCaseLink.find({ locationId: config.locationId }).select("opportunityId caseId").lean();
  const candidates = links.filter((link) => !seenIds.has(link.opportunityId)).slice(0, MAX_MISSING_CHECKS);
  let flagged = 0;
  for (const link of candidates) {
    try {
      await opportunityService.getOpportunity(link.opportunityId, { client });
    } catch (error) {
      if (error instanceof GHLApiError && error.status === 404) {
        await Case.updateOne({ _id: link.caseId }, { $set: { "integrations.ghl.flags.deletedInGhl": true, "integrations.ghl.flags.needsAttention": true } });
        flagged += 1;
      }
      // any other error: not proof of deletion, leave it for the next run
    }
    if (PACE_MS) await sleep(PACE_MS);
  }
  summary.flaggedDeleted = flagged;
}

// Tell every open board something changed (the same event a webhook-driven change emits), so the stage appears live.
function notifyBoards(summary) {
  const changed = summary.pipelines.reduce((n, p) => n + p.created + p.stageUpdated, 0) + (summary.flaggedDeleted || 0);
  if (!changed) return;
  try {
    const realtimeGateway = require("../../modules/realtime/realtime.gateway");
    ["super_admin", "admin", "team_lead", "case_manager"].forEach((role) => realtimeGateway.emitToRole(role, "ghl:pipeline:updated", { kind: "reconcile", source: "ghl" }));
  } catch (error) {
    logger.warn("ghl_realtime_emit_failed", { error: error.message });
  }
}

async function reconcile({ client, full = false } = {}) {
  const setup = await syncService.loadOrBuildConfig({ client });
  if (!setup.ok) return { ok: false, problems: setup.problems, drift: setup.drift };
  const { config } = setup;
  if (!config.mappingsConfirmedAt) return { ok: false, problems: ["Stage mapping has not been confirmed by an admin yet"], needsConfirmation: true };

  const summary = { ok: true, complete: true, pipelines: [], flaggedDeleted: 0 };
  const seenIds = new Set();
  for (const pipeline of config.pipelines.filter((p) => p.enabled)) {
    const seen = await reconcilePipeline(pipeline, config, client, summary);
    seen.forEach((id) => seenIds.add(id));
  }
  // only when EVERY pipeline was read in full can an absent opportunity mean "deleted"
  passes += 1;
  if (summary.complete && (full || passes % MISSING_EVERY === 1)) await flagMissing(config, client, seenIds, summary).catch((error) => logger.error("ghl_reconcile_missing_failed", { error: error.message }));

  summary.ok = summary.complete;
  notifyBoards(summary);
  config.lastReconcileAt = new Date();
  if (summary.complete) config.lastApiOkAt = new Date();
  config.status = summary.complete ? "healthy" : "degraded";
  await config.save();
  logger.info("ghl_reconcile_done", { pipelines: summary.pipelines.map((p) => ({ name: p.pipeline, fetched: p.fetched, created: p.created, stageUpdated: p.stageUpdated, failed: p.failed })), flaggedDeleted: summary.flaggedDeleted });
  return summary;
}

module.exports = { reconcile };
