// Owner decision 2026-10-23: a box that cannot be mapped is left unmapped (blank) and the import / release goes on with the boxes that can be mapped (FORM_PIPELINE_AUTONOMY=on).
// Pure parts run anywhere; the activation flow runs on REAL models in a throwaway local database (src/test-utils/pipelineDb.js; skipped when no local MongoDB answers).
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase } = require("../../../test-utils/pipelineDb");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const QuestionLibraryItem = require("../../../models/QuestionLibraryItem");
const AuditLog = require("../../../models/AuditLog");
const MappingGraphService = require("../services/MappingGraphService");
const { migrateMappingToEdition } = require("../services/EditionMigrationService");
const ReleaseGate = require("../../form-release/ReleaseGate");
const { buildLadder } = require("../../form-pipeline/stageLadder");

let db;
db = useTestDatabase({ before: test.before, after: test.after }, [USCISFormTemplate, USCISMappingVersion, QuestionLibraryItem, AuditLog]);

const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const withMode = async (mode, fn) => {
  const before = process.env.FORM_PIPELINE_AUTONOMY;
  if (mode === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = mode;
  try { return await fn(); } finally { if (before === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = before; }
};

let counter = 0;
const FIELDS = [
  { fieldId: "given", fieldName: "given", pdfFieldName: "given", label: "Given Name", fieldType: "text" },
  { fieldId: "dob", fieldName: "dob", pdfFieldName: "dob", label: "Date of Birth", fieldType: "date" },
  { fieldId: "box", fieldName: "box", pdfFieldName: "box", label: "Agree", fieldType: "checkbox" },
];
const newTemplate = (over = {}) => {
  counter += 1;
  return USCISFormTemplate.create({ formCode: `ZZ-8${String(100 + counter)}`, title: "test", version: "2026-01-01", editionDate: new Date("2026-01-01T00:00:00Z"), status: "active", mappingStatus: "draft", formFields: FIELDS.map((field) => ({ ...field })), ...over });
};
const edge = (template, targetFieldId, sourcePath, over = {}) => ({
  mappingId: `${template.formCode}:${template.version}:${targetFieldId}`, formCode: template.formCode, version: template.version, sourcePath, sourceType: "canonical", targetFieldId, targetPdfField: targetFieldId,
  targetLabel: targetFieldId, targetType: "text", section: "s", pageNumber: 1, mappingType: "direct", confidence: 95, status: "active", origin: "authored", transform: { type: "direct" }, ...over,
});
const graphOf = (template, edges) => ({
  formCode: template.formCode, version: template.version,
  nodes: { canonical: [...new Set(edges.map((item) => item.sourcePath))].map((path) => ({ id: `canonical:${path}`, path, type: "text" })), form: template.formFields.map((item) => ({ fieldId: item.fieldId })) },
  edges, unmappedTargets: [], validation: {},
});

// ---- pure ----
test("readyForPartialActivation: an error that belongs to a needs_review suggestion does not block; an error on an ACTIVE edge, or no active edge at all, does", () => {
  const nodes = { canonical: [{ path: "a.b" }], form: [{ fieldId: "f1" }, { fieldId: "f2" }] };
  const good = { mappingId: "m1", sourcePath: "a.b", targetFieldId: "f1", mappingType: "direct", status: "active" };
  const suggestion = { mappingId: "m2", sourcePath: "no.such", targetFieldId: "f2", mappingType: "direct", status: "needs_review" };
  const mixed = MappingGraphService.validateGraph({ nodes, edges: [good, suggestion], unmappedTargets: [] }, {});
  assert.equal(mixed.readyForActivation, false, "the full-activation rule is unchanged");
  assert.equal(mixed.readyForPartialActivation, true);
  const brokenActive = MappingGraphService.validateGraph({ nodes, edges: [{ ...good, sourcePath: "no.such" }, suggestion], unmappedTargets: [] }, {});
  assert.equal(brokenActive.readyForPartialActivation, false, "a fault on an active edge still blocks");
  const noneActive = MappingGraphService.validateGraph({ nodes, edges: [suggestion], unmappedTargets: [] }, {});
  assert.equal(noneActive.readyForPartialActivation, false, "nothing active: nothing to activate");
  const duplicateWithSuggestion = MappingGraphService.validateGraph({ nodes, edges: [good, { ...suggestion, targetFieldId: "f1", sourcePath: "a.b" }], unmappedTargets: [] }, {});
  assert.equal(duplicateWithSuggestion.readyForPartialActivation, true, "an active edge and a suggestion for the same box is not a duplicate-active fault");
});

test("the ladder names how many boxes were left unmapped", () => {
  const ladder = buildLadder({ template: { status: "active", mappingStatus: "active" }, versionChanged: true, migration: { activated: true }, mappingLeftUnmapped: { lost: 2, needsReview: 1 }, certification: { passed: true } });
  assert.equal(ladder.stages.mapped.status, "done");
  assert.match(ladder.stages.mapped.reason, /3 box\(es\) left unmapped/);
});

const baseTemplate = { approvedAt: new Date(), approvedBy: "u1", mappingStatus: "active", officialStatus: "official", parentVersion: "prev", importMetadata: { validationSummary: { certification: { passed: true, checks: [] } } } };
const gateDeps = (diff, inventory) => ({ policy: async () => ({ allowed: true }), editionDiff: async () => diff, inventory: async () => inventory });

test("ReleaseGate edition_diff: off/shadow still ask for approval; on passes with a note naming the boxes left unmapped; an unreadable diff is also a note in on only", async () => {
  const diff = { blocked: true, summary: { affectedMappingEdges: 4 } };
  for (const mode of [undefined, "off", "shadow"]) {
    const result = await withMode(mode, () => ReleaseGate.evaluate(baseTemplate, { deps: gateDeps(diff) }));
    assert.equal(result.decision, "approval_required", `mode ${mode}`);
  }
  const on = await withMode("on", () => ReleaseGate.evaluate(baseTemplate, { deps: gateDeps(diff) }));
  assert.equal(on.decision, "promote");
  assert.match(on.checks.find((check) => check.name === "edition_diff").detail, /4 box\(es\).*left unmapped/);
  const broken = { policy: async () => ({ allowed: true }), editionDiff: async () => { throw new Error("db"); } };
  assert.equal((await withMode("off", () => ReleaseGate.evaluate(baseTemplate, { deps: broken }))).decision, "approval_required");
  assert.equal((await withMode("on", () => ReleaseGate.evaluate(baseTemplate, { deps: broken }))).decision, "promote");
});

test("the inventory never holds an edition, whatever FORM_INVENTORY_GATE says", async () => {
  const held = { decision: "held", counts: { total: 3 }, hold: { count: 2, protectedRole: 2, required: 0, conditionalRequired: 0, roleUnknown: 0, new: 1, fields: [] } };
  const before = process.env.FORM_INVENTORY_GATE;
  process.env.FORM_INVENTORY_GATE = "enforce";
  try {
    const result = await withMode("on", () => ReleaseGate.evaluate({ ...baseTemplate, parentVersion: null }, { deps: gateDeps({ blocked: false }, held) }));
    assert.equal(result.decision, "promote");
    assert.equal(result.checks.find((check) => check.name === "inventory").wouldBe, "held");
  } finally {
    if (before === undefined) delete process.env.FORM_INVENTORY_GATE; else process.env.FORM_INVENTORY_GATE = before;
  }
});

// ---- activation on real models ----
const persistMixed = async () => {
  const template = await newTemplate();
  const version = await MappingGraphService.persistVersion(template, graphOf(template, [
    edge(template, "given", "person.firstName"),
    edge(template, "dob", "person.dob", { origin: "scored", targetType: "date" }), // a new suggestion: stored needs_review, never projected
  ]), admin);
  return { template, version };
};

test("partial activation (on) activates only the active edges; needs_review edges stay inactive and are NOT projected to autofill; off keeps refusing", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const { template, version } = await persistMixed();
  await withMode("off", async () => {
    await assert.rejects(MappingGraphService.activate(template._id, admin, {}, { partial: true }), (error) => error.status === 422, "off: the partial option is ignored");
  });
  await withMode("on", async () => {
    await assert.rejects(MappingGraphService.activate(template._id, admin, {}), (error) => error.status === 422, "without the partial option nothing changes");
    const result = await MappingGraphService.activate(template._id, admin, {}, { partial: true });
    assert.equal(result.mappingStatus, "active");
  });
  const saved = await USCISMappingVersion.findById(version._id).lean();
  assert.equal(saved.status, "active");
  assert.deepEqual(saved.graph.edges.map((item) => [item.targetFieldId, item.status]), [["given", "active"], ["dob", "needs_review"]]);
  assert.deepEqual([...MappingGraphService.graphToFieldMappings(saved.graph).keys()], ["given"], "only the active edge reaches autofill; the other box stays blank");
  const reloaded = await USCISFormTemplate.findById(template._id).lean();
  const entry = reloaded.mappingAuditHistory.at(-1);
  assert.equal(entry.partialActivation, true);
  assert.equal(entry.leftUnmapped, 1);
});

test("a contract-violating ACTIVE edge still blocks a partial activation (a real fault, not an unmappable box)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  await MappingGraphService.persistVersion(template, graphOf(template, [
    edge(template, "given", "made.up.path"), // authored + active + path nobody knows: PATH_UNKNOWN
    edge(template, "dob", "person.dob", { origin: "scored", targetType: "date" }),
  ]), admin);
  await withMode("on", async () => {
    await assert.rejects(MappingGraphService.activate(template._id, admin, {}, { partial: true }), (error) => error.status === 422 && error.details.errors.some((item) => item.code === "PATH_UNKNOWN"));
  });
});

test("a graph with no active edge is never activated, even partially", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  await MappingGraphService.persistVersion(template, graphOf(template, [edge(template, "dob", "person.dob", { origin: "scored", targetType: "date" })]), admin);
  await withMode("on", async () => {
    await assert.rejects(MappingGraphService.activate(template._id, admin, {}, { partial: true }), (error) => error.status === 422);
  });
});

// ---- a whole new edition with a box the edition removed ----
const previousEdition = async () => {
  const previous = await newTemplate({ status: "retired" });
  await MappingGraphService.persistVersion(previous, graphOf(previous, [edge(previous, "given", "person.firstName"), edge(previous, "dob", "person.dob", { targetType: "date" })]), admin);
  await MappingGraphService.activate(previous._id, admin, {});
  return previous;
};
const newEditionWithoutDob = (previous) => newTemplate({
  formCode: previous.formCode, version: "2026-09-01", editionDate: new Date("2026-09-01T00:00:00Z"), status: "review", parentVersion: previous._id,
  formFields: [FIELDS[0], FIELDS[2], { fieldId: "brandnew", fieldName: "brandnew", pdfFieldName: "brandnew", label: "Something new", fieldType: "text" }].map((field) => ({ ...field })),
});

test("a new edition that lost a mapped box: off keeps the old behaviour (not activated, 'fields removed'); shadow too; on maps the rest, leaves the lost box blank and goes on", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  for (const mode of [undefined, "shadow"]) {
    const previous = await previousEdition();
    const next = await newEditionWithoutDob(previous);
    const result = await withMode(mode, () => migrateMappingToEdition(next, admin, {}));
    assert.equal(result.activated, false, `mode ${mode}`);
    assert.equal(result.reason, "fields_removed_in_new_edition");
    assert.equal((await USCISFormTemplate.findById(next._id).lean()).mappingStatus, "draft");
  }
  const previous = await previousEdition();
  const next = await newEditionWithoutDob(previous);
  const result = await withMode("on", () => migrateMappingToEdition(next, admin, {}));
  assert.equal(result.activated, true);
  assert.equal(result.partial, true);
  assert.equal(result.leftUnmapped.lost, 1);
  const reloaded = await USCISFormTemplate.findById(next._id).lean();
  assert.equal(reloaded.mappingStatus, "active");
  const active = await USCISMappingVersion.findOne({ template: next._id, status: "active" }).lean();
  assert.deepEqual(active.graph.edges.map((item) => item.targetFieldId), ["given"], "only the box that could be mapped carries an edge");
});
