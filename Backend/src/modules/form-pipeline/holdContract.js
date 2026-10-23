// Phase 7.0 - the hold contract. A job that cannot go on is never "just stuck": it carries WHY, WHAT WOULD RELEASE IT, WHEN it was last judged and with which
// code versions. A hold is re-evaluated automatically (a transient failure clears, new evidence appears, or the code that judged it changed) and, when it lasts
// longer than the escalation period, it is raised once to the people who can look at it. Escalation never changes the decision, and nothing here ever promotes
// an edition: promotion still goes only through the release gate and the edition-acceptance gate.
//
// Pure functions; no database.
const { JOB_STATES } = require("./pipeline.constants");

// Bumped when the judging code changes in a way that can turn an old hold into a pass (matcher / gate / certification). A hold stamped with older versions is
// re-evaluated once. Starting values; later releases (7.3 matcher, 7.4 gate, 7.6 certification) raise them.
// `resolver` (7.E): raised whenever a new error-resolution strategy ships, so a job held because no strategy solved it runs again with the new one.
const EVALUATOR_VERSIONS = Object.freeze({ matcher: 0, gate: 1, cert: 1, resolver: 1 });

const DEFAULT_ESCALATION_DAYS = 7;
const escalationMs = (env = process.env) => {
  const days = Number(env.FORM_PIPELINE_HOLD_ESCALATION_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_ESCALATION_DAYS) * 86400000;
};

// what would release a hold, by reason code; the generic entries are used when a code has no specific one
const CONDITIONS = {
  EDITION_POLICY_HELD: ["USCIS acceptance of this edition is recorded (the automatic check reads the official page every 12 hours)"],
  UNREVIEWED_EDITION_CHANGES: ["the edition difference is acknowledged (automatically when it is provably safe) or the changed boxes are re-mapped"],
  PROMOTION_BUSY: ["the other promotion of this form finishes"],
  TOOL_UNAVAILABLE: ["the tool (qpdf) is found and runs again, or a new normalizer ships: the pre-flight check re-probes every 30 minutes and the job resumes by itself"],
  NO_OFFICIAL_SOURCE: ["an official USCIS page or PDF address for this form is found (the source resolver tries every known address on each run), or the form's address is stored on the template"],
  PDF_UNREADABLE: ["the official file changes, or a new repair for this kind of file ships; the job retries every 24 hours"],
  NO_FILLABLE_FIELDS: ["USCIS publishes a fillable (AcroForm) file for this edition; the job re-checks when the official file changes"],
  TEMPLATE_TOO_LARGE: ["the template is stored in a smaller layout (needs the template-size change to be approved)"],
  SCAN_FAILED: ["a scanner fix ships; the job re-runs automatically"],
  CERTIFICATION_FAILED: ["the failed certification check passes after a repair or a mapping change; the job re-checks on each run"],
  NETWORK_UNAVAILABLE: ["uscis.gov answers again; the job retries with growing delays"],
  MIGRATION_FAILED: ["the failed case forms migrate on the next run (each failure is retried on its own)"],
  UNRESOLVED_ERROR: ["a resolution strategy for this error signature ships (the resolver version changes and the job re-runs)"],
};
const BY_CLASS = {
  held: ["the condition that caused the hold is resolved; the job re-checks every 12 hours"],
  blocked: ["the official file or page changes, or a code fix ships; the job retries every 24 hours"],
  fatal: ["a code fix ships; an administrator retries the job"],
  repairable: ["the repair succeeds on retry"],
  transient: ["the temporary problem clears; the job retries with growing delays"],
};

const releaseConditionsFor = ({ code, errorClass } = {}) => [...(CONDITIONS[code] || BY_CLASS[errorClass] || BY_CLASS.held)];

/**
 * The hold record stored on the job when it moves to held / blocked / dead_letter.
 * `previous` is the job's earlier hold (its firstHeldAt and escalation are kept while the same hold continues).
 */
function buildHold({ classification, stage, message, previous = null, at = new Date(), versions = EVALUATOR_VERSIONS }) {
  const code = classification?.code || "UNKNOWN";
  const same = previous && previous.reasonCode === code;
  return {
    reasonCode: code,
    errorClass: classification?.class || "unknown",
    stage: stage || null,
    detail: message ? String(message).slice(0, 300) : "",
    releaseConditions: releaseConditionsFor({ code, errorClass: classification?.class }),
    firstHeldAt: same && previous.firstHeldAt ? previous.firstHeldAt : at,
    lastEvaluatedAt: at,
    evaluatedWith: { ...versions },
    ...(same && previous.escalatedAt ? { escalatedAt: previous.escalatedAt } : {}),
  };
}

/** True when the judging code has changed since this hold was last evaluated (so it is worth judging again now). */
function isOutdated(hold, versions = EVALUATOR_VERSIONS) {
  if (!hold) return false;
  const used = hold.evaluatedWith || {};
  return Object.keys(versions).some((key) => Number(used[key]) !== Number(versions[key]));
}

/** True when a hold has lasted longer than the escalation period and has not been raised yet. */
function needsEscalation(hold, now = new Date(), periodMs = escalationMs()) {
  if (!hold || hold.escalatedAt || !hold.firstHeldAt) return false;
  return new Date(now).getTime() - new Date(hold.firstHeldAt).getTime() >= periodMs;
}

const HOLD_STATES = Object.freeze([JOB_STATES.HELD, JOB_STATES.BLOCKED, JOB_STATES.DEAD_LETTER]);

module.exports = { EVALUATOR_VERSIONS, DEFAULT_ESCALATION_DAYS, escalationMs, releaseConditionsFor, buildHold, isOutdated, needsEscalation, HOLD_STATES };
