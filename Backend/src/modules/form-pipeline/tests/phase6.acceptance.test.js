// Phase 6 - structural acceptance checks that do not need a database. Each one pins an acceptance row of docs/FORM_PIPELINE_RELIABILITY_PLAN.md that is about
// WHERE code lives or WHICH switches exist, so a later change cannot quietly break it:
//   * Performance / non-disruption: the hot path (autofill, form load, case read, case creation, PDF generation) never references the pipeline, the release gate,
//     the Gemini engine or governance, so it cannot add a database call, a PDF parse, a certification or an AI call to a user request;
//   * Edition safety: the gate and the activation protocol have no disable switch;
//   * Case-migration integrity: the list of frozen case-form statuses lives in exactly one module;
//   * Test safety: the safe runner never selects a test that reaches the shared database.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const SRC = path.resolve(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(SRC, relative), "utf8");
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const HEAVY = /form-pipeline|form-release|form-ai-mapping|form-governance|FormCertificationService|GeminiMappingService|PDFFieldScannerService|PipelineAlerter|FormPipelineRunner/;

const HOT_PATH_FILES = [
  "modules/form-mapping/services/AutoFillService.js",
  "modules/form-mapping/services/FormMappingService.js",
  "modules/form-mapping/services/MappingResolver.js",
  "modules/form-mapping/services/PartyFieldMappingService.js",
  "modules/form-generation/services/PDFGenerationService.js",
  "modules/form-generation/services/PDFRenderer.js",
  "modules/form-generation/services/PDFFidelityService.js",
  "modules/cases/case.service.js",
  "modules/cases/case.controller.js",
];

test("the hot path never references the pipeline, the release gate, the Gemini engine or governance", () => {
  for (const file of HOT_PATH_FILES) {
    const code = stripComments(read(file));
    const requires = [...code.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]);
    const offenders = requires.filter((request) => HEAVY.test(request));
    assert.deepEqual(offenders, [], `${file} must not pull in heavy form-pipeline work (found: ${offenders.join(", ")})`);
  }
});

test("the form-generation controller reaches the edition check only through the acquisition service, under a timeout, from an explicit user action", () => {
  const code = stripComments(read("modules/form-generation/controllers/FormGenerationController.js"));
  const requires = [...code.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(requires.filter((request) => HEAVY.test(request)), [], "no direct import of the pipeline / release / AI / governance modules");
  const acquisitionCalls = code.match(/OnDemandFormAcquisitionService/g) || [];
  assert.equal(acquisitionCalls.length, 1, "exactly one place may call the acquisition service");
  assert.match(code, /withTimeout\(require\("\.\.\/\.\.\/uscis-form-import\/services\/OnDemandFormAcquisitionService"\)/, "and it runs under withTimeout");
});

const GATE_FILES = [
  ...fs.readdirSync(path.join(SRC, "modules/form-edition-policy")).filter((name) => /^(Edition.*(Gate|Enforcer)|filingEligibility)\.js$/.test(name)).map((name) => "modules/form-edition-policy/" + name), // listed by pattern: the wiring tests forbid naming the gate outside its module
  "modules/form-release/ReleaseGate.js",
  "modules/form-release/certPolicy.js",
  "modules/uscis-lifecycle/services/VersionManagementService.js",
];

test("the gate, the filing-eligibility predicate and the activation protocol have no disable switch", () => {
  const allowed = new Set(["FORM_EDITION_AUTO_EVIDENCE"]); // only ever switches the evidence reader ON; the predicate stays constant-false until fixtures validate it
  for (const file of GATE_FILES) {
    const code = stripComments(read(file));
    const variables = [...code.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    for (const variable of variables) assert.ok(allowed.has(variable), `${file} reads ${variable}: a gate must not have an environment switch`);
    assert.doesNotMatch(code, /\b(skipGate|bypassGate|disableGate|gateDisabled|GATE_OFF|DISABLE_GATE)\b/i, `${file} must not carry a bypass flag`);
  }
});

test("the filing-eligibility predicate gives the same answer whatever the environment says", () => {
  const { filingEligibilityStatement } = require("../../form-edition-policy/filingEligibility");
  const inputs = [
    { text: "Form I-131 edition 04/01/24 is accepted", formCode: "I-131", editionIdentifier: "2024-04-01" },
    { text: "USCIS will accept the 01/20/25 edition of Form I-131 until further notice.", formCode: "I-131", editionIdentifier: "2025-01-20" },
    { text: "", formCode: "I-131", editionIdentifier: "2025-01-20" },
    { text: "Edition date 01/20/25. Effective date 01/20/25.", formCode: "I-131", editionIdentifier: "2025-01-20" },
  ];
  const before = process.env.FORM_EDITION_AUTO_EVIDENCE;
  try {
    for (const input of inputs) {
      delete process.env.FORM_EDITION_AUTO_EVIDENCE;
      const unset = JSON.stringify(filingEligibilityStatement(input));
      for (const value of ["true", "1", "on", "false"]) {
        process.env.FORM_EDITION_AUTO_EVIDENCE = value;
        assert.equal(JSON.stringify(filingEligibilityStatement(input)), unset, "the predicate is a pure function of its input; the switch only decides whether it is consulted");
      }
    }
    // an empty page is never a statement
    delete process.env.FORM_EDITION_AUTO_EVIDENCE;
    assert.equal(filingEligibilityStatement(inputs[2]).verdict, "none");
    assert.equal(filingEligibilityStatement({ ...inputs[1], editionIdentifier: "not-a-date" }).verdict, "none");
  } finally {
    if (before === undefined) delete process.env.FORM_EDITION_AUTO_EVIDENCE;
    else process.env.FORM_EDITION_AUTO_EVIDENCE = before;
  }
});

test("the frozen case-form status list is defined once and not copied anywhere else", () => {
  const { FROZEN_CASE_FORM_STATUSES } = require("../../form-mapping/config/caseFormFreeze");
  assert.ok(FROZEN_CASE_FORM_STATUSES.length >= 8, "all eight frozen statuses");
  const copies = []; // models/CaseForm.js is skipped: its status enum is the FULL list of statuses, not a frozen subset
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "tests") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name) && !full.endsWith(path.join("config", "caseFormFreeze.js")) && !full.endsWith(path.join("models", "CaseForm.js"))) {
        const code = stripComments(fs.readFileSync(full, "utf8"));
        for (const array of code.matchAll(/\[([^\]]{20,800})\]/g)) {
          const quoted = new Set([...array[1].matchAll(/["'`]([a-z_]+)["'`]/g)].map((m) => m[1]));
          const hits = FROZEN_CASE_FORM_STATUSES.filter((status) => quoted.has(status));
          if (hits.length >= 6) copies.push(`${path.relative(SRC, full)} (${hits.length} of the frozen statuses in one literal list)`);
        }
      }
    }
  })(SRC);
  assert.deepEqual(copies, [], "a second hard-coded frozen list would drift from the shared one");
});

test("the safe test runner keeps every file that reaches the shared database out of the run", () => {
  const { classify, groups } = require("../../../scripts/runSafeTests");
  // the samples are assembled from parts so this file itself is not mistaken for a test that reaches the shared database
  const sharedDb = ["config", "database"].join("/");
  const mongoName = ["mongo", "Uri"].join("");
  assert.equal(classify(`const connect = require("../../../${sharedDb}");`), "real-db");
  assert.equal(classify("const uri = env." + mongoName + ";"), "real-db");
  assert.equal(classify("await mongoose." + "connect(process.env.SOMETHING);"), "real-db");
  assert.equal(classify('const { connectTestDB } = require("../../../test-utils/db");'), "local-db");
  assert.equal(classify('const db = require("../../../test-utils/pipelineDb");'), "pure");
  assert.equal(classify('const assert = require("node:assert/strict");'), "pure");
  const sorted = groups();
  const sharedPattern = new RegExp([sharedDb, "env\\." + mongoName].join("|"));
  const mentionsRealDatabase = (file) => sharedPattern.test(fs.readFileSync(path.join(SRC, "..", file), "utf8"));
  for (const file of [...sorted.pure, ...sorted["local-db"]]) assert.equal(mentionsRealDatabase(file), false, `${file} reaches the shared database but is in a runnable group`);
  assert.ok(sorted["real-db"].length > 0, "the known real-database tests are detected");
});

test("every mounted governance and release route is role-guarded", () => {
  for (const file of ["modules/form-governance/form-governance.routes.js", "modules/form-release/form-release.routes.js"]) {
    const code = stripComments(read(file));
    const routes = [...code.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]([^;]*?)\);/gs)];
    assert.ok(routes.length > 0, `${file} defines routes`);
    for (const [, verb, route, rest] of routes) assert.match(rest, /authorizeRoles\(/, `${verb.toUpperCase()} ${route} in ${file} has no role guard`);
  }
});
