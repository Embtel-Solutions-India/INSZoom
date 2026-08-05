const Redis = require("ioredis");
const { EJSON } = require("mongodb");
const env = require("./env");

// Cache-aside layer for the per-request auth user lookup. Every helper here
// is a safe no-op when REDIS_URL isn't configured, so the app behaves
// identically to before this module existed in any environment without Redis.
const USER_CACHE_TTL_SECONDS = 60;
const USER_CACHE_PREFIX = "auth:user:";

let client;
let triedConnect = false;

function getClient() {
  if (!env.redisUrl) return null;
  if (!triedConnect) {
    triedConnect = true;
    client = new Redis(env.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    });
    client.on("error", (error) => {
      console.error("Redis error (auth cache degraded to direct DB reads):", error.message);
    });
  }
  return client;
}

function cacheKey(userId) {
  return `${USER_CACHE_PREFIX}${userId}`;
}

// EJSON (not plain JSON) so ObjectId/Date fields round-trip as real BSON
// types — the cached value is later handed to User.hydrate(), which expects
// native driver types, not stringified ones.
async function getCachedUser(userId) {
  const redis = getClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(cacheKey(userId.toString()));
    return raw ? EJSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function setCachedUser(userId, plainUser) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(cacheKey(userId.toString()), EJSON.stringify(plainUser), "EX", USER_CACHE_TTL_SECONDS);
  } catch {
    // Cache write failures must never fail the request.
  }
}

async function invalidateUserCache(userId) {
  const redis = getClient();
  if (!redis || !userId) return;
  try {
    await redis.del(cacheKey(userId.toString()));
  } catch {
    // Best-effort invalidation only.
  }
}

// Generation-based cache-aside for the dashboard/analytics aggregates. Bumping
// the generation (dashboardCacheBump, called wherever a case/payment mutates)
// orphans every previously cached entry at once instead of needing to track
// down every individual cache key to delete — the old entries just expire on
// their own short TTL. Same no-op-without-Redis guarantee as the auth cache.
const DASHBOARD_CACHE_TTL_SECONDS = 45;
const DASHBOARD_GEN_KEY = "dashboard:gen";

async function dashboardCacheGeneration() {
  const redis = getClient();
  if (!redis) return 0;
  try {
    const gen = await redis.get(DASHBOARD_GEN_KEY);
    return gen ? Number(gen) : 0;
  } catch {
    return 0;
  }
}

async function dashboardCacheBump() {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.incr(DASHBOARD_GEN_KEY);
  } catch {
    // Best-effort — worst case, a cached entry lives out its short TTL.
  }
}

async function cachedDashboardCompute(key, compute) {
  const redis = getClient();
  if (!redis) return compute();
  const gen = await dashboardCacheGeneration();
  const fullKey = `dashboard:v${gen}:${key}`;
  try {
    const cached = await redis.get(fullKey);
    if (cached) return EJSON.parse(cached);
  } catch {
    // Fall through to computing fresh on any cache read error.
  }
  const result = await compute();
  try {
    await redis.set(fullKey, EJSON.stringify(result), "EX", DASHBOARD_CACHE_TTL_SECONDS);
  } catch {
    // Cache write failures must never fail the request.
  }
  return result;
}

module.exports = {
  getClient,
  getCachedUser,
  setCachedUser,
  invalidateUserCache,
  dashboardCacheBump,
  cachedDashboardCompute,
};
