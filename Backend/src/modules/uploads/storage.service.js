const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");
const env = require("../../config/env");

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

function encrypt(buffer) {
  const key = encryptionKey();
  if (!key) return buffer;
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
  return Buffer.concat([decipher.update(buffer.subarray(offset + 28)), decipher.final()]);
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
    const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
    s3Commands = { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand };
    const { region, accessKeyId, secretAccessKey, endpoint, forcePathStyle } = env.storage.aws;
    s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
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

function isS3NotFound(error) {
  return error?.name === "NoSuchKey" || error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;
}

function isS3PreconditionFailed(error) {
  return error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;
}

async function s3PutObject(key, body, contentType) {
  const { client, commands } = getS3();
  await client.send(
    new commands.PutObjectCommand({
      Bucket: env.storage.aws.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      ServerSideEncryption: env.storage.aws.sse,
    })
  );
}

async function s3GetObject(key) {
  const { client, commands } = getS3();
  const response = await client.send(new commands.GetObjectCommand({ Bucket: env.storage.aws.bucket, Key: key }));
  return s3BodyToBuffer(response.Body);
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

async function storeBuffer(key, buffer, contentType) {
  const normalizedKey = normalizeKey(key);
  const encrypted = encrypt(buffer);

  if (STORAGE_PROVIDER === "s3") {
    await s3PutObject(normalizedKey, encrypted, contentType);
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
          ContentType: "application/octet-stream",
          ServerSideEncryption: env.storage.aws.sse,
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
          await s3PutObject(normalizedKey, encrypted, "application/octet-stream");
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
    await client.send(new commands.DeleteObjectCommand({ Bucket: env.storage.aws.bucket, Key: normalizedKey }));
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

module.exports = {
  checksum,
  decrypt,
  deleteObject,
  encrypt,
  generateDocumentKey,
  readBuffer,
  storeBuffer,
  storeImmutableBuffer,
};
