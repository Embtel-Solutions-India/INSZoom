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
// OWNER POLICY (decided by the product owner, 2026-10-28): for these forms uscis.gov publishes no edition / acceptance statement at all, so the edition printed in the PDF's OWN footer
// ("Form G-325R Edition 09/04/26") is the approved edition. It applies ONLY to the forms listed here, ONLY when the gate holds no record for the edition (never over an explicit
// not-accepted / held / conflicting decision), and ONLY when the stored PDF's footer edition equals the template's edition date. Any other form keeps the evidence workflow unchanged.
const OWNER_FOOTER_EDITION_FORMS = Object.freeze(new Set(["G-325R", "G-639"]));

// OWNER POLICY (2026-10-28): the edition USCIS approves for a whole FORM FAMILY, stated by the owner as one date: "the approved edition of Form I-485 is 09/18/26, and the same goes for
// the supplement forms" (I-485A, I-485J, "I-485 Supplement A / J" ...). A form belongs to the family by the number before any supplement letters (familyOf). Same safeguards as above:
// only when the gate holds NO record for the edition (a recorded decision always wins), and only for exactly this edition date - a stray copy dated otherwise stays held.
const OWNER_APPROVED_EDITIONS = Object.freeze({ "I-485": "2026-09-18" });

/** "I-485A", "I-485 SUPPLEMENT J", "i-485 sup a", "I-485SUPA" -> "I-485" (the number every supplement of a form shares), or "" when the code has none. */
function familyOf(formCode) {
  const match = /^([A-Z]{1,4}-\d{1,4})/.exec(String(formCode || "").toUpperCase().replace(/\s+/g, ""));
  return match ? match[1] : "";
}

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
  OWNER_FOOTER_EDITION_FORMS, OWNER_APPROVED_EDITIONS, familyOf, VERIFICATION_RESULTS, GATE_REASONS, LIMITS, FRESHNESS_WINDOW_MS, REVIEW_WINDOW_DAYS, EDITION_IDENTIFIER_PATTERN,
};
