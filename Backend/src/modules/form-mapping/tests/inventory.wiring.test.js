// Phase 7.4 wiring: synthetic edition pairs (pdf-lib), the carry-forward hook, the stored coverage summary, the ReleaseGate check and the per-form status - and, for every one
// of them, the proof that with FORM_PIPELINE_AUTONOMY off NOTHING changes. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const mutants = require("../../../test-utils/editionMutants");
const FieldInventory = require("../inventory/FieldInventory");
const { inventoryForCarry, inventoryForCoverage } = require("../inventory/editionCarry");
const { carryForwardGraph } = require("../services/EditionMigrationService");
const { computeCoverage } = require("../contract/MappingCoverageService");
const MappingGraphService = require("../services/MappingGraphService");
const ReleaseGate = require("../../form-release/ReleaseGate");
const { formStatus, inventoryStatus } = require("../../form-governance/FormStatusService");

const quiet = { info() {}, warn() {}, error() {} };
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.entries(vars).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  try { return await fn(); } finally { Object.entries(saved).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; }); }
}

// ---- synthetic edition pair built with pdf-lib (flat names; the mutants rename / remove / add boxes) ----
const NAMES = ["Pt1_BeneficiaryGivenName", "Pt1_BeneficiaryFamilyName", "Pt1_PetitionerName", "Pt2_Remarks", "Pt2_BeneficiaryPassport"];
async function buildPdf(names) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  names.forEach((name, index) => pdf.getForm().createTextField(name).addToPage(page, { x: 50, y: 700 - index * 30, width: 200, height: 20 }));
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
const PRINTED = { Pt1_BeneficiaryFirstNameRenamed: "Beneficiary Given Name" }; // a renamed box keeps the label USCIS prints
const labelOf = (name) => PRINTED[name] || name.replace(/^Pt\d_/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
async function fieldsOf(bytes) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdf.getForm().getFields().map((item) => ({ fieldId: item.getName(), pdfFieldName: item.getName(), label: labelOf(item.getName()), fieldType: "text", sectionTitle: "Part 1", pageNumber: 1 }));
}
const edge = (id, label, over = {}) => ({ mappingId: `X:old:${id}`, targetFieldId: id, targetPdfField: id, targetLabel: label, targetType: "text", section: "Part 1", sourcePath: `beneficiary.${id}`, status: "active", confidence: 90, ...over });
const template = (fields, over = {}) => ({ _id: "t2", formCode: "X-1", version: "2026-02-01", editionDate: "2026-02-01", title: "X", formFields: fields, ...over });

test("synthetic pair: an added protected-role box is NEW, listed, and holds the gate; a removed box is reported; a renamed box is carried", async () => {
  const old = await buildPdf(NAMES);
  const withNew = (await mutants.insertPage(old, { index: 1, headingText: "Supplement Z", fieldName: "Pt9_BeneficiaryMotherName" })).buffer;
  const renamed = (await mutants.renameFields(withNew, { Pt1_BeneficiaryGivenName: "Pt1_BeneficiaryFirstNameRenamed" })).buffer;
  const removed = (await mutants.removeFields(renamed, ["Pt2_Remarks"])).buffer;
  const oldFields = await fieldsOf(old);
  const newFields = await fieldsOf(removed);
  const previousGraph = { version: "old", edges: oldFields.filter((item) => /Beneficiary|Petitioner/.test(item.fieldId)).map((item) => edge(item.fieldId, item.label)), nodes: { canonical: [] } };
  await withEnv({ FORM_PIPELINE_AUTONOMY: "on", FORM_INVENTORY_GATE: undefined }, () => {
    const { graph, lostEdges, renamedEdges } = carryForwardGraph(previousGraph, template(newFields), { previousTemplate: template(oldFields, { _id: "t1" }) });
    assert.ok(graph.inventory, "the inventory summary is stored on the graph when the switch is on");
    assert.equal(graph.inventory.previous.removed, 1, "Pt2_Remarks is gone");
    assert.ok(graph.inventory.previous.new >= 1, "the added box is new");
    assert.ok(graph.inventory.previous.newIds.includes("Pt9_BeneficiaryMotherName"));
    assert.equal(graph.inventory.decision, "held");
    assert.ok(graph.inventory.hold.fields.some((entry) => entry.id === "Pt9_BeneficiaryMotherName" && entry.isNew && entry.role === "beneficiary"));
    assert.equal(renamedEdges.length, 1, "the renamed box is carried, not lost");
    assert.equal(lostEdges.length, 0);
    assert.deepEqual(graph.unmappedTargets, [], "report mode: activation is not touched");
  });
});

test("carry-forward hook: off = no inventory, graph byte-for-byte as before; shadow = the same graph (only a log line); on = summary only (FORM_INVENTORY_GATE=enforce is ignored)", async () => {
  const fields = [{ fieldId: "A", pdfFieldName: "A", label: "Beneficiary Given Name", fieldType: "text", sectionTitle: "Part 1", pageNumber: 1 }, { fieldId: "B", pdfFieldName: "B", label: "Petitioner Name", fieldType: "text", sectionTitle: "Part 1", pageNumber: 1 }];
  const previous = { version: "old", edges: [edge("A", "Beneficiary Given Name")], nodes: { canonical: [] } };
  const run = (env) => withEnv({ FORM_INVENTORY_GATE: undefined, ...env }, () => carryForwardGraph(JSON.parse(JSON.stringify(previous)), template(JSON.parse(JSON.stringify(fields)))));
  const strip = (graph) => JSON.parse(JSON.stringify({ ...graph, edges: graph.edges.map(({ createdAt, ...rest }) => rest) }));
  const off = await run({ FORM_PIPELINE_AUTONOMY: "off" });
  const unset = await run({ FORM_PIPELINE_AUTONOMY: undefined });
  const shadow = await run({ FORM_PIPELINE_AUTONOMY: "shadow" });
  const on = await run({ FORM_PIPELINE_AUTONOMY: "on" });
  const enforce = await run({ FORM_PIPELINE_AUTONOMY: "on", FORM_INVENTORY_GATE: "enforce" });
  assert.equal("inventory" in off.graph, false);
  assert.deepEqual(strip(off.graph), strip(unset.graph));
  assert.deepEqual(strip(shadow.graph), strip(off.graph), "shadow changes nothing");
  assert.equal(on.graph.inventory.decision, "held");
  assert.deepEqual(on.graph.unmappedTargets, [], "report mode never touches the activation readiness");
  assert.equal(on.graph.validation.readyForActivation, off.graph.validation.readyForActivation);
  assert.deepEqual(enforce.graph.unmappedTargets, [], "enforce is ignored: the box without a source is left blank, activation is never blocked by it");
  assert.equal(enforce.graph.validation.readyForActivation, on.graph.validation.readyForActivation);
});

test("inventoryForCarry / inventoryForCoverage never throw and return null when off", () => {
  assert.equal(inventoryForCarry({ mode: "off", template: {}, graph: {}, targetFields: [] }), null);
  assert.equal(inventoryForCoverage({ mode: "off", template: {}, graph: {}, fields: [] }), null);
  assert.equal(inventoryForCarry({ mode: "on", template: null, graph: null, targetFields: [{ get id() { throw new Error("boom"); } }], log: quiet }), null);
});

test("coverage report: the inventory key exists only when the switch is on (off = the report is unchanged)", async () => {
  const fields = [{ fieldId: "A", pdfFieldName: "A", label: "Beneficiary Given Name", fieldType: "text" }];
  const graph = { edges: [], keepBlank: [] };
  const args = { template: { formCode: "X-1", formFields: fields }, graph, universe: { check: () => ({ known: true }) }, getTemplateFields: (t) => MappingGraphService.getTemplateFields(t) };
  const off = await withEnv({ FORM_PIPELINE_AUTONOMY: "off" }, () => computeCoverage(args));
  const on = await withEnv({ FORM_PIPELINE_AUTONOMY: "on" }, () => computeCoverage(args));
  assert.equal("inventory" in off, false);
  assert.equal(on.inventory.decision, "held");
  const { generatedAt: _a, ...offRest } = off;
  const { generatedAt: _b, inventory: _i, ...onRest } = on;
  assert.deepEqual(onRest, offRest, "everything else in the report is identical");
});

// ---- ReleaseGate ----
const baseTemplate = { approvedAt: new Date(), approvedBy: "u1", mappingStatus: "active", officialStatus: "official", parentVersion: null, importMetadata: { validationSummary: { certification: { passed: true, checks: [] } } } };
const deps = (inventory) => ({ policy: async () => ({ allowed: true }), editionDiff: async () => ({ blocked: false }), inventory: async () => inventory });
const heldSummary = { decision: "held", counts: { total: 3 }, hold: { count: 2, protectedRole: 2, required: 0, conditionalRequired: 0, roleUnknown: 0, new: 1, fields: [] } };

test("ReleaseGate: with the switch off the decision AND the checks list are exactly what they were (no inventory check at all)", async () => {
  const off = await withEnv({ FORM_PIPELINE_AUTONOMY: "off" }, () => ReleaseGate.evaluate(baseTemplate, { deps: deps(heldSummary) }));
  assert.equal(off.checks.some((check) => check.name === "inventory"), false);
  const baseline = await withEnv({ FORM_PIPELINE_AUTONOMY: undefined }, () => ReleaseGate.evaluate(baseTemplate, { deps: { policy: async () => ({ allowed: true }), editionDiff: async () => ({ blocked: false }) } }));
  assert.deepEqual(off.checks, baseline.checks);
  assert.equal(off.decision, baseline.decision);
});

test("ReleaseGate: shadow adds no check; on adds a PASSING check that carries the would-be decision (the decision does not move); enforce is ignored", async () => {
  const shadow = await withEnv({ FORM_PIPELINE_AUTONOMY: "shadow" }, () => ReleaseGate.evaluate(baseTemplate, { deps: deps(heldSummary) }));
  assert.equal(shadow.checks.some((check) => check.name === "inventory"), false);
  const baseline = await withEnv({ FORM_PIPELINE_AUTONOMY: "off" }, () => ReleaseGate.evaluate(baseTemplate, { deps: deps(heldSummary) }));
  const report = await withEnv({ FORM_PIPELINE_AUTONOMY: "on", FORM_INVENTORY_GATE: undefined }, () => ReleaseGate.evaluate(baseTemplate, { deps: deps(heldSummary) }));
  const check = report.checks.find((item) => item.name === "inventory");
  assert.deepEqual([check.outcome, check.wouldBe, check.report], ["pass", "held", true]);
  assert.equal(report.decision, baseline.decision, "report mode never changes the decision");
  assert.equal(report.canPromote, baseline.canPromote);
  const enforce = await withEnv({ FORM_PIPELINE_AUTONOMY: "on", FORM_INVENTORY_GATE: "enforce" }, () => ReleaseGate.evaluate(baseTemplate, { deps: deps(heldSummary) }));
  assert.equal(enforce.decision, baseline.decision, "FORM_INVENTORY_GATE=enforce is ignored: the inventory never holds an edition");
  assert.equal(enforce.canPromote, baseline.canPromote);
  const clean = await withEnv({ FORM_PIPELINE_AUTONOMY: "on", FORM_INVENTORY_GATE: "enforce" }, () => ReleaseGate.evaluate(baseTemplate, { deps: deps({ decision: "pass", counts: {}, hold: { count: 0 } }) }));
  assert.equal(clean.decision, "promote");
});

test("ReleaseGate: an unreadable inventory is only a note, enforce or not", async () => {
  const broken = { policy: async () => ({ allowed: true }), editionDiff: async () => ({ blocked: false }), inventory: async () => { throw new Error("db down"); } };
  const report = await withEnv({ FORM_PIPELINE_AUTONOMY: "on", FORM_INVENTORY_GATE: undefined }, () => ReleaseGate.evaluate(baseTemplate, { deps: broken }));
  assert.equal(report.decision, "promote");
  const enforce = await withEnv({ FORM_PIPELINE_AUTONOMY: "on", FORM_INVENTORY_GATE: "enforce" }, () => ReleaseGate.evaluate(baseTemplate, { deps: broken }));
  assert.equal(enforce.decision, "promote");
});

// ---- per-form status ----
test("FormStatus: the inventory is shown only while the switch is on; nothing else about the status changes", async () => {
  const model = (doc) => ({ find: () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [doc] }) }) }) }), findOne: () => ({ sort: () => ({ select: () => ({ lean: async () => doc }) }) }) });
  const template = { _id: "t1", formCode: "X-1", version: "v", status: "active", mappingStatus: "active", importMetadata: {}, lifecycle: {} };
  const version = { mappingVersion: 3, status: "active", validation: { coverage: { fields: { total: 3, mapped: 1, requiredUnmapped: 0 }, inventory: heldSummary } } };
  const d = {
    Template: model(template), MappingVersion: model(version), Job: model(null), Report: model(null), now: () => new Date("2026-10-22T00:00:00Z"),
    peekAcceptance: async () => ({ allowed: true }), releaseGate: { evaluate: async () => ({ decision: "promote", checks: [] }) },
  };
  const off = await withEnv({ FORM_PIPELINE_AUTONOMY: "off" }, () => formStatus("X-1", d));
  const on = await withEnv({ FORM_PIPELINE_AUTONOMY: "on" }, () => formStatus("X-1", d));
  assert.equal("inventory" in off.statuses, false);
  assert.equal(on.statuses.inventory.decision, "held");
  assert.equal(on.statuses.inventory.holdCount, 2);
  const { inventory: _drop, ...onRest } = on.statuses;
  assert.deepEqual(onRest, off.statuses);
  assert.equal(inventoryStatus(null).state, "unknown");
});
