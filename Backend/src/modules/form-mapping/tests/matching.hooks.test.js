// Phase 7.3: the gated integration points. The switch is FORM_PIPELINE_AUTONOMY: OFF must change nothing at all, SHADOW only logs, ON adds matches only where the current
// logic found none. No database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { carryForwardGraph } = require("../services/EditionMigrationService");
const { matcherRenames, wrapCaseMatcher } = require("../matching/editionCarry");
const { buildMatcher } = require("../services/CaseFormEditionMigrationService");

const box = (x, y) => ({ x, y, width: 150, height: 20, left: x, bottom: y, right: x + 150, top: y + 20, coordinateSystem: { pageWidth: 612, pageHeight: 792 } });
const field = (id, name, tip, page, x, y, extra = {}) => ({ fieldId: id, fieldName: `form1[0].#subform[0].${name}`, pdfFieldName: `form1[0].#subform[0].${name}`, label: `Form 1 0 Subform 0 ${name}`, tooltip: tip, type: "text", fieldType: "text", pdfFieldType: "text", sectionTitle: "Part 1", sectionId: "part1", pageNumber: page, groupId: "part1.line1", options: [], boundingBox: box(x, y), ...extra });

const previousTemplate = { formFields: [field("family", "Pt1Line1a_FamilyName[0]", "Family Name (Last Name)", 1, 50, 700), field("given", "Pt1Line1b_GivenName[0]", "Given Name (First Name)", 1, 50, 660), field("city", "Pt1Line2_City[0]", "City or Town", 1, 50, 620)] };
// the new edition: FamilyName is now LastName (same help text, same place); GivenName and City are unchanged
const nextTemplate = { _id: "t2", formCode: "I-999", version: "2026-01-01", editionDate: "2026-01-01", title: "Test", formFields: [field("last", "Pt1Line1a_LastName[0]", "Family Name (Last Name)", 1, 50, 700), field("given", "Pt1Line1b_GivenName[0]", "Given Name (First Name)", 1, 50, 660), field("city", "Pt1Line2_City[0]", "City or Town", 1, 50, 620)] };
const edge = (id, source, target, label) => ({ mappingId: `old:${id}`, sourcePath: source, targetFieldId: id, targetPdfField: previousTemplate.formFields.find((f) => f.fieldId === id).pdfFieldName, targetLabel: label, targetType: "text", section: "Part 1", pageNumber: 1, mappingType: "direct", status: "active", confidence: 90 });
const previousGraph = { version: "old", nodes: { canonical: [{ path: "beneficiary.family", label: "x", type: "text" }, { path: "beneficiary.given" }, { path: "beneficiary.city" }], form: [] }, edges: [edge("family", "beneficiary.family", "last", "Form 1 0 Subform 0 Pt1Line1a_FamilyName[0]"), edge("given", "beneficiary.given", "given", "g"), edge("city", "beneficiary.city", "city", "c")] };

const withMode = (mode, fn) => {
  const saved = process.env.FORM_PIPELINE_AUTONOMY;
  if (mode === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = mode;
  try { return fn(); } finally { if (saved === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = saved; }
};
const carry = (mode) => withMode(mode, () => carryForwardGraph(JSON.parse(JSON.stringify(previousGraph)), JSON.parse(JSON.stringify(nextTemplate)), { previousTemplate }));

test("OFF (the default): the renamed field is lost exactly as today, and nothing is logged or computed by the matcher", () => {
  const a = carry(undefined);
  const b = carry("off");
  assert.deepEqual(a.lostEdges.map((item) => item.mappingId), ["old:family"]);
  assert.equal(a.renamedEdges.length, 0);
  assert.equal(JSON.stringify(a.lostEdges), JSON.stringify(b.lostEdges));
  assert.equal(a.graph.edges.length, 2);
});

test("SHADOW: identical result to off; the matcher only reports what it would carry", () => {
  const logs = [];
  const off = carry("off");
  const shadow = carry("shadow");
  assert.equal(JSON.stringify(shadow.lostEdges), JSON.stringify(off.lostEdges));
  assert.equal(shadow.graph.edges.length, off.graph.edges.length);
  const result = matcherRenames({ previousEdges: previousGraph.edges, exact: [null, "x", "y"], renames: [null, null, null], targetFields: nextTemplate.formFields.map((f) => ({ ...f, targetFieldId: f.fieldId, targetPdfField: f.pdfFieldName, label: f.label, type: f.type, section: f.sectionTitle })), claimed: new Set(["given", "city"]), previousTemplate, previousGraph, formCode: "I-999", mode: "shadow", log: { warn: (message, data) => logs.push([message, data]) } });
  assert.deepEqual(result, [null, null, null]);
  assert.equal(logs[0][0], "field_matcher_shadow_carry_forward");
  assert.equal(logs[0][1].wouldCarry, 1);
  assert.equal(logs[0][1].currentlyLost, 1);
});

test("ON: the renamed field is carried as needs_review (never active) and reported as a rename with its matcher evidence", () => {
  const on = carry("on");
  assert.equal(on.lostEdges.length, 0);
  assert.equal(on.renamedEdges.length, 1);
  const carried = on.graph.edges.find((item) => item.targetFieldId === "last");
  assert.ok(carried);
  assert.equal(carried.status, "needs_review");
  assert.ok(carried.confidence <= 60);
  assert.equal(carried.evidence.renamedFrom.pdfField, previousGraph.edges[0].targetPdfField);
  assert.equal(on.graph.edges.filter((item) => item.status === "active").length, 2, "the unchanged fields stay active exactly as before");
});

test("ON never touches an edge the current logic already carried (exact or strict rename)", () => {
  const on = carry("on");
  const off = carry("off");
  for (const id of ["given", "city"]) {
    const strip = (item) => { const { createdAt, ...rest } = item; return JSON.stringify(rest); };
    assert.equal(strip(on.graph.edges.find((item) => item.targetFieldId === id)), strip(off.graph.edges.find((item) => item.targetFieldId === id)));
  }
});

test("ON refuses an ambiguous or incompatible candidate: it stays lost", () => {
  const twin = { ...nextTemplate, formFields: [...nextTemplate.formFields, field("last2", "Pt1Line1a_LastName2[0]", "Family Name (Last Name)", 1, 50, 700)] };
  const a = withMode("on", () => carryForwardGraph(JSON.parse(JSON.stringify(previousGraph)), JSON.parse(JSON.stringify(twin)), { previousTemplate }));
  assert.equal(a.renamedEdges.length, 0);
  assert.deepEqual(a.lostEdges.map((item) => item.mappingId), ["old:family"]);
  const checkbox = { ...nextTemplate, formFields: nextTemplate.formFields.map((f) => (f.fieldId === "last" ? { ...f, type: "checkbox", fieldType: "checkbox", pdfFieldType: "checkbox" } : f)) };
  const b = withMode("on", () => carryForwardGraph(JSON.parse(JSON.stringify(previousGraph)), JSON.parse(JSON.stringify(checkbox)), { previousTemplate }));
  assert.equal(b.renamedEdges.length, 0);
});

test("without the previous template the matcher still works from the graph's own edge data (degraded, medium at best)", () => {
  const result = withMode("on", () => carryForwardGraph(JSON.parse(JSON.stringify(previousGraph)), JSON.parse(JSON.stringify(nextTemplate)), {}));
  assert.ok(result.graph.edges.every((item) => item.status === "active" || item.status === "needs_review"));
  assert.ok(result.renamedEdges.length <= 1);
});

// ---- case-form migration -------------------------------------------------------------------------------------------------------------------------------------------
test("case migration: OFF returns the very same matcher function (identity), SHADOW too, ON only fills gaps", () => {
  const logs = [];
  const current = (path) => (path === "given" ? nextTemplate.formFields[1] : undefined);
  const off = wrapCaseMatcher({ current, oldTemplate: previousTemplate, newTemplate: nextTemplate, mode: "off" });
  assert.equal(off.match, current);
  const shadow = wrapCaseMatcher({ current, oldTemplate: previousTemplate, newTemplate: nextTemplate, mode: "shadow", log: { warn: (message, data) => logs.push([message, data]) } });
  assert.equal(shadow.match, current);
  assert.equal(logs[0][0], "field_matcher_shadow_case_migration");
  assert.ok(logs[0][1].matcherWouldResolve >= 1);
  const on = wrapCaseMatcher({ current, oldTemplate: previousTemplate, newTemplate: nextTemplate, mode: "on" });
  assert.equal(on.match("given"), nextTemplate.formFields[1], "what the current logic found is never replaced");
  assert.equal(on.match("family").fieldId, "last", "a value that had no home now follows the renamed box (high confidence only)");
  assert.equal(on.match("no.such.key"), undefined);
});

test("case migration: the exact-name conflict list reports a changed widget kind and is exposed on the matcher (not applied)", () => {
  const conflicting = { ...nextTemplate, _id: "t3", formFields: nextTemplate.formFields.map((f) => (f.fieldId === "given" ? { ...f, fieldName: previousTemplate.formFields[1].fieldName, pdfFieldName: previousTemplate.formFields[1].pdfFieldName, type: "checkbox", fieldType: "checkbox", pdfFieldType: "checkbox" } : f)) };
  const wrapped = wrapCaseMatcher({ current: () => undefined, oldTemplate: previousTemplate, newTemplate: conflicting, mode: "on" });
  assert.ok(wrapped.conflicts.some((item) => item.oldId === "given" && item.severity === "hard" && item.reasons.includes("kind_differs")));
  assert.equal(wrapped.match("given"), undefined, "a value is never carried into a different kind of box");
});

test("buildMatcher keeps its contract with the switch off (same results as the exact / base-name / rename lookup)", () => {
  const match = withMode("off", () => buildMatcher(previousTemplate, nextTemplate));
  assert.equal(match("given").fieldId, "given");
  // today's loose FieldDiffService rename (shared characters in the label) is part of the CURRENT logic and is unchanged while the switch is off
  assert.equal(match("family").fieldId, "last");
  assert.equal(match.conflicts, undefined);
});

test("a failing matcher never throws into its caller", () => {
  const broken = { formFields: [null] };
  assert.doesNotThrow(() => wrapCaseMatcher({ current: () => undefined, oldTemplate: broken, newTemplate: broken, mode: "on", log: { warn() {} } }));
  assert.doesNotThrow(() => matcherRenames({ previousEdges: [{}], exact: [null], renames: [null], targetFields: [null], claimed: new Set(), mode: "on", log: { warn() {} } }));
});
