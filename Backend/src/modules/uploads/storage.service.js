const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");

const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || "local";
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || path.join(process.cwd(), "storage");
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

async function storeBuffer(key, buffer) {
  if (STORAGE_PROVIDER !== "local") {
    throw new Error(`${STORAGE_PROVIDER} storage is not configured in this shared backend slice`);
  }
  const normalizedKey = normalizeKey(key);
  const filePath = path.join(LOCAL_STORAGE_PATH, normalizedKey);
  await ensureDirectory(filePath);
  await fs.writeFile(filePath, encrypt(buffer));
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
  return decrypt(await fs.readFile(path.join(LOCAL_STORAGE_PATH, normalizedKey)));
}

async function deleteObject(key) {
  const normalizedKey = normalizeKey(key);
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
