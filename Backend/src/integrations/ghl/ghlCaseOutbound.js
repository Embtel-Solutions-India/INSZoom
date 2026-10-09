const logger = require("../../utils/logger");
const env = require("../../config/env");
const Case = require("../../models/Case");
const User = require("../../models/User");
const GHLIntegration = require("../../models/GHLIntegration");
const GHLEmployerLink = require("../../models/GHLEmployerLink");
const opportunityService = require("./ghlOpportunityService"); // by object, so tests can substitute the GHL calls
const visaService = require("./ghlVisaService");
const aux = require("./ghlAuxOutbound");
const { ensureFieldIds, MARKER_FIELD } = require("./ghlCustomFieldService");
const { GHLApiError } = require("./ghlClient");

// Cases created in the CRM (New case button, leads, family workflow) become GoHighLevel cards too, so every case is on the
// Pipeline and can be staged from it, exactly like a case that arrived from GHL. This file only ADDS the GHL link
// (contact + opportunity + the card's pipeline position); it never touches a case's structure, visa, forms, checklists,
// assignment or any other workflow data. The same employer / employee / family / single rules apply to every case:
//
//   single / family case   -> one GHL opportunity on the client's (or petitioner's) contact
//   employer matter        -> the employer's GHL contact + employer link (its employees then get opportunities through the
//                             existing employee sync in ghlAuxOutbound.js, which needs that link)
//   employee card          -> unchanged: ghlAuxOutbound.js
//
// Cases that existed before this was switched on are never created in GHL in bulk (see syncSince); one is linked the first time
// someone stages it (ensureLinked).

const clean = (value) => (typeof value === "string" ? value.trim() : "");
const permanent = (message) => new GHLApiError(message, { status: 0, retryable: false });
const transient = (message) => new GHLApiError(message, { status: 0, retryable: true });

const isEnabled = () => env.ghl.enabled && Boolean(env.ghl.token) && Boolean(env.ghl.locationId) && process.env.GHL_SYNC_CRM_CASES !== "false";

const isEmployerMatter = (c) => c.caseStructure === "employer_employee" && c.caseRole === "principal";
const hasCard = (c) => Boolean(c.integrations?.ghl?.opportunityId);

/** Which kind of GHL record does this case need? "card" | "employer" | null. Pure. */
function plan(caseDoc) {
  if (!caseDoc || caseDoc.status === "removed" || caseDoc.status === "archived") return null;
  if (caseDoc.visaSelectionStatus === "pending" || !clean(caseDoc.visaType)) return null; // no visa yet: nothing visa-driven exists
  if (caseDoc.caseRole === "employee") return null; // ghlAuxOutbound.js
  if (isEmployerMatter(caseDoc)) return "employer";
  if (hasCard(caseDoc)) return null;
  return "card";
}

// The person GHL should hold as the contact: the petitioner for a family case, the employer for an employer matter,
// else the client.
async function contactDetails(caseDoc) {
  if (caseDoc.petitionerUser) {
    const petitioner = await User.findById(caseDoc.petitionerUser).select("email name displayName phone").lean();
    if (petitioner?.email) return { email: petitioner.email, name: clean(caseDoc.petitionerName) || petitioner.displayName || petitioner.name, phone: petitioner.phone };
  }
  return { email: clean(caseDoc.clientEmail).toLowerCase(), name: clean(caseDoc.petitionerName) || clean(caseDoc.clientName), phone: clean(caseDoc.clientPhone) };
}

async function upsertContact(client, locationId, { email, name, phone }) {
  if (!email) throw permanent("The case has no email, so no GHL contact can be created for it");
  const data = await client.post("/contacts/upsert", { locationId, email, ...(name ? { name } : {}), ...(phone ? { phone } : {}) });
  const id = data?.contact?.id || data?.id;
  if (!id) throw transient("GHL did not return the contact");
  return id;
}

// ---------------------------------------------------------------------------
// Running the jobs (called from ghlAuxOutbound.runAuxJob)
// ---------------------------------------------------------------------------

async function runCreateCaseOpportunity(job, client) {
  const caseDoc = await Case.findById(job.caseId);
  if (plan(caseDoc) !== "card") return "skipped";
  const locationId = env.ghl.locationId;
  const config = await GHLIntegration.findOne({ locationId });
  if (!config?.mappingsConfirmedAt) throw transient("GHL stage mapping is not confirmed yet");

  const entries = await visaService.ensureEntries(config);
  // The pipeline chosen when the case was created (Immigrant / Non-Immigrant); otherwise what the visa mapping says.
  const category = caseDoc.pipelineCategory || aux.categoryForVisa(caseDoc.visaType, caseDoc.petitionSubType, entries);
  const pipeline = config.pipelines.find((p) => p.enabled && p.category === category && p.stages?.length);
  if (!pipeline) throw permanent(`No ${category} GHL pipeline is configured`);
  const first = [...pipeline.stages].sort((a, b) => a.order - b.order)[0];
  const mapping = config.stageMappings.find((m) => m.ghlPipelineId === pipeline.ghlPipelineId && m.unifiedStageKey === first.key);
  if (!mapping) throw permanent("The first stage of the GHL pipeline is not mapped");

  const contact = await contactDetails(caseDoc);
  const contactId = await upsertContact(client, locationId, contact);

  const fieldIds = await ensureFieldIds(config, { client });
  const marker = aux.markerFor(caseDoc);
  const customFields = [];
  const svc = aux.serviceTypeFor(caseDoc.visaType, caseDoc.petitionSubType, entries);
  if (svc.serviceType && fieldIds?.service_type) customFields.push({ id: fieldIds.service_type, field_value: svc.serviceType });
  if (svc.detailField && fieldIds?.[svc.detailField]) customFields.push({ id: fieldIds[svc.detailField], field_value: svc.detailValue });
  const markerFieldId = fieldIds?.[MARKER_FIELD.name];
  if (markerFieldId) customFields.push({ id: markerFieldId, field_value: marker });

  // A RETRY may follow a create that actually succeeded but whose answer we never saw: look for our marker first.
  let opportunity = null;
  if (job.attempts > 1) {
    const mine = await opportunityService.fetchAllOpportunities(pipeline.ghlPipelineId, { locationId, contactId, client });
    opportunity = mine.find((o) => aux.markerFromOpportunity(o, fieldIds) === marker) || null;
  }
  if (!opportunity) {
    opportunity = await opportunityService.createOpportunity(
      {
        pipelineId: pipeline.ghlPipelineId,
        locationId,
        name: contact.name || caseDoc.caseNumber,
        pipelineStageId: mapping.ghlStageId,
        status: "open",
        contactId,
        ...(markerFieldId ? {} : { source: marker }),
        ...(customFields.length ? { customFields } : {}),
      },
      client
    );
  }
  if (!opportunity?.id) throw transient("GHL did not return the new opportunity");
  await aux.linkCreatedOpportunity({ child: caseDoc, opportunity, pipeline, mapping, contactId, locationId, role: caseDoc.petitionerUser ? "family" : "individual" });
  return "done";
}

// An employer matter has no card of its own (its employees do). Giving it its GHL contact + link is what lets the existing
// employee sync create an opportunity for every employee added from now on.
async function runLinkEmployer(job, client) {
  const caseDoc = await Case.findById(job.caseId);
  if (plan(caseDoc) !== "employer") return "skipped";
  if (await GHLEmployerLink.exists({ principalCaseId: caseDoc._id })) return "skipped";
  const locationId = env.ghl.locationId;
  const contactId = await upsertContact(client, locationId, await contactDetails(caseDoc));
  await GHLEmployerLink.create({ locationId, contactId, principalCaseId: caseDoc._id }).catch((error) => {
    if (error?.code !== 11000) throw error; // the contact already belongs to another employer matter: leave it to a person
  });
  return "done";
}

// ---------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------

async function syncSince() {
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId });
  if (!config) return null;
  if (!config.crmCaseSyncSince) {
    config.crmCaseSyncSince = new Date(); // first time this runs: only cases created from now on are synced automatically
    await config.save();
  }
  return config.crmCaseSyncSince;
}

/** Queue what one case needs. Never throws. Returns the job type queued, or null. */
async function enqueueForCase(caseId, { since = null, force = false } = {}) {
  try {
    if (!isEnabled()) return null;
    const caseDoc = await Case.findById(caseId).select("status visaType visaSelectionStatus caseRole caseStructure createdAt integrations.ghl.opportunityId").lean();
    const kind = plan(caseDoc);
    if (!kind) return null;
    if (!force) {
      const cutoff = since || (await syncSince());
      if (!cutoff || new Date(caseDoc.createdAt) < new Date(cutoff)) return null;
    }
    const type = kind === "employer" ? "link_employer" : "create_case_opportunity";
    const job = await aux.queueJob(caseDoc._id, type);
    if (job) require("./ghlOutboundService").processJobSoon(job._id);
    return job ? type : null;
  } catch (error) {
    logger.warn("ghl_case_enqueue_failed", { caseId: String(caseId), error: error.message });
    return null;
  }
}

/** Safety net: the recent cases that still need a GHL record. Cheap when nothing is new. */
async function sweep({ limit = 200 } = {}) {
  if (!isEnabled()) return { queued: 0 };
  const since = await syncSince();
  if (!since) return { queued: 0 };
  const recent = await Case.find({
    createdAt: { $gte: since },
    "integrations.ghl.opportunityId": { $in: [null, undefined] },
    caseRole: { $ne: "employee" },
    visaSelectionStatus: { $ne: "pending" },
    status: { $nin: ["removed", "archived"] },
  })
    .select("_id")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  let queued = 0;
  for (const { _id } of recent) if (await enqueueForCase(_id, { since })) queued += 1;
  return { queued };
}

/**
 * Makes sure a case has its GHL card, creating it NOW (used the first time someone stages a case that was never linked, for
 * example one created before this was switched on). Throws a 4xx-style error when it cannot be done.
 */
async function ensureLinked(caseId, { client } = {}) {
  const caseDoc = await Case.findById(caseId);
  if (!caseDoc) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (hasCard(caseDoc)) return caseDoc;
  if (plan(caseDoc) !== "card") {
    throw Object.assign(new Error("This case is not on the Pipeline yet (a visa must be selected first, and employer matters are staged through their employees)."), { status: 409, code: "NOT_STAGEABLE" });
  }
  if (!isEnabled()) throw Object.assign(new Error("GoHighLevel integration is not enabled"), { status: 503, code: "GHL_DISABLED" });
  const { getWorkerClient } = require("./ghlOutboundService");
  const outcome = await runCreateCaseOpportunity({ caseId: caseDoc._id, attempts: 1 }, client || getWorkerClient());
  if (outcome !== "done") throw Object.assign(new Error("Could not add this case to the Pipeline"), { status: 409 });
  return Case.findById(caseId);
}

/** The stages a case can be moved to (its GHL pipeline's own stages) - same list for every case, however it was created. */
async function stagesForCase(caseId, user) {
  const { assertCanWorkCase } = require("./ghlOutboundService");
  const caseDoc = await Case.findById(caseId).select("visaType petitionSubType pipelineCategory visaSelectionStatus status caseRole caseStructure integrations.ghl").lean();
  if (!caseDoc) throw Object.assign(new Error("Case not found"), { status: 404 });
  await assertCanWorkCase(user, caseId);
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId });
  if (!config?.mappingsConfirmedAt) throw Object.assign(new Error("GHL stage mapping has not been confirmed"), { status: 409, code: "MAPPING_UNCONFIRMED" });
  const ghl = caseDoc.integrations?.ghl || {};
  let pipeline;
  if (ghl.opportunityId) {
    pipeline = config.pipelines.find((p) => p.enabled && p.ghlPipelineId === ghl.pipelineId);
  } else {
    if (plan(caseDoc) !== "card") throw Object.assign(new Error("This case is not on the Pipeline yet."), { status: 409, code: "NOT_STAGEABLE" });
    const category = caseDoc.pipelineCategory || aux.categoryForVisa(caseDoc.visaType, caseDoc.petitionSubType, await visaService.ensureEntries(config));
    pipeline = config.pipelines.find((p) => p.enabled && p.category === category && p.stages?.length);
  }
  if (!pipeline) throw Object.assign(new Error("This case's GHL pipeline is not configured"), { status: 409, code: "PIPELINE_NOT_CONFIGURED" });
  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order).map((s) => ({ key: s.key, name: s.name }));
  return { category: pipeline.category, currentKey: ghl.unifiedStageKey || stages[0]?.key || null, stages };
}

module.exports = { stagesForCase, plan, enqueueForCase, sweep, ensureLinked, runCreateCaseOpportunity, runLinkEmployer, isEnabled };
