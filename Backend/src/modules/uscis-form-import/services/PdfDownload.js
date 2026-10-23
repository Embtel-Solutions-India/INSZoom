// Phase 7.2: the hardened PDF download used by the USCIS importer when FORM_PIPELINE_AUTONOMY is "on". With the switch off the importer uses its original fetchPdf
// unchanged; in "shadow" it only LOGS what this module would have done to the bytes the original download returned.
//
// What it adds over the original download:
//   - every hop of every redirect is checked BEFORE it is requested (https, uscis.gov / *.uscis.gov only), with a timeout and a size cap (OfficialSourceFetcher);
//   - an HTML page (or any non-PDF) served in place of the PDF is detected and the address is resolved ONCE more through a supplied callback, never guessed;
//   - junk before the %PDF- header (within the first 1024 bytes) is trimmed and the result re-checked;
//   - a truncated file (no %%EOF near the end) is downloaded once more; if it is still truncated the error says so (cause pdf_damaged).
// It parses nothing: many real USCIS PDFs cannot be loaded by pdf-lib until qpdf has normalized them, so the structure check stays in the importer after normalization.
const { fetchOfficialSource } = require("../../form-edition-policy/OfficialSourceFetcher");

const HEADER = Buffer.from("%PDF-");
const EOF_MARK = Buffer.from("%%EOF");
const JUNK_WINDOW = 1024;
const EOF_WINDOW = 2048;

const maxBytes = (env = process.env) => {
  const value = Number(env.USCIS_PDF_MAX_BYTES);
  return Number.isFinite(value) && value > 0 ? value : 50 * 1024 * 1024;
};
const timeoutMs = (env = process.env) => {
  const value = Number(env.USCIS_PDF_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 60 * 1000;
};

function codedError(message, status, code, cause) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

/** Pure. { ok, buffer, trimmed, problem } - the bytes cut to start at %PDF- (when the header is within the first 1024 bytes). */
function trimLeadingJunk(buffer) {
  if (!Buffer.isBuffer(buffer)) return { ok: false, problem: "not_a_buffer" };
  const at = buffer.subarray(0, JUNK_WINDOW).indexOf(HEADER);
  if (at < 0) return { ok: false, problem: "no_pdf_header" };
  return { ok: true, buffer: at === 0 ? buffer : buffer.subarray(at), trimmed: at };
}

/** Pure. A PDF that was cut off in transit has no %%EOF marker near its end. */
function looksComplete(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
  return buffer.subarray(Math.max(0, buffer.length - EOF_WINDOW)).indexOf(EOF_MARK) >= 0;
}

/** Pure. What would be done to these bytes: { header, trimmed, complete }. Used by the shadow log and by the tests. */
function inspect(buffer) {
  const trim = trimLeadingJunk(buffer);
  if (!trim.ok) return { header: false, trimmed: 0, complete: false, problem: trim.problem };
  return { header: true, trimmed: trim.trimmed, complete: looksComplete(trim.buffer) };
}

const withBuster = (url, attempt) => {
  const parsed = new URL(url);
  parsed.searchParams.set("_dl", String(attempt));
  return parsed.toString();
};

/**
 * Downloads `url` through the hardened fetcher. deps: { fetcher, reresolve(url) -> url|null, env }.
 * Resolves { buffer, contentType, contentLength, downloadedAt, notes[] } (the same fields the original download returned, plus what was repaired).
 * Throws errors with the same codes the importer already uses (PDF_DOWNLOAD_FAILED, DOWNLOADED_RESOURCE_NOT_PDF, INVALID_PDF_URL, UNSUPPORTED_PDF_SOURCE) plus PDF_TOO_LARGE and PDF_TRUNCATED.
 */
async function fetchPdf(url, deps = {}) {
  try {
    return await fetchPdfInner(url, deps);
  } catch (error) {
    if (error && !error.sourceUrl) error.sourceUrl = url; // the address that failed: the resolution strategies retry or replace exactly this one
    throw error;
  }
}

async function fetchPdfInner(url, deps) {
  const fetcher = deps.fetcher || fetchOfficialSource;
  const env = deps.env || process.env;
  const notes = [];
  const baseOptions = { accept: "pdf", maxBytes: maxBytes(env) };
  const options = { ...baseOptions, timeoutMs: timeoutMs(env) };

  const once = async (address) => {
    // a longer timeout the error-resolution engine proved works for this address (in memory, expires): used for the retry of that same address (also its cache-busting form)
    const result = await fetcher(address, { ...baseOptions, timeoutMs: resolveTimeoutHint(address) || options.timeoutMs });
    if (result.ok) return result;
    const violation = (result.violations || [])[0];
    if (violation && ["invalid_url", "not_https", "host_not_uscis", "credentials_in_url", "ip_literal", "non_default_port"].includes(violation.type)) {
      throw codedError("Only official USCIS PDF URLs are supported", 400, ["invalid_url", "not_https"].includes(violation.type) ? "INVALID_PDF_URL" : "UNSUPPORTED_PDF_SOURCE");
    }
    if (violation?.type === "size_over_cap") throw codedError(`The USCIS PDF is larger than ${options.maxBytes} bytes`, 413, "PDF_TOO_LARGE");
    if (violation?.type === "content_type_not_allowed") return { notPdf: true, contentType: result.contentType, status: result.status };
    if (result.status && (result.status < 200 || result.status >= 300)) throw codedError(`Failed to download USCIS PDF: ${result.status}`, 502, "PDF_DOWNLOAD_FAILED");
    throw codedError(`Failed to download USCIS PDF: ${result.error || (violation ? violation.type : "no response")}`, 502, "PDF_DOWNLOAD_FAILED");
  };

  let address = url;
  let viaLegacy = false;
  let result = await once(address);
  // a server that labels the PDF "application/octet-stream" (or sends no type) is accepted by the original download today; the hardened fetcher accepts only application/pdf,
  // so for exactly those labels the original download answers (same host rules) and its bytes get the same checks below - an import that works today never starts failing
  if (result.notPdf && (!result.contentType || /octet-stream/i.test(result.contentType)) && typeof deps.legacy === "function") {
    const legacy = await deps.legacy(address);
    result = { bytes: legacy.buffer, contentType: legacy.contentType };
    viaLegacy = true;
    notes.push("served as " + (legacy.contentType || "an unlabeled file") + "; accepted after the header check");
  }
  // an HTML page or another non-PDF in place of the file: resolve the address once more (verified by the caller), never guess
  if (result.notPdf) {
    const next = typeof deps.reresolve === "function" ? await Promise.resolve(deps.reresolve(address)).catch(() => null) : null;
    if (!next || next === address) throw codedError("Downloaded resource is not a PDF", 400, "DOWNLOADED_RESOURCE_NOT_PDF", "not_a_pdf");
    notes.push(`address resolved again: ${next}`);
    address = next;
    result = await once(address);
    if (result.notPdf) throw codedError("Downloaded resource is not a PDF", 400, "DOWNLOADED_RESOURCE_NOT_PDF", "not_a_pdf");
  }

  let buffer = result.bytes;
  const trim = trimLeadingJunk(buffer);
  if (!trim.ok) throw codedError("Downloaded resource is not a PDF", 400, "DOWNLOADED_RESOURCE_NOT_PDF", "not_a_pdf");
  if (trim.trimmed) { buffer = trim.buffer; notes.push(`trimmed ${trim.trimmed} bytes before the PDF header`); }

  // cut off in transit: one more download of the same address (cache-busting query), then a precise error
  if (!looksComplete(buffer)) {
    const again = viaLegacy ? { bytes: (await deps.legacy(withBuster(address, 1))).buffer } : await once(withBuster(address, 1));
    const retrimmed = again.bytes ? trimLeadingJunk(again.bytes) : { ok: false };
    if (retrimmed.ok && looksComplete(retrimmed.buffer)) {
      buffer = retrimmed.buffer;
      notes.push("the first download was cut off; downloaded again");
    } else if (retrimmed.ok && retrimmed.buffer.length === buffer.length && retrimmed.buffer.equals(buffer) && buffer.indexOf(EOF_MARK) >= 0) {
      // identical on both downloads AND an end-of-file marker exists earlier in the file: the server really serves this file (some valid PDFs carry more than 2 KB after the last %%EOF) - not a
      // transfer problem, do not block. A file with NO %%EOF anywhere is a cut-off file: the same cut-off twice is still cut off and fails here, with its real cause, not later as "no fillable fields".
      notes.push("no end-of-file marker near the end, but both downloads are identical and carry an earlier marker; accepted");
    } else {
      throw codedError("The downloaded PDF is incomplete (no end-of-file marker) after a second download", 502, "PDF_TRUNCATED", "pdf_damaged");
    }
  }
  return { buffer, contentType: result.contentType || "application/pdf", contentLength: buffer.length, downloadedAt: new Date(), notes };
}

/**
 * Pure. Does this (qpdf-normalized, so uncompressed) PDF look like an XFA-only dynamic form: an /XFA layer and no AcroForm fields? { xfaOnly, hasXfa, hasAcroForm, emptyFields }.
 * A byte check only; it never decides anything by itself - the importer calls it before the scan (no /AcroForm at all) and when the scan has ALREADY found zero fields.
 */
function detectXfaOnly(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("latin1") : "";
  const hasXfa = /\/XFA\b/.test(text);
  const hasAcroForm = /\/AcroForm\b/.test(text);
  const emptyFields = /\/Fields\s*\[\s*\]/.test(text) || !/\/Fields\b/.test(text);
  return { xfaOnly: hasXfa && emptyFields, hasXfa, hasAcroForm, emptyFields };
}

// One-shot hints the error-resolution engine leaves for the retry of an import (in memory, per process, they expire): "normalize this form with the JavaScript normalizer" and
// "download this address instead". The importer consults them ONLY when FORM_PIPELINE_AUTONOMY is "on".
const HINT_TTL_MS = 30 * 60 * 1000;
const fallbackHints = new Map();
const urlHints = new Map();
const fresh = (map, key, now = Date.now()) => { const hit = map.get(key); if (!hit) return null; if (now - hit.at > HINT_TTL_MS) { map.delete(key); return null; } return hit; };
const codeKey = (formCode) => String(formCode || "").trim().toUpperCase();

function markFallbackNormalize(formCode, now = Date.now()) { if (codeKey(formCode)) fallbackHints.set(codeKey(formCode), { at: now }); }
/** True once per mark: the retry of that form's import uses the verified JavaScript normalizer instead of qpdf. */
function consumeFallbackNormalize(formCode, now = Date.now()) { const hit = fresh(fallbackHints, codeKey(formCode), now); if (hit) fallbackHints.delete(codeKey(formCode)); return Boolean(hit); }
// "use a longer timeout for this address" (the slow-server fix): a hint the retry of the download reads; per address, in memory, expires
const timeoutHints = new Map();
const hintKey = (url) => String(url).replace(/([?&])_dl=\d+&?/, "$1").replace(/[?&]$/, "");
function setTimeoutHint(url, ms, now = Date.now()) { if (url && Number(ms) > 0) timeoutHints.set(hintKey(url), { at: now, ms: Number(ms) }); }
function resolveTimeoutHint(url, now = Date.now()) { const hit = fresh(timeoutHints, hintKey(url), now); return hit ? hit.ms : null; }
function setUrlOverride(fromUrl, toUrl, now = Date.now()) { if (fromUrl && toUrl) urlHints.set(String(fromUrl), { at: now, to: String(toUrl) }); }
function resolveUrlOverride(url, now = Date.now()) { const hit = fresh(urlHints, String(url), now); return hit ? hit.to : url; }
function clearHints() { fallbackHints.clear(); urlHints.clear(); timeoutHints.clear(); }

module.exports = { setTimeoutHint, resolveTimeoutHint, markFallbackNormalize, consumeFallbackNormalize, setUrlOverride, resolveUrlOverride, clearHints, detectXfaOnly, fetchPdf, trimLeadingJunk, looksComplete, inspect, withBuster, maxBytes, timeoutMs };
