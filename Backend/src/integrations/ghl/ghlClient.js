const env = require("../../config/env");
const logger = require("../../utils/logger");

// Single HTTP entry point to the GHL REST API (Private Integration token).
// Nothing else in the codebase talks to GHL directly, and the token never
// leaves this file: it is not logged and not included in thrown errors.

class GHLApiError extends Error {
  constructor(message, { status = 0, body = null, retryable = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = "GHLApiError";
    this.status = status;
    this.body = body;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(path.replace(/^\//, ""), baseUrl.replace(/\/?$/, "/"));
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

function createClient(overrides = {}) {
  const config = { ...env.ghl, ...overrides };
  const fetchImpl = overrides.fetch || global.fetch;
  const maxAttempts = overrides.maxAttempts ?? 4;
  const baseDelayMs = overrides.baseDelayMs ?? 500;
  const timeoutMs = overrides.timeoutMs ?? 15000;

  async function request(method, path, { query, body } = {}) {
    if (!config.token) throw new GHLApiError("GHL token is not configured");
    const url = buildUrl(config.baseUrl, path, query);
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${config.token}`,
            Version: config.apiVersion,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { raw: text.slice(0, 300) };
          }
        }
        if (response.ok) return parsed;

        throw new GHLApiError(`GHL ${method} ${url.pathname} failed with ${response.status}`, {
          status: response.status,
          body: parsed,
          retryable: isRetryableStatus(response.status),
          retryAfterMs: parseRetryAfter(response.headers?.get?.("retry-after")),
        });
      } catch (error) {
        // Network failure / timeout: no status, treat as retryable.
        lastError =
          error instanceof GHLApiError
            ? error
            : new GHLApiError(`GHL ${method} ${url.pathname} network error: ${error.message}`, { retryable: true });
        if (!lastError.retryable || attempt === maxAttempts) break;
        const delay = lastError.retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1);
        logger.warn?.("ghl_request_retry", { path: url.pathname, attempt, status: lastError.status, delayMs: delay });
        await sleep(delay);
      }
    }
    throw lastError;
  }

  return {
    get: (path, query) => request("GET", path, { query }),
    put: (path, body, query) => request("PUT", path, { body, query }),
    post: (path, body, query) => request("POST", path, { body, query }),
    request,
  };
}

let shared;
function getClient() {
  if (!shared) shared = createClient();
  return shared;
}

module.exports = { createClient, getClient, GHLApiError, buildUrl };
