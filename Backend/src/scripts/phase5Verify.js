// Phase 5 (§I.6) regression gate: `npm run phase5:verify`. Extends phase4:verify with Phase 5's
// own tests: the fidelity verifier unit tests (correct + tampered), the renderFiling integration
// test (real seeded case, watermark-absence proof via real page-content-stream decoding), the
// downloadForm controller tests (200 with no status gate / 422 fidelity-failure - Forms Download
// overhaul renamed this suite from its original filingPdf.test.js), the watermark-regression
// tests proving downloadForm carries no watermark and generate still stamps correctly, the
// route-registration check, and the frontend component tests for the new button. Also re-runs
// Phase 4's own backend suite directly
// (not via `phase4:verify` as a black box) for the same structural reason phase4Verify.js re-runs
// Phase 3's suite directly instead of calling phase3:verify - its diff-scope guard only recognizes
// Phase-4-era files and would fail the instant Phase 5's own legitimately-allowed files exist in
// the working tree. Exits non-zero on any failure.
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

const PHASE5_BACKEND_TEST_FILES = [
  "src/modules/form-generation/tests/PDFFidelityService.test.js",
  "src/modules/form-generation/tests/PDFRenderer.renderFiling.test.js",
  "src/modules/form-generation/tests/FormGenerationController.downloadForm.test.js",
  "src/modules/form-generation/tests/watermark-regression.test.js",
  "src/modules/form-generation/tests/h3-formGenerationRoutes.test.js",
];

// Every file Phase 5 is allowed to touch, relative to the repo root, PLUS every prior phase's own
// allowed files (same combined-state rationale as phase3Verify.js/phase4Verify.js). Locked files
// per §A.5 - AutoFillService.js, CanonicalProfileService.js, SyncStateService.js,
// ReverseIndexService.js, MappingResolver.js, CaseForm.js schema, WatermarkService.js,
// PDFFieldMapper.js - are deliberately absent; appearing in the diff is scope creep for Phase 5
// even though several are legitimately-modified carryovers from earlier phases (those are covered
// by their own phase's pattern below, never by a Phase-5 pattern).
const ALLOWED_PATH_PATTERNS = [
  // Phase 5
  /^Backend\/src\/modules\/form-generation\/services\/PDFFidelityService\.js$/,
  /^Backend\/src\/modules\/form-generation\/services\/PDFRenderer\.js$/,
  /^Backend\/src\/modules\/form-generation\/controllers\/FormGenerationController\.js$/,
  /^Backend\/src\/modules\/form-generation\/routes\/formGenerationRoutes\.js$/,
  /^Backend\/src\/scripts\/phase5Verify\.js$/,
  /^INSZoom\/frontend\/src\/components\/uscis\/USCISFormRenderer\.jsx$/,
  /^INSZoom\/frontend\/src\/components\/uscis\/USCISFormRenderer\.test\.jsx$/,
  /^INSZoom\/frontend\/src\/services\/api\.js$/,
  // Phase 4 (carried forward)
  /^Backend\/src\/modules\/uscis-form-import\/services\/PDFFieldScannerService\.js$/,
  /^Backend\/src\/modules\/form-mapping\/services\/MappingResolver\.js$/,
  /^Backend\/src\/modules\/form-mapping\/config\/i129-h1b-crosswalk\.js$/,
  /^Backend\/src\/modules\/form-generation\/tests\/golden\/k3\/snapshot\.json$/,
  /^Backend\/src\/scripts\/phase4Verify\.js$/,
  // Phase 3 (carried forward)
  /^Backend\/src\/modules\/uscis-forms\/interactive-form-review\.service\.js$/,
  /^Backend\/src\/modules\/uscis-forms\/uscis-form\.controller\.js$/,
  /^Backend\/src\/modules\/uscis-forms\/uscis-form\.routes\.js$/,
  /^Backend\/src\/scripts\/phase3Verify\.js$/,
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
  console.log("\n=== Phase 5 Regression Report ===\n");
  const gates = [];

  const p5Result = runNodeTest(PHASE5_BACKEND_TEST_FILES);
  const p5Summary = tapSummary(p5Result.output);
  gates.push({ name: "Phase 5 backend test suite (fidelity verifier, renderFiling, filingPdf, watermark regression, route registration)", pass: p5Result.pass, detail: p5Summary ? `${p5Summary.pass} pass / ${p5Summary.fail} fail` : "" });
  console.log(`  Phase 5 backend test suite: ${p5Result.pass ? "PASS" : "FAIL"}` + (p5Summary ? ` (${p5Summary.pass} pass / ${p5Summary.fail} fail)` : ""));
  if (!p5Result.pass) console.log("\n" + p5Result.output);

  const phase4Result = runNodeTest(PHASE4_BACKEND_TEST_FILES);
  const phase4Summary = tapSummary(phase4Result.output);
  gates.push({ name: "Phase 4 test suite (re-run directly, not via phase4:verify - see header comment)", pass: phase4Result.pass, detail: phase4Summary ? `${phase4Summary.pass} pass / ${phase4Summary.fail} fail` : "" });
  console.log(`  Phase 4 test suite: ${phase4Result.pass ? "PASS" : "FAIL"}` + (phase4Summary ? ` (${phase4Summary.pass} pass / ${phase4Summary.fail} fail)` : ""));
  if (!phase4Result.pass) console.log("\n" + phase4Result.output);

  const phase3Result = runNodeTest(PHASE3_BACKEND_TEST_FILES);
  const phase3Summary = tapSummary(phase3Result.output);
  gates.push({ name: "Phase 3 test suite (re-run directly)", pass: phase3Result.pass, detail: phase3Summary ? `${phase3Summary.pass} pass / ${phase3Summary.fail} fail` : "" });
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
  console.error("phase5:verify crashed:", error);
  process.exitCode = 1;
});
