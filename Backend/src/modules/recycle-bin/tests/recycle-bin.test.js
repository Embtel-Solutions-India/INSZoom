// Recycle bin for deleted cases. Local isolated test database only (test-utils/db.js); every record this file creates is removed again. Uploaded-file storage is
// replaced by a recorder, so nothing is deleted from real storage.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const storagePath = require.resolve("../../uploads/storage.service");
const deletedKeys = [];
require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: { deleteObject: async (key) => { deletedKeys.push(key); return true; } } };

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const RecycleBinEntry = require("../../../models/RecycleBinEntry");
const deletion = require("../../cases/case-deletion.service");
const bin = require("../recycle-bin.service");

const actor = { _id: new mongoose.Types.ObjectId(), name: "Admin Tester", role: "admin" };
const made = { users: [], cases: [] };
let db;
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`;

async function makeMatter() {
  const userId = new mongoose.Types.ObjectId();
  const email = `bin.${stamp()}@example.test`;
  await db.collection("users").insertOne({ _id: userId, email, name: "Bin Client", role: "client", isActive: true, password: "hash", caseIds: [] });
  const doc = await Case.create({ caseNumber: `TEST-BIN-${stamp()}`, visaType: "H-1B", clientName: "Bin Client", clientEmail: email, user: userId });
  await db.collection("users").updateOne({ _id: userId }, { $set: { caseIds: [doc._id] } });
  await db.collection("answers").insertOne({ caseId: doc._id, value: "kept in the bin" });
  await db.collection("documents").insertOne({ caseId: doc._id, name: "passport.pdf", storageKey: "k/passport", versions: [{ storageKey: "k/passport-v2" }] });
  await db.collection("tasks").insertOne({ caseId: doc._id, title: "linked task" });
  await db.collection("authsessions").insertOne({ userId, token: "x" });
  made.users.push(userId);
  made.cases.push(doc._id);
  return { doc, userId, email };
}
const live = async (collection, caseId) => db.collection(collection).countDocuments({ caseId });
const cleanup = async () => {
  const ids = made.cases;
  for (const name of ["answers", "documents", "tasks"]) await db.collection(name).deleteMany({ caseId: { $in: ids } }).catch(() => {});
  await db.collection("authsessions").deleteMany({ userId: { $in: made.users } }).catch(() => {});
  await db.collection("cases").deleteMany({ _id: { $in: ids } });
  await db.collection("users").deleteMany({ _id: { $in: made.users } });
  const entries = await RecycleBinEntry.find({ caseIds: { $in: ids } }).select("_id").lean();
  await db.collection("recyclebinchunks").deleteMany({ entryId: { $in: entries.map((e) => e._id) } });
  await RecycleBinEntry.deleteMany({ _id: { $in: entries.map((e) => e._id) } });
  await db.collection("casedeletionjobs").deleteMany({ caseIds: { $in: ids } });
};

test("DB: a deleted case leaves the live data at once, is copied to the bin, and its uploaded files are kept", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  db = mongoose.connection.db;
  deletedKeys.length = 0;
  const { doc, userId } = await makeMatter();

  const result = await deletion.deleteCasePermanently(doc, actor, { skipGhl: true });
  assert.deepEqual(result.caseNumbers, [doc.caseNumber]);
  assert.equal(await db.collection("cases").countDocuments({ _id: doc._id }), 0);
  assert.equal(await db.collection("users").countDocuments({ _id: userId }), 0);
  assert.equal(await live("answers", doc._id), 0);
  assert.equal(await live("documents", doc._id), 0);

  const entry = await RecycleBinEntry.findOne({ caseIds: doc._id }).lean();
  assert.equal(entry.status, "in_bin");
  assert.equal(entry.deletedByName, "Admin Tester");
  assert.deepEqual([entry.counts.cases, entry.counts.users, entry.counts.answers, entry.counts.documents, entry.counts.tasks], [1, 1, 1, 1, 1]);
  assert.equal(entry.counts.authsessions, undefined, "login sessions are not copied");
  assert.deepEqual([...entry.fileKeys].sort(), ["k/passport", "k/passport-v2"]);
  assert.deepEqual(deletedKeys, [], "no uploaded file is deleted while the case is in the bin");
  const days = (new Date(entry.expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30);
  assert.equal((await bin.listEntries()).filter((item) => item.caseNumbers.includes(doc.caseNumber)).length, 1);
});

test("DB: restoring puts every record back with its original id, keeps the files, and never overwrites", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  db = mongoose.connection.db;
  deletedKeys.length = 0;
  const { doc, userId } = await makeMatter();
  await deletion.deleteCasePermanently(doc, actor, { skipGhl: true });
  const entry = await RecycleBinEntry.findOne({ caseIds: doc._id });

  // a case number that is in use again blocks the restore, and the item stays in the bin
  const blocker = await Case.create({ caseNumber: doc.caseNumber, visaType: "H-1B", clientName: "Someone else" });
  made.cases.push(blocker._id);
  await assert.rejects(() => bin.restoreEntry(entry._id, actor), (error) => error.code === "CASE_EXISTS");
  assert.equal((await RecycleBinEntry.findById(entry._id)).status, "in_bin");
  await db.collection("cases").deleteOne({ _id: blocker._id });

  const restored = await bin.restoreEntry(entry._id, actor);
  assert.deepEqual(restored.caseNumbers, [doc.caseNumber]);
  const back = await db.collection("cases").findOne({ _id: doc._id });
  assert.equal(back.caseNumber, doc.caseNumber);
  assert.equal(String(back.user), String(userId));
  const account = await db.collection("users").findOne({ _id: userId });
  assert.equal(account.password, "hash");
  assert.deepEqual(account.caseIds.map(String), [String(doc._id)]);
  assert.equal(await live("answers", doc._id), 1);
  assert.equal(await live("documents", doc._id), 1);
  assert.equal(await live("tasks", doc._id), 1);
  assert.equal((await RecycleBinEntry.findById(entry._id)).status, "restored");
  assert.equal(await db.collection("recyclebinchunks").countDocuments({ entryId: entry._id }), 0);
  assert.deepEqual(deletedKeys, [], "restoring does not touch the stored files");
  // a restored item cannot be restored twice
  await assert.rejects(() => bin.restoreEntry(entry._id, actor), (error) => error.code === "NOT_RESTORABLE");
});

test("DB: after the retention period the copies and the uploaded files are removed for good", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  db = mongoose.connection.db;
  deletedKeys.length = 0;
  const { doc } = await makeMatter();
  await deletion.deleteCasePermanently(doc, actor, { skipGhl: true });
  const entry = await RecycleBinEntry.findOne({ caseIds: doc._id });

  assert.equal(await bin.purgeExpired(), 0, "nothing is purged before its date");
  await RecycleBinEntry.updateOne({ _id: entry._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.ok((await bin.purgeExpired()) >= 1);
  assert.deepEqual([...deletedKeys].sort(), ["k/passport", "k/passport-v2"]);
  assert.equal(await db.collection("recyclebinchunks").countDocuments({ entryId: entry._id }), 0);
  assert.equal((await RecycleBinEntry.findById(entry._id)).status, "purged");
  await assert.rejects(() => bin.restoreEntry(entry._id, actor), (error) => error.code === "NOT_RESTORABLE");
});

test("DB: skipRecycleBin deletes at once as before, and a deletion never goes ahead without its backup", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  db = mongoose.connection.db;
  deletedKeys.length = 0;
  const direct = await makeMatter();
  await deletion.deleteCasePermanently(direct.doc, actor, { skipGhl: true, skipRecycleBin: true });
  assert.equal(await RecycleBinEntry.countDocuments({ caseIds: direct.doc._id }), 0);
  assert.deepEqual([...deletedKeys].sort(), ["k/passport", "k/passport-v2"]);
  assert.equal(await live("answers", direct.doc._id), 0);

  const guarded = await makeMatter();
  const original = bin.createEntry;
  bin.createEntry = async () => { throw new Error("disk full"); };
  try {
    await assert.rejects(() => deletion.requestCaseDeletion(guarded.doc, actor, { skipGhl: true }), (error) => error.code === "RECYCLE_BIN_UNAVAILABLE");
  } finally {
    bin.createEntry = original;
  }
  assert.equal(await db.collection("cases").countDocuments({ _id: guarded.doc._id }), 1, "the case is still there");
  assert.equal(await live("answers", guarded.doc._id), 1);
});
