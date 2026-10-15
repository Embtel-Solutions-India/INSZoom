// Plan Rule H: the redirect-safe fetcher for official evidence. Unlike the existing fetchers (which check only the first url and then follow
// redirects automatically) this one uses redirect: "manual" and re-validates EVERY hop BEFORE requesting it: https only, host uscis.gov or
// *.uscis.gov, no credentials in the url, no IP literal, default port only, no redirect loop, a hop limit. It also sends no cookies or
// credentials, applies a timeout, refuses a body over the size cap (checked on the declared length AND while reading), and accepts only the
// content type asked for. It stores nothing; callers decide what to keep (the full hop chain and final url are returned for the snapshot).
//
// fetchOfficialSource(url, { accept: "html" | "pdf", fetchImpl, maxHops, timeoutMs, maxBytes }) never throws; it resolves with
//   { ok, finalUrl, status, contentType, chain: [{url,status,location}], bytes (Buffer, only when ok), violations: [...], error }.

const { checkUrl, normalizeUrl } = require("./officialUrl");
const { LIMITS } = require("./editionPolicy.constants");

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCEPTED_TYPES = { html: ["text/html"], pdf: ["application/pdf"] };
const USER_AGENT = "Immiglance-FormEditionEvidence/0b-1";

/** Reads a response body up to maxBytes. Resolves { bytes } or { tooLarge: true }. The body is never read past the cap. */
async function readCapped(response, maxBytes) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return { tooLarge: true };
      }
      chunks.push(Buffer.from(value));
    }
    return { bytes: Buffer.concat(chunks, total) };
  }
  // test doubles / non-streaming bodies
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length > maxBytes ? { tooLarge: true } : { bytes: buffer };
}

async function fetchOfficialSource(rawUrl, { accept = "html", fetchImpl = globalThis.fetch, maxHops = LIMITS.maxHops, timeoutMs = LIMITS.timeoutMs, maxBytes } = {}) {
  const cap = maxBytes || (accept === "pdf" ? LIMITS.pdfMaxBytes : LIMITS.htmlMaxBytes);
  const result = { ok: false, finalUrl: null, status: null, contentType: null, chain: [], bytes: null, violations: [], error: null };
  const visited = new Set();
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= maxHops; hop += 1) {
      const check = checkUrl(current);
      if (!check.ok) {
        check.violations.forEach((type) => result.violations.push({ type, url: current, hop }));
        return result; // rejected BEFORE any request is made to it
      }
      const key = normalizeUrl(check.url);
      if (visited.has(key)) { result.violations.push({ type: "redirect_loop", url: current, hop }); return result; }
      visited.add(key);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
          headers: { "user-agent": USER_AGENT, accept: accept === "pdf" ? "application/pdf" : "text/html" },
        });
        const status = response.status;
        const location = response.headers?.get?.("location") || null;
        result.chain.push({ url: current, status, location });

        if (REDIRECT_STATUSES.has(status)) {
          try { await response.body?.cancel?.(); } catch { /* nothing to cancel */ }
          if (!location) { result.violations.push({ type: "redirect_without_location", url: current, hop }); return result; }
          if (hop === maxHops) { result.violations.push({ type: "too_many_hops", url: current, hop }); return result; }
          try {
            current = new URL(location, current).toString();
          } catch {
            result.violations.push({ type: "invalid_url", url: location, hop: hop + 1 });
            return result;
          }
          continue;
        }

        result.finalUrl = current;
        result.status = status;
        result.contentType = (response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase() || null;
        if (status < 200 || status >= 300) {
          try { await response.body?.cancel?.(); } catch { /* ignore */ }
          result.error = `HTTP ${status}`;
          return result;
        }
        if (!ACCEPTED_TYPES[accept]?.includes(result.contentType)) {
          try { await response.body?.cancel?.(); } catch { /* ignore */ }
          result.violations.push({ type: "content_type_not_allowed", url: current, hop });
          result.error = `content type ${result.contentType || "unknown"} is not accepted here`;
          return result;
        }
        const declared = Number(response.headers?.get?.("content-length"));
        if (Number.isFinite(declared) && declared > cap) {
          try { await response.body?.cancel?.(); } catch { /* ignore */ }
          result.violations.push({ type: "size_over_cap", url: current, hop });
          result.error = `declared size ${declared} is over the ${cap} byte cap`;
          return result;
        }
        const body = await readCapped(response, cap);
        if (body.tooLarge) {
          result.violations.push({ type: "size_over_cap", url: current, hop });
          result.error = `body is over the ${cap} byte cap`;
          return result;
        }
        result.bytes = body.bytes;
        result.ok = true;
        return result;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    result.error = error?.name === "AbortError" ? `no response within ${timeoutMs} ms` : String(error?.message || error);
  }
  return result;
}

module.exports = { fetchOfficialSource, readCapped, REDIRECT_STATUSES };
