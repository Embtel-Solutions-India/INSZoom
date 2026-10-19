// Catalogue + selection manager. Pure parts run anywhere; the DB parts use the local isolated test database only (test-utils/db.js) and create / remove only
// their own test case, forms and selections - the master data (templates, registry, checklists) is only read.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const catalog = require("../case-form-catalog.service");
const manager = require("../case-form-selection-manager.service");
const selection = require("../case-form-selection.service");

// ── pure ────────────────────────────────────────────────────────────────────
const entries = [
  { key: "I-129", kind: "form", formCode: "I-129", title: "Petition for a Nonimmigrant Worker", category: "employment", selectable: true, availability: "ready" },
  { key: "I-765", kind: "form", formCode: "I-765", title: "Application for Employment Authorization", category: "work_permit", selectable: true, availability: "no_template" },
  { key: "I-129|I129_H", kind: "component", formCode: "I129_H", componentCode: "I129_H", parentFormCode: "I-129", title: "H Classification Supplement", category: "employment", selectable: true, availability: "ready" },
  { key: "I-999", kind: "form", formCode: "I-999", title: "Old form", selectable: false, availability: "not_eligible" },
];

test("catalogue search: by number, title words, keyword, category, kind and availability", () => {
  assert.deepEqual(catalog.filterEntries(entries, { q: "i-765" }).map((e) => e.key), ["I-765"]);
  assert.deepEqual(catalog.filterEntries(entries, { q: "employment authorization" }).map((e) => e.key), ["I-765"]);
  assert.deepEqual(catalog.filterEntries(entries, { q: "supplement" }).map((e) => e.key), ["I-129|I129_H"]);
  assert.deepEqual(catalog.filterEntries(entries, { category: "work_permit" }).map((e) => e.key), ["I-765"]);
  assert.deepEqual(catalog.filterEntries(entries, { kind: "component" }).map((e) => e.key), ["I-129|I129_H"]);
  assert.deepEqual(catalog.filterEntries(entries, { availability: "no_template" }).map((e) => e.key), ["I-765"]);
  assert.equal(catalog.filterEntries(entries, { onlySelectable: true }).length, 3);
});

test("availability: ready only with an active template AND an active mapping; never from the listing alone", () => {
  assert.equal(catalog.availabilityOfTemplate(null).availability, "no_template");
  assert.equal(catalog.availabilityOfTemplate({ status: "active", mappingStatus: "active" }).availability, "ready");
  assert.equal(catalog.availabilityOfTemplate({ status: "active", mappingStatus: "needs_review" }).availability, "mapping_incomplete");
  assert.equal(catalog.availabilityOfTemplate({ status: "active", mappingStatus: "biographic_active" }).availability, "mapping_incomplete");
  assert.equal(catalog.availabilityOfTemplate({ status: "review", mappingStatus: "active" }).availability, "mapping_incomplete");
  assert.equal(catalog.availabilityOfTemplate({ status: "active", mappingStatus: "active", officialStatus: "deprecated" }).availability, "not_eligible");
});

test("removal rules: empty drafts go freely; data and reviewed forms need confirmation; locked forms need a Team Lead and a reason", () => {
  const rule = (form, role, input = {}) => manager.removalRule({ form, role, input });
  assert.equal(rule({ status: "pending", completion: { percent: 0 } }, "case_manager").ok, true);
  assert.equal(rule({ status: "ai_filled", completion: { percent: 40 } }, "case_manager").code, "CONFIRMATION_REQUIRED");
  assert.equal(rule({ status: "ai_filled", completion: { percent: 40 } }, "case_manager", { confirm: true }).ok, true);
  assert.equal(rule({ status: "approved" }, "case_manager", { confirm: true }).code, "CONFIRMATION_REQUIRED", "reviewed: a reason is needed too");
  assert.equal(rule({ status: "approved" }, "case_manager", { confirm: true, reason: "wrong form" }).ok, true);
  assert.equal(rule({ status: "locked" }, "case_manager", { confirm: true, reason: "x" }).code, "LOCKED_FORM_REMOVAL_FORBIDDEN");
  assert.equal(rule({ status: "filed" }, "team_lead", { confirm: true }).code, "CONFIRMATION_REQUIRED");
  assert.equal(rule({ status: "locked" }, "team_lead", { confirm: true, reason: "filed in error" }).ok, true);
  assert.equal(rule({ status: "archived" }, "case_manager").ok, true, "already removed: nothing to check");
});

// ── DB (local test database) ────────────────────────────────────────────────
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const CaseFormSelection = require("../../../models/CaseFormSelection");
const uscisFormService = require("../uscis-form.service");

const manage = () => ({ _id: new mongoose.Types.ObjectId(), role: "case_manager" });
const admin = () => ({ _id: new mongoose.Types.ObjectId(), role: "super_admin" });
const created = [];
const makeCase = async (extra = {}) => {
  const doc = await Case.create({ caseNumber: `TEST-CFM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, visaType: "H-1B", ...extra });
  created.push(doc._id);
  return doc;
};
const cleanup = async () => {
  await CaseForm.deleteMany({ caseId: { $in: created } });
  await CaseFormSelection.deleteMany({ caseId: { $in: created } });
  await Case.deleteMany({ _id: { $in: created } });
};

test("DB: the catalogue lists USCIS forms from existing data, with honest availability, and never a non-USCIS form", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  catalog.clearCache();
  const { total, items } = await catalog.listCatalog({ limit: 500 });
  assert.ok(total > 0);
  const byKey = new Map(items.map((item) => [item.key, item]));
  assert.ok(byKey.has("I-129"), "a template that exists is listed");
  assert.ok(items.every((item) => item.agency === "USCIS" || item.selectable === false), "only verified USCIS forms are selectable");
  ["DS-160", "DS-260", "ETA-9035", "ETA-9089"].forEach((code) => assert.ok(!byKey.has(code), `${code} is not a USCIS form`));
  assert.ok(["ready", "mapping_incomplete", "no_template", "not_eligible"].includes(byKey.get("I-129").availability));
  const typed = await catalog.resolveTypedForm("form i-129");
  assert.equal(typed.match?.formCode, "I-129");
  const none = await catalog.resolveTypedForm("zzz-not-a-form");
  assert.equal(none.match, null);
  assert.deepEqual(none.candidates, []);
});

test("DB: add by typed name creates the form and records the selection; stale revision, removal, restore and the manual gate all hold", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  catalog.clearCache();
  const user = admin();
  const caseData = await makeCase();

  const start = await manager.getSelection(caseData._id, {}, user);
  assert.equal(start.revision, 0);
  assert.equal(start.mode, "legacy");

  // add by typed name ("I-907"): created on the case, selection recorded, case moved to manual control with a baseline
  const added = await manager.updateSelection(caseData._id, { expectedRevision: 0, add: [{ name: "I-907" }], autofill: false }, user, null);
  assert.equal(added.partial, false, JSON.stringify(added.results));
  assert.equal(added.results[0].status, "ok");
  assert.equal(added.results[0].formCode, "I-907");
  assert.ok(added.results[0].caseFormId, "the CaseForm exists");
  assert.equal(await CaseForm.countDocuments({ caseId: caseData._id, formCode: "I-907" }), 1);
  assert.equal(added.selection.mode, "manual");
  assert.ok(added.selection.revision >= 1);
  assert.ok(added.selection.items.some((item) => item.formCode === "I-907" && item.decision === "include" && item.origin === "selection"));
  const form = await CaseForm.findOne({ caseId: caseData._id, formCode: "I-907" }).lean();
  assert.equal(form.provisioning.provisioningType, "MANUAL_SELECTION", "a manual selection is never auto-archived by the old conditional logic");

  // adding it again: idempotent (still one form, one selection row)
  const again = await manager.updateSelection(caseData._id, { expectedRevision: added.revision, add: [{ formCode: "I-907" }], autofill: false }, user, null);
  assert.equal(again.results[0].status, "ok");
  assert.equal(await CaseForm.countDocuments({ caseId: caseData._id, formCode: "I-907" }), 1);
  assert.equal(await CaseFormSelection.countDocuments({ caseId: caseData._id, formCode: "I-907" }), 1);

  // a stale revision cannot overwrite a newer selection
  await assert.rejects(() => manager.updateSelection(caseData._id, { expectedRevision: 0, remove: [{ formCode: "I-907" }] }, user, null), (error) => error.code === "STALE_SELECTION_REVISION" && error.status === 409);

  // an unknown / ambiguous name is refused, never guessed
  const unknown = await manager.updateSelection(caseData._id, { expectedRevision: again.revision, add: [{ name: "zzz-not-a-form" }], autofill: false }, user, null);
  assert.equal(unknown.partial, true);
  assert.equal(unknown.results[0].code, "FORM_NOT_FOUND");

  // remove: the record is kept (archived), the exclusion is stored, and no automatic path brings it back
  const removed = await manager.updateSelection(caseData._id, { expectedRevision: unknown.revision, remove: [{ formCode: "I-907", reason: "Not needed", confirm: true }] }, user, null);
  assert.equal(removed.results[0].status, "ok");
  assert.equal((await CaseForm.findOne({ caseId: caseData._id, formCode: "I-907" }).lean()).status, "archived");
  assert.ok(removed.selection.removed.some((item) => item.formCode === "I-907"));
  assert.ok(!removed.selection.items.some((item) => item.formCode === "I-907"));
  const template = await uscisFormService.findLatestActiveTemplate("i-907");
  assert.deepEqual(await uscisFormService.ensureAssignedForms(await Case.findById(caseData._id), user, null, { templates: [template] }), [], "automatic provisioning cannot restore it");
  assert.equal(await CaseForm.countDocuments({ caseId: caseData._id, formCode: "I-907" }), 1, "still one record");

  // restore: the same record comes back (no duplicate)
  const restored = await manager.updateSelection(caseData._id, { expectedRevision: removed.revision, add: [{ formCode: "I-907" }], autofill: false }, user, null);
  assert.equal(restored.results[0].action, "restored");
  assert.notEqual((await CaseForm.findOne({ caseId: caseData._id, formCode: "I-907" }).lean()).status, "archived");
  assert.equal(await CaseForm.countDocuments({ caseId: caseData._id, formCode: "I-907" }), 1);

  // manual control: a form that was not selected is not created by an automatic call
  const other = await uscisFormService.findLatestActiveTemplate("i-129");
  assert.deepEqual(await uscisFormService.ensureAssignedForms(await Case.findById(caseData._id), user, null, { templates: [other] }), []);
});

test("DB: only staff roles can change a case's forms, and a client cannot", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  const caseData = await makeCase();
  const client = { _id: new mongoose.Types.ObjectId(), role: "client" };
  await assert.rejects(() => manager.updateSelection(caseData._id, { expectedRevision: 0, add: [{ formCode: "I-907" }] }, client, null), (error) => error.status === 403);
  await assert.rejects(() => manager.getSelection(caseData._id, {}, client), (error) => error.status === 403);
  await assert.rejects(() => manager.updateSelection(caseData._id, { add: [{ formCode: "I-907" }] }, admin(), null), (error) => error.code === "REVISION_REQUIRED");
});

test("DB: adding a form fills it from the case data and reports how the case's checklists feed it", async (t) => {
  t.after(async () => { await cleanup(); await disconnectTestDB(); });
  await connectTestDB();
  catalog.clearCache();
  const user = admin();
  const caseData = await makeCase();

  // autofill runs on the form that was just created (default on); it never throws into the request - a form that cannot be filled reports why
  const added = await manager.updateSelection(caseData._id, { expectedRevision: 0, add: [{ name: "I-907" }] }, user, null);
  assert.equal(added.results[0].status, "ok", JSON.stringify(added.results));
  assert.equal(added.autofill.length, 1);
  assert.equal(added.autofill[0].formCode, "I-907");
  t.diagnostic(`autofill: ${added.autofill[0].status} ${added.autofill[0].message || ""} completion=${JSON.stringify(added.autofill[0].completion || null)}`);
  assert.ok(["filled", "failed", "skipped"].includes(added.autofill[0].status));
  if (added.autofill[0].status === "filled") {
    const form = await CaseForm.findOne({ caseId: caseData._id, formCode: "I-907" }).lean();
    assert.equal(form.status, "ai_filled");
    assert.ok(form.autoFillReport, "the auto-fill report is stored on the form");
  }

  // the checklist link: which of THIS case's checklists feed the form, and which checklist the registry designed for it that the case does not hold
  const coverage = await manager.getFormChecklistCoverage(caseData._id, { formCode: "I-907" }, user);
  assert.equal(coverage.formCode, "I-907");
  assert.ok(Array.isArray(coverage.checklists));
  assert.ok(Array.isArray(coverage.suggestedChecklists));
  t.diagnostic(`coverage: ${JSON.stringify({ checklists: coverage.checklists.map((c) => `${c.key}:${c.fieldsFed}`), suggested: coverage.suggestedChecklists.map((c) => c.key), summary: coverage.summary })}`);
  assert.equal(typeof coverage.summary, "string");
  coverage.checklists.forEach((item) => assert.ok(item.fieldsFed >= 0 && item.questionsFeedingForm >= 0));
});
