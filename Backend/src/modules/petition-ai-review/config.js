// Petition AI Review settings, read from the environment with safe defaults. readConfig() never contains the key itself:
// only resolveApiKey() returns it, and only the Gemini caller uses that.
//
//   PETITION_AI_REVIEW             on | off              master switch (default OFF - owner decision 2026-11-03). Only on / true / 1 / yes /
//                                                        enabled switch it on; unset or anything else = the whole subsystem does nothing.
//   PETITION_AI_API_KEY            optional dedicated key; falls back to GEMINI_API_KEY / GOOGLE_GEMINI_API_KEY / GOOGLE_API_KEY
//   PETITION_AI_MODEL              optional; falls back to GEMINI_MODEL, then gemini-flash-latest
//   PETITION_AI_PAGES_PER_CALL     pages sent to the model per call (default 4, 1-10)
//   PETITION_AI_CONCURRENCY        AI calls in flight for ONE scan (default 2, 1-4)
//   PETITION_AI_MAX_PAGES          pages scanned per petition; pages beyond are reported, not scanned (default 1500)
//   PETITION_AI_TIMEOUT_MS         per AI call (default 120000)
//   PETITION_AI_BATCH_DELAY_MS     pause after each round of batches so the scan never starves other requests (default 250)
//   PETITION_AI_MAX_OUTPUT_TOKENS  output budget of one AI call (default 8192)

const KEY_VARIABLES = ["PETITION_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_API_KEY"];

function whole(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function enabled(env = process.env) {
  const value = String(env.PETITION_AI_REVIEW ?? "off").trim().toLowerCase();
  return ["on", "true", "1", "yes", "enabled"].includes(value);
}

/** Name of the variable that holds the key (never its value), or null. */
function keySource(env = process.env) {
  return KEY_VARIABLES.find((name) => String(env[name] || "").trim()) || null;
}

/** The key itself. Only the Gemini caller calls this. */
function resolveApiKey(env = process.env) {
  const name = keySource(env);
  return name ? String(env[name]).trim() : "";
}

function readConfig(env = process.env) {
  return Object.freeze({
    enabled: enabled(env),
    keyConfigured: Boolean(keySource(env)),
    keySource: keySource(env),
    model: String(env.PETITION_AI_MODEL || env.GEMINI_MODEL || "gemini-flash-latest").trim(),
    pagesPerCall: whole(env.PETITION_AI_PAGES_PER_CALL, 4, 1, 10),
    concurrency: whole(env.PETITION_AI_CONCURRENCY, 2, 1, 4),
    maxPages: whole(env.PETITION_AI_MAX_PAGES, 1500, 1, 5000),
    timeoutMs: whole(env.PETITION_AI_TIMEOUT_MS, 120000, 5000, 600000),
    batchDelayMs: whole(env.PETITION_AI_BATCH_DELAY_MS, 250, 0, 10000),
    maxOutputTokens: whole(env.PETITION_AI_MAX_OUTPUT_TOKENS, 8192, 1024, 32768),
    leaseMs: 2 * 60 * 1000,
    maxAttempts: 5,
  });
}

module.exports = { readConfig, resolveApiKey, keySource, enabled, KEY_VARIABLES };
