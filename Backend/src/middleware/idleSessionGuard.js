const { getClient } = require("../config/redis");
const settingsEngine = require("../modules/settings/settingsEngine.service");

// Enforces security.session.idleTimeoutMinutes (settings/registry/
// security.registry.js) — used inline by middleware/authenticate.js, right
// after token verification, so every existing authenticate() call site
// picks this up with no per-route changes. A request from a user inactive
// longer than the current setting is rejected even though their JWT access
// token is still technically valid.
//
// Uses Redis when configured (correct across multiple app instances);
// falls back to an in-process Map when it isn't (REDIS_URL is unset in
// this dev environment) — correct for a single instance, which is what's
// actually verifiable here. Either way this is genuinely live: the timeout
// value is re-read from the settings engine on every request, so lowering
// it takes effect on the very next request, no restart.
const inMemoryLastActive = new Map();

async function getLastActive(userId) {
  const redis = getClient();
  if (redis) {
    const raw = await redis.get(`session:lastActive:${userId}`).catch(() => null);
    return raw ? Number(raw) : null;
  }
  return inMemoryLastActive.get(String(userId)) ?? null;
}

async function touchLastActive(userId) {
  const now = Date.now();
  const redis = getClient();
  if (redis) {
    await redis.set(`session:lastActive:${userId}`, String(now), "EX", 60 * 60 * 24).catch(() => {});
  } else {
    inMemoryLastActive.set(String(userId), now);
  }
}

async function clearLastActive(userId) {
  const redis = getClient();
  if (redis) {
    await redis.del(`session:lastActive:${userId}`).catch(() => {});
  } else {
    inMemoryLastActive.delete(String(userId));
  }
}

// Returns true if the session should be rejected as idle-timed-out.
// Touches (updates) last-active on every non-rejected call.
async function isIdleTimedOut(userId) {
  const idleTimeoutMinutes = await settingsEngine.getEffective("security.session.idleTimeoutMinutes", {});
  const lastActive = await getLastActive(userId);
  const now = Date.now();

  if (lastActive && now - lastActive > idleTimeoutMinutes * 60 * 1000) {
    await clearLastActive(userId);
    return true;
  }
  await touchLastActive(userId);
  return false;
}

module.exports = { isIdleTimedOut, clearLastActive };
