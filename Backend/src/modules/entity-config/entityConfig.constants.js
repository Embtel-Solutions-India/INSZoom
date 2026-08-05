// Code-fallback defaults for entity/brand config — mirrors the Settings
// schema defaults exactly, used only if a Settings field is ever missing on
// a legacy/partial document (schema defaults already cover the normal case).
const DEFAULT_BRAND_TOKENS = Object.freeze({
  primaryColor: "#0B1F3A",
  accentColor: "#C6A15B",
  logoUrl: "",
});

// Canonical status vocabulary (Phase 0, Unit 6) — one server-authoritative
// set of states every module maps onto instead of inventing its own. `key`
// is the wire value; `colorToken` is semantic (resolved to an actual hex/
// class by the frontend's theme), never a hardcoded color here.
const CANONICAL_STATUSES = Object.freeze([
  {
    key: "complete",
    label: "Complete",
    colorToken: "green",
    description: "Complete / Approved / Verified / Healthy",
    appliesTo: ["case", "document", "checklist", "uscis_form", "petition", "message", "timeline", "dashboard"],
  },
  {
    key: "in_progress",
    label: "In Progress",
    colorToken: "yellow",
    description: "Pending Review / Waiting / In Progress",
    appliesTo: ["case", "document", "checklist", "uscis_form", "petition", "message", "timeline", "dashboard"],
  },
  {
    key: "action_required",
    label: "Action Required",
    colorToken: "orange",
    description: "Missing Info / Action Soon / Low Evidence / Partial",
    appliesTo: ["case", "document", "checklist", "uscis_form", "petition", "message", "timeline", "dashboard"],
  },
  {
    key: "critical",
    label: "Critical",
    colorToken: "red",
    description: "Rejected / Critical / Overdue / Validation Failed",
    appliesTo: ["case", "document", "checklist", "uscis_form", "petition", "message", "timeline", "dashboard"],
  },
  {
    key: "informational",
    label: "Informational",
    colorToken: "blue",
    description: "Assigned / Info Only / Awaiting Client",
    appliesTo: ["case", "document", "checklist", "uscis_form", "petition", "message", "timeline", "dashboard"],
  },
  {
    key: "not_started",
    label: "Not Started",
    colorToken: "gray",
    description: "Not Started",
    appliesTo: ["case", "document", "checklist", "uscis_form", "petition", "message", "timeline", "dashboard"],
  },
]);

// Maps the current 5-state frontend vocabulary (BAIS/Frontend/src/utils/
// checklistStatus.jsx) onto the 6 canonical states with zero breakage.
// "needs_attention" maps to "critical" (not "action_required"): checked
// against its actual call sites (fieldItemStatus/documentItemStatus in that
// file) it only ever fires for answer.status === "rejected" or
// document reviewStatus "rejected"/"needs_revision" — i.e. "Rejected", which
// the canonical spec explicitly places under RED/critical, not ORANGE/
// action_required. Flagged in the final report as the founder-sign-off
// decision point per the task spec — flip to "action_required" if a softer
// reading is intended.
const LEGACY_STATUS_MAP = Object.freeze({
  not_started: "not_started",
  in_progress: "in_progress",
  under_review: "in_progress",
  verified: "complete",
  needs_attention: "critical",
});

function mapLegacyStatus(oldStatus) {
  return LEGACY_STATUS_MAP[oldStatus] || "not_started";
}

module.exports = {
  DEFAULT_BRAND_TOKENS,
  CANONICAL_STATUSES,
  LEGACY_STATUS_MAP,
  mapLegacyStatus,
};
