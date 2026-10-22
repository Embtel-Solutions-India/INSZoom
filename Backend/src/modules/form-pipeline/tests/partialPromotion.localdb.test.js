// The REAL activateOrPromote (inside a durable job, local throwaway database) for a new edition that LOST a mapped box. Owner decision 2026-10-23: with FORM_PIPELINE_AUTONOMY=on the box is
// left unmapped (blank) and the edition goes on to the next gate with every other box mapped; with the switch off the old behavior is unchanged (the lost box keeps the edition at
// "kept_in_review", nothing is even attempted). Only the outside world is stubbed (uscis.gov scanner, certification, the biographic fallback); the edition-policy gate is the real one
// and answers "held" from the empty test database, which is exactly the proof that the mapping is no longer what stops the edition.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase } = require("../../../test-utils/pipelineDb");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const QuestionLibraryItem = require("../../../models/QuestionLibraryItem");
const AuditLog = require("../../../models/AuditLog");
const { createJobService } = require("../FormPipelineJobService");
const { createRunner } = require("../FormPipelineRunner");
const { createDefaultExecutor } = require("../pipelineExecutor");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const USCISScannerService = require("../../uscis-lifecycle/services/USCISScannerService");
const BiographicMappingService = require("../../form-mapping/services/BiographicMappingService");
const FormCertificationService = require("../../form-mapping/services/FormCertificationService");
const MappingGraphService = require("../../form-mapping/services/MappingGraphService");
const ComponentDiscovery = require("../../uscis-forms/services/USCISFormComponentDiscoveryService");

const uniqueFormCode = () => `ZZ-9${Math.floor(100 + Math.random() * 900)}`;
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const created = { templates: [] };

let db;
test.after(async () => {
  if (!db?.ok) return;
  await mongoose.connection.collection(FormPipelineJob.collection.name).deleteMany({ formCode: /^ZZ-9\d{3}$/ });
  await mongoose.connection.collection(USCISFormTemplate.collection.name).deleteMany({ formCode: /^ZZ-9\d{3}$/ });
  await mongoose.connection.collection(USCISMappingVersion.collection.name).deleteMany({ formCode: /^ZZ-9\d{3}$/ });
});
db = useTestDatabase({ before: test.before, after: test.after }, [FormPipelineJob, USCISFormTemplate, USCISMappingVersion, QuestionLibraryItem, AuditLog]);
const svc = createJobService({ random: () => 0.5 });

const FIELDS = [
  { fieldId: "given", fieldName: "given", pdfFieldName: "given", label: "Given Name", fieldType: "text" },
  { fieldId: "dob", fieldName: "dob", pdfFieldName: "dob", label: "Date of Birth", fieldType: "date" },
  { fieldId: "box", fieldName: "box", pdfFieldName: "box", label: "Agree", fieldType: "checkbox" },
];
const edge = (template, targetFieldId, sourcePath, over = {}) => ({
  mappingId: `${template.formCode}:${template.version}:${targetFieldId}`, formCode: template.formCode, version: template.version, sourcePath, sourceType: "canonical", targetFieldId, targetPdfField: targetFieldId,
  targetLabel: targetFieldId, targetType: "text", section: "s", pageNumber: 1, mappingType: "direct", confidence: 95, status: "active", origin: "authored", transform: { type: "direct" }, ...over,
});
const graphOf = (template, edges) => ({
  formCode: template.formCode, version: template.version,
  nodes: { canonical: [...new Set(edges.map((item) => item.sourcePath))].map((path) => ({ id: `canonical:${path}`, path, type: "text" })), form: template.formFields.map((item) => ({ fieldId: item.fieldId })) },
  edges, unmappedTargets: [], validation: {},
});

async function seed() {
  const code = uniqueFormCode();
  const oldTemplate = await USCISFormTemplate.create({ formCode: code, title: "old", version: "2024-01-01", editionDate: new Date("2024-01-01T00:00:00Z"), status: "active", activeFlag: true, mappingStatus: "draft", lastChecked: new Date(0), formFields: FIELDS.map((f) => ({ ...f })) });
  await MappingGraphService.persistVersion(oldTemplate, graphOf(oldTemplate, [edge(oldTemplate, "given", "person.firstName"), edge(oldTemplate, "dob", "person.dob", { targetType: "date" })]), admin);
  await MappingGraphService.activate(oldTemplate._id, admin, {});
  const newTemplate = await USCISFormTemplate.create({
    formCode: code, title: "new", version: "2026-01-01", editionDate: new Date("2026-01-01T00:00:00Z"), status: "draft", mappingStatus: "unmapped", parentVersion: oldTemplate._id,
    artifacts: { form: { storageKey: "test/stored.pdf" } }, // the readiness check only needs a stored PDF to exist on the edition
    importMetadata: { checksum: "abc123", validationSummary: { certification: { passed: true, checks: [] } } },
    formFields: [FIELDS[0], FIELDS[2], { fieldId: "brandnew", fieldName: "brandnew", pdfFieldName: "brandnew", label: "Something new", fieldType: "text" }].map((f) => ({ ...f })), // "dob" is gone
  });
  created.templates.push(oldTemplate._id, newTemplate._id);
  return { code, oldTemplate, newTemplate };
}

async function runJob(t, { code, oldTemplate, newTemplate }, mode) {
  const saved = { auto: process.env.USCIS_ONDEMAND_AUTOACTIVATE, evidence: process.env.FORM_EDITION_AUTO_EVIDENCE, mode: process.env.FORM_PIPELINE_AUTONOMY };
  process.env.USCIS_ONDEMAND_AUTOACTIVATE = "false"; // only a READY mapping may promote, so the mapping is the thing under test
  process.env.FORM_EDITION_AUTO_EVIDENCE = "false";
  if (mode === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = mode;
  t.mock.method(uscisFormService, "findLatestActiveTemplate", async () => oldTemplate);
  t.mock.method(USCISScannerService, "scanForm", async () => ({ action: "draft_version_created", templateId: newTemplate._id, comparisonReport: { unchanged: 1, changed: 1, removed: 1, added: 1 } }));
  t.mock.method(BiographicMappingService, "ensureBiographicMapping", async () => ({ skipped: true }));
  t.mock.method(FormCertificationService, "certify", async () => ({ passed: true, checks: [] }));
  t.mock.method(FormCertificationService, "backupTemplate", async () => null);
  t.mock.method(ComponentDiscovery, "discoverComponentsForParentForm", async () => ({ results: [], componentsDiscovered: 0 })); // no PDF in the test database to slice
  try {
    const runner = createRunner({ jobService: svc, executor: createDefaultExecutor(), promotionLock: async (_c, fn) => ({ ran: true, value: await fn() }), logger: silent, autonomyMode: () => mode || "off" });
    const { job } = await svc.enqueue({ formCode: code, trigger: "catalog_sync", options: { forceCheck: true } });
    const claim = await svc.claimById(job._id);
    const outcome = await runner.run({ ...claim, actor: { _id: admin._id, role: "super_admin" }, req: { ip: "test", headers: {} } });
    return { outcome, job: await FormPipelineJob.findById(job._id).lean() };
  } finally {
    for (const [key, value] of [["USCIS_ONDEMAND_AUTOACTIVATE", saved.auto], ["FORM_EDITION_AUTO_EVIDENCE", saved.evidence], ["FORM_PIPELINE_AUTONOMY", saved.mode]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("a lost box: with the switch OFF nothing changes (mapping not activated, no promotion attempted); ON the mapping goes live without that box and the edition moves on to the next gate", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const off = await seed();
  const offRun = await runJob(t, off, undefined);
  assert.equal(offRun.outcome.state, "done");
  assert.equal(offRun.job.outcome.status, "kept_in_review");
  assert.equal(offRun.outcome.result.activationBlockedCode, null, "off: promotion was never attempted - the lost box kept the mapping un-activated");
  assert.equal(offRun.outcome.result.mappingLeftUnmapped, null);
  assert.notEqual((await USCISFormTemplate.findById(off.newTemplate._id).lean()).mappingStatus, "active");

  t.mock.reset();
  const on = await seed();
  const onRun = await runJob(t, on, "on");
  assert.equal(onRun.outcome.state, "held", "the edition waits at the acceptance gate (a documented hold), not at the mapping");
  assert.equal(onRun.job.hold.reasonCode, "EDITION_POLICY_HELD");
  assert.deepEqual(onRun.outcome.result.mappingLeftUnmapped, { lost: 1, needsReview: 0 });
  assert.equal((await USCISFormTemplate.findById(on.newTemplate._id).lean()).mappingStatus, "active", "the mapping went live with the boxes that could be mapped");
  const active = await USCISMappingVersion.findOne({ template: on.newTemplate._id, status: "active" }).lean();
  assert.deepEqual(active.graph.edges.map((item) => item.targetFieldId), ["given"]);
  assert.equal(onRun.outcome.result.activationBlockedCode, "EDITION_POLICY_HELD", "the mapping no longer stops the edition: it reached the edition-acceptance gate (empty test database => held)");
  const summary = require("../FormPipelineRunner").summarizeResult(onRun.outcome.result);
  assert.equal(summary.ladder.mapped.status, "done");
  assert.match(summary.ladder.mapped.reason, /1 box\(es\) left unmapped/);
  assert.equal((await USCISFormTemplate.findById(on.oldTemplate._id).lean()).status, "active", "the live edition keeps serving");
});
