// Reconciliation: the safety net under the webhooks. Every so often (and on demand) it reads every opportunity of each
// enabled pipeline from GHL and brings Immiglance in line, so a missed, delayed or never-delivered webhook can never leave
// the two systems apart for long.
//
//   - an opportunity Immiglance has no card for is created (same factory as the webhook and the initial sync; emails only
//     if GHL_IMPORT_SENDS_EMAILS is on, so a first run never floods anyone);
//   - an existing card whose stage differs from GHL's is decided by the SAME conflict rule the webhook uses (an unresolved
//     outbound move wins; an older GHL change never overwrites a newer local one) and applied by the same code;
//   - an opportunity that has disappeared from GHL is FLAGGED (deletedInGhl + time) and, once confirmed gone again a couple of minutes later,
//     its case is deleted (ghlDeletedInGhl.js) - the mirror of "delete in the software -> the GHL card is deleted";
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
const { createCaseFromOpportunity, findCaseByOpportunity, isOrphanedLink, syncCardName } = require("./ghlCaseFactory");
const visaService = require("./ghlVisaService");
const { GHLApiError } = require("./ghlClient");
const deletedInGhl = require("./ghlDeletedInGhl");

const MAX_MISSING_CHECKS = Number(process.env.GHL_RECONCILE_MISSING_CHECKS || 50);
const PACE_MS = Number(process.env.GHL_RECONCILE_PACE_MS || 0); // optional pause between per-opportunity API calls (rate limits)
// The "is it deleted in GHL?" lookups only happen for a linked opportunity that the pipelines did NOT return - rare, so every pass checks (a
// card deleted in GHL must disappear here promptly). Set GHL_RECONCILE_MISSING_EVERY=N to check only every Nth pass.
const MISSING_EVERY = Number(process.env.GHL_RECONCILE_MISSING_EVERY || 1);
let passes = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the fast path (2026-11-13) ----------------------------------------------------------------------------------------------------------------------------------------------------
// The pass used to cost THREE database round trips per opportunity even when nothing had changed (link lookup, case lookup, a "last synced" write): about a minute for 74 cards on a remote
// database, longer than the 30-second timer, so passes overlapped and were skipped. Now one batch read per pipeline loads every linked case, and an opportunity that provably matches its case
// (same pipeline + stage, status, name, e-mail, money, no pending change or flag) costs nothing; the "last synced" stamp for all of them is ONE write. Anything that differs goes through the
// unchanged per-opportunity path below, so no sync rule is bypassed.

/** Pure. True when applying this opportunity to its case would change nothing. */
function isUnchanged({ existing, opportunity, mapping, moneyIds }) {
  const ghl = existing?.integrations?.ghl;
  if (!ghl?.opportunityId || !mapping) return false;
  if (ghl.pipelineId !== opportunity.pipelineId || ghl.pipelineStageId !== opportunity.pipelineStageId) return false;
  if (ghl.unifiedStageKey !== mapping.unifiedStageKey) return false;
  if (opportunity.status && opportunity.status !== ghl.opportunityStatus) return false;
  if (ghl.flags?.deletedInGhl) return false;
  if ((ghl.sync?.state || "synced") !== "synced") return false; // a pending / failed change goes through the full decision
  const cardName = String(opportunity.name || "").trim();
  if (cardName && ghl.role === "individual" && existing.caseRole !== "employee" && existing.clientName !== cardName) return false; // a rename in GHL
  if (!existing.clientEmail && !existing.user && existing.caseRole !== "employee" && ghl.role !== "family" && opportunity.contact?.email) return false; // an e-mail to fill in
  if (!existing.finance?.pendingPush) {
    if (!Array.isArray(opportunity.customFields) || opportunity.monetaryValue === undefined || !moneyIds) return false; // the figures are not on the list: the full path reads the card
    const finance = require("./ghlFinance");
    const incoming = finance.financeFromOpportunity(opportunity, moneyIds);
    if (existing.finance ? !finance.sameFinance(existing.finance, incoming) : finance.hasMoney(incoming)) return false;
  }
  // the card's Invoice URL (shown in the case's Invoices popup): a change, or a link still being written to the card, takes the full path
  if (moneyIds?.invoice_url) {
    const finance = require("./ghlFinance");
    if (finance.invoiceUrlFromOpportunity(opportunity, moneyIds) !== String(existing.invoiceLinks?.ghlValue || "")) return false;
    if (existing.invoiceLinks?.pending !== undefined && existing.invoiceLinks?.pending !== null) return false;
  }
  return true;
}

// { linked: opportunityId -> case, orphaned: Set of opportunity ids whose link has stood for a while but whose case no longer exists (a deleted case whose card is still in GHL) }
async function loadLinkedCases(locationId, opportunities) {
  const links = await GHLCaseLink.find({ locationId, opportunityId: { $in: opportunities.map((o) => o.id) } }).select("opportunityId caseId createdAt").lean();
  if (!links.length) return { linked: new Map(), orphaned: new Set() };
  const cases = await Case.find({ _id: { $in: links.map((l) => l.caseId) } }).select("caseRole clientName clientEmail user finance integrations.ghl +invoiceLinks").lean();
  const byId = new Map(cases.map((c) => [String(c._id), c]));
  const linked = new Map();
  const orphaned = new Set();
  for (const link of links) {
    const found = byId.get(String(link.caseId));
    if (found) linked.set(link.opportunityId, found);
    else if (Date.now() - new Date(link.createdAt).getTime() > 2 * 60 * 1000) orphaned.add(link.opportunityId); // same 2-minute rule as isOrphanedLink
  }
  return { linked, orphaned };
}

async function reconcilePipeline(pipeline, config, client, summary) {
  const result = { pipeline: pipeline.ghlPipelineName, fetched: 0, created: 0, stageUpdated: 0, unchanged: 0, skippedUnmapped: 0, orphaned: 0, failed: 0, errors: [] };
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
  // one batch read for the whole pipeline (see the fast path above); a failure here only means every opportunity takes the full path
  let linked = new Map();
  let orphaned = new Set();
  let moneyIds = null;
  try {
    [{ linked, orphaned }, moneyIds] = await Promise.all([loadLinkedCases(config.locationId, opportunities), require("./ghlFinance").moneyFieldIds(client).catch(() => null)]);
  } catch (error) {
    logger.warn("ghl_reconcile_batch_load_failed", { pipeline: pipeline.ghlPipelineName, error: error.message });
  }
  const unchangedCaseIds = [];

  for (const opportunity of opportunities) {
    seen.add(opportunity.id);
    try {
      const mapping = pipelineService.resolveUnifiedStage(config.stageMappings, opportunity.pipelineId, opportunity.pipelineStageId);
      if (!mapping) { result.skippedUnmapped += 1; continue; }
      if (orphaned.has(opportunity.id)) { result.orphaned += 1; continue; } // its case is gone (deleted) but the card is still in GHL: nothing to import, no queries
      const batched = linked.get(opportunity.id);
      if (batched && isUnchanged({ existing: batched, opportunity, mapping, moneyIds })) {
        unchangedCaseIds.push(batched._id);
        result.unchanged += 1;
        continue;
      }
      const existing = await findCaseByOpportunity(config.locationId, opportunity.id);
      if (!existing) {
        // its case was deleted but the card is still in GHL: nothing to import (and no GHL calls to spend on it)
        if ((await isOrphanedLink(config.locationId, opportunity.id)) || (await require("./ghlCaseOutbound").isDeletionPending(opportunity.id))) { result.orphaned += 1; continue; }
        // a card Immiglance itself created (it carries the case's marker) is linked to its case, never imported as a second one - the same check the webhook makes
        const own = await require("./ghlAuxOutbound").adoptOwnOpportunity({ opportunity, config, pipeline, mapping, client }).catch(() => null);
        if (own) { result.unchanged += 1; continue; }
        const contact = await resolveContact(opportunity, client);
        const visaResolution = await visaService.resolveForOpportunity({ opportunity, config, client, pipelineCategory: pipeline.category });
        const outcome = await createCaseFromOpportunity({
          opportunity, contact, category: pipeline.category, mapping, origin: "reconciliation",
          sendNotifications: env.ghl.importSendsEmails, locationId: config.locationId, visaResolution,
        });
        if (outcome.created) result.created += 1;
        else if (outcome.skipped === "orphaned_link") result.orphaned += 1;
        else result.unchanged += 1;
        continue;
      }
      // A flagged "deleted in GHL" case that is back: clear the flag.
      if (existing.integrations?.ghl?.flags?.deletedInGhl) await deletedInGhl.clearDeletedInGhl(existing._id);
      await fillMissingClientEmail(existing, opportunity);
      await syncCardName(existing, opportunity);
      await require("./ghlFinance").syncCaseFinance(existing, opportunity, { client }); // keeps the money current even when a webhook was missed (never throws)
      const decision = await applyStageChange({ deferrals: 0, eventTimestamp: null }, existing, opportunity, pipeline, mapping);
      if (decision.outcome === "processed") result.stageUpdated += 1; else result.unchanged += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ opportunityId: opportunity.id, message: error.message });
      logger.error("ghl_reconcile_opportunity_failed", { opportunityId: opportunity.id, error: error.message });
    }
    if (PACE_MS) await sleep(PACE_MS);
  }
  // the "last synced" stamp of every unchanged case: one write instead of one per case
  if (unchangedCaseIds.length) await Case.updateMany({ _id: { $in: unchangedCaseIds } }, { $set: { "integrations.ghl.lastSyncedAt": new Date() } }, { timestamps: false }).catch((error) => logger.warn("ghl_reconcile_stamp_failed", { error: error.message }));
  return seen;
}

// The card's Primary Email is its GHL contact's email. A case imported while that contact had none takes it as soon as GHL has one (this is the
// fallback for a ContactUpdate webhook that never arrived). Same rules as the webhook: only fills an EMPTY clientEmail, never an employee card
// (the contact is the employer), a family case (clientEmail is the beneficiary's) or a case whose client already has a login.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function fillMissingClientEmail(existing, opportunity) {
  const email = String(opportunity?.contact?.email || "").trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return;
  if (existing.clientEmail || existing.user || existing.caseRole === "employee" || existing.integrations?.ghl?.role === "family") return;
  await Case.updateOne({ _id: existing._id, $or: [{ clientEmail: { $exists: false } }, { clientEmail: "" }], user: { $exists: false } }, { $set: { clientEmail: email } })
    .catch((error) => logger.error("ghl_fill_client_email_failed", { caseId: String(existing._id), error: error.message }));
}

// Linked opportunities that no pipeline returned: confirm each one is really gone (404) before flagging it.
async function flagMissing(config, client, seenIds, summary) {
  const links = await GHLCaseLink.find({ locationId: config.locationId }).select("opportunityId caseId").lean();
  const candidates = links.filter((link) => !seenIds.has(link.opportunityId)).slice(0, MAX_MISSING_CHECKS);
  // A link whose CASE is gone (deleted, or sitting in the recycle bin) has nobody to flag. If its card is gone from GHL too, the link has served its purpose and is removed (it used to be
  // re-checked - one GHL call and two no-op writes each - on every single pass, forever). If the card is still in GHL the link stays: it keeps that card from being re-imported as a new case.
  const alive = new Set((await Case.find({ _id: { $in: candidates.map((link) => link.caseId) } }).select("_id").lean()).map((row) => String(row._id)));
  let flagged = 0;
  for (const link of candidates) {
    if (!alive.has(String(link.caseId))) {
      try {
        await (client ? opportunityService.getOpportunity(link.opportunityId, client) : opportunityService.getOpportunity(link.opportunityId)); // still there: an orphan card, keep the link
      } catch (error) {
        if (error instanceof GHLApiError && error.status === 404) await GHLCaseLink.deleteOne({ _id: link._id }).catch(() => null);
      }
      if (PACE_MS) await sleep(PACE_MS);
      continue;
    }
    try {
      // getOpportunity(id, client) takes the client ITSELF (default: the shared one). It used to be called with { client }, which threw "client.get
      // is not a function" - not a GHL 404 - so a card deleted in GHL was never recognised as deleted.
      await (client ? opportunityService.getOpportunity(link.opportunityId, client) : opportunityService.getOpportunity(link.opportunityId));
    } catch (error) {
      if (error instanceof GHLApiError && error.status === 404) {
        await deletedInGhl.flagDeletedInGhl(link.caseId); // deleted for good by deleteCasesRemovedInGhl once it is confirmed gone again
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

  const startedAt = Date.now();
  const summary = { ok: true, complete: true, pipelines: [], flaggedDeleted: 0 };
  const seenIds = new Set();
  for (const pipeline of config.pipelines.filter((p) => p.enabled)) {
    const seen = await reconcilePipeline(pipeline, config, client, summary);
    seen.forEach((id) => seenIds.add(id));
  }
  // only when EVERY pipeline was read in full can an absent opportunity mean "deleted"
  passes += 1;
  if (summary.complete && (full || MISSING_EVERY <= 1 || passes % MISSING_EVERY === 1)) await flagMissing(config, client, seenIds, summary).catch((error) => logger.error("ghl_reconcile_missing_failed", { error: error.message }));
  // a card deleted in GHL deletes its case here, once it has stayed gone (see ghlDeletedInGhl.js); only after a pass that read every pipeline in full
  if (summary.complete) {
    summary.deletedCases = await deletedInGhl.deleteCasesRemovedInGhl({ client });
    summary.flaggedDeleted += summary.deletedCases.deleted; // so the boards refresh
  }

  summary.ok = summary.complete;
  await require("./ghlHealthService").healStaleFailures(); // a card left red by an old failure goes back to synced once nothing is waiting for it
  notifyBoards(summary);
  config.lastReconcileAt = new Date();
  config.lastReconcileSummary = {
    at: config.lastReconcileAt,
    tookMs: Date.now() - startedAt,
    orphaned: summary.pipelines.reduce((n, p) => n + (p.orphaned || 0), 0),
    pipelines: summary.pipelines.map((p) => ({ name: p.pipeline, fetched: p.fetched, created: p.created, stageUpdated: p.stageUpdated, unchanged: p.unchanged, orphaned: p.orphaned, failed: p.failed })),
  };
  if (summary.complete) config.lastApiOkAt = new Date();
  config.status = summary.complete ? "healthy" : "degraded";
  await config.save();
  logger.info("ghl_reconcile_done", { pipelines: summary.pipelines.map((p) => ({ name: p.pipeline, fetched: p.fetched, created: p.created, stageUpdated: p.stageUpdated, orphaned: p.orphaned, failed: p.failed })), flaggedDeleted: summary.flaggedDeleted });
  return summary;
}

module.exports = { fillMissingClientEmail, reconcile, isUnchanged };
