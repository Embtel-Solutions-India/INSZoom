// Release 0b-1 (docs/FORM_PIPELINE_RELIABILITY_PLAN.md, Rule D / H): the evidence-resolution path for USCIS form edition acceptance.
// Shared constants. Nothing here is read by any activation / promotion / migration path yet - the gate is NOT wired in (that is Release 0b-2).

// EXACTLY these two roles may submit evidence or record a decision. super_admin is deliberately NOT included (plan decision, round 5); the route
// guard (authorizeRoles = exact match), the service and the Admin screen all use this one list.
const EVIDENCE_ROLES = Object.freeze(["admin", "team_lead"]);

const DECISIONS = Object.freeze(["accepted", "not_accepted", "held", "grandfathered"]);
const DECISION_STATUSES = Object.freeze(["verified", "unverified", "stale", "conflicting"]);

// Decisions a person may record through the evidence workflow. "grandfathered" is only ever set for editions that were live before the gate
// shipped (a later, separately approved step), never by a reviewer.
const RECORDABLE_DECISIONS = Object.freeze(["accepted", "not_accepted", "held"]);
// Only restricting decisions may be recorded by the person who submitted the evidence; "accepted" needs a DIFFERENT decider (four-eyes).
const RESTRICTING_DECISIONS = Object.freeze(["not_accepted", "held"]);

// The six immutable audit events of one evidence case, linked by evidenceCaseId. The sixth (OUTCOME_RECORDED) is written by the entry points
// that act on the gate (promote / held / blocked) - those do not exist until Release 0b-2, so 0b-1 never writes it.
const AUDIT_EVENT_TYPES = Object.freeze([
  "EVIDENCE_SUBMITTED",
  "SOURCE_FETCHED",
  "VERIFICATION_COMPLETED",
  "DECISION_RECORDED",
  "GATE_RECALCULATED",
  "OUTCOME_RECORDED",
]);

// Verification outcomes of one evidence case.
const VERIFICATION_RESULTS = Object.freeze({
  VERIFIED: "verified", // every blocking check passed
  CONFLICTING: "conflicting", // the claim disagrees with the page / PDF / template
  UNVERIFIABLE: "unverifiable", // the source could not be fetched / read, or the quote / edition is not in it
});

// Reasons the gate can return (stable strings: the Admin screen and later the entry points compare against them).
const GATE_REASONS = Object.freeze({
  NO_POLICY: "no_policy",
  NOT_ACCEPTED: "not_accepted_by_uscis",
  GRANDFATHERED: "grandfathered_serve_only",
  HELD: "held",
  UNVERIFIED: "decision_not_verified",
  STALE: "decision_past_review_date",
  CONFLICTING: "decision_conflicting",
  NOT_YET_EFFECTIVE: "edition_not_yet_effective",
  NO_LONGER_ACCEPTED: "edition_no_longer_accepted",
  INVALID_EDITION: "invalid_edition_identifier",
  GATE_ERROR: "gate_error",
});

const LIMITS = Object.freeze({
  quoteMin: 25,
  quoteMax: 2000,
  rationaleMax: 2000,
  snapshotTextMax: 2 * 1024 * 1024,
  htmlMaxBytes: 5 * 1024 * 1024,
  pdfMaxBytes: 60 * 1024 * 1024,
  maxHops: 5,
  timeoutMs: 15000,
});

// How long a fetched snapshot stays usable for a decision, and how long a recorded decision stays verified before it must be re-confirmed.
// ASSUMPTIONS to be confirmed by the user (the plan names the fields, not the numbers).
const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const REVIEW_WINDOW_DAYS = 90;

const EDITION_IDENTIFIER_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

module.exports = {
  EVIDENCE_ROLES, DECISIONS, DECISION_STATUSES, RECORDABLE_DECISIONS, RESTRICTING_DECISIONS, AUDIT_EVENT_TYPES,
  VERIFICATION_RESULTS, GATE_REASONS, LIMITS, FRESHNESS_WINDOW_MS, REVIEW_WINDOW_DAYS, EDITION_IDENTIFIER_PATTERN,
};
