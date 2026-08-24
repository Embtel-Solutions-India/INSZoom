// Phase 0 regression harness - the ONE command later phases gate on: `npm run phase0:verify`.
// Additive-only: reads the real pipeline's current output via goldenHarness.js, diffs it against
// the committed golden fixtures, runs the Phase 0 invariant + crosswalk-coverage suites, and
// prints a pass/fail + accuracy/latency report. Exits non-zero on any failure. Does not touch,
// and does not require touching, any pipeline runtime file.
//
// Telemetry (accuracy + latency per visa) is OFF by default and only written to a gitignored
// telemetry/ directory when TELEMETRY_FORMS=1 is set - the pipeline itself is never instrumented,
// so this flag changes nothing about production behavior, only what THIS script records.
if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "storage");
}
if (!process.env.MONGODB_TEST_URI) {
  process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
}

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { captureGolden, VISA_KEYS } = require("../modules/form-generation/tests/phase0/goldenHarness");
const { disconnectTestDB } = require("../test-utils/db");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const GOLDEN_ROOT = path.resolve(__dirname, "..", "modules", "form-generation", "tests", "golden");
const TELEMETRY_ENABLED = process.env.TELEMETRY_FORMS === "1";

// Existing crosswalk-coverage tests are reused, not re-implemented - see PHASE0_BASELINE.md §10.
const INVARIANT_AND_COVERAGE_FILES = [
  "src/modules/canonical/tests/phase0.invariants.test.js",
  "src/modules/form-mapping/tests/phase0.invariants.test.js",
  "src/modules/form-mapping/tests/i129-l1a-crosswalk-coverage.test.js",
  "src/modules/form-mapping/tests/i129f-k1-crosswalk-coverage.test.js",
  "src/modules/form-mapping/tests/i130-k3-crosswalk-coverage.test.js",
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

async function verifyVisa(visaKey) {
  const startedAt = Date.now();
  try {
    const current = await captureGolden(visaKey);
    const durationMs = Date.now() - startedAt;
    const goldenPath = path.join(GOLDEN_ROOT, visaKey, "snapshot.json");
    if (!fs.existsSync(goldenPath)) return { visaKey, status: "NO_BASELINE", durationMs };
    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    const drifted = current.pdfFieldValuesHash !== golden.pdfFieldValuesHash || current.pdfSnapshotHash !== golden.pdfSnapshotHash;
    return {
      visaKey,
      status: drifted ? "DRIFT" : "PASS",
      durationMs,
      accuracy: {
        mappedPdfFields: current.counts.mappedPdfFields,
        templateFieldCount: current.counts.templateFieldCount,
        coveragePercent: Math.round((current.counts.mappedPdfFields / current.counts.templateFieldCount) * 1000) / 10,
      },
      fillWarnings: current.counts.fillWarnings,
    };
  } catch (error) {
    return { visaKey, status: "ERROR", durationMs: Date.now() - startedAt, error: error.message };
  }
}

async function main() {
  const startedAll = Date.now();
  const visaResults = [];
  for (const visaKey of VISA_KEYS) visaResults.push(await verifyVisa(visaKey));
  await disconnectTestDB();

  const invariantResult = runNodeTest(INVARIANT_AND_COVERAGE_FILES);
  const invariantSummary = tapSummary(invariantResult.output);

  console.log("\n=== Phase 0 Regression Report ===\n");
  for (const v of visaResults) {
    let line = `  ${v.status.padEnd(11)} ${v.visaKey.padEnd(5)} ${String(v.durationMs).padStart(6)}ms`;
    if (v.accuracy) line += `   mapped ${v.accuracy.mappedPdfFields}/${v.accuracy.templateFieldCount} (${v.accuracy.coveragePercent}%)   fillWarnings=${v.fillWarnings}`;
    if (v.error) line += `   ERROR: ${v.error}`;
    console.log(line);
  }
  console.log(
    `\n  Invariants + crosswalk coverage: ${invariantResult.pass ? "PASS" : "FAIL"}` +
      (invariantSummary ? ` (${invariantSummary.pass} pass / ${invariantSummary.fail} fail)` : "")
  );
  if (!invariantResult.pass) console.log("\n" + invariantResult.output);

  if (TELEMETRY_ENABLED) {
    const telemetryDir = path.join(BACKEND_ROOT, "telemetry");
    fs.mkdirSync(telemetryDir, { recursive: true });
    const file = path.join(telemetryDir, `phase0-verify-${startedAll}.json`);
    fs.writeFileSync(file, JSON.stringify({ startedAt: startedAll, visas: visaResults, invariants: { pass: invariantResult.pass, summary: invariantSummary } }, null, 2));
    console.log(`\n  Telemetry written to ${path.relative(process.cwd(), file)} (TELEMETRY_FORMS=1)`);
  }

  console.log(`\n  Total duration: ${Date.now() - startedAll}ms\n`);

  const anyFailed = visaResults.some((v) => v.status !== "PASS") || !invariantResult.pass;
  process.exitCode = anyFailed ? 1 : 0;
}

main().catch((error) => {
  console.error("phase0:verify crashed:", error);
  process.exitCode = 1;
});
