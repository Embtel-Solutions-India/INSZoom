// The "Immiglance Pipeline" in GoHighLevel: a SEPARATE pipeline that holds only the leads from the Leads page. It is not one of the two case
// pipelines (immigrant / non-immigrant): it has no stages to sync, never creates a case, never appears on the Pipeline page, and is not in
// GHLIntegration.pipelines, so the board, the sync and the reconcile passes never see it.
//
//   - A new lead (quiz, consultation request, Immiglance form, intake) becomes ONE card in the FIRST stage of that pipeline: the contact
//     (name, e-mail, phone), the opportunity (name = person - visa - lead number) and a note holding everything else the lead carries.
//   - Deleting the lead here deletes the card there (lead-delete.service.js); deleting the card in GoHighLevel deletes the lead here
//     (handleOpportunityEvent, called from the webhook service).
//   - Nothing else is mirrored: later changes to the lead, or moving the card between stages, are not synced.
//
// Off unless GHL is enabled and GHL_IMMIGLANCE_PIPELINE_ID is set; GHL_LEAD_PIPELINE_SYNC=false switches it off. Every public function here is
// fail-safe: it never throws into the request that created the lead. The GHL calls go through the service objects (not destructured) so tests can stub them.
const env = require("../../config/env");
const logger = require("../../utils/logger");
const { getClient, GHLApiError } = require("./ghlClient");
const pipelineService = require("./ghlPipelineService");
const opportunityService = require("./ghlOpportunityService");

const MAX_ATTEMPTS = 8;
const STALE_CLAIM_MS = 3 * 60 * 1000;
const STAGE_CACHE_MS = 6 * 60 * 60 * 1000;
const NOTE_LIMIT = 6000;
const SYNC_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const underTestRunner = () => process.env.NODE_ENV === "test" || Boolean(process.env.NODE_TEST_CONTEXT);
const clean = (value) => String(value == null ? "" : value).trim();

// Is the lead pipeline configured (the id is set and GHL is on)? Used by the webhook guard as well.
function isConfigured() {
  return Boolean(env.ghl.enabled && env.ghl.token && env.ghl.locationId && env.ghl.leadPipelineId) && String(process.env.GHL_LEAD_PIPELINE_SYNC || "").toLowerCase() !== "false";
}

class PermanentError extends Error {}

// ---------------------------------------------------------------------------
// What goes on the card
// ---------------------------------------------------------------------------

// Pure. The contact columns GHL has for a person.
function contactFields(lead) {
  return { email: clean(lead.email).toLowerCase(), name: clean(lead.fullName), phone: clean(lead.phone) };
}

// Pure. The opportunity's name: "Name - Visa (L-001)".
function opportunityName(lead) {
  const who = clean(lead.fullName) || clean(lead.email) || clean(lead.phone) || "New lead";
  const visa = clean(lead.visaPathway) || clean(lead.visaInterest);
  const number = clean(lead.leadNumber);
  return `${who}${visa ? ` - ${visa}` : ""}${number ? ` (${number})` : ""}`;
}

// Flatten an answers object into "path: value" lines (primitives and short lists only), capped.
function answerLines(value, prefix = "", out = [], depth = 0) {
  if (out.length >= 80 || value == null) return out;
  if (Array.isArray(value)) {
    if (value.every((item) => item == null || typeof item !== "object")) {
      const text = value.filter((item) => item !== "" && item != null).join(", ");
      if (text) out.push(`${prefix}: ${text}`);
    } else {
      value.forEach((item, index) => answerLines(item, `${prefix}[${index + 1}]`, out, depth + 1));
    }
  } else if (typeof value === "object") {
    if (depth > 4) return out;
    Object.entries(value).forEach(([key, inner]) => answerLines(inner, prefix ? `${prefix}.${key}` : key, out, depth + 1));
  } else if (clean(value) !== "") {
    out.push(`${prefix}: ${clean(value)}`);
  }
  return out;
}

const fmtDate = (value) => (value ? new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "");

// Pure. Everything the lead carries that has no column of its own on the contact / opportunity, as one note.
function composeNote(lead) {
  const lines = [];
  const add = (label, value) => { const text = clean(value); if (text) lines.push(`${label}: ${text}`); };
  lines.push(`Immiglance lead ${clean(lead.leadNumber) || ""}`.trim());
  add("Source", lead.source);
  add("Status", lead.status);
  add("Visa pathway", lead.visaPathway);
  if (clean(lead.visaInterest) && clean(lead.visaInterest) !== clean(lead.visaPathway)) add("Visa interest", lead.visaInterest);
  add("Extension interest", lead.extensionInterest);
  add("Message", lead.message);
  if (lead.scoreResult) {
    add("Quiz tier", lead.scoreResult.tier);
    add("Quiz routing", lead.scoreResult.routing);
    add("Quiz score", lead.scoreResult.score ?? lead.scoreResult.totalScore);
  }
  const consultation = lead.consultation || {};
  add("Consultation requested", fmtDate(consultation.requestedAt));
  add("Consultation scheduled", fmtDate(consultation.scheduledAt));
  add("Consultation notes", consultation.notes && consultation.notes !== lead.message ? consultation.notes : "");
  const utm = lead.utm || {};
  const utmText = ["source", "medium", "campaign", "term", "content"].map((key) => (clean(utm[key]) ? `${key}=${clean(utm[key])}` : "")).filter(Boolean).join(", ");
  add("UTM", utmText);
  add("Created", fmtDate(lead.createdAt));

  const answers = answerLines(lead.profileAnswers || {});
  const criteria = Array.isArray(lead.criteriaAnswers) ? lead.criteriaAnswers.flatMap((item, index) => answerLines(item, `criteria ${index + 1}`)) : [];
  if (answers.length) lines.push("", "Answers:", ...answers);
  if (criteria.length) lines.push("", "Criteria answers:", ...criteria);
  const note = lines.join("\n");
  return note.length > NOTE_LIMIT ? `${note.slice(0, NOTE_LIMIT - 20)}\n... (shortened)` : note;
}

// ---------------------------------------------------------------------------
// The pipeline's first stage
// ---------------------------------------------------------------------------

let stageCache = null; // { pipelineId, stageId, name, at }

// Pure. The first stage (lowest position) of a pipeline, or null.
function firstStageOf(pipeline) {
  const stages = [...(pipeline?.stages || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return stages[0] ? { stageId: stages[0].id, name: stages[0].name } : null;
}

async function resolveFirstStage(client) {
  const pipelineId = env.ghl.leadPipelineId;
  if (stageCache && stageCache.pipelineId === pipelineId && Date.now() - stageCache.at < STAGE_CACHE_MS) return stageCache;
  const pipelines = await pipelineService.listPipelines(env.ghl.locationId, client);
  const pipeline = pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) throw new PermanentError(`The Immiglance pipeline "${pipelineId}" was not found in GoHighLevel`);
  const first = firstStageOf(pipeline);
  if (!first) throw new PermanentError("The Immiglance pipeline has no stages in GoHighLevel");
  stageCache = { pipelineId, ...first, at: Date.now() };
  return stageCache;
}

// ---------------------------------------------------------------------------
// Sending a lead
// ---------------------------------------------------------------------------

async function upsertContact(client, locationId, fields) {
  if (!fields.email && !fields.phone) throw new PermanentError("The lead has no e-mail or phone, so no GoHighLevel contact can be made for it");
  const data = await client.post("/contacts/upsert", { locationId, ...(fields.email ? { email: fields.email } : {}), ...(fields.name ? { name: fields.name } : {}), ...(fields.phone ? { phone: fields.phone } : {}) });
  const id = data?.contact?.id || data?.id;
  if (!id) throw new Error("GoHighLevel did not return the contact");
  return id;
}

async function addNote(client, contactId, body) {
  await client.post(`/contacts/${contactId}/notes`, { body });
}

// Claim the lead for one sender at a time (several instances, the hook and the sweep could all reach it). Returns the lead, or null when not ours to send.
async function claim(Lead, leadId) {
  const stale = new Date(Date.now() - STALE_CLAIM_MS);
  return Lead.findOneAndUpdate(
    {
      _id: leadId,
      isDraft: { $ne: true },
      $and: [
        { $or: [{ "ghl.opportunityId": { $exists: false } }, { "ghl.opportunityId": "" }, { "ghl.opportunityId": null }, { "ghl.noteSent": { $ne: true } }] },
        { $or: [{ "ghl.status": { $in: ["pending", "failed"] } }, { "ghl.status": "syncing", "ghl.claimedAt": { $lt: stale } }] },
      ],
    },
    { $set: { "ghl.status": "syncing", "ghl.claimedAt": new Date() }, $inc: { "ghl.attempts": 1 } },
    { new: true }
  );
}

// Send one lead: contact, card in the first stage, note. Resumes from where an earlier try stopped (ids are saved as soon as GHL returns them),
// so a retry never makes a second contact, card or note.
async function pushLead(leadId, deps = {}) {
  if (!isConfigured()) return { skipped: "not_configured" };
  const Lead = deps.Lead || require("../../models/Lead");
  const client = deps.client || getClient();
  const lead = await claim(Lead, leadId);
  if (!lead) return { skipped: "not_claimable" };
  try {
    const locationId = env.ghl.locationId;
    const stage = await resolveFirstStage(client);
    let contactId = lead.ghl?.contactId;
    if (!contactId) {
      contactId = await upsertContact(client, locationId, contactFields(lead));
      await Lead.updateOne({ _id: lead._id }, { $set: { "ghl.contactId": contactId } });
    }
    let opportunityId = lead.ghl?.opportunityId;
    if (!opportunityId) {
      const created = await opportunityService.createOpportunity({
        pipelineId: stage.pipelineId,
        locationId,
        name: opportunityName(lead),
        pipelineStageId: stage.stageId,
        status: "open",
        contactId,
        source: "Immiglance",
      }, client);
      opportunityId = created?.id;
      if (!opportunityId) throw new Error("GoHighLevel did not return the card");
      await Lead.updateOne({ _id: lead._id }, { $set: { "ghl.opportunityId": opportunityId, "ghl.pipelineId": stage.pipelineId, "ghl.stageId": stage.stageId } });
    }
    if (!lead.ghl?.noteSent) {
      await addNote(client, contactId, composeNote(lead));
      await Lead.updateOne({ _id: lead._id }, { $set: { "ghl.noteSent": true } });
    }
    await Lead.updateOne({ _id: lead._id }, { $set: { "ghl.status": "synced", "ghl.syncedAt": new Date(), "ghl.error": "" } });
    return { synced: true, opportunityId };
  } catch (error) {
    const permanent = error instanceof PermanentError || (error instanceof GHLApiError && error.retryable === false);
    // permanent problems stop retrying ("skipped": nothing a retry can fix); the message says what to change
    await Lead.updateOne({ _id: lead._id }, { $set: { "ghl.status": permanent ? "skipped" : "failed", "ghl.error": clean(error.message).slice(0, 500) } }).catch(() => null);
    logger.warn("ghl_lead_push_failed", { leadId: String(lead._id), permanent, error: error.message });
    return { failed: true, permanent, error: error.message };
  }
}

// A lead was just created (or a quiz draft just became a lead). Marks it for sending and sends it in the background. Never throws, never waits.
function leadCreated(lead) {
  try {
    if (!lead?._id || lead.isDraft || underTestRunner() || !isConfigured()) return;
    setImmediate(async () => {
      try {
        const Lead = require("../../models/Lead");
        await Lead.updateOne({ _id: lead._id, "ghl.status": { $exists: false } }, { $set: { "ghl.status": "pending", "ghl.attempts": 0 } });
        await pushLead(lead._id);
      } catch (error) {
        logger.warn("ghl_lead_hook_failed", { leadId: String(lead._id), error: error.message });
      }
    });
  } catch (_error) {
    /* never affects the request */
  }
}

// The periodic safety net: leads that were marked for sending but did not make it (GHL down, process stopped). Only leads this feature has marked,
// so older leads are never sent.
async function sweep(deps = {}) {
  if (!isConfigured()) return { skipped: "not_configured" };
  const Lead = deps.Lead || require("../../models/Lead");
  const stale = new Date(Date.now() - STALE_CLAIM_MS);
  const rows = await Lead.find({
    isDraft: { $ne: true },
    createdAt: { $gte: new Date(Date.now() - SYNC_LOOKBACK_MS) },
    "ghl.attempts": { $lt: MAX_ATTEMPTS },
    $or: [{ "ghl.status": { $in: ["pending", "failed"] } }, { "ghl.status": "syncing", "ghl.claimedAt": { $lt: stale } }],
  }).select("_id").limit(25).lean();
  let synced = 0;
  for (const row of rows) {
    const result = await pushLead(row._id, deps);
    if (result.synced) synced += 1;
  }
  return { checked: rows.length, synced };
}

// ---------------------------------------------------------------------------
// Reconcile + health (same safeguards as the case pipelines: ghlDeletedInGhl.js, ghlReconcileService.js)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CONFIRM_MS = () => Math.max(Number(process.env.GHL_DELETE_CONFIRM_MS || 2 * 60 * 1000), 0);

// Catches a card deleted in GoHighLevel whose webhook was missed. A few synced leads per pass (the oldest-checked first): a card found gone is only
// FLAGGED the first time; once it is still gone after GHL_DELETE_CONFIRM_MS (default 2 minutes) and GHL_DELETE_CASES_REMOVED_IN_GHL=true (the same switch
// as cases) the lead is deleted. Any other GoHighLevel error just skips the lead for now. Never deletes on doubt.
async function reconcileDeleted(deps = {}) {
  if (!isConfigured()) return { skipped: "not_configured" };
  const Lead = deps.Lead || require("../../models/Lead");
  const opportunities = deps.opportunities || opportunityService;
  const remove = deps.removeLead || require("../../modules/leads/lead-delete.service").removeLeadLocally;
  const autoDelete = String(process.env.GHL_DELETE_CASES_REMOVED_IN_GHL || "").toLowerCase() === "true";
  const rows = await Lead.find({ "ghl.status": "synced", "ghl.opportunityId": { $exists: true, $ne: "" } })
    .sort({ "ghl.checkedAt": 1 }).limit(deps.limit || 20).select("_id ghl").lean();
  let flagged = 0;
  let deleted = 0;
  for (const row of rows) {
    try {
      await opportunities.getOpportunity(row.ghl.opportunityId);
      await Lead.updateOne({ _id: row._id }, { $set: { "ghl.checkedAt": new Date() }, $unset: { "ghl.missingSince": "" } });
    } catch (error) {
      if (!(error instanceof GHLApiError && error.status === 404)) continue; // could not tell: leave it
      const since = row.ghl.missingSince ? new Date(row.ghl.missingSince).getTime() : 0;
      if (!since) {
        await Lead.updateOne({ _id: row._id }, { $set: { "ghl.missingSince": new Date(), "ghl.checkedAt": new Date() } });
        flagged += 1;
      } else if (autoDelete && Date.now() - since >= CONFIRM_MS()) {
        await remove(row._id);
        deleted += 1;
      }
    }
    if (!deps.noPause) await sleep(250);
  }
  return { checked: rows.length, flagged, deleted };
}

// Opening the Leads page also runs the deleted-card check in the background (at most once a minute, a few leads at a time), so a card deleted in
// GoHighLevel disappears from the page within a few minutes even where the GoHighLevel webhook does not reach this server (it still needs two sightings
// GHL_DELETE_CONFIRM_MS apart). Fire-and-forget: never delays or fails the page.
let lastPageReconcileAt = 0;
function reconcileSoon() {
  try {
    if (!isConfigured() || underTestRunner() || Date.now() - lastPageReconcileAt < 60 * 1000) return;
    lastPageReconcileAt = Date.now();
    setImmediate(() => reconcileDeleted({ limit: 10 }).catch((error) => logger.warn("ghl_lead_page_reconcile_failed", { error: error.message })));
  } catch (_error) {
    /* never affects the page */
  }
}

// For GET /integrations/ghl/status: is the Immiglance pipeline set up, and how many leads are in each sending state. No GoHighLevel call.
async function summary(deps = {}) {
  const configured = isConfigured();
  const base = { configured, pipelineIdSet: Boolean(env.ghl.leadPipelineId), pipelineId: env.ghl.leadPipelineId ? `...${env.ghl.leadPipelineId.slice(-4)}` : null };
  if (!configured) return base;
  const Lead = deps.Lead || require("../../models/Lead");
  const rows = await Lead.aggregate([{ $match: { "ghl.status": { $exists: true } } }, { $group: { _id: "$ghl.status", count: { $sum: 1 } } }]);
  return { ...base, leads: Object.fromEntries(rows.map((row) => [row._id, row.count])), firstStage: stageCache?.name || null };
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

// The card for this lead is deleted in GoHighLevel (a 404 counts as deleted). Throws when GoHighLevel could not be reached.
async function deleteCardFor(lead) {
  const id = clean(lead?.ghl?.opportunityId);
  if (!id || !isConfigured()) return { skipped: true };
  await opportunityService.deleteOpportunity(id);
  return { deleted: true };
}

// GoHighLevel webhook, called first for every opportunity event. Returns a webhook outcome when the event belongs to the lead pipeline (so the
// case logic never sees it), or null for everything else. A card deleted in GoHighLevel deletes its lead here - after the card is confirmed gone.
async function handleOpportunityEvent(event, opportunity, deps = {}) {
  if (!isConfigured() || !opportunity?.id) return null;
  const Lead = deps.Lead || require("../../models/Lead");
  let lead;
  try {
    lead = await Lead.findOne({ "ghl.opportunityId": opportunity.id }).select("_id ghl").lean();
  } catch (error) {
    logger.warn("ghl_lead_pipeline_lookup_failed", { error: error.message });
    return null; // fail-safe: the case webhook logic carries on exactly as before
  }
  const inLeadPipeline = Boolean(lead) || clean(opportunity.pipelineId) === env.ghl.leadPipelineId;
  if (!inLeadPipeline) return null;
  if (event.eventType !== "OpportunityDelete") return { outcome: "ignored", note: "Immiglance pipeline card: managed on the Leads page" };
  if (!lead) return { outcome: "ignored", note: "deleted Immiglance pipeline card has no lead" };
  try {
    await (deps.opportunities || opportunityService).getOpportunity(opportunity.id);
    return { outcome: "ignored", note: "Immiglance pipeline card still exists in GoHighLevel" };
  } catch (error) {
    if (!(error instanceof GHLApiError && error.status === 404)) return { outcome: "failed", note: `could not confirm the deletion: ${error.message}` };
  }
  await (deps.removeLead || require("../../modules/leads/lead-delete.service").removeLeadLocally)(lead._id);
  return { outcome: "processed", note: "card deleted in GoHighLevel: lead deleted" };
}

module.exports = {
  isConfigured, contactFields, opportunityName, composeNote, firstStageOf, answerLines,
  pushLead, leadCreated, sweep, reconcileDeleted, reconcileSoon, summary, deleteCardFor, handleOpportunityEvent, MAX_ATTEMPTS,
  _resetStageCache: () => { stageCache = null; },
};
