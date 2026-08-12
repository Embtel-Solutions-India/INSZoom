const processor = require("../processors/document-intelligence.processor");
const DocumentProcessingJob = require("../../../models/DocumentProcessingJob");
const Document = require("../../../models/Document");
const crypto = require("crypto");
const logger = require("../../../utils/logger");

const queue = [];
const queuedDocuments = new Set();
let activeCount = 0;
let recoveryStarted = false;
const concurrency = Math.max(1, Number(process.env.DOCUMENT_INTELLIGENCE_CONCURRENCY || 2));

function enqueue(job) {
  const documentKey = String(job.documentId || "");
  if (documentKey && queuedDocuments.has(documentKey)) {
    return queue.find((item) => String(item.documentId || "") === documentKey) || { documentId: job.documentId, duplicate: true };
  }
  const queuedJob = {
    id: crypto.randomUUID(),
    attempts: 0,
    maxAttempts: Math.max(1, Number(process.env.DOCUMENT_INTELLIGENCE_MAX_ATTEMPTS || 3)),
    availableAt: Date.now(),
    ...job,
    userId: job.userId || job.user?._id,
  };
  delete queuedJob.user;
  queuedJob.persistencePromise = DocumentProcessingJob.create({
    jobId: queuedJob.id,
    documentId: queuedJob.documentId,
    userId: queuedJob.userId,
    reqMeta: queuedJob.reqMeta,
    status: "queued",
    attempts: 0,
    maxAttempts: queuedJob.maxAttempts,
    availableAt: new Date(queuedJob.availableAt),
  }).catch(async (error) => {
    if (error?.code !== 11000) throw error;
    return DocumentProcessingJob.findOne({ documentId: queuedJob.documentId, status: { $in: ["queued", "processing", "retrying"] } });
  });
  Document.updateOne(
    { _id: queuedJob.documentId, deletedAt: { $exists: false }, intelligenceStatus: { $nin: ["processing", "approved"] } },
    { $set: { intelligenceStatus: "queued", aiExtractionStatus: "pending", "processing.status": "pending", "processing.stage": "stored" } }
  ).catch(() => {});
  queue.push(queuedJob);
  if (documentKey) queuedDocuments.add(documentKey);
  setImmediate(drain);
  return queuedJob;
}

async function drain() {
  while (activeCount < concurrency) {
    const index = queue.findIndex((job) => Number(job.availableAt || 0) <= Date.now());
    if (index < 0) {
      if (queue.length) {
        const wait = Math.max(10, Math.min(...queue.map((job) => Number(job.availableAt || Date.now()))) - Date.now());
        setTimeout(drain, wait);
      }
      return;
    }
    const [job] = queue.splice(index, 1);
    activeCount += 1;
    processJob(job).finally(() => {
      activeCount -= 1;
      setImmediate(drain);
    });
  }
}

async function processJob(job) {
  try {
    const persisted = await job.persistencePromise;
    if (persisted) {
      await DocumentProcessingJob.updateOne(
        { jobId: job.id, status: { $in: ["queued", "retrying", "processing"] } },
        { $set: { status: "processing", startedAt: new Date(), lockedBy: process.pid.toString(), lockedAt: new Date() } }
      );
    }
    await processor.process(job);
    await DocumentProcessingJob.updateOne(
      { jobId: job.id },
      { $set: { status: "completed", completedAt: new Date() }, $unset: { lockedBy: 1, lockedAt: 1, lastError: 1, errorCode: 1 } }
    ).catch(() => {});
    queuedDocuments.delete(String(job.documentId || ""));
  } catch (error) {
    job.attempts += 1;
    if (job.attempts < job.maxAttempts) {
      job.availableAt = Date.now() + Math.min(1000 * (2 ** (job.attempts - 1)), 30000);
      await DocumentProcessingJob.updateOne(
        { jobId: job.id },
        {
          $set: {
            status: "retrying",
            attempts: job.attempts,
            availableAt: new Date(job.availableAt),
            lastError: error.message,
            errorCode: error.code,
          },
          $unset: { lockedBy: 1, lockedAt: 1 },
        }
      ).catch(() => {});
      queue.push(job);
    } else {
      await DocumentProcessingJob.updateOne(
        { jobId: job.id },
        {
          $set: {
            status: "failed",
            attempts: job.attempts,
            completedAt: new Date(),
            lastError: error.message,
            errorCode: error.code,
          },
          $unset: { lockedBy: 1, lockedAt: 1 },
        }
      ).catch(() => {});
      queuedDocuments.delete(String(job.documentId || ""));
      logger.error("document_intelligence_job_failed", {
        documentId: job.documentId,
        attempts: job.attempts,
        code: error.code,
        error,
      });
    }
  }
}

async function recoverPendingJobs() {
  if (recoveryStarted) return;
  recoveryStarted = true;
  try {
    const jobs = await DocumentProcessingJob.find({
      status: { $in: ["queued", "retrying", "processing"] },
      attempts: { $lt: Number(process.env.DOCUMENT_INTELLIGENCE_MAX_ATTEMPTS || 3) },
    }).sort({ availableAt: 1 }).limit(Number(process.env.DOCUMENT_INTELLIGENCE_RECOVERY_LIMIT || 1000)).lean();
    jobs.forEach((persisted) => {
      const documentKey = String(persisted.documentId);
      if (queuedDocuments.has(documentKey)) return;
      queuedDocuments.add(documentKey);
      queue.push({
        id: persisted.jobId,
        documentId: persisted.documentId,
        userId: persisted.userId,
        reqMeta: persisted.reqMeta,
        attempts: persisted.attempts,
        maxAttempts: persisted.maxAttempts,
        availableAt: persisted.availableAt?.getTime?.() || Date.now(),
        persistencePromise: Promise.resolve(persisted),
      });
    });
    if (jobs.length) setImmediate(drain);
  } catch {
    recoveryStarted = false;
    setTimeout(recoverPendingJobs, 5000).unref?.();
  }
}

function startRecovery() {
  setImmediate(recoverPendingJobs);
}

function stats() {
  return {
    queued: queue.length,
    active: activeCount,
    concurrency,
    retrying: queue.filter((job) => job.attempts > 0).length,
  };
}

module.exports = {
  enqueue,
  recoverPendingJobs,
  startRecovery,
  stats,
};
