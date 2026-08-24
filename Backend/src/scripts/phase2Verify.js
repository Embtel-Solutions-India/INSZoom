// Phase 2 (§I.6) regression gate: `npm run phase2:verify`. Runs phase0:verify + phase1:verify (both
// must stay green - see docs/forms/PHASE2_BASELINE.md §A.2), the Phase 2 test suite, a diff-scope
// guard, and a per-form fan-out summary. Exits non-zero on any failure.
//
// Diff-scope guard note: the task spec's own §K-G7 describes this as `git diff --name-only
// $(git merge-base HEAD main) HEAD`. This repo's actual working state at the time Phase 2 was
// built has Phase 0/1/CORS/auth work already committed on this branch, diverged from `main` by a
// lot of unrelated, legitimate history - a merge-base diff against `main` would list ALL of that,
// not just Phase 2's slice, making the allowlist check fail for reasons that have nothing to do
// with Phase 2. This guard instead checks the CURRENTLY UNCOMMITTED working tree (`git status
// --porcelain`), which is what Phase 2's own changes actually look like in this session. If Phase
// 2 is later committed, re-point this at a diff against the commit immediately before Phase 2
// started (this script cannot infer that commit reliably on its own).
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

const PHASE2_TEST_FILES = [
  "src/modules/canonical/tests/CanonicalProfileService.applyStaffEdit.test.js",
  "src/modules/form-mapping/tests/ReverseIndexService.test.js",
  "src/modules/form-mapping/tests/SyncStateService.test.js",
  "src/modules/form-mapping/tests/AutoFillService.overrideField.reverseSync.test.js",
  "src/modules/form-mapping/tests/AutoFillService.overrideField.k1k3-fanout.test.js",
  "src/modules/canonical/tests/phase0.invariants.test.js",
];

// Every file Phase 2 is allowed to touch (§K-G7). Crosswalk configs, CaseForm.js, MappingResolver.js,
// PDFRenderer.js, and WatermarkService.js are deliberately absent - touching any of those is scope
// creep, not a false positive in this list.
const ALLOWED_PATH_PATTERNS = [
  /^Backend\/src\/modules\/canonical\/services\/CanonicalProfileService\.js$/,
  /^Backend\/src\/modules\/form-mapping\/services\/AutoFillService\.js$/,
  /^Backend\/src\/modules\/form-mapping\/services\/ReverseIndexService\.js$/,
  /^Backend\/src\/modules\/form-mapping\/services\/SyncStateService\.js$/,
  /^Backend\/src\/scripts\/phase2Verify\.js$/,
  /^Backend\/package\.json$/,
  /\.test\.js$/,
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

async function fanOutSummary() {
  const mongoose = require("mongoose");
  const { connectTestDB, disconnectTestDB } = require("../test-utils/db");
  const ReverseIndexService = require("../modules/form-mapping/services/ReverseIndexService");
  await connectTestDB();
  const summary = {};
  for (const [formCode, sourcePath] of [["I-129", "person.lastName"], ["I-129F", "person.citizenship"], ["I-130", "contact.address.zip"]]) {
    try {
      const idx = await ReverseIndexService.buildFormReverseIndex(formCode);
      const entries = idx.get(sourcePath) || [];
      summary[formCode] = { sourcePath, fanOutCount: entries.length, reverseSync: entries.every((entry) => entry.reverseSync) };
    } catch (error) {
      summary[formCode] = { error: error.message };
    }
  }
  await disconnectTestDB();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  return summary;
}

async function main() {
  console.log("\n=== Phase 2 Regression Report ===\n");

  const phase2Result = runNodeTest(PHASE2_TEST_FILES);
  const phase2Summary = tapSummary(phase2Result.output);
  console.log(`  Phase 2 test suite: ${phase2Result.pass ? "PASS" : "FAIL"}` + (phase2Summary ? ` (${phase2Summary.pass} pass / ${phase2Summary.fail} fail)` : ""));
  if (!phase2Result.pass) console.log("\n" + phase2Result.output);

  const phase1Result = runScript("src/scripts/phase1Verify.js");
  console.log(`  phase1:verify (includes phase0:verify): ${phase1Result.pass ? "PASS" : "FAIL"}`);
  if (!phase1Result.pass) console.log("\n" + phase1Result.output);
  else {
    phase1Result.output.split("\n").filter((l) => /PASS|FAIL|DRIFT|Overall/.test(l)).forEach((l) => console.log("   " + l.trim()));
  }

  const diffScope = checkDiffScope();
  console.log(`  Diff scope guard: ${diffScope.pass ? "PASS" : "FAIL"}`);
  if (!diffScope.pass) {
    if (diffScope.error) console.log(`    ${diffScope.error}`);
    else console.log(`    Disallowed file(s) in the working tree: ${diffScope.disallowed.join(", ")}`);
  }

  let fanOut = {};
  try {
    fanOut = await fanOutSummary();
    console.log("\n  Per-form fan-out summary:");
    for (const [formCode, info] of Object.entries(fanOut)) {
      if (info.error) console.log(`    ${formCode}: ERROR - ${info.error}`);
      else console.log(`    ${formCode}: ${info.sourcePath} -> ${info.fanOutCount} field(s), reverseSync:${info.reverseSync}`);
    }
  } catch (error) {
    console.log(`\n  Per-form fan-out summary: ERROR - ${error.message}`);
  }

  const anyFailed = !phase2Result.pass || !phase1Result.pass || !diffScope.pass;
  console.log(`\n  Overall: ${anyFailed ? "FAIL" : "PASS"}\n`);
  process.exitCode = anyFailed ? 1 : 0;
}

main().catch((error) => {
  console.error("phase2:verify crashed:", error);
  process.exitCode = 1;
});
