// "Keep blank": a box a person decided must stay empty is never filled - by an edge, a default value, a suggestion, a new edition - and is not a gap or a required field.
const test = require("node:test");
const assert = require("node:assert/strict");
const { keepBlankSet, enforceKeepBlank, setKeepBlank, carryKeepBlank } = require("../contract/keepBlank");
const { validateGraphContract } = require("../contract/MappingContractValidator");
const { computeCoverage } = require("../contract/MappingCoverageService");
const { createPathUniverse } = require("../contract/PathUniverse");
const FormMappingService = require("../services/FormMappingService");
const MappingGraphService = require("../services/MappingGraphService");
const { carryForwardGraph } = require("../services/EditionMigrationService");

const edge = (targetFieldId, sourcePath = "beneficiary.firstName", over = {}) => ({ mappingId: `m-${targetFieldId}`, targetFieldId, targetPdfField: `pdf.${targetFieldId}`, sourcePath, mappingType: "direct", status: "active", origin: "authored", targetType: "text", ...over });
const field = (id, over = {}) => ({ fieldId: id, targetFieldId: id, targetPdfField: `pdf.${id}`, label: id, type: "text", section: "Part 1", pageNumber: 1, ...over });
const graph = (over = {}) => ({ edges: [edge("a"), edge("b", "beneficiary.lastName")], unmappedTargets: ["c"], keepBlank: [], ...over });

test("marking a box removes its mapping and takes it out of the gaps; unmarking leaves it unmapped", () => {
  const marked = setKeepBlank(graph({ unmappedTargets: ["a", "c"] }), field("a"), { reason: "USCIS says leave empty", by: "u1" });
  assert.deepEqual(marked.edges.map((item) => item.targetFieldId), ["b"]);
  assert.deepEqual(marked.unmappedTargets, ["c"]);
  assert.equal(marked.keepBlank[0].reason, "USCIS says leave empty");
  assert.equal(marked.keepBlank[0].by, "u1");
  const again = setKeepBlank(marked, field("a"), {});
  assert.equal(again.keepBlank.length, 1); // marking twice keeps one entry
  const unmarked = setKeepBlank(marked, field("a"), { keepBlank: false });
  assert.deepEqual(unmarked.keepBlank, []);
  assert.deepEqual(unmarked.edges.map((item) => item.targetFieldId), ["b"]); // not mapped again by itself
});

test("every writer is overruled: edges aimed at a kept-blank box are dropped", () => {
  const result = enforceKeepBlank(graph({ keepBlank: [{ targetFieldId: "a" }] }));
  assert.deepEqual(result.graph.edges.map((item) => item.targetFieldId), ["b"]);
  assert.deepEqual(result.removed.map((item) => item.targetFieldId), ["a"]);
  assert.equal(enforceKeepBlank(graph()).removed.length, 0);
  assert.deepEqual([...keepBlankSet({ keepBlank: [{ targetFieldId: "x" }] })], ["x"]);
});

test("autofill: a kept-blank box has no mapping, ignores its template default value and is not required", () => {
  const template = { formFields: [field("a", { defaultValue: "N/A", required: true, validation: { required: true } }), field("b", { defaultValue: "N/A" })] };
  const applied = FormMappingService.applyMappingGraph(template, { _id: "v1", mappingVersion: 1, graph: { edges: [], keepBlank: [{ targetFieldId: "a" }] } });
  const [blank, other] = applied.formFields;
  assert.equal(blank.keepBlank, true);
  assert.equal(blank.required, false);
  assert.equal(blank.validation.required, false);
  assert.deepEqual(FormMappingService.normalizeMappings(blank), []);
  const resolved = FormMappingService.resolveField(blank, {}, {});
  assert.deepEqual([resolved.value, resolved.source, resolved.warnings], [undefined, "keep_blank", []]);
  // a box that was NOT marked still uses its default value, exactly as before
  assert.equal(FormMappingService.resolveField(other, {}, {}).value, "N/A");
});

test("kept-blank boxes are not gaps: validation, contract and coverage all count them separately", () => {
  const fields = [field("a", { required: true }), field("b"), field("c", { required: true })];
  const template = { formCode: "T-1", version: "1", formFields: fields };
  const g = { nodes: { canonical: [{ path: "beneficiary.lastName" }, { path: "beneficiary.firstName" }] }, edges: [edge("b", "beneficiary.lastName")], unmappedTargets: ["a"], keepBlank: [{ targetFieldId: "a" }] };
  const verdict = MappingGraphService.validateGraph(g, template);
  assert.equal(verdict.summary.unmapped, 0);
  assert.equal(verdict.warnings.some((item) => item.targetFieldId === "a"), false);
  assert.equal(verdict.warnings.some((item) => item.targetFieldId === "c"), true); // a real gap is still reported
  const universe = createPathUniverse({ registry: [], aliases: [], profileMaps: [], libraryPaths: ["beneficiary.lastName", "beneficiary.firstName"], partyRules: [] });
  const contract = validateGraphContract(g, template, { universe, getTemplateFields: (t) => t.formFields });
  assert.equal(contract.unmapped.keptBlank, 1);
  assert.equal(contract.unmapped.unresolved, 1); // only "c"
  const coverage = computeCoverage({ template, graph: g, universe, getTemplateFields: (t) => t.formFields });
  assert.equal(coverage.fields.keptBlank, 1);
  assert.equal(coverage.fields.requiredUnmapped, 1);
});

test("a new edition keeps the decision for boxes that still exist (by PDF name or id) and drops it for boxes that are gone", () => {
  const previous = { version: "old", edges: [edge("b")], keepBlank: [{ targetFieldId: "a", targetPdfField: "pdf.a", label: "A" }, { targetFieldId: "gone", targetPdfField: "pdf.gone" }] };
  const carried = carryKeepBlank(previous, [field("a2", { targetPdfField: "pdf.a" }), field("b")]);
  assert.deepEqual(carried.map((entry) => entry.targetFieldId), ["a2"]);
  const template = { _id: "t2", formCode: "T-1", version: "new", title: "T", formFields: [field("a2", { pdfFieldName: "pdf.a" }), field("b", { pdfFieldName: "pdf.b" })] };
  const { graph: next } = carryForwardGraph(previous, template);
  assert.deepEqual(next.keepBlank.map((entry) => entry.targetFieldId), ["a2"]);
});
