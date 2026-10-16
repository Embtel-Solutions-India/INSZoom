// Phase 2: edition carry-forward with proven-equivalence renames, the two projection filters, the legacy field.mapping{} guard, party-rule derived metadata and
// registry descriptions. Pure, DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { carryForwardGraph } = require("../services/EditionMigrationService");
const { equivalent, findRenamedTarget, clean } = require("../contract/fieldEquivalence");
const MappingGraphService = require("../services/MappingGraphService");
const FormMappingService = require("../services/FormMappingService");
const PartyFieldMappingService = require("../services/PartyFieldMappingService");
const BiographicMappingService = require("../services/BiographicMappingService");
const CanonicalFieldRegistryService = require("../services/CanonicalFieldRegistryService");
const { RULES } = require("../config/partyFieldRules");

const field = (id, label, over = {}) => ({ fieldId: id, pdfFieldName: id, label, fieldType: "text", sectionTitle: "Part 1", pageNumber: 1, ...over });
const oldEdge = (id, label, over = {}) => ({ mappingId: `X:old:${id}`, targetFieldId: id, targetPdfField: id, targetLabel: label, targetType: "text", section: "Part 1", sourcePath: `person.${id}`, status: "active", confidence: 95, mappingType: "direct", transform: { type: "direct" }, ...over });
const newTemplate = (...fields) => ({ _id: "t2", formCode: "X-1", version: "2026-01-01", editionDate: "2026-01-01", title: "X", formFields: fields });

test("clean() ignores case, punctuation and the 'Item N:' numbering; equivalence needs the same type, label and (stated) section", () => {
  assert.equal(clean("Item 3: Enter Given Name (First Name)"), "enter given name first name");
  assert.equal(clean("Part 2. Line 5a - Family Name"), "family name");
  const a = { label: "Item 3: Given Name", type: "text", section: "Part 1" };
  assert.equal(equivalent(a, { label: "Item 4: Given Name", type: "text", section: "Part 1" }).ok, true, "only the item number moved");
  assert.equal(equivalent(a, { label: "Given Name", type: "dropdown", section: "Part 1" }).ok, false);
  assert.equal(equivalent(a, { label: "Middle Name", type: "text", section: "Part 1" }).ok, false);
  assert.equal(equivalent(a, { label: "Given Name", type: "text", section: "Part 4" }).ok, false);
  assert.equal(equivalent({ ...a, section: "general" }, { label: "Given Name", type: "text", section: "Part 4" }).ok, true, "a missing / general section does not veto");
  assert.equal(equivalent({ label: "", type: "text" }, { label: "x", type: "text" }).ok, false);
});

test("findRenamedTarget: exactly one equivalent unclaimed field is accepted; two are ambiguous and never guessed", () => {
  const old = { label: "Given Name", type: "text", section: "Part 1" };
  const one = findRenamedTarget(old, [{ targetFieldId: "n1", label: "Given Name", type: "text", section: "Part 1" }, { targetFieldId: "n2", label: "Family Name", type: "text", section: "Part 1" }]);
  assert.equal(one.target.targetFieldId, "n1");
  assert.equal(one.similarity, 100);
  const two = findRenamedTarget(old, [{ targetFieldId: "n1", label: "Given Name", type: "text", section: "Part 1" }, { targetFieldId: "n3", label: "Given Name", type: "text", section: "Part 1" }]);
  assert.deepEqual(two.ambiguous, ["n1", "n3"]);
  assert.equal(findRenamedTarget(old, []), null);
});

test("carry-forward: an edge follows the field with the same PDF name exactly as before (nothing about the exact path changed)", () => {
  const previous = { version: "old", edges: [oldEdge("A", "Given Name"), oldEdge("B", "Family Name")], nodes: { canonical: [] } };
  const { graph, lostEdges, renamedEdges } = carryForwardGraph(previous, newTemplate(field("A", "Given Name"), field("B", "Family Name")));
  assert.deepEqual([graph.edges.length, lostEdges.length, renamedEdges.length], [2, 0, 0]);
  assert.deepEqual(graph.edges.map((edge) => [edge.status, edge.mappingId]), [["active", "X-1:2026-01-01:A"], ["active", "X-1:2026-01-01:B"]]);
  assert.equal(graph.validation.readyForActivation, true);
});

test("carry-forward: a renamed field is carried ONLY when provably the same, as needs_review (never active), and is reported", () => {
  const previous = { version: "old", edges: [oldEdge("A", "Item 3: Given Name"), oldEdge("B", "Family Name")], nodes: { canonical: [] } };
  const { graph, lostEdges, renamedEdges } = carryForwardGraph(previous, newTemplate(field("A2", "Item 4: Given Name"), field("B", "Family Name")));
  const carried = graph.edges.find((edge) => edge.targetFieldId === "A2");
  assert.equal(carried.status, "needs_review");
  assert.ok(carried.confidence <= 60);
  assert.equal(carried.evidence.renamedFrom.pdfField, "A");
  assert.equal(carried.sourcePath, "person.A", "the mapping itself is unchanged");
  assert.deepEqual(renamedEdges.map((item) => [item.from, item.to]), [["A", "A2"]]);
  assert.equal(lostEdges.length, 0);
  assert.equal(graph.validation.readyForActivation, false, "a person must confirm the rename before the edition can go live");
  assert.equal(graph.validation.summary.reviewRequired, 1);
});

test("carry-forward: a different label, a different type, an ambiguous candidate or a candidate another edge matched exactly is LOST, never guessed", () => {
  const previous = { version: "old", edges: [oldEdge("A", "Given Name"), oldEdge("B", "Family Name")], nodes: { canonical: [] } };
  const different = carryForwardGraph(previous, newTemplate(field("A9", "First name of applicant"), field("B", "Family Name")));
  assert.deepEqual([different.lostEdges.map((item) => item.targetPdfField), different.renamedEdges.length], [["A"], 0]);
  const retyped = carryForwardGraph(previous, newTemplate(field("A9", "Given Name", { fieldType: "dropdown" }), field("B", "Family Name")));
  assert.equal(retyped.lostEdges.length, 1);
  const ambiguous = carryForwardGraph(previous, newTemplate(field("A8", "Given Name"), field("A9", "Given Name"), field("B", "Family Name")));
  assert.equal(ambiguous.lostEdges.length, 1, "two equal candidates: never picked");
  // B's exact match is claimed first, so a stray field with B's label cannot steal it
  const stealing = carryForwardGraph({ version: "old", edges: [oldEdge("C", "Family Name"), oldEdge("B", "Family Name")], nodes: { canonical: [] } }, newTemplate(field("B", "Family Name")));
  assert.deepEqual([stealing.graph.edges.length, stealing.graph.edges[0].targetFieldId, stealing.lostEdges.map((item) => item.targetPdfField)], [1, "B", ["C"]]);
});

// ---------------------------------------------------------------- projections ----
test("both projections carry ONLY active edges: needs_review and rejected edges never reach autofill", () => {
  const edges = [
    { mappingId: "1", targetFieldId: "f", sourcePath: "person.firstName", status: "active", mappingType: "direct" },
    { mappingId: "2", targetFieldId: "f", sourcePath: "person.lastName", status: "needs_review", mappingType: "direct" },
    { mappingId: "3", targetFieldId: "g", sourcePath: "person.dob", status: "rejected", mappingType: "direct" },
    { mappingId: "4", targetFieldId: "h", sourcePath: "person.ssn", mappingType: "direct" },
  ];
  const byTarget = MappingGraphService.graphToFieldMappings({ edges });
  assert.deepEqual([...byTarget.keys()], ["f"]);
  assert.deepEqual(byTarget.get("f").map((item) => item.mappingId), ["1"]);
  const template = FormMappingService.applyMappingGraph({ formFields: [{ fieldId: "f" }, { fieldId: "g" }, { fieldId: "h" }] }, { graph: { edges }, mappingVersion: 2, _id: "v" });
  assert.deepEqual(template.formFields.map((item) => item.mappings.map((mapping) => mapping.mappingId)), [["1"], [], []]);
  // an end-to-end autofill of the field uses only the active edge
  const result = FormMappingService.resolveField(template.formFields[0], { person: { firstName: "Ada", lastName: "Lovelace" } }, {});
  assert.equal(result.value, "Ada");
});

test("legacy field.mapping{} never adds to (or overrides) a field that already has graph mappings; with none it still works as before", () => {
  const graphMapped = FormMappingService.normalizeMappings({ fieldId: "x", mappings: [{ source: "canonical", path: "person.firstName" }], mapping: { masterDataPath: "person.lastName" } });
  assert.deepEqual(graphMapped.map((item) => item.path), ["person.firstName"]);
  const legacyOnly = FormMappingService.normalizeMappings({ fieldId: "x", mapping: { masterDataPath: "person.lastName" } });
  assert.deepEqual(legacyOnly.map((item) => item.path), ["person.lastName"]);
  assert.deepEqual(FormMappingService.normalizeMappings({ fieldId: "x", mapping: {} }), []);
  assert.deepEqual(FormMappingService.normalizeMappings({ fieldId: "x", defaultValue: "d" }), [{ source: "default", defaultValue: "d" }]);
});

// ---------------------------------------------------------------- writers stamp origins ----
test("scored suggestions and biographic-tier edges carry their origin", () => {
  const scored = MappingGraphService.buildEdge({ path: "person.firstName", type: "text" }, { targetFieldId: "f", targetPdfField: "f", label: "First name", type: "text", section: "s", pageNumber: 1 }, { formCode: "X-1", version: "v" }, 90);
  assert.equal(scored.origin, "scored");
  const { graph } = BiographicMappingService.generateBiographicGraph({ formCode: "X-1", version: "v", formFields: [field("First", "First Name")] });
  for (const edge of graph.edges) assert.deepEqual([edge.origin, edge.evidence.tier], ["inferred", "biographic"]);
});

test("a party-rule edge is AUTHORED, its profile owner follows its rule, and a rewired edge gets its derived owner recomputed", () => {
  const rule = RULES["I-129"].find((item) => item.to === "petitioner.name");
  const stem = rule.stems[0];
  const template = { formCode: "I-129", version: "v", editionDate: "2026-01-01", formFields: [field(`form1[0].Page1[0].${stem}[0]`, "Name of petitioner", { pageNumber: 1 })] };
  const created = PartyFieldMappingService.plan(template, { edges: [] }, { allowInference: false });
  const edge = created.graph.edges[0];
  assert.deepEqual([edge.origin, edge.partyRule, edge.profileOwner, edge.status], ["authored", "petitioner.name", "employer", "active"]);
  const rewired = PartyFieldMappingService.plan(template, { edges: [{ ...edge, origin: undefined, sourcePath: "contact.address.line1", partyRule: undefined, profileOwner: "employee", mappingId: "legacy" }] }, { allowInference: false });
  const moved = rewired.graph.edges[0];
  assert.equal(moved.sourcePath, "petitioner.name");
  assert.equal(moved.profileOwner, "employer", "stale derived owner recomputed with the new source");
  assert.equal(moved.fallback, "contact.address.line1", "the old source stays as the fallback (existing behavior)");
});

// ---------------------------------------------------------------- registry ----
test("registry metadata is additive: role, description and cardinality default from the path, and describe() reads them", () => {
  const entries = CanonicalFieldRegistryService.list();
  assert.ok(entries.length > 400);
  for (const entry of entries) { assert.ok(entry.role && entry.description && entry.cardinality, entry.path); assert.ok(["one", "many"].includes(entry.cardinality)); }
  assert.deepEqual(CanonicalFieldRegistryService.describe("person.firstName"), { path: "person.firstName", role: "applicant", description: "firstName", cardinality: "one", type: "text" });
  assert.equal(CanonicalFieldRegistryService.describe("company.name").role, "employer");
  assert.equal(CanonicalFieldRegistryService.describe("no.such.path"), null);
  assert.equal(CanonicalFieldRegistryService.defaultRole("petitioner.name"), "petitioner");
  assert.equal(CanonicalFieldRegistryService.defaultRole("whatever.x"), "other");
  assert.equal(entries.find((entry) => /\[\]/.test(entry.path))?.cardinality, "many");
  // existing keys are untouched
  const first = entries[0];
  for (const key of ["path", "aliases", "type", "id", "label", "tokens"]) assert.ok(key in first, key);
});
