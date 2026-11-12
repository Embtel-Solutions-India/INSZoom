// A case restored from the Recycle Bin gets its GoHighLevel card BACK - the same case, not a new one.
//
//   Deleting a case here (or a card in GHL, which deletes its case here) moves the case to the Recycle Bin and removes its GHL card. The bin keeps the whole case record,
//   including where its card was: integrations.ghl.{pipelineId, pipelineStageId, unifiedStageKey, displayName, contactId, role}. Restoring the case from the bin queues ONE durable
//   "restore_opportunity" job (retried like every other GHL job) which:
//     1. if the old card is somehow still in GHL (the delete had not run yet): keeps it, cancels the pending delete and re-links it;
//     2. otherwise creates a NEW card in the SAME pipeline and SAME stage, with the same name, contact, service type and money, and re-links it to the SAME case
//        (replacing the old, dead link). The case's data, number, history, checklists and documents are untouched: nothing is created as a new case.
//   While the new card is being created it carries the case's marker, so neither a retry nor the 30-second sync can ever import it as a second case (see adoptRestoredOpportunity).
//   Never throws into the restore itself: the restore of the case is complete before this runs.
const logger = require("../../utils/logger");
const env = require("../../config/env");
const Case = require("../../models/Case");
const GHLIntegration = require("../../models/GHLIntegration");
const GHLEmployerLink = require("../../models/GHLEmployerLink");
const GHLCaseLink = require("../../models/GHLCaseLink");
const GHLSyncJob = require("../../models/GHLSyncJob");
const opportunityService = require("./ghlOpportunityService");
const visaService = require("./ghlVisaService");
const aux = require("./ghlAuxOutbound");
const { ensureFieldIds, MARKER_FIELD } = require("./ghlCustomFieldService");
const { GHLApiError } = require("./ghlClient");

const transient = (message) => new GHLApiError(message, { status: 0, retryable: true });
const permanent = (message) => new GHLApiError(message, { status: 0, retryable: false });
const outbound = () => require("./ghlCaseOutbound");

/** Pure: the stage mapping a restored card goes back to - the stored stage key, else the stored GHL stage id, else the pipeline's first stage. */
function pickMapping(config, pipeline, ghl) {
  const mappings = (config.stageMappings || []).filter((m) => m.ghlPipelineId === pipeline.ghlPipelineId);
  const byKey = ghl.unifiedStageKey && mappings.find((m) => m.unifiedStageKey === ghl.unifiedStageKey);
  if (byKey) return byKey;
  const byId = ghl.pipelineStageId && mappings.find((m) => m.ghlStageId === ghl.pipelineStageId);
  if (byId) return byId;
  const first = [...(pipeline.stages || [])].sort((a, b) => a.order - b.order)[0];
  return first ? mappings.find((m) => m.unifiedStageKey === first.key) || null : null;
}

/** Pure: the pipeline the card was on (by id), else the case's category pipeline. */
function pickPipeline(config, ghl, fallbackCategory) {
  const enabled = (config.pipelines || []).filter((p) => p.enabled && p.stages?.length);
  return enabled.find((p) => p.ghlPipelineId === ghl.pipelineId) || enabled.find((p) => p.category === (ghl.category || fallbackCategory)) || null;
}

// The contact a card hangs on. An employee's card hangs on the EMPLOYER's contact; anyone else's on their own (the petitioner for a family case).
async function resolveContactId(caseDoc, client, locationId, { forceFresh = false } = {}) {
  const ghl = caseDoc.integrations?.ghl || {};
  if (caseDoc.caseRole === "employee" && caseDoc.parentCase) {
    const link = await GHLEmployerLink.findOne({ principalCaseId: caseDoc.parentCase }).lean();
    if (link?.contactId && !forceFresh) return link.contactId;
    return healEmployerContact(caseDoc.parentCase, client, locationId);
  }
  if (ghl.contactId && !forceFresh) return ghl.contactId;
  const out = outbound();
  return out.upsertContact(client, locationId, await out.contactDetails(caseDoc));
}

/**
 * The employer's GHL contact is missing (deleted in GHL): create it again from the employer's own details (GHL's upsert returns the existing contact when there is one)
 * and point the employer link at it, so every employee card of that employer works again. Waits (retries) while the employer has no e-mail yet.
 */
async function healEmployerContact(principalCaseId, client, locationId = env.ghl.locationId) {
  const principal = await Case.findById(principalCaseId);
  if (!principal) throw permanent("The employer matter no longer exists");
  const out = outbound();
  const details = await out.contactDetails(principal);
  if (!details.email) throw transient("The employer has no e-mail yet, so the GHL contact cannot be created; it will be retried");
  const contactId = await out.upsertContact(client, locationId, details);
  await GHLEmployerLink.updateOne({ principalCaseId }, { $set: { contactId } }).catch(() => null);
  logger.info("ghl_employer_contact_recreated", { principalCaseId: String(principalCaseId), contactId });
  return contactId;
}

// Replaces the case's dead card with the new one: the case keeps its identity, only the GHL pointers change. Guarded by the OLD id so a concurrent change is never overwritten.
async function relinkRestored({ caseDoc, opportunity, pipeline, mapping, contactId, locationId }) {
  const now = new Date();
  const oldId = caseDoc.integrations?.ghl?.opportunityId || null;
  const set = {
    "integrations.ghl.locationId": locationId,
    "integrations.ghl.opportunityId": opportunity.id,
    "integrations.ghl.contactId": contactId,
    "integrations.ghl.pipelineId": pipeline.ghlPipelineId,
    "integrations.ghl.pipelineStageId": opportunity.pipelineStageId || mapping?.ghlStageId,
    "integrations.ghl.sourcePipelineId": pipeline.ghlPipelineId,
    "integrations.ghl.sourceStageId": opportunity.pipelineStageId || mapping?.ghlStageId,
    "integrations.ghl.unifiedStageKey": mapping?.unifiedStageKey,
    "integrations.ghl.category": pipeline.category,
    "integrations.ghl.opportunityStatus": opportunity.status || "open",
    "integrations.ghl.displayName": opportunity.name,
    "integrations.ghl.lastSyncedAt": now,
    "integrations.ghl.sync.state": "synced",
    "integrations.ghl.sync.source": "immiglance",
    "integrations.ghl.sync.changedAt": now,
    "integrations.ghl.sync.lastSyncedStageId": opportunity.pipelineStageId || mapping?.ghlStageId,
    "integrations.ghl.sync.attempts": 0,
    "integrations.ghl.sync.lastError": null,
    "integrations.ghl.flags.deletedInGhl": false,
    "integrations.ghl.flags.needsAttention": false,
    "integrations.ghl.restoredAt": now,
  };
  const result = await Case.updateOne({ _id: caseDoc._id, "integrations.ghl.opportunityId": { $in: [null, oldId, opportunity.id] } }, { $set: set, $unset: { "integrations.ghl.flags.deletedInGhlAt": "" }, $inc: { "integrations.ghl.sync.version": 1 } });
  if (!result.matchedCount) return false;
  // the dead link goes, the new one comes: exactly one link per case
  if (oldId && oldId !== opportunity.id) await GHLCaseLink.deleteMany({ locationId, opportunityId: oldId, caseId: caseDoc._id }).catch(() => null);
  await GHLCaseLink.create({ locationId, opportunityId: opportunity.id, caseId: caseDoc._id, contactId }).catch((error) => { if (error?.code !== 11000) throw error; });
  try {
    const fresh = await Case.findById(caseDoc._id);
    if (fresh) {
      require("../../modules/cases/case.service").addTimelineEvent(fresh, "case", "Restored to the pipeline", `The case was restored from the recycle bin: its card is back in the ${pipeline.ghlPipelineName}, in the same stage`, null, { source: "recycle_bin_restore", ghlOpportunityId: opportunity.id, previousOpportunityId: oldId });
      await fresh.save();
    }
  } catch (error) {
    logger.warn("ghl_restore_timeline_failed", { caseId: String(caseDoc._id), error: error.message });
  }
  try {
    const gateway = require("../../modules/realtime/realtime.gateway");
    ["super_admin", "admin", "team_lead", "case_manager"].forEach((role) => gateway.emitToRole(role, "ghl:pipeline:updated", { kind: "restore", caseId: String(caseDoc._id), source: "immiglance" }));
  } catch (_error) { /* live refresh only */ }
  return true;
}

async function runRestoreOpportunity(job, client) {
  const caseDoc = await Case.findById(job.caseId);
  if (!caseDoc || caseDoc.status === "removed") return "skipped";
  const ghl = caseDoc.integrations?.ghl || {};
  if (!ghl.opportunityId) return "skipped"; // the case never had a card (or it was already restored)
  const locationId = ghl.locationId || env.ghl.locationId;

  // 1. the old card is still there (its delete had not run): keep it
  let existing = null;
  try {
    existing = await opportunityService.getOpportunity(ghl.opportunityId, client);
  } catch (error) {
    if (!(error instanceof GHLApiError && error.status === 404)) throw error; // anything but "gone" is not proof: retry
  }
  if (existing?.id) {
    await GHLSyncJob.updateMany({ type: "delete_opportunity", opportunityId: ghl.opportunityId, status: { $in: ["pending", "processing", "failed"] } }, { $set: { status: "superseded", completedAt: new Date(), lastError: "the case was restored: its card is kept" } });
    await GHLCaseLink.create({ locationId, opportunityId: existing.id, caseId: caseDoc._id, contactId: existing.contactId || ghl.contactId }).catch((error) => { if (error?.code !== 11000) throw error; });
    await Case.updateOne({ _id: caseDoc._id }, { $set: { "integrations.ghl.flags.deletedInGhl": false, "integrations.ghl.flags.needsAttention": false, "integrations.ghl.restoredAt": new Date() }, $unset: { "integrations.ghl.flags.deletedInGhlAt": "" } });
    return "done";
  }

  // 2. recreate it in the same pipeline and stage
  const config = await GHLIntegration.findOne({ locationId });
  if (!config?.mappingsConfirmedAt) throw transient("GHL stage mapping is not confirmed yet");
  const pipeline = pickPipeline(config, ghl, caseDoc.pipelineCategory);
  if (!pipeline) throw permanent("The GHL pipeline this card was on is not configured any more");
  const mapping = pickMapping(config, pipeline, ghl);
  if (!mapping) throw permanent("No GHL stage is mapped for this pipeline");

  const entries = await visaService.ensureEntries(config);
  const fieldIds = await ensureFieldIds(config, { client });
  const marker = aux.markerFor(caseDoc);
  const customFields = [];
  const svc = aux.serviceTypeFor(caseDoc.visaType, caseDoc.petitionSubType, entries);
  if (svc.serviceType && fieldIds?.service_type) customFields.push({ id: fieldIds.service_type, field_value: svc.serviceType });
  if (svc.detailField && fieldIds?.[svc.detailField]) customFields.push({ id: fieldIds[svc.detailField], field_value: svc.detailValue });
  const markerFieldId = fieldIds?.[MARKER_FIELD.name];
  if (markerFieldId) customFields.push({ id: markerFieldId, field_value: marker });

  let contactId = await resolveContactId(caseDoc, client, locationId);
  // a retry may follow a create that succeeded but whose answer was lost: look for our marker first
  let opportunity = null;
  if (job.attempts > 1) {
    const mine = await opportunityService.fetchAllOpportunities(pipeline.ghlPipelineId, { locationId, client });
    opportunity = mine.find((o) => aux.markerFromOpportunity(o, fieldIds) === marker && o.id !== ghl.opportunityId) || null;
  }
  const body = () => ({
    pipelineId: pipeline.ghlPipelineId,
    locationId,
    name: ghl.displayName || caseDoc.clientName || caseDoc.caseNumber,
    pipelineStageId: mapping.ghlStageId,
    status: "open",
    contactId,
    ...(caseDoc.finance?.totalAmount ? { monetaryValue: Number(caseDoc.finance.totalAmount) || 0 } : {}),
    ...(markerFieldId ? {} : { source: marker }),
    ...(customFields.length ? { customFields } : {}),
  });
  if (!opportunity) {
    try {
      opportunity = await opportunityService.createOpportunity(body(), client);
    } catch (error) {
      // the contact is gone in GHL: create it again and try once more
      if (error instanceof GHLApiError && error.status === 404) {
        contactId = await resolveContactId(caseDoc, client, locationId, { forceFresh: true });
        opportunity = await opportunityService.createOpportunity(body(), client);
      } else {
        throw error;
      }
    }
  }
  if (!opportunity?.id) throw transient("GHL did not return the new opportunity");
  const linked = await relinkRestored({ caseDoc, opportunity, pipeline, mapping, contactId, locationId });
  if (!linked) throw transient("The case changed while its card was being restored; it will be checked again");
  // the money (USCIS fee, amount paid, invoice) goes back onto the card
  if (caseDoc.finance && (caseDoc.finance.uscisFee || caseDoc.finance.amountPaid || caseDoc.finance.invoiceNo)) {
    await Case.updateOne({ _id: caseDoc._id }, { $set: { "finance.pendingPush": true } }).catch(() => null);
    const finance = await aux.queueJob(caseDoc._id, "push_finance").catch(() => null);
    if (finance) require("./ghlOutboundService").processJobSoon(finance._id);
  }
  return "done";
}

/**
 * Called after a recycle-bin restore: queues the card restoration for every restored case that had a card. Fire and forget, never throws.
 */
async function enqueueRestoreForCases(caseIds = []) {
  let queued = 0;
  try {
    if (!outbound().isEnabled()) return 0;
    const cases = await Case.find({ _id: { $in: caseIds }, "integrations.ghl.opportunityId": { $exists: true, $ne: null } }).select("_id").lean();
    for (const { _id } of cases) {
      const job = await aux.queueJob(_id, "restore_opportunity");
      if (job) { queued += 1; require("./ghlOutboundService").processJobSoon(job._id); }
    }
  } catch (error) {
    logger.error("ghl_restore_enqueue_failed", { error: error.message });
  }
  return queued;
}

/**
 * The 30-second sync (or a webhook) sees a card that carries a case's marker while that case is being restored: link it to the case instead of importing a second case.
 * Returns true when it handled the opportunity.
 */
async function adoptRestoredOpportunity({ opportunity, pipeline, mapping, locationId, caseDoc }) {
  const ghl = caseDoc?.integrations?.ghl || {};
  if (!caseDoc || !ghl.opportunityId || ghl.opportunityId === opportunity.id) return false;
  const pending = await GHLSyncJob.exists({ caseId: caseDoc._id, type: "restore_opportunity", status: { $in: ["pending", "processing"] } });
  if (!pending) return false;
  return relinkRestored({ caseDoc, opportunity, pipeline, mapping, contactId: opportunity.contactId, locationId });
}

module.exports = { runRestoreOpportunity, enqueueRestoreForCases, adoptRestoredOpportunity, relinkRestored, healEmployerContact, pickMapping, pickPipeline };
