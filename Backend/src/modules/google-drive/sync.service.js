const mongoose = require("mongoose");
const logger = require("../../utils/logger");
const Document = require("../../models/Document");
const User = require("../../models/User");
const GoogleDriveConnection = require("../../models/GoogleDriveConnection");
const GoogleDriveFileLink = require("../../models/GoogleDriveFileLink");
const GoogleDriveJob = require("../../models/GoogleDriveJob");
const storageService = require("../uploads/storage.service");
const documentService = require("../documents/document.service");
const petitionGate = require("../petition-review/petitionGate");
const driveClient = require("./drive.client");
const { audit, ensureIndexes, resolveOrgId } = require("./connection.service");

const MAX_DOCUMENTS_PER_JOB = 100;
const GLOBAL_CONCURRENCY = 3; // simultaneous Drive uploads across all jobs in this process
const STALE_JOB_MS = 10 * 60 * 1000;
const ADMIN_ROLES = new Set(["super_admin", "admin"]);

// ---- in-process bookkeeping (jobs run inside the API process; all durable state is in Mongo) ----
const runningJobs = new Set(); // jobIds being executed by this process
const activeDocs = new Set(); // `${orgId}:${documentId}:${folderId}` currently uploading: a second request for the same copy is skipped
let slotsInUse = 0;
const slotWaiters = [];

function acquireSlot() {
  if (slotsInUse < GLOBAL_CONCURRENCY) {
    slotsInUse += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => slotWaiters.push(resolve));
}
function releaseSlot() {
  const next = slotWaiters.shift();
  if (next) next();
  else slotsInUse -= 1;
}

const isStaff = (user) => ["super_admin", "admin", "team_lead", "case_manager"].includes(String(user?.role || ""));

function documentName(doc) {
  const raw = doc.originalFileName || doc.originalName || doc.fileName || doc.name || `${doc._id}`;
  // Drive accepts almost any name; strip path separators and control characters only.
  return String(raw).replace(/[\\/]/g, "-").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 240) || String(doc._id);
}

const hasFile = (doc) => Boolean(doc.storageKey || doc.filePath);

// Friendly, non-sensitive message for an item failure.
function describeError(error) {
  const code = error?.code;
  if (code === "RECONNECT_REQUIRED" || code === "NOT_CONNECTED") return error.message;
  if (code === "STORAGE_QUOTA_EXCEEDED") return "The connected Google Drive is out of storage space.";
  if (code === "NOT_FOUND") return "The destination folder was not found, or the connected account can no longer access it.";
  if (code === "FORBIDDEN") return "Google denied access to the destination folder.";
  if (code === "ENOENT") return "The stored file could not be found in Immiglance storage.";
  if (error?.retryable || code === "NETWORK") return "Google Drive could not be reached. Press Retry to try again.";
  return "This file could not be added to Drive.";
}

async function setItem(jobId, documentId, patch) {
  const $set = {};
  Object.entries(patch).forEach(([key, value]) => {
    $set[`items.$.${key}`] = value;
  });
  await GoogleDriveJob.updateOne({ _id: jobId, "items.documentId": documentId }, { $set });
}

// ---- creating a job ----
async function createJob(user, { documentIds, folderId, caseId, force }) {
  const orgId = resolveOrgId();
  await ensureIndexes();
  const connection = await GoogleDriveConnection.findOne({ orgId }).lean();
  if (!connection || connection.status !== "connected") {
    throw Object.assign(new Error(connection?.status === "reconnect_required" ? "Google Drive access expired. An admin needs to reconnect it." : "Google Drive is not connected."), { statusCode: 409 });
  }
  const ids = [...new Set((documentIds || []).map(String))].filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) throw Object.assign(new Error("Select at least one document."), { statusCode: 400 });
  if (ids.length > MAX_DOCUMENTS_PER_JOB) throw Object.assign(new Error(`You can add up to ${MAX_DOCUMENTS_PER_JOB} documents at a time.`), { statusCode: 400 });
  if (!folderId || typeof folderId !== "string") throw Object.assign(new Error("Choose a destination folder."), { statusCode: 400 });

  let folder;
  try {
    folder = await driveClient.getFolder(orgId, folderId);
  } catch (error) {
    if (error instanceof driveClient.DriveError) throw Object.assign(new Error(error.code === "NOT_FOUND" ? "That folder was not found, or the connected Google account cannot access it." : error.message), { statusCode: error.status && error.status < 500 ? error.status : 502 });
    throw error;
  }

  const docs = await Document.find({ _id: { $in: ids } }).lean();
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  const items = [];
  for (const id of ids) {
    const doc = byId.get(id);
    const item = { documentId: id, name: doc ? documentName(doc) : "Unknown document", status: "pending" };
    if (!doc || doc.deletedAt) Object.assign(item, { status: "skipped", reason: "Document not found." });
    else if (!(await documentService.canAccessDocument(user, doc)) || !(await petitionGate.viewerMaySee(user, doc))) Object.assign(item, { status: "skipped", reason: "You do not have access to this document." });
    else if (!hasFile(doc)) Object.assign(item, { status: "skipped", reason: "This document has no stored file." });
    items.push(item);
  }

  const job = await GoogleDriveJob.create({
    orgId,
    requestedBy: user._id,
    caseId: mongoose.isValidObjectId(caseId) ? caseId : undefined,
    folderId: folder.id,
    folderName: folder.name,
    folderLink: folder.webViewLink,
    force: Boolean(force),
    items,
    status: items.some((item) => item.status === "pending") ? "queued" : "completed", // nothing eligible: all skipped, each with its reason
    finishedAt: items.some((item) => item.status === "pending") ? undefined : new Date(),
  });
  await audit(user._id, "google_drive.sync_started", { jobId: String(job._id), documents: items.length, folderId: folder.id });
  if (items.some((item) => item.status === "pending")) startJob(job._id);
  return job.toObject();
}

function startJob(jobId) {
  const key = String(jobId);
  if (runningJobs.has(key)) return;
  runningJobs.add(key);
  // After the HTTP response has been sent; a failure here is logged and recorded on the job, never thrown into a request.
  setImmediate(() => {
    runJob(jobId)
      .catch((error) => logger.error("google_drive_job_crashed", { jobId: key, error }))
      .finally(() => runningJobs.delete(key));
  });
}

// ---- running a job ----
async function runJob(jobId) {
  await GoogleDriveJob.updateOne({ _id: jobId }, { $set: { status: "running", startedAt: new Date() }, $unset: { finishedAt: "" } });
  const job = await GoogleDriveJob.findById(jobId).lean();
  if (!job) return;
  const user = await User.findById(job.requestedBy);
  let fatal = null; // an auth/connection failure ends the whole job: every remaining file would fail the same way

  const pending = job.items.filter((item) => item.status === "pending");
  await Promise.all(
    pending.map(async (item) => {
      await acquireSlot();
      try {
        if (fatal) {
          await setItem(jobId, item.documentId, { status: "failed", reason: fatal.message, errorCode: fatal.code });
          return;
        }
        await processItem(job, item, user);
      } catch (error) {
        if (error instanceof driveClient.DriveError && ["RECONNECT_REQUIRED", "NOT_CONNECTED"].includes(error.code)) fatal = error;
        logger.warn("google_drive_item_failed", { jobId: String(jobId), documentId: String(item.documentId), code: error?.code, status: error?.status });
        await setItem(jobId, item.documentId, { status: "failed", reason: describeError(error), errorCode: error?.code || "ERROR" }).catch(() => {});
      } finally {
        releaseSlot();
      }
    })
  );
  await finalizeJob(jobId);
}

async function finalizeJob(jobId) {
  const job = await GoogleDriveJob.findById(jobId).lean();
  if (!job) return;
  const failed = job.items.filter((item) => item.status === "failed").length;
  const succeeded = job.items.filter((item) => ["synced", "updated"].includes(item.status)).length;
  const status = failed === 0 ? "completed" : failed === job.items.length ? "failed" : "completed_with_errors";
  await GoogleDriveJob.updateOne({ _id: jobId }, { $set: { status, finishedAt: new Date() } });
  if (succeeded) await GoogleDriveConnection.updateOne({ orgId: job.orgId }, { $set: { lastSuccessfulSyncAt: new Date() } }).catch(() => {});
  await audit(job.requestedBy, "google_drive.sync_finished", { jobId: String(jobId), status, succeeded, failed });
}

async function processItem(job, item, user) {
  const orgId = job.orgId;
  const lockKey = `${orgId}:${item.documentId}:${job.folderId}`;
  if (activeDocs.has(lockKey)) {
    await setItem(job._id, item.documentId, { status: "skipped", reason: "This file is already being added to this folder." });
    return;
  }
  activeDocs.add(lockKey);
  try {
    await setItem(job._id, item.documentId, { status: "uploading", attempts: (item.attempts || 0) + 1 });
    const doc = await Document.findById(item.documentId);
    if (!doc || doc.deletedAt) return setItem(job._id, item.documentId, { status: "skipped", reason: "Document was removed." });
    // The requester's access is checked again now, not just when the job was created.
    if (!user || !(await documentService.canAccessDocument(user, doc)) || !(await petitionGate.viewerMaySee(user, doc))) {
      return setItem(job._id, item.documentId, { status: "skipped", reason: "You no longer have access to this document." });
    }

    const buffer = await documentService.readDocumentBuffer(doc); // read-only; the Immiglance copy is never modified
    const sha = storageService.checksum(buffer);
    const localMd5 = driveClient.md5(buffer);
    const name = documentName(doc);
    const mimeType = doc.mimeType || doc.fileType || "application/octet-stream";
    const appProperties = { immiglanceDoc: String(doc._id), immiglanceOrg: orgId };

    let link = await GoogleDriveFileLink.findOne({ orgId, documentId: doc._id, driveFolderId: job.folderId });
    let meta = null;
    if (link) {
      try {
        meta = await driveClient.getFileMeta(orgId, link.driveFileId);
      } catch (error) {
        if (!(error instanceof driveClient.DriveError) || error.code !== "NOT_FOUND") throw error;
      }
      if (meta?.trashed) meta = null; // trashed in Drive: not silently restored; a new copy is added because the user asked for one
    }

    if (link && link.status === "linked" && meta && link.sourceChecksum === sha && !job.force) {
      return setItem(job._id, item.documentId, { status: "skipped", reason: "Already in Drive and unchanged.", driveFileId: link.driveFileId, webViewLink: meta.webViewLink || link.webViewLink });
    }

    let uploaded;
    let outcome = "synced";
    if (meta) {
      if (meta.md5Checksum && meta.md5Checksum === localMd5) {
        // A previous attempt uploaded this exact content but stopped before the link was saved: adopt it.
        uploaded = { id: meta.id, name: meta.name, webViewLink: meta.webViewLink, md5Checksum: meta.md5Checksum };
        if (link.status === "linked") outcome = "synced";
      } else {
        uploaded = await driveClient.uploadFile(orgId, { fileId: link.driveFileId, existing: true, name, mimeType, buffer });
        outcome = link.status === "linked" ? "updated" : "synced";
      }
    } else {
      // New copy: the Drive file ID is generated and saved BEFORE uploading so a crash cannot leave an untracked copy.
      const fileId = link && link.status === "pending" ? link.driveFileId : await driveClient.generateFileId(orgId);
      if (!link) {
        link = await GoogleDriveFileLink.create({ orgId, documentId: doc._id, caseId: doc.caseId, driveFolderId: job.folderId, driveFolderName: job.folderName, driveFileId: fileId, status: "pending" });
      } else if (link.driveFileId !== fileId || link.status === "linked") {
        link.driveFileId = fileId;
        link.status = "pending";
        await link.save();
      }
      uploaded = await driveClient.uploadFile(orgId, { fileId, existing: false, name, mimeType, buffer, parentId: job.folderId, appProperties });
    }

    if (uploaded.md5Checksum && uploaded.md5Checksum !== localMd5) {
      throw new driveClient.DriveError("Google Drive reported different content than was sent", { code: "VERIFY_FAILED", retryable: true });
    }
    await GoogleDriveFileLink.updateOne(
      { orgId, documentId: doc._id, driveFolderId: job.folderId },
      { $set: { driveFileId: uploaded.id, driveName: uploaded.name || name, webViewLink: uploaded.webViewLink, status: "linked", sourceChecksum: sha, sourceVersion: doc.currentVersion, driveMd5: localMd5, lastSyncedAt: new Date(), lastSyncedBy: job.requestedBy, driveFolderName: job.folderName, caseId: doc.caseId } }
    );
    await setItem(job._id, item.documentId, { status: outcome, reason: outcome === "updated" ? "Updated the existing Drive copy." : undefined, driveFileId: uploaded.id, webViewLink: uploaded.webViewLink });
  } finally {
    activeDocs.delete(lockKey);
  }
}

// ---- reading / retrying jobs ----
function canSeeJob(user, job) {
  return ADMIN_ROLES.has(String(user.role)) || String(job.requestedBy) === String(user._id);
}

// A job still "running" with no runner in this process (e.g. the server restarted) is closed out so it never hangs in the UI.
async function repairIfStale(job) {
  const idle = Date.now() - new Date(job.updatedAt).getTime();
  if (!["queued", "running"].includes(job.status) || runningJobs.has(String(job._id)) || idle < STALE_JOB_MS) return job;
  await GoogleDriveJob.updateOne(
    { _id: job._id },
    { $set: { "items.$[open].status": "failed", "items.$[open].reason": "Interrupted (the server restarted). Press Retry.", "items.$[open].errorCode": "INTERRUPTED" } },
    { arrayFilters: [{ "open.status": { $in: ["pending", "uploading"] } }] }
  );
  await finalizeJob(job._id);
  return GoogleDriveJob.findById(job._id).lean();
}

function present(job) {
  const counts = { total: job.items.length, pending: 0, uploading: 0, synced: 0, updated: 0, skipped: 0, failed: 0 };
  job.items.forEach((item) => {
    counts[item.status] += 1;
  });
  return { id: job._id, status: job.status, folderId: job.folderId, folderName: job.folderName, folderLink: job.folderLink, caseId: job.caseId, createdAt: job.createdAt, finishedAt: job.finishedAt, counts, items: job.items };
}

async function getJob(user, jobId) {
  if (!mongoose.isValidObjectId(jobId)) return null;
  let job = await GoogleDriveJob.findOne({ _id: jobId, orgId: resolveOrgId() }).lean();
  if (!job || !canSeeJob(user, job)) return null;
  job = await repairIfStale(job);
  return present(job);
}

async function retryJob(user, jobId) {
  const orgId = resolveOrgId();
  if (!mongoose.isValidObjectId(jobId)) return null;
  let job = await GoogleDriveJob.findOne({ _id: jobId, orgId }).lean();
  if (!job || !canSeeJob(user, job)) return null;
  job = await repairIfStale(job);
  if (["queued", "running"].includes(job.status)) throw Object.assign(new Error("This job is still running."), { statusCode: 409 });
  const connection = await GoogleDriveConnection.findOne({ orgId }).lean();
  if (!connection || connection.status !== "connected") throw Object.assign(new Error("Google Drive is not connected. An admin needs to reconnect it."), { statusCode: 409 });
  await GoogleDriveJob.updateOne(
    { _id: jobId },
    { $set: { status: "queued", "items.$[bad].status": "pending" }, $unset: { "items.$[bad].reason": "", "items.$[bad].errorCode": "", finishedAt: "" } },
    { arrayFilters: [{ "bad.status": "failed" }] }
  );
  await audit(user._id, "google_drive.sync_retried", { jobId: String(jobId) });
  startJob(jobId);
  return present(await GoogleDriveJob.findById(jobId).lean());
}

// Where each document already has a Drive copy (shown as a badge in the Add to Drive dialog).
async function lookupLinks(user, documentIds) {
  const orgId = resolveOrgId();
  const ids = [...new Set((documentIds || []).map(String))].filter((id) => mongoose.isValidObjectId(id)).slice(0, 300);
  if (!ids.length) return {};
  const links = await GoogleDriveFileLink.find({ orgId, documentId: { $in: ids }, status: "linked" }).select("documentId driveFolderName webViewLink lastSyncedAt").lean();
  if (!links.length) return {};
  const docs = await Document.find({ _id: { $in: [...new Set(links.map((link) => String(link.documentId)))] } }).lean();
  const allowed = new Set();
  for (const doc of docs) if (!doc.deletedAt && (await documentService.canAccessDocument(user, doc))) allowed.add(String(doc._id));
  const result = {};
  links.forEach((link) => {
    const key = String(link.documentId);
    if (!allowed.has(key)) return;
    (result[key] = result[key] || []).push({ folderName: link.driveFolderName, webViewLink: link.webViewLink, lastSyncedAt: link.lastSyncedAt });
  });
  return result;
}

async function recentFolders() {
  const jobs = await GoogleDriveJob.find({ orgId: resolveOrgId() }).sort({ createdAt: -1 }).limit(40).select("folderId folderName folderLink").lean();
  const seen = new Set();
  const folders = [];
  jobs.forEach((job) => {
    if (!seen.has(job.folderId)) {
      seen.add(job.folderId);
      folders.push({ id: job.folderId, name: job.folderName, webViewLink: job.folderLink });
    }
  });
  return folders.slice(0, 8);
}

module.exports = { MAX_DOCUMENTS_PER_JOB, createJob, getJob, isStaff, lookupLinks, recentFolders, retryJob };
