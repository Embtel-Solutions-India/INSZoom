// The ONE definition of "an acceptable place to send a request for official USCIS evidence" (plan Rule H). Used by the evidence fetcher and by the
// Release 0a redirect-chain crawl, so what the crawl proved safe is exactly what the fetcher enforces.

/**
 * Pure. Is this url somewhere the system may send a request? Nothing is requested here.
 * Returns { ok, violations: [...], url } - ok only for https, host uscis.gov or *.uscis.gov, no credentials, no IP literal, default port.
 */
function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, violations: ["invalid_url"], url: null };
  }
  const violations = [];
  if (url.protocol !== "https:") violations.push("not_https");
  const host = url.hostname.toLowerCase();
  if (host !== "uscis.gov" && !host.endsWith(".uscis.gov")) violations.push("host_not_uscis");
  if (url.username || url.password) violations.push("credentials_in_url");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) violations.push("ip_literal");
  if (url.port && url.port !== "443") violations.push("non_default_port");
  return { ok: violations.length === 0, violations, url };
}

/** A url reduced to what identifies a request (used to detect redirect loops). */
const normalizeUrl = (url) => `${url.protocol}//${url.host}${url.pathname}${url.search}`;

const FORMS_BASE = "https://www.uscis.gov/sites/default/files/document/forms/";

/**
 * Pure. The stable uscis.gov addresses of a form's own PDF, most likely first: the template's known one, then "<code>.pdf" ("i-130a.pdf", "i-539a.pdf") and, for a
 * lettered supplement of a form, "<form>sup<letter>.pdf" ("i-485supj.pdf"); "I-918 SUPPLEMENT A" becomes "i-918supa.pdf". Nothing is requested here.
 */
function officialPdfCandidates(formCode, knownUrl) {
  const out = knownUrl ? [knownUrl] : [];
  const compact = String(formCode || "").trim().toLowerCase().replace(/\s*supplement\s*/g, "sup").replace(/\s+/g, "");
  if (/^[a-z]{1,3}-\d+[a-z]*$/.test(compact)) {
    out.push(`${FORMS_BASE}${compact}.pdf`);
    const lettered = compact.match(/^([a-z]{1,3}-\d+)([a-z])$/);
    if (lettered) out.push(`${FORMS_BASE}${lettered[1]}sup${lettered[2]}.pdf`);
  }
  return [...new Set(out)];
}

module.exports = { checkUrl, normalizeUrl, officialPdfCandidates, FORMS_BASE };
