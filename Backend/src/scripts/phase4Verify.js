// Phase 4 (§H) regression gate: `npm run phase4:verify`. Extends phase3:verify (which itself
// re-runs Phase 2's suite directly, then phase1:verify, which runs phase0:verify) with Phase 4's
// own tests: the P0-CD-001 golden-path PDF-byte test, the P1-002 scanner regex tests, the
// MappingResolver semantic-transform unit tests, and the phone-transform real-pipeline
// integration test. Also re-runs Phase 3's own backend suite directly (not via `phase3:verify` as
// a black box) because two of its files - phase3.fanout-invariant.test.js and
// AutoFillService.overrideField.k1k3-fanout.test.js - were legitimately edited THIS phase (stale
// test-field corrections caused by the P0-CD-001/P4-003 mapping-activation fixes; see
// docs/forms/PHASE4_RUN_JOURNAL.md) and phase3:verify's own diff-scope guard only recognizes
// Phase-3-era files, so it would fail here for the same structural reason phase2:verify's guard
// failed when invoked from inside phase3:verify. Exits non-zero on any failure.
require("dotenv").config();

if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "storage");
}
if (!process.env.MONGODB_TEST_URI) {
  process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
}

const { execFileSync } = require("child_process");
const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");
const FRONTEND_ROOT = path.resolve(REPO_ROOT, "INSZoom", "frontend");

const PHASE2_TEST_FILES = [
  "src/modules/canonical/tests/CanonicalProfileService.applyStaffEdit.test.js",
  "src/modules/form-mapping/tests/ReverseIndexService.test.js",
  "src/modules/form-mapping/tests/SyncStateService.test.js",
  "src/modules/form-mapping/tests/AutoFillService.overrideField.reverseSync.test.js",
  "src/modules/form-mapping/tests/AutoFillService.overrideField.k1k3-fanout.test.js",
  "src/modules/canonical/tests/phase0.invariants.test.js",
];

const PHASE3_BACKEND_TEST_FILES = [
  "src/modules/form-mapping/tests/phase3.fanout-invariant.test.js",
  "src/modules/uscis-forms/tests/interactive-form-review.service.test.js",
  "src/modules/uscis-forms/tests/interactive-form-review.resolveFieldConflict.test.js",
  "src/modules/uscis-forms/tests/interactive-form-review.routes.test.js",
];

const PHASE4_BACKEND_TEST_FILES = [
  "src/modules/uscis-form-import/tests/PDFFieldScannerService.inferTextSemanticType.test.js",
  "src/modules/form-mapping/tests/MappingResolver.test.js",
  "src/modules/form-mapping/tests/phase4.semantic-transforms.integration.test.js",
  "src/modules/form-mapping/tests/i130-k3-golden-case.test.js",
];

// Every file Phase 4 is allowed to touch (§K-G8-equivalent gate), relative to the repo root, PLUS
// every prior phase's own allowed files (they legitimately remain uncommitted in this same working
// tree - same rationale as phase3Verify.js's own combined-state guard). AutoFillService.js,
// CanonicalProfileService.js, SyncStateService.js, ReverseIndexService.js, FormMappingService.js,
// PDFRenderer.js, WatermarkService.js, and CaseForm.js are deliberately absent - appearing in the
// diff is scope creep for Phase 4 even though several of them are legitimately-modified Phase 2/3
// carryovers (those are covered by their own phase's pattern below, never by a Phase-4 pattern).
const ALLOWED_PATH_PATTERNS = [
  // Phase 4
  /^Backend\/src\/modules\/uscis-form-import\/services\/PDFFieldScannerService\.js$/,
  /^Backend\/src\/modules\/form-mapping\/services\/MappingResolver\.js$/,
  /^Backend\/src\/modules\/form-mapping\/config\/i129-h1b-crosswalk\.js$/,
  /^Backend\/src\/modules\/form-generation\/tests\/golden\/k3\/snapshot\.json$/,
  /^Backend\/src\/scripts\/phase4Verify\.js$/,
  // Phase 3 (carried forward - still legitimately uncommitted in this working tree)
  /^Backend\/src\/modules\/uscis-forms\/interactive-form-review\.service\.js$/,
  /^Backend\/src\/modules\/uscis-forms\/uscis-form\.controller\.js$/,
  /^Backend\/src\/modules\/uscis-forms\/uscis-form\.routes\.js$/,
  /^Backend\/src\/scripts\/phase3Verify\.js$/,
  /^INSZoom\/frontend\/src\/components\/uscis\/USCISFormRenderer\.jsx$/,
  /^INSZoom\/frontend\/src\/components\/uscis\/USCISFormRenderer\.test\.jsx$/,
  /^INSZoom\/frontend\/src\/services\/api\.js$/,
  // Phase 2 (carried forward)
  /^Backend\/src\/modules\/canonical\/services\/CanonicalProfileService\.js$/,
  /^Backend\/src\/modules\/form-mapping\/services\/AutoFillService\.js$/,
  /^Backend\/src\/modules\/form-mapping\/services\/ReverseIndexService\.js$/,
  /^Backend\/src\/modules\/form-mapping\/services\/SyncStateService\.js$/,
  /^Backend\/src\/scripts\/phase2Verify\.js$/,
  // Shared
  /^Backend\/package\.json$/,
  /\.test\.js$/,
  /\.test\.jsx$/,
  /^docs\/forms\//,
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

function runScript(relativePath) {
  try {
    const output = execFileSync(process.execPath, [relativePath], { cwd: BACKEND_ROOT, encoding: "utf8", env: process.env });
    return { pass: true, output };
  } catch (error) {
    return { pass: false, output: (error.stdout || "") + (error.stderr || "") };
  }
}

function runFrontendComponentTests() {
  try {
    const vitestBin = path.join(FRONTEND_ROOT, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
    const output = execFileSync(vitestBin, ["run", "src/components/uscis/USCISFormRenderer.test.jsx"], { cwd: FRONTEND_ROOT, encoding: "utf8", shell: true, env: { ...process.env, NODE_ENV: "test" } });
    return { pass: true, output };
  } catch (error) {
    return { pass: false, output: (error.stdout || "") + (error.stderr || "") };
  }
}

function vitestSummary(output) {
  const match = /Tests\s+(\d+) passed(?:\s*\|\s*(\d+) failed)?/.exec(output.replace(/\x1b\[[0-9;]*m/g, ""));
  if (!match) return null;
  return { pass: Number(match[1]), fail: Number(match[2] || 0) };
}

function checkDiffScope() {
  let porcelain;
  try {
    porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch (error) {
    return { pass: false, disallowed: [], error: error.message };
  }
  const paths = porcelain
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[MADRCU?!]{1,2}\s+/, "").replace(/^"(.*)"$/, "$1"));
  const disallowed = paths.filter((filePath) => !ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(filePath.replace(/\\/g, "/"))));
  return { pass: disallowed.length === 0, disallowed, paths };
}

async function main() {
  console.log("\n=== Phase 4 Regression Report ===\n");
  const gates = [];

  const p4Result = runNodeTest(PHASE4_BACKEND_TEST_FILES);
  const p4Summary = tapSummary(p4Result.output);
  gates.push({ name: "Phase 4 backend test suite (P0-CD-001 golden, P1-002 scanner, transforms, phone integration)", pass: p4Result.pass, detail: p4Summary ? `${p4Summary.pass} pass / ${p4Summary.fail} fail` : "" });
  console.log(`  Phase 4 backend test suite: ${p4Result.pass ? "PASS" : "FAIL"}` + (p4Summary ? ` (${p4Summary.pass} pass / ${p4Summary.fail} fail)` : ""));
  if (!p4Result.pass) console.log("\n" + p4Result.output);

  const phase3Result = runNodeTest(PHASE3_BACKEND_TEST_FILES);
  const phase3Summary = tapSummary(phase3Result.output);
  gates.push({ name: "Phase 3 test suite (re-run directly, not via phase3:verify - see header comment)", pass: phase3Result.pass, detail: phase3Summary ? `${phase3Summary.pass} pass / ${phase3Summary.fail} fail` : "" });
  console.log(`  Phase 3 test suite: ${phase3Result.pass ? "PASS" : "FAIL"}` + (phase3Summary ? ` (${phase3Summary.pass} pass / ${phase3Summary.fail} fail)` : ""));
  if (!phase3Result.pass) console.log("\n" + phase3Result.output);

  const frontendResult = runFrontendComponentTests();
  const frontendSummary = vitestSummary(frontendResult.output);
  gates.push({ name: "Frontend component tests", pass: frontendResult.pass, detail: frontendSummary ? `${frontendSummary.pass} pass / ${frontendSummary.fail} fail` : "" });
  console.log(`  Frontend component tests (USCISFormRenderer): ${frontendResult.pass ? "PASS" : "FAIL"}` + (frontendSummary ? ` (${frontendSummary.pass} pass / ${frontendSummary.fail} fail)` : ""));
  if (!frontendResult.pass) console.log("\n" + frontendResult.output);

  const phase2TestResult = runNodeTest(PHASE2_TEST_FILES);
  const phase2TestSummary = tapSummary(phase2TestResult.output);
  gates.push({ name: "Phase 2 test suite (re-run directly)", pass: phase2TestResult.pass, detail: phase2TestSummary ? `${phase2TestSummary.pass} pass / ${phase2TestSummary.fail} fail` : "" });
  console.log(`  Phase 2 test suite: ${phase2TestResult.pass ? "PASS" : "FAIL"}` + (phase2TestSummary ? ` (${phase2TestSummary.pass} pass / ${phase2TestSummary.fail} fail)` : ""));
  if (!phase2TestResult.pass) console.log("\n" + phase2TestResult.output);

  const phase1Result = runScript("src/scripts/phase1Verify.js");
  gates.push({ name: "phase1:verify (includes phase0:verify)", pass: phase1Result.pass });
  console.log(`  phase1:verify (includes phase0:verify): ${phase1Result.pass ? "PASS" : "FAIL"}`);
  if (!phase1Result.pass) console.log("\n" + phase1Result.output);
  else phase1Result.output.split("\n").filter((l) => /PASS|FAIL|DRIFT|Overall/.test(l)).forEach((l) => console.log("   " + l.trim()));

  const diffScope = checkDiffScope();
  gates.push({ name: "Diff scope guard", pass: diffScope.pass });
  console.log(`  Diff scope guard: ${diffScope.pass ? "PASS" : "FAIL"}`);
  if (!diffScope.pass) {
    if (diffScope.error) console.log(`    ${diffScope.error}`);
    else console.log(`    Disallowed file(s) in the working tree: ${diffScope.disallowed.join(", ")}`);
  }

  console.log("\n  Gate summary:");
  gates.forEach((gate) => console.log(`    ${gate.pass ? "PASS" : "FAIL"} - ${gate.name}${gate.detail ? ` (${gate.detail})` : ""}`));

  const anyFailed = gates.some((gate) => !gate.pass);
  console.log(`\n  Overall: ${anyFailed ? "FAIL" : "PASS"}\n`);
  process.exitCode = anyFailed ? 1 : 0;
}

main().catch((error) => {
  console.error("phase4:verify crashed:", error);
  process.exitCode = 1;
});
