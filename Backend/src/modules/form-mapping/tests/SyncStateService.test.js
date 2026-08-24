// Phase 2 (§I.4) - SyncStateService, in isolation (no DB - pure object mutation, mirroring how
// AutoFillService.test.js unit-tests AutoFillService.mergeMappedFields against a plain-object
// caseForm stub rather than a real Mongoose document).
const assert = require("node:assert/strict");
const test = require("node:test");

const SyncStateService = require("../services/SyncStateService");

function stubCaseForm(sourceAttribution = {}) {
  return {
    sourceAttribution,
    set(path, value) {
      this[path] = value;
    },
  };
}

test("getSyncState defaults to SYNCED when no marker has ever been set", () => {
  const caseForm = stubCaseForm({});
  assert.equal(SyncStateService.getSyncState(caseForm, "field1"), SyncStateService.SYNCED);
});

test("getSyncState reads back whatever was last set", () => {
  const caseForm = stubCaseForm({ field1: { value: "x", syncState: SyncStateService.CONFLICT } });
  assert.equal(SyncStateService.getSyncState(caseForm, "field1"), SyncStateService.CONFLICT);
});

test("setManualOverride marks the field without disturbing its other sourceAttribution keys", () => {
  const caseForm = stubCaseForm({ field1: { value: "Smith", source: "canonical", confidence: 100 } });
  SyncStateService.setManualOverride(caseForm, "field1");
  assert.equal(caseForm.sourceAttribution.field1.syncState, SyncStateService.MANUAL_OVERRIDE);
  assert.equal(caseForm.sourceAttribution.field1.value, "Smith", "unrelated keys must be preserved");
  assert.equal(caseForm.sourceAttribution.field1.source, "canonical");
});

test("setSynced clears a prior conflict's recorded values", () => {
  const caseForm = stubCaseForm({ field1: { value: "Smith", syncState: SyncStateService.CONFLICT, conflictCanonicalValue: "Jones", conflictManualValue: "Smith" } });
  SyncStateService.setSynced(caseForm, "field1");
  assert.equal(caseForm.sourceAttribution.field1.syncState, SyncStateService.SYNCED);
  assert.equal(caseForm.sourceAttribution.field1.conflictCanonicalValue, undefined);
  assert.equal(caseForm.sourceAttribution.field1.conflictManualValue, undefined);
});

test("setConflict records both values and does NOT touch the field's own stored value", () => {
  const caseForm = stubCaseForm({ field1: { value: "Smith", source: "AttorneyOverride" } });
  SyncStateService.setConflict(caseForm, "field1", "Jones", "Smith");
  assert.equal(caseForm.sourceAttribution.field1.syncState, SyncStateService.CONFLICT);
  assert.equal(caseForm.sourceAttribution.field1.conflictCanonicalValue, "Jones");
  assert.equal(caseForm.sourceAttribution.field1.conflictManualValue, "Smith");
  assert.equal(caseForm.sourceAttribution.field1.value, "Smith", "setConflict must never overwrite the manual value");
  assert.equal(caseForm.sourceAttribution.field1.source, "AttorneyOverride", "unrelated keys must be preserved");
});
