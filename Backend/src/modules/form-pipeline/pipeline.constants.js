// Phase 1 - durable, resumable, fenced pipeline (plan "Phase 1"). Shared names and limits; nothing here touches a database.

// the job-record version: a worker only claims versions it understands (backend and worker are restarted in lockstep; an unknown version is left alone and reported)
const SCHEMA_VERSION = 1;
const SUPPORTED_SCHEMA_VERSIONS = [1];

const JOB_STATES = Object.freeze({
  PENDING: "pending", // waiting for a worker (or for its next retry time)
  RUNNING: "running", // a worker holds the lease
  BLOCKED: "blocked", // the input is bad (invalid / missing PDF, unresolvable page): slow retry, or retry on a new edition / checksum
  HELD: "held", // the edition policy (or another approval) must decide first: re-checked slowly, and only ever promoted through the gate
  DEAD_LETTER: "dead_letter", // repeated failure: one alert, then only an admin's manual retry
  DONE: "done",
});
// states in which a form already has "its" job: a second enqueue for the same form returns that job instead of creating another
const OPEN_STATES = Object.freeze([JOB_STATES.PENDING, JOB_STATES.RUNNING, JOB_STATES.BLOCKED, JOB_STATES.HELD]);

// the stages the existing pipeline passes through (activateOrPromote and its callers are wrapped, not rewritten)
const STAGES = Object.freeze({
  DETECT: "detect", // ask uscis.gov whether the edition changed
  IMPORT: "import", // resolve + download + normalize (qpdf / XFA) + import, or scan into a draft
  MAP: "map", // carry the mapping forward / apply authored or inferred rules
  AI_MAP: "ai_map", // Phase 4, optional (FORM_AI_MAPPING=shadow|on): Gemini suggestions for the boxes the rules left unmapped; never fails the pipeline
  CERTIFY: "certify", // fillable, mapping valid, filled round trip, viewer/download, components
  PROMOTE: "promote", // edition-policy gate + existing guarded activation (under the per-form promotion mutex)
  MIGRATE_CASES: "migrate_cases", // open case forms move to the new edition with every saved answer
  FINALIZE: "finalize", // biographic tier, cache
});

const TRIGGERS = Object.freeze(["catalog_sync", "admin_fetch", "case_acquire", "autopilot", "mapping_save", "edition_upgrade", "manual_retry", "script", "case_migration", "unknown"]);

const ERROR_CLASSES = Object.freeze({
  TRANSIENT: "transient", // network / 5xx / timeout: retry with backoff and jitter
  BLOCKED: "blocked", // bad or missing input: slow retry, or only on a new edition / checksum
  HELD: "held", // edition policy hold: wait for a decision
  REPAIRABLE: "repairable", // a known repair exists: repair, VERIFY, retry
  LEASE_LOST: "lease_lost", // another worker owns the job now: stop quietly
  FATAL: "fatal", // a programming / data error that retrying cannot fix
});

const LIMITS = Object.freeze({
  leaseMs: 10 * 60 * 1000, // a worker that stops heartbeating for this long loses the job
  heartbeatMs: 60 * 1000,
  maxAttempts: 5,
  backoffBaseMs: 60 * 1000,
  backoffMaxMs: 6 * 60 * 60 * 1000,
  blockedRetryMs: 24 * 60 * 60 * 1000,
  heldRecheckMs: 12 * 60 * 60 * 1000, // a held job looks again after this long (the gate still decides; it can never be promoted without an accepted decision)
  repairAttemptsPerStrategy: 1,
  historyKept: 50,
  doneKeptDays: 30,
  promotionMutexMs: 30 * 60 * 1000,
  queuedAlertAfterMs: 15 * 60 * 1000, // a queued job older than this with no live worker raises the "worker unavailable" alert
});

module.exports = { SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, JOB_STATES, OPEN_STATES, STAGES, TRIGGERS, ERROR_CLASSES, LIMITS };
