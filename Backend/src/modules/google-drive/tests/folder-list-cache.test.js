// DB-free: Google and Mongo are stubbed (no network, no database). The folder-list memory: the same list asked for again is answered without
// another Google call, identical simultaneous requests share one call, a new folder clears it, errors are never kept, and accounts never share it.
// Run with: node --test src/modules/google-drive/tests/folder-list-cache.test.js
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI = "https://example.test/api/integrations/google-drive/callback";
process.env.ADMIN_PORTAL_URL = "https://admin.example.test";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "k".repeat(44);
process.env.GOOGLE_DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file";
process.env.DRIVE_LIST_CACHE_MS = "30000"; // pinned so a local .env cannot change what this file asserts

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

// `respond(url, init)` returns [status, jsonBody]; `delay` slows each Google answer so simultaneous requests overlap. Returns the calls made.
async function withGoogle(id, respond, body, { delay = 0 } = {}) {
  stubConnection();
  const proto = Object.getPrototypeOf(client.newOAuthClient());
  const originalRefresh = proto.refreshAccessToken;
  proto.refreshAccessToken = async () => ({ credentials: { access_token: `at-${id}`, expiry_date: Date.now() + 3600e3 } });
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: new URL(url), method: init?.method || "GET" });
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const [status, json] = respond(new URL(url), init);
    return new Response(JSON.stringify(json), { status });
  };
  client.dropToken(id);
  try {
    await body(calls);
  } finally {
    global.fetch = realFetch;
    proto.refreshAccessToken = originalRefresh;
  }
}

const listing = (names) => [200, { files: names.map((name, i) => ({ id: `f${i}`, name, parents: ["root"], capabilities: { canAddChildren: true } })) }];

test("the same folder list asked for twice is fetched from Google once", async () => {
  await withGoogle("cache-a", () => listing(["Cases"]), async (calls) => {
    const first = await client.listFolders("cache-a", { parentId: "root" });
    const second = await client.listFolders("cache-a", { parentId: "root" });
    assert.equal(calls.length, 1);
    assert.deepEqual(second, first);
    assert.equal(second.folders[0].name, "Cases");
  });
});

test("a different folder, search or page is a different list and is fetched on its own", async () => {
  await withGoogle("cache-b", () => listing(["X"]), async (calls) => {
    await client.listFolders("cache-b", { parentId: "root" });
    await client.listFolders("cache-b", { parentId: "folder1" });
    await client.listFolders("cache-b", { query: "smith" });
    await client.listFolders("cache-b", { parentId: "root", pageToken: "T2" });
    assert.equal(calls.length, 4);
  });
});

test("identical requests that arrive together share one Google call", async () => {
  await withGoogle("cache-c", () => listing(["Same"]), async (calls) => {
    const results = await Promise.all([client.listFolders("cache-c", { parentId: "root" }), client.listFolders("cache-c", { parentId: "root" }), client.listFolders("cache-c", { parentId: "root" })]);
    assert.equal(calls.length, 1);
    results.forEach((result) => assert.equal(result.folders[0].name, "Same"));
  }, { delay: 30 });
});

test("creating a folder clears that account's lists, so the new folder shows at once", async () => {
  let names = ["Old"];
  await withGoogle("cache-d", (url, init) => (init?.method === "POST" ? [200, { id: "new1", name: "Brand new", webViewLink: "x" }] : listing(names)), async (calls) => {
    assert.equal((await client.listFolders("cache-d", { parentId: "root" })).folders.length, 1);
    names = ["Old", "Brand new"];
    await client.createFolder("cache-d", "Brand new", "root");
    const after = await client.listFolders("cache-d", { parentId: "root" });
    assert.deepEqual(after.folders.map((folder) => folder.name), ["Old", "Brand new"]);
    assert.equal(calls.filter((call) => call.method === "GET").length, 2); // listed again after the create
  });
});

test("an error is never remembered: the next ask goes to Google again", async () => {
  let fail = true;
  await withGoogle("cache-e", () => (fail ? [403, { error: { message: "no" } }] : listing(["Back again"])), async (calls) => {
    await assert.rejects(() => client.listFolders("cache-e", { parentId: "root" }));
    fail = false;
    const result = await client.listFolders("cache-e", { parentId: "root" });
    assert.equal(result.folders[0].name, "Back again");
    assert.equal(calls.length, 2);
  });
});

test("two connected accounts never share a remembered list", async () => {
  await withGoogle("cache-f1", () => listing(["Account one"]), async () => {
    assert.equal((await client.listFolders("cache-f1", { parentId: "root" })).folders[0].name, "Account one");
  });
  await withGoogle("cache-f2", () => listing(["Account two"]), async () => {
    assert.equal((await client.listFolders("cache-f2", { parentId: "root" })).folders[0].name, "Account two");
  });
});
