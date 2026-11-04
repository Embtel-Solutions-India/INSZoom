// Parallel S3 reads (2026-11-04), DB-free and network-free: a fake S3 that honours Range / If-Match like the real one.
// Proves: the bytes are identical to one whole GET for every size (empty, tiny, exactly one part, many parts, uneven last part); a file that
// fits in one part costs one request; parts run in parallel within the limit; every way it can go wrong falls back to ONE whole GET (never an
// error, never wrong bytes); "not found" is still "not found"; settings are clamped; switched off = the old single GET.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { getObjectInParts, settings, totalFromContentRange } = require("../s3ParallelGet");

const notFound = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
const body = (bytes) => ({ transformToByteArray: async () => new Uint8Array(bytes) });

function fakeS3(data, { etag = '"v1"', ignoreRange = false, failPart = null, changeAfterFirst = false, shortPart = null, missing = false, delayMs = 0 } = {}) {
  const log = { requests: [], inFlight: 0, maxInFlight: 0 };
  let current = { data, etag };
  const send = async (input) => {
    log.requests.push(input);
    log.inFlight += 1;
    log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
    try {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (missing) throw notFound();
      if (input.IfMatch && input.IfMatch !== current.etag) throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      if (!input.Range || ignoreRange) return { Body: body(current.data), ETag: current.etag };
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(input.Range).map(Number);
      if (current.data.length === 0) throw Object.assign(new Error("InvalidRange"), { name: "InvalidRange", $metadata: { httpStatusCode: 416 } });
      const start = a;
      const end = Math.min(b, current.data.length - 1);
      const index = log.requests.filter((r) => r.Range).length;
      if (failPart && index === failPart) throw Object.assign(new Error("socket hang up"), { name: "TimeoutError" });
      let slice = current.data.subarray(start, end + 1);
      if (shortPart && index === shortPart) slice = slice.subarray(0, slice.length - 1);
      const response = { Body: body(slice), ETag: current.etag, ContentRange: `bytes ${start}-${end}/${current.data.length}` };
      if (changeAfterFirst && index === 1) current = { data: Buffer.concat([data, Buffer.from("x")]), etag: '"v2"' };
      return response;
    } finally {
      log.inFlight -= 1;
    }
  };
  return { send, log };
}
const read = (s3, extra = {}) => getObjectInParts({ send: s3.send, makeGet: (input) => input, Bucket: "b", Key: "k", partBytes: 1000, concurrency: 4, ...extra });
const wholeGets = (s3) => s3.log.requests.filter((r) => !r.Range).length;

test("identical bytes for every size; one request when the file fits in one part", async () => {
  for (const size of [1, 999, 1000, 1001, 4000, 4321, 25000]) {
    const data = crypto.randomBytes(size);
    const s3 = fakeS3(data);
    const out = await read(s3);
    assert.ok(out.equals(data), `size ${size}`);
    assert.equal(wholeGets(s3), 0, `size ${size}: no fallback`);
    assert.equal(s3.log.requests.length, Math.ceil(size / 1000), `size ${size}: one request per part`);
  }
});

test("parts after the first run in parallel, never more than the limit, and are pinned to the first answer's ETag", async () => {
  const data = crypto.randomBytes(20000);
  const s3 = fakeS3(data, { delayMs: 5 });
  assert.ok((await read(s3, { concurrency: 4 })).equals(data));
  assert.equal(s3.log.maxInFlight, 4);
  assert.ok(s3.log.requests.slice(1).every((r) => r.IfMatch === '"v1"'));
});

test("an empty file, a server that ignores ranges, a failed part, a short part, a file replaced mid-read: the right bytes, via one whole GET where needed", async () => {
  const empty = fakeS3(Buffer.alloc(0));
  assert.equal((await read(empty)).length, 0);
  assert.equal(wholeGets(empty), 1);

  const data = crypto.randomBytes(5500);
  const ignoring = fakeS3(data, { ignoreRange: true });
  assert.ok((await read(ignoring)).equals(data));
  assert.equal(ignoring.log.requests.length, 1, "the whole file already came back: nothing more");

  const reasons = [];
  for (const options of [{ failPart: 3 }, { shortPart: 2 }]) {
    const s3 = fakeS3(data, options);
    assert.ok((await read(s3, { onFallback: (reason) => reasons.push(reason) })).equals(data), JSON.stringify(options));
    assert.equal(wholeGets(s3), 1, JSON.stringify(options));
  }
  const replaced = fakeS3(data, { changeAfterFirst: true });
  const out = await read(replaced, { onFallback: (reason) => reasons.push(reason) });
  assert.equal(out.length, data.length + 1, "the new version, read whole - never two versions stitched together");
  assert.equal(wholeGets(replaced), 1);
  assert.equal(reasons.length, 3);
});

test("a missing file is still 'not found' (the callers' existing handling), never a fallback", async () => {
  const s3 = fakeS3(Buffer.alloc(10), { missing: true });
  await assert.rejects(read(s3), (error) => error.name === "NoSuchKey");
  assert.equal(s3.log.requests.length, 1);
});

test("the first request failing for another reason falls back to one whole GET; switched off = the old single GET", async () => {
  const data = crypto.randomBytes(3000);
  let calls = 0;
  const flaky = async (input) => { calls += 1; if (input.Range) throw Object.assign(new Error("reset"), { name: "ECONNRESET" }); return { Body: body(data) }; };
  assert.ok((await getObjectInParts({ send: flaky, makeGet: (i) => i, Bucket: "b", Key: "k", partBytes: 1000, concurrency: 4 })).equals(data));
  assert.equal(calls, 2);
  const off = fakeS3(data);
  assert.ok((await read(off, { partBytes: 0 })).equals(data));
  assert.deepEqual(off.log.requests.map((r) => r.Range), [undefined]);
});

test("settings: defaults 4 MB x 8, clamped, 0 switches it off; Content-Range parsing", () => {
  assert.deepEqual(settings({}), { partBytes: 4 * 1024 * 1024, concurrency: 8 });
  assert.equal(settings({ S3_PARALLEL_PART_MB: "0" }).partBytes, 0);
  assert.equal(settings({ S3_PARALLEL_PART_MB: "junk" }).partBytes, 0);
  assert.equal(settings({ S3_PARALLEL_PART_MB: "500" }).partBytes, 64 * 1024 * 1024);
  assert.equal(settings({ S3_PARALLEL_CONCURRENCY: "99" }).concurrency, 16);
  assert.equal(settings({ S3_PARALLEL_CONCURRENCY: "0" }).concurrency, 1);
  assert.equal(totalFromContentRange("bytes 0-4194303/16252928"), 16252928);
  assert.equal(totalFromContentRange("bytes */100"), null);
  assert.equal(totalFromContentRange(undefined), null);
});

// ── the petition memory cache (2026-11-04): stored at upload, kept 2 hours ──
test("petition cache: prime() at upload makes the first open need no storage read; bad input is ignored; default stay is 2 hours", async () => {
  const cache = require("../../petition-review/petitionBufferCache");
  cache.clear();
  const bytes = Buffer.from("%PDF-1.7 petition");
  assert.equal(cache.prime("doc1:key1", bytes), true);
  let reads = 0;
  const out = await cache.getOrLoad("doc1:key1", async () => { reads += 1; return Buffer.from("from storage"); });
  assert.ok(out.equals(bytes));
  assert.equal(reads, 0, "served from memory");
  for (const bad of [null, "text", Buffer.alloc(0)]) assert.equal(cache.prime("doc2:key2", bad), false);
  assert.equal(cache.prime("", bytes), false);
  const before = process.env.PETITION_CACHE_TTL_MINUTES;
  delete process.env.PETITION_CACHE_TTL_MINUTES;
  cache.prime("doc3:key3", bytes);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 90 * 60 * 1000; // 90 minutes later: still in memory (was 30 minutes before)
    let late = 0;
    await cache.getOrLoad("doc3:key3", async () => { late += 1; return bytes; });
    assert.equal(late, 0);
  } finally {
    Date.now = realNow;
    if (before !== undefined) process.env.PETITION_CACHE_TTL_MINUTES = before;
    cache.clear();
  }
});
