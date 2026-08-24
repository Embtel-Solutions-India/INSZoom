// Phase 3 (§I.6) regression gate: `npm run phase3:verify`. Extends phase2:verify (which runs
// phase1:verify, which runs phase0:verify) with the permanent CI fan-out invariant, the sync-state
// serialization tests, the conflict-resolution backend tests, and the frontend component tests
// (autosave retry, sync-state badges, conflict panel). Exits non-zero on any failure.
//
// Diff-scope guard: same rationale and mechanism as phase2Verify.js - checks the CURRENTLY
// UNCOMMITTED working tree (`git status --porcelain`), not a merge-base diff against `main`,
// because this branch's real history has substantial unrelated, legitimate work already committed
// that a merge-base diff would list in full. See phase2Verify.js's own header comment.
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

// Phase 2's own test suite (mirrors phase2Verify.js's PHASE2_TEST_FILES) is re-run directly here,
// NOT via `node src/scripts/phase2Verify.js` as a black box - phase2Verify.js's own diff-scope
// guard checks against PHASE 2's allowlist only, which would always fail once Phase 3's own
// (legitimately allowed) files exist in the working tree. Phase 3's diff-scope guard below, with
// its own expanded allowlist covering both phases' files, is the authoritative check for the
// combined state - re-checking with the narrower Phase-2-only allowlist would be double-counting
// the same working tree against an outdated rule, not a real regression signal.
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

// Every file Phase 3 is allowed to touch (§K-G8), relative to the repo root, PLUS Phase 2's own
// allowed files (they legitimately remain uncommitted in this same working tree - this guard
// checks the combined state, not a Phase-3-only slice; see the block comment above main() call
// site for why phase2Verify.js's own narrower guard isn't reused here). CaseForm.js,
// MappingResolver.js, PDFRenderer.js, WatermarkService.js, and any crosswalk config are
// deliberately absent from both lists - appearing in the diff is scope creep for either phase.
// SyncStateService.js is also absent even though it's a Phase 2 file: Phase 3 only READS it
// (imports + calls its existing public methods) and must never modify its content.
const ALLOWED_PATH_PATTERNS = [
  // Phase 3
  /^Backend\/src\/modules\/uscis-forms\/interactive-form-review\.service\.js$/,
  /^Backend\/src\/modules\/uscis-forms\/uscis-form\.controller\.js$/,
  /^Backend\/src\/modules\/uscis-forms\/uscis-form\.routes\.js$/,
  /^Backend\/src\/scripts\/phase3Verify\.js$/,
  /^INSZoom\/frontend\/src\/components\/uscis\/USCISFormRenderer\.jsx$/,
  /^INSZoom\/frontend\/src\/components\/uscis\/USCISFormRenderer\.test\.jsx$/,
  // Not in the task's literal §K-G8 list, but structurally required: the frontend cannot call the
  // new resolve-conflict endpoint without a client function. See docs/forms/PHASE3_RUN_JOURNAL.md
  // for why this one small addition was made anyway.
  /^INSZoom\/frontend\/src\/services\/api\.js$/,
  // Phase 2 (carried forward - still legitimately uncommitted in this working tree)
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
    // Invoked via the .cmd shim (Windows) with shell:true, exactly how `npx vitest run ...` itself
    // resolves - running node_modules/vitest/vitest.mjs directly via `node` skips part of vitest's
    // own CLI bootstrap. NODE_ENV is explicitly overridden to "test": this script's own
    // `require("dotenv").config()` above loads Backend/.env, which sets NODE_ENV=production for
    // the backend - inherited as-is by a child process, that broke jsdom's global Blob setup
    // inside vitest (confirmed: "Blob is not a constructor", reproducible only through this
    // script, not when vitest is run standalone from the frontend directory).
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
  console.log("\n=== Phase 3 Regression Report ===\n");
  const gates = [];

  const backendResult = runNodeTest(PHASE3_BACKEND_TEST_FILES);
  const backendSummary = tapSummary(backendResult.output);
  gates.push({ name: "Phase 3 backend test suite", pass: backendResult.pass, detail: backendSummary ? `${backendSummary.pass} pass / ${backendSummary.fail} fail` : "" });
  console.log(`  Phase 3 backend test suite: ${backendResult.pass ? "PASS" : "FAIL"}` + (backendSummary ? ` (${backendSummary.pass} pass / ${backendSummary.fail} fail)` : ""));
  if (!backendResult.pass) console.log("\n" + backendResult.output);

  const frontendResult = runFrontendComponentTests();
  const frontendSummary = vitestSummary(frontendResult.output);
  gates.push({ name: "Frontend component tests", pass: frontendResult.pass, detail: frontendSummary ? `${frontendSummary.pass} pass / ${frontendSummary.fail} fail` : "" });
  console.log(`  Frontend component tests (USCISFormRenderer): ${frontendResult.pass ? "PASS" : "FAIL"}` + (frontendSummary ? ` (${frontendSummary.pass} pass / ${frontendSummary.fail} fail)` : ""));
  if (!frontendResult.pass) console.log("\n" + frontendResult.output);

  const phase2TestResult = runNodeTest(PHASE2_TEST_FILES);
  const phase2TestSummary = tapSummary(phase2TestResult.output);
  gates.push({ name: "Phase 2 test suite (re-run directly, not via phase2:verify - see header comment)", pass: phase2TestResult.pass, detail: phase2TestSummary ? `${phase2TestSummary.pass} pass / ${phase2TestSummary.fail} fail` : "" });
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
  console.error("phase3:verify crashed:", error);
  process.exitCode = 1;
});
