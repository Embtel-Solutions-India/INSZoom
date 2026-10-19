// Case Manager-controlled form selection: the decision rules (pure) and the real creation path (local test database only - test-utils/db.js connects to
// mongodb://localhost:27017/immigrationcrm_test unless MONGODB_TEST_URI says otherwise; it never uses the application's database).
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const selection = require("../case-form-selection.service");

const row = (formCode, decision, componentCode = null) => ({ formCode, decision, componentCode });

// ── pure rules ──────────────────────────────────────────────────────────────
test("legacy case: allowed unless explicitly excluded; a missing row is never an exclusion", () => {
  assert.deepEqual(selection.decide({ formSelectionMode: "legacy" }, [], { formCode: "I-129" }), { allowed: true, reason: null });
  assert.deepEqual(selection.decide({ formSelectionMode: "legacy" }, [row("I-129", "exclude")], { formCode: "I-129" }), { allowed: false, reason: "excluded" });
  assert.equal(selection.decide({ formSelectionMode: "legacy" }, [row("I-129", "exclude")], { formCode: "I-765" }).allowed, true, "an exclusion is per form");
  assert.equal(selection.decide({}, [], { formCode: "I-129" }).allowed, true, "a case with no mode set behaves as legacy");
});

test("manual case: only included forms; exclude still wins; include overrides nothing that was excluded", () => {
  const manual = { formSelectionMode: "manual" };
  assert.deepEqual(selection.decide(manual, [], { formCode: "I-129" }), { allowed: false, reason: "not_selected" });
  assert.equal(selection.decide(manual, [row("I-129", "include")], { formCode: "I-129" }).allowed, true);
  assert.equal(selection.decide(manual, [row("I-129", "include")], { formCode: "I-765" }).allowed, false);
  assert.equal(selection.decide(manual, [row("I-129", "exclude")], { formCode: "I-129" }).reason, "excluded");
});

test("component: needs its own include in manual mode; an excluded parent excludes it unless it was explicitly included", () => {
  const component = { formCode: "I129_H", componentCode: "I129_H", parentFormCode: "I-129" };
  const manual = { formSelectionMode: "manual" };
  assert.equal(selection.decide(manual, [row("I-129", "include")], component).allowed, false, "the parent being selected does not select its components");
  assert.equal(selection.decide(manual, [row("I-129", "include"), row("I129_H", "include", "I129_H")], component).allowed, true);
  assert.equal(selection.decide({ formSelectionMode: "legacy" }, [row("I-129", "exclude")], component).reason, "excluded");
  assert.equal(selection.decide({ formSelectionMode: "legacy" }, [row("I-129", "exclude"), row("I129_H", "include", "I129_H")], component).allowed, true);
});

test("codes are compared case-insensitively and a template identifies its component", () => {
  assert.equal(selection.decide({ formSelectionMode: "legacy" }, [row("i-129", "exclude")], { formCode: "I-129" }).allowed, false);
  assert.deepEqual(selection.identityOfTemplate({ formCode: "i129_h", _componentInfo: { componentCode: "I129_H", parentFormCode: "i-129" } }), { formCode: "I129_H", componentCode: "I129_H", parentFormCode: "I-129" });
  assert.deepEqual(selection.identityOfTemplate({ formCode: "I-765" }), { formCode: "I-765", componentCode: null, parentFormCode: null });
});

test("a case no one ever touched skips the selection lookup; a partially loaded case document is checked", () => {
  assert.equal(selection.mayHaveSelections({ formSelectionMode: "legacy", formSelectionRevision: 0 }), false);
  assert.equal(selection.mayHaveSelections({ formSelectionMode: "legacy", formSelectionRevision: 3 }), true);
  assert.equal(selection.mayHaveSelections({ formSelectionMode: "manual", formSelectionRevision: 0 }), true);
  assert.equal(selection.mayHaveSelections({}), true);
});

// ── the real creation path (local test database) ────────────────────────────
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const CaseFormSelection = require("../../../models/CaseFormSelection");
const uscisFormService = require("../uscis-form.service");

const fakeTemplate = (formCode) => ({ _id: new mongoose.Types.ObjectId(), formCode, formNumber: formCode, version: "2099-01-01", editionDate: new Date("2099-01-01"), status: "active" });
const actor = () => ({ _id: new mongoose.Types.ObjectId(), role: "super_admin" });
const created = { caseIds: [] };

async function makeCase(extra = {}) {
  const caseData = await Case.create({ caseNumber: `TEST-CFS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, visaType: "EB1A", ...extra });
  created.caseIds.push(caseData._id);
  return caseData;
}
const formsOf = (caseData) => CaseForm.find({ caseId: caseData._id }).lean();

test("DB: creation path honors exclusions and manual mode; repeated calls are idempotent", async (t) => {
  t.after(async () => {
    await CaseForm.deleteMany({ caseId: { $in: created.caseIds } });
    await CaseFormSelection.deleteMany({ caseId: { $in: created.caseIds } });
    await Case.deleteMany({ _id: { $in: created.caseIds } });
    await disconnectTestDB();
  });
  await connectTestDB();
  const user = actor();
  const a = fakeTemplate("ZZ-TEST-A");
  const b = fakeTemplate("ZZ-TEST-B");

  // legacy, untouched case: unchanged behavior, twice = once
  const legacy = await makeCase();
  assert.equal((await uscisFormService.ensureAssignedForms(legacy, user, null, { templates: [a, b] })).length, 2);
  assert.equal((await uscisFormService.ensureAssignedForms(legacy, user, null, { templates: [a, b] })).length, 0, "idempotent");
  assert.equal((await formsOf(legacy)).length, 2);

  // legacy case with an explicit exclusion: that form is never created, the other still is
  const excluding = await makeCase();
  await CaseFormSelection.create({ caseId: excluding._id, formCode: "ZZ-TEST-A", componentCode: null, decision: "exclude", decidedBy: user._id });
  await Case.updateOne({ _id: excluding._id }, { $set: { formSelectionRevision: 1 } });
  const excludingFresh = await Case.findById(excluding._id);
  const madeExcluding = await uscisFormService.ensureAssignedForms(excludingFresh, user, null, { templates: [a, b] });
  assert.deepEqual(madeExcluding.map((form) => form.formCode), ["ZZ-TEST-B"]);
  assert.deepEqual((await formsOf(excluding)).map((form) => form.formCode), ["ZZ-TEST-B"]);

  // manual case: only what was included
  const manual = await makeCase({ formSelectionMode: "manual", formSelectionRevision: 1 });
  await CaseFormSelection.create({ caseId: manual._id, formCode: "ZZ-TEST-B", componentCode: null, decision: "include", decidedBy: user._id });
  const madeManual = await uscisFormService.ensureAssignedForms(await Case.findById(manual._id), user, null, { templates: [a, b] });
  assert.deepEqual(madeManual.map((form) => form.formCode), ["ZZ-TEST-B"]);

  // an empty manual selection creates nothing and does not fail
  const empty = await makeCase({ formSelectionMode: "manual", formSelectionRevision: 1 });
  assert.deepEqual(await uscisFormService.ensureAssignedForms(await Case.findById(empty._id), user, null, { templates: [a, b] }), []);
});

test("DB: single-form creators refuse a form the case excludes; an explicit Add records the include and lifts the exclusion", async (t) => {
  t.after(async () => {
    await CaseForm.deleteMany({ caseId: { $in: created.caseIds } });
    await CaseFormSelection.deleteMany({ caseId: { $in: created.caseIds } });
    await Case.deleteMany({ _id: { $in: created.caseIds } });
    await disconnectTestDB();
  });
  await connectTestDB();
  const user = actor();
  const caseData = await makeCase({ formSelectionRevision: 1 });
  await CaseFormSelection.create({ caseId: caseData._id, formCode: "ZZ-TEST-C", componentCode: null, decision: "exclude", decidedBy: user._id });

  await assert.rejects(() => selection.assertFormAllowed(caseData, { formCode: "ZZ-TEST-C" }), (error) => error.code === "FORM_EXCLUDED_FOR_CASE" && error.status === 409);
  await selection.assertFormAllowed(caseData, { formCode: "ZZ-TEST-OTHER" }); // not excluded: fine

  const stored = await selection.recordExplicitInclude(caseData, { formCode: "ZZ-TEST-C" }, user, "Added again");
  assert.equal(stored.decision, "include");
  assert.equal(stored.history.at(-1).action, "restore");
  await selection.assertFormAllowed(await Case.findById(caseData._id), { formCode: "ZZ-TEST-C" });
  assert.equal(await CaseFormSelection.countDocuments({ caseId: caseData._id, formCode: "ZZ-TEST-C" }), 1, "still exactly one row");

  // an untouched legacy case: an explicit Add records nothing (no behavior change)
  const untouched = await makeCase();
  assert.equal(await selection.recordExplicitInclude(untouched, { formCode: "ZZ-TEST-D" }, user), null);
  assert.equal(await CaseFormSelection.countDocuments({ caseId: untouched._id }), 0);
});

test("DB: the manual baseline keeps every existing form, skips archived ones, and is safe to repeat", async (t) => {
  t.after(async () => {
    await CaseForm.deleteMany({ caseId: { $in: created.caseIds } });
    await CaseFormSelection.deleteMany({ caseId: { $in: created.caseIds } });
    await Case.deleteMany({ _id: { $in: created.caseIds } });
    await disconnectTestDB();
  });
  await connectTestDB();
  const user = actor();
  const caseData = await makeCase();
  await uscisFormService.ensureAssignedForms(caseData, user, null, { templates: [fakeTemplate("ZZ-TEST-E"), fakeTemplate("ZZ-TEST-F")] });
  await CaseForm.updateOne({ caseId: caseData._id, formCode: "ZZ-TEST-F" }, { $set: { status: "archived" } });

  const first = await selection.ensureManualBaseline(await Case.findById(caseData._id), user);
  assert.equal(first.switched, true);
  assert.equal(first.baselineForms, 1);
  const rows = await CaseFormSelection.find({ caseId: caseData._id }).lean();
  assert.deepEqual(rows.map((r) => `${r.formCode}:${r.decision}`), ["ZZ-TEST-E:include"]);
  const fresh = await Case.findById(caseData._id).lean();
  assert.equal(fresh.formSelectionMode, "manual");
  assert.equal(fresh.formSelectionRevision, 1);
  assert.equal((await formsOf(caseData)).length, 2, "no CaseForm was deleted or changed");

  const second = await selection.ensureManualBaseline(await Case.findById(caseData._id), user);
  assert.equal(second.switched, false);
  assert.equal(await CaseFormSelection.countDocuments({ caseId: caseData._id }), 1, "repeating adds nothing");
});

// ── Phase 2: removed (archived) forms no longer count; a waived required form is "waived", not "missing" ───────────
const CaseLifecycleOrchestrator = require("../../cases/case-lifecycle-orchestrator.service");
const PetitionValidationService = require("../../petition/services/PetitionValidationService");

test("petition validation: a waived required form is a warning, an unwaived missing one is still an error", async () => {
  const definition = { requiredForms: [{ formCode: "I-129", required: true }] };
  const waived = await PetitionValidationService.validate({ caseId: new mongoose.Types.ObjectId(), definition, caseForms: [], waivedFormCodes: ["i-129"] });
  assert.ok(waived.issues.some((issue) => issue.code === "FORM_WAIVED" && issue.severity === "warning"));
  assert.ok(!waived.issues.some((issue) => issue.code === "FORM_NOT_FOUND"));
  const missing = await PetitionValidationService.validate({ caseId: new mongoose.Types.ObjectId(), definition, caseForms: [] });
  assert.ok(missing.issues.some((issue) => issue.code === "FORM_NOT_FOUND" && issue.severity === "error"));
});

test("DB: an archived (removed) form does not block 'forms generated'; the active ones decide", async (t) => {
  t.after(async () => {
    await CaseForm.deleteMany({ caseId: { $in: created.caseIds } });
    await Case.deleteMany({ _id: { $in: created.caseIds } });
    await disconnectTestDB();
  });
  await connectTestDB();
  const user = actor();
  const caseData = await makeCase();
  await uscisFormService.ensureAssignedForms(caseData, user, null, { templates: [fakeTemplate("ZZ-TEST-G"), fakeTemplate("ZZ-TEST-H")] });
  await CaseForm.updateOne({ caseId: caseData._id, formCode: "ZZ-TEST-G" }, { $set: { status: "ai_filled" } });
  await CaseForm.updateOne({ caseId: caseData._id, formCode: "ZZ-TEST-H" }, { $set: { status: "pending" } });
  assert.equal((await CaseLifecycleOrchestrator.metrics(await Case.findById(caseData._id))).formsGenerated, false, "a pending form still holds it back");
  await CaseForm.updateOne({ caseId: caseData._id, formCode: "ZZ-TEST-H" }, { $set: { status: "archived" } });
  assert.equal((await CaseLifecycleOrchestrator.metrics(await Case.findById(caseData._id))).formsGenerated, true, "once that form is removed it no longer blocks");
});
