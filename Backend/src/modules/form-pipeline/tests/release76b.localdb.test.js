// Phase 7.6b against the LOCAL throwaway database (src/test-utils/pipelineDb.js refuses anything else; skipped when no local MongoDB answers): the queued case migration (one open
// job per form), activate() scheduling per autonomy mode, the machine acknowledgement of provably safe edition diffs keyed to the diff hash, the system approval, and the
// registration of a brand-new form with no visa type. Real models and the real services; only the acceptance store and side-effect notifications are scripted.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const FormPipelineJob = require("../../../models/FormPipelineJob");
const VersionManagementService = require("../../uscis-lifecycle/services/VersionManagementService");
const FormEditionComparisonService = require("../../form-mapping/services/FormEditionComparisonService");
const { setDepsForTests } = require("../../form-edition-policy/EditionPolicyEnforcer");
const { createJobService } = require("../FormPipelineJobService");
const queue = require("../caseMigrationQueue");
const { systemActor, SYSTEM_ACTOR_ID } = require("../systemActor");

const codes = [];
const raw = (name) => mongoose.connection.collection(name);
test.after(async () => {
  if (!db?.ok || !codes.length) return;
  const ids = (await raw("uscisformtemplates").find({ formCode: { $in: codes } }, { projection: { _id: 1 } }).toArray()).map((item) => item._id);
  await raw("uscismappingversions").deleteMany({ template: { $in: ids } });
  await raw("uscisformtemplates").deleteMany({ formCode: { $in: codes } });
  await raw("formpipelinejobs").deleteMany({ formCode: { $in: codes } });
  setDepsForTests(null);
});
const db = useTestDatabase({ before: test.before, after: test.after }, [USCISFormTemplate, FormPipelineJob]);
const newCode = () => { const code = uniqueFormCode(); codes.push(code); return code; };
const day = (iso) => new Date(`${iso}T00:00:00Z`);
const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const withMode = async (mode, fn) => {
  const before = process.env.FORM_PIPELINE_AUTONOMY;
  process.env.FORM_PIPELINE_AUTONOMY = mode;
  try { return await fn(); } finally { if (before === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = before; }
};
const jobsOf = (code) => raw("formpipelinejobs").find({ formCode: code }).toArray();

// ── scheduling on the real job store ─────────────────────────────────────
test("no open job: a case_migration job is queued with its edition; scheduling the same edition twice is one job", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const tpl = { _id: new mongoose.Types.ObjectId(), formCode: code };
  const jobService = createJobService();
  const first = await queue.scheduleCaseMigration({ template: tpl, user: systemActor(), mode: "on", deps: { jobService } });
  const second = await queue.scheduleCaseMigration({ template: tpl, mode: "on", deps: { jobService } });
  assert.deepEqual([first.scheduled, second.scheduled], ["job", "already"]);
  const jobs = await jobsOf(code);
  assert.equal(jobs.length, 1);
  assert.deepEqual([jobs[0].trigger, String(jobs[0].options.migrateTemplateId), jobs[0].state], ["case_migration", String(tpl._id), "pending"]);
});

test("a pipeline job for the form is open: NO second job; the edition is its follow-up, recorded once, and the one-open-job index is never violated", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const jobService = createJobService();
  const { job } = await jobService.enqueue({ formCode: code, trigger: "admin_fetch" });
  const tpl = { _id: new mongoose.Types.ObjectId(), formCode: code };
  const a = await queue.scheduleCaseMigration({ template: tpl, mode: "on", deps: { jobService, joinRecheckMs: 1e9 } });
  const b = await queue.scheduleCaseMigration({ template: tpl, mode: "on", deps: { jobService, joinRecheckMs: 1e9 } });
  assert.deepEqual([a.scheduled, b.scheduled], ["joined", "joined"]);
  const jobs = await jobsOf(code);
  assert.equal(jobs.length, 1);
  assert.equal(String(jobs[0]._id), String(job._id));
  assert.equal(String(jobs[0].options.followUpMigrationTemplateId), String(tpl._id));
});

test("the open job closed before it looked at its follow-up: a case_migration job is queued for it a moment later", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const jobService = createJobService();
  const { job } = await jobService.enqueue({ formCode: code, trigger: "catalog_sync" });
  const tpl = { _id: new mongoose.Types.ObjectId(), formCode: code };
  await jobService.setFollowUpMigration(job._id, tpl._id);
  await raw("formpipelinejobs").updateOne({ _id: job._id }, { $set: { state: "done", open: false } }); // the job finished without consuming it
  queue.armJoinCheck({ jobService, jobId: job._id, template: tpl, deps: { joinRecheckMs: 5 } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const open = (await jobsOf(code)).filter((item) => item.open);
  assert.equal(open.length, 1);
  assert.equal(open[0].trigger, "case_migration");
});

// ── activate() per mode ──────────────────────────────────────────────────
const certified = { validationSummary: { certification: { passed: true, checks: [] } } };
const make = async (formCode, version, editionISO, over = {}) => USCISFormTemplate.create({
  formCode, title: `${formCode} test`, version, editionDate: day(editionISO), status: "review", mappingStatus: "active", approvedAt: new Date(), approvedBy: new mongoose.Types.ObjectId(),
  importMetadata: { editionDateSource: "pdf", ...certified }, lifecycle: {}, activeMappingVersionId: new mongoose.Types.ObjectId(), ...over,
});
const useAcceptance = (...entries) => {
  const accepted = new Set(entries);
  setDepsForTests({
    service: { runAutomaticCheck: async () => ({}), recordOutcome: async () => ({}) },
    store: { findDecision: async (code, edition) => (accepted.has(`${code}|${edition}`) ? { decision: "accepted", status: "verified", reviewBy: new Date(Date.now() + 864e5) } : null) },
    autoEvidence: false,
  });
};
const stub = (t) => { t.mock.method(VersionManagementService, "notify", async () => []); t.mock.method(VersionManagementService, "audit", async () => undefined); };

test("activate(): off and shadow queue NOTHING; on queues the migration; a caller that moves the cases itself (and a rollback) opts out", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stub(t);
  const code = newCode();
  useAcceptance(`${code}|2025-01-20`, `${code}|2026-01-20`, `${code}|2026-02-20`, `${code}|2026-03-20`);
  await make(code, "2025-01-20", "2025-01-20", { status: "active", activeFlag: true });
  const off = await make(code, "2026-01-20", "2026-01-20");
  const result = await withMode("off", () => VersionManagementService.activate(off._id, admin, {}));
  assert.equal(result.caseMigrationScheduled, undefined, "off: the result has exactly its old shape");
  assert.equal((await jobsOf(code)).length, 0);

  const shadow = await make(code, "2026-02-20", "2026-02-20");
  await withMode("shadow", () => VersionManagementService.activate(shadow._id, admin, {}));
  assert.equal((await jobsOf(code)).length, 0, "shadow writes no job");

  const optOut = await make(code, "2026-03-20", "2026-03-20");
  await withMode("on", () => VersionManagementService.activate(optOut._id, admin, {}, { skipCaseMigration: true }));
  assert.equal((await jobsOf(code)).length, 0, "skipCaseMigration: nothing queued");
});

test("activate() with the switch ON queues exactly one case_migration job for the released edition (any caller, a manual admin activation included)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stub(t);
  const code = newCode();
  useAcceptance(`${code}|2025-01-20`, `${code}|2026-01-20`);
  await make(code, "2025-01-20", "2025-01-20", { status: "active", activeFlag: true });
  const next = await make(code, "2026-01-20", "2026-01-20");
  const result = await withMode("on", () => VersionManagementService.activate(next._id, admin, {}));
  assert.equal(result.caseMigrationScheduled.scheduled, "job");
  const jobs = await jobsOf(code);
  assert.equal(jobs.length, 1);
  assert.deepEqual([jobs[0].trigger, String(jobs[0].options.migrateTemplateId), String(jobs[0].requestedBy)], ["case_migration", String(next._id), String(admin._id)]);
});

// ── the system approval ──────────────────────────────────────────────────
test("approve() by the system actor records the machine approval and the certification it relied on; a person's approval is unchanged", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stub(t);
  const code = newCode();
  const draft = await make(code, "2026-01-20", "2026-01-20", { status: "draft", approvedAt: undefined, approvedBy: undefined });
  const approved = await VersionManagementService.approve(draft._id, systemActor(), {}, { machine: { certificationAt: new Date("2026-10-23T00:00:00Z"), certificationPassed: true } });
  assert.equal(String(approved.approvedBy), SYSTEM_ACTOR_ID);
  assert.equal(approved.status, "review");
  assert.equal(approved.lifecycle.approvedByMachine.actor, "system:pipeline");
  assert.equal(approved.lifecycle.approvedByMachine.certificationPassed, true);
  const other = await make(code, "2026-02-20", "2026-02-20", { status: "draft", approvedAt: undefined, approvedBy: undefined });
  const byPerson = await VersionManagementService.approve(other._id, admin, {});
  assert.equal(String(byPerson.approvedBy), String(admin._id));
  assert.equal(byPerson.lifecycle.approvedByMachine, undefined);
});

// ── the machine acknowledgement of an edition diff ───────────────────────
const field = (id, required = false) => ({ fieldId: id, id, fieldName: id, pdfFieldName: id, label: `Label ${id}`, fieldType: "text", type: "text", pageNumber: 1, required });
const graphOf = (...ids) => ({ edges: ids.map((id) => ({ mappingId: `map-${id}`, targetFieldId: id, sourcePath: `beneficiary.${id}`, status: "active", confidence: 1 })) });

async function editions(code, { oldFields, newFields, edges }) {
  const parent = await make(code, "2025-01-20", "2025-01-20", { status: "active", activeFlag: true, formFields: oldFields });
  await raw("uscismappingversions").insertOne({ template: parent._id, mappingVersion: 1, status: "active", graph: graphOf(...edges) });
  const child = await make(code, "2026-01-20", "2026-01-20", { formFields: newFields, parentVersion: parent._id });
  return { parent, child };
}

test("a required flip on a box that still exists is acknowledged by the pipeline - once, keyed to that diff; a different diff needs a new acknowledgement", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const { parent, child } = await editions(code, { oldFields: [field("A"), field("B")], newFields: [field("A", true), field("B")], edges: ["A", "B"] });
  assert.equal((await FormEditionComparisonService.hasUnreviewedEditionChanges(child)).blocked, true, "a person would have to acknowledge it");

  const first = await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "on" });
  assert.deepEqual([first.acknowledged, first.already], [true, undefined]);
  const stored = await USCISFormTemplate.findById(child._id).lean();
  assert.equal(stored.lifecycle.editionReviewMachineAck.actor, "system:pipeline");
  assert.equal(String(stored.lifecycle.editionReviewOldTemplateId), String(parent._id));
  assert.equal((await FormEditionComparisonService.hasUnreviewedEditionChanges(stored)).blocked, false);

  const again = await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "on" });
  assert.equal(again.already, true, "the same diff again writes nothing new");

  // the difference changes (a second box flips): the old acknowledgement no longer covers it
  await USCISFormTemplate.updateOne({ _id: child._id }, { $set: { formFields: [field("A", true), field("B", true)] } });
  const changed = await USCISFormTemplate.findById(child._id).lean();
  assert.equal((await FormEditionComparisonService.hasUnreviewedEditionChanges(changed)).blocked, true, "a different diff is blocked again");
  assert.equal((await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "on" })).acknowledged, true, "...and acknowledged for ITS own hash");
});

test("a removed box is never acknowledged by the pipeline, and nothing is written", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const { child } = await editions(code, { oldFields: [field("A"), field("B")], newFields: [field("B")], edges: ["A", "B"] });
  const result = await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "on" });
  assert.deepEqual([result.acknowledged, result.reason], [false, "not_provably_safe"]);
  const stored = await USCISFormTemplate.findById(child._id).lean();
  assert.equal(stored.lifecycle.editionReviewAcknowledgedAt, undefined);
  assert.equal((await FormEditionComparisonService.hasUnreviewedEditionChanges(stored)).blocked, true);
});

test("shadow reports it WOULD acknowledge but writes nothing; off does nothing; a failed certification or a not-accepted edition is never acknowledged", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const { child } = await editions(code, { oldFields: [field("A")], newFields: [field("A", true)], edges: ["A"] });
  const shadow = await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "shadow" });
  assert.deepEqual([shadow.acknowledged, shadow.wouldAcknowledge], [false, true]);
  assert.equal((await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "off" })).acknowledged, false);
  assert.equal((await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "on", certification: { passed: false } })).reason, "certification_failed");
  assert.equal((await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "on", editionDecision: "not_accepted" })).reason, "edition_not_accepted");
  assert.equal((await USCISFormTemplate.findById(child._id).lean()).lifecycle.editionReviewAcknowledgedAt, undefined, "none of those wrote anything");
});

test("a person's acknowledgement replaces the pipeline's and is not keyed to the diff hash", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const { child } = await editions(code, { oldFields: [field("A")], newFields: [field("A", true)], edges: ["A"] });
  await FormEditionComparisonService.autoAcknowledge(child._id, { mode: "on" });
  await FormEditionComparisonService.acknowledge(child._id, admin, {});
  const stored = await USCISFormTemplate.findById(child._id).lean();
  assert.equal(stored.lifecycle.editionReviewMachineAck, undefined);
  assert.equal(String(stored.lifecycle.editionReviewAcknowledgedBy), String(admin._id));
});

// ── a brand-new form ─────────────────────────────────────────────────────
test("a never-seen form is registered with NO visa type and marked; an edition of a known form is left alone; off does nothing", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const OnDemand = require("../../uscis-form-import/services/OnDemandFormAcquisitionService");
  const code = newCode();
  const first = await make(code, "2026-01-20", "2026-01-20", { visaTypes: ["H-1B"] });
  assert.equal(await withMode("off", () => OnDemand.registerBrandNewFormUnlinked(first)), null);
  assert.deepEqual((await USCISFormTemplate.findById(first._id).lean()).visaTypes, ["H-1B"], "off: untouched");
  const marker = await withMode("on", () => OnDemand.registerBrandNewFormUnlinked(first));
  assert.equal(marker.by, "system:pipeline");
  const stored = await USCISFormTemplate.findById(first._id).lean();
  assert.deepEqual(stored.visaTypes, []);
  assert.ok(stored.lifecycle.registeredUnlinked);
  const second = await make(code, "2027-01-20", "2027-01-20", { visaTypes: ["L-1A"] });
  assert.equal(await withMode("on", () => OnDemand.registerBrandNewFormUnlinked(second)), null, "another edition of a form we already have");
  assert.deepEqual((await USCISFormTemplate.findById(second._id).lean()).visaTypes, ["L-1A"]);
});

// ── a rollback never moves cases ─────────────────────────────────────────
test("a rollback with the switch ON queues no case migration (cases are never moved back onto the older edition)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stub(t);
  const code = newCode();
  useAcceptance(`${code}|2025-01-20`, `${code}|2026-01-20`);
  const mappingId = new mongoose.Types.ObjectId();
  const older = await make(code, "2025-01-20", "2025-01-20", { status: "retired", activeFlag: false, activeMappingVersionId: mappingId });
  await raw("uscismappingversions").insertOne({ _id: mappingId, template: older._id, mappingVersion: 1, status: "active", graph: { edges: [] } });
  await make(code, "2026-01-20", "2026-01-20", { status: "active", activeFlag: true });
  const result = await withMode("on", () => VersionManagementService.rollback(code, { toTemplateId: older._id, reason: "test" }, admin, {}));
  assert.equal(result.rollback.restored.version, "2025-01-20");
  assert.equal((await jobsOf(code)).length, 0);
});
