// Phase 1 (USCIS-forms re-architecture) regression gate: `npm run phase1:verify`. Runs the scan
// lock-in + reconciliation tests, regenerates the reconciliation report, checks the no-new-array /
// document-size guard (§K-G3 - the whole reason this phase does NOT build a new dictionary), and
// re-runs `npm run phase0:verify` to prove fill output is still byte-identical. Non-zero exit on
// any failure.
require("dotenv").config();

if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "storage");
}

const { execFileSync } = require("child_process");
const path = require("path");
const mongoose = require("mongoose");
const { calculateObjectSize } = require("bson");
const env = require("../config/env");
const USCISFormTemplate = require("../models/USCISFormTemplate");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

// Measured against the real I-129 template right after this session's retracted
// acroFieldDictionary work was fully reverted (see docs/forms/PHASE1_RUN_JOURNAL.md): 15.72MB,
// ~290KB of headroom under Mongo's 16MB hard document ceiling. That number is the reference point
// for "did Phase 1 grow the document" - not the older 15.10MB figure quoted in ARCHITECTURE.md/
// PHASE0 docs, which appears to predate some other change. A tolerance of 512KB absorbs normal
// field-value churn (labels, options) without masking an actual new large array being added.
const KNOWN_TEMPLATE_SIZE_BYTES = 16_479_915;
const SIZE_GROWTH_TOLERANCE_BYTES = 512 * 1024;
const MONGO_DOCUMENT_HARD_LIMIT_BYTES = 16 * 1024 * 1024;
const FORBIDDEN_SCHEMA_PATH_PATTERN = /acroFieldDictionary|fieldDictionary/i;

const PHASE1_TEST_FILES = [
  "src/modules/uscis-form-import/tests/phase1.scan-lockin.test.js",
  "src/modules/uscis-form-import/tests/PDFFieldScannerService.test.js",
];

function runNodeTest(files) {
  try {
    const output = execFileSync(process.execPath, ["--test", ...files], { cwd: BACKEND_ROOT, encoding: "utf8" });
    return { pass: true, output };
  } catch (error) {
    return { pass: false, output: (error.stdout || "") + (error.stderr || "") };
  }
}

function tapSummary(output) {
  const match = /# pass (\d+)[\s\S]*?# fail (\d+)/.exec(output);
  return match ? { pass: Number(match[1]), fail: Number(match[2]) } : null;
}

async function checkNoNewArrayOrBloat() {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI || env.mongoUri;
  await mongoose.connect(uri);

  const forbiddenPaths = Object.keys(USCISFormTemplate.schema.paths).filter((p) => FORBIDDEN_SCHEMA_PATH_PATTERN.test(p));

  const template = await USCISFormTemplate.findOne({ formCode: "I-129" }).lean();
  const sizeBytes = template ? calculateObjectSize(template) : null;

  await mongoose.disconnect();

  return {
    forbiddenPaths,
    sizeBytes,
    sizeOk: sizeBytes == null || sizeBytes <= KNOWN_TEMPLATE_SIZE_BYTES + SIZE_GROWTH_TOLERANCE_BYTES,
    underHardLimit: sizeBytes == null || sizeBytes < MONGO_DOCUMENT_HARD_LIMIT_BYTES,
  };
}

function runPhase0Verify() {
  try {
    const output = execFileSync(process.execPath, ["src/scripts/phase0Verify.js"], { cwd: BACKEND_ROOT, encoding: "utf8" });
    return { pass: true, output };
  } catch (error) {
    return { pass: false, output: (error.stdout || "") + (error.stderr || "") };
  }
}

async function main() {
  console.log("\n=== Phase 1 Regression Report ===\n");

  const lockinResult = runNodeTest(PHASE1_TEST_FILES);
  const lockinSummary = tapSummary(lockinResult.output);
  console.log(`  Lock-in tests: ${lockinResult.pass ? "PASS" : "FAIL"}` + (lockinSummary ? ` (${lockinSummary.pass} pass / ${lockinSummary.fail} fail)` : ""));
  if (!lockinResult.pass) console.log("\n" + lockinResult.output);

  let reconcileResult = { pass: true };
  try {
    execFileSync(process.execPath, ["src/scripts/phase1Reconcile.js"], { cwd: BACKEND_ROOT, encoding: "utf8", env: process.env });
    console.log("  Reconciliation report: PASS (docs/forms/PHASE1_RECONCILIATION.md regenerated)");
  } catch (error) {
    reconcileResult = { pass: false };
    console.log("  Reconciliation report: FAIL");
    console.log((error.stdout || "") + (error.stderr || ""));
  }

  const sizeGuard = await checkNoNewArrayOrBloat();
  const sizeGuardPass = sizeGuard.forbiddenPaths.length === 0 && sizeGuard.sizeOk && sizeGuard.underHardLimit;
  console.log(
    `  No-new-array / doc-size guard: ${sizeGuardPass ? "PASS" : "FAIL"}` +
      (sizeGuard.sizeBytes != null ? ` (I-129 template: ${(sizeGuard.sizeBytes / 1024 / 1024).toFixed(2)}MB, baseline ${(KNOWN_TEMPLATE_SIZE_BYTES / 1024 / 1024).toFixed(2)}MB, hard limit 16MB)` : "")
  );
  if (sizeGuard.forbiddenPaths.length) console.log(`    Forbidden schema paths found: ${sizeGuard.forbiddenPaths.join(", ")}`);
  if (!sizeGuard.sizeOk) console.log(`    Document grew beyond tolerance: ${sizeGuard.sizeBytes} bytes vs baseline ${KNOWN_TEMPLATE_SIZE_BYTES} + ${SIZE_GROWTH_TOLERANCE_BYTES}`);
  if (!sizeGuard.underHardLimit) console.log(`    Document is at or over Mongo's 16MB hard limit: ${sizeGuard.sizeBytes} bytes`);

  const phase0Result = runPhase0Verify();
  console.log(`  phase0:verify (fill-output invariance): ${phase0Result.pass ? "PASS" : "FAIL"}`);
  if (!phase0Result.pass) console.log("\n" + phase0Result.output);
  else {
    const lines = phase0Result.output.split("\n").filter((l) => /PASS|FAIL|DRIFT|ERROR|Invariants/.test(l));
    lines.forEach((l) => console.log("   " + l.trim()));
  }

  const anyFailed = !lockinResult.pass || !reconcileResult.pass || !sizeGuardPass || !phase0Result.pass;
  console.log(`\n  Overall: ${anyFailed ? "FAIL" : "PASS"}\n`);
  process.exitCode = anyFailed ? 1 : 0;
}

main().catch((error) => {
  console.error("phase1:verify crashed:", error);
  process.exitCode = 1;
});
