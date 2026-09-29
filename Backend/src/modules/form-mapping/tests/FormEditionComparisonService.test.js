// Phase 3J: USCIS form edition-change governance.
//
// Connects to the REAL configured MongoDB (like h1-i129-mapping.test.js and
// i539a-mapping-graph.test.js) because MappingGraphService.activate() and
// FormEditionComparisonService both read/write real USCISFormTemplate /
// USCISMappingVersion documents. Two kinds of fixtures are used, per the
// task's own instruction not to pollute master data:
//   - A real, already-existing edition pair on file (I-129 2026-02-27 ->
//     2026-09-09, linked via parentVersion) for the "no breaking changes"
//     case - read-only, nothing is written to these documents.
//   - Disposable, throwaway USCISFormTemplate/USCISMappingVersion documents
//     (formCode prefixed "ZZ-EDN-TEST-<runId>", created and deleted by this
//     file only) for the cases that need a genuine, controlled field
//     removal - since the live DB has no real edition pair where a removed
//     field actually breaks a mapped edge (checked: I-129's real pair adds
//     one field and renames one, but neither is mapped by the active
//     graph).
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const MappingGraphService = require("../services/MappingGraphService");
const FormEditionComparisonService = require("../services/FormEditionComparisonService");

const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdTemplateIds = [];

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  // Only ever deletes the disposable fixtures this file created itself -
  // never touches master data (the real I-129 templates used read-only
  // below are never added to this list).
  if (createdTemplateIds.length) {
    await USCISMappingVersion.deleteMany({ template: { $in: createdTemplateIds } });
    await USCISFormTemplate.deleteMany({ _id: { $in: createdTemplateIds } });
  }
  await mongoose.disconnect();
});

async function makeEditionPair(formCode, { removeField = false, requiredFlip = false } = {}) {
  const oldFields = [
    { fieldId: "f1", fieldName: "f1", fieldType: "text", label: "Field One", sectionTitle: "General", required: true },
    { fieldId: "f2", fieldName: "f2", fieldType: "text", label: "Field Two", sectionTitle: "General", required: true },
  ];
  const newFields = removeField
    ? [oldFields[0]]
    : [
      oldFields[0],
      { ...oldFields[1], required: requiredFlip ? false : oldFields[1].required },
    ];

  const oldTemplate = await USCISFormTemplate.create({
    formCode,
    formNumber: formCode,
    title: `${formCode} (old edition)`,
    version: `${RUN_ID}-v1`,
    versionNumber: 1,
    status: "review",
    formFields: oldFields,
  });
  createdTemplateIds.push(oldTemplate._id);

  const oldGraph = MappingGraphService.generateGraph(oldTemplate, {}, {
    exactMappings: { f1: "test.f1Value", f2: "test.f2Value" },
  });
  await MappingGraphService.persistVersion(oldTemplate, oldGraph, { _id: null, role: "super_admin" });

  const newTemplate = await USCISFormTemplate.create({
    formCode,
    formNumber: formCode,
    title: `${formCode} (new edition)`,
    version: `${RUN_ID}-v2`,
    versionNumber: 2,
    status: "review",
    parentVersion: oldTemplate._id,
    formFields: newFields,
  });
  createdTemplateIds.push(newTemplate._id);

  const newGraph = MappingGraphService.generateGraph(newTemplate, {}, {
    // Every field still present on the new edition needs its own mapping
    // edge so the new template's OWN validateGraph gate (unrelated to the
    // edition-change gate this suite is testing) is satisfied - f2 is
    // simply absent from newFields in the removeField case.
    exactMappings: removeField ? { f1: "test.f1Value" } : { f1: "test.f1Value", f2: "test.f2Value" },
  });
  await MappingGraphService.persistVersion(newTemplate, newGraph, { _id: null, role: "super_admin" });

  return { oldTemplate, newTemplate };
}

test("compareEditions detects a genuine field removal as an affected mapping edge", async () => {
  const { oldTemplate, newTemplate } = await makeEditionPair(`ZZ-EDN-TEST-REMOVED-${RUN_ID}`, { removeField: true });
  const comparison = await FormEditionComparisonService.compareEditions(oldTemplate._id, newTemplate._id);

  assert.equal(comparison.fieldDiff.summary.removed, 1);
  assert.equal(comparison.hasBreakingChanges, true);
  assert.ok(comparison.affectedMappingEdges.some((edge) => edge.targetFieldId === "f2" && edge.reasons.includes("field_removed")));
});

test("activation is blocked by unreviewed edition changes until acknowledged, then succeeds", async () => {
  const { newTemplate } = await makeEditionPair(`ZZ-EDN-TEST-BLOCK-${RUN_ID}`, { removeField: true });
  const user = { _id: null, role: "super_admin" };

  await assert.rejects(
    () => MappingGraphService.activate(newTemplate._id, user, {}),
    (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.code, "UNREVIEWED_EDITION_CHANGES");
      assert.ok(error.details.hasBreakingChanges);
      return true;
    }
  );

  const ack = await FormEditionComparisonService.acknowledge(newTemplate._id, user, {});
  assert.equal(ack.acknowledged, true);

  const activation = await MappingGraphService.activate(newTemplate._id, user, {});
  assert.equal(activation.mappingStatus, "active");
});

test("required/optional flip on an existing field is flagged even with no add/remove/rename", async () => {
  const { oldTemplate, newTemplate } = await makeEditionPair(`ZZ-EDN-TEST-REQFLIP-${RUN_ID}`, { requiredFlip: true });
  const comparison = await FormEditionComparisonService.compareEditions(oldTemplate._id, newTemplate._id);

  assert.equal(comparison.requiredChanges.length, 1);
  assert.equal(comparison.requiredChanges[0].fieldId, "f2");
  assert.equal(comparison.hasBreakingChanges, true);
  assert.ok(comparison.affectedMappingEdges.some((edge) => edge.targetFieldId === "f2" && edge.reasons.includes("field_required_changed")));
});

test("an edition with no breaking field changes is unaffected by the new gate", async () => {
  const { newTemplate } = await makeEditionPair(`ZZ-EDN-TEST-CLEAN-${RUN_ID}`, {});
  const comparison = await FormEditionComparisonService.compareToParent(newTemplate._id);

  assert.ok(comparison, "sanity: parentVersion must resolve a comparison");
  assert.equal(comparison.hasBreakingChanges, false);

  // activate() must succeed WITHOUT any acknowledgement step, proving the
  // edition-change gate never fires for a non-breaking edition.
  const activation = await MappingGraphService.activate(newTemplate._id, { _id: null, role: "super_admin" }, {});
  assert.equal(activation.mappingStatus, "active");
});

test("the pre-existing unmapped-required-field activation gate still fires exactly as before (no parentVersion involved)", async () => {
  const template = await USCISFormTemplate.create({
    formCode: `ZZ-EDN-TEST-UNMAPPED-${RUN_ID}`,
    formNumber: `ZZ-EDN-TEST-UNMAPPED-${RUN_ID}`,
    title: "Standalone unmapped-field test",
    version: `${RUN_ID}-v1`,
    versionNumber: 1,
    status: "review",
    formFields: [
      { fieldId: "f1", fieldName: "f1", fieldType: "text", label: "Field One", sectionTitle: "General", required: true },
    ],
  });
  createdTemplateIds.push(template._id);

  // threshold: 0.99 (as in MappingGraphService.test.js's own equivalent
  // case) guarantees nothing auto-maps, leaving f1 unmapped and required.
  const graph = MappingGraphService.generateGraph(template, {}, { threshold: 0.99 });
  await MappingGraphService.persistVersion(template, graph, { _id: null, role: "super_admin" });

  await assert.rejects(
    () => MappingGraphService.activate(template._id, { _id: null, role: "super_admin" }, {}),
    (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.message, "Cannot activate mapping until every USCIS field has an approved Master Case Data mapping");
      assert.equal(error.code, undefined);
      return true;
    }
  );
});

test("real I-129 edition pair on file (2026-02-27 -> 2026-09-09): no breaking changes detected, read-only", async () => {
  const previous = await USCISFormTemplate.findOne({ formCode: "I-129", status: "active" }).sort({ editionDate: -1 }).lean();
  const current = await USCISFormTemplate.findOne({ formCode: "I-129", parentVersion: previous?._id }).lean();
  if (!previous || !current) {
    // Environment-dependent master data; skip rather than fail if this
    // specific pair isn't present in whatever DB the suite runs against.
    return;
  }
  const comparison = await FormEditionComparisonService.compareEditions(previous._id, current._id);
  assert.equal(comparison.hasBreakingChanges, false, "the real I-129 edition pair's active mapping edges are not affected by its own field diff");
});
