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

// Who the beneficiary is, if anyone knows yet. Read-only: the invite (name the petitioner typed) first, then what
// the canonical profile has recorded from the beneficiary checklist (so it appears when the petitioner fills it in
// themselves). Never written anywhere.
function beneficiaryIdentity(caseDoc) {
  const invite = caseDoc.beneficiaryInvite || {};
  const canon = caseDoc.canonicalProfile?.profile?.beneficiary || {};
  const val = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);
  const first = String(val(canon.firstName) || "").trim();
  const last = String(val(canon.lastName) || "").trim();
  const full = String(val(canon.fullName) || "").trim() || [first, last].filter(Boolean).join(" ");
  return { name: String(invite.name || "").trim() || full, email: String(invite.email || val(canon.email) || "").trim() };
}

// The few fields a board card / move response needs, in one place so the
// board endpoint (later phase) and the move endpoint can never disagree.
function presentCard(caseDoc, user) {
  const ghl = caseDoc.integrations?.ghl || {};
  return {
    _id: caseDoc._id,
    caseNumber: caseDoc.caseNumber,
    // On a FAMILY card the title is the petitioner (the GHL contact); clientName/clientEmail on the case are the beneficiary's.
    clientName: ghl.role === "family" ? caseDoc.petitionerName || "" : caseDoc.clientName,
    clientEmail: ghl.role === "family" ? null : caseDoc.clientEmail,
    isFamily: ghl.role === "family",
    ...(ghl.role === "family" ? { beneficiaryName: beneficiaryIdentity(caseDoc).name, beneficiaryIdentified: Boolean(beneficiaryIdentity(caseDoc).name) } : {}),
    visaType: caseDoc.visaType || null,
    visaSelectionRequired: caseDoc.visaSelectionStatus === "pending",
    priority: caseDoc.priority,
    status: caseDoc.status,
    assignedCaseManager: caseDoc.assignedCaseManager || null,
    // individual | employee. An employee card has the employer's name on it and is "not identified" until named.
    caseRole: caseDoc.caseRole || null,
    employeeIdentified: caseDoc.caseRole !== "employee" || Boolean(caseDoc.clientName),
    employerName: null, // filled in by the board service from the employer matter
    unifiedStageKey: ghl.unifiedStageKey || null,
    category: ghl.category || null,
    // Internal metadata: which GHL pipeline the card belongs to.
    sourcePipelineId: ghl.pipelineId || null,
    syncStatus: publicSyncStatus(ghl, user),
  };
}

module.exports = { publicSyncStatus, presentCard, ADMIN_ROLES };
