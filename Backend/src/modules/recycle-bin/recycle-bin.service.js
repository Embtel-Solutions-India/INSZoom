// Recycle bin for deleted cases: a deleted case is copied here (with its child cases, the client accounts the deletion removes and every linked record)
// BEFORE it is removed, and stays restorable for RETENTION_DAYS (30); then the copies and the uploaded files are removed for good.
//
//   capture   case-deletion.service calls createEntry() + storeDocs() while it deletes - nothing is removed that has not been copied first
//   restore   restoreEntry(): puts the same documents back with their original ids; never overwrites or deletes anything that exists
//   purge     purgeExpired() (hourly worker): removes the uploaded files and the copies of entries past their date
//
// The copies live in the "recyclebinchunks" collection as raw BSON (ids and dates keep their types), several documents per chunk, each chunk well under the
// 16 MB document limit. Collections whose records must not come back to life (login sessions, the GoHighLevel sync queue / card links) are not copied.
const mongoose = require("mongoose");
const RecycleBinEntry = require("../../models/RecycleBinEntry");
const logger = require("../../utils/logger");

const CHUNKS = "recyclebinchunks";
const RETENTION_DAYS = Number(process.env.RECYCLE_BIN_RETENTION_DAYS || 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_DOCS = 500;
// not copied: sessions are invalid after a restore anyway; the GoHighLevel queue/links would act on a card that was deleted with the case
const NOT_COPIED = new Set(["authsessions", "ghlsyncjobs", "ghlcaselinks", "ghlemployerlinks"]);
// never touched by the case sweep or by a restore
const BIN_COLLECTIONS = new Set(["recyclebinentries", CHUNKS]);

const enabled = () => String(process.env.RECYCLE_BIN_ENABLED || "true").toLowerCase() !== "false";
const retentionMs = () => RETENTION_DAYS * DAY_MS;
const db = () => mongoose.connection.db;
const sizeOf = (doc) => mongoose.mongo.BSON.calculateObjectSize(doc);

function conflict(message, code = "RECYCLE_BIN_CONFLICT", status = 409) {
  return Object.assign(new Error(message), { status, code });
}

async function createEntry({ jobId, caseDocs, userDocs, actor }) {
  const entry = await RecycleBinEntry.create({
    jobId,
    caseIds: caseDocs.map((doc) => doc._id),
    caseNumbers: caseDocs.map((doc) => doc.caseNumber).filter(Boolean),
    userIds: userDocs.map((doc) => doc._id),
    emails: userDocs.map((doc) => doc.email).filter(Boolean),
    clientNames: [...new Set(caseDocs.map((doc) => doc.clientName).filter(Boolean))],
    deletedBy: actor?._id,
    deletedByName: actor?.name || actor?.displayName || actor?.email,
    expiresAt: new Date(Date.now() + retentionMs()),
  });
  await storeDocs(entry._id, "cases", caseDocs);
  await storeDocs(entry._id, "users", userDocs);
  return entry;
}

// Copies `docs` of `collection` into the entry, in chunks. Throws when it cannot - the caller must then not delete the originals.
async function storeDocs(entryId, collection, docs) {
  if (!docs.length || NOT_COPIED.has(collection) || BIN_COLLECTIONS.has(collection)) return 0;
  const target = db().collection(CHUNKS);
  let seq = (await target.countDocuments({ entryId, collection }));
  let batch = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await target.insertOne({ entryId, collection, seq: seq += 1, docs: batch, createdAt: new Date() });
    batch = [];
    bytes = 0;
  };
  for (const doc of docs) {
    const size = sizeOf(doc);
    if (batch.length && (bytes + size > MAX_CHUNK_BYTES || batch.length >= MAX_CHUNK_DOCS)) await flush();
    batch.push(doc);
    bytes += size;
  }
  await flush();
  await RecycleBinEntry.updateOne({ _id: entryId }, { $inc: { [`counts.${collection}`]: docs.length } });
  return docs.length;
}

async function addFileKeys(entryId, keys) {
  if (keys.length) await RecycleBinEntry.updateOne({ _id: entryId }, { $addToSet: { fileKeys: { $each: keys } } });
}

async function markComplete(entryId) {
  await RecycleBinEntry.updateOne({ _id: entryId, status: "capturing" }, { $set: { status: "in_bin" } });
}

// ── restore ─────────────────────────────────────────────────────────────
async function insertSkippingExisting(collection, docs) {
  if (!docs.length) return 0;
  try {
    const result = await db().collection(collection).insertMany(docs, { ordered: false });
    return result.insertedCount;
  } catch (error) {
    const writeErrors = error.writeErrors || [];
    const onlyDuplicates = (error.code === 11000 || writeErrors.length) && (writeErrors.length ? writeErrors.every((item) => item.code === 11000) : true);
    if (!onlyDuplicates) throw error;
    return docs.length - (writeErrors.length || docs.length); // the rest already exist: left exactly as they are
  }
}

async function eachChunk(entryId, collection, handler) {
  const cursor = db().collection(CHUNKS).find({ entryId, collection }).sort({ seq: 1 });
  for await (const chunk of cursor) await handler(chunk.docs || []);
}

async function restoreEntry(entryId, actor) {
  const entry = await RecycleBinEntry.findOneAndUpdate({ _id: entryId, status: "in_bin" }, { $set: { status: "restoring", lastError: null } }, { new: true });
  if (!entry) throw conflict("This item is not in the recycle bin any more, or is still being saved to it.", "NOT_RESTORABLE", 404);
  try {
    if (entry.expiresAt <= new Date()) throw conflict("This item has passed its retention period and can no longer be restored.", "EXPIRED");
    const database = db();
    // nothing is overwritten: a case number or an account email that is in use again stops the restore
    const taken = await database.collection("cases").find({ $or: [{ _id: { $in: entry.caseIds } }, { caseNumber: { $in: entry.caseNumbers } }] }).project({ caseNumber: 1 }).toArray();
    if (taken.length) throw conflict(`Case ${taken.map((item) => item.caseNumber).join(", ")} already exists, so it cannot be restored.`, "CASE_EXISTS");
    if (entry.emails.length) {
      const users = await database.collection("users").find({ email: { $in: entry.emails }, _id: { $nin: entry.userIds } }).project({ email: 1 }).toArray();
      if (users.length) throw conflict(`An account with the email ${users[0].email} exists now, so the client account cannot be restored.`, "EMAIL_IN_USE");
    }
    const restored = {};
    const collections = [...new Set((await database.collection(CHUNKS).distinct("collection", { entryId: entry._id })))];
    const ordered = ["users", "cases", ...collections.filter((name) => name !== "users" && name !== "cases")];
    for (const collection of ordered) {
      if (!collections.includes(collection) || BIN_COLLECTIONS.has(collection)) continue;
      let count = 0;
      await eachChunk(entry._id, collection, async (docs) => { count += await insertSkippingExisting(collection, docs); });
      restored[collection] = count;
    }
    // re-attach what the deletion detached from records that were not deleted: the account's case list and a parent's child list
    const caseDocs = await database.collection("cases").find({ _id: { $in: entry.caseIds } }).project({ user: 1, parentCase: 1 }).toArray();
    for (const item of caseDocs) {
      if (item.user) await database.collection("users").updateOne({ _id: item.user }, { $addToSet: { caseIds: item._id } });
      if (item.parentCase && !entry.caseIds.some((id) => String(id) === String(item.parentCase))) {
        await database.collection("cases").updateOne({ _id: item.parentCase }, { $addToSet: { childCases: item._id } });
      }
    }
    await database.collection(CHUNKS).deleteMany({ entryId: entry._id });
    await RecycleBinEntry.updateOne({ _id: entry._id }, { $set: { status: "restored", restoredAt: new Date(), restoredBy: actor?._id }, $unset: { fileKeys: "" } });
    logger.info("recycle_bin_restored", { entryId: String(entry._id), caseNumbers: entry.caseNumbers, by: String(actor?._id || ""), restored });
    try {
      await require("../../models/AuditLog").create({ userId: actor?._id, userRole: actor?.role, action: "case_restored_from_recycle_bin", entityType: "case", entityId: entry.caseIds[0], changes: { caseNumbers: entry.caseNumbers, restored } });
    } catch (error) {
      logger.warn("recycle_bin_audit_failed", { error: error.message });
    }
    return { caseNumbers: entry.caseNumbers, caseIds: entry.caseIds, restored };
  } catch (error) {
    await RecycleBinEntry.updateOne({ _id: entry._id, status: "restoring" }, { $set: { status: "in_bin", lastError: error.message } });
    throw error;
  }
}

// ── purge ───────────────────────────────────────────────────────────────
// Removes the uploaded files, then the copies. A file that cannot be removed leaves the entry in place to be retried by the next run.
async function purgeEntry(entry) {
  const storage = require("../uploads/storage.service");
  for (const key of entry.fileKeys || []) await storage.deleteObject(key);
  await db().collection(CHUNKS).deleteMany({ entryId: entry._id });
  await RecycleBinEntry.updateOne({ _id: entry._id }, { $set: { status: "purged", purgedAt: new Date(), fileKeys: [], counts: {} } });
  logger.info("recycle_bin_purged", { entryId: String(entry._id), caseNumbers: entry.caseNumbers });
}

async function purgeExpired(limit = 20) {
  const due = await RecycleBinEntry.find({ status: { $in: ["capturing", "in_bin"] }, expiresAt: { $lte: new Date() } }).limit(limit);
  let purged = 0;
  for (const entry of due) {
    try {
      await purgeEntry(entry);
      purged += 1;
    } catch (error) {
      logger.error("recycle_bin_purge_failed", { entryId: String(entry._id), error: error.message });
    }
  }
  return purged;
}

// Immediate permanent removal of one entry (an admin's or super admin's explicit action).
async function purgeNow(entryId, actor) {
  const entry = await RecycleBinEntry.findOne({ _id: entryId, status: { $in: ["capturing", "in_bin"] } });
  if (!entry) throw conflict("This item is not in the recycle bin.", "NOT_IN_BIN", 404);
  await purgeEntry(entry);
  try {
    await require("../../models/AuditLog").create({ userId: actor?._id, userRole: actor?.role, action: "case_purged_from_recycle_bin", entityType: "case", entityId: entry.caseIds[0], changes: { caseNumbers: entry.caseNumbers } });
  } catch (error) {
    logger.warn("recycle_bin_audit_failed", { error: error.message });
  }
  return { caseNumbers: entry.caseNumbers };
}

async function listEntries() {
  const entries = await RecycleBinEntry.find({ status: { $in: ["in_bin", "capturing"] } }).sort({ createdAt: -1 }).limit(200).lean();
  const now = Date.now();
  return entries.map((entry) => ({
    _id: entry._id,
    caseNumbers: entry.caseNumbers,
    clientNames: entry.clientNames,
    deletedBy: entry.deletedByName || "",
    deletedAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    daysLeft: Math.max(0, Math.ceil((new Date(entry.expiresAt).getTime() - now) / DAY_MS)),
    counts: entry.counts || {},
    fileCount: (entry.fileKeys || []).length,
    status: entry.status,
    lastError: entry.lastError || undefined,
  }));
}

function startRecycleBinWorker() {
  const { withJobLock } = require("../../utils/jobLock");
  const intervalMs = Number(process.env.RECYCLE_BIN_PURGE_INTERVAL_MS || 60 * 60 * 1000);
  const run = () => withJobLock("recycle-bin-purge", intervalMs * 3, () => purgeExpired()).catch((error) => logger.error("recycle_bin_worker_failed", { error: error.message }));
  const first = setTimeout(run, Number(process.env.RECYCLE_BIN_INITIAL_DELAY_MS || 60 * 1000));
  first.unref?.();
  return setInterval(run, intervalMs);
}

module.exports = {
  enabled, createEntry, storeDocs, addFileKeys, markComplete, restoreEntry, purgeExpired, purgeNow, listEntries, startRecycleBinWorker,
  NOT_COPIED, BIN_COLLECTIONS, RETENTION_DAYS,
};
