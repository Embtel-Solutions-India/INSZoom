const env = require("../../config/env");
const Case = require("../../models/Case");
const User = require("../../models/User");
const GHLIntegration = require("../../models/GHLIntegration");
const GHLSyncJob = require("../../models/GHLSyncJob");
const GHLWebhookEvent = require("../../models/GHLWebhookEvent");
const caseService = require("../../modules/cases/case.service");
const { normalizeRole } = require("../../modules/authorization/roleHierarchy");
const { presentCard, ADMIN_ROLES, canSeeValue } = require("./ghlPresenter");

const DEFAULT_PER_COLUMN = 50;
const MAX_PER_COLUMN = 100;

const CARD_FIELDS =
  "caseNumber clientName clientEmail visaType visaSelectionStatus priority status assignedCaseManager caseRole parentCase user canonicalProfile.profile.person.firstName canonicalProfile.profile.person.lastName canonicalProfile.profile.person.fullName employeeIdentity.name petitionerName beneficiaryInvite canonicalProfile.profile.beneficiary.fullName canonicalProfile.profile.beneficiary.firstName canonicalProfile.profile.beneficiary.lastName canonicalProfile.profile.beneficiary.email integrations.ghl finance.totalAmount createdAt updatedAt";

// Same visibility as the Cases list (admin / super_admin / team_lead see all
// cases; a case manager only those assigned to them), narrowed to GHL cases.
// Enforced here on the server, never only in the UI.
function boardScope(user) {
  // "GHL case" = has a GHL card: created from GHL, or created in the CRM and linked since (ghlCaseOutbound.js).
  return { $and: [caseService.buildCaseFilter({}, user), { $or: [{ creationSource: "ghl" }, { "integrations.ghl.opportunityId": { $type: "string" } }] }] };
}

async function loadAssignees(cards) {
  const ids = [...new Set(cards.map((c) => c.assignedCaseManager && String(c.assignedCaseManager)).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select("name displayName").lean();
  return new Map(users.map((u) => [String(u._id), u.displayName || u.name || ""]));
}

// One batched lookup for the employer names of the employee cards in a column.
async function loadEmployers(cards) {
  const ids = [...new Set(cards.map((c) => c.parentCase && String(c.parentCase)).filter(Boolean))];
  if (!ids.length) return new Map();
  const matters = await Case.find({ _id: { $in: ids } }).select("petitionerName clientName user").lean();
  return new Map(matters.map((m) => [String(m._id), { name: m.petitionerName || m.clientName || "", user: m.user }]));
}

// The total Value of every stage of one pipeline, in one query: sum of each case's GoHighLevel Value (finance.totalAmount, US dollars) per stage. Counts ALL the cases in a
// stage (not just the page on screen), so it always matches the stage count. Roles that may not see money get none. Never throws: a problem just means no total is shown.
async function stageValues(scope, user) {
  if (!canSeeValue(user)) return null;
  try {
    const rows = await Case.aggregate([
      { $match: scope },
      { $group: { _id: "$integrations.ghl.unifiedStageKey", value: { $sum: { $ifNull: ["$finance.totalAmount", 0] } } } },
    ]);
    return new Map(rows.map((row) => [row._id, Math.round((Number(row.value) || 0) * 100) / 100]));
  } catch (_error) {
    return null;
  }
}

async function loadColumn(scope, column, user, { limit, skip, values }) {
  const filter = { $and: [scope, { "integrations.ghl.unifiedStageKey": column.key }] };
  const [total, docs] = await Promise.all([
    Case.countDocuments(filter),
    Case.find(filter).select(CARD_FIELDS).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
  ]);
  const [assignees, employers] = await Promise.all([loadAssignees(docs), loadEmployers(docs)]);
  const isAdmin = ADMIN_ROLES.has(normalizeRole(user.role));
  // admins see WHY a card is not in sync and can retry it now: attach its unfinished job (one query for the whole column). A change is never given up on, so a stuck card's job is
  // "pending" (retrying) rather than "failed" - both can be retried at once.
  const failedJobs = new Map();
  const problemJobs = new Map();
  if (isAdmin) {
    const needs = (doc) => { const g = doc.integrations?.ghl || {}; return g.sync?.state === "failed" || g.flags?.deletedInGhl || (g.sync?.state === "pending" && g.sync?.lastError); };
    const failedIds = docs.filter(needs).map((doc) => doc._id);
    if (failedIds.length) {
      const jobs = await GHLSyncJob.find({ caseId: { $in: failedIds }, status: { $in: ["failed", "pending"] }, type: { $ne: "delete_opportunity" } }).sort({ updatedAt: 1 }).select("caseId attempts lastError status").lean();
      jobs.forEach((job) => { failedJobs.set(String(job.caseId), String(job._id)); problemJobs.set(String(job.caseId), job); });
    }
  }
  const cards = docs.map((doc) => {
    const employer = doc.parentCase ? employers.get(String(doc.parentCase)) : null;
    const card = presentCard(doc, user, { employerUserId: employer?.user, employerContactName: employer?.name });
    card.assigneeName = doc.assignedCaseManager ? assignees.get(String(doc.assignedCaseManager)) || null : null;
    card.employerName = employer?.name || null;
    if (isAdmin) {
      card.needsAttention = Boolean(doc.integrations?.ghl?.flags?.needsAttention);
      card.failedJobId = failedJobs.get(String(doc._id)) || null; // the job "Retry" acts on (failed OR still-retrying)
      card.syncDetail = require("./ghlSyncState").describeSync(doc.integrations?.ghl, problemJobs.get(String(doc._id)));
    }
    return card;
  });
  return { key: column.key, name: column.name, total, ...(values ? { value: values.get(column.key) || 0 } : {}), cards, hasMore: skip + cards.length < total };
}

const PIPELINE_ORDER = ["immigrant", "non_immigrant"];

// A pipeline's cards are those currently sitting in THAT GHL pipeline, scoped to
// what this user may see. (A card that GHL moves to the other pipeline changes
// board with it.)
const pipelineScope = (scope, pipeline) => ({ $and: [scope, { "integrations.ghl.pipelineId": pipeline.ghlPipelineId }] });

/**
 * One board per GHL pipeline: Immigrant and Non-Immigrant are never merged.
 * `category` picks the pipeline (default: the first available). `column`
 * (+ `skip`) loads more cards for a single column. The response also carries a
 * small summary of every pipeline the user can see, for the tabs.
 */
async function getBoard(user, { perColumn, column, skip, category } = {}) {
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId }).lean();
  const configured = Boolean(config?.mappingsConfirmedAt) && (config?.pipelines || []).some((p) => p.enabled && p.stages?.length);
  if (!configured) return { configured: false, pipelines: [], columns: [], integrationStatus: config?.status || "unconfigured" };

  const limit = Math.min(Math.max(parseInt(perColumn, 10) || DEFAULT_PER_COLUMN, 1), MAX_PER_COLUMN);
  const offset = Math.max(parseInt(skip, 10) || 0, 0);
  const scope = boardScope(user);
  const pipelines = config.pipelines
    .filter((p) => p.enabled && p.stages?.length)
    .sort((a, b) => PIPELINE_ORDER.indexOf(a.category) - PIPELINE_ORDER.indexOf(b.category));

  const active = pipelines.find((p) => p.category === category) || pipelines[0];
  const summary = await Promise.all(
    pipelines.map(async (p) => ({
      category: p.category,
      name: p.ghlPipelineName,
      id: p.ghlPipelineId,
      total: await Case.countDocuments(pipelineScope(scope, p)),
    }))
  );
  const base = { configured: true, pipelines: summary, activeCategory: active.category, integrationStatus: config.status };

  const stages = [...active.stages].sort((a, b) => a.order - b.order);
  const activeScope = pipelineScope(scope, active);
  if (column) {
    const stage = stages.find((s) => s.key === column);
    if (!stage) return { ...base, columns: [] };
    return { ...base, columns: [await loadColumn(activeScope, stage, user, { limit, skip: offset, values: await stageValues(activeScope, user) })] };
  }
  const values = await stageValues(activeScope, user);
  const columns = await Promise.all(stages.map((stage) => loadColumn(activeScope, stage, user, { limit, skip: 0, values })));
  return { ...base, columns };
}

// A failed push for a case that has since been deleted can never be retried or fixed, so it is not "a failed push" for the health panel
// (it used to keep the counter red forever). A failed delete_opportunity IS counted: its case is gone on purpose and GHL still holds the card.
async function countActionableFailedJobs() {
  const failed = await GHLSyncJob.find({ status: "failed" }).select("caseId type").lean();
  const needsCase = failed.filter((job) => job.type !== "delete_opportunity");
  if (!needsCase.length) return failed.length;
  const alive = new Set((await Case.find({ _id: { $in: needsCase.map((job) => job.caseId) } }).select("_id").lean()).map((item) => String(item._id)));
  return failed.length - needsCase.filter((job) => !alive.has(String(job.caseId))).length;
}

/**
 * Health summary. Everyone on the board only learns whether the integration is
 * on; admins and super admins get the full picture (never any secret).
 */
async function getStatus(user) {
  const base = { enabled: Boolean(env.ghl.enabled && env.ghl.token && env.ghl.locationId) };
  if (!base.enabled || !ADMIN_ROLES.has(normalizeRole(user.role))) return base;

  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId }).lean();
  const [pendingJobs, failedJobs, deadEvents, failedEvents, deferredEvents] = await Promise.all([
    GHLSyncJob.countDocuments({ status: { $in: ["pending", "processing"] } }),
    countActionableFailedJobs(),
    GHLWebhookEvent.countDocuments({ status: "dead" }),
    GHLWebhookEvent.countDocuments({ status: "failed" }),
    GHLWebhookEvent.countDocuments({ status: "deferred" }),
  ]);
  return {
    ...base,
    webhookKeyConfigured: Boolean(env.ghl.webhookPublicKey),
    locationId: env.ghl.locationId,
    status: config?.status || "unconfigured",
    statusDetail: config?.statusDetail || null,
    mappingsConfirmed: Boolean(config?.mappingsConfirmedAt),
    pipelines: (config?.pipelines || []).map((p) => ({
      id: p.ghlPipelineId,
      name: p.ghlPipelineName,
      category: p.category,
      enabled: p.enabled,
      lastFetchOkAt: p.lastFetchOkAt || null,
      error: p.lastFetchError ? "Last fetch failed" : null,
    })),
    lastInitialSyncAt: config?.lastInitialSyncAt || null,
    lastReconcileAt: config?.lastReconcileAt || null,
    lastWebhookAt: config?.lastWebhookAt || null,
    lastApiOkAt: config?.lastApiOkAt || null,
    counts: { pendingJobs, failedJobs, deadEvents, failedEvents, deferredEvents },
  };
}

module.exports = { getBoard, getStatus, boardScope };
