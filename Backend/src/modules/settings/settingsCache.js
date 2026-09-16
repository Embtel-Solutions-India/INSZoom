// In-memory TTL cache for resolved effective values — settings are read far
// more often than written (every authenticated request may consult several),
// so this avoids a Mongo round-trip per read. Invalidated explicitly on any
// write to the same key (see settingsEngine.service.js), and self-expires
// after TTL_MS as a safety net against any invalidation path being missed.
const TTL_MS = 30 * 1000;
const cache = new Map();

function cacheKeyFor(key, scope, scopeId) {
  return `${key}::${scope}::${scopeId ?? ""}`;
}

function get(key, scope, scopeId) {
  const cacheKey = cacheKeyFor(key, scope, scopeId);
  const entry = cache.get(cacheKey);
  if (!entry || entry.expiresAt < Date.now()) {
    cache.delete(cacheKey);
    return undefined;
  }
  return entry.value;
}

function set(key, scope, scopeId, value) {
  cache.set(cacheKeyFor(key, scope, scopeId), { value, expiresAt: Date.now() + TTL_MS });
}

// Invalidates every cached entry for this key (all scopes/scopeIds) — a
// write at any scope can change what a lower-priority scope's cascade
// resolves to, so a narrow single-entry invalidation isn't safe.
function invalidateKey(key) {
  for (const cacheKey of cache.keys()) {
    if (cacheKey.startsWith(`${key}::`)) cache.delete(cacheKey);
  }
}

function clear() {
  cache.clear();
}

module.exports = { get, set, invalidateKey, clear };
