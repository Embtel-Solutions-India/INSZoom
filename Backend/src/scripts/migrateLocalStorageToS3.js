// One-time, non-destructive, idempotent, resumable backfill: copies every
// existing local-disk file into S3 and flips storageProvider to "s3" on the
// owning record, WITHOUT deleting any local file or any database record.
//
// Run this BEFORE setting STORAGE_PROVIDER=s3 in the real environment — it
// forces its own writes to S3 regardless of the current .env value, while
// reading source bytes directly off local disk, so it's safe to run at any
// point before the operator flips the switch.
//
// Usage:
//   node src/scripts/migrateLocalStorageToS3.js [--dry-run]
//
// Idempotent: a record already marked storageProvider:"s3" is skipped on a
// re-run. Resumable: each record is migrated and flipped independently, so
// a crash mid-run just leaves the remaining local-provider records to pick
// up on the next run. Exits non-zero if any checksum mismatch occurred.
require("dotenv").config();
const fs = require("fs").promises;
const path = require("path");
const mongoose = require("mongoose");

const DRY_RUN = process.argv.includes("--dry-run");

// storageService's own writes must target S3 for this script regardless of
// the real .env STORAGE_PROVIDER value (the whole point of this script is
// to run BEFORE that gets flipped) — forced before the first require.
process.env.STORAGE_PROVIDER = "s3";
const storageService = require("../modules/uploads/storage.service");

const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");

const Document = require("../models/Document");
const Message = require("../models/Message");
const USCISFormTemplate = require("../models/USCISFormTemplate");

const report = { migrated: 0, skipped: 0, checksumMismatch: 0, missingLocalFile: 0, errors: 0 };

async function readLocalPlaintext(key) {
  const raw = await fs.readFile(path.join(LOCAL_STORAGE_PATH, key));
  // decrypt() is a pure function independent of the provider switch — a
  // no-op if STORAGE_ENCRYPTION_KEY isn't set, so this is always safe to call.
  return storageService.decrypt(raw);
}

// Migrates one {storageKey, storageProvider, checksum} triple in place.
// Returns "migrated" | "skipped" | "mismatch" | "missing".
async function migrateOne({ storageKey, storageProvider, expectedChecksum, label }) {
  if (!storageKey) return "skipped";
  if (storageProvider === "s3") return "skipped";

  let plaintext;
  try {
    plaintext = await readLocalPlaintext(storageKey);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(`[missing] ${label}: local file not found for storageKey=${storageKey}`);
      report.missingLocalFile += 1;
      return "missing";
    }
    throw error;
  }

  const actualChecksum = storageService.checksum(plaintext);
  if (expectedChecksum && actualChecksum !== expectedChecksum) {
    console.error(`[mismatch] ${label}: stored checksum=${expectedChecksum} does not match local file checksum=${actualChecksum} for storageKey=${storageKey}`);
    report.checksumMismatch += 1;
    return "mismatch";
  }

  if (DRY_RUN) {
    console.log(`[dry-run] would migrate ${label} (storageKey=${storageKey}, ${plaintext.length} bytes)`);
    return "migrated";
  }

  const result = await storageService.storeBuffer(storageKey, plaintext);
  if (result.checksum !== actualChecksum) {
    // storeBuffer computed its own checksum of the same plaintext buffer —
    // this can only fail if storeBuffer itself is broken, not a real-world
    // data issue, but treat it with the same severity either way.
    console.error(`[mismatch] ${label}: post-store checksum verification failed for storageKey=${storageKey}`);
    report.checksumMismatch += 1;
    return "mismatch";
  }

  console.log(`[migrated] ${label} (storageKey=${storageKey}, ${plaintext.length} bytes)`);
  report.migrated += 1;
  return "migrated";
}

async function migrateDocuments() {
  const cursor = Document.find({
    deletedAt: { $exists: false },
    $or: [{ storageProvider: { $ne: "s3" } }, { "versions.storageProvider": { $ne: "s3" } }],
  }).cursor();

  for await (const document of cursor) {
    let changed = false;

    const currentResult = await migrateOne({
      storageKey: document.storageKey,
      storageProvider: document.storageProvider,
      expectedChecksum: document.checksum,
      label: `Document ${document._id} (current version)`,
    }).catch((error) => {
      console.error(`[error] Document ${document._id}: ${error.message}`);
      report.errors += 1;
      return null;
    });
    if (currentResult === "migrated" && !DRY_RUN) {
      document.storageProvider = "s3";
      changed = true;
    }

    for (const version of document.versions || []) {
      const versionResult = await migrateOne({
        storageKey: version.storageKey,
        storageProvider: version.storageProvider,
        expectedChecksum: version.checksum,
        label: `Document ${document._id} version ${version.version}`,
      }).catch((error) => {
        console.error(`[error] Document ${document._id} version ${version.version}: ${error.message}`);
        report.errors += 1;
        return null;
      });
      if (versionResult === "migrated" && !DRY_RUN) {
        version.storageProvider = "s3";
        changed = true;
      }
    }

    if (changed) await document.save();
  }
}

async function migrateMessages() {
  const cursor = Message.find({
    deletedAt: { $exists: false },
    "attachments.storageProvider": { $ne: "s3" },
    "attachments.0": { $exists: true },
  }).cursor();

  for await (const message of cursor) {
    let changed = false;
    for (const attachment of message.attachments || []) {
      const result = await migrateOne({
        storageKey: attachment.storageKey,
        storageProvider: attachment.storageProvider,
        expectedChecksum: attachment.checksum,
        label: `Message ${message._id} attachment ${attachment._id}`,
      }).catch((error) => {
        console.error(`[error] Message ${message._id} attachment ${attachment._id}: ${error.message}`);
        report.errors += 1;
        return null;
      });
      if (result === "migrated" && !DRY_RUN) {
        attachment.storageProvider = "s3";
        changed = true;
      }
    }
    if (changed) await message.save();
  }
}

async function migrateUSCISFormTemplates() {
  const cursor = USCISFormTemplate.find({
    $or: [
      { "artifacts.form.storageProvider": { $exists: true, $ne: "s3" } },
      { "artifacts.instructions.storageProvider": { $exists: true, $ne: "s3" } },
    ],
  }).cursor();

  for await (const template of cursor) {
    let changed = false;
    for (const artifactName of ["form", "instructions"]) {
      const artifact = template.artifacts?.[artifactName];
      if (!artifact?.storageKey) continue;
      const result = await migrateOne({
        storageKey: artifact.storageKey,
        storageProvider: artifact.storageProvider,
        expectedChecksum: undefined, // this schema doesn't track a checksum field today
        label: `USCISFormTemplate ${template._id} artifacts.${artifactName}`,
      }).catch((error) => {
        console.error(`[error] USCISFormTemplate ${template._id} artifacts.${artifactName}: ${error.message}`);
        report.errors += 1;
        return null;
      });
      if (result === "migrated" && !DRY_RUN) {
        artifact.storageProvider = "s3";
        changed = true;
      }
    }
    if (changed) await template.save();
  }
}

async function main() {
  console.log(`Starting local -> S3 storage backfill${DRY_RUN ? " (DRY RUN — no writes, no S3 puts, no DB updates)" : ""}`);
  console.log(`Reading local files from: ${LOCAL_STORAGE_PATH}`);
  console.log(`Writing to S3 bucket: ${process.env.AWS_S3_BUCKET || "(not configured — this will fail)"}\n`);

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    await migrateDocuments();
    await migrateMessages();
    await migrateUSCISFormTemplates();
  } finally {
    await mongoose.disconnect();
  }

  console.log("\n=== Backfill report ===");
  console.log(JSON.stringify(report, null, 2));
  console.log(
    "\nNote: Case.checklist/excelWorkbook, Answer file-answer, and DocumentExtraction.excelWorkbook storageKey fields are cached " +
    "pointers to a Document record (each has a document/documentId ref alongside the cached key) rather than independently-owned " +
    "files — migrating Document above already covers the underlying bytes those fields point at; they carry no storageProvider " +
    "field of their own to flip."
  );

  if (report.checksumMismatch > 0) {
    console.error(`\nFAILED: ${report.checksumMismatch} checksum mismatch(es) — investigate before relying on S3 for these keys.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Backfill script crashed:", error);
  process.exitCode = 1;
});
