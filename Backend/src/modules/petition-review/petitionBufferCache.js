// A petition PDF can be hundreds of pages. Reading it from storage and decrypting it takes far longer than sending it, so the decrypted bytes of the petitions that are being
// looked at are kept in memory for a while: the first open pays for the read once (it is also started in the background the moment a petition is released or a viewer link is
// asked for), every later open and every byte-range request of the PDF viewer is served from memory. Bounded by total size, entry size and age; a failed read is never kept;
// concurrent opens share one read. PETITION_CACHE_MAX_MB (default 300) = 0 switches it off.
const MB = 1024 * 1024;
const entries = new Map(); // key -> { promise, bytes, at }

const limits = () => ({
  maxBytes: Math.max(Number(process.env.PETITION_CACHE_MAX_MB ?? 300), 0) * MB,
  maxEntry: 200 * MB,
  ttlMs: Number(process.env.PETITION_CACHE_TTL_MINUTES || 30) * 60 * 1000,
});

function totalBytes() {
  let total = 0;
  entries.forEach((entry) => { total += entry.bytes; });
  return total;
}

function evict(now = Date.now()) {
  const { maxBytes, ttlMs } = limits();
  for (const [key, entry] of entries) if (entry.bytes && now - entry.at > ttlMs) entries.delete(key);
  if (totalBytes() <= maxBytes) return;
  const oldestFirst = [...entries.entries()].filter(([, entry]) => entry.bytes).sort((a, b) => a[1].at - b[1].at);
  for (const [key] of oldestFirst) {
    if (totalBytes() <= maxBytes) break;
    entries.delete(key);
  }
}

/** Resolves with the bytes of `key`, reading them with `loader()` only when they are not in memory (or already being read). */
function getOrLoad(key, loader) {
  const { maxBytes, maxEntry } = limits();
  if (maxBytes === 0) return loader();
  const now = Date.now();
  const existing = entries.get(key);
  if (existing && (!existing.bytes || now - existing.at <= limits().ttlMs)) {
    existing.at = now;
    return existing.promise;
  }
  const entry = { promise: null, bytes: 0, at: now };
  entry.promise = Promise.resolve()
    .then(loader)
    .then((buffer) => {
      if (entries.get(key) === entry) {
        if (!Buffer.isBuffer(buffer) || buffer.length > maxEntry) entries.delete(key);
        else { entry.bytes = buffer.length; entry.at = Date.now(); evict(); }
      }
      return buffer;
    })
    .catch((error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
  entries.set(key, entry);
  return entry.promise;
}

/** True for failures a retry cannot fix (the file is simply not there / not allowed). */
const isPermanent = (error) => [404, 403, 401, 410].includes(error?.statusCode || error?.status) || error?.code === "ENOENT" || error?.name === "NoSuchKey" || error?.Code === "NoSuchKey";

/** Runs `fn`, and when it fails for a reason that may pass (storage hiccup, timeout, throttling) tries again with a growing pause: the caller only sees an error after every attempt failed. */
async function withRetries(fn, { attempts = Number(process.env.DOCUMENT_READ_ATTEMPTS || 6), baseDelayMs = 700, maxDelayMs = 8000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isPermanent(error) || attempt === attempts - 1) break;
      await sleep(Math.min(baseDelayMs * 2 ** attempt, maxDelayMs));
    }
  }
  throw lastError;
}

const clear = () => entries.clear();
const stats = () => ({ entries: entries.size, bytes: totalBytes() });

module.exports = { getOrLoad, evict, clear, stats, withRetries, isPermanent };
