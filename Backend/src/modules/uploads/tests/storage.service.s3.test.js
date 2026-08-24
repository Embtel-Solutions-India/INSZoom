const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

// Runs against the REAL S3 bucket configured in Backend/.env (AWS_S3_BUCKET/
// AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) — this repo's existing
// test suite already assumes real external services (a real MongoDB, in
// several other modules' tests) rather than mocking them, so this follows
// the same convention. All objects live under a tests/s3-parity/ prefix and
// are deleted in `finally` blocks. Requires those AWS_* vars to be present;
// if they are not, every test here will fail loudly rather than silently
// skip, since a real bucket is expected to be configured in this environment.

const ENV_PATH = require.resolve("../../../config/env");
const STORAGE_PATH = require.resolve("../storage.service");

function withProvider(provider, fn) {
  const savedProvider = process.env.STORAGE_PROVIDER;
  process.env.STORAGE_PROVIDER = provider;
  delete require.cache[ENV_PATH];
  delete require.cache[STORAGE_PATH];
  try {
    return fn(require(STORAGE_PATH));
  } finally {
    if (savedProvider === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = savedProvider;
    delete require.cache[ENV_PATH];
    delete require.cache[STORAGE_PATH];
  }
}

function testKey(ext = "bin") {
  return `tests/s3-parity/${crypto.randomUUID()}.${ext}`;
}

test("s3: storeBuffer -> readBuffer round-trips the original bytes, checksum/size match the plaintext buffer", async () => {
  await withProvider("s3", async (storageService) => {
    const key = testKey("pdf");
    const content = Buffer.from("%PDF-1.7 s3 parity round trip");
    try {
      const result = await storageService.storeBuffer(key, content);
      assert.equal(result.provider, "s3");
      assert.equal(result.key, key);
      assert.equal(result.path, key);
      assert.equal(result.url, `/storage/${key}`);
      assert.equal(result.checksum, storageService.checksum(content));
      assert.equal(result.size, content.length);

      const readBack = await storageService.readBuffer(key);
      assert.deepEqual(readBack, content);
    } finally {
      await storageService.deleteObject(key);
    }
  });
});

test("s3: return object has the exact same keys as the local branch (drop-in for consumers)", async () => {
  const key = testKey("txt");
  const content = Buffer.from("shape parity check");
  let s3Keys;
  await withProvider("s3", async (storageService) => {
    try {
      const result = await storageService.storeBuffer(key, content);
      s3Keys = Object.keys(result).sort();
    } finally {
      await storageService.deleteObject(key);
    }
  });
  await withProvider("local", async (storageService) => {
    const localKey = testKey("txt");
    try {
      const result = await storageService.storeBuffer(localKey, content);
      assert.deepEqual(s3Keys, Object.keys(result).sort());
    } finally {
      await storageService.deleteObject(localKey);
    }
  });
});

test("s3: app-level encryption round-trips (ICRMENC1 envelope) when STORAGE_ENCRYPTION_KEY is set", async () => {
  const savedKey = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = "test-parity-encryption-key-do-not-use-in-prod";
  try {
    await withProvider("s3", async (storageService) => {
      const key = testKey("bin");
      const content = Buffer.from("plaintext that must be encrypted at rest");
      try {
        await storageService.storeBuffer(key, content);
        // Read the raw object back with the ORIGINAL S3 SDK directly (bypassing
        // storage.service.js's own readBuffer, which would decrypt it) to prove
        // what actually landed in the bucket is ciphertext with the envelope
        // header, not the plaintext.
        const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
        const env = require("../../../config/env");
        const client = new S3Client({ region: env.storage.aws.region, credentials: { accessKeyId: env.storage.aws.accessKeyId, secretAccessKey: env.storage.aws.secretAccessKey } });
        const raw = await client.send(new GetObjectCommand({ Bucket: env.storage.aws.bucket, Key: key }));
        const rawBuffer = Buffer.from(await raw.Body.transformToByteArray());
        assert.ok(rawBuffer.subarray(0, 8).equals(Buffer.from("ICRMENC1")), "stored object must carry the ICRMENC1 envelope header");
        assert.notDeepEqual(rawBuffer, content, "stored bytes must not equal the plaintext");

        const decrypted = await storageService.readBuffer(key);
        assert.deepEqual(decrypted, content);
      } finally {
        await storageService.deleteObject(key);
      }
    });
  } finally {
    if (savedKey === undefined) delete process.env.STORAGE_ENCRYPTION_KEY;
    else process.env.STORAGE_ENCRYPTION_KEY = savedKey;
  }
});

test("s3: without STORAGE_ENCRYPTION_KEY, bytes pass through unencrypted", async () => {
  const savedKey = process.env.STORAGE_ENCRYPTION_KEY;
  delete process.env.STORAGE_ENCRYPTION_KEY;
  try {
    await withProvider("s3", async (storageService) => {
      const key = testKey("bin");
      const content = Buffer.from("plaintext, no encryption configured");
      try {
        await storageService.storeBuffer(key, content);
        const readBack = await storageService.readBuffer(key);
        assert.deepEqual(readBack, content);
      } finally {
        await storageService.deleteObject(key);
      }
    });
  } finally {
    if (savedKey !== undefined) process.env.STORAGE_ENCRYPTION_KEY = savedKey;
  }
});

test("s3: storeImmutableBuffer — same key + same bytes is a duplicate, same key + different bytes collides", async () => {
  await withProvider("s3", async (storageService) => {
    const key = testKey("pdf");
    const original = Buffer.from("%PDF-1.7 s3 immutable object");
    try {
      const first = await storageService.storeImmutableBuffer(key, original);
      const duplicate = await storageService.storeImmutableBuffer(key, original);
      assert.equal(first.duplicate, false);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.checksum, first.checksum);

      await assert.rejects(
        storageService.storeImmutableBuffer(key, Buffer.from("%PDF-1.7 changed object")),
        (error) => error.code === "IMMUTABLE_STORAGE_COLLISION"
      );
    } finally {
      await storageService.deleteObject(key);
    }
  });
});

test("s3: deleteObject returns true for an existing key, false for a missing key", async () => {
  await withProvider("s3", async (storageService) => {
    const key = testKey("bin");
    await storageService.storeBuffer(key, Buffer.from("to be deleted"));
    const firstDelete = await storageService.deleteObject(key);
    assert.equal(firstDelete, true);
    const secondDelete = await storageService.deleteObject(key);
    assert.equal(secondDelete, false);
  });
});

test("s3: readBuffer on a missing key throws an ENOENT-coded error (parity with the local fs path)", async () => {
  await withProvider("s3", async (storageService) => {
    const key = testKey("bin");
    await assert.rejects(storageService.readBuffer(key), (error) => error.code === "ENOENT");
  });
});

test("boot: STORAGE_PROVIDER=s3 with AWS credentials missing fails fast at require time", () => {
  const saved = {
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  };
  process.env.STORAGE_PROVIDER = "s3";
  process.env.AWS_S3_BUCKET = "";
  process.env.AWS_ACCESS_KEY_ID = "";
  process.env.AWS_SECRET_ACCESS_KEY = "";
  delete require.cache[ENV_PATH];
  try {
    assert.throws(() => require(ENV_PATH), /STORAGE_PROVIDER=s3 requires/);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[ENV_PATH];
  }
});
