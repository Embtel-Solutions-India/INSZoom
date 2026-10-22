// Phase 7.7 (FORM_PIPELINE_AUTONOMY on) on REAL models in a throwaway LOCAL database (src/test-utils/pipelineDb.js: never the shared database; skipped when no local MongoDB).
// Autofill is replaced by a fake that behaves like the real one where it matters (moves status to ai_filled, bumps versionNumber, pushes a version): nothing here touches
// uscis.gov, the real AutoFillService or the shared database. The existing migration-safety tests keep running unchanged in the default (off) mode.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const CaseForm = require("../../../models/CaseForm");
const Snapshot = require("../../../models/CaseFormMigrationSnapshot");
const AuditLog = require("../../../models/AuditLog");
const Migration = require("../services/CaseFormEditionMigrationService");
const R = require("../services/CaseFormMigrationRecovery");

const db = useTestDatabase({ before: test.before, after: test.after }, [USCISFormTemplate, CaseForm, Snapshot, AuditLog]);
const actor = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const on = () => "on";
const f = (fieldId, over = {}) => ({ fieldId, fieldName: fieldId, pdfFieldName: fieldId, label: fieldId, fieldType: "text", ...over });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const makeTemplates = async (oldFields, newFields, { newEdition = "2026-01-01" } = {}) => {
  const formCode = uniqueFormCode();
  const base = { formCode, title: "test", status: "active", mappingStatus: "draft" };
  const oldTemplate = await db.recorder.create(USCISFormTemplate, { ...base, version: "2025-01-01", editionDate: new Date("2025-01-01T00:00:00Z"), formFields: oldFields });
  const newTemplate = await db.recorder.create(USCISFormTemplate, { ...base, status: "review", version: newEdition, editionDate: new Date(`${newEdition}T00:00:00Z`), formFields: newFields });
  return { formCode, oldTemplate, newTemplate };
};
const makeCase = (template, over = {}) => db.recorder.create(CaseForm, { caseId: new mongoose.Types.ObjectId(), formTemplateId: template._id, formCode: template.formCode, formVersion: template.version, status: "ai_filled", ...over });
const fresh = (id) => CaseForm.findById(id).lean();
const snapshotOf = (id) => Snapshot.findOne({ caseFormId: id }).sort({ createdAt: -1 }).lean();
const canonicalState = async (id) => R.imageChecksum(R.imageOf(await fresh(id)));
const prov = (key, source = "canonical") => ({ [R.encodeKey(key)]: { source, revision: 1 } });

// autofill that does what the real one does to a migrated form: status -> ai_filled, versionNumber up, one more version; records the options it was called with
const calls = [];
const realisticAutofill = async (caseId, formCode, user, req, options = {}) => {
  calls.push({ caseId: String(caseId), ...options });
  if (!options.caseFormId) throw new Error("autofill was called without the case form id: it could regenerate another participant's form");
  await CaseForm.collection.updateOne({ _id: new mongoose.Types.ObjectId(options.caseFormId) }, { $set: { status: "ai_filled", versionNumber: 99, updatedAt: new Date() }, $push: { versions: { versionNumber: 98 } } });
};
const deps = (extra = {}) => ({ mode: on, requireAcceptedEdition: async () => {}, autofill: realisticAutofill, oldEditionNotAccepted: async () => false, ...extra });
const run = (ctx, extra = {}) => Migration.migrateCaseFormsToEdition({ newTemplate: ctx.newTemplate, actor, deps: deps(extra) });
const setOverride = (id, key, value) => CaseForm.collection.updateOne({ _id: id }, { $set: { manualOverrides: { [key]: value }, updatedAt: new Date() } });

const OLD = [f("part1.given", { label: "Given Name" }), f("part1.family", { label: "Family Name" }), f("part1.gone", { label: "Obsolete" }), f("part1.agree", { label: "Agree", fieldType: "checkbox" })];
const NEW = [f("part1.given", { label: "Given Name" }), f("part1.surname", { label: "Family Name" }), f("part1.agree", { label: "Agree", fieldType: "checkbox" })];
const typedCase = (ctx, over = {}) => makeCase(ctx.oldTemplate, {
  status: "in_review", versionNumber: 3, versions: [{ versionNumber: 2 }], reviewState: { status: "in_progress", mode: "case_manager" },
  filledData: { part1: { given: "Ana", family: "Diaz", gone: "old", agree: false } },
  fieldValues: { "part1.given": "Ana", "part1.family": "Diaz" },
  manualOverrides: { "part1.given": "Ana" },
  fieldValueProvenance: { ...prov("part1.given", "case_manager_override"), ...prov("part1.family", "case_manager_override") },
  fieldReviews: { "part1.given": { status: "approved" }, "part1.family": { status: "approved" } },
  ...over,
});

test("on: a migrated case form keeps its workflow position (status, version, history, review state); autofill is told exactly which case form and to protect answers", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  calls.length = 0;
  const ctx = await makeTemplates(OLD, NEW);
  const caseForm = await typedCase(ctx);
  const result = await run(ctx);
  assert.deepEqual([result.migrated, result.verified, result.failed.length, result.unresolved.length, result.parked.length], [1, 1, 0, 0, 0]);
  const after = await fresh(caseForm._id);
  assert.equal(after.status, "in_review", "autofill moved it to ai_filled; the migration put the person's status back");
  assert.equal(after.versionNumber, 3);
  assert.deepEqual(after.versions.map((v) => v.versionNumber), [2]);
  assert.equal(after.reviewState.status, "in_progress");
  assert.equal(after.filledData.part1.surname, "Diaz");
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].caseFormId, calls[0].preserveExisting, calls[0].regenerate], [String(caseForm._id), true, true]);
  const snapshot = await snapshotOf(caseForm._id);
  assert.equal(snapshot.proof.ok, true);
  assert.equal(after.editionMigrations[0].proofChecksum, snapshot.proof.checksum);
  assert.equal(after.editionMigrations[0].unmatchedValues.filledData["part1.gone"], "old", "a value with no box is archived, never dropped");
});

test("on: every old answer has a documented destination (the proof lists carried, archived and the rule that carried it)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(OLD, NEW);
  const caseForm = await typedCase(ctx);
  await run(ctx);
  const { proof } = await snapshotOf(caseForm._id);
  const dispositions = Object.fromEntries(proof.entries.map((entry) => [`${entry.bag}:${entry.oldKey}`, entry.disposition]));
  assert.equal(dispositions["filledData:part1.gone"], "archived");
  assert.equal(dispositions["filledData:part1.given"], "preserved");
  assert.equal(proof.unaccounted.length, 0);
  assert.equal(proof.counts.total, proof.entries.length);
});

test("on: comments / history / sync state follow the renamed box, old PDFs are marked stale (not deleted), and a restore undoes both without losing a later comment", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(OLD, NEW);
  const caseForm = await typedCase(ctx, { comments: [{ scope: "field", fieldName: "part1.family", comment: "check spelling" }], fieldHistory: [{ fieldName: "part1.family", action: "edit" }], syncState: { changedFields: ["part1.family", "part1.gone"] }, filledPdfPath: "pdf/old.pdf", generatedPdfVersions: [{ versionNumber: 1, pdfPath: "pdf/old.pdf" }] });
  await run(ctx);
  const after = await fresh(caseForm._id);
  assert.equal(after.comments[0].fieldName, "part1.surname");
  assert.equal(after.fieldHistory[0].fieldName, "part1.surname");
  assert.deepEqual(after.syncState.changedFields, ["part1.surname", "part1.gone"]);
  assert.equal(after.filledPdfPath, "pdf/old.pdf", "nothing is deleted");
  assert.equal(after.generatedPdfStale.reason, "edition_migration");
  // a comment added AFTER the migration, then the pre-image is restored
  await CaseForm.collection.updateOne({ _id: caseForm._id }, { $push: { comments: { _id: new mongoose.Types.ObjectId(), fieldName: "part1.surname", comment: "added later", scope: "field" } } });
  const snapshot = await snapshotOf(caseForm._id);
  const restored = await R.restoreCaseFormFromPreImage(snapshot._id, { dryRun: false, actor, deps: {} });
  assert.equal(restored.restored, true);
  const back = await fresh(caseForm._id);
  assert.equal(back.comments.find((c) => c.comment === "check spelling").fieldName, "part1.family", "the remapped name is put back");
  assert.equal(back.comments.find((c) => c.comment === "added later").fieldName, "part1.surname", "a later comment is kept as it is");
  assert.equal(back.generatedPdfStale, undefined);
  assert.deepEqual(back.syncState.changedFields, ["part1.family", "part1.gone"]);
});

test("on: a yes/no choice becomes the new tick box through a NAMED rule; the answer is still provable", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates([f("part1.married", { fieldType: "radio", options: ["Yes", "No"] })], [f("part1.married", { fieldType: "checkbox" })]);
  const caseForm = await makeCase(ctx.oldTemplate, { filledData: { part1: { married: "Yes" } }, fieldValues: { "part1.married": "Yes" }, fieldValueProvenance: prov("part1.married") });
  const result = await run(ctx);
  assert.equal(result.migrated, 1);
  const after = await fresh(caseForm._id);
  assert.equal(after.filledData.part1.married, true);
  assert.equal(after.fieldValues["part1.married"], true);
  const snapshot = await snapshotOf(caseForm._id);
  assert.equal(snapshot.dispositions.find((d) => d.bag === "fieldValues").rule, "choice_to_checkbox");
  assert.equal(after.editionMigrations[0].conversions.length >= 1, true);
});

test("on: a system value too long for the new box is archived with the reason; a PERSON's too long value parks the case form untouched", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates([f("part1.name")], [f("part1.name", { validation: { maxLength: 8 } })]);
  const system = await makeCase(ctx.oldTemplate, { filledData: { part1: { name: "Alexandria Montgomery" } }, fieldValues: { "part1.name": "Alexandria Montgomery" }, fieldValueProvenance: prov("part1.name") });
  const typed = await makeCase(ctx.oldTemplate, { filledData: { part1: { name: "Alexandria Montgomery" } }, fieldValues: { "part1.name": "Alexandria Montgomery" }, manualOverrides: { "part1.name": { value: "Alexandria Montgomery" } }, fieldValueProvenance: prov("part1.name", "case_manager_override") });
  const typedBefore = await canonicalState(typed._id);
  const result = await run(ctx);
  assert.equal(result.migrated, 1);
  assert.equal(result.parked.length, 1);
  assert.equal(result.parked[0].caseFormId, String(typed._id));
  const archived = await fresh(system._id);
  assert.equal(String(archived.formTemplateId), String(ctx.newTemplate._id));
  assert.equal(archived.editionMigrations[0].unmatchedValues.filledData["part1.name"], "Alexandria Montgomery", "never truncated, archived whole");
  const parked = await fresh(typed._id);
  assert.equal(String(parked.formTemplateId), String(ctx.oldTemplate._id), "the parked case form stays on its old edition");
  assert.equal(await canonicalState(typed._id), typedBefore, "and is untouched");
  assert.equal(parked.migrationState.step, "parked");
  assert.ok(parked.migrationState.parked.releaseConditions.length >= 1);
  assert.equal(JSON.stringify(parked.migrationState.parked).includes("Montgomery"), false, "no answer is copied into the park record");
  assert.equal(await snapshotOf(typed._id), null);
});

test("on: a parked case form is not re-planned in a loop - only when the matcher / rules change or somebody edits it - and then it migrates", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates([f("part1.name")], [f("part1.name", { validation: { maxLength: 8 } })]);
  const typed = await makeCase(ctx.oldTemplate, { filledData: { part1: { name: "Alexandria Montgomery" } }, fieldValues: { "part1.name": "Alexandria Montgomery" }, manualOverrides: { "part1.name": { value: "Alexandria Montgomery" } }, fieldValueProvenance: prov("part1.name", "case_manager_override") });
  await run(ctx);
  const first = (await fresh(typed._id)).migrationState.parked.parkedAt;
  await sleep(15);
  const second = await run(ctx);
  assert.equal(second.parked[0].cached, true, "the second run did not plan again");
  assert.equal(String((await fresh(typed._id)).migrationState.parked.parkedAt), String(first));
  // the matcher version changes: re-evaluated
  await CaseForm.collection.updateOne({ _id: typed._id }, { $set: { "migrationState.parked.matcherVersion": 0 } });
  await sleep(15);
  const third = await run(ctx);
  assert.equal(third.parked[0].cached, false);
  assert.notEqual(String((await fresh(typed._id)).migrationState.parked.parkedAt), String(first));
  // a person shortens the answer: it now fits and the case form migrates
  await CaseForm.collection.updateOne({ _id: typed._id }, { $set: { filledData: { part1: { name: "Alex" } }, fieldValues: { "part1.name": "Alex" }, manualOverrides: { "part1.name": { value: "Alex" } }, updatedAt: new Date() } });
  const fourth = await run(ctx);
  assert.equal(fourth.migrated, 1);
  const done = await fresh(typed._id);
  assert.equal(String(done.formTemplateId), String(ctx.newTemplate._id));
  assert.equal(done.migrationState.parked, null, "the park record is cleared");
});

const COLLIDE_OLD = [f("x1", { fieldName: "form1[0].#subform[1].Name[0]" }), f("x2", { fieldName: "form1[0].Name[0]" })];
const COLLIDE_NEW = [f("newname", { fieldName: "form1[0].Name[0]" })];
const collideCase = (ctx, values, provenance, overrides = {}) => makeCase(ctx.oldTemplate, { status: "draft", fieldValues: values, fieldValueProvenance: provenance, manualOverrides: overrides });

test("on: a person's value beats a system value on one box, and BOTH answers are kept; two different person values park; equal values merge", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(COLLIDE_OLD, COLLIDE_NEW);
  const A = "form1[0].#subform[1].Name[0]";
  const B = "form1[0].Name[0]";
  const typedOverSystem = await collideCase(ctx, { [A]: "1 Typed St", [B]: "9 System Rd" }, { ...prov(A, "case_manager_override"), ...prov(B) }, { [A]: { value: "1 Typed St" } });
  const typedVsTyped = await collideCase(ctx, { [A]: "1 Typed St", [B]: "2 Typed Ave" }, { ...prov(A, "case_manager_override"), ...prov(B, "case_manager_override") }, { [A]: { value: "1 Typed St" }, [B]: { value: "2 Typed Ave" } });
  const equal = await collideCase(ctx, { [A]: "Same", [B]: "Same" }, { ...prov(A), ...prov(B) });
  const result = await run(ctx);
  assert.equal(result.migrated, 2);
  assert.equal(result.parked.length, 1);
  const merged = await fresh(typedOverSystem._id);
  assert.equal(merged.fieldValues.newname, "1 Typed St");
  assert.equal(merged.editionMigrations[0].unmatchedValues.fieldValues[B], "9 System Rd", "the losing answer is archived, recoverable");
  const parked = await fresh(typedVsTyped._id);
  assert.equal(String(parked.formTemplateId), String(ctx.oldTemplate._id));
  assert.equal(parked.fieldValues[A], "1 Typed St");
  assert.equal(parked.fieldValues[B], "2 Typed Ave", "both person-given answers are still on the untouched case form");
  assert.equal(result.unresolved.find((item) => item.caseFormId === String(typedVsTyped._id)).policy, "two_different_person_values");
  assert.equal((await fresh(equal._id)).fieldValues.newname, "Same");
});

test("on: a person's typed value is never overwritten by autofill during migration (autofill is told to preserve it) and frozen case forms are untouched", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(OLD, NEW);
  const frozen = await typedCase(ctx, { status: "finalized" });
  const before = await canonicalState(frozen._id);
  const result = await run(ctx);
  assert.equal(result.skippedFrozen, 1);
  assert.equal(await canonicalState(frozen._id), before);
  assert.equal(result.frozenReport.length, 1);
});

test("on: a verification failure is restored once and then PARKED - it does not retry in a loop", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(OLD, NEW);
  const caseForm = await typedCase(ctx);
  const corrupting = async (caseId, formCode, user, req, options) => { await setOverride(new mongoose.Types.ObjectId(options.caseFormId), "part1.given", "CORRUPTED"); };
  const first = await run(ctx, { autofill: corrupting });
  assert.equal(first.restored, 1);
  const restored = await fresh(caseForm._id);
  assert.equal(String(restored.formTemplateId), String(ctx.oldTemplate._id), "back on the old edition");
  assert.equal(restored.manualOverrides["part1.given"], "Ana", "with the person's answer intact");
  assert.equal(restored.migrationState.step, "parked");
  const snapshots = await Snapshot.countDocuments({ caseFormId: caseForm._id });
  const second = await run(ctx, { autofill: corrupting });
  assert.deepEqual([second.restored, second.parked.length, second.parked[0].cached], [0, 1, true]);
  assert.equal(await Snapshot.countDocuments({ caseFormId: caseForm._id }), snapshots, "no new attempt was made");
});

test("on: running the same migration twice changes nothing the second time (idempotent), and nothing is left for the sweeper", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(OLD, NEW);
  const caseForm = await typedCase(ctx);
  await run(ctx);
  const once = await canonicalState(caseForm._id);
  const again = await run(ctx);
  assert.equal(again.considered, 0);
  assert.equal(await canonicalState(caseForm._id), once);
  assert.equal((await Migration.reconcileIncompleteMigrations({ deps: deps(), actor })).examined, 0);
});

test("on: a crash after the save resumes through the sweeper with the same protections", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(OLD, NEW);
  const caseForm = await typedCase(ctx);
  const first = await run(ctx, { checkpoint: async (stage) => { if (stage === "saved") throw new Error("simulated crash"); } });
  assert.equal(first.migrated, 0);
  const swept = await Migration.reconcileIncompleteMigrations({ deps: deps(), actor });
  assert.equal(swept.resumed[0].outcome, "migrated");
  const after = await fresh(caseForm._id);
  assert.equal(after.status, "in_review", "the status the person had survives a resumed run too");
  assert.equal(after.migrationState.step, "completed");
});

test("on: a person's edit during the migration is never overwritten (reconciliation, pre-image kept)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(OLD, NEW);
  const caseForm = await typedCase(ctx);
  const result = await run(ctx, { checkpoint: async (stage) => { if (stage === "autofilled") await setOverride(caseForm._id, "part1.given", "PERSON EDIT"); } });
  assert.equal(result.reconciliationRequired.length, 1);
  assert.equal((await fresh(caseForm._id)).manualOverrides["part1.given"], "PERSON EDIT");
});

test("on: paging and bounded concurrency migrate every case form once; a lost lease stops cleanly and the rest migrate on the next run", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  process.env.CASE_MIGRATION_PAGE_SIZE = "2";
  process.env.CASE_MIGRATION_CONCURRENCY = "2";
  try {
    const ctx = await makeTemplates(OLD, NEW);
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push((await typedCase(ctx))._id);
    const all = await run(ctx);
    assert.deepEqual([all.considered, all.migrated], [5, 5]);

    const ctx2 = await makeTemplates(OLD, NEW);
    for (let i = 0; i < 4; i += 1) await typedCase(ctx2);
    process.env.CASE_MIGRATION_CONCURRENCY = "1";
    let polls = 0;
    const stopped = await run(ctx2, { leaseAlive: async () => { polls += 1; return polls <= 1; } });
    assert.equal(stopped.stopped, "lease_lost");
    assert.equal(stopped.requeue, true);
    assert.equal(stopped.migrated, 1);
    const rest = await run(ctx2);
    assert.equal(rest.migrated, 3, "the remaining case forms were left untouched and migrate on the next run");
  } finally {
    delete process.env.CASE_MIGRATION_PAGE_SIZE;
    delete process.env.CASE_MIGRATION_CONCURRENCY;
  }
});

test("on: a case form that does not finish within its time budget is reported for requeue, and still ends consistent", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  process.env.CASE_MIGRATION_CASE_FORM_BUDGET_MS = "40";
  try {
    const ctx = await makeTemplates(OLD, NEW);
    const caseForm = await typedCase(ctx);
    const slow = async (caseId, formCode, user, req, options) => { await sleep(300); return realisticAutofill(caseId, formCode, user, req, options); };
    const result = await run(ctx, { autofill: slow });
    assert.equal(result.failed[0].stage, "time_budget");
    assert.equal(result.requeue, true);
    await sleep(700);
    const after = await fresh(caseForm._id);
    assert.equal(after.migrationState.step, "completed", "the slow run finished by itself; nothing was left half-way");
    assert.equal(after.status, "in_review");
  } finally {
    delete process.env.CASE_MIGRATION_CASE_FORM_BUDGET_MS;
  }
});

test("on: a case form already on a NEWER edition than the target is left alone", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates(OLD, NEW);
  const future = await db.recorder.create(USCISFormTemplate, { formCode: ctx.formCode, title: "test", status: "active", mappingStatus: "draft", version: "2027-01-01", editionDate: new Date("2027-01-01T00:00:00Z"), formFields: NEW });
  const caseForm = await makeCase(future, { filledData: { part1: { given: "Ana" } }, fieldValues: { "part1.given": "Ana" } });
  const before = await canonicalState(caseForm._id);
  const result = await run(ctx);
  assert.equal(result.skippedNewer, 1);
  assert.equal(await canonicalState(caseForm._id), before);
});

test("on: a person saving a case form that was moved to a newer edition after it loaded gets a clear 409, never a silent overwrite; off does nothing", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const Service = require("../../uscis-forms/interactive-form-review.service");
  const ctx = await makeTemplates(OLD, NEW);
  const caseForm = await typedCase(ctx);
  const loaded = await CaseForm.findById(caseForm._id); // what the save loaded
  await CaseForm.collection.updateOne({ _id: caseForm._id }, { $set: { formTemplateId: ctx.newTemplate._id } }); // the migration moved it meanwhile
  const before = process.env.FORM_PIPELINE_AUTONOMY;
  try {
    process.env.FORM_PIPELINE_AUTONOMY = "off";
    await Service.assertNotMovedByMigration(loaded);
    process.env.FORM_PIPELINE_AUTONOMY = "on";
    await assert.rejects(Service.assertNotMovedByMigration(loaded), (error) => error.statusCode === 409 && error.details.code === "FORM_MIGRATED_RELOAD");
    const reloaded = await CaseForm.findById(caseForm._id);
    await Service.assertNotMovedByMigration(reloaded); // a save that loaded AFTER the move is fine
  } finally {
    if (before === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = before;
  }
});

test("off and shadow behave exactly as before: nothing new is written, shadow only logs", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  for (const mode of ["off", "shadow"]) {
    const ctx = await makeTemplates(OLD, NEW);
    const caseForm = await typedCase(ctx, { manualOverrides: { "part1.given": "Ana" } });
    const result = await Migration.migrateCaseFormsToEdition({ newTemplate: ctx.newTemplate, actor, deps: { mode: () => mode, requireAcceptedEdition: async () => {}, autofill: async () => {}, oldEditionNotAccepted: async () => false } });
    assert.equal(result.migrated, 1, mode);
    assert.equal("parked" in result, false, `${mode}: no new result keys`);
    const after = await fresh(caseForm._id);
    assert.equal(after.generatedPdfStale, undefined);
    assert.equal(after.migrationState.expected, undefined);
    assert.equal((await snapshotOf(caseForm._id)).proof, undefined);
  }
});
