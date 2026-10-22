// Pure: decides what a failure means for a pipeline job, and produces the sanitized message that may be stored, logged or emailed
// (no stack traces, no secrets, no connection strings, no client data). Nothing here touches a database or the network.
const { ERROR_CLASSES, LIMITS } = require("./pipeline.constants");

class LeaseLostError extends Error {
  constructor(message = "The pipeline job lease was lost to another worker") {
    super(message);
    this.name = "LeaseLostError";
    this.code = "PIPELINE_LEASE_LOST";
  }
}

const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"]);
const BLOCKED_CODES = new Set(["USCIS_PDF_UNRESOLVED", "USCIS_FORM_NOT_STANDALONE", "USCIS_PDF_INVALID", "PDF_INVALID", "PDF_ENCRYPTED",
  // Phase 7.2: our own import refused the file for a reason retrying the same bytes cannot change (the resolution engine looks for another way; the job retries slowly)
  "NORMALIZE_INPUT_NOT_PDF", "NORMALIZED_SCAN_EMPTY_FIELDS", "TEMPLATE_TOO_LARGE", "DOWNLOADED_RESOURCE_NOT_PDF", "PDF_TOO_LARGE"]);
const BLOCKED_MESSAGE = /\b(invalid pdf|not a pdf|corrupt|malformed|encrypted|qpdf normalization failed|no fillable|no form fields|could not locate a current pdf|pdf is empty|unsupported pdf)\b/i;
const TRANSIENT_MESSAGE = /\b(timeout|timed out|socket hang up|network|fetch failed|temporarily|rate limit|too many requests|service unavailable|bad gateway|gateway timeout|econn|aborted)\b/i;

const statusOf = (error) => Number(error?.statusCode || error?.status || error?.response?.status || 0) || 0;

// Phase 7.E: causes the resolution engine diagnoses that are never "try again later" blips: they are documented holds (TOOL_UNAVAILABLE, NO_OFFICIAL_SOURCE, ...)
const DIAGNOSED_HOLD_CAUSES = new Set(["tool_unavailable", "source_not_found", "not_a_pdf", "pdf_damaged", "pdf_encrypted", "xfa_or_no_fields", "template_too_large", "scan_field_exception", "cert_failed", "migration_failed"]);

/**
 * { class, code, retryable } for an error thrown anywhere in the pipeline.
 * `diagnosis` (optional, from the resolution engine, only passed when the autonomy switch is on): a diagnosed cause above becomes a HELD documented hold instead of
 * a blind retry; without it the classification is exactly what it always was.
 */
function classifyError(error, diagnosis = null) {
  const code = String(error?.code || "");
  if (diagnosis && DIAGNOSED_HOLD_CAUSES.has(diagnosis.cause)) return { class: ERROR_CLASSES.HELD, code: diagnosis.reasonCode || String(diagnosis.cause).toUpperCase(), retryable: false, diagnosed: true };
  const status = statusOf(error);
  const name = String(error?.name || "");
  if (error instanceof LeaseLostError || code === "PIPELINE_LEASE_LOST") return { class: ERROR_CLASSES.LEASE_LOST, code: "PIPELINE_LEASE_LOST", retryable: false };
  if (name === "EditionPolicyHeldError" || code === "EDITION_POLICY_HELD") return { class: ERROR_CLASSES.HELD, code: "EDITION_POLICY_HELD", retryable: false };
  if (code === "PIPELINE_REPAIRABLE" || error?.repairable) return { class: ERROR_CLASSES.REPAIRABLE, code: code || "PIPELINE_REPAIRABLE", retryable: true };
  if (BLOCKED_CODES.has(code) || (status >= 400 && status < 500 && ![401, 403, 408, 425, 429].includes(status) && (status !== 409 || BLOCKED_MESSAGE.test(String(error?.message))))) {
    return { class: ERROR_CLASSES.BLOCKED, code: code || `HTTP_${status}`, retryable: false };
  }
  if (BLOCKED_MESSAGE.test(String(error?.message || ""))) return { class: ERROR_CLASSES.BLOCKED, code: code || "INPUT_INVALID", retryable: false };
  if (name === "AbortError" || TRANSIENT_CODES.has(code) || [408, 425, 429].includes(status) || status >= 500 || TRANSIENT_MESSAGE.test(String(error?.message || "")) || error?.code === 11000) {
    return { class: ERROR_CLASSES.TRANSIENT, code: code || (status ? `HTTP_${status}` : name || "TRANSIENT"), retryable: true };
  }
  // unknown: retried a bounded number of times (the attempt limit turns a repeated unknown failure into dead_letter)
  return { class: ERROR_CLASSES.TRANSIENT, code: code || name || "UNKNOWN", retryable: true, unknown: true };
}

/** Message safe to store and email: one line, no stack, no secrets / connection strings / tokens, at most 300 characters. */
function sanitizeMessage(value) {
  let text = String(value?.message ?? value ?? "").split(/\r?\n/)[0];
  text = text
    .replace(/mongodb(\+srv)?:\/\/[^\s"']+/gi, "[database-uri]")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/([?&](?:key|token|api[_-]?key|access[_-]?token|signature|sig|password|secret)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*(?:(?:bearer|basic)\s+)?\S+/gi, "$1=[redacted]")
    .replace(/\bkey=(?!\[redacted\])[^\s&]+/gi, "key=[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

/** Retry delay for the Nth attempt: exponential from the base, capped, with +/- jitter so jobs that failed together do not retry together. */
function backoffMs(attempt, { base = LIMITS.backoffBaseMs, max = LIMITS.backoffMaxMs, jitter = 0.2, random = Math.random } = {}) {
  const exponent = Math.max(0, Number(attempt || 1) - 1);
  const raw = Math.min(max, base * 2 ** exponent);
  const spread = raw * jitter * (random() * 2 - 1);
  return Math.max(1000, Math.round(raw + spread));
}

/** Stable text for "the same failure again" (dedupes alerts): stage + class + code. */
const errorSignature = ({ stage, classification }) => `${stage || "?"}|${classification.class}|${classification.code}`;

module.exports = {
  DIAGNOSED_HOLD_CAUSES, LeaseLostError, classifyError, sanitizeMessage, backoffMs, errorSignature };
