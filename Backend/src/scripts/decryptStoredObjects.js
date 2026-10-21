// Converts every object stored with the app-level encryption envelope (ICRMENC1) into the plain file, in place, so it opens directly in S3.
// See modules/uploads/storage-decrypt-migration.service.js for the safety guarantees.
//
// Usage (from Backend/):
//   node src/scripts/decryptStoredObjects.js                          dry run: counts encrypted vs plain objects (header peek only)
//   node src/scripts/decryptStoredObjects.js --verify-decrypt --limit 50   dry run that also proves the key decrypts a sample
//   node src/scripts/decryptStoredObjects.js --apply                  convert for real
// Options: --prefix cases/   --limit N   --concurrency N (default 4)
//          --confirm-versioning   (apply only: you checked in the S3 console that bucket versioning is Enabled - needed when the IAM user cannot read it)
//          --allow-unversioned    (apply without any way back to the original encrypted objects - not recommended)
//
// Needs STORAGE_ENCRYPTION_KEY (to decrypt), the same STORAGE_PROVIDER/AWS settings as the app, and on S3 s3:ListBucket + s3:GetObject +
// s3:PutObject + s3:GetBucketVersioning. No database access. Idempotent and resumable: objects already plain are skipped.
require("dotenv").config();
const { convertAll } = require("../modules/uploads/storage-decrypt-migration.service");

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const storageService = require("../modules/uploads/storage.service");
  console.log(`Storage: ${storageService.provider}${storageService.provider === "s3" ? ` (bucket ${require("../config/env").storage.aws.bucket})` : ""} - ${apply ? "APPLY" : "dry run"}`);
  if (!process.env.STORAGE_ENCRYPTION_KEY) throw new Error("STORAGE_ENCRYPTION_KEY is required to decrypt existing objects");

  const report = await convertAll({
    apply,
    verifyDecrypt: process.argv.includes("--verify-decrypt"),
    prefix: option("prefix") || "",
    limit: option("limit") ? Number(option("limit")) : Infinity,
    concurrency: Number(option("concurrency")) || 4,
    allowUnversioned: process.argv.includes("--allow-unversioned"),
    confirmVersioning: process.argv.includes("--confirm-versioning"),
    log: (line) => console.log(line),
  });
  console.log("\n=== Report ===");
  console.log(JSON.stringify({ ...report, undecryptable: report.undecryptable.length, failed: report.failed.length }, null, 2));
  if (report.undecryptable.length) console.error("Undecryptable (left untouched):", report.undecryptable.slice(0, 20));
  if (report.failed.length) console.error("Failed:", report.failed.slice(0, 20));
  if (report.undecryptable.length || report.failed.length) process.exitCode = 1;
  if (!apply) console.log("\nNothing was changed. Re-run with --apply to convert.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
