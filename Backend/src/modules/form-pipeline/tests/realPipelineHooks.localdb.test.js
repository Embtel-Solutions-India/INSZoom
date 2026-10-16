// The REAL OnDemandFormAcquisitionService.ensureCurrentUSCISForm running inside a durable job (local test database). Only the outside world is stubbed
// (uscis.gov scanner, importer, mapping / certification services); the stage hooks, edition bookkeeping and result mapping are the production code.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase } = require("../../../test-utils/pipelineDb");
// shaped like a real form code (the pipeline only checks standalone USCIS forms: 2-4 digits) but one no real form has
const uniqueFormCode = () => `ZZ-9${Math.floor(100 + Math.random() * 900)}`;
const FormPipelineJob = require("../../../models/FormPipelineJob");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const { createJobService } = require("../FormPipelineJobService");
const { createRunner } = require("../FormPipelineRunner");
const { createDefaultExecutor } = require("../pipelineExecutor");
const acquisition = require("../../uscis-form-import/services/OnDemandFormAcquisitionService");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const USCISScannerService = require("../../uscis-lifecycle/services/USCISScannerService");
const BiographicMappingService = require("../../form-mapping/services/BiographicMappingService");

let db;
test.after(async () => {
  if (!db?.ok) return;
  await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-9\d{3}$/ });
  await mongoose.connection.collection(USCISFormTemplate.collection.name).deleteMany({ formCode: /^ZZ-9\d{3}$/ });
});
db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineJob, USCISFormTemplate]);

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const svc = createJobService({ random: () => 0.5 });

test("a new edition detected by the real pipeline code is recorded as a job: detect stage, edition identity, outcome 'kept_in_review' (auto-activation off), old edition untouched", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = uniqueFormCode();
  const oldTemplate = await USCISFormTemplate.create({ formCode: code, title: "old", version: "2024-01-01", editionDate: new Date("2024-01-01T00:00:00Z"), status: "active", activeFlag: true, lastChecked: new Date(0) });
  const newTemplate = await USCISFormTemplate.create({ formCode: code, title: "new", version: "2026-01-01", editionDate: new Date("2026-01-01T00:00:00Z"), status: "review", mappingStatus: "unmapped", importMetadata: { checksum: "abc123" }, pdfStorageKey: "x/y.pdf" });
  const previous = process.env.USCIS_ONDEMAND_AUTOACTIVATE;
  const previousAuto = process.env.FORM_EDITION_AUTO_EVIDENCE;
  process.env.USCIS_ONDEMAND_AUTOACTIVATE = "false";
  process.env.FORM_EDITION_AUTO_EVIDENCE = "false"; // the gate answers from the (empty) test database; no request to uscis.gov
  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => oldTemplate);
  t.mock.method(USCISScannerService, "scanForm", async () => ({ action: "draft_version_created", templateId: newTemplate._id, comparisonReport: { unchanged: 1, changed: 1, removed: 0, added: 0 } }));
  t.mock.method(BiographicMappingService, "ensureBiographicMapping", async () => ({ skipped: true }));
  try {
    const runner = createRunner({ jobService: svc, executor: createDefaultExecutor(), promotionLock: async (_code, fn) => ({ ran: true, value: await fn() }), logger: silent });
    const { job } = await svc.enqueue({ formCode: code, trigger: "catalog_sync", options: { forceCheck: true } });
    const claim = await svc.claimById(job._id);
    const outcome = await runner.run({ ...claim, actor: { role: "super_admin" }, req: { ip: "test", headers: {} } });
    assert.equal(outcome.state, "done", JSON.stringify(outcome.transition || outcome.error?.message));
    const saved = await FormPipelineJob.findById(job._id).lean();
    assert.equal(saved.outcome.status, "kept_in_review");
    assert.equal(saved.editionKey, `${code}|2026-01-01|abc123`);
    assert.equal(String(saved.artifacts.newTemplateId), String(newTemplate._id));
    assert.equal(String(saved.artifacts.previousTemplateId), String(oldTemplate._id));
    assert.equal(saved.stages.detect.status, "done");
    assert.ok(saved.stages.map, "the mapping steps of the real activateOrPromote were reported");
    assert.ok(saved.stages.certify, "and certification");
    // the live edition was never touched by a run that did not promote
    assert.equal((await USCISFormTemplate.findById(oldTemplate._id).lean()).status, "active");
    assert.equal((await USCISFormTemplate.findById(newTemplate._id).lean()).status, "review");
  } finally {
    if (previous === undefined) delete process.env.USCIS_ONDEMAND_AUTOACTIVATE; else process.env.USCIS_ONDEMAND_AUTOACTIVATE = previous;
    if (previousAuto === undefined) delete process.env.FORM_EDITION_AUTO_EVIDENCE; else process.env.FORM_EDITION_AUTO_EVIDENCE = previousAuto;
  }
});

test("USCIS unreachable during the check is not a failure of the run: the installed form keeps serving and the job ends 'uscis_unreachable'", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = uniqueFormCode();
  const existing = await USCISFormTemplate.create({ formCode: code, title: "live", version: "2024-01-01", editionDate: new Date("2024-01-01T00:00:00Z"), status: "active", lastChecked: new Date(0) });
  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => existing);
  t.mock.method(USCISScannerService, "scanForm", async () => { throw Object.assign(new Error("uscis.gov timed out"), { code: "ETIMEDOUT" }); });
  const runner = createRunner({ jobService: svc, executor: createDefaultExecutor(), promotionLock: async (_c, fn) => ({ ran: true, value: await fn() }), logger: silent });
  const { job } = await svc.enqueue({ formCode: code, trigger: "catalog_sync", options: { forceCheck: true } });
  const outcome = await runner.run({ ...(await svc.claimById(job._id)), actor: { role: "super_admin" }, req: {} });
  assert.equal(outcome.state, "done");
  const saved = await FormPipelineJob.findById(job._id).lean();
  assert.equal(saved.outcome.status, "uscis_unreachable");
  assert.equal(saved.stages.detect.status, "failed", "the detect stage shows it failed");
  assert.equal(saved.stages.detect.error.class, "transient");
  assert.equal(acquisitionResultIsTemplate(outcome.result, existing), true);
});

const acquisitionResultIsTemplate = (result, template) => String(result.template._id) === String(template._id) && result.alreadyActive === true;
void acquisition;
