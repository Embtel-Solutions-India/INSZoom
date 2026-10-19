// Smoke / matrix test: ANY catalogue form can be added to a case of ANY visa type, and ANY checklist can be linked to it. Local isolated test database only
// (test-utils/db.js). Only this file's own cases, forms and selections are created and removed; templates, registry rows and checklists are only read.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const CaseFormSelection = require("../../../models/CaseFormSelection");
const Questionnaire = require("../../../models/Questionnaire");
const catalog = require("../case-form-catalog.service");
const manager = require("../case-form-selection-manager.service");
const selection = require("../case-form-selection.service");

const VISA_TYPES = ["H-1B", "L-1A", "O-1A", "EB-1A", "F-1", "K-1", "TN", "Naturalization"];
const user = { _id: new mongoose.Types.ObjectId(), role: "super_admin" };
const fakeReq = { ip: "127.0.0.1", headers: { "user-agent": "smoke-test" } };
const created = [];

async function makeCase(visaType) {
  const doc = await Case.create({ caseNumber: `TEST-SMK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, visaType });
  created.push(doc._id);
  return doc;
}
const cleanup = async () => {
  await CaseForm.deleteMany({ caseId: { $in: created } });
  await CaseFormSelection.deleteMany({ caseId: { $in: created } });
  await Case.deleteMany({ _id: { $in: created } });
};

test("SMOKE: every provisionable catalogue form can be added to a case of every visa type; none is blocked by the visa", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  catalog.clearCache();
  const { items } = await catalog.listCatalog({ limit: 500, onlySelectable: true });
  const provisionable = items.filter((item) => item.kind === "form" && item.templateId && item.provisionable);
  // a template that exists but is not active yet (still in review): the selection is recorded, nothing unsafe is created
  const awaiting = items.filter((item) => item.kind === "form" && item.templateId && !item.provisionable && item.availability !== "not_eligible");
  assert.ok(provisionable.length >= 3, `expected several provisionable forms, got ${provisionable.length}`);
  t.diagnostic(`created on the case: ${provisionable.map((item) => `${item.formCode}(${item.availability})`).join(", ")}; recorded as awaiting activation: ${awaiting.map((item) => item.formCode).join(", ") || "none"}`);

  let added = 0;
  const failures = [];
  for (const visaType of VISA_TYPES) {
    const caseData = await makeCase(visaType);
    let revision = 0;
    for (const form of provisionable) {
      const outcome = await manager.updateSelection(caseData._id, { expectedRevision: revision, add: [{ formCode: form.formCode }], autofill: false }, user, fakeReq);
      revision = outcome.revision;
      const result = outcome.results[0];
      if (result.status !== "ok") { failures.push(`${visaType} + ${form.formCode}: ${result.code || ""} ${result.message}`); continue; }
      const made = await CaseForm.countDocuments({ caseId: caseData._id, formCode: form.formCode });
      if (made !== 1) failures.push(`${visaType} + ${form.formCode}: ${made} CaseForm record(s)`);
      added += 1;
    }
    for (const form of awaiting) {
      const outcome = await manager.updateSelection(caseData._id, { expectedRevision: revision, add: [{ formCode: form.formCode }], autofill: false }, user, fakeReq);
      revision = outcome.revision;
      const result = outcome.results[0];
      if (result.status !== "ok" || result.selectionStatus !== "pending_acquisition") failures.push(`${visaType} + ${form.formCode} (awaiting): expected a recorded selection, got ${JSON.stringify(result)}`);
      if (await CaseForm.countDocuments({ caseId: caseData._id, formCode: form.formCode })) failures.push(`${visaType} + ${form.formCode}: a form was created from a template that is not active`);
    }
    // everything selected is on the case exactly once, and the selection says so
    const state = await manager.getSelection(caseData._id, {}, user);
    assert.equal(state.mode, "manual");
    assert.equal(state.items.filter((item) => item.decision === "include").length, provisionable.length + awaiting.length, `${visaType}: every selected form is listed once`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  t.diagnostic(`added ${added} (visa x form) combinations`);
  assert.equal(added, VISA_TYPES.length * provisionable.length);
});

test("SMOKE: remove / restore / re-add work the same for every visa type; exclusions survive repeated automatic provisioning", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  catalog.clearCache();
  const { items } = await catalog.listCatalog({ limit: 500, onlySelectable: true });
  const form = items.find((item) => item.kind === "form" && item.provisionable && item.availability === "ready") || items.find((item) => item.kind === "form" && item.provisionable);
  assert.ok(form, "a provisionable form exists");
  const uscisFormService = require("../uscis-form.service");
  const template = await uscisFormService.findLatestActiveTemplate(form.formCode.toLowerCase());
  for (const visaType of VISA_TYPES) {
    const caseData = await makeCase(visaType);
    const a = await manager.updateSelection(caseData._id, { expectedRevision: 0, add: [{ formCode: form.formCode }], autofill: false }, user, fakeReq);
    // removing a form the visa's filing package normally requires needs an explicit acknowledgement (and is then reported as waived, not missing)
    let attempt = await manager.updateSelection(caseData._id, { expectedRevision: a.revision, remove: [{ formCode: form.formCode, confirm: true, reason: "smoke" }] }, user, fakeReq);
    let revision = attempt.revision;
    if (attempt.results[0].code === "PACKAGE_REQUIRES_FORM") {
      attempt = await manager.updateSelection(caseData._id, { expectedRevision: revision, remove: [{ formCode: form.formCode, confirm: true, reason: "smoke", acknowledgeWaiver: true }] }, user, fakeReq);
      assert.equal(attempt.selection.removed.find((item) => item.formCode === form.formCode)?.waivedRequirement, true, `${visaType}: acknowledged removal is recorded as waived`);
    }
    const b = attempt;
    assert.equal(b.results[0].status, "ok", `${visaType}: ${JSON.stringify(b.results)}`);
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(await uscisFormService.ensureAssignedForms(await Case.findById(caseData._id), user, fakeReq, { templates: [template] }), [], `${visaType}: automatic provisioning must not restore it`);
    }
    assert.equal((await CaseForm.findOne({ caseId: caseData._id, formCode: form.formCode }).lean()).status, "archived");
    const c = await manager.updateSelection(caseData._id, { expectedRevision: b.revision, add: [{ formCode: form.formCode }], autofill: false }, user, fakeReq);
    assert.equal(c.results[0].action, "restored");
    assert.equal(await CaseForm.countDocuments({ caseId: caseData._id, formCode: form.formCode }), 1, `${visaType}: no duplicate after restore`);
  }
});

test("SMOKE: any checklist can be linked to a form for a case of any visa (coverage for held and chosen checklists, assignment once)", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  catalog.clearCache();
  const { items } = await catalog.listCatalog({ limit: 500, onlySelectable: true });
  const form = items.find((item) => item.kind === "form" && item.provisionable && item.availability === "ready") || items.find((item) => item.kind === "form" && item.provisionable);
  const sample = await Questionnaire.find({ isTemplate: true, latestVersion: true, status: { $ne: "archived" }, key: { $not: /__case_/ }, tags: { $ne: "staff_request" } }).select("key").sort({ key: 1 }).limit(60).lean();
  assert.ok(sample.length > 5, "checklists exist in the test database");
  const keys = sample.map((row) => row.key);
  t.diagnostic(`form ${form.formCode}; ${keys.length} candidate checklists`);

  let measured = 0;
  const problems = [];
  for (const visaType of VISA_TYPES.slice(0, 4)) {
    const caseData = await makeCase(visaType);
    const added = await manager.updateSelection(caseData._id, { expectedRevision: 0, add: [{ formCode: form.formCode }], autofill: false }, user, fakeReq);
    assert.equal(added.results[0].status, "ok");
    // coverage of every candidate checklist against the form: structure is always valid, nothing throws, whatever the visa
    for (let i = 0; i < keys.length; i += 12) {
      const chunk = keys.slice(i, i + 12);
      const coverage = await manager.getFormChecklistCoverage(caseData._id, { formCode: form.formCode, checklistKeys: chunk }, user);
      coverage.checklists.forEach((item) => {
        measured += 1;
        if (item.error) problems.push(`${visaType} ${item.key}: ${item.error}`);
        if (!(item.fieldsFed >= 0 && item.questionsFeedingForm >= 0)) problems.push(`${visaType} ${item.key}: bad numbers`);
      });
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  t.diagnostic(`measured ${measured} (visa x checklist) coverage entries for ${form.formCode}`);
  assert.ok(measured > 0);

  // a chosen checklist is assigned to THIS case only, once
  const caseData = await makeCase("H-1B");
  const chosen = keys.find((key) => key.startsWith("i907")) || keys[0];
  const first = await manager.updateSelection(caseData._id, { expectedRevision: 0, add: [{ formCode: form.formCode }], assignChecklistKeys: [chosen], autofill: false }, user, fakeReq);
  assert.equal(first.assignedChecklists.length, 1, JSON.stringify(first.assignedChecklists));
  assert.equal(first.assignedChecklists[0].error, undefined, JSON.stringify(first.assignedChecklists));
  const refs = (await Case.findById(caseData._id).select("questionnaireReferences").lean()).questionnaireReferences.filter((ref) => ref.title);
  const second = await manager.updateSelection(caseData._id, { expectedRevision: first.revision, add: [{ formCode: form.formCode }], assignChecklistKeys: [chosen], autofill: false }, user, fakeReq);
  assert.equal(second.assignedChecklists[0].alreadyAssigned, true, "assigning again does not duplicate it");
  const refsAfter = (await Case.findById(caseData._id).select("questionnaireReferences").lean()).questionnaireReferences.filter((ref) => ref.title);
  assert.equal(refsAfter.length, refs.length, "no duplicate checklist reference");
  const other = await makeCase("L-1A");
  assert.equal((await Case.findById(other._id).select("questionnaireReferences").lean()).questionnaireReferences.length, 0, "another case is not affected");
});
