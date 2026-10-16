// DB-free: the planning step of correctEditionFromPdfFooter.js (what would change, in the <form>_<yyyy-mm-dd> naming format).
const test = require("node:test");
const assert = require("node:assert/strict");
const { planCorrection, pathsMentioning } = require("../correctEditionFromPdfFooter");

const HASH = "e".repeat(64);
const template = (over = {}) => ({
  formCode: "I-131", version: "2026-09-18", editionDate: new Date("2026-09-18T00:00:00Z"), registryId: "I-131:2026-09-18",
  pdfStorageKey: `government/uscis/I-131/2026-09-18/${HASH}/i-131_2026-09-18.pdf`, pdfTemplatePath: `government/uscis/I-131/2026-09-18/${HASH}/i-131_2026-09-18.pdf`,
  localPdfPath: `government/uscis/I-131/2026-09-18/${HASH}/i-131_2026-09-18.pdf`,
  artifacts: { form: { storageKey: `government/uscis/I-131/2026-09-18/${HASH}/i-131_2026-09-18.pdf`, storagePath: `government/uscis/I-131/2026-09-18/${HASH}/i-131_2026-09-18.pdf` } },
  importMetadata: { editionDateSource: "version_backfill", validationSummary: { certification: { passed: true, version: "2026-09-18" } } },
  ...over,
});

test("the edition, version, registry id, every stored-file pointer and the certification label all move to the footer edition, in <form>_<yyyy-mm-dd>", () => {
  const plan = planCorrection({ template: template(), footerEdition: "2025-01-20" });
  const key = `government/uscis/I-131/2025-01-20/${HASH}/i-131_2025-01-20.pdf`;
  assert.equal(plan.refuse, null);
  assert.equal(plan.newKey, key);
  assert.deepEqual(plan.set, {
    editionDate: new Date("2025-01-20T00:00:00Z"), version: "2025-01-20", "importMetadata.editionDateSource": "pdf", pdfStorageKey: key, "artifacts.form.storageKey": key,
    registryId: "I-131:2025-01-20", pdfTemplatePath: key, localPdfPath: key, "artifacts.form.storagePath": key, "importMetadata.validationSummary.certification.version": "2025-01-20",
  });
});

test("only fields the template actually has are set (no registry id, no local path => none invented)", () => {
  const plan = planCorrection({ template: template({ registryId: undefined, pdfTemplatePath: undefined, localPdfPath: undefined, artifacts: { form: {} } }), footerEdition: "2025-01-20" });
  assert.deepEqual(Object.keys(plan.set).sort(), ["artifacts.form.storageKey", "editionDate", "importMetadata.editionDateSource", "importMetadata.validationSummary.certification.version", "pdfStorageKey", "version"]);
});

test("a template that is already correct is left alone", () => {
  const key = `government/uscis/I-131/2025-01-20/${HASH}/i-131_2025-01-20.pdf`;
  const done = template({ version: "2025-01-20", editionDate: new Date("2025-01-20T00:00:00Z"), pdfStorageKey: key, importMetadata: { editionDateSource: "pdf" } });
  assert.equal(planCorrection({ template: done, footerEdition: "2025-01-20" }).alreadyCorrect, true);
});

test("another template already holding the new version is refused (unique formCode+version) unless it is a retired, case-free duplicate, which only gets a new label", () => {
  const retired = { _id: "r1", status: "retired", version: "2025-01-20", registryId: "I-131:2025-01-20", importMetadata: { source: "manual_upload" } };
  assert.match(planCorrection({ template: template(), footerEdition: "2025-01-20", collision: retired }).refuse, /already has version 2025-01-20/);
  assert.match(planCorrection({ template: template(), footerEdition: "2025-01-20", collision: retired, relabelRetired: true, collisionCaseForms: 2 }).refuse, /already has version/);
  assert.match(planCorrection({ template: template(), footerEdition: "2025-01-20", collision: { ...retired, status: "active" }, relabelRetired: true }).refuse, /already has version/);
  const plan = planCorrection({ template: template(), footerEdition: "2025-01-20", collision: retired, relabelRetired: true });
  assert.equal(plan.refuse, null);
  assert.deepEqual(plan.relabel, { _id: "r1", fromVersion: "2025-01-20", toVersion: "2025-01-20-manual-upload", fromRegistryId: "I-131:2025-01-20", toRegistryId: "I-131:2025-01-20-manual-upload" });
});

test("an unexpected stored-file key is refused rather than guessed at", () => {
  assert.match(planCorrection({ template: template({ pdfStorageKey: "somewhere/form.pdf" }), footerEdition: "2025-01-20" }).refuse, /expected shape/);
});

test("pathsMentioning reports what else carries the old version", () => {
  assert.deepEqual(pathsMentioning({ version: "x", a: { b: "path/x/file" }, list: ["x"], d: new Date() }, "x").sort(), ["a.b", "list[0]", "version"]);
});
