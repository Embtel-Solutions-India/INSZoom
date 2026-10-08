const env = require("../../config/env");
const Case = require("../../models/Case");
const User = require("../../models/User");
const GHLIntegration = require("../../models/GHLIntegration");
const GHLSyncJob = require("../../models/GHLSyncJob");
const GHLWebhookEvent = require("../../models/GHLWebhookEvent");
const caseService = require("../../modules/cases/case.service");
const { normalizeRole } = require("../../modules/authorization/roleHierarchy");
const { presentCard, ADMIN_ROLES } = require("./ghlPresenter");

const DEFAULT_PER_COLUMN = 50;
const MAX_PER_COLUMN = 100;

const CARD_FIELDS =
  "caseNumber clientName clientEmail visaType visaSelectionStatus priority status assignedCaseManager integrations.ghl createdAt updatedAt";

// Same visibility as the Cases list (admin / super_admin / team_lead see all
// cases; a case manager only those assigned to them), narrowed to GHL cases.
// Enforced here on the server, never only in the UI.
function boardScope(user) {
  return { $and: [caseService.buildCaseFilter({}, user), { creationSource: "ghl" }] };
}

async function loadAssignees(cards) {
  const ids = [...new Set(cards.map((c) => c.assignedCaseManager && String(c.assignedCaseManager)).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select("name displayName").lean();
  return new Map(users.map((u) => [String(u._id), u.displayName || u.name || ""]));
}

async function loadColumn(scope, column, user, { limit, skip }) {
  const filter = { $and: [scope, { "integrations.ghl.unifiedStageKey": column.key }] };
  const [total, docs] = await Promise.all([
    Case.countDocuments(filter),
    Case.find(filter).select(CARD_FIELDS).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
  ]);
  const assignees = await loadAssignees(docs);
  const isAdmin = ADMIN_ROLES.has(normalizeRole(user.role));
  const cards = docs.map((doc) => {
    const card = presentCard(doc, user);
    card.assigneeName = doc.assignedCaseManager ? assignees.get(String(doc.assignedCaseManager)) || null : null;
    if (isAdmin) card.needsAttention = Boolean(doc.integrations?.ghl?.flags?.needsAttention);
    return card;
  });
  return { key: column.key, name: column.name, total, cards, hasMore: skip + cards.length < total };
}

/**
 * The unified board: one column per unified stage, cards from BOTH pipelines
 * merged. `column` (+ `skip`) loads more cards for a single column.
 */
async function getBoard(user, { perColumn, column, skip } = {}) {
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId }).lean();
  if (!config?.mappingsConfirmedAt || !config.unifiedStages?.length) {
    return { configured: false, columns: [], integrationStatus: config?.status || "unconfigured" };
  }
  const limit = Math.min(Math.max(parseInt(perColumn, 10) || DEFAULT_PER_COLUMN, 1), MAX_PER_COLUMN);
  const offset = Math.max(parseInt(skip, 10) || 0, 0);
  const scope = boardScope(user);
  const stages = [...config.unifiedStages].sort((a, b) => a.order - b.order);

  if (column) {
    const stage = stages.find((s) => s.key === column);
    if (!stage) return { configured: true, columns: [], integrationStatus: config.status };
    return { configured: true, columns: [await loadColumn(scope, stage, user, { limit, skip: offset })], integrationStatus: config.status };
  }
  const columns = await Promise.all(stages.map((stage) => loadColumn(scope, stage, user, { limit, skip: 0 })));
  return { configured: true, columns, integrationStatus: config.status };
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
    GHLSyncJob.countDocuments({ status: "failed" }),
    GHLWebhookEvent.countDocuments({ status: "dead" }),
    GHLWebhookEvent.countDocuments({ status: "failed" }),
    GHLWebhookEvent.countDocuments({ status: "deferred" }),
  ]);
  return {
    ...base,
    webhookKeyConfigured: Boolean(env.ghl.webhookPublicKey),
    webhookUrl: env.ghl.webhookPublicUrl || null,
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
