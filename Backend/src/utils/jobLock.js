const crypto = require("crypto");
const JobLock = require("../models/JobLock");
const logger = require("./logger");

// Atomic claim: matches either a document whose lock has expired, or (via
// upsert) no document at all. If another process/tick already holds a live
// lock, neither branch matches, upsert tries to insert a second document with
// the same unique `name`, and Mongo's duplicate-key error tells us the lock
// wasn't ours to take. This works across multiple backend instances since the
// atomicity comes from MongoDB, not from process memory.
//
// Every acquisition gets its own random `token`, stamped onto the lock
// document. Without this, a lock holder whose run outlives ttlMs (legitimately
// still working, not crashed) would have its *stale* releaseLock() call at
// the end unconditionally stamp lockedUntil back to the past — even though a
// second holder had already, correctly, reclaimed the expired lock and was
// mid-run. That stale release would wipe out the second holder's live lock,
// letting a third tick acquire it too, and now two runs are executing
// concurrently even though the lock "worked." Requiring the token to still
// match on release closes that: a late release only succeeds if nobody else
// has claimed the lock since.
async function acquireLock(name, ttlMs) {
  const now = new Date();
  const token = crypto.randomUUID();
  try {
    await JobLock.findOneAndUpdate(
      { name, lockedUntil: { $lte: now } },
      { $set: { lockedAt: now, lockedUntil: new Date(now.getTime() + ttlMs), token } },
      { upsert: true }
    );
    return token;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

// Extends the lease while the job is still actively running, so ttlMs only
// ever fires for a genuinely dead/stuck holder (one that's stopped
// heartbeating), not a slow-but-alive one. Scoped to `token` for the same
// ownership reason as releaseLock — a heartbeat from a holder that's already
// lost the lock must not resurrect it.
async function renewLock(name, token, ttlMs) {
  await JobLock.updateOne({ name, token }, { $set: { lockedUntil: new Date(Date.now() + ttlMs) } });
}

async function releaseLock(name, token) {
  await JobLock.updateOne({ name, token }, { $set: { lockedUntil: new Date(0) } }).catch((error) => {
    logger.error("job_lock_release_failed", { job: name, error });
  });
}

// Runs fn() only if no other tick/instance currently holds the named lock.
// ttlMs bounds how long a crashed/stuck run can block the next attempt before
// the lock self-expires; a heartbeat renews it at ttlMs/3 so a run that's
// simply slow (not dead) never loses its lock mid-flight.
async function withJobLock(name, ttlMs, fn) {
  let token;
  try {
    token = await acquireLock(name, ttlMs);
  } catch (error) {
    logger.error("job_lock_acquire_failed", { job: name, error });
    return;
  }
  if (!token) {
    logger.info("job_lock_skipped_overlap", { job: name });
    return;
  }
  const heartbeat = setInterval(() => {
    renewLock(name, token, ttlMs).catch((error) => logger.error("job_lock_renew_failed", { job: name, error }));
  }, Math.max(Math.floor(ttlMs / 3), 1000));
  heartbeat.unref?.();
  try {
    await fn();
  } finally {
    clearInterval(heartbeat);
    await releaseLock(name, token);
  }
}

module.exports = { withJobLock };
