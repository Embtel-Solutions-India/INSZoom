// Template cache (speed fix 2026-11-04): DB-free, with the real schemas and a stub model. Proves the cached template is served exactly like a
// populate() result, a changed template is never served stale, callers never share a copy, the case form is not marked modified, and any failure
// falls back (null / false) instead of erroring.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const { getTemplateDocument, attachTemplate, _cache } = require("../templateCache");

function stubModel(store, counter) {
  const query = (result) => ({ select() { return this; }, lean: async () => (result ? JSON.parse(JSON.stringify(result), (k, v) => v) : null) });
  return {
    hydrate: (...args) => USCISFormTemplate.hydrate(...args),
    findById: (id) => {
      counter.calls += 1;
      const row = store.get(String(id));
      return { select: (fields) => ({ lean: async () => { if (!row) return null; if (/updatedAt __v/.test(fields)) { counter.stamps += 1; return { updatedAt: row.updatedAt, __v: row.__v, activeMappingVersionId: row.activeMappingVersionId }; } counter.full += 1; return { ...row, formFields: row.formFields.map((f) => ({ ...f })), _id: row._id, activeMappingVersionId: row.activeMappingVersionId }; } }) };
    },
  };
}
const makeTemplate = () => ({ _id: new Types.ObjectId(), formCode: "I-129", version: "2026-09-09", updatedAt: new Date("2026-11-04T00:00:00Z"), __v: 3, activeMappingVersionId: new Types.ObjectId(), formFields: [{ fieldId: "a", pdfFieldName: "form1[0].A[0]", label: "A" }] });

test("served like populate(): a hydrated template with real ObjectIds / Dates and the excluded path left out", async () => {
  _cache.clear();
  const t = makeTemplate();
  const counter = { calls: 0, stamps: 0, full: 0 };
  const doc = await getTemplateDocument(t._id, { Model: stubModel(new Map([[String(t._id), t]]), counter) });
  assert.ok(doc instanceof USCISFormTemplate);
  assert.equal(String(doc._id), String(t._id));
  assert.ok(doc.activeMappingVersionId instanceof Types.ObjectId);
  assert.ok(doc.updatedAt instanceof Date);
  assert.equal(doc.formFields[0].pdfFieldName, "form1[0].A[0]");
  assert.equal(doc.isSelected("definition"), false, "definition is excluded, as in the populate it replaces");
  assert.equal(doc.toObject().formCode, "I-129");
});

test("the second use is served from memory (only the tiny change-stamp query); a changed template is reloaded at once", async () => {
  _cache.clear();
  const t = makeTemplate();
  const store = new Map([[String(t._id), t]]);
  const counter = { calls: 0, stamps: 0, full: 0 };
  const Model = stubModel(store, counter);
  await getTemplateDocument(t._id, { Model });
  await getTemplateDocument(t._id, { Model });
  assert.deepEqual({ stamps: counter.stamps, full: counter.full }, { stamps: 2, full: 1 }, "second call: stamp only");
  t.activeMappingVersionId = new Types.ObjectId(); // a new mapping was activated
  t.formFields[0].label = "A (remapped)";
  const fresh = await getTemplateDocument(t._id, { Model });
  assert.equal(counter.full, 2, "reloaded after the change");
  assert.equal(fresh.formFields[0].label, "A (remapped)");
  t.__v += 1; t.formFields[0].label = "A again";
  assert.equal((await getTemplateDocument(t._id, { Model })).formFields[0].label, "A again");
});

test("every caller gets its own copy: changing one never changes another or the cache", async () => {
  _cache.clear();
  const t = makeTemplate();
  const Model = stubModel(new Map([[String(t._id), t]]), { calls: 0, stamps: 0, full: 0 });
  const one = await getTemplateDocument(t._id, { Model });
  one.formFields[0].label = "changed by request one";
  const two = await getTemplateDocument(t._id, { Model });
  assert.equal(two.formFields[0].label, "A");
});

test("attachTemplate: the case form looks populated, its own data is NOT marked modified, and saving would store only the template id", async () => {
  _cache.clear();
  const t = makeTemplate();
  const Model = stubModel(new Map([[String(t._id), t]]), { calls: 0, stamps: 0, full: 0 });
  const caseForm = CaseForm.hydrate({ _id: new Types.ObjectId(), caseId: new Types.ObjectId(), formCode: "I-129", formTemplateId: t._id, fieldValues: { a: "x" }, status: "under_review" });
  assert.equal(await attachTemplate(caseForm, { Model }), true);
  assert.ok(caseForm.populated("formTemplateId"));
  assert.equal(caseForm.formTemplateId.formCode, "I-129");
  assert.deepEqual(caseForm.modifiedPaths(), [], "attaching the template changes nothing on the case form");
  assert.equal(String(caseForm.toObject({ depopulate: true }).formTemplateId), String(t._id));
});

test("any failure falls back instead of erroring: missing template, bad id, a throwing database", async () => {
  _cache.clear();
  const counter = { calls: 0, stamps: 0, full: 0 };
  const Model = stubModel(new Map(), counter);
  assert.equal(await getTemplateDocument(new Types.ObjectId(), { Model }), null);
  assert.equal(await getTemplateDocument("not-an-id", { Model }), null);
  const throwing = { findById: () => { throw new Error("db down"); } };
  assert.equal(await getTemplateDocument(new Types.ObjectId(), { Model: throwing }), null);
  const caseForm = CaseForm.hydrate({ _id: new Types.ObjectId(), caseId: new Types.ObjectId(), formCode: "I-129", formTemplateId: new Types.ObjectId() });
  const before = String(caseForm.formTemplateId);
  assert.equal(await attachTemplate(caseForm, { Model: throwing }), false);
  assert.equal(String(caseForm.formTemplateId), before, "left untouched for the normal populate()");
  assert.deepEqual(caseForm.modifiedPaths(), []);
});

// the CaseForm pre-save guard that protects the version history on a box save (loaded without `versions`)
const runGuard = (doc) => new Promise((resolve) => {
  const hook = CaseForm.schema.s.hooks._pres.get("save").find((entry) => entry.fn.name === "guardSnapshotsNotLoaded");
  assert.ok(hook, "the guard is registered on CaseForm");
  hook.fn.call(doc, (error) => resolve(error || null));
});

test("guard: a case form loaded without its snapshots can never write them - the save is refused, nothing is lost", async () => {
  const doc = CaseForm.hydrate({ _id: new Types.ObjectId(), caseId: new Types.ObjectId(), formCode: "I-129", fieldValues: { a: "x" } }, { versions: 0 });
  doc.$locals.snapshotsNotLoaded = true;
  doc.set("fieldValues", { a: "typed by the case manager" });
  assert.equal(await runGuard(doc), null, "a normal box save goes through");
  doc.set("versions", [{ versionNumber: 99 }]);
  const refused = await runGuard(doc);
  assert.equal(refused?.code, "CASE_FORM_SNAPSHOTS_NOT_LOADED");
  const full = CaseForm.hydrate({ _id: new Types.ObjectId(), caseId: new Types.ObjectId(), formCode: "I-129", versions: [] });
  full.set("versions", [{ versionNumber: 1 }]);
  assert.equal(await runGuard(full), null, "a fully loaded case form (download, auto-fill) keeps writing snapshots as before");
});

// mapping versions (read on every form open)
const { getMappingVersionLean, _mappingCache } = require("../templateCache");
function versionModel(store, counter) {
  return {
    findById: (id) => ({
      select: () => ({ lean: async () => { counter.stamps += 1; const row = store.get(String(id)); return row ? { updatedAt: row.updatedAt, __v: row.__v, status: row.status } : null; } }),
      lean: async () => { counter.full += 1; const row = store.get(String(id)); return row ? JSON.parse(JSON.stringify(row)) : null; },
    }),
  };
}

test("mapping versions: same content as the normal lean() read, served from memory on the next open, reloaded at once when the version changes", async () => {
  _mappingCache.clear();
  const id = new Types.ObjectId();
  const row = { _id: String(id), status: "active", __v: 1, updatedAt: "2026-11-04T00:00:00.000Z", graph: { edges: [{ targetFieldId: "a", sourcePath: "beneficiary.firstName" }] } };
  const store = new Map([[String(id), row]]);
  const counter = { stamps: 0, full: 0 };
  const Model = versionModel(store, counter);
  const first = await getMappingVersionLean(id, { Model });
  assert.deepEqual(first.graph.edges, row.graph.edges);
  await getMappingVersionLean(id, { Model });
  assert.equal(counter.full, 1, "second open: only the change stamp is read");
  row.status = "retired"; // activation of a newer version, or any edit, changes the stamp
  row.graph.edges[0].sourcePath = "beneficiary.lastName";
  assert.equal((await getMappingVersionLean(id, { Model })).graph.edges[0].sourcePath, "beneficiary.lastName");
  assert.equal(counter.full, 2);
  const mine = await getMappingVersionLean(id, { Model });
  mine.graph.edges[0].sourcePath = "changed by one request";
  assert.equal((await getMappingVersionLean(id, { Model })).graph.edges[0].sourcePath, "beneficiary.lastName", "callers never share a copy");
});

test("mapping versions: a missing version is null (as before), a bad id or a database error is undefined so the caller runs its own query", async () => {
  _mappingCache.clear();
  const Model = versionModel(new Map(), { stamps: 0, full: 0 });
  assert.equal(await getMappingVersionLean(new Types.ObjectId(), { Model }), null);
  assert.equal(await getMappingVersionLean("bad", { Model }), undefined);
  assert.equal(await getMappingVersionLean(new Types.ObjectId(), { Model: { findById: () => { throw new Error("db down"); } } }), undefined);
});
