// Petition AI Review: the fixed vocabulary shared by the scan job, the AI layer, the API and (by value) the Admin UI.

const SCAN_STATUS = Object.freeze({
  QUEUED: "queued",
  SCANNING: "scanning",
  COMPLETED: "completed",
  COMPLETED_WITH_GAPS: "completed_with_gaps", // finished, but some pages could not be read (blocked / unreadable): the summary lists them
  FAILED: "failed", // stopped with a reason (billing, quota, repeated errors); Retry resumes from the page it reached
  CANCELLED: "cancelled",
  NOT_CONFIGURED: "not_configured", // no AI key on the server: a message, never an error
});
const SCAN_STATUSES = Object.values(SCAN_STATUS);
const OPEN_STATUSES = [SCAN_STATUS.QUEUED, SCAN_STATUS.SCANNING];
const FINISHED_STATUSES = [SCAN_STATUS.COMPLETED, SCAN_STATUS.COMPLETED_WITH_GAPS];

const SEVERITY = Object.freeze({ ERROR: "error", WARNING: "warning", INFO: "info" });
const SEVERITIES = Object.values(SEVERITY);

const CATEGORY = Object.freeze({
  TYPO: "typo", // spelling, repeated / missing words, wrong punctuation
  WRONG_NAME: "wrong_name", // a name that disagrees with the case's own data
  ADDRESS_MISMATCH: "address_mismatch", // a FedEx / filing / mailing address that disagrees with the expected one
  COMPANY_RULE: "company_rule", // wording that breaks a company rule (e.g. presenting Immiglance as a law firm)
  CONSISTENCY: "consistency", // dates, numbers, receipt numbers or facts that contradict each other
  UNREADABLE_PAGE: "unreadable_page", // the AI could not read this page (blocked / blank / unusable scan)
});
const CATEGORIES = Object.values(CATEGORY);

// What a Gemini call can end in (mapped from the raw reply by the Phase 2 caller and by scripts/diagnoseGemini.js).
const AI_ERROR = Object.freeze({
  NOT_CONFIGURED: "NOT_CONFIGURED",
  BILLING: "BILLING", // HTTP 402 - prepaid credits used up; never retried
  QUOTA: "QUOTA", // HTTP 429 - quota / rate limit; the run pauses
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
  BLOCKED: "BLOCKED",
  TRUNCATED: "TRUNCATED",
  TIMEOUT: "TIMEOUT",
  UPSTREAM: "UPSTREAM", // 5xx / network: retried with backoff
  BAD_REQUEST: "BAD_REQUEST", // 400 / 403 / 404 (bad key, unknown model): never retried
  BAD_OUTPUT: "BAD_OUTPUT", // JSON that does not match the schema
});
// Errors that stop the whole run (the next batch would fail the same way).
const RUN_STOPPING_ERRORS = [AI_ERROR.NOT_CONFIGURED, AI_ERROR.BILLING, AI_ERROR.QUOTA, AI_ERROR.BAD_REQUEST];

// Typed PDF problems (pdfSlicer).
const PDF_ERROR = Object.freeze({
  ENCRYPTED: "PDF_ENCRYPTED",
  UNREADABLE: "PDF_UNREADABLE",
  EMPTY: "PDF_EMPTY",
  SLICER_CRASHED: "PDF_SLICER_CRASHED",
  SLICER_TIMEOUT: "PDF_SLICER_TIMEOUT",
  BAD_RANGE: "PDF_BAD_RANGE",
  NOT_LOADED: "PDF_NOT_LOADED",
});

const LIMITS = Object.freeze({
  maxDiagnostics: 200, // per scan: the newest are kept
  findingsPageSize: 50,
  findingsMaxPageSize: 200,
  maxExcerptChars: 400,
  maxTextChars: 600,
  maxSectionChars: 120,
  maxSummaryItems: 300, // bullet items written into the summary; the rest stay in the findings list
  maxFindingsPerBatch: 60,
});

module.exports = { SCAN_STATUS, SCAN_STATUSES, OPEN_STATUSES, FINISHED_STATUSES, SEVERITY, SEVERITIES, CATEGORY, CATEGORIES, AI_ERROR, RUN_STOPPING_ERRORS, PDF_ERROR, LIMITS };
