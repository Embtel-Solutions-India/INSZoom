const { normalizeRole } = require("../../modules/authorization/roleHierarchy");

const ADMIN_ROLES = new Set(["super_admin", "admin"]);

// Collapses the stored sync state to SYNCED / PENDING / FAILED. Only admins and
// super admins ever see FAILED; everyone else sees PENDING while it is being
// retried. No operation ids, retry counts, HTTP codes or error text are ever
// returned from here.
function publicSyncStatus(ghl, user) {
  const state = ghl?.sync?.state || "synced";
  if (state === "failed") return ADMIN_ROLES.has(normalizeRole(user?.role)) ? "FAILED" : "PENDING";
  return state === "pending" ? "PENDING" : "SYNCED";
}

// The few fields a board card / move response needs, in one place so the
// board endpoint (later phase) and the move endpoint can never disagree.
function presentCard(caseDoc, user) {
  const ghl = caseDoc.integrations?.ghl || {};
  return {
    _id: caseDoc._id,
    caseNumber: caseDoc.caseNumber,
    clientName: caseDoc.clientName,
    clientEmail: caseDoc.clientEmail,
    visaType: caseDoc.visaType || null,
    visaSelectionRequired: caseDoc.visaSelectionStatus === "pending",
    priority: caseDoc.priority,
    status: caseDoc.status,
    assignedCaseManager: caseDoc.assignedCaseManager || null,
    unifiedStageKey: ghl.unifiedStageKey || null,
    category: ghl.category || null,
    // Internal metadata: which GHL pipeline the card belongs to.
    sourcePipelineId: ghl.pipelineId || null,
    syncStatus: publicSyncStatus(ghl, user),
  };
}

module.exports = { publicSyncStatus, presentCard, ADMIN_ROLES };
