// Phase 7.6b: which edition differences the pipeline may acknowledge by itself - decided by pure functions, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const Service = require("../services/FormEditionComparisonService");

const edge = (extra = {}) => ({ mappingId: "m1", targetFieldId: "A", sourcePath: "beneficiary.name", reasons: ["field_required_changed"], renamedTo: null, ...extra });
const comparison = (edges, extra = {}) => ({ oldTemplate: { templateId: "old" }, newTemplate: { templateId: "new" }, affectedMappingEdges: edges, brokenChecklistTraces: [], requiredChanges: [], hasBreakingChanges: true, ...extra });

test("a required <-> optional flip on a box that still exists is provably safe", async () => {
  const proof = await Service.proveDiffSafe(comparison([edge()]), {});
  assert.equal(proof.safe, true);
  assert.equal(proof.proven.length, 1);
});

test("a removed box and an incompatible type change are NEVER safe (they are left unmapped by the partial activation, not acknowledged away)", async () => {
  for (const reasons of [["field_removed"], ["field_type_changed"], ["field_required_changed", "field_removed"]]) {
    const proof = await Service.proveDiffSafe(comparison([edge({ reasons })]), {});
    assert.equal(proof.safe, false, reasons.join("+"));
    assert.equal(proof.unsafe.length, 1);
  }
});

test("a renamed box is safe only when the matcher / new graph proof says so; no proof (or a throwing proof) means not safe", async () => {
  const renamed = comparison([edge({ reasons: ["field_renamed"], renamedTo: { id: "A2" } })]);
  assert.equal((await Service.proveDiffSafe(renamed, {}, { proveRename: async () => true })).safe, true);
  assert.equal((await Service.proveDiffSafe(renamed, {}, { proveRename: async () => false })).safe, false);
  assert.equal((await Service.proveDiffSafe(renamed, {}, { proveRename: async () => { throw new Error("boom"); } })).safe, false);
});

test("one unsafe edge makes the whole diff unsafe, whatever else is safe", async () => {
  const proof = await Service.proveDiffSafe(comparison([edge({ mappingId: "m1" }), edge({ mappingId: "m2", targetFieldId: "B", reasons: ["field_removed"] })]), {});
  assert.equal(proof.safe, false);
  assert.deepEqual(proof.unsafe.map((item) => item.targetFieldId), ["B"]);
  assert.equal(proof.proven.length, 1);
});

test("the diff hash is stable for the same difference and changes with any difference in what is broken", () => {
  const base = comparison([edge()]);
  assert.equal(Service.diffHash(base), Service.diffHash(JSON.parse(JSON.stringify(base))));
  assert.notEqual(Service.diffHash(base), Service.diffHash(comparison([edge(), edge({ mappingId: "m2", targetFieldId: "B" })])));
  assert.notEqual(Service.diffHash(base), Service.diffHash(comparison([edge({ reasons: ["field_removed"] })])));
  assert.notEqual(Service.diffHash(base), Service.diffHash(comparison([edge()], { newTemplate: { templateId: "another" } })));
  assert.notEqual(Service.diffHash(base), Service.diffHash(comparison([edge()], { requiredChanges: [{ fieldId: "A", oldRequired: false, newRequired: true }] })));
});

test("off does nothing at all (no lookup, no write)", async () => {
  const result = await Service.autoAcknowledge("anything", { mode: "off" });
  assert.deepEqual(result, { acknowledged: false, reason: "autonomy_off" });
});

test("autoAcknowledge never works around a failed certification or a not-accepted edition (checked before anything is read or written)", async () => {
  const loaded = [];
  const original = require("../../../models/USCISFormTemplate").findById;
  require("../../../models/USCISFormTemplate").findById = async (value) => { loaded.push(value); return { _id: "new", formCode: "I-131", parentVersion: "old", lifecycle: {} }; };
  try {
    assert.equal((await Service.autoAcknowledge("new", { mode: "on", certification: { passed: false } })).reason, "certification_failed");
    assert.equal((await Service.autoAcknowledge("new", { mode: "on", editionDecision: "not_accepted" })).reason, "edition_not_accepted");
  } finally {
    require("../../../models/USCISFormTemplate").findById = original;
  }
});
