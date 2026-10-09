const crypto = require("crypto");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const GHLCaseLink = require("../../models/GHLCaseLink");
const GHLEmployerLink = require("../../models/GHLEmployerLink");
const GHLIntegration = require("../../models/GHLIntegration");
const GHLSyncJob = require("../../models/GHLSyncJob");
const caseService = require("../../modules/cases/case.service");
const opportunityService = require("./ghlOpportunityService"); // by object, so tests can substitute the GHL calls
const visaService = require("./ghlVisaService");
const { ensureFieldIds, MARKER_FIELD } = require("./ghlCustomFieldService");
const { resolveUnifiedStage } = require("./ghlPipelineService");
const { GHLApiError } = require("./ghlClient");
const { employeeName } = require("./ghlEmployeeIdentity");

// Employee cards <-> GHL opportunities, driven from Immiglance:
//   employee added   -> create the GHL opportunity (employer's contact, right pipeline, first stage, Service Type)
//   employee named   -> opportunity display name "Employer, Employee"
//   employee removed -> opportunity "abandoned" (reversible; never deleted)
//   employee restored-> opportunity "open" again (only if WE abandoned it)
//
// Every job recomputes what to do when it RUNS, from the card's current state, so a late or repeated job can never
// push stale data. Only employees of employers GHL already knows (a GHL contact link) are ever touched, and only
// employees added AFTER the employer was linked: nothing historical is ever created in GHL.

const MARKER_PREFIX = "immiglance:";
const markerFor = (child) => `${MARKER_PREFIX}${child.caseNumber}`;
const clean = (value) => (typeof value === "string" ? value.trim() : "");

// ---------------------------------------------------------------------------
// What does GHL need? (pure)
// ---------------------------------------------------------------------------

// The employee's own name (see ghlEmployeeIdentity.js for why clientName alone is not trusted).
const identifiedName = (child, principal) => employeeName(child, principal?.user, principal?.clientName);

// "ABC Technologies, John Smith" once identified; null before. Display only: identity is the opportunity id.
function desiredEmployeeName(child, principal) {
  const employee = identifiedName(child, principal);
  if (!employee) return null;
  const employer = clean(principal?.petitionerName) || clean(principal?.clientName);
  return employer ? `${employer}, ${employee}` : employee;
}

/** Which jobs does this employee card need right now? */
function planJobsForChild(child, principal, link) {
  if (!child || child.caseRole !== "employee" || !link) return [];
  // Employees that existed before GHL knew the employer are history: never created in GHL.
  if (link.createdAt && child.createdAt && new Date(child.createdAt) < new Date(link.createdAt)) return [];
  const ghl = child.integrations?.ghl || {};
  const removed = child.status === "removed";

  if (!ghl.opportunityId) return removed ? [] : ["create_opportunity"];

  const jobs = [];
  if (removed && ghl.opportunityStatus !== "abandoned") jobs.push("set_status");
  if (!removed && ghl.opportunityStatus === "abandoned" && ghl.abandonedByImmiglance) jobs.push("set_status");
  const name = desiredEmployeeName(child, principal);
  if (!removed && name && name !== ghl.displayName) jobs.push("rename");
  return jobs;
}

// Immigrant or Non-Immigrant pipeline for a visa: the mapping table says so (it is the same table GHL's Service Type
// is read with); EB-* / PERM are immigrant when no row matches.
function categoryForVisa(visaType, petitionSubType, entries) {
  const rows = (entries || []).filter((e) => e.visaType === visaType);
  const exact = rows.find((e) => (e.petitionSubType || "") === (petitionSubType || ""));
  const hit = exact || rows[0];
  if (hit?.category) return hit.category;
  return /^EB-|^PERM$/i.test(visaType || "") ? "immigrant" : "non_immigrant";
}

const DETAIL_TO_SERVICE_TYPE = { work_visa: "Work Visa", study_visa: "Study Visa", green_card: "Green Card", business__investment: "Business/Investment" };

// The GHL field values that describe this visa, from the SAME table inbound uses (so out and in agree).
function serviceTypeFor(visaType, petitionSubType, entries) {
  const rows = (entries || []).filter((e) => e.visaType === visaType && (!e.petitionSubType || e.petitionSubType === (petitionSubType || "")));
  const detailed = rows.find((e) => e.field === "service_type");
  if (detailed) return { serviceType: detailed.value };
  const detail = rows.find((e) => DETAIL_TO_SERVICE_TYPE[e.field]);
  if (detail) return { serviceType: DETAIL_TO_SERVICE_TYPE[detail.field], detailField: detail.field, detailValue: detail.value };
  return {};
}

// ---------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------

async function queueJob(caseId, type) {
  // One waiting/running job of a type per card is enough: it recomputes what to do when it runs.
  if (await GHLSyncJob.exists({ caseId, type, status: { $in: ["pending", "processing"] } })) return null;
  return GHLSyncJob.create({ type, caseId, operationId: crypto.randomUUID(), status: "pending", nextAttemptAt: new Date() });
}

/** Decide and queue for one employee card. Never throws. Returns the job types queued. */
async function enqueueForChild(childId) {
  try {
    const child = await Case.findById(childId).select("caseNumber caseRole status parentCase user clientName createdAt visaType petitionSubType integrations.ghl canonicalProfile.profile.person.firstName canonicalProfile.profile.person.lastName canonicalProfile.profile.person.fullName").lean();
    if (!child || child.caseRole !== "employee" || !child.parentCase) return [];
    const [link, principal] = await Promise.all([
      GHLEmployerLink.findOne({ principalCaseId: child.parentCase }).lean(),
      Case.findById(child.parentCase).select("petitionerName clientName user").lean(),
    ]);
    const queued = [];
    for (const type of planJobsForChild(child, principal, link)) {
      const job = await queueJob(child._id, type);
      if (job) {
        queued.push(type);
        require("./ghlOutboundService").processJobSoon(job._id);
      }
    }
    return queued;
  } catch (error) {
    logger.warn("ghl_employee_enqueue_failed", { childId: String(childId), error: error.message });
    return [];
  }
}

/**
 * Safety net: looks at every employee of every GHL-linked employer and queues whatever is missing, so nothing
 * depends on a hook having fired (for example an employee the employer named through their own data entry).
 * Reads only what it needs, by _id; cheap when nothing changed.
 */
async function sweep({ limit = 500 } = {}) {
  const links = await GHLEmployerLink.find({}).lean();
  if (!links.length) return { checked: 0, queued: 0 };
  const principals = await Case.find({ _id: { $in: links.map((l) => l.principalCaseId) } }).select("childCases petitionerName clientName user").lean();
  const linkOf = new Map(links.map((l) => [String(l.principalCaseId), l]));
  const principalOf = new Map(principals.map((p) => [String(p._id), p]));
  const childIds = principals.flatMap((p) => p.childCases || []).slice(-limit);
  if (!childIds.length) return { checked: 0, queued: 0 };

  const children = await Case.find({ _id: { $in: childIds } })
    .select("caseNumber caseRole status parentCase user clientName createdAt visaType petitionSubType integrations.ghl canonicalProfile.profile.person.firstName canonicalProfile.profile.person.lastName canonicalProfile.profile.person.fullName")
    .lean();
  let queued = 0;
  for (const child of children) {
    const key = String(child.parentCase);
    if (planJobsForChild(child, principalOf.get(key), linkOf.get(key)).length) queued += (await enqueueForChild(child._id)).length;
  }
  return { checked: children.length, queued };
}

// ---------------------------------------------------------------------------
// Running a job. Throws on a GHL failure (the caller owns retries); returns "done" or "skipped".
// ---------------------------------------------------------------------------

const permanent = (message) => new GHLApiError(message, { status: 0, retryable: false });
const transient = (message) => new GHLApiError(message, { status: 0, retryable: true });

// Writes the opportunity onto the employee card and records the identity link. Idempotent: used both when our
// own create finishes and when GHL's "created" webhook gets there first.
async function linkCreatedOpportunity({ child, opportunity, pipeline, mapping, contactId, locationId, role = "employee" }) {
  const now = new Date();
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
    "integrations.ghl.role": role,
    "integrations.ghl.origin": "immiglance",
    "integrations.ghl.displayName": opportunity.name,
    "integrations.ghl.lastSyncedAt": now,
    "integrations.ghl.sync.state": "synced",
    "integrations.ghl.sync.version": 1,
    "integrations.ghl.sync.source": "immiglance",
    "integrations.ghl.sync.changedAt": now,
    "integrations.ghl.sync.lastSyncedStageId": opportunity.pipelineStageId || mapping?.ghlStageId,
    "integrations.ghl.sync.attempts": 0,
    "integrations.ghl.sync.lastError": null,
  };
  // Guarded: never overwrite a link another run already wrote.
  const result = await Case.updateOne({ _id: child._id, "integrations.ghl.opportunityId": { $in: [null, opportunity.id] } }, { $set: set });
  if (!result.matchedCount) return false;
  // The board lists GHL-linked cards by creationSource; an employee added by hand has none, so mark it (never overwrite a real source).
  await Case.updateOne({ _id: child._id, creationSource: null }, { $set: { creationSource: "ghl" } }).catch(() => {});
  await GHLCaseLink.create({ locationId, opportunityId: opportunity.id, caseId: child._id, contactId }).catch((error) => {
    if (error?.code !== 11000) throw error;
  });
  const fresh = await Case.findById(child._id);
  if (fresh) {
    caseService.addTimelineEvent(fresh, "case", "GHL opportunity created", `Opportunity ${opportunity.id} in "${pipeline.ghlPipelineName}"`, null, { source: "immiglance", ghlOpportunityId: opportunity.id, ghlPipelineId: pipeline.ghlPipelineId });
    await fresh.save().catch(() => {});
  }
  return true;
}

// The marker we put on every opportunity we create, read back from either place it can live.
function markerFromOpportunity(opportunity, fieldIds) {
  const source = clean(opportunity?.source);
  if (source.startsWith(MARKER_PREFIX)) return source;
  const markerId = fieldIds?.[MARKER_FIELD.name];
  if (markerId) {
    const field = (opportunity?.customFields || []).find((f) => f?.id === markerId);
    const value = clean(field?.fieldValueString ?? field?.fieldValue ?? field?.value);
    if (value.startsWith(MARKER_PREFIX)) return value;
  }
  return null;
}

async function runCreate(job, client) {
  const child = await Case.findById(job.caseId);
  if (!child || child.caseRole !== "employee") return "skipped";
  if (child.status === "removed") return "skipped"; // removed before it was ever created: nothing to create
  if (child.integrations?.ghl?.opportunityId) return "done"; // already linked (for example adopted from GHL's webhook)

  const [principal, link] = await Promise.all([Case.findById(child.parentCase), GHLEmployerLink.findOne({ principalCaseId: child.parentCase }).lean()]);
  if (!principal || !link) return "skipped"; // the employer is not (or no longer) known to GHL
  const config = await GHLIntegration.findOne({ locationId: link.locationId });
  if (!config?.mappingsConfirmedAt) throw transient("GHL stage mapping is not confirmed yet");

  const entries = await visaService.ensureEntries(config);
  const category = categoryForVisa(child.visaType, child.petitionSubType, entries);
  const pipeline = config.pipelines.find((p) => p.enabled && p.category === category && p.stages?.length);
  if (!pipeline) throw permanent(`No ${category} GHL pipeline is configured`);
  const first = [...pipeline.stages].sort((a, b) => a.order - b.order)[0];
  const mapping = config.stageMappings.find((m) => m.ghlPipelineId === pipeline.ghlPipelineId && m.unifiedStageKey === first.key);
  if (!mapping) throw permanent("The first stage of the GHL pipeline is not mapped");

  const fieldIds = await ensureFieldIds(config, { client });
  const marker = markerFor(child);
  const customFields = [];
  const svc = serviceTypeFor(child.visaType, child.petitionSubType, entries);
  if (svc.serviceType && fieldIds?.service_type) customFields.push({ id: fieldIds.service_type, field_value: svc.serviceType });
  if (svc.detailField && fieldIds?.[svc.detailField]) customFields.push({ id: fieldIds[svc.detailField], field_value: svc.detailValue });
  const markerFieldId = fieldIds?.[MARKER_FIELD.name];
  if (markerFieldId) customFields.push({ id: markerFieldId, field_value: marker });

  // A RETRY may follow a create that actually succeeded but whose answer we never saw: look for our marker first.
  let opportunity = null;
  if (job.attempts > 1) {
    const mine = await opportunityService.fetchAllOpportunities(pipeline.ghlPipelineId, { locationId: link.locationId, contactId: link.contactId, client });
    opportunity = mine.find((o) => markerFromOpportunity(o, fieldIds) === marker) || null;
  }
  if (!opportunity) {
    opportunity = await opportunityService.createOpportunity(
      {
        pipelineId: pipeline.ghlPipelineId,
        locationId: link.locationId,
        name: clean(principal.petitionerName) || clean(principal.clientName) || "Employer", // the employee's name is added once known
        pipelineStageId: mapping.ghlStageId,
        status: "open",
        contactId: link.contactId,
        ...(markerFieldId ? {} : { source: marker }),
        ...(customFields.length ? { customFields } : {}),
      },
      client
    );
  }
  if (!opportunity?.id) throw transient("GHL did not return the new opportunity");
  await linkCreatedOpportunity({ child, opportunity, pipeline, mapping, contactId: link.contactId, locationId: link.locationId });
  return "done";
}

async function runSetStatus(job, client) {
  const child = await Case.findById(job.caseId);
  const ghl = child?.integrations?.ghl;
  if (!child || !ghl?.opportunityId) return "skipped";
  let desired = null;
  if (child.status === "removed") desired = "abandoned";
  else if (ghl.opportunityStatus === "abandoned" && ghl.abandonedByImmiglance) desired = "open"; // only undo OUR abandon
  if (!desired || ghl.opportunityStatus === desired) return "skipped";

  await opportunityService.updateOpportunityStatus(ghl.opportunityId, desired, client);
  await Case.updateOne(
    { _id: child._id },
    { $set: { "integrations.ghl.opportunityStatus": desired, "integrations.ghl.abandonedByImmiglance": desired === "abandoned", "integrations.ghl.lastSyncedAt": new Date() } }
  );
  const fresh = await Case.findById(child._id);
  if (fresh) {
    caseService.addTimelineEvent(fresh, "case", desired === "abandoned" ? "GHL opportunity abandoned" : "GHL opportunity reopened", `Employee ${desired === "abandoned" ? "removed" : "restored"}`, null, { source: "immiglance", status: desired });
    await fresh.save().catch(() => {});
  }
  return "done";
}

async function runRename(job, client) {
  const child = await Case.findById(job.caseId);
  const ghl = child?.integrations?.ghl;
  if (!child || !ghl?.opportunityId || child.status === "removed") return "skipped";
  const principal = await Case.findById(child.parentCase).select("petitionerName clientName user").lean();
  const name = desiredEmployeeName(child, principal);
  if (!name || name === ghl.displayName) return "skipped";
  await opportunityService.updateOpportunityName(ghl.opportunityId, name, client);
  await Case.updateOne({ _id: child._id }, { $set: { "integrations.ghl.displayName": name, "integrations.ghl.lastSyncedAt": new Date() } });
  return "done";
}

async function runAuxJob(job, { client } = {}) {
  if (job.type === "create_opportunity") return runCreate(job, client);
  if (job.type === "set_status") return runSetStatus(job, client);
  if (job.type === "rename") return runRename(job, client);
  // Cases created in the CRM get their GHL card / employer link from ghlCaseOutbound.js
  if (job.type === "create_case_opportunity") return require("./ghlCaseOutbound").runCreateCaseOpportunity(job, client);
  if (job.type === "link_employer") return require("./ghlCaseOutbound").runLinkEmployer(job, client);
  throw permanent(`Unknown job type ${job.type}`);
}

// ---------------------------------------------------------------------------
// Inbound: GHL's own "created" webhook for an opportunity WE created
// ---------------------------------------------------------------------------

/**
 * If this unknown opportunity carries our marker, link it to the employee card that asked for it instead of creating
 * a second card. Returns null (not ours: carry on as normal), or { adopted, note }.
 */
async function adoptOwnOpportunity({ opportunity, config, pipeline, mapping, client }) {
  // The webhook may omit Source / custom fields: fetch the opportunity once (the visa resolver reuses it).
  if (opportunity.source === undefined && !Array.isArray(opportunity.customFields) && opportunity.id) {
    const full = await opportunityService.getOpportunity(opportunity.id, client).catch(() => null);
    if (full) {
      opportunity.source = full.source ?? null;
      opportunity.customFields = full.customFields;
    }
  }
  const fieldIds = await ensureFieldIds(config, { client });
  const marker = markerFromOpportunity(opportunity, fieldIds);
  if (!marker) return null;

  const child = await Case.findOne({ caseNumber: marker.slice(MARKER_PREFIX.length) }).select("_id caseRole integrations.ghl");
  // A marker for a card we no longer have must not become a phantom card.
  if (!child) return { adopted: false, note: "marker for an unknown Immiglance case" };
  const linked = child.integrations?.ghl?.opportunityId;
  if (linked && linked !== opportunity.id) return { adopted: false, note: "that employee card is already linked to another opportunity" };
  if (!linked) {
    await linkCreatedOpportunity({ child, opportunity, pipeline, mapping, contactId: opportunity.contactId, locationId: config.locationId, role: child.caseRole === "employee" ? "employee" : "individual" });
  }
  return { adopted: true, note: "linked to the employee card Immiglance created" };
}

module.exports = {
  MARKER_PREFIX,
  markerFor,
  markerFromOpportunity,
  identifiedName,
  desiredEmployeeName,
  planJobsForChild,
  categoryForVisa,
  serviceTypeFor,
  queueJob,
  enqueueForChild,
  linkCreatedOpportunity,
  sweep,
  runAuxJob,
  linkCreatedOpportunity,
  adoptOwnOpportunity,
};
