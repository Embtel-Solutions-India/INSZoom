const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const { assertFileNameAllowed, limitError } = require("../uploads/upload-limits");
const logger = require("../../utils/logger");

// Chunked, resumable file transfer for chat attachments (messages + attorney
// feedback). A browser cuts a big file into CHUNK_BYTES pieces and PUTs them one
// by one, so no single request ever carries more than a few MB (no proxy / body
// limit / timeout trouble, and a dropped chunk is simply re-sent). Chunks are
// staged on local disk and joined on `complete`; the file is then "staged" until
// the message that references it (by `uploadIds`) is sent, at which point the
// message services load it and hand it to the normal storage path (S3, encryption,
// checksums) exactly like a multipart attachment. Staged files are private to
// the uploader and are swept after STAGED_TTL_MS if never used.

const MAX_FILE_BYTES = Number(process.env.CHUNKED_UPLOAD_MAX_BYTES) || 400 * 1024 * 1024;
const CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_ACTIVE_PER_USER = 20;
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;
const ROOT = process.env.CHUNKED_UPLOAD_DIR || path.join(os.tmpdir(), "icrm-chunked-uploads");
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const dirOf = (uploadId) => path.join(ROOT, uploadId);
const chunkPath = (uploadId, index) => path.join(dirOf(uploadId), `chunk_${String(index).padStart(6, "0")}.part`);
const assembledPath = (uploadId) => path.join(dirOf(uploadId), "assembled.bin");
const metaPath = (uploadId) => path.join(dirOf(uploadId), "meta.json");

function fail(message, status, code) {
  return limitError(message, status, code);
}

async function readMeta(uploadId, userId) {
  if (!ID_PATTERN.test(String(uploadId))) throw fail("Upload not found", 404, "UPLOAD_NOT_FOUND");
  let meta;
  try {
    meta = JSON.parse(await fsp.readFile(metaPath(uploadId), "utf8"));
  } catch {
    throw fail("Upload not found or expired", 404, "UPLOAD_NOT_FOUND");
  }
  // Same answer for "not yours" and "not there": never confirm another user's upload exists.
  if (String(meta.userId) !== String(userId)) throw fail("Upload not found", 404, "UPLOAD_NOT_FOUND");
  return meta;
}

const writeMeta = (uploadId, meta) => fsp.writeFile(metaPath(uploadId), JSON.stringify(meta));

let sweepTimer = null;
function ensureSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepExpired().catch((error) => logger.warn("chunked_upload_sweep_failed", { error })), 60 * 60 * 1000);
  sweepTimer.unref();
}

async function sweepExpired() {
  let names = [];
  try { names = await fsp.readdir(ROOT); } catch { return; }
  const cutoff = Date.now() - STAGED_TTL_MS;
  await Promise.all(names.map(async (name) => {
    try {
      const stat = await fsp.stat(path.join(ROOT, name));
      if (stat.mtimeMs < cutoff) await fsp.rm(path.join(ROOT, name), { recursive: true, force: true });
    } catch { /* already gone */ }
  }));
}

async function activeCount(userId) {
  let names = [];
  try { names = await fsp.readdir(ROOT); } catch { return 0; }
  let count = 0;
  for (const name of names) {
    try {
      const meta = JSON.parse(await fsp.readFile(metaPath(name), "utf8"));
      if (String(meta.userId) === String(userId)) count += 1;
    } catch { /* not an upload dir */ }
  }
  return count;
}

async function init({ userId, fileName, fileSize, mimeType }) {
  const name = String(fileName || "").trim();
  const size = Number(fileSize);
  if (!name) throw fail("A file name is required", 400, "FILE_NAME_REQUIRED");
  if (!Number.isFinite(size) || size <= 0) throw fail("The file is empty", 400, "FILE_EMPTY");
  assertFileNameAllowed(name);
  if (size > MAX_FILE_BYTES) {
    throw fail(`"${name}" is larger than the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB limit per file.`, 413, "FILE_TOO_LARGE");
  }
  ensureSweeper();
  if ((await activeCount(userId)) >= MAX_ACTIVE_PER_USER) {
    throw fail("Too many files are waiting to be sent. Send or remove some and try again.", 429, "TOO_MANY_UPLOADS");
  }
  const uploadId = crypto.randomUUID();
  await fsp.mkdir(dirOf(uploadId), { recursive: true });
  const totalChunks = Math.ceil(size / CHUNK_BYTES);
  await writeMeta(uploadId, {
    uploadId,
    userId: String(userId),
    fileName: name.slice(0, 255),
    fileSize: size,
    mimeType: String(mimeType || "application/octet-stream").slice(0, 200),
    chunkBytes: CHUNK_BYTES,
    totalChunks,
    status: "uploading",
    createdAt: new Date().toISOString(),
  });
  return { uploadId, chunkBytes: CHUNK_BYTES, totalChunks, maxBytes: MAX_FILE_BYTES };
}

async function writeChunk({ userId, uploadId, index, body }) {
  const meta = await readMeta(uploadId, userId);
  if (meta.status !== "uploading") throw fail("This upload is already complete", 409, "UPLOAD_ALREADY_COMPLETE");
  const position = Number(index);
  if (!Number.isInteger(position) || position < 0 || position >= meta.totalChunks) throw fail("Invalid chunk number", 400, "CHUNK_INDEX_INVALID");
  if (!Buffer.isBuffer(body) || !body.length) throw fail("The chunk is empty", 400, "CHUNK_EMPTY");
  const expected = position === meta.totalChunks - 1 ? meta.fileSize - CHUNK_BYTES * (meta.totalChunks - 1) : CHUNK_BYTES;
  if (body.length !== expected) throw fail(`Chunk ${position} has the wrong size`, 400, "CHUNK_SIZE_MISMATCH");
  // Write-then-rename: a half-written chunk (dropped connection) is never mistaken for a good one, and re-sending a chunk just replaces it.
  const target = chunkPath(uploadId, position);
  const temp = `${target}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(temp, body);
  await fsp.rename(temp, target);
  return { index: position, received: body.length };
}

// Which chunks the server already has - lets a client resume after a reload/network drop instead of starting over.
async function status({ userId, uploadId }) {
  const meta = await readMeta(uploadId, userId);
  const present = [];
  if (meta.status === "uploading") {
    for (let index = 0; index < meta.totalChunks; index += 1) {
      try { await fsp.access(chunkPath(uploadId, index)); present.push(index); } catch { /* missing */ }
    }
  }
  return { uploadId, status: meta.status, totalChunks: meta.totalChunks, chunkBytes: meta.chunkBytes, receivedChunks: present };
}

async function complete({ userId, uploadId }) {
  const meta = await readMeta(uploadId, userId);
  if (meta.status === "ready") return { uploadId, fileName: meta.fileName, fileSize: meta.fileSize, mimeType: meta.mimeType };
  const missing = [];
  for (let index = 0; index < meta.totalChunks; index += 1) {
    try { await fsp.access(chunkPath(uploadId, index)); } catch { missing.push(index); }
  }
  if (missing.length) {
    const error = fail("Some parts of the file have not arrived yet", 409, "CHUNKS_MISSING");
    error.missingChunks = missing.slice(0, 200);
    throw error;
  }
  const output = fs.createWriteStream(assembledPath(uploadId));
  try {
    for (let index = 0; index < meta.totalChunks; index += 1) {
      await pipeline(fs.createReadStream(chunkPath(uploadId, index)), output, { end: false });
    }
    await new Promise((resolve, reject) => output.end((error) => (error ? reject(error) : resolve())));
  } catch (error) {
    output.destroy();
    await fsp.rm(assembledPath(uploadId), { force: true });
    throw error;
  }
  const { size } = await fsp.stat(assembledPath(uploadId));
  if (size !== meta.fileSize) {
    await fsp.rm(assembledPath(uploadId), { force: true });
    throw fail("The assembled file does not match its expected size - please upload it again", 422, "ASSEMBLED_SIZE_MISMATCH");
  }
  await Promise.all(Array.from({ length: meta.totalChunks }, (_, index) => fsp.rm(chunkPath(uploadId, index), { force: true })));
  await writeMeta(uploadId, { ...meta, status: "ready", completedAt: new Date().toISOString() });
  return { uploadId, fileName: meta.fileName, fileSize: meta.fileSize, mimeType: meta.mimeType };
}

async function abort({ userId, uploadId }) {
  await readMeta(uploadId, userId);
  await fsp.rm(dirOf(uploadId), { recursive: true, force: true });
}

// "uploadIds" arrives as a JSON array, a repeated field, a comma list or a JSON string depending on the client / content type.
function normalizeUploadIds(raw) {
  if (!raw) return [];
  let list = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text.startsWith("[")) {
      try { list = JSON.parse(text); } catch { list = text.split(","); }
    } else {
      list = text.split(",");
    }
  }
  if (!Array.isArray(list)) list = [list];
  return [...new Set(list.map((value) => String(value).trim()).filter((value) => ID_PATTERN.test(value)))].slice(0, 10);
}

// Returns multer-shaped file objects ({ originalname, mimetype, size, buffer }) for the staged uploads this user finished, so the message
// services can feed them through the same storeAttachments() path as ordinary multipart files.
async function loadStaged(userId, uploadIds) {
  const files = [];
  for (const uploadId of uploadIds) {
    const meta = await readMeta(uploadId, userId);
    if (meta.status !== "ready") throw fail(`"${meta.fileName}" has not finished uploading`, 409, "UPLOAD_NOT_READY");
    const buffer = await fsp.readFile(assembledPath(uploadId));
    files.push({ originalname: meta.fileName, mimetype: meta.mimeType, size: meta.fileSize, buffer, __uploadId: uploadId });
  }
  return files;
}

async function discard(uploadIds = []) {
  await Promise.all(uploadIds.map((uploadId) => (ID_PATTERN.test(String(uploadId)) ? fsp.rm(dirOf(uploadId), { recursive: true, force: true }).catch(() => {}) : null)));
}

module.exports = { MAX_FILE_BYTES, CHUNK_BYTES, init, writeChunk, status, complete, abort, normalizeUploadIds, loadStaged, discard, sweepExpired };
