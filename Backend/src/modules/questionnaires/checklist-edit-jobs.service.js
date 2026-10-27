// Checklist edits done in the background.
//
// Removing a question (or changing its wording) used to make the editor wait for the whole server round trip - including, on the first edit, building this
// case's own copy of the checklist - and show "Saving" meanwhile. Now the editor changes the screen at once and asks for the edit as a JOB: the request is
// checked (the case exists, the user may edit it), written down durably and answered immediately (202); the server then does the work and keeps retrying
// until it succeeds, with a growing delay between tries and across restarts. Edits to the same checklist always run in the order they were made. The
// result reaches every open session through the usual "checklists changed" push that editChecklist already sends.
//
// Only remove and update are queued: both are idempotent, so a retry is always safe. Adding a question stays immediate (the new question's key is returned).
const ChecklistEditJob = require("../../models/ChecklistEditJob");
const Case = require("../../models/Case");
const User = require("../../models/User");
const caseService = require("../cases/case.service");
const logger = require("../../utils/logger");

const BACKGROUND_OPS = new Set(["update", "remove", "restore"]);
const MAX_ATTEMPTS = Number(process.env.CHECKLIST_EDIT_MAX_ATTEMPTS || 60);
const LEASE_MS = Number(process.env.CHECKLIST_EDIT_LEASE_MS || 2 * 60 * 1000);
// 2 s, 4 s, 8 s ... never more than 5 minutes between tries
const backoffMs = (attempts) => Math.min(5 * 60 * 1000, 2000 * 2 ** Math.max(0, attempts - 1));

const editor = () => require("./case-checklist.service");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const supportsBackground = (op) => BACKGROUND_OPS.has(op);

// Same checks the synchronous edit makes before touching anything, so a request that could never succeed is refused now, not retried forever.
async function enqueueEdit(caseId, body = {}, user) {
  if (!supportsBackground(body.op)) throw httpError(400, "Only removing, restoring or changing a question can be done in the background");
  if (!body.checklistId || !body.questionKey) throw httpError(400, "checklistId and questionKey are required");
  const caseData = await Case.findById(caseId);
  if (!caseData) throw httpError(404, "Case not found");
  if (!caseService.canAccessCase(user, caseData)) throw httpError(403, "Not authorized to manage this case's checklists");
  const job = await ChecklistEditJob.create({
    caseId: caseData._id, checklistId: String(body.checklistId), op: body.op, questionKey: String(body.questionKey), patch: body.patch || {}, requestedBy: user._id,
  });
  setImmediate(() => processJob(job._id).catch((error) => logger.error("checklist_edit_kick_failed", { jobId: String(job._id), error: error.message })));
  return job;
}

// A failure a retry cannot fix (a 4xx the edit itself raised: question not found, bad value, no longer allowed). Network / database trouble has no 4xx status.
const isPermanent = (error) => Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status);

// Claims one due job (atomically, with a lease) and runs it. Safe to call from several processes and to repeat. Returns the job when it finished.
async function processJob(jobId) {
  const now = new Date();
  const candidate = await ChecklistEditJob.findById(jobId).lean();
  if (!candidate || !["pending", "processing"].includes(candidate.status)) return null;
  // an earlier edit of the same checklist that is still waiting or running goes first
  const earlier = await ChecklistEditJob.exists({ _id: { $ne: candidate._id }, caseId: candidate.caseId, checklistId: candidate.checklistId, status: { $in: ["pending", "processing"] }, createdAt: { $lt: candidate.createdAt } });
  if (earlier) return null;
  const job = await ChecklistEditJob.findOneAndUpdate(
    { _id: jobId, nextAttemptAt: { $lte: now }, $or: [{ status: "pending" }, { status: "processing", lockedUntil: { $lte: now } }] },
    { $set: { status: "processing", lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!job) return null;
  try {
    const actor = await User.findById(job.requestedBy).lean();
    if (!actor) throw httpError(403, "The person who made this change no longer exists");
    await editor().editChecklist(job.caseId, { op: job.op, checklistId: job.checklistId, questionKey: job.questionKey, patch: job.patch }, actor, { headers: {}, ip: "background" });
    await ChecklistEditJob.updateOne({ _id: job._id }, { $set: { status: "done", completedAt: new Date(), lastError: null }, $unset: { lockedUntil: "" } });
    setImmediate(() => processNextFor(job).catch(() => null));
    return { ...job.toObject(), status: "done" };
  } catch (error) {
    const failedForGood = isPermanent(error) || job.attempts >= MAX_ATTEMPTS;
    await ChecklistEditJob.updateOne(
      { _id: job._id },
      { $set: { status: failedForGood ? "failed" : "pending", lastError: String(error.message || error).slice(0, 500), nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)) }, $unset: { lockedUntil: "" } }
    );
    logger.error("checklist_edit_job_failed", { jobId: String(job._id), caseId: String(job.caseId), attempts: job.attempts, failedForGood, error: error.message });
    // a job that gave up must not block the edits queued behind it
    if (failedForGood) setImmediate(() => processNextFor(job).catch(() => null));
    return null;
  }
}

// the next waiting edit of the same checklist, right away rather than at the next worker tick
async function processNextFor(job) {
  const next = await ChecklistEditJob.findOne({ caseId: job.caseId, checklistId: job.checklistId, status: "pending", nextAttemptAt: { $lte: new Date() } }).sort({ createdAt: 1 }).select("_id").lean();
  if (next) await processJob(next._id);
}

/** Worker tick: every due job, oldest first (pending and due, or processing with an expired lease). */
async function processDueJobs(limit = 20) {
  const now = new Date();
  const due = await ChecklistEditJob.find({ $or: [{ status: "pending", nextAttemptAt: { $lte: now } }, { status: "processing", lockedUntil: { $lte: now } }] })
    .sort({ createdAt: 1 }).limit(limit).select("_id").lean();
  for (const { _id } of due) await processJob(_id);
  return due.length;
}

/** Background loop: retries failed edits, picks up what a restart interrupted. */
function startChecklistEditWorker() {
  const { withJobLock } = require("../../utils/jobLock");
  const intervalMs = Number(process.env.CHECKLIST_EDIT_WORKER_INTERVAL_MS || 5 * 1000);
  const run = () => withJobLock("checklist-edit-worker", intervalMs * 6, () => processDueJobs()).catch((error) => logger.error("checklist_edit_worker_failed", { error: error.message }));
  setTimeout(run, Number(process.env.CHECKLIST_EDIT_WORKER_INITIAL_DELAY_MS || 10 * 1000));
  return setInterval(run, intervalMs);
}

module.exports = { enqueueEdit, supportsBackground, processJob, processDueJobs, startChecklistEditWorker, backoffMs, isPermanent, MAX_ATTEMPTS };
