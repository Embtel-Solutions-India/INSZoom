// Retry-until-it-works helper for the form pipeline (fetch, qpdf normalization, import, mapping). Pure code - no manual step.
//   - transient failures (network, 403/413/429/5xx/bad gateway, timeouts, qpdf warnings) are retried with exponential backoff + jitter;
//   - every retry rotates to the next VARIANT of the task (e.g. a different request profile, a forced re-normalization), so a failure caused by one
//     strategy is attacked with another instead of repeating the identical call;
//   - permanent failures (a form with no downloadable PDF, invalid input) stop immediately - retrying them can never help;
//   - always bounded: when the attempts are exhausted the LAST error is thrown, never swallowed, so the caller records it and its own cooldown / scheduler
//     retries later. Nothing here ever mutates or deletes existing data.
const PERMANENT_CODES = new Set(["USCIS_FORM_NOT_STANDALONE", "NORMALIZE_INPUT_NOT_PDF", "VALIDATION_FAILED"]);
const TRANSIENT_STATUS = new Set([400, 403, 408, 413, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR.*|QPDF_NOT_FOUND)$/;

function isTransient(error) {
  if (!error) return false;
  if (PERMANENT_CODES.has(error.code)) return false;
  const status = error.status || error.statusCode || error.response?.status;
  if (status && !TRANSIENT_STATUS.has(Number(status))) return Number(status) >= 500;
  if (typeof error.code === "string" && TRANSIENT_CODES.test(error.code)) return true;
  return true; // unknown faults are retried too; the attempt cap bounds the cost
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryUntilSuccess(task, options = {}) {
  const { attempts = 5, baseDelayMs = 400, maxDelayMs = 8000, variants = [undefined], label = "task", onRetry, sleepFn = sleep } = options;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const variant = variants[(attempt - 1) % variants.length];
    try {
      return await task({ attempt, variant });
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150);
      if (onRetry) { try { await onRetry({ attempt, error, nextVariant: variants[attempt % variants.length], delay, label }); } catch (_) { /* logging only */ } }
      await sleepFn(delay);
    }
  }
  if (lastError && !lastError.retryAttempts) lastError.retryAttempts = attempts;
  throw lastError;
}

module.exports = { retryUntilSuccess, isTransient };
