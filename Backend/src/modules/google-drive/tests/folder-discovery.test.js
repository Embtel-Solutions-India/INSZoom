// DB-free: Google and Mongo are stubbed (no network, no database). Covers folder discovery: My Drive, Shared with me, shared drives, search,
// paging, newest-first order, read-only folders, revoked access, and the request validation in front of it.
// Run with: node --test src/modules/google-drive/tests/folder-discovery.test.js
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI = "https://example.test/api/integrations/google-drive/callback";
process.env.ADMIN_PORTAL_URL = "https://admin.example.test";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "k".repeat(44);
process.env.GOOGLE_DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file"; // pinned so a local .env cannot change what this file asserts

const test = require("node:test");
const assert = require("node:assert/strict");
const secretBox = require("../../../utils/secretBox");
const GoogleDriveConnection = require("../../../models/GoogleDriveConnection");

const KEY = "k".repeat(44);
const client = require("../drive.client");

function stubConnection() {
  GoogleDriveConnection.findOne = () => ({ select: async () => ({ status: "connected", refreshTokenEnc: secretBox.encrypt("rt", KEY) }) });
  GoogleDriveConnection.updateOne = () => ({ catch: () => {} });
}

// Runs `body` with Google's token refresh and fetch replaced; `respond(url)` returns [status, jsonBody]. Returns the URLs requested.
async function withGoogle(id, respond, body) {
  stubConnection();
  const proto = Object.getPrototypeOf(client.newOAuthClient());
  const originalRefresh = proto.refreshAccessToken;
  proto.refreshAccessToken = async () => ({ credentials: { access_token: `at-${id}`, expiry_date: Date.now() + 3600e3 } });
  const realFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(new URL(url));
    const [status, json] = respond(new URL(url));
    return new Response(JSON.stringify(json), { status });
  };
  client.dropToken(id);
  try {
    await body(urls);
  } finally {
    global.fetch = realFetch;
    proto.refreshAccessToken = originalRefresh;
  }
}

const FOLDER = "application/vnd.google-apps.folder";

test("My Drive: lists the top level, newest-modified first, folders only, never trashed", async () => {
  await withGoogle("d1", () => [200, { files: [{ id: "a1", name: "Recent", modifiedTime: "2026-10-30T10:00:00Z" }, { id: "b2", name: "Older" }] }], async (urls) => {
    const page = await client.listFolders("d1");
    const q = urls[0].searchParams.get("q");
    assert.match(q, new RegExp(`mimeType='${FOLDER}'`));
    assert.match(q, /trashed=false/);
    assert.match(q, /'root' in parents/);
    assert.equal(urls[0].searchParams.get("orderBy"), "modifiedTime desc");
    assert.equal(urls[0].searchParams.get("supportsAllDrives"), "true");
    assert.equal(urls[0].searchParams.get("includeItemsFromAllDrives"), "true");
    assert.equal(urls[0].searchParams.get("corpora"), null, "the My Drive top level keeps the original query shape");
    assert.deepEqual(page.folders.map((f) => f.id), ["a1", "b2"]); // Google's order is preserved
    assert.equal(page.folders[0].modifiedTime, "2026-10-30T10:00:00Z");
    assert.equal(page.nextPageToken, null);
  });
});

test("a folder inside another folder (including inside a shared drive) is listed across all drives, with the ID escaped", async () => {
  await withGoogle("d2", () => [200, { files: [] }], async (urls) => {
    await client.listFolders("d2", { parentId: "0AAbCd-_x" });
    assert.match(urls[0].searchParams.get("q"), /'0AAbCd-_x' in parents/);
    assert.equal(urls[0].searchParams.get("corpora"), "allDrives");
    await client.listFolders("d2", { parentId: "a' or '1'='1" });
    assert.match(urls[1].searchParams.get("q"), /'a\\' or \\'1\\'=\\'1' in parents/, "a quote in an ID can never break out of the query");
  });
});

test("Shared with me: folders other people shared, with who shared them", async () => {
  await withGoogle("d3", () => [200, { files: [{ id: "s1", name: "Client X", ownedByMe: false, shared: true, owners: [{ displayName: "Account A" }], parents: ["p9"], driveId: undefined, capabilities: { canAddChildren: true } }] }], async (urls) => {
    const page = await client.listFolders("d3", { view: "shared" });
    assert.match(urls[0].searchParams.get("q"), /sharedWithMe=true/);
    assert.match(urls[0].searchParams.get("q"), /trashed=false/);
    assert.equal(page.folders[0].owner, "Account A");
    assert.equal(page.folders[0].shared, true);
    assert.equal(page.folders[0].parentId, "p9", "the original parent ID is kept");
  });
});

test("shared drives: listed from the drives endpoint, each marked as a shared drive with its own ID as the drive ID", async () => {
  await withGoogle("d4", (url) => (url.pathname.endsWith("/drives") ? [200, { drives: [{ id: "drv1", name: "Firm Drive", capabilities: { canAddChildren: true } }, { id: "drv2", name: "Locked", capabilities: { canAddChildren: false } }], nextPageToken: "tok2" }] : [404, {}]), async (urls) => {
    const page = await client.listFolders("d4", { view: "drives" });
    assert.ok(urls[0].pathname.endsWith("/drives"));
    assert.equal(page.folders[0].isSharedDrive, true);
    assert.equal(page.folders[0].driveId, "drv1");
    assert.equal(page.folders[1].canAddChildren, false);
    assert.equal(page.nextPageToken, "tok2");
  });
});

test("search: matches by name across My Drive, Shared with me and shared drives, with quotes escaped", async () => {
  await withGoogle("d5", () => [200, { files: [{ id: "x", name: "Smith O'Neil" }] }], async (urls) => {
    const page = await client.listFolders("d5", { query: "O'Neil" });
    assert.match(urls[0].searchParams.get("q"), /name contains 'O\\'Neil'/);
    assert.match(urls[0].searchParams.get("q"), /trashed=false/);
    assert.equal(urls[0].searchParams.get("corpora"), "allDrives");
    assert.equal(page.folders[0].name, "Smith O'Neil");
  });
});

test("paging: the next-page token comes back to the caller and is sent on the next request, so folders past the first page do not vanish", async () => {
  const pages = { "": { files: Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, name: `F${i}` })), nextPageToken: "NEXT" }, NEXT: { files: [{ id: "last", name: "Last" }] } };
  await withGoogle("d6", (url) => [200, pages[url.searchParams.get("pageToken") || ""]], async (urls) => {
    const first = await client.listFolders("d6");
    assert.equal(first.folders.length, 100);
    assert.equal(first.nextPageToken, "NEXT");
    assert.equal(urls[0].searchParams.get("pageSize"), "100");
    const second = await client.listFolders("d6", { pageToken: first.nextPageToken });
    assert.equal(urls[1].searchParams.get("pageToken"), "NEXT");
    assert.deepEqual(second.folders.map((f) => f.id), ["last"]);
    assert.equal(second.nextPageToken, null);
  });
});

test("view-only folders are reported as not writable; an absent permission value is treated as writable (re-checked before upload)", async () => {
  await withGoogle("d7", () => [200, { files: [{ id: "ro", name: "Read only", capabilities: { canAddChildren: false } }, { id: "rw", name: "Writable", capabilities: { canAddChildren: true } }, { id: "unk", name: "Unknown" }] }], async () => {
    const { folders } = await client.listFolders("d7");
    assert.deepEqual(folders.map((f) => f.canAddChildren), [false, true, true]);
  });
});

test("destination check keeps the folder, parent and shared-drive IDs, and refuses read-only, trashed and non-folder destinations", async () => {
  let body;
  await withGoogle("d8", () => [200, body], async () => {
    body = { id: "dest", name: "Petitions", mimeType: FOLDER, parents: ["par1"], driveId: "drv9", webViewLink: "https://drive.google.com/x", capabilities: { canAddChildren: true } };
    assert.deepEqual(await client.getFolder("d8", "dest"), { id: "dest", name: "Petitions", webViewLink: "https://drive.google.com/x", parentId: "par1", driveId: "drv9" });
    body = { ...body, capabilities: { canAddChildren: false } };
    await assert.rejects(client.getFolder("d8", "dest"), (e) => e.code === "FOLDER_READ_ONLY" && e.status === 403);
    body = { ...body, capabilities: undefined, trashed: true };
    await assert.rejects(client.getFolder("d8", "dest"), (e) => e.code === "FOLDER_TRASHED");
    body = { id: "f", mimeType: "application/pdf" };
    await assert.rejects(client.getFolder("d8", "f"), (e) => e.code === "NOT_A_FOLDER");
  });
});

test("a folder the account lost access to (permission revoked / not shared) is reported as not found, not as a crash", async () => {
  await withGoogle("d9", () => [404, { error: { message: "File not found: gone.", errors: [{ reason: "notFound" }] } }], async () => {
    await assert.rejects(client.getFolder("d9", "gone"), (e) => e instanceof client.DriveError && e.code === "NOT_FOUND");
    await assert.rejects(client.listFolders("d9", { parentId: "gone" }), (e) => e.code === "NOT_FOUND");
  });
});

// ---- the endpoint in front of it ----
function callList(query, { stubList } = {}) {
  const ctrl = require("../google-drive.controller");
  const connectionService = require("../connection.service");
  const syncService = require("../sync.service");
  const originals = { active: connectionService.requireActive, list: client.listFolders, recent: syncService.recentFolders };
  const calls = [];
  connectionService.requireActive = async () => ({ _id: "conn1" });
  syncService.recentFolders = async () => [{ id: "r1", name: "Recent" }];
  client.listFolders = stubList || (async (connectionId, options) => { calls.push({ connectionId, options }); return { folders: [{ id: "z", name: "Z" }], nextPageToken: "T" }; });
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return ctrl.listFolders({ user: { _id: "u1" }, query }, res).then(() => {
    connectionService.requireActive = originals.active;
    client.listFolders = originals.list;
    syncService.recentFolders = originals.recent;
    return { res, calls };
  });
}

test("endpoint: passes view / search / page token through, keeps recent folders to the plain first page, and never uses another account's connection", async () => {
  let { res, calls } = await callList({});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[0].options, { parentId: "root", view: undefined, query: undefined, pageToken: undefined });
  assert.equal(calls[0].connectionId, "conn1", "uses the signed-in user's own active connection");
  assert.equal(res.body.recent.length, 1);
  assert.equal(res.body.nextPageToken, "T");
  assert.equal(res.body.fullAccess, false);

  ({ res, calls } = await callList({ q: "  smith  ", view: "shared", pageToken: "abc-123_=" }));
  assert.deepEqual(calls[0].options, { parentId: "root", view: "shared", query: "smith", pageToken: "abc-123_=" });
  assert.equal(res.body.recent.length, 0, "recent folders only come with the plain first page");
});

test("endpoint: rejects malformed folder IDs, unknown views and page tokens with a 400 and never reaches Google", async () => {
  for (const query of [{ parentId: "a b" }, { parentId: "x'; drop" }, { view: "everything" }, { pageToken: "bad token!" }]) {
    const { res, calls } = await callList(query);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(calls.length, 0);
  }
});

test("endpoint: a narrow (drive.file) connection gets a clear explanation for Shared with me / shared drives / search instead of a bare Google refusal", async () => {
  const forbidden = async () => { throw new client.DriveError("insufficient", { status: 403, code: "FORBIDDEN" }); };
  const { res } = await callList({ view: "drives" }, { stubList: forbidden });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "SCOPE_LIMITED");
  assert.match(res.body.message, /full Google Drive access/);
  const search = await callList({ q: "smith" }, { stubList: forbidden });
  assert.equal(search.res.body.code, "SCOPE_LIMITED");
  const plain = await callList({}, { stubList: forbidden });
  assert.equal(plain.res.body.code, "FORBIDDEN", "an ordinary listing keeps Google's own error");
});

test("endpoint: a folder that vanished or was un-shared in Google answers cleanly", async () => {
  const gone = async () => { throw new client.DriveError("File not found", { status: 404, code: "NOT_FOUND" }); };
  const { res } = await callList({ parentId: "abcd1234" }, { stubList: gone });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, "NOT_FOUND");
});
