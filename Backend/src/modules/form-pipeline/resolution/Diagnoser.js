// Phase 7.E - diagnose before retrying. Turns a raw failure into a precise diagnosis with evidence instead of a class guess:
//   { signature, cause, code, stage, evidence: [short strings], fixable, reasonCode }
// The signature is a stable hash of (stage, code, message with numbers / paths / ids normalized away), so the same failure on another form or another day
// has the same signature and finds the solution that worked before.
//
// An ENOENT is NEVER assumed to mean "the tool is missing": the diagnosis records whether the configured path exists and (when a probe is available) whether the tool
// runs, so a stale process, a missing temp file and a missing tool are told apart in the evidence. Pure apart from those two injectable checks.
const crypto = require("crypto");
const fs = require("fs");

const CAUSES = Object.freeze(["tool_unavailable", "source_not_found", "network", "not_a_pdf", "pdf_damaged", "pdf_encrypted", "xfa_or_no_fields", "template_too_large", "scan_field_exception", "cert_failed", "promotion_busy", "migration_failed", "programming_error", "unknown"]);

// the hold reason shown to people (and stored on the job) for each cause
const REASON_CODES = Object.freeze({
  tool_unavailable: "TOOL_UNAVAILABLE", source_not_found: "NO_OFFICIAL_SOURCE", network: "NETWORK_UNAVAILABLE", not_a_pdf: "PDF_UNREADABLE", pdf_damaged: "PDF_UNREADABLE", pdf_encrypted: "PDF_UNREADABLE",
  xfa_or_no_fields: "NO_FILLABLE_FIELDS", template_too_large: "TEMPLATE_TOO_LARGE", scan_field_exception: "SCAN_FAILED", cert_failed: "CERTIFICATION_FAILED", promotion_busy: "PROMOTION_BUSY",
  migration_failed: "MIGRATION_FAILED", programming_error: "PROGRAMMING_ERROR", unknown: "UNRESOLVED_ERROR",
});

// causes that are usually a passing blip: the job's own backoff retries them first; they become a documented hold only when the attempts are used up
const RETRY_FIRST_CAUSES = Object.freeze(["network", "promotion_busy", "unknown"]);

const text = (error) => String(error?.message ?? error ?? "");
const statusOf = (error) => Number(error?.statusCode || error?.status || error?.response?.status || 0) || 0;
const httpStatusInMessage = (message) => { const match = /(?:failed|status|http)[^0-9]{0,12}(\d{3})\b/i.exec(message) || /\b(404|429|50[0-9])\b/.exec(message); return match ? Number(match[1]) : 0; };

/** The message with everything that varies between occurrences removed: quoted text, paths, hex / uuid ids, numbers. */
function normalizeMessage(value) {
  return String(value || "")
    .split(/\r?\n/)[0]
    .toLowerCase()
    .replace(/"[^"]*"|'[^']*'/g, "<q>")
    .replace(/[a-z]:\\[^\s"']+|\/[^\s"']*\/[^\s"']+/g, "<path>")
    .replace(/\b[0-9a-f]{8,}\b/g, "<id>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function signatureOf({ stage, code, message }) {
  return crypto.createHash("sha1").update(`${stage || ""}|${code || ""}|${normalizeMessage(message)}`).digest("hex").slice(0, 16);
}

/** The tool path the failing message names (`looked for "<path>"`), else the configured one. */
function toolPathOf(error, deps) {
  const named = /looked for "([^"]+)"/i.exec(text(error));
  return named?.[1] || deps.configuredToolPath?.() || process.env.QPDF_PATH || "";
}

function defaultDeps(deps = {}) {
  return {
    exists: deps.exists || ((target) => { try { return Boolean(target) && fs.existsSync(target); } catch { return false; } }),
    // optional, synchronous, short: does the tool run? Default is "not tried" so a diagnosis never spawns a process unless a caller asks for it.
    probeTool: deps.probeTool || null,
    configuredToolPath: deps.configuredToolPath || null,
  };
}

function causeOf({ error, stage, message, code, status }) {
  const name = String(error?.name || "");
  if ((error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError || ["TypeError", "ReferenceError", "SyntaxError"].includes(name)) && !code && !/fetch failed|network|socket|terminated/i.test(message)) return "programming_error";
  if (code === "QPDF_NOT_FOUND" || /qpdf binary not found/i.test(message) || (code === "ENOENT" && (error?.syscall === "spawn" || /\bspawn\b/i.test(message))) || /spawn .* ENOENT/i.test(message)) return "tool_unavailable";
  if (code === "ENOENT") return "tool_unavailable"; // ambiguous: the evidence says whether the path / temp file exists
  if (status === 404 || /\b404\b/.test(message) || ["USCIS_PDF_UNRESOLVED", "USCIS_FORM_NOT_STANDALONE", "NO_OFFICIAL_SOURCE"].includes(code) || /could not locate a current pdf|no official (?:source|pdf)/i.test(message)) return "source_not_found";
  if (code === "NORMALIZE_INPUT_NOT_PDF" || /expects a pdf buffer|not a pdf|html instead of|invalid pdf header/i.test(message)) return "not_a_pdf";
  if (code === "PDF_ENCRYPTED" || /\b(user password|owner password|encrypted)\b/i.test(message)) return "pdf_encrypted";
  if (code === "NORMALIZED_SCAN_EMPTY_FIELDS" || /no form fields|zero fields|no fillable|xfa/i.test(message)) return "xfa_or_no_fields";
  if (/BSONObj size|bson|16 ?mb|document is larger than|exceeds the maximum document/i.test(message) || code === "TEMPLATE_TOO_LARGE") return "template_too_large";
  if (code === "SCAN_FIELD_EXCEPTION" || (/^(import|scan|map)$/i.test(stage || "") && /\bfield\b.*\b(failed|error|exception|could not)\b/i.test(message))) return "scan_field_exception";
  if (code === "PIPELINE_CERTIFICATION_FAILED" || code === "CERTIFICATION_FAILED" || Array.isArray(error?.failedChecks) || stage === "certify") return "cert_failed";
  if (code === "PROMOTION_BUSY") return "promotion_busy";
  if (stage === "migrate_cases" || /^MIGRATION_/.test(code)) return "migration_failed";
  if (code === "PDF_DAMAGED" || /qpdf normalization failed|xref|truncated|damaged|exit code 2|corrupt|malformed|unexpected eof/i.test(message)) return "pdf_damaged";
  if (/^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR)/.test(code) || [408, 425, 429].includes(status) || status >= 500 || /timeout|timed out|socket hang up|fetch failed|network|temporarily|rate limit|too many requests|service unavailable|bad gateway/i.test(message) || name === "AbortError") return "network";
  return "unknown";
}

/**
 * @param error  the thrown value
 * @param stage  the pipeline stage it failed in (detect, import, map, ...)
 * @param job    the job (used only for the form code in the evidence)
 * @param deps   { exists(path), probeTool(path) -> boolean, configuredToolPath() } (tests)
 */
function diagnose({ error, stage = null, job = null, deps = {} } = {}) {
  const d = defaultDeps(deps);
  const message = text(error);
  const code = String(error?.code || "");
  const status = statusOf(error) || httpStatusInMessage(message);
  const cause = causeOf({ error, stage, message, code, status });
  const evidence = [];
  if (job?.formCode) evidence.push(`form ${job.formCode}`);
  if (stage) evidence.push(`stage ${stage}`);
  if (code) evidence.push(`code ${code}`);
  if (status) evidence.push(`http status ${status}`);
  if (error?.syscall) evidence.push(`syscall ${error.syscall}`);

  if (cause === "tool_unavailable") {
    const toolPath = toolPathOf(error, d);
    if (toolPath) {
      const present = d.exists(toolPath);
      evidence.push(`configured tool path ${present ? "exists" : "does not exist"}`);
      if (present && d.probeTool) {
        let runs = null;
        try { runs = Boolean(d.probeTool(toolPath)); } catch { runs = false; }
        evidence.push(`tool ${runs ? "runs" : "does not run"} when probed now`);
        if (runs) evidence.push("the failing process probably started before the tool was installed or with a stale environment");
      }
    } else {
      evidence.push("no tool path is configured");
    }
  }
  const signature = signatureOf({ stage, code: code || cause, message });
  return { signature, cause, code: code || cause.toUpperCase(), stage, evidence: evidence.slice(0, 12), fixable: cause !== "programming_error", reasonCode: REASON_CODES[cause] || REASON_CODES.unknown, retryFirst: RETRY_FIRST_CAUSES.includes(cause) };
}

module.exports = { diagnose, signatureOf, normalizeMessage, CAUSES, REASON_CODES, RETRY_FIRST_CAUSES };
