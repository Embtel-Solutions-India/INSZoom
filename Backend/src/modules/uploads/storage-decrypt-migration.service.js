// Converts objects written with the app-level AES-256-GCM envelope (ICRMENC1 header) into the plain file, in place, so they open directly in
// S3. Same key, so every storageKey / URL / checksum recorded in the database stays valid (checksums are of the plaintext).
//
// Safe by construction: dry-run unless apply is set; an object is only overwritten after it decrypted successfully; every rewrite is read
// back and compared to the plaintext checksum; objects that are already plain, empty or undecryptable are left alone; re-running skips what
// was already converted. On S3, apply requires bucket versioning so each original ciphertext stays recoverable as a previous version.
const storageService = require("./storage.service");
const { resolveContentType } = require("../../utils/fileResponse");

const { rawObjects, ENCRYPTION_HEADER } = storageService;

async function convertOne(key, { apply, verifyDecrypt }) {
  const head = await rawObjects.peek(key);
  if (!head.subarray(0, ENCRYPTION_HEADER.length).equals(ENCRYPTION_HEADER)) return { status: "plain" };
  if (!apply && !verifyDecrypt) return { status: "encrypted" };

  const stored = await rawObjects.read(key);
  let plaintext;
  try {
    plaintext = storageService.decrypt(stored);
  } catch (error) {
    return { status: "undecryptable", reason: error.code || error.message };
  }
  if (!apply) return { status: "encrypted", bytes: plaintext.length };

  const expected = storageService.checksum(plaintext);
  await rawObjects.write(key, plaintext, resolveContentType({ buffer: plaintext, fileName: key }));
  const written = await rawObjects.read(key);
  if (storageService.checksum(written) !== expected) {
    // Put the original bytes back so the object is never left unreadable.
    await rawObjects.write(key, stored, "application/octet-stream");
    return { status: "failed", reason: "read-back checksum mismatch; original restored" };
  }
  storageService._readCache.drop(key);
  return { status: "converted", bytes: plaintext.length };
}

async function convertAll({ apply = false, verifyDecrypt = false, prefix = "", limit = Infinity, concurrency = 4, allowUnversioned = false, confirmVersioning = false, log = () => {} } = {}) {
  const report = { apply, scanned: 0, plain: 0, encrypted: 0, converted: 0, undecryptable: [], failed: [], versioning: await rawObjects.versioning() };
  const versioningOk = report.versioning === "Enabled" || (report.versioning === "Unknown" && confirmVersioning) || allowUnversioned;
  if (apply && storageService.provider === "s3" && !versioningOk) {
    const error = new Error(
      report.versioning === "Unknown"
        ? "Refusing to apply: this IAM user cannot read the bucket's versioning status. Confirm in the S3 console that versioning is Enabled (so every original encrypted object stays recoverable), then re-run with --confirm-versioning."
        : `Refusing to apply: bucket versioning is "${report.versioning}", so the original encrypted objects would not be recoverable. Enable versioning (or pass --allow-unversioned).`
    );
    error.code = "VERSIONING_REQUIRED";
    throw error;
  }

  const pending = new Set();
  const handle = async (key) => {
    try {
      const result = await convertOne(key, { apply, verifyDecrypt });
      if (result.status === "plain") report.plain += 1;
      else if (result.status === "encrypted") report.encrypted += 1;
      else if (result.status === "converted") { report.encrypted += 1; report.converted += 1; log(`converted ${key} (${result.bytes} bytes)`); }
      else if (result.status === "undecryptable") { report.encrypted += 1; report.undecryptable.push({ key, reason: result.reason }); log(`UNDECRYPTABLE ${key}: ${result.reason}`); }
      else { report.failed.push({ key, reason: result.reason }); log(`FAILED ${key}: ${result.reason}`); }
    } catch (error) {
      report.failed.push({ key, reason: error.message });
      log(`FAILED ${key}: ${error.message}`);
    }
  };

  for await (const key of rawObjects.listKeys(prefix)) {
    if (report.scanned >= limit) break;
    report.scanned += 1;
    const task = handle(key).finally(() => pending.delete(task));
    pending.add(task);
    if (pending.size >= concurrency) await Promise.race(pending);
  }
  await Promise.all(pending);
  return report;
}

module.exports = { convertAll, convertOne };
