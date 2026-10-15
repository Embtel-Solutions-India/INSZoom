const assert = require("node:assert/strict");
const { test, mock, afterEach } = require("node:test");

// The bounded S3 read cache (storage.service.js): pure, no S3 and no database - exercised through its test hooks.
const STORAGE_PATH = require.resolve("../storage.service");
function freshStorage(cacheMb) {
  const saved = process.env.STORAGE_READ_CACHE_MB;
  if (cacheMb === undefined) delete process.env.STORAGE_READ_CACHE_MB; else process.env.STORAGE_READ_CACHE_MB = String(cacheMb);
  delete require.cache[STORAGE_PATH];
  const storage = require(STORAGE_PATH);
  if (saved === undefined) delete process.env.STORAGE_READ_CACHE_MB; else process.env.STORAGE_READ_CACHE_MB = saved;
  return storage._readCache;
}
afterEach(() => { mock.restoreAll(); delete require.cache[STORAGE_PATH]; });
const buf = (n, fill = 1) => Buffer.alloc(n, fill);

test("a cached object is served again, as a copy nobody can alter", () => {
  const cache = freshStorage();
  cache.put("a", buf(10, 7));
  const first = cache.get("a");
  assert.deepEqual(first, buf(10, 7));
  first.fill(0); // a caller scribbling on its copy...
  assert.deepEqual(cache.get("a"), buf(10, 7), "...never changes what is cached");
  assert.equal(cache.get("missing"), null);
});

test("a write or delete of a key drops it (a rewritten object is never served from the old copy)", () => {
  const cache = freshStorage();
  cache.put("a", buf(10));
  cache.drop("a");
  assert.equal(cache.get("a"), null);
  assert.equal(cache.bytes(), 0);
});

test("entries expire after 10 minutes", () => {
  const cache = freshStorage();
  const start = Date.now();
  cache.put("a", buf(10));
  const now = mock.method(Date, "now", () => start + 10 * 60 * 1000 + 1);
  assert.equal(cache.get("a"), null);
  assert.equal(cache.size(), 0);
  now.mock.restore();
});

test("the total size is bounded: the least recently used object is evicted first", () => {
  const cache = freshStorage(1); // 1 MB cap
  const half = 400 * 1024;
  cache.put("a", buf(half)); cache.put("b", buf(half));
  cache.get("a"); // a is now the most recently used
  cache.put("c", buf(half)); // over the cap: b (least recently used) goes
  assert.ok(cache.get("a") && cache.get("c"));
  assert.equal(cache.get("b"), null);
  assert.ok(cache.bytes() <= 1024 * 1024);
});

test("an object larger than the cap (or 20 MB) is never cached; STORAGE_READ_CACHE_MB=0 turns the cache off", () => {
  const small = freshStorage(1);
  small.put("big", buf(2 * 1024 * 1024));
  assert.equal(small.get("big"), null);
  const off = freshStorage(0);
  off.put("a", buf(10));
  assert.equal(off.get("a"), null);
});
