// The only way the news module talks to the network. Every URL (the feed, an article, each redirect hop) must be https on an allowlisted uscis.gov host with no credentials
// and no custom port, so a feed entry or an article link can never make the server call an internal address (SSRF). Requests are paced (robots.txt Crawl-delay), time-boxed,
// size-capped, conditional where the source supports it, and transient failures are retried with bounded exponential backoff. Nothing here throws anything but UscisHttpError.
const { getConfig, ALLOWED_HOSTS } = require("./news.config");

class UscisHttpError extends Error {
  constructor(message, { status = 0, permanent = false, retryable = false } = {}) {
    super(message);
    this.name = "UscisHttpError";
    this.status = status;
    this.permanent = permanent; // retrying can never help (404, 410, a rejected URL, an oversized body)
    this.retryable = retryable;
  }
}

/** Returns the normalised URL string, or null when it is not an acceptable uscis.gov address. */
function safeUscisUrl(input, base) {
  try {
    const url = new URL(String(input || "").trim(), base);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (!ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) return null;
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `overrides` (fetchImpl, sleep, now, config) exist for tests; production calls createClient() with none. */
function createClient(overrides = {}) {
  const config = { ...getConfig(), ...(overrides.config || {}) };
  const fetchImpl = overrides.fetchImpl || ((...args) => fetch(...args));
  const sleep = overrides.sleep || defaultSleep;
  const now = overrides.now || (() => Date.now());
  let lastRequestAt = 0;

  async function pace() {
    const wait = lastRequestAt + config.requestDelayMs - now();
    if (lastRequestAt && wait > 0) await sleep(wait);
    lastRequestAt = now();
  }

  async function readCapped(response) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > config.maxBytes) throw new UscisHttpError("The response is larger than the allowed size", { permanent: true });
    if (!response.body || typeof response.body.getReader !== "function") {
      const text = await response.text();
      if (Buffer.byteLength(text) > config.maxBytes) throw new UscisHttpError("The response is larger than the allowed size", { permanent: true });
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > config.maxBytes) {
        await reader.cancel().catch(() => {});
        throw new UscisHttpError("The response is larger than the allowed size", { permanent: true });
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }

  async function once(url, { etag, lastModified, accept }) {
    let current = safeUscisUrl(url);
    if (!current) throw new UscisHttpError("The address is not an allowed uscis.gov address", { permanent: true });
    for (let hop = 0; hop <= 3; hop += 1) {
      await pace();
      const headers = { "User-Agent": config.userAgent, Accept: accept || "text/html,application/xhtml+xml,application/xml;q=0.9", "Accept-Language": "en-US,en;q=0.8" };
      if (hop === 0 && etag) headers["If-None-Match"] = etag;
      if (hop === 0 && lastModified) headers["If-Modified-Since"] = lastModified;
      let response;
      try {
        response = await fetchImpl(current, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(config.requestTimeoutMs) });
      } catch (error) {
        throw new UscisHttpError(`Network error: ${error?.name === "TimeoutError" ? "request timed out" : error?.cause?.code || error?.message || "request failed"}`, { retryable: true });
      }
      const status = response.status;
      if (status === 304) return { status, notModified: true, text: "", url: current, etag: etag || "", lastModified: lastModified || "" };
      if ([301, 302, 303, 307, 308].includes(status)) {
        const next = safeUscisUrl(response.headers.get("location"), current);
        if (!next) throw new UscisHttpError("Redirected to an address that is not allowed", { status, permanent: true });
        current = next;
        continue;
      }
      if (status >= 200 && status < 300) {
        const text = await readCapped(response);
        return { status, notModified: false, text, url: current, etag: response.headers.get("etag") || "", lastModified: response.headers.get("last-modified") || "", contentType: response.headers.get("content-type") || "" };
      }
      if (status === 429 || status >= 500) {
        const error = new UscisHttpError(`USCIS answered HTTP ${status}`, { status, retryable: true });
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(retryAfter * 1000, 5 * 60 * 1000);
        throw error;
      }
      throw new UscisHttpError(`USCIS answered HTTP ${status}`, { status, permanent: status === 404 || status === 410 || status === 403 || status === 401 });
    }
    throw new UscisHttpError("Too many redirects", { permanent: true });
  }

  /** GET with bounded retries (exponential: 2 s, 4 s, 8 s ... capped at 60 s). Resolves with { status, notModified, text, url, etag, lastModified }. */
  async function get(url, options = {}) {
    let attempt = 0;
    for (;;) {
      try {
        return await once(url, options);
      } catch (error) {
        if (!(error instanceof UscisHttpError)) throw new UscisHttpError(error?.message || "Request failed", { retryable: false });
        if (!error.retryable || attempt >= config.maxRetries) throw error;
        attempt += 1;
        await sleep(error.retryAfterMs || Math.min(2000 * 2 ** (attempt - 1), 60 * 1000));
      }
    }
  }

  return { get, config };
}

module.exports = { createClient, safeUscisUrl, UscisHttpError };
