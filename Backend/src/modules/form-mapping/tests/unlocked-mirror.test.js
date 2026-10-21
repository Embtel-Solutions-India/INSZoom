const test = require("node:test");
const assert = require("node:assert/strict");
const { addMirrorEdges, hasCandidates, isUnlockedField } = require("../services/UnlockedMirrorService");

const target = (name, over = {}) => ({ targetFieldId: name, targetPdfField: `form1[0].#subform[1].${name}`, label: name, type: "text", section: "s", pageNumber: 2, fieldType: "text", pdfFieldType: "text", ...over });
const edge = (name, over = {}) => ({ targetFieldId: name, targetPdfField: `form1[0].#subform[0].${name}`, sourcePath: "person.alienNumber", transform: { type: "direct" }, status: "active", ...over });
const ctx = { formCode: "I-485", version: "2024", editionDate: "2024-01-01" };

test("a box USCIS marks read-only that copies an already-mapped box gets the same edge", () => {
  const out = [edge("Pt1Line4_AlienNumber[0]")];
  const report = {};
  const added = addMirrorEdges(ctx, [target("Pt1Line4_AlienNumber[1]", { readOnly: true })], out, report);
  assert.equal(added, 1);
  assert.equal(report.mirrored, 1);
  assert.equal(out[1].sourcePath, "person.alienNumber");
  assert.equal(out[1].targetFieldId, "Pt1Line4_AlienNumber[1]");
  assert.equal(out[1].origin, "mirror");
  assert.equal(out[0].targetFieldId, "Pt1Line4_AlienNumber[0]", "the existing edge is untouched");
});

test("nothing is copied for a box that is not unlocked, already has an edge, a signature / barcode, an ambiguous or inactive sibling, or a raw questionnaire source", () => {
  const sibling = edge("Pt1Line4_AlienNumber[0]");
  const run = (targets, edges = [sibling]) => addMirrorEdges(ctx, targets, [...edges], {});
  assert.equal(run([target("Pt1Line4_AlienNumber[1]", { readOnly: false })]), 0, "not read-only");
  assert.equal(run([target("Pt1Line4_AlienNumber[1]", { readOnly: true, fieldType: "signature" })]), 0, "signature");
  assert.equal(run([target("PDF417BarCode1[1]", { readOnly: true })], [edge("PDF417BarCode1[0]")]), 0, "barcode");
  assert.equal(run([target("Pt1Line4_AlienNumber[0]", { readOnly: true })]), 0, "already has its own edge");
  assert.equal(run([target("Pt1Line4_AlienNumber[1]", { readOnly: true })], [sibling, edge("Pt1Line4_AlienNumber[2]", { sourcePath: "petitioner.aNumber" })]), 0, "siblings disagree");
  assert.equal(run([target("Pt1Line4_AlienNumber[1]", { readOnly: true })], [edge("Pt1Line4_AlienNumber[0]", { status: "needs_review" })]), 0, "sibling not active");
  assert.equal(run([target("Pt1Line4_AlienNumber[1]", { readOnly: true })], [edge("Pt1Line4_AlienNumber[0]", { sourcePath: "raw.questionnaireAnswers.x.value" })]), 0, "raw questionnaire key");
  assert.equal(run([target("SomethingElse[1]", { readOnly: true })]), 0, "no sibling with that name");
});

test("hasCandidates is a cheap template-only check", () => {
  assert.equal(hasCandidates({ formFields: [{ fieldName: "a.X[0]", readOnly: true }, { fieldName: "a.X[1]" }] }), true);
  assert.equal(hasCandidates({ formFields: [{ fieldName: "a.X[0]", readOnly: true }, { fieldName: "a.Y[0]" }] }), false);
  assert.equal(hasCandidates({ formFields: [{ fieldName: "a.X[0]" }, { fieldName: "a.X[1]" }] }), false);
  assert.equal(isUnlockedField({ readOnly: true, fieldType: "text", pdfFieldType: "text" }), true);
});

test("a copy is made only from a trusted sibling edge (live mapping), never from an unreviewed draft edge", () => {
  const sibling = edge("Pt1Line4_AlienNumber[0]");
  const targets = [target("Pt1Line4_AlienNumber[1]", { readOnly: true })];
  assert.equal(addMirrorEdges(ctx, targets, [sibling], {}, () => false), 0);
  assert.equal(addMirrorEdges(ctx, targets, [sibling], {}, (candidate) => candidate.targetFieldId === "Pt1Line4_AlienNumber[0]"), 1);
});
