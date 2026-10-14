const assert = require("node:assert/strict");
const test = require("node:test");
const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const adminEdits = require("../adminEdits");
const service = require("../questionnaire.service");

// Edits made on the Questionnaire page must survive the built-in definition reconciler. DB-free: the models are stubbed.

test("changedFields: only real differences count (sub-document _ids and key order are noise); aliases follow", () => {
  const current = { label: "A", required: false, options: [{ _id: "1", value: "x", label: "X" }], active: true, mapping: { canonicalPath: "p", transform: "t" } };
  assert.deepEqual(adminEdits.changedFields(current, { label: "A", required: false, options: [{ value: "x", label: "X" }], mapping: { transform: "t", canonicalPath: "p" } }), []);
  assert.deepEqual(adminEdits.changedFields(current, { label: "B", required: true }).sort(), ["label", "required"]);
  assert.deepEqual(adminEdits.changedFields(current, { isActive: false }).sort(), ["active", "isActive"]);
  assert.deepEqual(adminEdits.changedFields(current, { helpText: "h" }).sort(), ["description", "helpText"]);
  assert.deepEqual(adminEdits.changedFields(current, { updatedBy: "u", adminEditedFields: ["x"], adminCreated: true }), [], "bookkeeping and the markers are never an edit");
  assert.deepEqual(adminEdits.changedFields({ title: "T", status: "draft" }, { title: "T2", status: "published" }, { only: adminEdits.QUESTIONNAIRE_TRACKED_FIELDS }), ["title"]);
});

test("a payload can never set or clear the markers; edited fields merge without duplicates", () => {
  assert.deepEqual(adminEdits.stripMarkers({ label: "x", adminEditedFields: [], adminCreated: true }), { label: "x" });
  assert.deepEqual(adminEdits.mergeEditedFields(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(adminEdits.withoutEditedFields({ label: "L", required: true }, ["required"]), { label: "L" });
  assert.deepEqual(adminEdits.withoutEditedFields({ label: "L" }, []), { label: "L" });
});

// ── the reconciler, against stubbed models ───────────────────────────────────────────────────────────────────────────────────────────
const definition = service.VISA_TEMPLATE_DEFINITIONS.find((item) => item.questions.filter((q) => q.required).length >= 2 && item.questions.length >= 4);

function fakeQuestion(def, overrides = {}) {
  const data = { ...JSON.parse(JSON.stringify(def)), active: true, isActive: true, adminEditedFields: [], adminCreated: false, ...overrides };
  return { ...data, _id: `id-${def.key}`, toObject: () => data };
}

async function reconcileWith(existingQuestions, questionnaireOverrides = {}) {
  const questionnaire = {
    _id: "qn1", key: definition.key, version: 1, status: "draft", description: definition.description, isTemplate: true,
    visaTypes: definition.visaTypes || [definition.visaType], adminVisaTypes: [], adminEditedFields: [], assignmentRules: undefined,
    sections: definition.sections.map((title, index) => ({ key: title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), title, order: index + 1 })),
    pages: [], builder: {}, save: async () => {}, auditHistory: [], ...questionnaireOverrides,
  };
  const originals = { findOne: Questionnaire.findOne, find: Question.find, bulkWrite: Question.bulkWrite };
  let ops = [];
  Questionnaire.findOne = async () => questionnaire;
  Question.find = async () => existingQuestions;
  Question.bulkWrite = async (written) => { ops = written; };
  try {
    await service.reconcileDefinition(definition, { _id: undefined, role: "super_admin" }, undefined);
  } finally {
    Questionnaire.findOne = originals.findOne; Question.find = originals.find; Question.bulkWrite = originals.bulkWrite;
  }
  return { ops, questionnaire };
}

const patchFor = (ops, key) => ops.find((op) => op.updateOne && op.updateOne.filter._id === `id-${key}`)?.updateOne.update.$set;

test("reconciler: a question the designer edited keeps the edited fields; the rest still follows the definition", async () => {
  const [first, second] = definition.questions.filter((q) => q.required);
  const existing = definition.questions.map((q) => {
    if (q.key === first.key) return fakeQuestion(q, { required: false, label: "Changed by designer", adminEditedFields: ["required", "label"] });
    if (q.key === second.key) return fakeQuestion(q, { required: false }); // not edited by a designer: reverts to the definition
    return fakeQuestion(q);
  });
  const { ops } = await reconcileWith(existing);
  assert.equal(patchFor(ops, first.key), undefined, "nothing to patch: both differing fields are the designer's");
  assert.equal(patchFor(ops, second.key).required, true, "an unedited question still follows the definition");
});

test("reconciler: only the edited field is protected, the other fields of that question still reconcile", async () => {
  const target = definition.questions[0];
  const existing = definition.questions.map((q) => (q.key === target.key
    ? fakeQuestion(q, { label: "Designer label", description: "stale description", adminEditedFields: ["label"] })
    : fakeQuestion(q)));
  const { ops } = await reconcileWith(existing);
  const patch = patchFor(ops, target.key);
  if (target.description !== "stale description") assert.equal(patch?.description, target.description);
  assert.equal(patch?.label, undefined, "the designer's label is never reverted");
});

test("reconciler: a question the designer added is never retired; one they removed is never brought back", async () => {
  const removed = definition.questions[1];
  const existing = definition.questions.map((q) => (q.key === removed.key ? fakeQuestion(q, { active: false, isActive: false, adminEditedFields: ["active", "isActive"] }) : fakeQuestion(q)));
  const added = fakeQuestion({ key: "designer_added_question", label: "Added", type: "text" }, { adminCreated: true });
  existing.push(added);
  const { ops } = await reconcileWith(existing);
  assert.equal(patchFor(ops, removed.key), undefined, "a designer-removed question stays removed");
  assert.equal(patchFor(ops, "designer_added_question"), undefined, "a designer-added question is not retired");
});

test("reconciler: a question removed by CODE (not by a designer) is still retired, and an inactive unedited one is still reactivated", async () => {
  const stale = fakeQuestion({ key: "no_longer_in_code", label: "Old", type: "text" });
  const revived = definition.questions[0];
  const existing = definition.questions.map((q) => (q.key === revived.key ? fakeQuestion(q, { active: false, isActive: false }) : fakeQuestion(q)));
  existing.push(stale);
  const { ops } = await reconcileWith(existing);
  assert.equal(patchFor(ops, "no_longer_in_code")?.active, false);
  assert.equal(patchFor(ops, revived.key)?.active, true);
});

test("reconciler: questionnaire-level designer edits (description, sections/layout) are not reset", async () => {
  const { questionnaire } = await reconcileWith(definition.questions.map((q) => fakeQuestion(q)), {
    description: "Designer description",
    sections: [{ key: "custom", title: "Custom section", order: 1 }],
    builder: { questionOrder: ["custom_q"] },
    adminEditedFields: ["description", "sections", "builder"],
  });
  assert.equal(questionnaire.description, "Designer description");
  assert.deepEqual(questionnaire.sections.map((section) => section.title), ["Custom section"]);
  assert.deepEqual(questionnaire.builder.questionOrder, ["custom_q"]);
});

test("reconciler: without designer edits a changed definition still reaches the questionnaire (unchanged behaviour)", async () => {
  const { questionnaire } = await reconcileWith(definition.questions.map((q) => fakeQuestion(q)), { description: "stale", sections: [{ key: "old", title: "Old", order: 1 }] });
  assert.equal(questionnaire.description, definition.description);
  assert.deepEqual(questionnaire.sections.map((section) => section.title), definition.sections);
});

// ── the edit paths record what the designer changed ────────────────────────────────────────────────────────────────────────────────
const AuditLog = require("../../../models/AuditLog");
const designer = { _id: "u1", role: "admin" };

async function withStubs(stubs, run) {
  const saved = [];
  for (const [target, name, value] of stubs) { saved.push([target, name, target[name]]); target[name] = value; }
  try { return await run(); } finally { saved.forEach(([target, name, original]) => { target[name] = original; }); }
}

test("updateQuestion records the changed fields (required, answer type, label, removal) and ignores an echoed-back marker", async () => {
  const data = { key: "q1", label: "Old", type: "text", required: false, active: true, isActive: true, adminEditedFields: [], questionnaire: "qn1" };
  const question = { ...data, toObject: () => ({ ...question, toObject: undefined }), save: async () => question };
  await withStubs([[Questionnaire, "findById", async () => ({ status: "draft" })], [AuditLog, "create", async () => {}]], async () => {
    await service.updateQuestion(question, { label: "Old", required: true, type: "select", adminEditedFields: ["bogus"] }, designer);
    assert.deepEqual(question.adminEditedFields.sort(), ["required", "type"]);
    await service.updateQuestion(question, { active: false }, designer); // what the delete route sends
    assert.ok(question.adminEditedFields.includes("active") && question.adminEditedFields.includes("isActive"));
    assert.ok(!question.adminEditedFields.includes("bogus"), "a payload cannot write the marker");
  });
});

test("updateQuestionnaire records the tracked fields the designer changed (not status/approval bookkeeping)", async () => {
  const questionnaire = { key: "k", status: "draft", title: "T", description: "D", sections: [], auditHistory: [], toObject() { return { title: this.title, description: this.description, sections: this.sections, status: this.status }; }, save: async () => {} };
  await withStubs([[AuditLog, "create", async () => {}]], async () => {
    await service.updateQuestionnaire(questionnaire, { description: "New description", status: "draft" }, designer);
    assert.deepEqual(questionnaire.adminEditedFields, ["description"]);
  });
});

test("a new VERSION keeps what makes it the default checklist for its visa and role (a clone does not)", async () => {
  const source = {
    _id: "v1", key: "x_checklist", title: "X", version: 1, status: "published", visaType: "H-1B", visaTypes: ["H-1B"], adminVisaTypes: ["H-1B"],
    checklistRole: "employee", isDefault: true, type: "template", isTemplate: true, assignmentRules: { visaTypes: ["H-1B"] },
    adminEditedFields: ["description"], builder: {}, auditHistory: [],
    toObject() { return { ...this, toObject: undefined }; },
  };
  let created;
  await withStubs([
    [Questionnaire, "updateMany", async () => {}],
    [Questionnaire, "create", async (doc) => { created = doc; return { ...doc, _id: "v2", auditHistory: [], save: async () => {} }; }],
    [Question, "find", () => ({ sort: async () => [] })],
    [AuditLog, "create", async () => {}],
  ], async () => {
    await service.createNewVersion(source, designer);
  });
  assert.equal(created.version, 2);
  assert.equal(created.isDefault, true);
  assert.equal(created.checklistRole, "employee");
  assert.equal(created.visaType, "H-1B");
  assert.deepEqual(created.adminVisaTypes, ["H-1B"]);
  assert.deepEqual(created.adminEditedFields, ["description"], "the designer's protected fields travel with the new version");
});
