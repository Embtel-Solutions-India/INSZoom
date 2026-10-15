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

module.exports = { checkUrl, normalizeUrl };
