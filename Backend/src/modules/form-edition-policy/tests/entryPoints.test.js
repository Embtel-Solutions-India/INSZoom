// Release 0b-2: the ENTRY-POINT MATRIX. Every path that makes a form edition live (or moves cases onto it) must call the fail-closed gate BEFORE it
// changes anything. The real functions run here with stubbed models: a held edition must change nothing, a throwing gate must change nothing, an
// accepted edition must go through exactly as before. A static scan makes sure no new way of activating an edition can appear unguarded.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mock } = require("node:test");

const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const CaseForm = require("../../../models/CaseForm");
const VersionManagementService = require("../../uscis-lifecycle/services/VersionManagementService");
const importer = require("../../uscis-forms/uscis-form-importer.service");
const { migrateCaseFormsToEdition } = require("../../form-mapping/services/CaseFormEditionMigrationService");
const discovery = require("../../uscis-forms/services/USCISFormComponentDiscoveryService");
const { setDepsForTests, EditionPolicyHeldError } = require("../EditionPolicyEnforcer");
const H = require("./helpers");

const day = (iso) => new Date(`${iso}T00:00:00Z`);
const accepted = () => ({ formCode: "I-131", editionIdentifier: "2025-01-20", decision: "accepted", status: "verified", reviewBy: new Date(Date.now() + 86400000 * 60), holdReason: "", version: 1, evidenceRefs: [] });

function fakeTemplate(over = {}) {
  const doc = {
    _id: "t1", formCode: "I-131", version: "2025-01-20", editionDate: day("2025-01-20"), status: "review", currentStatus: "review", activeFlag: false,
    approvedAt: new Date(), approvedBy: "u1", mappingStatus: "active", officialStatus: "unknown", importMetadata: { editionDateSource: "uscis_page", validationSummary: { certification: { passed: true, checks: [] } } }, lifecycle: {},
    saves: 0, async save() { this.saves += 1; return this; }, ...over,
  };
  return doc;
}
const deps = (decisions = []) => {
  const store = H.memoryStore();
  decisions.forEach((row) => store.decisions.set(`${row.formCode}|${row.editionIdentifier}`, row));
  return { store, service: null, autoEvidence: false };
};

// the stubs record every write; nothing real is touched
function stubModels(template) {
  const calls = { updateMany: 0, save: () => template.saves, find: 0, caseFormFind: 0 };
  mock.method(USCISFormTemplate, "findById", async () => template);
  mock.method(USCISFormTemplate, "updateMany", async () => { calls.updateMany += 1; return {}; });
  mock.method(USCISFormTemplate, "find", () => { calls.find += 1; return { lean: async () => [] }; });
  mock.method(CaseForm, "find", async () => { calls.caseFormFind += 1; return []; });
  mock.method(VersionManagementService, "impactAnalysis", async () => ({}));
  mock.method(VersionManagementService, "audit", async () => null);
  mock.method(VersionManagementService, "notify", async () => null);
  mock.method(discovery, "discoverComponentsForParentForm", async () => ({ componentsDiscovered: 0 }));
  return calls;
}
test.afterEach(() => { mock.restoreAll(); setDepsForTests(null); });

const heldError = (error) => error instanceof EditionPolicyHeldError && error.status === 409 && error.code === "EDITION_POLICY_HELD";

test("VersionManagementService.activate (lifecycle route, import route, rollback, the pipeline, FormVersionService): a HELD edition changes nothing", async () => {
  const template = fakeTemplate();
  const calls = stubModels(template);
  setDepsForTests(deps()); // no decision on record
  await assert.rejects(VersionManagementService.activate("t1", { _id: "admin" }, {}), heldError);
  assert.deepEqual([calls.updateMany, template.saves, template.status, template.activeFlag], [0, 0, "review", false], "the live edition was not retired, the candidate was not saved or activated");
});

test("VersionManagementService.activate: a throwing gate changes nothing either (fail closed)", async () => {
  const template = fakeTemplate();
  const calls = stubModels(template);
  setDepsForTests({ store: { findDecision: async () => { throw new Error("db down"); } }, service: null });
  await assert.rejects(VersionManagementService.activate("t1", { _id: "admin" }, {}), (error) => heldError(error) && error.details.reasons[0] === "gate_error");
  assert.deepEqual([calls.updateMany, template.saves, template.status], [0, 0, "review"]);
});

test("VersionManagementService.activate: an edition with no usable edition date, or a backfilled one, is held before anything changes", async () => {
  for (const over of [{ editionDate: null }, { importMetadata: { editionDateSource: "version_backfill", validationSummary: { certification: { passed: true, checks: [] } } } }]) {
    const template = fakeTemplate(over);
    const calls = stubModels(template);
    setDepsForTests(deps([accepted()]));
    await assert.rejects(VersionManagementService.activate("t1", { _id: "admin" }, {}), heldError);
    assert.deepEqual([calls.updateMany, template.saves, template.status], [0, 0, "review"]);
    mock.restoreAll();
  }
});

test("VersionManagementService.activate: an ACCEPTED edition activates exactly as before (live edition retired, candidate saved as active)", async () => {
  const template = fakeTemplate();
  const calls = stubModels(template);
  setDepsForTests(deps([accepted()]));
  const result = await VersionManagementService.activate("t1", { _id: "admin" }, {});
  assert.equal(calls.updateMany, 1, "the previously live edition is retired");
  assert.deepEqual([template.status, template.currentStatus, template.activeFlag, template.officialStatus, template.saves], ["active", "active", true, "current", 1]);
  assert.equal(result.template, template);
});

test("VersionManagementService.activate: the older checks still come first and keep their own messages (not approved / mapping not active)", async () => {
  const unapproved = fakeTemplate({ approvedAt: null });
  stubModels(unapproved);
  setDepsForTests(deps([accepted()]));
  await assert.rejects(VersionManagementService.activate("t1", { _id: "admin" }, {}), /Approve the USCIS form edition before activation/);
  mock.restoreAll();
  const unmapped = fakeTemplate({ mappingStatus: "needs_review" });
  stubModels(unmapped);
  await assert.rejects(VersionManagementService.activate("t1", { _id: "admin" }, {}), /Activate and validate the form mapping/);
});

test("the legacy importer activateVersion is guarded the same way (no callers today, but it cannot be a way around the gate)", async () => {
  const template = fakeTemplate();
  const calls = stubModels(template);
  mock.method(require("../../../models/AuditLog"), "create", async () => null);
  setDepsForTests(deps());
  await assert.rejects(importer.activateVersion("t1", { _id: "admin" }, {}), heldError);
  assert.deepEqual([calls.updateMany, template.saves, template.status], [0, 0, "review"]);
});

test("migrateCaseFormsToEdition refuses an edition that is not accepted BEFORE it reads or touches any case form", async () => {
  const template = fakeTemplate({ status: "active" });
  const calls = stubModels(template);
  setDepsForTests(deps());
  await assert.rejects(migrateCaseFormsToEdition({ newTemplate: template, actor: { _id: "admin" } }), heldError);
  assert.deepEqual([calls.find, calls.caseFormFind], [0, 0]);
  setDepsForTests({ store: { findDecision: async () => { throw new Error("db down"); } }, service: null });
  await assert.rejects(migrateCaseFormsToEdition({ newTemplate: template, actor: { _id: "admin" } }), heldError);
  assert.deepEqual([calls.find, calls.caseFormFind], [0, 0]);
});

test("migrateCaseFormsToEdition: an ACCEPTED edition proceeds as before", async () => {
  const template = fakeTemplate({ status: "active" });
  const calls = stubModels(template);
  setDepsForTests(deps([accepted()]));
  const result = await migrateCaseFormsToEdition({ newTemplate: template, actor: { _id: "admin" } });
  assert.deepEqual([result.considered, result.migrated, result.failed.length], [0, 0, 0]);
  assert.equal(calls.find, 1);
});

// ---- the static matrix: no unguarded way to make an edition live ----
const SRC = path.join(__dirname, "..", "..", "..");
const walk = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files); else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
};
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");
const codeOf = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
const isTest = (file) => /(^|\/)tests\//.test(rel(file)) || /\.test\.js$/.test(file) || /\.manual\.js$/.test(file);

// things that also say status = "active" but are NOT a USCIS form edition going live (an attorney's access, mapping versions, workflow templates, a query)
const NOT_FORM_EDITIONS = ["modules/attorney/attorneyAccess.service.js", "modules/form-mapping/services/FormMappingService.js", "modules/form-mapping/services/MappingGraphService.js", "modules/form-mapping/services/PartyFieldMappingService.js", "modules/workflows/workflow.service.js"];
const SEEDS = ["i129", "i129f", "i130", "i134", "i140", "i485", "i485supj", "i539", "i539a", "i693", "i907"].map((name) => `modules/uscis-form-import/seeds/${name}.seed.js`);
const GUARDED = [
  "modules/uscis-form-import/scripts/importLocalForm.js", "modules/uscis-forms/uscis-form-importer.service.js", "modules/uscis-lifecycle/services/VersionManagementService.js", "scripts/replaceFormEdition.js", ...SEEDS,
];

test("MATRIX: every file that makes a form template live is on the known list, and each one calls the gate (the pipeline's rescue only restores the edition that was live)", () => {
  const ACTIVATES = /\.status\s*=\s*"active"|\.activeFlag\s*=\s*true|\$set:\s*\{[^}]*status:\s*"active"/;
  const found = walk(SRC).filter((file) => !isTest(file) && ACTIVATES.test(codeOf(file))).map(rel).filter((name) => !NOT_FORM_EDITIONS.includes(name)).sort();
  assert.deepEqual(found, [...GUARDED, "modules/uscis-form-import/services/OnDemandFormAcquisitionService.js"].sort(), "a NEW file that makes an edition live must call requireAcceptedEdition and be added here deliberately");
  for (const file of GUARDED) assert.match(codeOf(path.join(SRC, file)), /requireAcceptedEdition\(/, `${file} must call the gate`);
});

test("MATRIX: the 11 bootstrap seeds and the edition-replacement script call the gate before they make the template live", () => {
  for (const file of [...SEEDS, "scripts/replaceFormEdition.js"]) {
    const code = codeOf(path.join(SRC, file));
    const gateAt = code.indexOf("requireAcceptedEdition(");
    const liveAt = code.search(/(template|fresh)\.status = "active"/);
    assert.ok(gateAt > -1 && liveAt > -1 && gateAt < liveAt, `${file}: the gate must come first`);
  }
});

test("MATRIX: the gate call sits BEFORE the first change in each guarded function", () => {
  const order = (file, gateText, firstChange) => {
    const code = codeOf(path.join(SRC, file));
    const gateAt = code.indexOf(gateText);
    const changeAt = code.indexOf(firstChange, gateAt === -1 ? 0 : 0);
    assert.ok(gateAt > -1, `${file}: gate call missing`);
    assert.ok(changeAt > -1, `${file}: ${firstChange} not found`);
    assert.ok(gateAt < changeAt, `${file}: the gate must run before ${firstChange}`);
  };
  order("modules/uscis-lifecycle/services/VersionManagementService.js", 'requireAcceptedEdition(template, { entryPoint: "VersionManagementService.activate"', "USCISFormTemplate.updateMany(");
  order("modules/uscis-forms/uscis-form-importer.service.js", 'entryPoint: "uscis-form-importer.activateVersion"', "USCISFormTemplate.updateMany({ formCode: template.formCode, _id: { $ne: template._id }, status: \"active\" }, { status: \"archived\" })");
  order("modules/uscis-form-import/scripts/importLocalForm.js", 'entryPoint: "importLocalForm"', 'template.status = "active"');
  order("modules/form-mapping/services/CaseFormEditionMigrationService.js", 'entryPoint: "migrateCaseFormsToEdition"', "USCISFormTemplate.find(");
});

test("MATRIX: the pipeline's half-way rescue can only put back the edition that WAS live (never 'the most recently retired one')", () => {
  const code = codeOf(path.join(SRC, "modules/uscis-form-import/services/OnDemandFormAcquisitionService.js"));
  assert.match(code, /const liveBefore = await USCISFormTemplate\.findOne\(\{ formCode: template\.formCode, status: "active" \}\)/);
  assert.match(code, /if \(!stillActive && liveBefore\)/);
  assert.match(code, /findOne\(\{ _id: liveBefore\._id, status: "retired" \}\)/);
  assert.equal(/status: "retired" \}\)\.sort\(\{ retiredAt: -1 \}\)/.test(code), false, "the old unguarded rescue is gone");
});

test("MATRIX: every other route to activation ends in the guarded function (the lifecycle route, import route, rollback, FormVersionService, the pipeline)", () => {
  const calls = [
    ["modules/uscis-lifecycle/controllers/USCISLifecycleController.js", /VersionManagementService\.activate\(/],
    ["modules/uscis-form-import/controllers/USCISFormImportController.js", /versionService\.activate\(/],
    ["modules/uscis-forms/uscis-form.service.js", /VersionManagementService\.activate\(/],
    ["modules/uscis-form-import/services/FormVersionService.js", /VersionManagementService\.activate\(/],
    ["modules/uscis-form-import/services/OnDemandFormAcquisitionService.js", /versionService\.activate\(/],
  ];
  for (const [file, pattern] of calls) assert.match(codeOf(path.join(SRC, file)), pattern, `${file} must activate through VersionManagementService.activate`);
  // rollback is an activation of an older edition and goes through the same function
  assert.match(codeOf(path.join(SRC, "modules/uscis-forms/uscis-form.controller.js")), /async function rollbackTemplate[\s\S]*?uscisFormService\.activateTemplate\(/);
});

test("MATRIX: the pipeline imports only the enforcer (and the 12-hour job only the scheduler) - never the gate, the store or the service directly", () => {
  const importers = walk(SRC).filter((file) => !isTest(file) && !rel(file).startsWith("modules/form-edition-policy/") && /require\([^)]*form-edition-policy/.test(codeOf(file))).map(rel).sort();
  assert.deepEqual(importers, [
    "models/FormEditionAuditEvent.js", "models/FormEditionDecision.js", "modules/form-mapping/services/CaseFormEditionMigrationService.js", "modules/uscis-form-import/scripts/importLocalForm.js",
    "modules/uscis-forms/uscis-form-importer.service.js", "modules/uscis-lifecycle/jobs/USCISCatalogSyncJob.js", "modules/uscis-lifecycle/services/VersionManagementService.js", "routes/index.js", "scripts/formSourceRedirectCrawl.js", "scripts/replaceFormEdition.js", ...SEEDS,
  ].sort());
  for (const file of importers) {
    if (file.startsWith("models/") || file === "routes/index.js" || file === "scripts/formSourceRedirectCrawl.js" || file === "modules/uscis-lifecycle/jobs/USCISCatalogSyncJob.js") continue; // the job: see scheduler.test.js
    assert.equal(/EditionPolicyGate|EvidenceService|EditionPolicyStore/.test(codeOf(path.join(SRC, file))), false, `${file} must only use the enforcer`);
    assert.match(codeOf(path.join(SRC, file)), /EditionPolicyEnforcer/);
  }
});
