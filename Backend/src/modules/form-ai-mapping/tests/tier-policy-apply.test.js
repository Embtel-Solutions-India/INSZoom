// Phase 4: the risk-tier matrix (pure), the narrow MappingPolicy exception for validated AI edges, and the guarded mode "on" (every refusal, and the one thing it may do).
// DB-free: MappingGraphService's database functions are stubbed; nothing real is written.
const test = require("node:test");
const assert = require("node:assert/strict");
const { tierOf, riskFlags, kindOf } = require("../riskTier");
const { admitNewEdge } = require("../../form-mapping/contract/MappingPolicy");
const MappingGraphService = require("../../form-mapping/services/MappingGraphService");
const { applyAutoUse } = require("../GeminiMappingService");

const ok = { hard: [], soft: [] };
const text = (extra = {}) => ({ targetFieldId: "t", targetPdfField: "form1[0].P1[0].Line1_Name[0]", label: "Beneficiary's given name", type: "text", ...extra });
const cand = (path = "beneficiary.firstName", extra = {}) => ({ path, ...extra });

test("tier matrix: an unambiguous, validated TEXT mapping is auto_use", () => {
  for (const type of ["text", "textarea", "number", "date", "phone", "email"]) {
    const box = text({ type, label: type === "date" ? "Beneficiary date of birth" : "Beneficiary given name" });
    assert.equal(tierOf({ box, candidate: cand(type === "date" ? "beneficiary.dateOfBirth" : "beneficiary.firstName"), validation: ok }).tier, "auto_use", type);
  }
});

test("tier matrix: a hard failure is rejected, a soft failure or a missing candidate / label is needs_review", () => {
  assert.deepEqual(tierOf({ box: text(), candidate: cand(), validation: { hard: ["not_in_registry"], soft: [] } }), { tier: "rejected", reasons: ["not_in_registry"], risks: [], corroboratedBy: null });
  for (const soft of ["label_evidence_missing", "party_unconfirmed", "no_checklist_source", "existing_edge_differs", "contract_unchecked", "label_path_unrelated"]) {
    const result = tierOf({ box: text(), candidate: cand(), validation: { hard: [], soft: [soft] } });
    assert.equal(result.tier, "needs_review", soft);
    assert.deepEqual(result.reasons, [soft]);
  }
  assert.deepEqual(tierOf({ box: text(), candidate: null, validation: ok }).reasons, ["no_candidate"]);
  assert.deepEqual(tierOf({ box: text(), missingLabel: true }).reasons, ["missing_label"]);
});

test("tier matrix: every risky kind is needs_review without corroboration and auto_use with a corroboration of the SAME path", () => {
  const cases = [
    ["address block", text({ label: "Street Number and Name" }), cand("beneficiary.address.line1"), "address_block"],
    ["checkbox", text({ type: "checkbox", label: "Beneficiary is married" }), cand("beneficiary.isMarried"), "checkbox"],
    ["radio", text({ type: "radio", label: "Beneficiary gender" }), cand("beneficiary.gender"), "radio"],
    ["dropdown", text({ type: "dropdown", label: "Beneficiary country of birth" }), cand("beneficiary.countryOfBirth"), "dropdown"],
    ["conditional", text({ label: "Beneficiary middle name, if applicable" }), cand("beneficiary.middleName"), "conditional"],
    ["conditional (script-switched)", text({ readOnly: true }), cand(), "conditional"],
    ["repeating", text({ targetPdfField: "form1[0].P1[0].GivenName2[0]" }), cand(), "repeating"],
    ["repeating (many path)", text(), cand("beneficiary.children[].name", { cardinality: "many" }), "repeating"],
    ["ssn / a-number", text({ label: "Social Security Number" }), cand("beneficiary.ssn"), "ssn_or_anumber"],
    ["other party", text({ label: "Beneficiary spouse name" }), cand("beneficiary.spouse.name"), "other_party"],
  ];
  for (const [name, box, candidate, flag] of cases) {
    const alone = tierOf({ box, candidate, validation: ok });
    assert.equal(alone.tier, "needs_review", name);
    assert.ok(alone.risks.includes(flag) && alone.reasons.includes(`risky_${flag}_uncorroborated`), `${name}: ${JSON.stringify(alone)}`);
    for (const source of ["sibling_form", "golden_fixture"]) {
      const lifted = tierOf({ box, candidate, validation: ok, corroboration: { source, path: candidate.path } });
      assert.equal(lifted.tier, "auto_use", `${name} / ${source}`);
      assert.equal(lifted.corroboratedBy, source);
    }
    assert.equal(tierOf({ box, candidate, validation: ok, corroboration: { source: "golden_fixture", path: "some.other.path" } }).tier, "needs_review", `${name}: corroboration of another path lifts nothing`);
    assert.equal(tierOf({ box, candidate, validation: { hard: [], soft: ["party_unconfirmed"] }, corroboration: { source: "golden_fixture", path: candidate.path } }).tier, "needs_review", `${name}: corroboration never overrides a failed check`);
  }
});

test("tier matrix: kinds and flags are read from the box and the path, not from the model", () => {
  assert.equal(kindOf({ type: "dropdown" }), "dropdown");
  assert.equal(kindOf({ type: "textarea" }), "textarea");
  assert.equal(kindOf({ fieldType: "checkbox" }), "checkbox");
  assert.deepEqual(riskFlags(text(), cand()), []);
  assert.deepEqual(riskFlags(text({ label: "City or Town" }), cand("beneficiary.address.city")), ["address_block"]);
});

test("MappingPolicy: an ai edge stays active ONLY when the engine marked it aiValidated AND auto_use; every other ai (and scored) edge is still review-only", () => {
  const edge = (origin, evidence) => ({ origin, status: "active", targetFieldId: "t", sourcePath: "beneficiary.firstName", ...(evidence ? { evidence } : {}) });
  const kept = admitNewEdge(edge("ai", { aiValidated: true, tier: "auto_use", model: "m" }));
  assert.equal(kept.status, "active");
  for (const evidence of [undefined, {}, { aiValidated: true }, { aiValidated: true, tier: "needs_review" }, { aiValidated: false, tier: "auto_use" }, { tier: "auto_use" }, { aiValidated: "true", tier: "auto_use" }]) {
    const downgraded = admitNewEdge(edge("ai", evidence));
    assert.equal(downgraded.status, "needs_review", JSON.stringify(evidence));
    assert.equal(downgraded.evidence.downgradedFrom, "active");
  }
  assert.equal(admitNewEdge(edge("scored", { aiValidated: true, tier: "auto_use" })).status, "needs_review", "the exception is for ai edges only");
  assert.equal(admitNewEdge(edge("inferred")).status, "active");
  assert.equal(admitNewEdge(edge("authored")).status, "active");
});

// ---- applyAutoUse ----------------------------------------------------------------------------------------------------------------------------------------
const fields = [
  { fieldId: "a", pdfFieldName: "form1[0].P1[0].A[0]", label: "Beneficiary given name", sectionTitle: "Part 1", fieldType: "text", pageNumber: 1 },
  { fieldId: "b", pdfFieldName: "form1[0].P1[0].B[0]", label: "Beneficiary family name", sectionTitle: "Part 1", fieldType: "text", pageNumber: 1 },
  { fieldId: "c", pdfFieldName: "form1[0].P1[0].C[0]", label: "Already mapped", sectionTitle: "Part 1", fieldType: "text", pageNumber: 1 },
  { fieldId: "d", pdfFieldName: "form1[0].P1[0].D[0]", label: "Kept blank", sectionTitle: "Part 1", fieldType: "text", pageNumber: 1 },
  { fieldId: "e", pdfFieldName: "form1[0].P1[0].E[0]", label: "Street Number and Name", sectionTitle: "Part 1", fieldType: "text", pageNumber: 1 },
];
const tpl = (extra = {}) => ({ _id: "tpl1", formCode: "I-TEST", version: "2025-01-20", editionDate: new Date("2025-01-20"), status: "review", formFields: fields, ...extra });
const existing = { targetFieldId: "c", status: "active", sourcePath: "person.dob", origin: "legacy", mappingId: "m:c" };
const baseGraph = () => ({ nodes: { canonical: [] }, edges: [existing], keepBlank: [{ targetFieldId: "d" }] });
const suggestion = (id, extra = {}) => ({ targetFieldId: id, targetPdfField: `form1[0].P1[0].${id.toUpperCase()}[0]`, tier: "auto_use", candidate: { path: id === "a" ? "beneficiary.firstName" : "beneficiary.lastName" }, reasonCode: "label_exact", labelEvidence: "name", rawScore: 91, model: "m", promptVersion: 2, registryVersion: "rv", ...extra });
const OPEN_GATE = { isOpen: async () => ({ open: true }) };

function stubGraph(t, { before = { valid: true, readyForActivation: true }, after = { valid: true, readyForActivation: true } } = {}) {
  let call = 0;
  const calls = { persist: [], activate: 0, validate: 0 };
  t.mock.method(MappingGraphService, "validateWithContract", async () => { calls.validate += 1; call += 1; return call === 1 ? before : after; });
  t.mock.method(MappingGraphService, "persistVersion", async (template, graph) => { calls.persist.push(graph); return { mappingVersion: 7 }; });
  t.mock.method(MappingGraphService, "activate", async () => { calls.activate += 1; });
  return calls;
}
const apply = (extra = {}) => applyAutoUse({ template: extra.template || tpl(), suggestions: extra.suggestions || [suggestion("a"), suggestion("b")], graph: extra.graph || baseGraph(), user: { _id: "u1" }, deps: { mode: () => extra.mode || "on", gate: extra.gate === undefined ? OPEN_GATE : extra.gate, store: extra.store || { markApplied: async () => undefined }, exclusiveForms: extra.exclusiveForms || new Set() } });

test("applyAutoUse: only in mode on - off and shadow never write a mapping", async (t) => {
  const calls = stubGraph(t);
  for (const mode of ["off", "shadow"]) assert.deepEqual(await apply({ mode }), { applied: 0, skipped: "mode_not_on" });
  assert.equal(calls.persist.length, 0);
});

test("applyAutoUse: a closed, broken or missing accuracy gate changes nothing (fail closed)", async (t) => {
  const calls = stubGraph(t);
  for (const gate of [{ isOpen: async () => ({ open: false, reasons: ["precision below 99%"] }) }, { isOpen: async () => ({}) }, { isOpen: async () => ({ open: "yes" }) }, { isOpen: async () => { throw new Error("module missing"); } }, {}]) {
    const result = await apply({ gate });
    assert.equal(result.skipped, "gate_closed", JSON.stringify(result));
  }
  assert.equal(calls.persist.length, 0);
});

test("applyAutoUse: a live edition and a rule-complete (exclusive) form are never touched", async (t) => {
  const calls = stubGraph(t);
  assert.equal((await apply({ template: tpl({ status: "active" }) })).skipped, "live_edition_is_never_changed");
  assert.equal((await apply({ exclusiveForms: new Set(["I-TEST"]) })).skipped, "exclusive_form");
  assert.equal(calls.persist.length, 0);
});

test("applyAutoUse: with the gate open it adds ONLY auto_use boxes that have no edge, as a NEW version, and changes no existing edge", async (t) => {
  const calls = stubGraph(t);
  const marked = [];
  const result = await apply({
    suggestions: [suggestion("a"), suggestion("b", { tier: "needs_review" }), suggestion("c"), suggestion("d"), suggestion("e", { transient: true }), suggestion("zzz")],
    store: { markApplied: async (templateId, ids, version) => marked.push({ ids, version }) },
  });
  assert.deepEqual([result.applied, result.mappingVersion, result.activated], [1, 7, true]);
  assert.equal(calls.persist.length, 1);
  const graph = calls.persist[0];
  assert.deepEqual(graph.edges[0], existing, "the existing edge is exactly as it was");
  assert.equal(graph.edges.length, 2, "one new edge: not the needs_review box, not the mapped box, not the kept-blank box, not the transient one, not an unknown box");
  const created = graph.edges[1];
  assert.deepEqual([created.targetFieldId, created.sourcePath, created.origin, created.status], ["a", "beneficiary.firstName", "ai", "active"]);
  assert.deepEqual(created.evidence, { aiValidated: true, tier: "auto_use", model: "m", promptVersion: 2, registryVersion: "rv", rawScore: 91, reasonCode: "label_exact", labelEvidence: "name", corroboratedBy: null });
  assert.deepEqual(created.transform, { type: "direct" });
  assert.equal(calls.activate, 1, "activation goes through the normal gates");
  assert.deepEqual(marked, [{ ids: ["a"], version: 7 }]);
  assert.ok(graph.nodes.canonical.some((node) => node.path === "beneficiary.firstName"));
});

test("applyAutoUse: a corroborated box carries the transform and condition of what corroborated it", async (t) => {
  const calls = stubGraph(t);
  await apply({ suggestions: [suggestion("a", { corroboration: { source: "sibling_form", path: "beneficiary.firstName", transform: { type: "usState" }, condition: { field: "case.x", operator: "equals", value: "y" } }, corroboratedBy: "sibling_form" })] });
  const created = calls.persist[0].edges.find((edge) => edge.targetFieldId === "a");
  assert.deepEqual(created.transform, { type: "usState" });
  assert.deepEqual(created.condition, { field: "case.x", operator: "equals", value: "y" });
  assert.equal(created.evidence.corroboratedBy, "sibling_form");
});

test("applyAutoUse: it never stores an invalid graph and never turns a ready mapping into a not-ready one; a not-yet-ready mapping is saved without activation", async (t) => {
  let calls = stubGraph(t, { after: { valid: false, readyForActivation: false, errors: [{ code: "X" }] } });
  assert.equal((await apply()).skipped, "graph_would_be_invalid");
  assert.equal(calls.persist.length, 0);
  t.mock.restoreAll();
  calls = stubGraph(t, { before: { valid: true, readyForActivation: true }, after: { valid: true, readyForActivation: false } });
  assert.equal((await apply()).skipped, "would_make_a_ready_mapping_not_ready");
  assert.equal(calls.persist.length, 0);
  t.mock.restoreAll();
  calls = stubGraph(t, { before: { valid: true, readyForActivation: false }, after: { valid: true, readyForActivation: false } });
  const result = await apply();
  assert.deepEqual([result.applied, result.activated], [2, false], "both default suggestions are eligible");
  assert.equal(calls.activate, 0);
});
