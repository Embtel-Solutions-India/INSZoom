// Finds and downloads the official PDF of a form published outside uscis.gov (config/externalForms.js - today the two DOL ETA-9089 forms). The USCIS fetchers are NOT touched or loosened:
// they stay pinned to uscis.gov. This module has its own, equally strict rules, and they apply only to the forms in that data file:
//   - https only, host EXACTLY the entry's host (www.dol.gov, or dol.gov which redirects to it), no credentials, no IP literal, default port;
//   - every redirect hop is re-checked BEFORE it is requested (redirect: "manual"), with a hop limit, a timeout and a size cap (checked on the declared length AND while reading);
//   - a PDF must live under the official file directory; a page under /agencies/eta/; the content type must be what was asked for and a PDF must start with %PDF-;
//   - no cookies, and one honest identifying User-Agent (the same one the USCIS evidence fetcher uses). Nothing here imitates a browser or tries to get around a site's bot protection.
//
// TWO WAYS to the PDF (the first can answer HTTP 403 - a direct link is sometimes refused where the same file is reachable from the page that links it):
//   1. direct      the address stored from the last success, then the known official address;
//   2. forms_page  the official forms page is read and the CURRENT link whose FILE NAME starts with the form's prefix is used. This also finds the file after DOL renews the form and the
//                  expiry in its file name changes.
// If both fail the result says so precisely ({ ok:false, blocked, tried }) and the caller keeps the live edition serving; a person can then upload the PDF from the existing admin upload
// (the third way - never automatic). Never throws.
const { externalFormFor, fileNameOf, FILES_DIR } = require("../config/externalForms");

const USER_AGENT = "Immiglance-FormEditionEvidence/0b-1";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_STATUSES = new Set([401, 403, 429]);
const LIMITS = Object.freeze({ maxHops: 5, timeoutMs: 60 * 1000, pdfMaxBytes: 25 * 1024 * 1024, htmlMaxBytes: 5 * 1024 * 1024 });
const PAGE_PATH = "/agencies/eta/";

/** Pure. Is this a place the pipeline may request for this entry? { ok, violations, url } */
function checkExternalUrl(raw, entry, kind = "pdf") {
  let url;
  try { url = new URL(raw); } catch { return { ok: false, violations: ["invalid_url"], url: null }; }
  const violations = [];
  const host = url.hostname.toLowerCase();
  const apex = String(entry?.host || "").replace(/^www\./, "");
  if (url.protocol !== "https:") violations.push("not_https");
  if (!entry || (host !== entry.host && host !== apex)) violations.push("host_not_allowed");
  if (url.username || url.password) violations.push("credentials_in_url");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) violations.push("ip_literal");
  if (url.port && url.port !== "443") violations.push("non_default_port");
  const path = url.pathname;
  if (kind === "pdf" && !path.startsWith(FILES_DIR)) violations.push("path_not_official_file_directory");
  if (kind === "html" && !path.startsWith(PAGE_PATH)) violations.push("path_not_official_page");
  return { ok: violations.length === 0, violations, url };
}

async function readCapped(response, maxBytes) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { try { await reader.cancel(); } catch { /* closed */ } return { tooLarge: true }; }
      chunks.push(Buffer.from(value));
    }
    return { bytes: Buffer.concat(chunks, total) };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length > maxBytes ? { tooLarge: true } : { bytes: buffer };
}

/**
 * One safe GET of an official address. Resolves { ok, status, finalUrl, bytes?, blocked, error? }; never throws. `blocked` is true when the site refused the request (401 / 403 / 429).
 */
async function fetchExternal(rawUrl, entry, { kind = "pdf", fetchImpl = globalThis.fetch, maxHops = LIMITS.maxHops, timeoutMs = LIMITS.timeoutMs } = {}) {
  const result = { ok: false, status: null, finalUrl: null, blocked: false, error: null };
  const cap = kind === "pdf" ? LIMITS.pdfMaxBytes : LIMITS.htmlMaxBytes;
  const visited = new Set();
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= maxHops; hop += 1) {
      const check = checkExternalUrl(current, entry, kind === "html" && hop > 0 ? "html" : kind);
      if (!check.ok) { result.error = `address refused before any request (${check.violations.join(", ")})`; return result; }
      if (visited.has(check.url.href)) { result.error = "redirect loop"; return result; }
      visited.add(check.url.href);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(current, { method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal, headers: { "user-agent": USER_AGENT, accept: kind === "pdf" ? "application/pdf" : "text/html" } });
        result.status = response.status;
        const location = response.headers?.get?.("location") || null;
        if (REDIRECT_STATUSES.has(response.status) && location) {
          try { current = new URL(location, current).toString(); } catch { result.error = "invalid redirect address"; return result; }
          continue;
        }
        result.finalUrl = current;
        if (BLOCKED_STATUSES.has(response.status)) { result.blocked = true; result.error = `the official site refused the request (HTTP ${response.status})`; return result; }
        if (response.status < 200 || response.status >= 300) { result.error = `HTTP ${response.status}`; return result; }
        const type = String(response.headers?.get?.("content-type") || "").toLowerCase();
        if (!type.includes(kind === "pdf" ? "application/pdf" : "text/html")) { result.error = `unexpected content type "${type || "none"}"`; return result; }
        const declared = Number(response.headers?.get?.("content-length"));
        if (Number.isFinite(declared) && declared > cap) { result.error = "file larger than the allowed size"; return result; }
        const body = await readCapped(response, cap);
        if (body.tooLarge) { result.error = "file larger than the allowed size"; return result; }
        if (kind === "pdf" && body.bytes.subarray(0, 1024).indexOf("%PDF-") < 0) { result.error = "not a PDF (no %PDF- header)"; return result; }
        return { ...result, ok: true, bytes: body.bytes };
      } finally {
        clearTimeout(timer);
      }
    }
    result.error = "too many redirects";
    return result;
  } catch (error) {
    result.error = error?.name === "AbortError" ? "timed out" : String(error?.message || error).slice(0, 160);
    return result;
  }
}

const HREF = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
/** Pure. Every link of an HTML page as { url, text } (absolute, de-duplicated). */
function linksOf(html, baseUrl) {
  const out = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(HREF)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
    if (!href) continue;
    let url;
    try { url = new URL(href.replace(/&amp;/g, "&"), baseUrl).toString(); } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text: match[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() });
  }
  return out;
}

/**
 * Pure. The official PDF links on the forms page that belong to this form: the FILE NAME starts with the form's prefix (so the Professional Athletes "Form ETA-9089 - Appendix A - 508
 * Compliant" file never matches), listed best first (link text equals the form's title, then the newest-looking name).
 */
function candidateLinks(html, baseUrl, entry) {
  return linksOf(html, baseUrl)
    .filter((link) => /\.pdf(?:$|[?#])/i.test(link.url) && entry.filePrefix.test(fileNameOf(link.url)) && checkExternalUrl(link.url, entry, "pdf").ok)
    .sort((a, b) => Number(entry.linkText.test(b.text)) - Number(entry.linkText.test(a.text)) || fileNameOf(b.url).localeCompare(fileNameOf(a.url)));
}

/**
 * resolveExternalPdf({ formCode, template?, deps? }) -> { ok, via, pdfUrl, pageUrl, bytes, tried: [{ route, url, status, note }], blocked? , error? }
 * deps.fetchImpl replaces the network (tests). `only` ("direct" | "forms_page") runs a single way (the error-resolution catalog tries them one at a time). Never throws.
 */
async function resolveExternalPdf({ formCode, template = null, deps = {}, only = null } = {}) {
  const entry = externalFormFor(formCode);
  const tried = [];
  if (!entry) return { ok: false, via: null, tried, error: `"${formCode}" is not an external form` };
  const fetchOpts = { fetchImpl: deps.fetchImpl || globalThis.fetch, timeoutMs: deps.timeoutMs };
  let blocked = false;
  const note = (route, url, result, text) => { tried.push({ route, url, status: result?.status ?? null, note: text || result?.error || "ok" }); if (result?.blocked) blocked = true; };

  // way 1: the direct address - the one stored from the last success, then the known official one
  const stored = [template?.officialPdfUrl, template?.lifecycle?.sourcePdfUrl, template?.importMetadata?.sourcePdfUrl].filter((url) => url && entry.filePrefix.test(fileNameOf(url)) && checkExternalUrl(url, entry, "pdf").ok);
  const direct = [...new Set([...stored, entry.knownPdfUrl])];
  for (const url of only === "forms_page" ? [] : direct) {
    const result = await fetchExternal(url, entry, { kind: "pdf", ...fetchOpts });
    note("direct", url, result, result.ok ? "pdf verified" : undefined);
    if (result.ok) return { ok: true, via: "direct", pdfUrl: result.finalUrl || url, pageUrl: entry.pageUrl, bytes: result.bytes, tried };
  }

  // way 2: the official forms page - its CURRENT link for this form (survives a renewal that changes the file name; reachable even when the direct address answers 403)
  const page = only === "direct" ? { ok: false, error: "not tried" } : await fetchExternal(entry.pageUrl, entry, { kind: "html", ...fetchOpts });
  if (only !== "direct") note("forms_page", entry.pageUrl, page, page.ok ? "page read" : undefined);
  if (page.ok) {
    const links = candidateLinks(Buffer.from(page.bytes).toString("utf8"), page.finalUrl || entry.pageUrl, entry);
    if (!links.length) tried.push({ route: "forms_page", url: entry.pageUrl, status: page.status, note: `no link whose file name starts with ${entry.filePrefix.source}` });
    for (const link of links) {
      if (only !== "forms_page" && direct.includes(link.url)) continue; // the very same address was already refused above: do not repeat it
      const result = await fetchExternal(link.url, entry, { kind: "pdf", ...fetchOpts });
      note("forms_page", link.url, result, result.ok ? "pdf verified" : undefined);
      if (result.ok) return { ok: true, via: "forms_page", pdfUrl: result.finalUrl || link.url, pageUrl: page.finalUrl || entry.pageUrl, bytes: result.bytes, tried };
    }
  }
  const error = blocked
    ? `The official site refused the automatic download of ${entry.formCode} (HTTP 401/403/429) by every route tried; the live edition keeps serving. Upload the PDF from the admin form upload to continue.`
    : `Could not locate the official PDF of ${entry.formCode} (${tried.map((step) => `${step.route}: ${step.note}`).join("; ")})`;
  return { ok: false, via: null, pageUrl: entry.pageUrl, tried, blocked, error, code: blocked ? "EXTERNAL_SOURCE_BLOCKED" : "EXTERNAL_SOURCE_UNRESOLVED" };
}

module.exports = { checkExternalUrl, fetchExternal, linksOf, candidateLinks, resolveExternalPdf, LIMITS, USER_AGENT };
