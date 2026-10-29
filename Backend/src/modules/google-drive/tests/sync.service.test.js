// DB-free: Mongo models and Google Drive are replaced by in-memory fakes; the real sync + connection services run against them.
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
const world = { docs: new Map(), files: new Map(), jobs: new Map(), links: [], conns: [], buffers: new Map(), calls: [], failFor: new Map(), deniedDocs: new Set(), nextId: 1 };
const user = { _id: oid(), role: "case_manager" };
const otherUser = { _id: oid(), role: "case_manager" };
let tick = 0;

function addAccount(owner, { email, status = "connected", active = false } = {}) {
  const conn = { _id: oid(), userId: String(owner._id), googleAccountId: `g-${oid()}`, googleEmail: email, status, active, scopes: [driveClient.REQUIRED_SCOPE], connectedAt: new Date(Date.now() + tick++ * 1000) };
  world.conns.push(conn);
  return conn;
}

let mainAccount;
let otherAccount;
function reset() {
  Object.assign(world, { docs: new Map(), files: new Map(), jobs: new Map(), links: [], conns: [], buffers: new Map(), calls: [], failFor: new Map(), deniedDocs: new Set(), nextId: 1 });
  mainAccount = addAccount(user, { email: "me@work.com", active: true });
  otherAccount = addAccount(otherUser, { email: "them@work.com", active: true });
}

function addDoc(name, content) {
  const _id = oid();
  world.docs.set(_id, { _id, originalFileName: name, storageKey: `k/${_id}`, mimeType: "application/pdf", currentVersion: 1 });
  world.buffers.set(_id, Buffer.from(content));
  return _id;
}

Document.find = (query) => ({ lean: async () => [...world.docs.values()].filter((doc) => query._id.$in.map(String).includes(String(doc._id))).map(clone) });
Document.findById = async (id) => (world.docs.has(String(id)) ? world.docs.get(String(id)) : null);
User.findById = async (id) => (String(id) === String(otherUser._id) ? otherUser : user);

const connMatches = (c, q) => (!q._id || String(c._id) === String(q._id)) && (!q.userId || String(c.userId) === String(q.userId)) && (!q.status?.$ne || c.status !== q.status.$ne);
GoogleDriveConnection.find = (q) => {
  const rows = world.conns.filter((c) => connMatches(c, q));
  const chain = { sort: () => chain, lean: async () => clone([...rows].sort((a, b) => b.connectedAt - a.connectedAt)) };
  return chain;
};
GoogleDriveConnection.findOne = (q) => {
  const row = world.conns.find((c) => connMatches(c, q)) || null;
  return { lean: async () => clone(row), select: async () => row };
};
GoogleDriveConnection.updateOne = async (q, update) => { const c = world.conns.find((x) => String(x._id) === String(q._id)); if (c) Object.assign(c, update.$set || {}); };
GoogleDriveConnection.updateMany = async (q, update) => { world.conns.filter((c) => String(c.userId) === String(q.userId) && String(c._id) !== String(q._id?.$ne)).forEach((c) => Object.assign(c, update.$set || {})); };
GoogleDriveConnection.deleteOne = async (q) => { world.conns = world.conns.filter((c) => String(c._id) !== String(q._id)); };

documentService.canAccessDocument = async (_user, doc) => !world.deniedDocs.has(String(doc._id));
documentService.readDocumentBuffer = async (doc) => world.buffers.get(String(doc._id));
petitionGate.viewerMaySee = async () => true;

const makeLink = (data) => {
  const link = { ...data, async save() { return this; } };
  world.links.push(link);
  return link;
};
const linkMatches = (l, q) => String(l.connectionId) === String(q.connectionId) && String(l.documentId) === String(q.documentId) && l.driveFolderId === q.driveFolderId;
GoogleDriveFileLink.findOne = async (query) => world.links.find((l) => linkMatches(l, query)) || null;
GoogleDriveFileLink.create = async (data) => makeLink({ ...data, documentId: String(data.documentId), connectionId: String(data.connectionId) });
GoogleDriveFileLink.updateOne = async (query, update) => { Object.assign(world.links.find((l) => linkMatches(l, query)), update.$set); };
GoogleDriveFileLink.deleteMany = async (q) => { world.links = world.links.filter((l) => String(l.connectionId) !== String(q.connectionId)); };
GoogleDriveFileLink.find = () => ({ select: () => ({ lean: async () => [] }) });

GoogleDriveJob.create = async (data) => {
  const job = { ...clone(data), _id: oid(), createdAt: new Date(), updatedAt: new Date() };
  world.jobs.set(job._id, job);
  return { ...job, toObject: () => clone(job) };
};
GoogleDriveJob.find = (query) => {
  const rows = [...world.jobs.values()].filter((job) => String(job.requestedBy) === String(query.requestedBy) && (!query.connectionId || String(job.connectionId) === String(query.connectionId)));
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
    Object.entries(sets).forEach(([key, value]) => { item[key.replace("items.$.", "")] = value; });
  } else {
    Object.entries(sets).forEach(([key, value]) => {
      const match = key.match(/^items\.\$\[(\w+)\]\.(\w+)$/);
      if (!match) return void (job[key] = value);
      const wanted = options.arrayFilters.find((f) => Object.keys(f)[0].startsWith(`${match[1]}.`));
      const condition = Object.values(wanted)[0];
      job.items.filter((i) => (condition.$in ? condition.$in.includes(i.status) : i.status === condition)).forEach((i) => (i[match[2]] = value));
    });
  }
  Object.keys(update.$unset || {}).forEach((key) => { if (!key.includes("$")) delete job[key]; });
  job.updatedAt = new Date();
};

driveClient.getFolder = async (_conn, id) => ({ id, name: "Client Files", webViewLink: `https://drive.test/folders/${id}` });
driveClient.generateFileId = async () => `FILE-${world.nextId++}`;
driveClient.getFileMeta = async (_conn, id) => {
  const file = world.files.get(id);
  if (!file) throw new driveClient.DriveError("not found", { status: 404, code: "NOT_FOUND" });
  return { id, name: file.name, trashed: file.trashed, md5Checksum: file.md5, webViewLink: `https://drive.test/file/${id}` };
};
const defaultUpload = async (connectionId, { fileId, existing, name, buffer }) => {
  world.calls.push({ fileId, existing, name, connectionId: String(connectionId) });
  const failure = [...world.failFor.entries()].find(([key]) => name === key);
  if (failure && failure[1].count > 0) {
    failure[1].count -= 1;
    throw failure[1].error;
  }
  world.files.set(fileId, { name, md5: md5(buffer.toString()), trashed: false });
  return { id: fileId, name, md5Checksum: md5(buffer.toString()), webViewLink: `https://drive.test/file/${fileId}` };
};
driveClient.uploadFile = defaultUpload;

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
  driveClient.uploadFile = defaultUpload;
  const a = addDoc("passport.pdf", "AAA");
  const b = addDoc("degree.pdf", "BBB");
  const before = clone([...world.docs.values()]);
  const job = await run([a, b]);
  assert.equal(job.status, "completed");
  assert.deepEqual([job.counts.synced, job.counts.failed], [2, 0]);
  assert.equal(world.calls.length, 2);
  assert.ok(world.calls.every((call) => call.existing === false && call.fileId.startsWith("FILE-") && call.connectionId === String(mainAccount._id)));
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
  assert.deepEqual(world.calls.map(({ fileId, existing, name }) => ({ fileId, existing, name })), [{ fileId: driveId, existing: true, name: "passport.pdf" }]);
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
  makeLink({ connectionId: String(mainAccount._id), documentId: a, driveFolderId: "FOLDER-1", driveFileId: "LEFTOVER", status: "pending" });
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
  makeLink({ connectionId: String(mainAccount._id), documentId: a, driveFolderId: "FOLDER-1", driveFileId: "RESERVED", status: "pending" });
  await run([a]);
  assert.deepEqual(world.calls.map(({ fileId, existing, name }) => ({ fileId, existing, name })), [{ fileId: "RESERVED", existing: false, name: "passport.pdf" }]);
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
  driveClient.uploadFile = defaultUpload;
});

test("not connected, no selection, over the limit and a bad folder are rejected before anything runs", async () => {
  reset();
  const a = addDoc("a.pdf", "A");
  world.conns = world.conns.filter((c) => String(c.userId) !== String(user._id));
  await assert.rejects(syncService.createJob(user, { documentIds: [a], folderId: "F" }), (error) => /Connect your Google Drive first/.test(error.message) && error.code === "NOT_CONNECTED");
  mainAccount = addAccount(user, { email: "me@work.com", active: true });
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
  const a = addDoc("passport.pdf", "AAA");
  const mine = await run([a], {}, user);
  const theirs = await run([a], {}, otherUser); // same document, same folder id string, different person's Drive
  assert.equal(mine.counts.synced, 1);
  assert.equal(theirs.counts.synced, 1, "not treated as already in Drive");
  assert.equal(world.links.length, 2);
  assert.notEqual(world.links[0].driveFileId, world.links[1].driveFileId);
  assert.deepEqual(world.calls.map((call) => call.connectionId), [String(mainAccount._id), String(otherAccount._id)], "each upload used its own user's account");
  assert.equal(await syncService.getJob(otherUser, mine.id), null, "cannot read someone else's job");
  assert.equal((await syncService.recentFolders(otherUser)).length, 1);
});

test("a user whose own Drive is not connected cannot add, even if a colleague's is connected", async () => {
  reset();
  world.conns = world.conns.filter((c) => String(c.userId) !== String(otherUser._id));
  const a = addDoc("a.pdf", "A");
  await assert.rejects(syncService.createJob(otherUser, { documentIds: [a], folderId: "F" }), /Connect your Google Drive first/);
  const job = await run([a], {}, user);
  assert.equal(job.counts.synced, 1);
});

// ---------- several Google accounts per user ----------

test("accounts: a user can hold several; the newest connected is listed first and exactly one is active", async () => {
  reset();
  addAccount(user, { email: "personal@gmail.com" });
  const status = await connectionService.getStatus(user);
  assert.equal(status.accounts.length, 2);
  assert.equal(status.accounts.filter((account) => account.active).length, 1);
  assert.equal(status.email, "me@work.com");
  assert.equal(status.connected, true);
  assert.equal(status.accounts[0].email, "personal@gmail.com", "newest first");
});

test("accounts: switching the active account sends the next add to THAT Drive, and copies are tracked per account", async () => {
  reset();
  const second = addAccount(user, { email: "personal@gmail.com" });
  const a = addDoc("passport.pdf", "AAA");

  const first = await run([a]);
  assert.equal(first.counts.synced, 1);
  assert.equal(world.calls.at(-1).connectionId, String(mainAccount._id));

  assert.ok(await connectionService.activate(user, second._id));
  assert.equal((await connectionService.getStatus(user)).email, "personal@gmail.com");
  const afterSwitch = await run([a]); // same document + same folder id string, but a different Google account
  assert.equal(afterSwitch.counts.synced, 1, "not 'already in Drive': that copy lives in the other account");
  assert.equal(world.calls.at(-1).connectionId, String(second._id));
  assert.equal(world.links.length, 2);

  await connectionService.activate(user, mainAccount._id);
  world.calls.length = 0;
  const back = await run([a]);
  assert.equal(back.counts.skipped, 1, "switching back finds the original account's copy again");
  assert.equal(world.calls.length, 0);
});

test("accounts: a job keeps using the account it started with, even if the user switches meanwhile", async () => {
  reset();
  const second = addAccount(user, { email: "personal@gmail.com" });
  const a = addDoc("a.pdf", "A");
  world.failFor.set("a.pdf", { count: 1, error: new driveClient.DriveError("boom", { status: 503, code: "backendError", retryable: true }) });
  const job = await run([a]);
  assert.equal(job.counts.failed, 1);
  await connectionService.activate(user, second._id); // user switches away before retrying
  world.calls.length = 0;
  await syncService.retryJob(user, job.id);
  await finished(job.id);
  assert.equal(world.calls[0].connectionId, String(mainAccount._id), "the retry went to the original account");
});

test("accounts: one account needing a reconnect does not block the others; the error says which action to take", async () => {
  reset();
  const second = addAccount(user, { email: "personal@gmail.com" });
  mainAccount.status = "reconnect_required";
  const a = addDoc("a.pdf", "A");
  await assert.rejects(syncService.createJob(user, { documentIds: [a], folderId: "F" }), (error) => error.code === "RECONNECT_REQUIRED" && /reconnected|switch/i.test(error.message));
  await connectionService.activate(user, second._id);
  const job = await run([a]);
  assert.equal(job.counts.synced, 1, "the other account works");
  assert.equal((await connectionService.getStatus(user)).accounts.length, 2, "the account needing reconnect is still listed");
});

test("accounts: a user cannot switch to, or remove, someone else's account", async () => {
  reset();
  assert.equal(await connectionService.activate(user, otherAccount._id), null);
  assert.equal(await connectionService.removeAccount(user, otherAccount._id), null);
  assert.equal(world.conns.some((c) => String(c._id) === String(otherAccount._id)), true);
  assert.equal((await connectionService.getStatus(otherUser)).email, "them@work.com");
});

test("accounts: removing the active account deletes its copy records and promotes another; removing the last one disconnects", async () => {
  reset();
  const second = addAccount(user, { email: "personal@gmail.com" });
  const a = addDoc("a.pdf", "A");
  await run([a]);
  assert.equal(world.links.length, 1);

  assert.deepEqual(await connectionService.removeAccount(user, mainAccount._id), { removed: true });
  assert.equal(world.links.length, 0, "records of copies in the removed account are gone");
  const status = await connectionService.getStatus(user);
  assert.equal(status.email, "personal@gmail.com", "the remaining account became active");
  assert.equal(status.connected, true);

  await connectionService.removeAccount(user, second._id);
  const empty = await connectionService.getStatus(user);
  assert.equal(empty.connected, false);
  assert.equal(empty.accounts.length, 0);
});

test("accounts: a user with accounts but none marked active is never asked to connect again (the newest usable one is promoted)", async () => {
  reset();
  world.conns.forEach((c) => { c.active = false; });
  const status = await connectionService.getStatus(user);
  assert.equal(status.connected, true);
  assert.equal(status.email, "me@work.com");
});

// ---------- connecting accounts (OAuth start + callback) ----------

require("../../../models/AuditLog").create = async () => ({}); // the audit write inside the connection service is fire-and-forget
// startConnect runs the real index set-up; give it a database that has nothing to clean up and accepts index creation.
for (const model of [GoogleDriveConnection, GoogleDriveFileLink, GoogleDriveJob, require("../../../models/GoogleDriveOAuthState")]) {
  model.collection.indexes = async () => [];
  model.collection.dropIndex = async () => {};
  model.createIndexes = async () => {};
}

const GoogleDriveOAuthState = require("../../../models/GoogleDriveOAuthState");
const stateRows = [];
GoogleDriveOAuthState.create = async (row) => { stateRows.push({ ...row }); return row; };
GoogleDriveOAuthState.findOneAndUpdate = async (filter) => {
  const row = stateRows.find((r) => r.stateHash === filter.stateHash && !r.usedAt);
  if (!row) return null;
  const before = { ...row };
  row.usedAt = new Date();
  return before;
};
GoogleDriveConnection.findOneAndUpdate = async (filter, update) => {
  let conn = world.conns.find((c) => String(c.userId) === String(filter.userId) && c.googleAccountId === filter.googleAccountId);
  if (!conn) {
    conn = { _id: oid(), userId: String(filter.userId), googleAccountId: filter.googleAccountId };
    world.conns.push(conn);
  }
  Object.assign(conn, update.$set);
  Object.keys(update.$unset || {}).forEach((key) => delete conn[key]);
  return conn;
};

// A real OAuth client (offline URL building) whose token exchange is replaced by a canned Google response.
function stubGoogle({ tokens, payload }) {
  const realNew = driveClient.newOAuthClient;
  driveClient.newOAuthClient = () => {
    const client = realNew();
    client.getToken = async () => ({ tokens });
    client.verifyIdToken = async () => ({ getPayload: () => payload });
    return client;
  };
  return () => { driveClient.newOAuthClient = realNew; };
}
const GOOD = { refresh_token: "rt-1", id_token: "id", scope: `openid https://www.googleapis.com/auth/userinfo.email ${driveClient.REQUIRED_SCOPE}` };
const query = (url) => Object.fromEntries(new URL(url).searchParams);

test("connect: the Google URL asks for the account picker, offline access, PKCE and only the configured Drive scope; state is stored hashed", async () => {
  reset();
  stateRows.length = 0;
  const { authUrl } = await connectionService.startConnect(user, "/crm-cases/abc");
  const params = query(authUrl);
  assert.equal(params.access_type, "offline");
  assert.equal(params.prompt, "select_account consent");
  assert.equal(params.code_challenge_method, "S256");
  assert.ok(params.code_challenge);
  assert.equal(params.scope, `${driveClient.REQUIRED_SCOPE} openid email`, "exactly the configured Drive scope, nothing extra");
  assert.ok(!/drive\.readonly|drive\.metadata|drive\.appdata/.test(params.scope), "no other Drive scope is ever requested");
  assert.notEqual(params.include_granted_scopes, "true");
  assert.equal(stateRows.length, 1);
  assert.notEqual(stateRows[0].stateHash, params.state, "only a hash of the state is stored");
  assert.equal(String(stateRows[0].userId), String(user._id));
  assert.equal(stateRows[0].returnPath, "/crm-cases/abc");
  assert.ok(!JSON.stringify(stateRows[0]).includes(params.code_challenge), "the PKCE verifier is stored encrypted, never in clear");
});

test("connect: a second Google account is ADDED and becomes active; the first stays connected", async () => {
  reset();
  stateRows.length = 0;
  const { authUrl } = await connectionService.startConnect(user, "/crm-cases/abc");
  const restore = stubGoogle({ tokens: GOOD, payload: { sub: "google-sub-2", email: "personal@gmail.com" } });
  try {
    const redirect = query(await connectionService.handleCallback({ code: "c", state: query(authUrl).state }));
    assert.equal(redirect.gdrive, "connected");
  } finally { restore(); }
  const mine = world.conns.filter((c) => String(c.userId) === String(user._id));
  assert.equal(mine.length, 2);
  assert.equal(mine.find((c) => c.googleEmail === "me@work.com").status, "connected", "the first account is untouched");
  assert.equal(mine.filter((c) => c.active).length, 1);
  assert.equal(mine.find((c) => c.active).googleEmail, "personal@gmail.com");
  assert.ok(mine.find((c) => c.googleEmail === "personal@gmail.com").refreshTokenEnc.startsWith("v1."), "token stored encrypted");
  assert.ok(!JSON.stringify(world.conns).includes("rt-1"), "the refresh token never appears in clear");
  assert.equal(world.conns.filter((c) => String(c.userId) === String(otherUser._id)).length, 1, "nobody else's accounts changed");
});

test("connect: connecting the SAME Google account again refreshes it (no duplicate) and clears the reconnect flag", async () => {
  reset();
  stateRows.length = 0;
  mainAccount.googleAccountId = "google-sub-1";
  mainAccount.status = "reconnect_required";
  mainAccount.lastError = { code: "invalid_grant" };
  const { authUrl } = await connectionService.startConnect(user, "/");
  const restore = stubGoogle({ tokens: GOOD, payload: { sub: "google-sub-1", email: "me@work.com" } });
  try { await connectionService.handleCallback({ code: "c", state: query(authUrl).state }); } finally { restore(); }
  const mine = world.conns.filter((c) => String(c.userId) === String(user._id));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, "connected");
  assert.equal(mine[0].lastError, undefined);
});

test("connect: replayed, unknown, cancelled, scope-less and identity-less callbacks are all rejected without saving anything", async () => {
  reset();
  stateRows.length = 0;
  const before = JSON.stringify(world.conns);
  const reason = async (q) => query(await connectionService.handleCallback(q)).reason;

  assert.equal(await reason({ code: "c", state: "never-issued" }), "invalid_state");
  assert.equal(await reason({ code: "c" }), "invalid_state");

  const first = (await connectionService.startConnect(user, "/")).authUrl;
  assert.equal(await reason({ error: "access_denied", state: query(first).state }), "cancelled");
  assert.equal(await reason({ code: "c", state: query(first).state }), "invalid_state", "state is single use, even after a cancelled attempt");

  let restore = stubGoogle({ tokens: { ...GOOD, scope: "openid email" }, payload: { sub: "s", email: "e@x.com" } });
  const second = (await connectionService.startConnect(user, "/")).authUrl;
  assert.equal(await reason({ code: "c", state: query(second).state }), "scope_missing");
  restore();

  restore = stubGoogle({ tokens: { ...GOOD, refresh_token: undefined }, payload: { sub: "s", email: "e@x.com" } });
  const third = (await connectionService.startConnect(user, "/")).authUrl;
  assert.equal(await reason({ code: "c", state: query(third).state }), "no_refresh_token");
  restore();

  restore = stubGoogle({ tokens: GOOD, payload: { email: "e@x.com" } });
  const fourth = (await connectionService.startConnect(user, "/")).authUrl;
  assert.equal(await reason({ code: "c", state: query(fourth).state }), "no_identity");
  restore();

  assert.equal(JSON.stringify(world.conns), before, "no connection was created or changed by any rejected callback");
});

test("connect: the saved account belongs to the user who started the flow, whoever completes the callback", async () => {
  reset();
  stateRows.length = 0;
  const { authUrl } = await connectionService.startConnect(otherUser, "/");
  const restore = stubGoogle({ tokens: GOOD, payload: { sub: "sub-x", email: "colleague@work.com" } });
  try { await connectionService.handleCallback({ code: "c", state: query(authUrl).state }); } finally { restore(); }
  assert.equal(world.conns.filter((c) => String(c.userId) === String(user._id)).length, 1, "the other user's connect did not touch this user");
  assert.equal(world.conns.filter((c) => String(c.userId) === String(otherUser._id)).length, 2);
});

test("connect: a hostile return path cannot become an open redirect", async () => {
  reset();
  stateRows.length = 0;
  const { authUrl } = await connectionService.startConnect(user, "//evil.example/steal");
  const restore = stubGoogle({ tokens: GOOD, payload: { sub: "s9", email: "z@x.com" } });
  let url;
  try { url = new URL(await connectionService.handleCallback({ code: "c", state: query(authUrl).state })); } finally { restore(); }
  assert.notEqual(url.hostname, "evil.example");
  assert.equal(url.pathname, "/");
});

// ---------- the Drive permission (GOOGLE_DRIVE_SCOPES) ----------

test("scope: the app asks Google for exactly the configured Drive scope (+ openid, email), never anything wider", async () => {
  assert.deepEqual(driveClient.SCOPES, [driveClient.REQUIRED_SCOPE, "openid", "email"]);
  assert.ok([driveClient.DRIVE_FILE_SCOPE, driveClient.DRIVE_FULL_SCOPE].includes(driveClient.REQUIRED_SCOPE));
});

test("scope: an account saved with a narrower grant than the app now needs is flagged for ONE reconnect, with the reason, and not used", async () => {
  reset();
  const narrow = driveClient.REQUIRED_SCOPE === driveClient.DRIVE_FULL_SCOPE ? [driveClient.DRIVE_FILE_SCOPE, "openid"] : [];
  if (driveClient.REQUIRED_SCOPE === driveClient.DRIVE_FILE_SCOPE) return; // nothing is narrower than drive.file with a populated list
  mainAccount.scopes = narrow;
  const status = await connectionService.getStatus(user);
  assert.equal(status.connected, false);
  assert.equal(status.status, "reconnect_required");
  assert.match(status.lastError, /whole Google Drive/);
  assert.equal(status.accounts[0].status, "reconnect_required");
  assert.equal(mainAccount.status, "connected", "stored status untouched: it is only a derived state");
  const a = addDoc("a.pdf", "A");
  await assert.rejects(syncService.createJob(user, { documentIds: [a], folderId: "F" }), (error) => error.code === "RECONNECT_REQUIRED" && /whole Google Drive/.test(error.message));
  assert.equal(world.calls.length, 0);
  // reconnecting (a fresh grant with the full scope) clears it
  mainAccount.scopes = [driveClient.REQUIRED_SCOPE];
  assert.equal((await connectionService.getStatus(user)).connected, true);
});

test("scope: hasRequiredScope rules (legacy records, narrow vs full grants)", async () => {
  const { DRIVE_FILE_SCOPE, DRIVE_FULL_SCOPE, REQUIRED_SCOPE, hasRequiredScope } = driveClient;
  assert.equal(hasRequiredScope([REQUIRED_SCOPE, "openid"]), true);
  assert.equal(hasRequiredScope([DRIVE_FULL_SCOPE]), true, "the full scope always satisfies a drive.file requirement");
  assert.equal(hasRequiredScope(["openid", "email"]), false);
  assert.equal(hasRequiredScope(undefined), REQUIRED_SCOPE === DRIVE_FILE_SCOPE, "records saved before scopes were stored only pass under drive.file");
  if (REQUIRED_SCOPE === DRIVE_FULL_SCOPE) assert.equal(hasRequiredScope([DRIVE_FILE_SCOPE]), false);
});

test("scope: a callback whose grant does not include the required scope is rejected and saves nothing", async () => {
  reset();
  stateRows.length = 0;
  const before = JSON.stringify(world.conns);
  const { authUrl } = await connectionService.startConnect(user, "/");
  const narrowGrant = driveClient.REQUIRED_SCOPE === driveClient.DRIVE_FULL_SCOPE ? "openid https://www.googleapis.com/auth/drive.file" : "openid email";
  const restore = stubGoogle({ tokens: { ...GOOD, scope: narrowGrant }, payload: { sub: "s1", email: "e@x.com" } });
  try {
    assert.equal(query(await connectionService.handleCallback({ code: "c", state: query(authUrl).state })).reason, "scope_missing");
  } finally { restore(); }
  assert.equal(JSON.stringify(world.conns), before);
});

test("scope: GOOGLE_DRIVE_SCOPES is read in one place; only the two known Drive scopes are honoured, anything else falls back to drive.file", async () => {
  const resolve = (value) => {
    const saved = process.env.GOOGLE_DRIVE_SCOPES;
    if (value === undefined) delete process.env.GOOGLE_DRIVE_SCOPES; else process.env.GOOGLE_DRIVE_SCOPES = value;
    delete require.cache[require.resolve("../../../config/env")];
    const scope = require("../../../config/env").googleDrive.driveScope;
    if (saved === undefined) delete process.env.GOOGLE_DRIVE_SCOPES; else process.env.GOOGLE_DRIVE_SCOPES = saved;
    delete require.cache[require.resolve("../../../config/env")];
    return scope;
  };
  assert.equal(resolve("https://www.googleapis.com/auth/drive"), "https://www.googleapis.com/auth/drive");
  assert.equal(resolve("https://www.googleapis.com/auth/drive.file"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(resolve("openid, https://www.googleapis.com/auth/drive"), "https://www.googleapis.com/auth/drive");
  assert.equal(resolve("https://www.googleapis.com/auth/drive.readonly"), "https://www.googleapis.com/auth/drive.file", "a scope this feature does not understand is never requested");
  assert.equal(resolve(""), "https://www.googleapis.com/auth/drive.file");
});
