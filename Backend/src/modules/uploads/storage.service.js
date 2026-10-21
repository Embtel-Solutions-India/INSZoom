const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");
const env = require("../../config/env");
const { resolveContentType } = require("../../utils/fileResponse");

const STORAGE_PROVIDER = env.storage.provider;
const LOCAL_STORAGE_PATH = env.storage.localPath || path.join(process.cwd(), "storage");
const ENCRYPTION_HEADER = Buffer.from("ICRMENC1");

function normalizeKey(key) {
  return key.replace(/\\/g, "/").replace(/\.\./g, "");
}

async function ensureDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function encryptionKey() {
  const configured = process.env.STORAGE_ENCRYPTION_KEY;
  return configured ? crypto.createHash("sha256").update(configured).digest() : null;
}

// App-level encryption of NEW writes. On when STORAGE_ENCRYPTION_KEY is set unless STORAGE_APP_ENCRYPTION=off: objects are then stored as the
// plain file (still encrypted at rest by S3's own server-side encryption, env.storage.aws.sse), so they open directly in the S3 console. The
// key is still used by decrypt() to read objects written earlier, so keep it set until scripts/decryptStoredObjects.js has converted them all.
function appEncryptionEnabled() {
  return !["off", "false", "0", "no"].includes(String(process.env.STORAGE_APP_ENCRYPTION || "").trim().toLowerCase());
}

function encrypt(buffer) {
  const key = encryptionKey();
  if (!key || !appEncryptionEnabled()) return buffer;
  const initializationVector = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, initializationVector);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([ENCRYPTION_HEADER, initializationVector, cipher.getAuthTag(), encrypted]);
}

function decrypt(buffer) {
  if (!buffer.subarray(0, ENCRYPTION_HEADER.length).equals(ENCRYPTION_HEADER)) return buffer;
  const key = encryptionKey();
  if (!key) {
    const error = new Error("Storage encryption key is required to read this file");
    error.code = "STORAGE_ENCRYPTION_KEY_MISSING";
    throw error;
  }
  const offset = ENCRYPTION_HEADER.length;
  const initializationVector = buffer.subarray(offset, offset + 12);
  const authenticationTag = buffer.subarray(offset + 12, offset + 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, initializationVector);
  decipher.setAuthTag(authenticationTag);
  try {
    return Buffer.concat([decipher.update(buffer.subarray(offset + 28)), decipher.final()]);
  } catch (cause) {
    // GCM authentication failed: wrong STORAGE_ENCRYPTION_KEY for this object (e.g. a dev key reading prod data) or a corrupted object.
    const error = new Error("Stored file could not be decrypted - STORAGE_ENCRYPTION_KEY does not match the key it was written with, or the object is corrupted");
    error.code = "STORAGE_DECRYPTION_FAILED";
    error.cause = cause;
    throw error;
  }
}

function extensionFromName(fileName = "") {
  return path.extname(fileName).toLowerCase();
}

function generateDocumentKey({ caseId, userId, originalName }) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const ownerSegment = caseId ? `cases/${caseId}` : `users/${userId || "unknown"}`;
  return normalizeKey(`${ownerSegment}/${year}/${month}/${crypto.randomUUID()}${extensionFromName(originalName)}`);
}

// ── S3 client (lazy singleton — only constructed when provider is "s3") ──
let s3Client = null;
let s3Commands = null;

function getS3() {
  if (!s3Client) {
    // Required lazily, not at module top-level, so a "local"-provider
    // process never even needs @aws-sdk/client-s3 to resolve/load.
    const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetBucketVersioningCommand } = require("@aws-sdk/client-s3");
    s3Commands = { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetBucketVersioningCommand };
    const { region, accessKeyId, secretAccessKey, endpoint, forcePathStyle } = env.storage.aws;
    s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: Number(process.env.S3_MAX_ATTEMPTS) || 4, // the SDK retries transient failures (throttling, dropped connections, 5xx) itself
      ...(endpoint ? { endpoint, forcePathStyle } : {}),
    });
  }
  return { client: s3Client, commands: s3Commands };
}

async function s3BodyToBuffer(body) {
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  // Fallback for a plain Node.js Readable (older SDK builds / non-Node
  // runtimes without the sdk-stream-mixin helpers attached).
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// S3 server-side encryption for every write: SSE-S3 (AES256, default) or SSE-KMS (S3_SSE=aws:kms, optionally S3_SSE_KMS_KEY_ID). The data is
// encrypted at rest, and S3 decrypts it transparently for IAM principals allowed to read (and use the KMS key), so an object written without
// the app-level envelope still opens as a normal PDF in the S3 console while a leaked disk or bucket snapshot is unreadable.
function serverSideEncryption() {
  const { sse, sseKmsKeyId } = env.storage.aws;
  return { ServerSideEncryption: sse, ...(sse === "aws:kms" && sseKmsKeyId ? { SSEKMSKeyId: sseKmsKeyId } : {}) };
}

function isS3NotFound(error) {
  return error?.name === "NoSuchKey" || error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;
}

function isS3PreconditionFailed(error) {
  return error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;
}

// A small, bounded read cache for S3 objects: opening or downloading the same document again (View, then Download, a second reviewer) is
// served from memory instead of fetching it again - over a slow link one fetch of a 1.7 MB PDF took 43 s. It holds the object exactly as S3
// returned it (still ENCRYPTED - decryption happens per read as before), is dropped on every write and delete of that key, expires after
// 10 minutes and never exceeds STORAGE_READ_CACHE_MB (default 64; 0 turns it off). Objects over 20 MB are never cached.
const READ_CACHE_MAX_BYTES = Math.max(0, Number(process.env.STORAGE_READ_CACHE_MB ?? 64)) * 1024 * 1024;
const READ_CACHE_TTL_MS = 10 * 60 * 1000;
const READ_CACHE_MAX_OBJECT_BYTES = 20 * 1024 * 1024;
const readCache = new Map(); // key -> { buffer, at }  (Map order = least recently used first)
let readCacheBytes = 0;

function readCacheDrop(key) {
  const entry = readCache.get(key);
  if (!entry) return;
  readCache.delete(key);
  readCacheBytes -= entry.buffer.length;
}

function readCacheGet(key) {
  const entry = readCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > READ_CACHE_TTL_MS) { readCacheDrop(key); return null; }
  readCache.delete(key); // refresh recency
  readCache.set(key, entry);
  return Buffer.from(entry.buffer); // a copy: no caller can alter what is cached
}

function readCachePut(key, buffer) {
  if (!READ_CACHE_MAX_BYTES || buffer.length > READ_CACHE_MAX_OBJECT_BYTES || buffer.length > READ_CACHE_MAX_BYTES) return;
  readCacheDrop(key);
  readCache.set(key, { buffer: Buffer.from(buffer), at: Date.now() });
  readCacheBytes += buffer.length;
  while (readCacheBytes > READ_CACHE_MAX_BYTES && readCache.size) readCacheDrop(readCache.keys().next().value);
}

async function s3PutObject(key, body, contentType) {
  readCacheDrop(key); // a rewritten object must never be served from the old copy
  const { client, commands } = getS3();
  await client.send(
    new commands.PutObjectCommand({
      Bucket: env.storage.aws.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      ...serverSideEncryption(),
    })
  );
  readCacheDrop(key); // and again after the write: a read that raced it may have cached the old copy
}

async function s3GetObject(key) {
  const cached = readCacheGet(key);
  if (cached) return cached;
  const { client, commands } = getS3();
  const response = await client.send(new commands.GetObjectCommand({ Bucket: env.storage.aws.bucket, Key: key }));
  const buffer = await s3BodyToBuffer(response.Body);
  readCachePut(key, buffer);
  return buffer;
}

async function s3HeadObject(key) {
  const { client, commands } = getS3();
  try {
    await client.send(new commands.HeadObjectCommand({ Bucket: env.storage.aws.bucket, Key: key }));
    return true;
  } catch (error) {
    if (isS3NotFound(error)) return false;
    throw error;
  }
}

// Metadata-only probe (HEAD on S3, stat on local) — never transfers object
// bytes, so a registry health sweep over every USCIS form costs one HEAD per
// object rather than a full download. `storedSize` is the size of the stored
// object as-is: with STORAGE_ENCRYPTION_KEY set that is the AES-256-GCM
// envelope (+36 bytes of header/IV/auth tag), NOT the plaintext length, so
// callers comparing against a recorded plaintext fileSize must account for
// the envelope rather than expecting an exact match.
async function statObject(key) {
  const normalizedKey = normalizeKey(key);
  if (STORAGE_PROVIDER === "s3") {
    const { client, commands } = getS3();
    try {
      const response = await client.send(
        new commands.HeadObjectCommand({ Bucket: env.storage.aws.bucket, Key: normalizedKey })
      );
      return {
        exists: true,
        provider: "s3",
        key: normalizedKey,
        storedSize: response.ContentLength ?? null,
        lastModified: response.LastModified || null,
      };
    } catch (error) {
      if (isS3NotFound(error)) return { exists: false, provider: "s3", key: normalizedKey, storedSize: null, lastModified: null };
      throw error;
    }
  }
  try {
    const stats = await fs.stat(path.join(LOCAL_STORAGE_PATH, normalizedKey));
    return { exists: true, provider: "local", key: normalizedKey, storedSize: stats.size, lastModified: stats.mtime };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, provider: "local", key: normalizedKey, storedSize: null, lastModified: null };
    throw error;
  }
}

async function objectExists(key) {
  return (await statObject(key)).exists;
}

// The stored object's Content-Type: what the caller said, else sniffed from the bytes / key extension. A real type (not octet-stream) is what
// lets S3's "Open" show a PDF or image instead of downloading it.
function storedContentType(key, buffer, contentType) {
  return resolveContentType({ buffer, mimeType: contentType, fileName: key });
}

async function storeBuffer(key, buffer, contentType) {
  const normalizedKey = normalizeKey(key);
  const encrypted = encrypt(buffer);

  if (STORAGE_PROVIDER === "s3") {
    // Beyond the SDK's own retries: a failed write is attempted again (short pause) before the upload is reported as failed, so one
    // network hiccup never surfaces to the person uploading. A write that still fails throws, and the browser retries the upload too.
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await s3PutObject(normalizedKey, encrypted, storedContentType(normalizedKey, buffer, contentType));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    if (lastError) throw lastError;
    return {
      provider: "s3",
      key: normalizedKey,
      path: normalizedKey,
      url: `/storage/${normalizedKey}`,
      checksum: checksum(buffer),
      size: buffer.length,
    };
  }
  if (STORAGE_PROVIDER !== "local") {
    throw new Error(`${STORAGE_PROVIDER} storage is not configured in this shared backend slice`);
  }
  const filePath = path.join(LOCAL_STORAGE_PATH, normalizedKey);
  await ensureDirectory(filePath);
  await fs.writeFile(filePath, encrypted);
  return {
    provider: "local",
    key: normalizedKey,
    path: filePath,
    url: `/storage/${normalizedKey}`,
    checksum: checksum(buffer),
    size: buffer.length,
  };
}

async function storeImmutableBuffer(key, buffer) {
  const normalizedKey = normalizeKey(key);
  const expectedChecksum = checksum(buffer);

  if (STORAGE_PROVIDER === "s3") {
    const { client, commands } = getS3();
    const encrypted = encrypt(buffer);
    try {
      // Atomic create-if-absent — succeeds only if the key doesn't already
      // exist, so two concurrent writers can never corrupt each other.
      await client.send(
        new commands.PutObjectCommand({
          Bucket: env.storage.aws.bucket,
          Key: normalizedKey,
          Body: encrypted,
          ContentType: storedContentType(normalizedKey, buffer),
          ...serverSideEncryption(),
          IfNoneMatch: "*",
        })
      );
      return {
        provider: "s3",
        key: normalizedKey,
        path: normalizedKey,
        url: `/storage/${normalizedKey}`,
        checksum: expectedChecksum,
        size: buffer.length,
        duplicate: false,
      };
    } catch (error) {
      // Some S3-compatible endpoints don't support IfNoneMatch on PUT and
      // reject the request outright rather than evaluating it (distinct
      // from a genuine 412 collision) — fall back to Head-then-compare for
      // those. A real 412 means the key already exists; either way we now
      // need to fetch and compare the existing object's checksum.
      if (!isS3PreconditionFailed(error) && !/IfNoneMatch|NotImplemented/i.test(error?.message || "")) throw error;
      let existing;
      try {
        existing = decrypt(await s3GetObject(normalizedKey));
      } catch (getError) {
        if (isS3NotFound(getError)) {
          // Genuinely didn't exist (the endpoint just doesn't support
          // IfNoneMatch) — retry as a plain put now that we know it's safe.
          await s3PutObject(normalizedKey, encrypted, storedContentType(normalizedKey, buffer));
          return {
            provider: "s3",
            key: normalizedKey,
            path: normalizedKey,
            url: `/storage/${normalizedKey}`,
            checksum: expectedChecksum,
            size: buffer.length,
            duplicate: false,
          };
        }
        throw getError;
      }
      const existingChecksum = checksum(existing);
      if (existingChecksum !== expectedChecksum) {
        const collisionError = new Error(`Immutable object collision for ${normalizedKey}`);
        collisionError.code = "IMMUTABLE_STORAGE_COLLISION";
        throw collisionError;
      }
      return {
        provider: "s3",
        key: normalizedKey,
        path: normalizedKey,
        url: `/storage/${normalizedKey}`,
        checksum: existingChecksum,
        size: existing.length,
        duplicate: true,
      };
    }
  }

  if (STORAGE_PROVIDER !== "local") {
    throw new Error(`${STORAGE_PROVIDER} storage is not configured in this shared backend slice`);
  }
  const filePath = path.join(LOCAL_STORAGE_PATH, normalizedKey);
  try {
    const existing = decrypt(await fs.readFile(filePath));
    const existingChecksum = checksum(existing);
    if (existingChecksum !== expectedChecksum) {
      const error = new Error(`Immutable object collision for ${normalizedKey}`);
      error.code = "IMMUTABLE_STORAGE_COLLISION";
      throw error;
    }
    return {
      provider: "local",
      key: normalizedKey,
      path: filePath,
      url: `/storage/${normalizedKey}`,
      checksum: existingChecksum,
      size: existing.length,
      duplicate: true,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await ensureDirectory(filePath);
  try {
    await fs.writeFile(filePath, encrypt(buffer), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = decrypt(await fs.readFile(filePath));
    const existingChecksum = checksum(existing);
    if (existingChecksum !== expectedChecksum) {
      const collisionError = new Error(`Immutable object collision for ${normalizedKey}`);
      collisionError.code = "IMMUTABLE_STORAGE_COLLISION";
      throw collisionError;
    }
    return {
      provider: "local",
      key: normalizedKey,
      path: filePath,
      url: `/storage/${normalizedKey}`,
      checksum: existingChecksum,
      size: existing.length,
      duplicate: true,
    };
  }
  return {
    provider: "local",
    key: normalizedKey,
    path: filePath,
    url: `/storage/${normalizedKey}`,
    checksum: expectedChecksum,
    size: buffer.length,
    duplicate: false,
  };
}

async function readBuffer(key) {
  const normalizedKey = normalizeKey(key);
  if (STORAGE_PROVIDER === "s3") {
    try {
      return decrypt(await s3GetObject(normalizedKey));
    } catch (error) {
      if (isS3NotFound(error)) {
        // Mirror the local fs.readFile ENOENT shape so any caller that
        // already checks error.code === "ENOENT" behaves identically
        // regardless of provider.
        const notFound = new Error(`ENOENT: no such object, open '${normalizedKey}'`);
        notFound.code = "ENOENT";
        throw notFound;
      }
      throw error;
    }
  }
  return decrypt(await fs.readFile(path.join(LOCAL_STORAGE_PATH, normalizedKey)));
}

async function deleteObject(key) {
  const normalizedKey = normalizeKey(key);
  if (STORAGE_PROVIDER === "s3") {
    // S3's DeleteObject is idempotent (succeeds even for a missing key), so
    // existence has to be checked first to mirror local's true/false
    // ENOENT-vs-deleted contract.
    const exists = await s3HeadObject(normalizedKey);
    if (!exists) return false;
    const { client, commands } = getS3();
    readCacheDrop(normalizedKey);
    await client.send(new commands.DeleteObjectCommand({ Bucket: env.storage.aws.bucket, Key: normalizedKey }));
    readCacheDrop(normalizedKey);
    return true;
  }
  try {
    await fs.unlink(path.join(LOCAL_STORAGE_PATH, normalizedKey));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// ── Raw object access: for the encrypted -> plain conversion (scripts/decryptStoredObjects.js) only. Bypasses decrypt() and the read cache. ──
async function* walkLocal(directory, prefix = "") {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walkLocal(path.join(directory, entry.name), relative);
    else yield relative;
  }
}

const rawObjects = {
  async *listKeys(prefix = "") {
    if (STORAGE_PROVIDER === "s3") {
      const { client, commands } = getS3();
      let token;
      do {
        const page = await client.send(new commands.ListObjectsV2Command({ Bucket: env.storage.aws.bucket, Prefix: prefix, ContinuationToken: token }));
        for (const object of page.Contents || []) yield object.Key;
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return;
    }
    for await (const key of walkLocal(LOCAL_STORAGE_PATH)) if (key.startsWith(prefix)) yield key;
  },
  // First bytes of the stored object, without transferring the rest of it.
  async peek(key, length = ENCRYPTION_HEADER.length) {
    const normalizedKey = normalizeKey(key);
    if (STORAGE_PROVIDER === "s3") {
      const { client, commands } = getS3();
      try {
        const response = await client.send(new commands.GetObjectCommand({ Bucket: env.storage.aws.bucket, Key: normalizedKey, Range: `bytes=0-${length - 1}` }));
        return await s3BodyToBuffer(response.Body);
      } catch (error) {
        if (error?.name === "InvalidRange" || error?.$metadata?.httpStatusCode === 416) return Buffer.alloc(0); // empty object
        throw error;
      }
    }
    const handle = await fs.open(path.join(LOCAL_STORAGE_PATH, normalizedKey), "r");
    try {
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  async read(key) {
    const normalizedKey = normalizeKey(key);
    if (STORAGE_PROVIDER === "s3") {
      const { client, commands } = getS3();
      const response = await client.send(new commands.GetObjectCommand({ Bucket: env.storage.aws.bucket, Key: normalizedKey }));
      return s3BodyToBuffer(response.Body);
    }
    return fs.readFile(path.join(LOCAL_STORAGE_PATH, normalizedKey));
  },
  // Overwrites in place with exactly these bytes (no encryption) and a real Content-Type.
  async write(key, buffer, contentType) {
    const normalizedKey = normalizeKey(key);
    if (STORAGE_PROVIDER === "s3") return s3PutObject(normalizedKey, buffer, contentType);
    const filePath = path.join(LOCAL_STORAGE_PATH, normalizedKey);
    const temp = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(temp, buffer);
    await fs.rename(temp, filePath);
  },
  // "Enabled" | "Suspended" | "Unversioned" | "Unknown" (S3, no permission to ask), null for local storage. Previous versions are what make the conversion reversible.
  async versioning() {
    if (STORAGE_PROVIDER !== "s3") return null;
    const { client, commands } = getS3();
    try {
      const response = await client.send(new commands.GetBucketVersioningCommand({ Bucket: env.storage.aws.bucket }));
      return response.Status || "Unversioned";
    } catch (error) {
      if (error?.name === "AccessDenied" || error?.$metadata?.httpStatusCode === 403) return "Unknown"; // the IAM user lacks s3:GetBucketVersioning
      throw error;
    }
  },
};

module.exports = {
  checksum,
  _readCache: { get: readCacheGet, put: readCachePut, drop: readCacheDrop, size: () => readCache.size, bytes: () => readCacheBytes },
  decrypt,
  deleteObject,
  appEncryptionEnabled,
  encrypt,
  ENCRYPTION_HEADER,
  generateDocumentKey,
  objectExists,
  provider: STORAGE_PROVIDER,
  rawObjects,
  readBuffer,
  statObject,
  storeBuffer,
  storeImmutableBuffer,
};
