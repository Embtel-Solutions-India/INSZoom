// DB-free: Mongo models and Google Drive are replaced by in-memory fakes; the real sync.service logic runs against them.
// Run with: node --test src/modules/google-drive/tests/sync.service.test.js
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "k".repeat(44);

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const connectionService = require("../connection.service");
connectionService.ensureIndexes = async () => {};
connectionService.audit = async () => {};

const Document = require("../../../models/Document");
const User = require("../../../models/User");
const GoogleDriveConnection = require("../../../models/GoogleDriveConnection");
const GoogleDriveFileLink = require("../../../models/GoogleDriveFileLink");
const GoogleDriveJob = require("../../../models/GoogleDriveJob");
const documentService = require("../../documents/document.service");
const petitionGate = require("../../petition-review/petitionGate");
const driveClient = require("../drive.client");
const syncService = require("../sync.service");

const clone = (value) => structuredClone(value);
const oid = () => new (require("mongoose").Types.ObjectId)().toString();
const md5 = (text) => crypto.createHash("md5").update(text).digest("hex");

// ---- fakes ----
const world = { docs: new Map(), files: new Map(), jobs: new Map(), links: [], connection: { status: "connected" }, otherConnection: { status: "connected" }, buffers: new Map(), calls: [], failFor: new Map(), deniedDocs: new Set(), nextId: 1 };
const user = { _id: oid(), role: "case_manager" };

function reset() {
  Object.assign(world, { docs: new Map(), files: new Map(), jobs: new Map(), links: [], connection: { status: "connected" }, otherConnection: { status: "connected" }, buffers: new Map(), calls: [], failFor: new Map(), deniedDocs: new Set(), nextId: 1 });
}

function addDoc(name, content) {
  const _id = oid();
  world.docs.set(_id, { _id, originalFileName: name, storageKey: `k/${_id}`, mimeType: "application/pdf", currentVersion: 1 });
  world.buffers.set(_id, Buffer.from(content));
  return _id;
}

Document.find = (query) => ({ lean: async () => [...world.docs.values()].filter((doc) => query._id.$in.map(String).includes(String(doc._id))).map(clone) });
Document.findById = async (id) => (world.docs.has(String(id)) ? world.docs.get(String(id)) : null);
const otherUser = { _id: oid(), role: "case_manager" };
User.findById = async (id) => (String(id) === String(otherUser._id) ? otherUser : user);
// Each user has their own connection record; by default both users are connected.
GoogleDriveConnection.findOne = (query) => ({ lean: async () => clone(String(query.userId) === String(otherUser._id) ? world.otherConnection : world.connection) });
GoogleDriveConnection.updateOne = () => ({ catch: () => {} });
documentService.canAccessDocument = async (_user, doc) => !world.deniedDocs.has(String(doc._id));
documentService.readDocumentBuffer = async (doc) => world.buffers.get(String(doc._id));
petitionGate.viewerMaySee = async () => true;

const makeLink = (data) => {
  const link = { ...data, async save() { return this; } };
  world.links.push(link);
  return link;
};
GoogleDriveFileLink.findOne = async (query) => world.links.find((l) => String(l.userId) === String(query.userId) && String(l.documentId) === String(query.documentId) && l.driveFolderId === query.driveFolderId) || null;
GoogleDriveFileLink.create = async (data) => makeLink({ ...data, documentId: String(data.documentId), userId: String(data.userId) });
GoogleDriveFileLink.updateOne = async (query, update) => {
  const link = world.links.find((l) => String(l.userId) === String(query.userId) && String(l.documentId) === String(query.documentId) && l.driveFolderId === query.driveFolderId);
  Object.assign(link, update.$set);
};
GoogleDriveFileLink.find = () => ({ select: () => ({ lean: async () => [] }) });

GoogleDriveJob.create = async (data) => {
  const job = { ...clone(data), _id: oid(), createdAt: new Date(), updatedAt: new Date() };
  world.jobs.set(job._id, job);
  return { ...job, toObject: () => clone(job) };
};
GoogleDriveJob.find = (query) => {
  const rows = [...world.jobs.values()].filter((job) => String(job.requestedBy) === String(query.requestedBy));
  const chain = { sort: () => chain, limit: () => chain, select: () => chain, lean: async () => clone(rows) };
  return chain;
};
GoogleDriveJob.findById = (id) => ({ lean: async () => (world.jobs.has(String(id)) ? clone(world.jobs.get(String(id))) : null) });
GoogleDriveJob.findOne = (query) => ({ lean: async () => (world.jobs.has(String(query._id)) ? clone(world.jobs.get(String(query._id))) : null) });
GoogleDriveJob.updateOne = async (filter, update, options = {}) => {
  const job = world.jobs.get(String(filter._id));
  if (!job) return;
  const sets = update.$set || {};
  if (filter["items.documentId"]) {
    const item = job.items.find((i) => String(i.documentId) === String(filter["items.documentId"]));
    Object.entries(sets).forEach(([key, value]) => {
      item[key.replace("items.$.", "")] = value;
    });
  } else {
    Object.entries(sets).forEach(([key, value]) => {
      const match = key.match(/^items\.\$\[(\w+)\]\.(\w+)$/);
      if (!match) return void (job[key] = value);
      const wanted = options.arrayFilters.find((f) => Object.keys(f)[0].startsWith(`${match[1]}.`));
      const condition = Object.values(wanted)[0];
      job.items.filter((i) => (condition.$in ? condition.$in.includes(i.status) : i.status === condition)).forEach((i) => (i[match[2]] = value));
    });
  }
  Object.keys(update.$unset || {}).forEach((key) => {
    if (!key.includes("$")) delete job[key];
  });
  job.updatedAt = new Date();
};

driveClient.getFolder = async (_org, id) => ({ id, name: "Client Files", webViewLink: `https://drive.test/folders/${id}` });
driveClient.generateFileId = async () => `FILE-${world.nextId++}`;
driveClient.getFileMeta = async (_org, id) => {
  const file = world.files.get(id);
  if (!file) throw new driveClient.DriveError("not found", { status: 404, code: "NOT_FOUND" });
  return { id, name: file.name, trashed: file.trashed, md5Checksum: file.md5, webViewLink: `https://drive.test/file/${id}` };
};
driveClient.uploadFile = async (_org, { fileId, existing, name, buffer }) => {
  world.calls.push({ fileId, existing, name });
  const failure = [...world.failFor.entries()].find(([key]) => name === key);
  if (failure && failure[1].count > 0) {
    failure[1].count -= 1;
    throw failure[1].error;
  }
  world.files.set(fileId, { name, md5: md5(buffer.toString()), trashed: false });
  return { id: fileId, name, md5Checksum: md5(buffer.toString()), webViewLink: `https://drive.test/file/${fileId}` };
};

async function finished(jobId, who = user) {
  for (let i = 0; i < 200; i += 1) {
    const job = await syncService.getJob(who, jobId);
    if (job && !["queued", "running"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not finish");
}

async function run(documentIds, extra = {}, who = user) {
  const job = await syncService.createJob(who, { documentIds, folderId: "FOLDER-1", ...extra });
  return finished(job._id, who);
}

test("first add: copies every selected file once, links them, never touches the Immiglance documents", async () => {
  reset();
  const a = addDoc("passport.pdf", "AAA");
  const b = addDoc("degree.pdf", "BBB");
  const before = clone([...world.docs.values()]);
  const job = await run([a, b]);
  assert.equal(job.status, "completed");
  assert.deepEqual([job.counts.synced, job.counts.failed], [2, 0]);
  assert.equal(world.calls.length, 2);
  assert.ok(world.calls.every((call) => call.existing === false && call.fileId.startsWith("FILE-")));
  assert.equal(world.links.length, 2);
  assert.ok(world.links.every((link) => link.status === "linked" && link.sourceChecksum));
  assert.deepEqual([...world.docs.values()], before, "Immiglance document records unchanged");
  assert.equal(world.buffers.get(a).toString(), "AAA", "Immiglance file content unchanged");
});

test("adding the same unchanged file again uploads nothing", async () => {
  reset();
  const a = addDoc("passport.pdf", "AAA");
  await run([a]);
  world.calls.length = 0;
  const job = await run([a]);
  assert.equal(job.counts.skipped, 1);
  assert.match(job.items[0].reason, /unchanged/i);
  assert.equal(world.calls.length, 0);
  assert.equal(world.links.length, 1);
});

test("a changed file updates the SAME Drive file in place (no duplicate)", async () => {
  reset();
  const a = addDoc("passport.pdf", "AAA");
  await run([a]);
  const driveId = world.links[0].driveFileId;
  world.buffers.set(a, Buffer.from("AAA-v2"));
  world.calls.length = 0;
  const job = await run([a]);
  assert.equal(job.counts.updated, 1);
  assert.deepEqual(world.calls, [{ fileId: driveId, existing: true, name: "passport.pdf" }]);
  assert.equal(world.files.size, 1);
});

test("a Drive copy that was trashed or deleted is not silently restored: a fresh copy is added", async () => {
  reset();
  const a = addDoc("passport.pdf", "AAA");
  await run([a]);
  const oldId = world.links[0].driveFileId;
  world.files.get(oldId).trashed = true;
  const job = await run([a]);
  assert.equal(job.counts.synced, 1);
  assert.notEqual(world.links[0].driveFileId, oldId);
  assert.equal(world.files.get(oldId).trashed, true, "old trashed file left alone");
});

test("crash recovery: a copy uploaded before the link was saved is adopted, not duplicated", async () => {
  reset();
  const a = addDoc("passport.pdf", "AAA");
  makeLink({ userId: user._id, documentId: a, driveFolderId: "FOLDER-1", driveFileId: "LEFTOVER", status: "pending" });
  world.files.set("LEFTOVER", { name: "passport.pdf", md5: md5("AAA"), trashed: false });
  const job = await run([a]);
  assert.equal(job.counts.synced, 1);
  assert.equal(world.calls.length, 0, "no second upload");
  assert.equal(world.links[0].driveFileId, "LEFTOVER");
  assert.equal(world.links[0].status, "linked");
});

test("a pending link whose file was never created is retried with the SAME pre-generated ID", async () => {
  reset();
  const a = addDoc("passport.pdf", "AAA");
  makeLink({ userId: user._id, documentId: a, driveFolderId: "FOLDER-1", driveFileId: "RESERVED", status: "pending" });
  await run([a]);
  assert.deepEqual(world.calls, [{ fileId: "RESERVED", existing: false, name: "passport.pdf" }]);
});

test("inaccessible, missing and file-less documents are skipped with a reason; the rest still upload", async () => {
  reset();
  const ok = addDoc("ok.pdf", "OK");
  const denied = addDoc("secret.pdf", "S");
  world.deniedDocs.add(denied);
  const noFile = addDoc("empty.pdf", "E");
  delete world.docs.get(noFile).storageKey;
  const job = await run([ok, denied, noFile, oid()]);
  assert.equal(job.counts.synced, 1);
  assert.equal(job.counts.skipped, 3);
  assert.equal(world.calls.length, 1);
  assert.equal(job.status, "completed");
  assert.ok(job.items.filter((item) => item.status === "skipped").every((item) => item.reason));
});

test("partial failure: one file fails, the others succeed, and Retry re-sends only the failed one", async () => {
  reset();
  const a = addDoc("a.pdf", "A");
  const b = addDoc("b.pdf", "B");
  const c = addDoc("c.pdf", "C");
  world.failFor.set("b.pdf", { count: 1, error: new driveClient.DriveError("boom", { status: 503, code: "backendError", retryable: true }) });
  const job = await run([a, b, c]);
  assert.equal(job.status, "completed_with_errors");
  assert.deepEqual([job.counts.synced, job.counts.failed], [2, 1]);
  assert.match(job.items.find((i) => i.status === "failed").reason, /Retry/);
  world.calls.length = 0;
  await syncService.retryJob(user, job.id);
  const after = await finished(job.id);
  assert.equal(after.status, "completed");
  assert.deepEqual(world.calls.map((call) => call.name), ["b.pdf"], "only the failed file was re-sent");
});

test("revoked Google access stops the job cleanly: remaining files fail with the reconnect message", async () => {
  reset();
  const a = addDoc("a.pdf", "A");
  const b = addDoc("b.pdf", "B");
  driveClient.uploadFile = async () => {
    throw new driveClient.DriveError("Google Drive access was revoked or expired. An admin needs to reconnect it.", { status: 409, code: "RECONNECT_REQUIRED" });
  };
  const job = await run([a, b]);
  assert.equal(job.status, "failed");
  assert.ok(job.items.every((item) => item.status === "failed" && /reconnect/i.test(item.reason)));
});

test("not connected, no selection, over the limit and a bad folder are rejected before anything runs", async () => {
  reset();
  const a = addDoc("a.pdf", "A");
  world.connection = { status: "disconnected" };
  await assert.rejects(syncService.createJob(user, { documentIds: [a], folderId: "F" }), /Connect your Google Drive first/);
  world.connection = { status: "connected" };
  await assert.rejects(syncService.createJob(user, { documentIds: [], folderId: "F" }), /Select at least one/);
  await assert.rejects(syncService.createJob(user, { documentIds: Array.from({ length: 101 }, oid), folderId: "F" }), /up to 100/);
  await assert.rejects(syncService.createJob(user, { documentIds: [a] }), /destination folder/);
  const original = driveClient.getFolder;
  driveClient.getFolder = async () => {
    throw new driveClient.DriveError("nf", { status: 404, code: "NOT_FOUND" });
  };
  await assert.rejects(syncService.createJob(user, { documentIds: [a], folderId: "gone" }), /not found/i);
  driveClient.getFolder = original;
  assert.equal(world.jobs.size, 0);
});

test("a job is private to the user whose Drive it is: nobody else, not even an admin, can read or retry it", async () => {
  reset();
  driveClient.uploadFile = async (_o, { fileId, name, buffer }) => ({ id: fileId, name, md5Checksum: md5(buffer.toString()), webViewLink: "x" });
  const a = addDoc("a.pdf", "A");
  const job = await run([a]);
  assert.ok(await syncService.getJob({ _id: user._id, role: "case_manager" }, job.id));
  assert.equal(await syncService.getJob({ _id: oid(), role: "case_manager" }, job.id), null);
  assert.equal(await syncService.getJob({ _id: oid(), role: "admin" }, job.id), null);
  assert.equal(await syncService.retryJob({ _id: oid(), role: "super_admin" }, job.id), null);
  assert.equal(await syncService.getJob(user, "not-an-id"), null);
});

test("two users: each has their own Drive, copies and links; one user's copy never counts as another's", async () => {
  reset();
  driveClient.uploadFile = async (userId, { fileId, existing, name, buffer }) => {
    world.calls.push({ fileId, existing, name, userId: String(userId) });
    world.files.set(fileId, { name, md5: md5(buffer.toString()), trashed: false });
    return { id: fileId, name, md5Checksum: md5(buffer.toString()), webViewLink: `https://drive.test/file/${fileId}` };
  };
  const a = addDoc("passport.pdf", "AAA");
  const mine = await run([a], {}, user);
  const theirs = await run([a], {}, otherUser); // same document, same folder id string, different person's Drive
  assert.equal(mine.counts.synced, 1);
  assert.equal(theirs.counts.synced, 1, "not treated as already in Drive");
  assert.equal(world.links.length, 2);
  assert.notEqual(world.links[0].driveFileId, world.links[1].driveFileId);
  assert.deepEqual(world.calls.map((call) => call.userId), [String(user._id), String(otherUser._id)], "each upload used its own user's Drive");
  assert.equal(await syncService.getJob(otherUser, mine.id), null, "cannot read someone else's job");
  assert.deepEqual(await syncService.recentFolders(otherUser).then((r) => r.length), 1);
});

test("a user whose own Drive is not connected cannot add, even if a colleague's is connected", async () => {
  reset();
  world.otherConnection = { status: "disconnected" };
  const a = addDoc("a.pdf", "A");
  await assert.rejects(syncService.createJob(otherUser, { documentIds: [a], folderId: "F" }), /Connect your Google Drive first/);
  const job = await run([a], {}, user);
  assert.equal(job.counts.synced, 1);
});
