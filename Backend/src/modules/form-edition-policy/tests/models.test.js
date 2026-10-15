// Release 0b-1 models: validation, append-only evidence, one-row-per-edition decision. No database: validation and the append-only hooks
// run before any driver call.
const test = require("node:test");
const assert = require("node:assert/strict");
const FormEditionSource = require("../../../models/FormEditionSource");
const FormEditionDecision = require("../../../models/FormEditionDecision");
const FormEditionAuditEvent = require("../../../models/FormEditionAuditEvent");
const { AUDIT_EVENT_TYPES } = require("../editionPolicy.constants");

const source = () => ({ sourceUrl: "https://www.uscis.gov/a", finalUrl: "https://www.uscis.gov/a", httpStatus: 200, fetchedAt: new Date(), snapshotHash: "a".repeat(64), extractedText: "text", textLength: 4 });
const event = () => ({ evidenceCaseId: "case-1", seq: 1, type: "EVIDENCE_SUBMITTED", formCode: "I-131", editionIdentifier: "2025-01-20", at: new Date() });
const decision = () => ({ formCode: "I-131", editionIdentifier: "2025-01-20", decision: "accepted", status: "verified", decidedAt: new Date() });

test("valid documents validate; required fields are enforced", () => {
  assert.equal(new FormEditionSource(source()).validateSync(), undefined);
  assert.equal(new FormEditionAuditEvent(event()).validateSync(), undefined);
  assert.equal(new FormEditionDecision(decision()).validateSync(), undefined);
  assert.ok(new FormEditionSource({}).validateSync().errors.snapshotHash);
  assert.ok(new FormEditionAuditEvent({}).validateSync().errors.evidenceCaseId);
  assert.ok(new FormEditionDecision({}).validateSync().errors.decision);
});

test("the six audit event types are exactly the plan's, and unknown types are refused", () => {
  assert.deepEqual([...AUDIT_EVENT_TYPES], ["EVIDENCE_SUBMITTED", "SOURCE_FETCHED", "VERIFICATION_COMPLETED", "DECISION_RECORDED", "GATE_RECALCULATED", "OUTCOME_RECORDED"]);
  assert.ok(new FormEditionAuditEvent({ ...event(), type: "SOMETHING_ELSE" }).validateSync().errors.type);
});

test("decisions: only the four decisions and four statuses; the edition identifier must be an ISO date; there is no acceptedEditionDates array", () => {
  assert.ok(new FormEditionDecision({ ...decision(), decision: "maybe" }).validateSync().errors.decision);
  assert.ok(new FormEditionDecision({ ...decision(), status: "ok" }).validateSync().errors.status);
  assert.ok(new FormEditionDecision({ ...decision(), editionIdentifier: "01/20/25" }).validateSync().errors.editionIdentifier);
  assert.equal(FormEditionDecision.schema.path("acceptedEditionDates"), undefined);
});

test("one row per { formCode, editionIdentifier } is expressed as a unique index; the audit trail has a unique case/seq and NO expiry", () => {
  const unique = (model) => model.schema.indexes().filter(([fields, options]) => options.unique).map(([fields]) => Object.keys(fields).join("+"));
  assert.deepEqual(unique(FormEditionDecision), ["formCode+editionIdentifier"]);
  assert.deepEqual(unique(FormEditionAuditEvent), ["evidenceCaseId+seq"]);
  for (const model of [FormEditionSource, FormEditionDecision, FormEditionAuditEvent]) {
    assert.equal(model.schema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined), false, `${model.modelName} must have no TTL`);
  }
});

test("snapshots and audit events are APPEND-ONLY: saving an existing document, every update and every delete are refused", async () => {
  for (const [Model, make] of [[FormEditionSource, source], [FormEditionAuditEvent, event]]) {
    const existing = new Model(make());
    existing.$isNew = false; // as if it had been loaded from the database
    await assert.rejects(existing.save(), (error) => error.code === "APPEND_ONLY");
    for (const operation of [
      () => Model.updateOne({}, { $set: { a: 1 } }), () => Model.updateMany({}, { $set: { a: 1 } }), () => Model.findOneAndUpdate({}, { $set: { a: 1 } }),
      () => Model.replaceOne({}, {}), () => Model.deleteMany({}), () => Model.findOneAndDelete({}),
    ]) {
      await assert.rejects(operation(), (error) => error.code === "APPEND_ONLY");
    }
    await assert.rejects(Model.bulkWrite([{ updateOne: { filter: {}, update: { $set: { a: 1 } } } }]), (error) => error.code === "APPEND_ONLY");
    await assert.rejects(Model.bulkWrite([{ deleteOne: { filter: {} } }]), (error) => error.code === "APPEND_ONLY");
  }
});

test("the decision row is NOT append-only (the service updates it and writes an immutable event for every change)", () => {
  const refusing = (model, operation) => (model.schema.s.hooks._pres.get(operation) || []).some((hook) => hook.fn.name === "refuseQueryChange");
  for (const operation of ["updateOne", "findOneAndUpdate", "deleteMany"]) {
    assert.equal(refusing(FormEditionDecision, operation), false, `${operation} must stay allowed on the decision row`);
    assert.equal(refusing(FormEditionSource, operation), true, `${operation} must be refused on snapshots`);
    assert.equal(refusing(FormEditionAuditEvent, operation), true, `${operation} must be refused on audit events`);
  }
});
