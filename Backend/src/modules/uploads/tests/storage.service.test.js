const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const storageService = require("../storage.service");

test("immutable storage deduplicates identical content and rejects collisions", async () => {
  const key = `tests/immutable/${crypto.randomUUID()}.pdf`;
  const original = Buffer.from("%PDF-1.7 immutable object");

  try {
    const first = await storageService.storeImmutableBuffer(key, original);
    const duplicate = await storageService.storeImmutableBuffer(key, original);

    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.checksum, first.checksum);
    await assert.rejects(
      storageService.storeImmutableBuffer(key, Buffer.from("%PDF-1.7 changed object")),
      (error) => error.code === "IMMUTABLE_STORAGE_COLLISION",
    );
  } finally {
    await storageService.deleteObject(key);
  }
});

test("concurrent immutable writes create one object without corrupting it", async () => {
  const key = `tests/immutable/${crypto.randomUUID()}.pdf`;
  const content = Buffer.from("%PDF-1.7 concurrent immutable object");

  try {
    const results = await Promise.all([
      storageService.storeImmutableBuffer(key, content),
      storageService.storeImmutableBuffer(key, content),
    ]);
    assert.equal(results.filter((result) => result.duplicate === false).length, 1);
    assert.equal(results.filter((result) => result.duplicate === true).length, 1);
    assert.deepEqual(await storageService.readBuffer(key), content);
  } finally {
    await storageService.deleteObject(key);
  }
});
