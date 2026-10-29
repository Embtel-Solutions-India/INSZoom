// DB-free: Google and Mongo are stubbed. Run with: node --test src/modules/google-drive/tests/google-drive.test.js
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI = "https://example.test/api/integrations/google-drive/callback";
process.env.ADMIN_PORTAL_URL = "https://admin.example.test";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "k".repeat(44);

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const secretBox = require("../../../utils/secretBox");
const GoogleDriveConnection = require("../../../models/GoogleDriveConnection");

const KEY = "k".repeat(44);

test("secretBox round-trips and rejects tampering, wrong key and missing key", () => {
  const sealed = secretBox.encrypt("refresh-token-value", KEY);
  assert.ok(sealed.startsWith("v1."));
  assert.ok(!sealed.includes("refresh-token-value"));
  assert.equal(secretBox.decrypt(sealed, KEY), "refresh-token-value");
  assert.notEqual(secretBox.encrypt("refresh-token-value", KEY), sealed, "random IV per encryption");
  assert.throws(() => secretBox.decrypt(sealed.slice(0, -2) + "AA", KEY));
  assert.throws(() => secretBox.decrypt(sealed, "x".repeat(44)));
  assert.throws(() => secretBox.encrypt("a", ""), /Encryption key/);
  assert.throws(() => secretBox.encrypt("a", "short"), /Encryption key/);
});

test("safeReturnPath only allows plain local paths", () => {
  const { safeReturnPath } = require("../connection.service");
  assert.equal(safeReturnPath("/cases/123"), "/cases/123");
  assert.equal(safeReturnPath("//evil.com"), "/");
  assert.equal(safeReturnPath("https://evil.com"), "/");
  assert.equal(safeReturnPath("/a?x=1"), "/");
  assert.equal(safeReturnPath(undefined), "/");
});

function stubConnection({ status = "connected", refreshTokenEnc } = {}) {
  const updates = [];
  GoogleDriveConnection.findOne = () => ({ select: async () => ({ status, refreshTokenEnc: refreshTokenEnc ?? secretBox.encrypt("rt", KEY) }) });
  GoogleDriveConnection.updateOne = (...args) => {
    updates.push(args);
    return { catch: () => {} };
  };
  return updates;
}

function stubRefresh(client, impl) {
  const proto = Object.getPrototypeOf(client.newOAuthClient());
  const original = proto.refreshAccessToken;
  proto.refreshAccessToken = impl;
  return () => {
    proto.refreshAccessToken = original;
  };
}

test("drive client: refreshes a token, retries 429, and returns parsed JSON", async () => {
  const client = require("../drive.client");
  stubConnection();
  const restore = stubRefresh(client, async () => ({ credentials: { access_token: "at-1", expiry_date: Date.now() + 3600e3 } }));
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url, options) => {
    calls += 1;
    assert.equal(options.headers.Authorization, "Bearer at-1");
    if (calls === 1) return new Response(JSON.stringify({ error: { message: "slow down", errors: [{ reason: "rateLimitExceeded" }] } }), { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ id: "f1", name: "Cases", mimeType: client.FOLDER_MIME, capabilities: { canAddChildren: true } }), { status: 200 });
  };
  try {
    client.dropToken("t1");
    const folder = await client.getFolder("t1", "f1");
    assert.equal(folder.id, "f1");
    assert.equal(calls, 2);
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test("drive client: non-JSON error bodies and 404s become DriveErrors, not crashes", async () => {
  const client = require("../drive.client");
  stubConnection();
  const restore = stubRefresh(client, async () => ({ credentials: { access_token: "at-2", expiry_date: Date.now() + 3600e3 } }));
  const realFetch = global.fetch;
  global.fetch = async () => new Response("<html>Bad gateway</html>", { status: 404 });
  try {
    client.dropToken("t2");
    await assert.rejects(client.getFolder("t2", "x"), (error) => error instanceof client.DriveError && error.code === "NOT_FOUND");
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test("drive client: folder checks reject files, trashed folders and read-only folders", async () => {
  const client = require("../drive.client");
  stubConnection();
  const restore = stubRefresh(client, async () => ({ credentials: { access_token: "at-3", expiry_date: Date.now() + 3600e3 } }));
  const realFetch = global.fetch;
  const respond = (body) => {
    global.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    client.dropToken("t3");
    respond({ id: "a", mimeType: "application/pdf" });
    await assert.rejects(client.getFolder("t3", "a"), (error) => error.code === "NOT_A_FOLDER");
    respond({ id: "a", mimeType: client.FOLDER_MIME, trashed: true });
    await assert.rejects(client.getFolder("t3", "a"), (error) => error.code === "FOLDER_TRASHED");
    respond({ id: "a", mimeType: client.FOLDER_MIME, capabilities: { canAddChildren: false } });
    await assert.rejects(client.getFolder("t3", "a"), (error) => error.code === "FOLDER_READ_ONLY");
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test("drive client: invalid_grant marks the connection reconnect_required and is not retried", async () => {
  const client = require("../drive.client");
  const updates = stubConnection();
  let refreshes = 0;
  const restore = stubRefresh(client, async () => {
    refreshes += 1;
    throw Object.assign(new Error("invalid_grant"), { response: { data: { error: "invalid_grant" } } });
  });
  try {
    client.dropToken("t4");
    await assert.rejects(client.getFolder("t4", "x"), (error) => error.code === "RECONNECT_REQUIRED");
    assert.equal(refreshes, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0][1].$set.status, "reconnect_required");
  } finally {
    restore();
  }
});

test("drive client: a server-side client/secret problem does NOT discard the saved connection", async () => {
  const client = require("../drive.client");
  const updates = stubConnection();
  const restore = stubRefresh(client, async () => {
    throw Object.assign(new Error("invalid_client"), { response: { data: { error: "invalid_client" } } });
  });
  try {
    client.dropToken("t6");
    await assert.rejects(client.getFolder("t6", "x"), (error) => error.code === "SERVER_CONFIG" && error.status === 503);
    assert.equal(updates.length, 0, "connection record untouched, so fixing the server config restores access without reconnecting");
  } finally {
    restore();
  }
});

test("drive client: a token this server cannot decrypt (different key) is reported but the stored connection is left alone", async () => {
  const client = require("../drive.client");
  const updates = stubConnection({ refreshTokenEnc: secretBox.encrypt("rt", "z".repeat(44)) });
  try {
    client.dropToken("t7");
    await assert.rejects(client.getFolder("t7", "x"), (error) => error.code === "RECONNECT_REQUIRED" && /could not be read on this server/.test(error.message));
    assert.equal(updates.length, 0, "other servers with the right key keep working");
  } finally {
    stubConnection();
  }
});

test("drive client: small files use multipart, large files use a resumable session; pre-generated ID is sent", async () => {
  const client = require("../drive.client");
  stubConnection();
  const restore = stubRefresh(client, async () => ({ credentials: { access_token: "at-5", expiry_date: Date.now() + 3600e3 } }));
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options = {}) => {
    seen.push({ url: String(url), method: options.method, body: options.body });
    if (String(url).includes("uploadType=resumable")) return new Response("{}", { status: 200, headers: { location: "https://upload.example.test/session/1" } });
    if (String(url).startsWith("https://upload.example.test")) return new Response(JSON.stringify({ id: "big", md5Checksum: "m" }), { status: 200 });
    return new Response(JSON.stringify({ id: "small", md5Checksum: "m" }), { status: 200 });
  };
  try {
    client.dropToken("t5");
    await client.uploadFile("t5", { fileId: "PRE-ID", existing: false, name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello"), parentId: "folder", appProperties: { immiglanceDoc: "d" } });
    assert.match(seen[0].url, /uploadType=multipart/);
    assert.equal(seen[0].method, "POST");
    assert.ok(seen[0].body.toString().includes('"id":"PRE-ID"'));
    assert.ok(seen[0].body.toString().includes('"parents":["folder"]'));

    seen.length = 0;
    await client.uploadFile("t5", { fileId: "PRE-ID", existing: true, name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
    assert.match(seen[0].url, /uploadType=resumable/);
    assert.equal(seen[0].method, "PATCH");
    assert.equal(seen[1].url, "https://upload.example.test/session/1");
    assert.equal(seen[1].method, "PUT");
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test("routes: feature off => everything but /status is 404, /status needs a login, nothing throws", async () => {
  process.env.GOOGLE_DRIVE_INTEGRATION_ENABLED = "false";
  delete require.cache[require.resolve("../../../config/env")];
  const router = require("../google-drive.routes");
  const app = express();
  app.use(express.json());
  app.use("/gd", router);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/gd`;
  try {
    assert.equal((await fetch(`${base}/callback?code=x&state=y`)).status, 404);
    assert.equal((await fetch(`${base}/status`)).status, 401);
    assert.equal((await fetch(`${base}/sync`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/jobs/abc`)).status, 404);
  } finally {
    server.close();
  }
});
