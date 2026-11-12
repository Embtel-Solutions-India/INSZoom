// A question a case manager adds to one case's checklist copy: own document identity (uploads), sibling's layout/visibility only.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCustomQuestionPayload } = require("../case-checklist.service");

const base = {
  _id: "x", __v: 0, createdAt: 1, updatedAt: 2, key: "doc_passport", label: "Passport", type: "file", sectionKey: "documents", pageKey: "documents", order: 5,
  evidenceCategory: "identity", fileConstraints: { requireDocumentCategory: "passport" }, metadata: { documentType: "passport", category: "identity" },
  visibility: { roles: ["client", "case_manager"], portals: ["client", "admin"] }, mapping: { canonicalPath: "x" }, uscisMappings: ["a"], required: true,
  conditionalLogic: { mode: "all", rules: [{ questionKey: "z", operator: "equals", value: "Yes" }], groups: [] }, showIf: { field: "z" },
};
const copy = { _id: "c1", key: "case_copy_key", version: 3 };

test("an added upload is its own document type and does not inherit the sibling's identity, mapping or conditions", () => {
  const payload = buildCustomQuestionPayload(base, { label: "Utility bill", type: "file", patch: { required: true, description: "Last 3 months" }, key: "custom_abc", order: 9, copy });
  assert.equal(payload.key, "custom_abc");
  assert.equal(payload.type, "file");
  assert.equal(payload.required, true);
  assert.equal(payload.fileConstraints, undefined);
  assert.equal(payload.metadata.documentType, "custom_abc");
  assert.equal(payload.evidenceCategory, "supporting_document");
  assert.equal(payload.mapping, undefined);
  assert.deepEqual(payload.uscisMappings, []);
  assert.deepEqual(payload.conditionalLogic.rules, []);
  assert.equal(payload.showIf, undefined);
  assert.deepEqual(payload.visibility, base.visibility, "shown to the same people as its sibling (client portal + staff)");
  assert.equal(payload.sectionKey, "documents");
  assert.deepEqual([payload.questionnaire, payload.questionnaireKey, payload.questionnaireVersion], ["c1", "case_copy_key", 3]);
  assert.deepEqual([payload.active, payload.isActive, payload.description], [true, true, "Last 3 months"]);
});

test("an added text question carries no document identity", () => {
  const payload = buildCustomQuestionPayload(base, { label: "Anything else?", type: "textarea", patch: {}, key: "custom_def", order: 10, copy });
  assert.equal(payload.evidenceCategory, undefined);
  assert.equal(payload.fileConstraints, undefined);
  assert.deepEqual(payload.metadata, { customForCase: true });
  assert.equal(payload.required, false);
});
