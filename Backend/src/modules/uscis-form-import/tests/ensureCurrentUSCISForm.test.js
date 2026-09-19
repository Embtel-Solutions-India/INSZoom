// DB-free, mocked-service style (this repo's default test convention — see
// data-rights/tests/dataRights.service.test.js), not the H0 real-DB/real-
// qpdf exception (h0-i129-seed.test.js). ensureCurrentUSCISForm's own logic
// — TTL fast-path, missing-vs-outdated branching, dedupe, USCIS-unavailable
// fallback — is what's under test here, not the underlying scan/import
// pipeline those tests already cover.
const assert = require("node:assert/strict");
const test = require("node:test");

const service = require("../services/OnDemandFormAcquisitionService");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const USCISScannerService = require("../../uscis-lifecycle/services/USCISScannerService");
const USCISFormImporterService = require("../services/USCISFormImporterService");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const BiographicMappingService = require("../../form-mapping/services/BiographicMappingService");

const user = { _id: "u1", role: "super_admin" };
const req = { requestId: "test" };

test("ensureCurrentUSCISForm: local template already current within TTL — no USCIS call", async (t) => {
  const existing = { _id: "t1", formCode: "I-140", status: "active", lastChecked: new Date() };
  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => existing);
  const scanSpy = t.mock.method(USCISScannerService, "scanForm", async () => { throw new Error("must not be called"); });

  const result = await service.ensureCurrentUSCISForm("I-140", user, req, { forceCheck: false });

  assert.equal(result.template, existing);
  assert.equal(result.checked, false);
  assert.equal(scanSpy.mock.callCount(), 0);
});

test("ensureCurrentUSCISForm: no local template — acquires via the existing import pipeline", async (t) => {
  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => null);
  t.mock.method(USCISScannerService, "fetchPage", async () => "<html></html>");
  t.mock.method(USCISScannerService, "extractFormPageMetadata", () => ({
    pdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-140.pdf",
    editionDate: new Date("2026-01-01"),
    formName: "I-140, Immigrant Petition for Alien Worker",
  }));
  const importedTemplate = { _id: "t2", formCode: "I-140", status: "review", mappingStatus: "unmapped" };
  const importSpy = t.mock.method(USCISFormImporterService, "importFromUrl", async () => ({ template: importedTemplate }));
  t.mock.method(BiographicMappingService, "ensureBiographicMapping", async () => ({ skipped: true }));

  const result = await service.ensureCurrentUSCISForm("I-140", user, req, { forceCheck: false });

  assert.equal(importSpy.mock.callCount(), 1);
  assert.equal(result.template, importedTemplate);
  assert.equal(result.alreadyActive, false);
});

test("ensureCurrentUSCISForm: new USCIS edition detected — old template preserved, new one imported and reviewed", async (t) => {
  const oldTemplate = { _id: "t3", formCode: "I-129", status: "active", lastChecked: new Date(0) };
  const newTemplate = { _id: "t4", formCode: "I-129", status: "review", mappingStatus: "unmapped" };
  const previousAutoActivate = process.env.USCIS_ONDEMAND_AUTOACTIVATE;
  process.env.USCIS_ONDEMAND_AUTOACTIVATE = "false"; // force the review path deterministically

  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => oldTemplate);
  const scanSpy = t.mock.method(USCISScannerService, "scanForm", async () => ({
    action: "draft_version_created",
    templateId: newTemplate._id,
    comparisonReport: { unchanged: 96, changed: 4, removed: 1, added: 2 },
  }));
  t.mock.method(USCISFormTemplate, "findById", async () => newTemplate);
  t.mock.method(BiographicMappingService, "ensureBiographicMapping", async () => ({ skipped: true }));

  try {
    const result = await service.ensureCurrentUSCISForm("I-129", user, req, { forceCheck: true });

    assert.equal(scanSpy.mock.callCount(), 1);
    assert.equal(result.versionChanged, true);
    assert.equal(result.previousTemplate, oldTemplate);
    assert.equal(result.newTemplateId, newTemplate._id);
    // AUTOACTIVATE is off, so the new edition stays in review — the
    // previously-active old template is still what's served, never silently
    // replaced by an unreviewed one.
    assert.equal(result.template, oldTemplate);
    assert.equal(result.requiresActivation, true);
    assert.deepEqual(result.comparisonReport, { unchanged: 96, changed: 4, removed: 1, added: 2 });
  } finally {
    process.env.USCIS_ONDEMAND_AUTOACTIVATE = previousAutoActivate;
  }
});

test("ensureCurrentUSCISForm: same edition — touches lastChecked, no re-import", async (t) => {
  const existing = { _id: "t5", formCode: "I-485", status: "active", lastChecked: new Date(0) };
  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => existing);
  t.mock.method(USCISScannerService, "scanForm", async () => ({ action: "no_change_detected" }));
  const importSpy = t.mock.method(USCISFormImporterService, "importFromUrl", async () => { throw new Error("must not be called"); });

  const result = await service.ensureCurrentUSCISForm("I-485", user, req, { forceCheck: true });

  assert.equal(result.template, existing);
  assert.equal(result.checked, true);
  assert.equal(importSpy.mock.callCount(), 0);
});

test("ensureCurrentUSCISForm: USCIS unavailable — existing validated template still returned, no throw", async (t) => {
  const existing = { _id: "t6", formCode: "I-539", status: "active", lastChecked: new Date(0) };
  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => existing);
  t.mock.method(USCISScannerService, "scanForm", async () => { throw new Error("network timeout"); });

  const result = await service.ensureCurrentUSCISForm("I-539", user, req, { forceCheck: true });

  assert.equal(result.template, existing);
  assert.equal(result.checked, true);
  assert.match(result.checkError, /network timeout/);
});

test("ensureCurrentUSCISForm: concurrent calls for the same form are deduplicated to one acquisition", async (t) => {
  let callCount = 0;
  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => {
    callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return null;
  });
  t.mock.method(USCISScannerService, "fetchPage", async () => "<html></html>");
  t.mock.method(USCISScannerService, "extractFormPageMetadata", () => ({
    pdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-539a.pdf",
    editionDate: new Date("2026-01-01"),
    formName: "I-539A",
  }));
  const importedTemplate = { _id: "t7", formCode: "I-539A", status: "review", mappingStatus: "unmapped" };
  const importSpy = t.mock.method(USCISFormImporterService, "importFromUrl", async () => ({ template: importedTemplate }));
  t.mock.method(BiographicMappingService, "ensureBiographicMapping", async () => ({ skipped: true }));

  const results = await Promise.all([
    service.ensureCurrentUSCISForm("I-539A", user, req, { forceCheck: false }),
    service.ensureCurrentUSCISForm("I-539A", user, req, { forceCheck: false }),
    service.ensureCurrentUSCISForm("I-539A", user, req, { forceCheck: false }),
  ]);

  assert.equal(callCount, 1, "concurrent callers must share one in-flight lookup, not each trigger their own");
  assert.equal(importSpy.mock.callCount(), 1, "concurrent callers must share one in-flight acquisition, not each trigger a download");
  results.forEach((result) => assert.equal(result.template, importedTemplate));
});
