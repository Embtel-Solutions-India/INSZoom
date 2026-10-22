// Safe case migration (plan Rule G) on REAL models in a throwaway LOCAL database (src/test-utils/pipelineDb.js: never the shared database; skipped when no local MongoDB).
// Autofill is replaced by a fake (deps.autofill) and the edition gate by a stub: nothing here calls uscis.gov, the AutoFillService or the real database.
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
const { FROZEN_CASE_FORM_STATUSES } = require("../config/caseFormFreeze");

const db = useTestDatabase({ before: test.before, after: test.after }, [USCISFormTemplate, CaseForm, Snapshot, AuditLog]);
const actor = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const DAY = 24 * 60 * 60 * 1000;

const f = (fieldId, over = {}) => ({ fieldId, fieldName: fieldId, pdfFieldName: fieldId, label: fieldId, fieldType: "text", ...over });
const OLD_FIELDS = [f("part1.given", { label: "Given Name" }), f("part1.family", { label: "Family Name" }), f("part1.gone", { label: "Obsolete Box" }), f("part1.agree", { label: "Agree", fieldType: "checkbox" })];
const NEW_FIELDS = [f("part1.given", { label: "Given Name" }), f("part1.surname", { label: "Family Name" }), f("part1.agree", { label: "Agree", fieldType: "checkbox" })];

const makeTemplates = async (oldFields = OLD_FIELDS, newFields = NEW_FIELDS) => {
  const formCode = uniqueFormCode();
  const base = { formCode, title: "test", status: "active", mappingStatus: "draft" };
  const oldTemplate = await db.recorder.create(USCISFormTemplate, { ...base, version: "2025-01-01", editionDate: new Date("2025-01-01T00:00:00Z"), formFields: oldFields });
  const newTemplate = await db.recorder.create(USCISFormTemplate, { ...base, status: "review", version: "2026-01-01", editionDate: new Date("2026-01-01T00:00:00Z"), formFields: newFields });
  return { formCode, oldTemplate, newTemplate };
};
const makeCase = (template, over = {}) => db.recorder.create(CaseForm, {
  caseId: new mongoose.Types.ObjectId(), formTemplateId: template._id, formCode: template.formCode, formVersion: template.version, status: "ai_filled",
  filledData: { part1: { given: "Ana", family: "Diaz", gone: "old", agree: false } },
  fieldValues: { "part1.given": "Ana", "part1.family": "Diaz" },
  manualOverrides: { "part1.given": "Ana" },
  fieldValueProvenance: { [R.encodeKey("part1.given")]: { source: "case_manager_override", revision: 1 }, [R.encodeKey("part1.family")]: { source: "case_manager_override", revision: 2 } },
  fieldReviews: { "part1.given": { status: "approved" }, "part1.family": { status: "approved" } },
  manualOverridesNote: undefined,
  ...over,
});
const fresh = (id) => CaseForm.findById(id).lean();
const snapshotOf = (id) => Snapshot.findOne({ caseFormId: id }).sort({ createdAt: -1 }).lean();
const noop = async () => {};
const baseDeps = (extra = {}) => ({ requireAcceptedEdition: noop, autofill: noop, oldEditionNotAccepted: async () => false, ...extra });
const run = (ctx, extra = {}) => Migration.migrateCaseFormsToEdition({ newTemplate: ctx.newTemplate, actor, deps: baseDeps(extra) });
const touch = (id, set = { lastModifiedAt: new Date() }) => CaseForm.updateOne({ _id: id }, { $set: set });
// replaces the whole flat manualOverrides map (its keys are dotted field ids) the way the real code stores it, and moves updatedAt like any real edit
const setOverride = (filter, value) => CaseForm.collection.updateOne(filter, { $set: { manualOverrides: { "part1.given": value }, updatedAt: new Date() } });

test("a migration stores a checksummed pre-image, moves the case form with every record accounted for, verifies it from the database and starts the 90-day clock", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  const before = R.imageOf(await fresh(caseForm._id));
  const result = await run(ctx);
  assert.deepEqual([result.considered, result.migrated, result.verified, result.failed.length, result.unresolved.length, result.reconciliationRequired.length, result.dryRun], [1, 1, 1, 0, 0, 0, false]);
  const after = await fresh(caseForm._id);
  assert.equal(String(after.formTemplateId), String(ctx.newTemplate._id));
  assert.equal(after.formVersion, "2026-01-01");
  assert.equal(after.filledData.part1.surname, "Diaz", "the renamed box carries its value");
  assert.equal(after.filledData.part1.agree, false, "a false is an answer and is kept");
  assert.equal(after.editionMigrations[0].unmatchedValues.filledData["part1.gone"], "old", "a value with no box is archived with its old key, never dropped");
  assert.equal(after.migrationState.step, "completed");
  assert.equal(after.migrationState.outcome, "migrated");
  const snapshot = await snapshotOf(caseForm._id);
  assert.equal(R.imageChecksum(snapshot.preImage), snapshot.checksum, "the pre-image is checksummed");
  assert.equal(R.imageChecksum(snapshot.preImage), R.imageChecksum(before), "and it is exactly the case form as it was");
  assert.equal(snapshot.preImage.answers.filledData.part1.gone, "old");
  assert.ok(snapshot.dispositions.length >= 6);
  const days = (new Date(snapshot.expiresAt).getTime() - Date.now()) / DAY;
  assert.ok(days > 89 && days <= 90.01, `expiresAt is verified completion + 90 days (got ${days})`);
  assert.equal(after.editionMigrations[0].migrationJobId, snapshot.migrationJobId);
  assert.equal(result.valuesCarried + result.valuesArchived > 0, true);
});

test("two old records with different values on one box block ONLY that case; equal values merge with a recorded reason", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const formCode = uniqueFormCode();
  const base = { formCode, title: "test", status: "active", mappingStatus: "draft" };
  const oldTemplate = await db.recorder.create(USCISFormTemplate, { ...base, version: "2025-01-01", editionDate: new Date("2025-01-01T00:00:00Z"), formFields: [f("x1", { fieldName: "form1[0].#subform[1].Name[0]" }), f("x2", { fieldName: "form1[0].Name[0]" })] });
  const newTemplate = await db.recorder.create(USCISFormTemplate, { ...base, status: "review", version: "2026-01-01", editionDate: new Date("2026-01-01T00:00:00Z"), formFields: [f("newname", { fieldName: "form1[0].Name[0]" })] });
  const collide = await db.recorder.create(CaseForm, { caseId: new mongoose.Types.ObjectId(), formTemplateId: oldTemplate._id, formCode, formVersion: "2025-01-01", status: "draft", fieldValues: { "form1[0].#subform[1].Name[0]": "X", "form1[0].Name[0]": "Y" } });
  const merge = await db.recorder.create(CaseForm, { caseId: new mongoose.Types.ObjectId(), formTemplateId: oldTemplate._id, formCode, formVersion: "2025-01-01", status: "draft", fieldValues: { "form1[0].#subform[1].Name[0]": "X", "form1[0].Name[0]": "X" } });
  const collideBefore = R.imageChecksum(R.imageOf(await fresh(collide._id)));
  const result = await Migration.migrateCaseFormsToEdition({ newTemplate, actor, deps: baseDeps() });
  assert.equal(result.migrated, 1);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].code, "COLLISION");
  assert.equal(String(result.unresolved[0].caseFormId), String(collide._id));
  const blocked = await fresh(collide._id);
  assert.equal(String(blocked.formTemplateId), String(oldTemplate._id), "the blocked case stays on its old edition");
  assert.equal(R.imageChecksum(R.imageOf(blocked)), collideBefore, "and is untouched");
  assert.equal(blocked.migrationState, undefined);
  assert.equal(await snapshotOf(collide._id), null, "no snapshot is made for a case that is not touched");
  const merged = await fresh(merge._id);
  assert.equal(String(merged.formTemplateId), String(newTemplate._id));
  assert.equal(merged.fieldValues.newname, "X");
  assert.equal(merged.editionMigrations[0].mergedCollisions.length, 1);
  assert.equal((await snapshotOf(merge._id)).dispositions.some((item) => item.reason === "equal_value_collision_merge"), true);
});

test("a false a person set survives autofill blanking it; a false the system derived is not forced back", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate, {
    filledData: { part1: { agree: false, given: "typed text", gone: "x" } },
    fieldValues: {}, manualOverrides: { "part1.agree": false, "part1.given": "typed text" },
    fieldValueProvenance: { [R.encodeKey("part1.given")]: { source: "case_manager_override" } }, fieldReviews: {},
  });
  const other = await makeCase(ctx.oldTemplate, { filledData: { part1: { agree: false } }, fieldValues: {}, manualOverrides: {}, fieldValueProvenance: { [R.encodeKey("part1.agree")]: { source: "canonical" } }, fieldReviews: {} });
  // autofill blanks both checkbox values and the typed text
  const autofill = async (caseId, formCode) => {
    await CaseForm.updateOne({ caseId, formCode }, { $unset: { "filledData.part1.agree": "", "filledData.part1.given": "" } });
  };
  const result = await run(ctx, { autofill });
  assert.equal(result.migrated, 2);
  const typed = await fresh(caseForm._id);
  assert.equal(typed.filledData.part1.agree, false, "a typed false is an answer and is put back");
  assert.equal(typed.filledData.part1.given, "typed text");
  const derived = await fresh(other._id);
  assert.equal(derived.filledData.part1.agree, undefined, "a false the system itself derived is a non-answer: autofill owns it");
  assert.ok(result.valuesRestoredAfterAutofill >= 2);
});

test("provenance, review and override metadata follow a renamed box", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  const result = await run(ctx);
  assert.equal(result.migrated, 1);
  const after = await fresh(caseForm._id);
  assert.equal(after.fieldValueProvenance[R.encodeKey("part1.surname")].source, "case_manager_override");
  assert.equal(after.fieldValueProvenance[R.encodeKey("part1.surname")].revision, 2);
  assert.equal(after.fieldReviews["part1.surname"].status, "approved");
  assert.equal(after.fieldReviews["part1.family"], undefined, "the old key is gone from the live records");
  assert.equal(after.fieldValues["part1.surname"], "Diaz");
});

test("a crash AFTER the save and BEFORE autofill resumes to completed through the sweeper", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  const crash = async (stage) => { if (stage === "saved") throw new Error("simulated crash after the save"); };
  const first = await run(ctx, { checkpoint: crash });
  assert.equal(first.migrated, 0);
  const stuck = await fresh(caseForm._id);
  assert.equal(String(stuck.formTemplateId), String(ctx.newTemplate._id), "the new edition was saved");
  assert.equal(stuck.migrationState.step, "saved");
  let autofillRuns = 0;
  const swept = await Migration.reconcileIncompleteMigrations({ deps: baseDeps({ autofill: async () => { autofillRuns += 1; } }), actor });
  assert.equal(swept.resumed.length, 1);
  assert.equal(swept.resumed[0].outcome, "migrated");
  assert.equal(autofillRuns, 1, "the resumed run did the step that never ran");
  const done = await fresh(caseForm._id);
  assert.equal(done.migrationState.step, "completed");
  assert.ok((await snapshotOf(caseForm._id)).expiresAt);
  assert.equal((await Migration.reconcileIncompleteMigrations({ deps: baseDeps(), actor })).examined, 0, "idempotent: nothing left to resume");
});

test("a crash AFTER autofill and BEFORE verification resumes to completed through the sweeper", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  const crash = async (stage) => { if (stage === "autofilled") throw new Error("simulated crash before verification"); };
  await run(ctx, { checkpoint: crash });
  assert.equal((await fresh(caseForm._id)).migrationState.step, "autofilled");
  const swept = await Migration.reconcileIncompleteMigrations({ deps: baseDeps(), actor });
  assert.equal(swept.resumed[0].outcome, "migrated");
  assert.equal((await fresh(caseForm._id)).migrationState.step, "completed");
});

test("a crash right after the snapshot, before anything was written, releases the snapshot and a later run migrates from scratch", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  const crash = async (stage) => { if (stage === "snapshotted") throw new Error("simulated crash"); };
  await run(ctx, { checkpoint: crash });
  assert.equal((await fresh(caseForm._id)).migrationState.step, "snapshotted");
  const swept = await Migration.reconcileIncompleteMigrations({ deps: baseDeps(), actor });
  assert.deepEqual(swept.released, [String(caseForm._id)]);
  assert.equal((await fresh(caseForm._id)).migrationState, undefined);
  assert.equal((await Snapshot.findOne({ caseFormId: caseForm._id }).lean()).state, "released");
  assert.equal((await run(ctx)).migrated, 1);
});

test("a failed verification with NO newer edits restores the case form to canonical-state equality with its pre-image, and a second restore is a no-op", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  const before = R.imageChecksum(R.imageOf(await fresh(caseForm._id)));
  // "autofill" damages a value a person typed: verification must catch it
  const autofill = async (caseId, formCode) => { await setOverride({ caseId, formCode }, "DAMAGED"); };
  const result = await run(ctx, { autofill });
  assert.equal(result.migrated, 0);
  assert.equal(result.restored, 1);
  assert.equal(result.failed.some((item) => item.stage === "verify"), true);
  const after = await fresh(caseForm._id);
  assert.equal(R.imageChecksum(R.imageOf(after)), before, "canonical state equals the pre-image again");
  assert.equal(String(after.formTemplateId), String(ctx.oldTemplate._id));
  assert.equal((after.editionMigrations || []).length, 0, "this migration's archive entry was removed with it");
  assert.equal(after.migrationState.outcome, "restored");
  assert.equal(after.auditHistory.some((item) => item.action === "EDITION_MIGRATION_RESTORED"), true, "the restore is audited");
  const snapshot = await snapshotOf(caseForm._id);
  assert.ok(snapshot.expiresAt, "resolved, so the retention clock runs");
  const again = await R.restoreCaseFormFromPreImage(snapshot._id, { dryRun: false, actor, deps: {} });
  assert.deepEqual([again.restored, again.alreadyRestored], [false, true]);
  assert.equal(R.imageChecksum(R.imageOf(await fresh(caseForm._id))), before);
});

test("a person's newer edit is NEVER overwritten: no restore, reconciliation_required, the pre-image kept without expiry, the conflict listed", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  // right after the migration's own writes a person changes a typed value - which also makes the verification fail
  const personEdits = async (stage) => { if (stage === "autofilled") await setOverride({ _id: caseForm._id }, "PERSON EDIT"); };
  const result = await run(ctx, { checkpoint: personEdits });
  assert.equal(result.migrated, 0);
  assert.equal(result.reconciliationRequired.length, 1);
  assert.equal(result.reconciliationRequired[0].changes.some((item) => /manualOverrides/.test(item.path)), true, "the changed field is listed");
  const after = await fresh(caseForm._id);
  assert.equal(after.manualOverrides["part1.given"], "PERSON EDIT", "the person's edit is still there");
  assert.equal(String(after.formTemplateId), String(ctx.newTemplate._id), "not rolled back over their edit");
  assert.equal(after.migrationState.step, "reconciliation_required");
  const snapshot = await snapshotOf(caseForm._id);
  assert.equal(snapshot.expiresAt, undefined, "kept without expiry");
  assert.equal(snapshot.state, "active");
  const refused = await R.restoreCaseFormFromPreImage(snapshot._id, { dryRun: false, actor, deps: {} });
  assert.equal(refused.restored, false);
  assert.equal(refused.reconciliationRequired, true);
  assert.equal((await fresh(caseForm._id)).manualOverrides["part1.given"], "PERSON EDIT", "an explicit restore does not overwrite it either");
});

test("a person editing between the read and the write: re-read and re-plan once; if it happens again the case is left alone", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const once = await makeCase(ctx.oldTemplate);
  let hits = 0;
  const editOnce = async (stage) => { if (stage === "planned" && hits === 0) { hits += 1; await touch(once._id); } };
  assert.equal((await run(ctx, { checkpoint: editOnce })).migrated, 1, "one concurrent edit: the second attempt succeeds");
  assert.equal((await Snapshot.find({ caseFormId: once._id }).lean()).filter((item) => item.state === "released").length, 1);

  const ctx2 = await makeTemplates();
  const always = await makeCase(ctx2.oldTemplate);
  const editAlways = async (stage) => { if (stage === "planned") await touch(always._id); };
  const result = await run(ctx2, { checkpoint: editAlways });
  assert.equal(result.migrated, 0);
  assert.equal(result.failed[0].stage, "concurrent_edit");
  const left = await fresh(always._id);
  assert.equal(String(left.formTemplateId), String(ctx2.oldTemplate._id), "left on its old edition");
  assert.equal(left.migrationState, undefined);
});

test("a tampered snapshot refuses to restore anything", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  await run(ctx);
  const snapshot = await snapshotOf(caseForm._id);
  await Snapshot.collection.updateOne({ _id: snapshot._id }, { $set: { "preImage.answers.filledData.part1.given": "TAMPERED" } });
  const live = R.imageChecksum(R.imageOf(await fresh(caseForm._id)));
  const refused = await R.restoreCaseFormFromPreImage(snapshot._id, { dryRun: false, actor, deps: {} });
  assert.equal(refused.refused, "SNAPSHOT_CHECKSUM_MISMATCH");
  assert.equal(R.imageChecksum(R.imageOf(await fresh(caseForm._id))), live, "the case form is untouched");
});

test("every frozen status and an explicit lock are skipped, left exactly as they were, and listed in the frozen report", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const frozen = [];
  for (const status of FROZEN_CASE_FORM_STATUSES) {
    const caseForm = await makeCase(ctx.oldTemplate, { status: status === "receipt_received" ? "pending" : status });
    if (status === "receipt_received") await CaseForm.collection.updateOne({ _id: caseForm._id }, { $set: { status: "receipt_received" } }); // not a valid enum value; kept defensively in the frozen list
    frozen.push(caseForm._id);
  }
  frozen.push((await makeCase(ctx.oldTemplate, { status: "draft", isLocked: true }))._id);
  const open = await makeCase(ctx.oldTemplate, { status: "draft" });
  const before = await Promise.all(frozen.map(async (id) => R.imageChecksum(R.imageOf(await fresh(id)))));
  const result = await run(ctx);
  assert.equal(result.skippedFrozen, FROZEN_CASE_FORM_STATUSES.length + 1);
  assert.equal(result.frozenReport.length, FROZEN_CASE_FORM_STATUSES.length + 1);
  assert.deepEqual([...new Set(result.frozenReport.map((item) => item.status))].sort(), [...new Set([...FROZEN_CASE_FORM_STATUSES, "draft"])].sort());
  assert.ok(result.frozenReport.every((item) => item.fromEdition === "2025-01-01" && item.toEdition === "2026-01-01" && item.priority === false));
  assert.equal(result.migrated, 1);
  const after = await Promise.all(frozen.map(async (id) => R.imageChecksum(R.imageOf(await fresh(id)))));
  assert.deepEqual(after, before);
  assert.equal(String((await fresh(open._id)).formTemplateId), String(ctx.newTemplate._id));
  assert.equal((await Migration.frozenReconciliationReport(ctx.newTemplate, { deps: baseDeps() })).length, FROZEN_CASE_FORM_STATUSES.length + 1);
});

test("the dry run writes nothing and reports what a migration would do", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const good = await makeCase(ctx.oldTemplate);
  const blocked = await makeCase(ctx.oldTemplate, { filledData: { part1: { gone: "typed" } }, manualOverrides: { "part1.gone": "typed" }, fieldValues: {}, fieldValueProvenance: {}, fieldReviews: {} });
  const approved = await makeCase(ctx.oldTemplate, { status: "approved" });
  const snapshotsBefore = await Snapshot.countDocuments({});
  const stamp = async (id) => { const doc = await fresh(id); return `${doc.updatedAt.getTime()}|${R.imageChecksum(R.imageOf(doc))}|${JSON.stringify(doc.migrationState || null)}`; };
  const before = await Promise.all([good, blocked, approved].map((item) => stamp(item._id)));
  const report = await Migration.planMigration({ newTemplate: ctx.newTemplate, deps: baseDeps() });
  assert.equal(report.dryRun, true);
  assert.equal(report.considered, 3);
  assert.deepEqual(report.byStatus, { ai_filled: 2, approved: 1 });
  assert.equal(report.frozen.count, 1);
  assert.equal(report.frozen.report[0].status, "approved");
  assert.equal(report.wouldMigrate, 1);
  assert.equal(report.blocked, 1);
  assert.equal(report.unresolved[0].code, "NO_COUNTERPART_FOR_PROTECTED_VALUE");
  assert.ok(report.archivedValues >= 1);
  assert.equal(report.fieldDiff[0].fromEdition, "2025-01-01");
  assert.equal(report.fieldDiff[0].summary.renamed, 1);
  assert.ok(report.provenanceCoverage.perForm.length >= 2);
  assert.equal(report.protectedValuesAffected.manualOverrides >= 1, true);
  assert.deepEqual(await Promise.all([good, blocked, approved].map((item) => stamp(item._id))), before, "no case form changed");
  assert.equal(await Snapshot.countDocuments({}), snapshotsBefore, "no snapshot was written");
});

test("the snapshot clock never runs while a migration waits for a decision, and a held snapshot is never given an expiry", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  await run(ctx);
  const snapshot = await snapshotOf(caseForm._id);
  assert.ok(snapshot.expiresAt);
  await R.clearSnapshotExpiry({}, snapshot._id);
  await Snapshot.updateOne({ _id: snapshot._id }, { $set: { legalHold: true } });
  assert.equal(await R.setSnapshotExpiry({}, snapshot._id), null, "a legal hold keeps it without expiry");
  assert.equal((await Snapshot.findById(snapshot._id).lean()).expiresAt, undefined);
});

test("a migration already under way is left to the sweeper, not started a second time", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const ctx = await makeTemplates();
  const caseForm = await makeCase(ctx.oldTemplate);
  await CaseForm.collection.updateOne({ _id: caseForm._id }, { $set: { "migrationState.step": "snapshotted" } });
  const result = await run(ctx);
  assert.equal(result.inProgress, 1);
  assert.equal(result.migrated, 0);
  assert.equal(String((await fresh(caseForm._id)).formTemplateId), String(ctx.oldTemplate._id));
});
