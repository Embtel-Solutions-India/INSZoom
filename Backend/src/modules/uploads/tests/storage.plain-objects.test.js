// DB-free: local provider in a temp dir (never S3).
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-plain-objects-"));
process.env.STORAGE_PROVIDER = "local";
process.env.LOCAL_STORAGE_PATH = storageDir;
process.env.STORAGE_ENCRYPTION_KEY = "plain-objects-test-key";
delete process.env.STORAGE_APP_ENCRYPTION;

const storageService = require("../storage.service");
const { convertAll } = require("../storage-decrypt-migration.service");

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), crypto.randomBytes(4096), Buffer.from("\n%%EOF")]);
const onDisk = (key) => fs.readFileSync(path.join(storageDir, key));

test.after(() => fs.rmSync(storageDir, { recursive: true, force: true }));

test("default: with a key set, new objects are encrypted at rest", async () => {
  assert.equal(storageService.appEncryptionEnabled(), true);
  await storageService.storeBuffer("cases/c1/enc.pdf", PDF);
  assert.equal(onDisk("cases/c1/enc.pdf").subarray(0, 8).toString(), "ICRMENC1");
});

test("STORAGE_APP_ENCRYPTION=off: new objects are the plain file and still read back", async () => {
  process.env.STORAGE_APP_ENCRYPTION = "off";
  try {
    assert.equal(storageService.appEncryptionEnabled(), false);
    const stored = await storageService.storeBuffer("cases/c1/plain.pdf", PDF);
    assert.deepEqual(onDisk("cases/c1/plain.pdf"), PDF);
    assert.equal(stored.checksum, storageService.checksum(PDF));
    assert.deepEqual(await storageService.readBuffer("cases/c1/plain.pdf"), PDF);
    await storageService.storeImmutableBuffer("forms/i129/v1.pdf", PDF);
    assert.deepEqual(onDisk("forms/i129/v1.pdf"), PDF);
    assert.equal((await storageService.storeImmutableBuffer("forms/i129/v1.pdf", PDF)).duplicate, true);
  } finally {
    delete process.env.STORAGE_APP_ENCRYPTION;
  }
});

test("objects encrypted earlier stay readable while encryption is off", async () => {
  process.env.STORAGE_APP_ENCRYPTION = "off";
  try {
    assert.deepEqual(await storageService.readBuffer("cases/c1/enc.pdf"), PDF);
  } finally {
    delete process.env.STORAGE_APP_ENCRYPTION;
  }
});

test("dry run changes nothing and reports what it would convert", async () => {
  const before = onDisk("cases/c1/enc.pdf");
  const report = await convertAll({});
  assert.equal(report.apply, false);
  assert.equal(report.encrypted, 1);
  assert.equal(report.plain, 2);
  assert.equal(report.converted, 0);
  assert.deepEqual(onDisk("cases/c1/enc.pdf"), before);
});

test("dry run with verifyDecrypt proves the key works without writing", async () => {
  const report = await convertAll({ verifyDecrypt: true });
  assert.equal(report.undecryptable.length, 0);
  assert.equal(onDisk("cases/c1/enc.pdf").subarray(0, 8).toString(), "ICRMENC1");
});

test("an undecryptable object (wrong key) is left untouched and reported", async () => {
  const good = process.env.STORAGE_ENCRYPTION_KEY;
  const before = onDisk("cases/c1/enc.pdf");
  process.env.STORAGE_ENCRYPTION_KEY = "another-environments-key";
  try {
    const report = await convertAll({ apply: true });
    assert.equal(report.converted, 0);
    assert.deepEqual(report.undecryptable.map((item) => item.key), ["cases/c1/enc.pdf"]);
  } finally {
    process.env.STORAGE_ENCRYPTION_KEY = good;
  }
  assert.deepEqual(onDisk("cases/c1/enc.pdf"), before);
});

test("apply converts encrypted objects to the exact original bytes; plain ones are untouched; re-run is a no-op", async () => {
  await storageService.storeBuffer("users/u1/2026/10/second.pdf", PDF);
  await storageService.storeBuffer("cases/c2/empty.txt", Buffer.alloc(0));
  const plainBefore = onDisk("cases/c1/plain.pdf");

  const report = await convertAll({ apply: true, concurrency: 2 });
  assert.equal(report.converted, 3); // enc.pdf, second.pdf and the (encrypted) empty file
  assert.equal(report.failed.length, 0);
  assert.equal(report.undecryptable.length, 0);
  assert.deepEqual(onDisk("cases/c1/enc.pdf"), PDF);
  assert.deepEqual(onDisk("users/u1/2026/10/second.pdf"), PDF);
  assert.equal(onDisk("cases/c2/empty.txt").length, 0);
  assert.deepEqual(onDisk("cases/c1/plain.pdf"), plainBefore);
  assert.deepEqual(await storageService.readBuffer("cases/c1/enc.pdf"), PDF);

  const again = await convertAll({ apply: true });
  assert.equal(again.converted, 0);
  assert.equal(again.encrypted, 0);
});

test("prefix and limit scope the run", async () => {
  await storageService.storeBuffer("cases/c3/a.pdf", PDF);
  await storageService.storeBuffer("other/b.pdf", PDF);
  const scoped = await convertAll({ apply: true, prefix: "cases/c3/" });
  assert.equal(scoped.converted, 1);
  assert.equal(onDisk("other/b.pdf").subarray(0, 8).toString(), "ICRMENC1");
  assert.equal((await convertAll({ apply: true, limit: 0 })).scanned, 0);
});
