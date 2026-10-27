// DB-free and network-free: opening a big petition fast and without errors - retried storage reads, the in-memory cache, the signed viewer link, and the byte-range stream.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cache = require("../petitionBufferCache");
const viewToken = require("../petitionViewToken");
const { createRouter, parseRange } = require("../petitionReview.routes");
const { U, users, makeWorld } = require("./world");

const cm = users[U.cm];
const PDF = Buffer.from("%PDF-1.4 ".padEnd(1000, "x"));

test.beforeEach(() => cache.clear());

// ---------------------------------------------------------------- retried reads
test("a storage read that fails now and then is retried until it works - the caller never sees the hiccup", async () => {
  let calls = 0;
  const waits = [];
  const result = await cache.withRetries(async () => { calls += 1; if (calls < 4) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); return "bytes"; }, { sleep: async (ms) => waits.push(ms) });
  assert.equal(result, "bytes");
  assert.equal(calls, 4);
  assert.deepEqual(waits, [700, 1400, 2800], "a growing pause between attempts");
});

test("retries are bounded, and a file that is simply not there is not retried at all", async () => {
  let calls = 0;
  await assert.rejects(cache.withRetries(async () => { calls += 1; throw new Error("storage unavailable"); }, { attempts: 4, sleep: async () => {} }), /storage unavailable/);
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(cache.withRetries(async () => { calls += 1; throw Object.assign(new Error("Document file not available in shared storage"), { statusCode: 404 }); }, { sleep: async () => {} }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(cache.withRetries(async () => { calls += 1; throw Object.assign(new Error("gone"), { name: "NoSuchKey" }); }, { sleep: async () => {} }));
  assert.equal(calls, 1);
});

test("every document read goes through the retry, and petition PDFs also through the cache (wiring)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "documents", "document.service.js"), "utf8");
  assert.match(source, /cache\.withRetries\(\(\) => readDocumentBufferOnce\(document\)\)/);
  assert.match(source, /document\.documentType === "petition_manual_upload" && document\.storageKey\) return cache\.getOrLoad\(/);
});

// ---------------------------------------------------------------- memory cache
test("the file is read once however many people / requests ask while it loads or afterwards; a failed read is not remembered", async () => {
  let reads = 0;
  const loader = async () => { reads += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return PDF; };
  const [a, b, c] = await Promise.all([cache.getOrLoad("k1", loader), cache.getOrLoad("k1", loader), cache.getOrLoad("k1", loader)]);
  assert.equal(a, b);
  assert.equal(b, c);
  await cache.getOrLoad("k1", loader);
  assert.equal(reads, 1);

  let tries = 0;
  const flaky = async () => { tries += 1; if (tries === 1) throw new Error("boom"); return PDF; };
  await assert.rejects(cache.getOrLoad("k2", flaky), /boom/);
  assert.equal((await cache.getOrLoad("k2", flaky)).length, PDF.length, "the next ask reads again");
  assert.equal(tries, 2);
});

test("the cache is bounded: the least recently used file goes first when the total is over the limit; an oversized file is not kept", async () => {
  const previous = process.env.PETITION_CACHE_MAX_MB;
  process.env.PETITION_CACHE_MAX_MB = "1";
  try {
    const half = () => Buffer.alloc(600 * 1024);
    await cache.getOrLoad("a", async () => half());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await cache.getOrLoad("b", async () => half());
    assert.equal(cache.stats().entries, 1, "a was evicted to make room for b");
    let reads = 0;
    await cache.getOrLoad("a", async () => { reads += 1; return half(); });
    assert.equal(reads, 1);
    process.env.PETITION_CACHE_MAX_MB = "0";
    let direct = 0;
    await cache.getOrLoad("z", async () => { direct += 1; return PDF; });
    await cache.getOrLoad("z", async () => { direct += 1; return PDF; });
    assert.equal(direct, 2, "0 switches the cache off");
  } finally {
    if (previous === undefined) delete process.env.PETITION_CACHE_MAX_MB; else process.env.PETITION_CACHE_MAX_MB = previous;
  }
});

// ---------------------------------------------------------------- viewer token
test("the viewer token is bound to one petition and one person, expires, and cannot be forged or reused as something else", () => {
  const token = viewToken.sign({ documentId: "d1", userId: "u1", side: "client" });
  assert.deepEqual(viewToken.verify(token), { doc: "d1", uid: "u1", side: "client" });
  assert.equal(viewToken.verify(`${token}x`), null);
  assert.equal(viewToken.verify(token.slice(0, -4) + "AAAA"), null);
  assert.equal(viewToken.verify(""), null);
  assert.equal(viewToken.verify(undefined), null);
  assert.equal(viewToken.verify("a.b.c"), null);
  assert.equal(viewToken.verify(token, { now: Date.now() + (viewToken.TTL_SECONDS + 60) * 1000 }), null, "expired");
  assert.equal(viewToken.verify(viewToken.sign({ documentId: "d1", userId: "u1", side: "admin" })), null, "an unknown side is refused");
  const jwt = require("jsonwebtoken");
  assert.equal(viewToken.verify(jwt.sign({ doc: "d1", uid: "u1", side: "client" }, "dev-access-secret-change-me")), null, "an ordinary access token is not a viewer link");
});

// ---------------------------------------------------------------- service
async function released() {
  const world = makeWorld();
  world.data.readDocumentBuffer = async () => PDF;
  await world.service.sendForClientReview({ caseId: "c-single", documentId: "d1", actor: cm });
  return world;
}

test("a viewer link: the audience after release and the case team may ask; the file starts loading in the background at once; everyone else gets a 404", async () => {
  const world = makeWorld();
  let warmed = 0;
  world.data.readDocumentBuffer = async () => { warmed += 1; return PDF; };
  await assert.rejects(world.service.createViewLink({ user: users[U.client], documentId: "d1" }), (error) => error.status === 404, "before release");
  await world.service.sendForClientReview({ caseId: "c-single", documentId: "d1", actor: cm });
  assert.ok(warmed >= 1, "released petitions are read ahead of the first open");
  const before = warmed;
  const link = await world.service.createViewLink({ user: users[U.client], documentId: "d1" });
  assert.equal(viewToken.verify(link.token).side, "client");
  assert.equal(warmed, before + 1);
  assert.equal(viewToken.verify((await world.service.createViewLink({ user: cm, documentId: "d1" })).token).side, "staff");
  for (const outsider of [users[U.other], users[U.attorney], users[U.beneficiary]]) {
    await assert.rejects(world.service.createViewLink({ user: outsider, documentId: "d1" }), (error) => error.status === 404, outsider.role);
  }
});

test("the stream re-checks access on every request: a withdrawn release, a deactivated account, a demoted role or an expired link all stop it", async () => {
  const world = await released();
  const { token } = await world.service.createViewLink({ user: users[U.client], documentId: "d1" });
  const file = await world.service.streamFile({ token });
  assert.equal(file.buffer.length, PDF.length);
  assert.equal(file.fileName, "Petition.pdf");
  assert.match(file.etag, /^"d1-\d+"$/);

  const staffToken = (await world.service.createViewLink({ user: cm, documentId: "d1" })).token;
  assert.equal((await world.service.streamFile({ token: staffToken })).buffer.length, PDF.length);

  await assert.rejects(world.service.streamFile({ token: "garbage" }), (error) => error.status === 401);
  users[U.client].isActive = false;
  await assert.rejects(world.service.streamFile({ token }), (error) => error.status === 403);
  users[U.client].isActive = true;
  world.reviews.get("d1").clientReview = {};
  await assert.rejects(world.service.streamFile({ token }), (error) => error.status === 404, "release withdrawn");
  world.reviews.get("d1").clientReview = { sentAt: new Date() };
  const demoted = users[U.cm].role;
  users[U.cm].role = "client";
  await assert.rejects(world.service.streamFile({ token: staffToken }), (error) => error.status === 403);
  users[U.cm].role = demoted;
});

test("ready: answers true the moment the file is in memory, and false (ask again) when it is still loading - never an error for slowness", async () => {
  const world = await released();
  const { token } = await world.service.createViewLink({ user: users[U.client], documentId: "d1" });
  assert.deepEqual(await world.service.streamReady({ token, waitMs: 200 }), { ready: true });
  let release;
  world.data.readDocumentBuffer = () => new Promise((resolve) => { release = () => resolve(PDF); });
  const started = Date.now();
  assert.deepEqual(await world.service.streamReady({ token, waitMs: 60 }), { ready: false });
  assert.ok(Date.now() - started >= 50);
  release();
});

// ---------------------------------------------------------------- HTTP: ranges and headers
test("parseRange understands the forms a PDF viewer sends and rejects what cannot be satisfied", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=500-5000", 1000), { start: 500, end: 999 }, "an end past the file is clamped");
  assert.equal(parseRange("bytes=1000-1100", 1000), false);
  assert.equal(parseRange("bytes=9-3", 1000), false);
  assert.equal(parseRange("bytes=-0", 1000), false);
  assert.equal(parseRange("", 1000), null);
  assert.equal(parseRange("items=0-5", 1000), null);
  assert.equal(parseRange("bytes=0-5,10-20", 1000), null, "a multi-range request just gets the whole file");
});

async function withApp(world, fn, extra = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/petition-review", createRouter({ service: world.service, guard: [(req, res, next) => { req.user = users[U.client]; next(); }], frameOrigins: ["https://client.example.test", "https://admin.example.test"], waitMs: 80, ...extra }));
  app.use((error, req, res, next) => res.status(500).json({ message: error.message })); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/api/petition-review`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("HTTP: the stream serves the whole file, byte ranges (206), 416 for an impossible range, 304 when the viewer already has it, and may be framed only by the portals", async () => {
  const world = await released();
  const { token } = await world.service.createViewLink({ user: users[U.client], documentId: "d1" });
  await withApp(world, async (base) => {
    const full = await fetch(`${base}/stream/${token}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "application/pdf");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(Number(full.headers.get("content-length")), PDF.length);
    assert.match(full.headers.get("content-disposition"), /^inline;/);
    assert.equal(full.headers.get("content-security-policy"), "frame-ancestors 'self' https://client.example.test https://admin.example.test");
    assert.equal(full.headers.get("x-frame-options"), null);
    assert.equal(full.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.equal(Buffer.from(await full.arrayBuffer()).equals(PDF), true);

    const part = await fetch(`${base}/stream/${token}`, { headers: { Range: "bytes=10-19" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), `bytes 10-19/${PDF.length}`);
    assert.equal(Buffer.from(await part.arrayBuffer()).equals(PDF.subarray(10, 20)), true);
    const tail = await fetch(`${base}/stream/${token}`, { headers: { Range: "bytes=-5" } });
    assert.equal(Buffer.from(await tail.arrayBuffer()).equals(PDF.subarray(PDF.length - 5)), true);

    const bad = await fetch(`${base}/stream/${token}`, { headers: { Range: `bytes=${PDF.length + 5}-` } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get("content-range"), `bytes */${PDF.length}`);
    assert.match((await fetch(`${base}/stream/${token}?download=1`)).headers.get("content-disposition"), /^attachment;/, "download=1 saves the file instead of showing it");
    const cached = await fetch(`${base}/stream/${token}`, { headers: { "If-None-Match": full.headers.get("etag") } });
    assert.equal(cached.status, 304);
  });
});

test("HTTP: a bad or expired link is a 401 with a message, ready long-polls without erroring, and the link itself needs a signed-in user to be created", async () => {
  const world = await released();
  const { token } = await world.service.createViewLink({ user: users[U.client], documentId: "d1" });
  await withApp(world, async (base) => {
    const bad = await fetch(`${base}/stream/not-a-token`);
    assert.equal(bad.status, 401);
    assert.match((await bad.json()).message, /expired/);
    assert.equal((await fetch(`${base}/stream/not-a-token/ready`)).status, 401);
    const ready = await (await fetch(`${base}/stream/${token}/ready`)).json();
    assert.deepEqual(ready.data, { ready: true });
    const created = await fetch(`${base}/documents/d1/view-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(created.status, 200);
    assert.ok((await created.json()).data.token);
  });
  // without the test guard the real sign-in check applies to the link, but not to the streams
  const app = express();
  app.use("/api/petition-review", createRouter({ service: world.service }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/petition-review`;
    assert.equal((await fetch(`${base}/documents/d1/view-link`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${base}/stream/${token}`)).status, 200, "the link is its own credential");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
