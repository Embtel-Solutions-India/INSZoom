const crypto = require("crypto");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const GHLCaseLink = require("../../models/GHLCaseLink");
const GHLIntegration = require("../../models/GHLIntegration");
const GHLWebhookEvent = require("../../models/GHLWebhookEvent");
const caseService = require("../../modules/cases/case.service");
const realtimeGateway = require("../../modules/realtime/realtime.gateway");
const { verifyGhlSignature } = require("./ghlWebhookSignature");
const { decideInboundStage, firstValidDate } = require("./ghlStageDecision");
const { resolveUnifiedStage } = require("./ghlPipelineService");
const { getOpportunity } = require("./ghlOpportunityService");
const { resolveContact } = require("./ghlContactService");
const { createCaseFromOpportunity, findCaseByOpportunity } = require("./ghlCaseFactory");
const visaService = require("./ghlVisaService");

// A pending case re-checks its visa on updates, but at most once a minute so a burst of events costs nothing.
const VISA_RECHECK_MS = 60 * 1000;

const OPPORTUNITY_EVENTS = new Set(["OpportunityCreate", "OpportunityUpdate", "OpportunityStageUpdate", "OpportunityStatusUpdate"]);
const CONTACT_EVENTS = new Set(["ContactCreate", "ContactUpdate"]);
const HANDLED_EVENTS = new Set([...OPPORTUNITY_EVENTS, ...CONTACT_EVENTS]);

const MAX_ATTEMPTS = 8;
const LEASE_MS = 2 * 60 * 1000;
const backoffMs = (attempts) => Math.min(30 * 60 * 1000, 10000 * 2 ** Math.max(0, attempts - 1));

// ---------------------------------------------------------------------------
// 1. Receive: verify -> parse -> validate -> persist -> 200 (fast)
// ---------------------------------------------------------------------------

/**
 * @param rawBody Buffer — the untouched request bytes (express.raw)
 * @param headers request headers
 * @returns { status, body, eventId? }  — never throws
 */
async function receiveWebhook(rawBody, headers = {}) {
  if (!env.ghl.enabled) return { status: 503, body: { success: false, code: "GHL_DISABLED" } };
  if (!env.ghl.webhookPublicKey) {
    logger.error("ghl_webhook_public_key_missing");
    return { status: 503, body: { success: false, code: "GHL_WEBHOOK_KEY_MISSING" } };
  }

  // Signature FIRST, on the raw bytes. Nothing below runs for an unsigned/forged request.
  const verdict = verifyGhlSignature(rawBody, headers["x-ghl-signature"], env.ghl.webhookPublicKey);
  if (!verdict.ok) {
    logger.warn("ghl_webhook_signature_rejected", { reason: verdict.reason });
    return { status: 401, body: { success: false, message: "Invalid signature" } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { success: false, message: "Invalid JSON" } };
  }
  if (!payload || typeof payload !== "object" || typeof payload.type !== "string") {
    return { status: 400, body: { success: false, message: "Missing event type" } };
  }

  // Validly signed but not ours / not interesting: acknowledge so GHL stops retrying.
  const locationId = payload.locationId || payload.location_id;
  if (locationId !== env.ghl.locationId) return { status: 200, body: { success: true, ignored: "other_location" } };
  if (!HANDLED_EVENTS.has(payload.type)) return { status: 200, body: { success: true, ignored: "unhandled_event" } };

  const eventTime = firstValidDate(payload.timestamp);
  if (eventTime && Date.now() - eventTime.getTime() > env.ghl.webhookToleranceSeconds * 1000) {
    logger.warn("ghl_webhook_stale_ignored", { type: payload.type });
    return { status: 200, body: { success: true, ignored: "stale" } };
  }

  // GHL sends a unique webhookId; fall back to a content hash so even an id-less
  // redelivery is deduped.
  const webhookId = String(payload.webhookId || `sha256:${crypto.createHash("sha256").update(rawBody).digest("hex")}`);
  const isContact = CONTACT_EVENTS.has(payload.type);
  try {
    const event = await GHLWebhookEvent.create({
      webhookId,
      eventType: payload.type,
      eventVersion: payload.version ? String(payload.version) : undefined,
      locationId,
      opportunityId: isContact ? undefined : payload.id || payload.opportunityId,
      contactId: isContact ? payload.id : payload.contactId,
      payload,
      eventTimestamp: eventTime || undefined,
    });
    // Best-effort heartbeat for the admin health panel; never affects the response.
    GHLIntegration.updateOne({ locationId }, { $set: { lastWebhookAt: new Date() } }).catch(() => {});
    return { status: 200, body: { success: true, received: true }, eventId: event._id };
  } catch (error) {
    if (error?.code === 11000) return { status: 200, body: { success: true, duplicate: true } };
    logger.error("ghl_webhook_persist_failed", { error: error.message });
    // Could not store it: ask GHL to retry rather than silently losing the event.
    return { status: 500, body: { success: false, message: "Could not record event" } };
  }
}

// ---------------------------------------------------------------------------
// 2. Process: atomic claim -> handle -> settle
// ---------------------------------------------------------------------------

async function claimNextEvent(eventId) {
  const now = new Date();
  const filter = eventId
    ? { _id: eventId, status: { $in: ["received", "failed", "deferred"] } }
    : {
        $or: [
          { status: { $in: ["received", "failed", "deferred"] }, nextAttemptAt: { $lte: now } },
          { status: "processing", lockedUntil: { $lte: now } }, // crashed worker's expired lease
        ],
      };
  return GHLWebhookEvent.findOneAndUpdate(
    filter,
    { $set: { status: "processing", lockedUntil: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now }, $inc: { processingAttempts: 1 } },
    { sort: { receivedAt: 1 }, new: true }
  );
}

async function settle(event, { outcome, delayMs, note, error, countDeferral = false }) {
  const now = new Date();
  const set = { lockedUntil: null, lastError: error ? String(error).slice(0, 500) : null };
  if (outcome === "processed" || outcome === "ignored") {
    Object.assign(set, { status: outcome, processedAt: now, lastError: note && outcome === "ignored" ? note : null });
  } else if (outcome === "deferred") {
    Object.assign(set, { status: "deferred", nextAttemptAt: new Date(now.getTime() + delayMs), lastError: note || null });
  } else {
    const dead = event.processingAttempts >= MAX_ATTEMPTS;
    Object.assign(set, { status: dead ? "dead" : "failed", nextAttemptAt: new Date(now.getTime() + backoffMs(event.processingAttempts)) });
  }
  const update = { $set: set };
  // Waiting is not a failure: give the claim's attempt back so deferral never turns an event "dead".
  if (outcome === "deferred") update.$inc = { processingAttempts: -1, ...(countDeferral ? { deferrals: 1 } : {}) };
  await GHLWebhookEvent.updateOne({ _id: event._id }, update);
}

async function processEvent(event) {
  // Per-opportunity ordering: if another worker is mid-flight on this opportunity, wait a moment.
  if (event.opportunityId) {
    const busy = await GHLWebhookEvent.exists({
      opportunityId: event.opportunityId,
      status: "processing",
      _id: { $ne: event._id },
      lockedUntil: { $gt: new Date() },
    });
    if (busy) return settle(event, { outcome: "deferred", delayMs: 2000, note: "another event for this opportunity is processing" });
  }
  try {
    const result = await handleEvent(event);
    return settle(event, result);
  } catch (error) {
    logger.error("ghl_webhook_event_failed", { webhookId: event.webhookId, type: event.eventType, attempt: event.processingAttempts, error: error.message });
    return settle(event, { outcome: "failed", error: error.message });
  }
}

async function handleEvent(event) {
  const config = await GHLIntegration.findOne({ locationId: event.locationId });
  if (!config?.mappingsConfirmedAt || !config.stageMappings?.length) {
    return { outcome: "deferred", delayMs: 60000, note: "stage mapping not confirmed yet" };
  }
  if (config.status === "config_mismatch") return { outcome: "deferred", delayMs: 60000, note: "GHL stage configuration needs admin review" };

  if (OPPORTUNITY_EVENTS.has(event.eventType)) return handleOpportunityEvent(event, config);
  if (CONTACT_EVENTS.has(event.eventType)) return handleContactEvent(event);
  return { outcome: "ignored", note: "unhandled event type" };
}

const pick = (p, ...keys) => keys.map((k) => p[k]).find((v) => v !== undefined && v !== null && v !== "");

function opportunityFromPayload(p) {
  return {
    id: pick(p, "id", "opportunityId"),
    name: p.name,
    contactId: pick(p, "contactId", "contact_id"),
    pipelineId: pick(p, "pipelineId", "pipeline_id"),
    pipelineStageId: pick(p, "pipelineStageId", "pipeline_stage_id"),
    status: p.status,
    lastStageChangeAt: pick(p, "lastStageChangeAt", "dateUpdated", "updatedAt"),
    contact: p.contact,
    customFields: Array.isArray(p.customFields) ? p.customFields : undefined,
  };
}

async function handleOpportunityEvent(event, config) {
  let opportunity = opportunityFromPayload(event.payload);
  if (!opportunity.id) return { outcome: "ignored", note: "no opportunity id" };

  // A payload without the pipeline/stage (some update events) is completed from the API.
  if (!opportunity.pipelineId || !opportunity.pipelineStageId) {
    const full = await getOpportunity(opportunity.id);
    if (!full) return { outcome: "ignored", note: "opportunity not found in GHL" };
    opportunity = { ...full, ...Object.fromEntries(Object.entries(opportunity).filter(([, v]) => v !== undefined && v !== null && v !== "")) };
    opportunity.pipelineId = opportunity.pipelineId || full.pipelineId;
    opportunity.pipelineStageId = opportunity.pipelineStageId || full.pipelineStageId;
  }

  const pipeline = config.pipelines.find((p) => p.enabled && p.ghlPipelineId === opportunity.pipelineId);
  const existing = await findCaseByOpportunity(event.locationId, opportunity.id);

  if (!pipeline) {
    // Not one of our pipelines. If it LEFT them, flag the case; never touch it otherwise.
    if (existing) await flagCase(existing._id, "Opportunity moved out of the configured GHL pipelines");
    return { outcome: "ignored", note: "pipeline not configured" };
  }
  const mapping = resolveUnifiedStage(config.stageMappings, opportunity.pipelineId, opportunity.pipelineStageId);
  if (!mapping) return { outcome: "ignored", note: "stage not mapped (possible GHL config drift)" };

  if (!existing) {
    // OpportunityCreate, or an update that arrived before its create (out of order): same path.
    const contact = await resolveContact(opportunity);
    const visaResolution = await visaService.resolveForOpportunity({ opportunity, config, pipelineCategory: pipeline.category });
    const outcome = await createCaseFromOpportunity({
      opportunity,
      contact,
      category: pipeline.category,
      mapping,
      origin: "webhook",
      sendNotifications: true,
      locationId: event.locationId,
      visaResolution,
    });
    if (outcome.created) emitPipelineUpdate(outcome.case, "created");
    return { outcome: "processed" };
  }

  await recheckPendingVisa(existing, opportunity, config, pipeline);
  return applyStageChange(event, existing, opportunity, pipeline, mapping);
}

// A case still waiting on a visa picks it up if GHL now has one. Best-effort: it never blocks or fails the event.
async function recheckPendingVisa(caseDoc, opportunity, config, pipeline) {
  try {
    if (caseDoc.visaSelectionStatus !== "pending") return;
    const last = caseDoc.integrations?.ghl?.visaResolution?.resolvedAt;
    if (last && Date.now() - new Date(last).getTime() < VISA_RECHECK_MS) return;
    const resolution = await visaService.resolveForOpportunity({ opportunity, config, pipelineCategory: pipeline.category });
    await visaService.applyToExistingCase(caseDoc, resolution);
  } catch (error) {
    logger.warn("ghl_visa_recheck_failed", { caseId: String(caseDoc._id), error: error.message });
  }
}

async function applyStageChange(event, caseDoc, opportunity, pipeline, mapping) {
  const ghl = caseDoc.integrations?.ghl?.toObject ? caseDoc.integrations.ghl.toObject() : caseDoc.integrations?.ghl || {};
  const eventTime = firstValidDate(opportunity.lastStageChangeAt, event.eventTimestamp);
  const decision = decideInboundStage({
    ghl,
    incoming: { pipelineId: opportunity.pipelineId, stageId: opportunity.pipelineStageId, eventTime },
    attempts: event.deferrals || 0,
  });

  // Status can change independently of the stage (won/lost/abandoned): keep it current, read-only.
  if (opportunity.status && opportunity.status !== ghl.opportunityStatus) {
    await Case.updateOne({ _id: caseDoc._id }, { $set: { "integrations.ghl.opportunityStatus": opportunity.status } });
  }

  if (decision.action === "defer") return { outcome: "deferred", delayMs: decision.delayMs, note: decision.reason, countDeferral: true };
  if (decision.action === "noop") {
    await Case.updateOne({ _id: caseDoc._id }, { $set: { "integrations.ghl.lastSyncedAt": new Date() } });
    return { outcome: "ignored", note: decision.reason };
  }
  if (decision.action === "ignore_older") return { outcome: "ignored", note: decision.reason };

  // Apply with optimistic concurrency on the sync version: a competing writer makes this a retry, never a lost update.
  const version = ghl.sync?.version || 0;
  const now = new Date();
  const result = await Case.updateOne(
    { _id: caseDoc._id, "integrations.ghl.sync.version": version },
    {
      $set: {
        "integrations.ghl.pipelineId": opportunity.pipelineId,
        "integrations.ghl.pipelineStageId": opportunity.pipelineStageId,
        "integrations.ghl.unifiedStageKey": mapping.unifiedStageKey,
        "integrations.ghl.category": pipeline.category,
        "integrations.ghl.opportunityStatus": opportunity.status || ghl.opportunityStatus,
        "integrations.ghl.lastSyncedAt": now,
        "integrations.ghl.sync.state": "synced",
        "integrations.ghl.sync.source": "ghl",
        "integrations.ghl.sync.changedAt": eventTime || now,
        "integrations.ghl.sync.lastSyncedStageId": opportunity.pipelineStageId,
        "integrations.ghl.sync.lastError": null,
      },
      $inc: { "integrations.ghl.sync.version": 1 },
    }
  );
  if (result.matchedCount === 0) throw new Error("Case sync version changed concurrently; will retry");

  // Case.stage (the immigration workflow stage) is deliberately NOT touched.
  const fresh = await Case.findById(caseDoc._id);
  caseService.addTimelineEvent(fresh, "case", "Pipeline stage updated from GHL", `Moved to "${mapping.unifiedStageName}"`, null, {
    source: "ghl",
    ghlPipelineId: opportunity.pipelineId,
    ghlStageId: opportunity.pipelineStageId,
    unifiedStageKey: mapping.unifiedStageKey,
    decision: decision.reason,
  });
  await fresh.save();
  emitPipelineUpdate(fresh, "stage");
  return { outcome: "processed" };
}

async function handleContactEvent(event) {
  const p = event.payload;
  const contactId = pick(p, "id", "contactId");
  if (!contactId) return { outcome: "ignored", note: "no contact id" };
  const links = await GHLCaseLink.find({ locationId: event.locationId, contactId }).lean();
  if (!links.length) return { outcome: "ignored", note: "no linked cases" };

  const first = String(p.firstName || "").trim();
  const last = String(p.lastName || "").trim();
  const name = String(p.name || p.fullName || [first, last].filter(Boolean).join(" ")).trim();
  const email = String(p.email || "").trim().toLowerCase();

  for (const link of links) {
    const caseDoc = await Case.findById(link.caseId);
    if (!caseDoc) continue;
    const set = {};
    if (name && name !== caseDoc.clientName) set.clientName = name;
    if (email && email !== caseDoc.clientEmail) {
      // The client's LOGIN is tied to the original email; never rewrite a linked account from a CRM sync.
      if (caseDoc.user) set["integrations.ghl.flags.needsAttention"] = true;
      else set.clientEmail = email;
    }
    if (Object.keys(set).length) await Case.updateOne({ _id: caseDoc._id }, { $set: set });
  }
  return { outcome: "processed" };
}

async function flagCase(caseId, reason) {
  await Case.updateOne({ _id: caseId }, { $set: { "integrations.ghl.flags.needsAttention": true, "integrations.ghl.sync.lastError": reason } });
}

function emitPipelineUpdate(caseDoc, kind) {
  try {
    const ghl = caseDoc.integrations?.ghl || {};
    const payload = { caseId: caseDoc._id, kind, unifiedStageKey: ghl.unifiedStageKey, pipelineId: ghl.pipelineId, source: "ghl" };
    ["super_admin", "admin", "team_lead"].forEach((role) => realtimeGateway.emitToRole(role, "ghl:pipeline:updated", payload));
    if (caseDoc.assignedCaseManager) realtimeGateway.emitToUser(caseDoc.assignedCaseManager, "ghl:pipeline:updated", payload);
  } catch (error) {
    logger.warn("ghl_realtime_emit_failed", { error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 3. Worker loop (multi-instance safe: claims are atomic)
// ---------------------------------------------------------------------------

async function processDueEvents(limit = 25) {
  let handled = 0;
  while (handled < limit) {
    const event = await claimNextEvent();
    if (!event) break;
    await processEvent(event);
    handled += 1;
  }
  return handled;
}

// Fire-and-forget fast path right after receipt, so a live event is applied in
// milliseconds instead of waiting for the next worker tick.
function processEventSoon(eventId) {
  setImmediate(async () => {
    try {
      const event = await claimNextEvent(eventId);
      if (event) await processEvent(event);
    } catch (error) {
      logger.error("ghl_webhook_fast_path_failed", { error: error.message });
    }
  });
}

module.exports = { receiveWebhook, processEvent, processDueEvents, processEventSoon, claimNextEvent, handleEvent, HANDLED_EVENTS };
