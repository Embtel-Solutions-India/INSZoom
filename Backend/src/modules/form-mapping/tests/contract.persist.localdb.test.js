// Phase 2 on REAL models (a throwaway local database, see src/test-utils/pipelineDb.js): the policy and contract applied when a graph is stored, activation as the
// hard gate for new / changed edges, the manual edit API, the read-time projection and the coverage report.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase } = require("../../../test-utils/pipelineDb");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const QuestionLibraryItem = require("../../../models/QuestionLibraryItem");
const AuditLog = require("../../../models/AuditLog");
const MappingGraphService = require("../services/MappingGraphService");
const FormMappingService = require("../services/FormMappingService");

let db;
db = useTestDatabase({ before: test.before, after: test.after }, [USCISFormTemplate, USCISMappingVersion, QuestionLibraryItem, AuditLog]);

const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };
let counter = 0;
const newTemplate = async (over = {}) => {
  counter += 1;
  const formCode = `ZZ-9${String(100 + counter)}`;
  return USCISFormTemplate.create({
    formCode, title: "test", version: "2026-01-01", editionDate: new Date("2026-01-01T00:00:00Z"), status: "active", mappingStatus: "draft",
    formFields: [
      { fieldId: "given", fieldName: "given", pdfFieldName: "given", label: "Given Name", fieldType: "text", required: true },
      { fieldId: "dob", fieldName: "dob", pdfFieldName: "dob", label: "Date of Birth", fieldType: "date" },
      { fieldId: "box", fieldName: "box", pdfFieldName: "box", label: "Agree", fieldType: "checkbox" },
    ],
    ...over,
  });
};
const edge = (template, targetFieldId, sourcePath, over = {}) => ({
  mappingId: `${template.formCode}:${template.version}:${targetFieldId}`, formCode: template.formCode, version: template.version, sourcePath, sourceType: "canonical", targetFieldId, targetPdfField: targetFieldId,
  targetLabel: targetFieldId, targetType: "text", section: "s", pageNumber: 1, mappingType: "direct", confidence: 95, status: "active", transform: { type: "direct" }, ...over,
});
const graphOf = (template, edges) => ({
  formCode: template.formCode, version: template.version,
  nodes: { canonical: [...new Set(edges.map((item) => item.sourcePath))].map((path) => ({ id: `canonical:${path}`, path, type: "text" })), form: template.formFields.map((item) => ({ fieldId: item.fieldId })) },
  edges, unmappedTargets: [], validation: {},
});
const stored = (version) => USCISMappingVersion.findById(version._id).lean();

test("storing a graph stamps origins (unknown provenance = legacy), attaches the contract verdict and a compact coverage report to the VERSION, and keeps every edge", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  const graph = graphOf(template, [edge(template, "given", "person.firstName"), edge(template, "dob", "person.dob", { targetType: "date" })]);
  const version = await MappingGraphService.persistVersion(template, graph, admin);
  const saved = await stored(version);
  assert.deepEqual(saved.graph.edges.map((item) => [item.targetFieldId, item.origin, item.status]), [["given", "legacy", "active"], ["dob", "legacy", "active"]]);
  assert.equal(saved.validation.contract.valid, true);
  assert.equal(saved.validation.contract.summary.legacyEdges, 2);
  assert.equal(saved.validation.coverage.fields.total, 3);
  assert.equal(saved.validation.coverage.fields.mapped, 2);
  assert.equal(saved.validation.coverage.edges.byOrigin.legacy, 2);
  assert.ok(JSON.stringify(saved.validation.coverage).length < 6000);
  assert.equal(String(template.latestMappingVersionId), String(version._id));
});

test("a NEW scored / ai suggestion is stored as needs_review and is never projected to autofill; an authored edge stays active", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  const graph = graphOf(template, [edge(template, "given", "person.firstName", { origin: "scored" }), edge(template, "dob", "person.dob", { origin: "authored", targetType: "date" })]);
  const version = await MappingGraphService.persistVersion(template, graph, admin);
  const saved = await stored(version);
  assert.deepEqual(saved.graph.edges.map((item) => [item.targetFieldId, item.status]), [["given", "needs_review"], ["dob", "active"]]);
  assert.equal(saved.graph.edges[0].evidence.downgradedFrom, "active");
  assert.equal(saved.status, "needs_review", "the version needs a person before it can go live");
  const byTarget = MappingGraphService.graphToFieldMappings(saved.graph);
  assert.deepEqual([...byTarget.keys()], ["dob"]);
});

test("a lower-ranked edge cannot replace the LIVE higher-ranked one: it is kept and the attempt is recorded in conflicts[]", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  const live = await MappingGraphService.persistVersion(template, graphOf(template, [edge(template, "given", "person.firstName", { origin: "authored", mappingId: "live" })]), admin);
  await USCISMappingVersion.updateOne({ _id: live._id }, { $set: { status: "active" } });
  const attempt = await MappingGraphService.persistVersion(template, graphOf(template, [edge(template, "given", "person.lastName", { origin: "scored", mappingId: "guess" })]), admin);
  const saved = await stored(attempt);
  assert.equal(saved.graph.edges[0].mappingId, "live");
  assert.equal(saved.graph.edges[0].sourcePath, "person.firstName");
  assert.deepEqual([saved.graph.conflicts.length, saved.graph.conflicts[0].rejected.origin], [1, "scored"]);
  // a legacy edge that is live is defended the same way against an ai suggestion
  const second = await newTemplate();
  const liveLegacy = await MappingGraphService.persistVersion(second, graphOf(second, [edge(second, "given", "person.firstName")]), admin);
  await USCISMappingVersion.updateOne({ _id: liveLegacy._id }, { $set: { status: "active" } });
  const ai = await MappingGraphService.persistVersion(second, graphOf(second, [edge(second, "given", "person.lastName", { origin: "ai" })]), admin);
  assert.equal((await stored(ai)).graph.edges[0].sourcePath, "person.firstName");
});

test("a NEW edge that breaks the contract makes the version invalid, and activation (the hard gate) refuses it with the reasons; a legacy violation never does", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const bad = await newTemplate();
  const version = await MappingGraphService.persistVersion(bad, graphOf(bad, [
    edge(bad, "given", "made.up.path", { origin: "authored" }), edge(bad, "dob", "person.dob", { origin: "authored", targetType: "date" }), edge(bad, "box", "person.dob", { origin: "authored", targetType: "checkbox" }),
  ]), admin);
  const saved = await stored(version);
  assert.equal(saved.validation.valid, false);
  assert.equal(saved.validation.readyForActivation, false);
  assert.deepEqual(saved.validation.errors.filter((item) => item.source === "contract").map((item) => item.code).sort(), ["PATH_UNKNOWN", "TYPE_INCOMPATIBLE"]);
  assert.equal(saved.status, "needs_review");
  await assert.rejects(MappingGraphService.activate(bad._id, admin, {}), (error) => error.status === 422 && error.details.errors.some((item) => item.code === "PATH_UNKNOWN"));

  const good = await newTemplate();
  await MappingGraphService.persistVersion(good, graphOf(good, [
    edge(good, "given", "person.firstName", { origin: "authored" }), edge(good, "dob", "person.dob", { origin: "authored", targetType: "date" }), edge(good, "box", "person.gender", { origin: "authored", targetType: "checkbox", transform: { type: "boolean" } }),
  ]), admin);
  const activated = await MappingGraphService.activate(good._id, admin, {});
  assert.equal(activated.mappingStatus, "active");

  const legacy = await newTemplate();
  await MappingGraphService.persistVersion(legacy, graphOf(legacy, [
    edge(legacy, "given", "made.up.path"), edge(legacy, "dob", "person.dob", { targetType: "date" }), edge(legacy, "box", "person.gender", { targetType: "checkbox", transform: { type: "boolean" } }),
  ]), admin);
  assert.equal((await MappingGraphService.activate(legacy._id, admin, {})).mappingStatus, "active", "report-only: legacy findings are listed, never blocking");
  const legacyValidation = await MappingGraphService.validateWithContract(await MappingGraphService.loadCurrentGraph(legacy), legacy);
  assert.equal(legacyValidation.contract.summary.legacyViolations, 1);
});

test("manual edits: an admin's edge is stored AUTHORED and reviewed; one that breaks the contract is refused (422) unless it is only a needs_review suggestion", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  const saved = await MappingGraphService.upsertMapping(template._id, { targetFieldId: "given", sourcePath: "person.firstName" }, admin, {});
  assert.equal(saved.edge.origin, "authored");
  assert.equal(String(saved.edge.reviewedBy), String(admin._id));
  assert.ok(saved.edge.reviewedAt);
  const version = await USCISMappingVersion.findById(saved.mappingVersionId).lean();
  assert.equal(version.graph.edges.find((item) => item.targetFieldId === "given").origin, "authored");

  await assert.rejects(MappingGraphService.upsertMapping(template._id, { targetFieldId: "box", sourcePath: "person.dob", mappingType: "direct" }, admin, {}), (error) => error.status === 422 && error.code === "MAPPING_CONTRACT_VIOLATION" && /date value cannot fill/.test(error.message));
  const suggestion = await MappingGraphService.upsertMapping(template._id, { targetFieldId: "box", sourcePath: "person.dob", status: "needs_review" }, admin, {});
  assert.equal(suggestion.edge.status, "needs_review", "a violating edge may be stored for review, but never live");
  const ok = await MappingGraphService.upsertMapping(template._id, { targetFieldId: "box", sourcePath: "person.gender", mappingType: "boolean", transform: { type: "boolean" } }, admin, {});
  assert.equal(ok.edge.status, "active");
});

test("read-time projection on a real template: only the ACTIVE edges of the active mapping version reach the field mappings", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  const version = await MappingGraphService.persistVersion(template, graphOf(template, [
    edge(template, "given", "person.firstName", { origin: "authored" }), edge(template, "dob", "person.dob", { origin: "authored", status: "needs_review", targetType: "date" }),
  ]), admin);
  await USCISMappingVersion.updateOne({ _id: version._id }, { $set: { status: "active" } });
  await USCISFormTemplate.updateOne({ _id: template._id }, { $set: { activeMappingVersionId: version._id, mappingStatus: "active", status: "active" } });
  const loaded = await FormMappingService.loadTemplate(template.formCode);
  const byField = Object.fromEntries(loaded.formFields.map((field) => [field.fieldId, field.mappings.map((mapping) => mapping.path)]));
  assert.deepEqual(byField, { given: ["person.firstName"], dob: [], box: [] });
});

test("the coverage report for a stored mapping lists what is missing, by class, without writing anything", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  await MappingGraphService.persistVersion(template, graphOf(template, [edge(template, "dob", "person.dob", { origin: "authored", targetType: "date" })]), admin);
  await QuestionLibraryItem.collection.insertOne({ canonicalPath: "person.firstName", active: true, sources: [{ formTemplate: template._id, fieldId: "given" }], question: "q" });
  const before = await USCISMappingVersion.countDocuments();
  const { coverage } = await MappingGraphService.coverage(template._id);
  assert.equal(coverage.fields.mapped, 1);
  assert.deepEqual(coverage.fields.requiredUnmappedFields, ["given"]);
  assert.deepEqual(coverage.questions.paths, ["person.firstName"], "a question for this form that no active edge reads");
  assert.equal(await USCISMappingVersion.countDocuments(), before, "read-only");
  await assert.rejects(MappingGraphService.coverage(new mongoose.Types.ObjectId()), (error) => error.status === 404 || /not found/i.test(error.message));
});

test("Keep blank on real models: saved as a new version, survives a rebuild from scratch, blocks a suggestion, is not a gap for activation, and mapping the box again takes it back", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const template = await newTemplate();
  await MappingGraphService.persistVersion(template, graphOf(template, [edge(template, "given", "person.firstName", { origin: "authored" }), edge(template, "dob", "person.dob", { targetType: "date", origin: "authored" })]), admin);
  await MappingGraphService.activate(template._id, admin, null).catch(() => null); // may need review in this tiny template; the kept-blank save below is what is tested

  // 1. the box "dob" is kept blank: its mapping is gone, the decision is stored with who / why, and it is a new mapping version
  const result = await MappingGraphService.setKeepBlank(template._id, { targetFieldId: "dob", keepBlank: true, reason: "USCIS: leave empty" }, admin, null);
  assert.equal(result.removedMapping, "person.dob");
  const saved = await stored({ _id: result.mappingVersionId });
  assert.deepEqual(saved.graph.edges.map((item) => item.targetFieldId), ["given"]);
  assert.equal(saved.graph.keepBlank[0].targetFieldId, "dob");
  assert.equal(saved.graph.keepBlank[0].reason, "USCIS: leave empty");
  assert.equal(saved.validation.coverage.fields.keptBlank, 1);

  // 2. a graph rebuilt from scratch that knows nothing of the decision (auto-suggest) cannot bring the box back: it inherits the list and its edge is dropped
  const fresh = template.toObject ? await USCISFormTemplate.findById(template._id) : template;
  const rebuilt = graphOf(fresh, [edge(fresh, "given", "person.firstName", { origin: "authored" }), edge(fresh, "dob", "person.dob", { targetType: "date", origin: "scored", status: "needs_review" })]);
  await USCISMappingVersion.updateMany({ template: template._id }, { $set: { status: "retired" } });
  await USCISMappingVersion.updateOne({ _id: result.mappingVersionId }, { $set: { status: "active" } });
  const again = await MappingGraphService.persistVersion(fresh, rebuilt, admin);
  const savedAgain = await stored(again);
  assert.deepEqual(savedAgain.graph.edges.map((item) => item.targetFieldId), ["given"]);
  assert.equal(savedAgain.graph.keepBlank.length, 1);
  assert.ok(savedAgain.graph.conflicts.some((item) => item.code === "KEPT_BLANK" && item.targetFieldId === "dob"));
  assert.equal(savedAgain.validation.summary.unmapped, 0); // a kept-blank box is not a gap

  // 3. the live projection gives that box no mapping and no default value
  const projected = FormMappingService.applyMappingGraph({ formFields: [{ fieldId: "dob", defaultValue: "01/01/1900" }, { fieldId: "given" }] }, savedAgain);
  assert.equal(projected.formFields[0].keepBlank, true);
  assert.deepEqual(FormMappingService.normalizeMappings(projected.formFields[0]), []);

  // 4. mapping the box on purpose takes the decision back
  const mappedAgain = await MappingGraphService.upsertMapping(template._id, { targetFieldId: "dob", sourcePath: "person.dob", mappingType: "direct" }, admin, null);
  assert.deepEqual(mappedAgain.graph.keepBlank, []);
  assert.ok(mappedAgain.graph.edges.some((item) => item.targetFieldId === "dob"));

  // 5. and the decision can be withdrawn without mapping
  await MappingGraphService.setKeepBlank(template._id, { targetFieldId: "box", keepBlank: true }, admin, null);
  const withdrawn = await MappingGraphService.setKeepBlank(template._id, { targetFieldId: "box", keepBlank: false }, admin, null);
  assert.deepEqual(withdrawn.graph.keepBlank, []);
});
