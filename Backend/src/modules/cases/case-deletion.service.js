// Permanent case deletion. Unlike archiveCase (reversible, keeps every record), this removes the case from the database
// together with everything that only exists for it: answers, documents (and their stored files), forms, tasks, messages,
// notifications, audit rows, ... Deleting a principal case also deletes its child cases (they cannot exist without it).
// A client/employee account is removed only when this leaves it with no case at all; staff and attorney accounts are
// never touched.
//
// Two phases, so the person deleting never waits for the slow part:
//   1. requestCaseDeletion(): records a durable CaseDeletionJob, then removes the cases and orphaned client accounts at
//      once (a handful of queries). From this moment the case is gone from every portal and the request returns.
//   2. processDeletionJob(): a background worker sweeps the linked data (stored files, then every collection) from the
//      job record. Every step is "delete where the id is in this list", so a failed run is simply retried (with backoff,
//      up to MAX_ATTEMPTS) and an admin is alerted if it can never finish.
//
// Every collection is swept by the same reference fields, so a collection added later is covered without changing this file.
const mongoose = require("mongoose");
const Case = require("../../models/Case");
const User = require("../../models/User");
const CaseDeletionJob = require("../../models/CaseDeletionJob");
const logger = require("../../utils/logger");

const CASE_FIELDS = ["caseId", "case", "caseRef", "parentCaseId", "principalCaseId", "relatedCaseId"];
const USER_FIELDS = ["user", "userId", "clientId", "clientUserId", "recipient", "recipientId"];
const EMAIL_FIELDS = ["email", "clientEmail", "to", "emailTo", "userEmail"];
const CLIENT_SIDE_ROLES = ["client", "employee", "employer", "beneficiary"];
const SKIPPED_COLLECTIONS = new Set(["users", "cases", "leads", "system.profile", "casedeletionjobs"]);

const MAX_ATTEMPTS = Number(process.env.CASE_DELETION_MAX_ATTEMPTS || 8);
const CONCURRENCY = Number(process.env.CASE_DELETION_CONCURRENCY || 8);
const LEASE_MS = Number(process.env.CASE_DELETION_LEASE_MS || 10 * 60 * 1000);
const backoffMs = (attempts) => Math.min(30 * 60 * 1000, 5000 * 2 ** Math.max(0, attempts - 1));

const ids = (list) => list.map((value) => new mongoose.Types.ObjectId(String(value)));

// Runs `task` over `items` with at most `limit` in flight; rejects with the first error after everything has settled,
// so one failing item never leaves the others half-started.
async function mapLimit(items, limit, task) {
  let next = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
}

async function collectTargets(caseData) {
  const children = await Case.find({ $or: [{ parentCase: caseData._id }, { _id: { $in: caseData.childCases || [] } }] }).select("_id caseNumber user").lean();
  const cases = [{ _id: caseData._id, caseNumber: caseData.caseNumber, user: caseData.user }, ...children.filter((child) => String(child._id) !== String(caseData._id))];
  return { cases, caseIds: ids(cases.map((item) => item._id)) };
}

// Client-side accounts that would be left with no case once `caseIds` are gone.
async function orphanedClientUsers(cases, caseIds) {
  const candidateIds = [...new Set(cases.map((item) => item.user).filter(Boolean).map(String))];
  if (!candidateIds.length) return [];
  const users = await User.find({ _id: { $in: ids(candidateIds) }, role: { $in: CLIENT_SIDE_ROLES } }).select("_id email").lean();
  const remaining = await Promise.all(users.map((user) => Case.countDocuments({ _id: { $nin: caseIds }, $or: [{ user: user._id }, { clientEmail: user.email }, { employerUser: user._id }, { employeeUser: user._id }] })));
  return users.filter((_, index) => !remaining[index]);
}

// Phase 1 body: remove the cases and orphaned accounts and detach anything still pointing at them. Idempotent.
async function removeCasesAndAccounts(caseIds, userIds) {
  await Promise.all([
    Case.updateMany({ childCases: { $in: caseIds } }, { $pull: { childCases: { $in: caseIds } } }),
    User.updateMany({ caseIds: { $in: caseIds } }, { $pull: { caseIds: { $in: caseIds } } }),
    User.updateMany({ primaryCaseId: { $in: caseIds } }, { $unset: { primaryCaseId: "" } }),
  ]);
  await Case.deleteMany({ _id: { $in: caseIds } });
  if (userIds.length) await User.deleteMany({ _id: { $in: userIds }, role: { $in: CLIENT_SIDE_ROLES } });
}

/**
 * Phase 1. Returns as soon as the cases and accounts are gone; the linked-data sweep continues in the background.
 */
async function requestCaseDeletion(caseData, actor) {
  const { cases, caseIds } = await collectTargets(caseData);
  const orphans = await orphanedClientUsers(cases, caseIds);
  const userIds = orphans.map((user) => user._id);
  const emails = orphans.map((user) => user.email).filter(Boolean);
  const caseNumbers = cases.map((item) => item.caseNumber);

  // the durable record comes first: from here on the deletion WILL complete, whatever happens to this request
  const job = await CaseDeletionJob.create({ caseIds, caseNumbers, userIds, emails, requestedBy: actor?._id });
  try {
    await removeCasesAndAccounts(caseIds, userIds);
  } catch (error) {
    // not fatal: the worker repeats this step (idempotent) before it sweeps the rest
    logger.error("case_delete_fast_phase_failed", { jobId: String(job._id), error: error.message });
  }
  setImmediate(() => processDeletionJob(job._id).catch((error) => logger.error("case_delete_kick_failed", { jobId: String(job._id), error: error.message })));
  return { caseNumbers, accountsRemoved: orphans.length, jobId: job._id };
}

async function removeStoredFiles(db, caseIds) {
  const documents = await db.collection("documents").find({ caseId: { $in: caseIds } }).project({ storageKey: 1, versions: 1 }).toArray();
  const keys = new Set();
  documents.forEach((doc) => [doc.storageKey, ...(doc.versions || []).map((version) => version.storageKey)].filter(Boolean).forEach((key) => keys.add(key)));
  const storage = require("../uploads/storage.service");
  let removed = 0;
  // a failure here fails the whole run (so it is retried) BEFORE any Document row is deleted: the keys are still on record
  await mapLimit([...keys], CONCURRENCY, async (key) => {
    if (await storage.deleteObject(key)) removed += 1;
  });
  return removed;
}

async function sweepCollections(db, job) {
  const caseIds = job.caseIds;
  const collections = (await db.listCollections().toArray()).map((entry) => entry.name).filter((name) => !SKIPPED_COLLECTIONS.has(name));
  const removed = {};
  await mapLimit(collections, CONCURRENCY, async (name) => {
    const or = CASE_FIELDS.map((field) => ({ [field]: { $in: caseIds } }));
    if (job.userIds.length) USER_FIELDS.forEach((field) => or.push({ [field]: { $in: job.userIds } }));
    if (job.emails.length) EMAIL_FIELDS.forEach((field) => or.push({ [field]: { $in: job.emails } }));
    const result = await db.collection(name).deleteMany({ $or: or });
    if (result?.deletedCount) removed[name] = result.deletedCount;
  });
  return removed;
}

async function alertAdmins(job) {
  try {
    await require("../notifications/notification.service").createForRoles(["admin", "super_admin"], {
      type: "general",
      category: "general",
      title: "Case deletion could not finish",
      message: `Cleanup of deleted case ${job.caseNumbers.join(", ")} failed after ${job.attempts} attempts (${String(job.lastError || "").slice(0, 200)}). The case itself is already removed; some linked records may remain.`,
      priority: "high",
    });
  } catch (error) {
    logger.error("case_delete_alert_failed", { jobId: String(job._id), error: error.message });
  }
}

/**
 * Phase 2: claim a due job atomically and sweep its linked data. Safe to call from several instances and to repeat.
 * Returns the finished job, or null when it was not claimable.
 */
async function processDeletionJob(jobId) {
  const now = new Date();
  const job = await CaseDeletionJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ["pending", "processing"] }, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lte: now } }] },
    { $set: { status: "processing", lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!job) return null;
  const started = Date.now();
  try {
    const db = mongoose.connection.db;
    await removeCasesAndAccounts(job.caseIds, job.userIds); // idempotent repeat of phase 1 (covers a phase-1 failure)
    const filesRemoved = await removeStoredFiles(db, job.caseIds);
    const removed = await sweepCollections(db, job);
    const result = { filesRemoved, removed, ms: Date.now() - started };
    await CaseDeletionJob.updateOne({ _id: job._id }, { $set: { status: "done", completedAt: new Date(), result, lastError: null }, $unset: { lockedUntil: "" } });
    logger.info("case_deleted_permanently", { jobId: String(job._id), by: String(job.requestedBy || ""), caseNumbers: job.caseNumbers, accountsRemoved: job.userIds.length, ...result });
    return { ...job.toObject(), status: "done", result };
  } catch (error) {
    const failedForGood = job.attempts >= MAX_ATTEMPTS;
    await CaseDeletionJob.updateOne(
      { _id: job._id },
      { $set: { status: failedForGood ? "failed" : "pending", lastError: error.message, nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)) }, $unset: { lockedUntil: "" } }
    );
    logger.error("case_delete_sweep_failed", { jobId: String(job._id), attempts: job.attempts, failedForGood, error: error.message });
    if (failedForGood) await alertAdmins({ ...job.toObject(), lastError: error.message });
    return null;
  }
}

/** Worker tick: process every due job (pending, or processing with an expired lease). */
async function processDueJobs(limit = 5) {
  const now = new Date();
  const due = await CaseDeletionJob.find({
    $or: [
      { status: "pending", nextAttemptAt: { $lte: now } },
      { status: "processing", lockedUntil: { $lte: now } },
    ],
  }).sort({ nextAttemptAt: 1 }).limit(limit).select("_id").lean();
  for (const { _id } of due) await processDeletionJob(_id);
  return due.length;
}

/** Admin retry of a job that gave up. */
async function retryDeletionJob(jobId) {
  const job = await CaseDeletionJob.findOneAndUpdate({ _id: jobId, status: "failed" }, { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date() }, $unset: { lockedUntil: "" } }, { new: true });
  if (job) setImmediate(() => processDeletionJob(job._id).catch(() => {}));
  return job;
}

// Kept for scripts and callers that want the whole deletion done before they continue.
async function deleteCasePermanently(caseData, actor) {
  const { jobId, caseNumbers, accountsRemoved } = await requestCaseDeletion(caseData, actor);
  let job = await CaseDeletionJob.findById(jobId).lean();
  for (let guard = 0; guard < MAX_ATTEMPTS && job && job.status !== "done"; guard += 1) {
    await CaseDeletionJob.updateOne({ _id: jobId, status: "pending" }, { $set: { nextAttemptAt: new Date(0) } });
    await processDeletionJob(jobId);
    job = await CaseDeletionJob.findById(jobId).lean();
  }
  return { caseNumbers, accountsRemoved, filesRemoved: job?.result?.filesRemoved || 0, removed: job?.result?.removed || {} };
}

/** Background retry loop (picks up jobs the request-time kick missed, retries failed sweeps, recovers after a restart). */
function startCaseDeletionWorker() {
  const { withJobLock } = require("../../utils/jobLock");
  const intervalMs = Number(process.env.CASE_DELETION_WORKER_INTERVAL_MS || 30 * 1000);
  const run = () =>
    withJobLock("case-deletion-worker", intervalMs * 6, () => processDueJobs()).catch((error) => logger.error("case_deletion_worker_failed", { error: error.message }));
  setTimeout(run, Number(process.env.CASE_DELETION_WORKER_INITIAL_DELAY_MS || 15 * 1000));
  return setInterval(run, intervalMs);
}

module.exports = { startCaseDeletionWorker, requestCaseDeletion, processDeletionJob, processDueJobs, retryDeletionJob, deleteCasePermanently, MAX_ATTEMPTS };
