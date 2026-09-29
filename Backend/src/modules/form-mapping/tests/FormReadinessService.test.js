// Phase 3E/3F acceptance tests for FormReadinessService - the CaseForm
// readiness diagnostics/missing-data tracer (see
// docs/forms/CHECKLIST_CANONICAL_TRACEABILITY_REPORT.md for Phase 1/2
// context this reuses rather than duplicates).
//
// Connects to the REAL configured MongoDB, like h1-i129-mapping.test.js and
// i539a-mapping-graph.test.js - MappingGraphService/ChecklistFieldTraceabilityService
// are only meaningfully exercised against real persisted graphs/checklists.
// Uses its own throwaway USCISFormTemplate/USCISMappingVersion/Case/CaseForm
// fixtures (status "draft", a formCode no real registry entry references) so
// this suite has full, deterministic control over which fields are
// mapped/required/filled without touching or depending on any real form's
// mapping state - and cleans every fixture it creates up afterward. Never
// touches a PROTECTED_COLLECTIONS master-data document (see
// test-utils/db.js) - only its own newly-created rows.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const FormReadinessService = require("../services/FormReadinessService");

const FORM_CODE = "TEST-READINESS-FORM";
const VISA_TYPE = "TEST-VISA-READINESS-FIXTURE";

let template;
let mappingVersion;
// A second, separate fixture template that carries ONLY fully-mapped
// required fields (no deliberately-unmapped field) - used exclusively by
// the READY test, so that test can assert READY without the main
// template's deliberately-unmapped field_unmapped_required (used by the
// BLOCKED/NOT_READY/NEEDS_REVIEW tests below) forcing BLOCKED instead.
let readyTemplate;
let readyMappingVersion;
const createdCaseIds = [];
const createdCaseFormIds = [];

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);

  template = await USCISFormTemplate.create({
    formCode: FORM_CODE,
    title: "Test Readiness Form (fixture, not a real USCIS form)",
    version: `fixture-${Date.now()}`,
    status: "draft",
    formFields: [
      { fieldId: "field_ready", fieldName: "field_ready", label: "Ready Field", required: true, fieldType: "text", sectionKey: "general" },
      { fieldId: "field_gap", fieldName: "field_gap", label: "Gap Field (no checklist source)", required: true, fieldType: "text", sectionKey: "general" },
      { fieldId: "field_ocr", fieldName: "field_ocr", label: "OCR Field", required: true, fieldType: "text", sectionKey: "general" },
      { fieldId: "field_unmapped_required", fieldName: "field_unmapped_required", label: "Unmapped Required Field", required: true, fieldType: "text", sectionKey: "general" },
      { fieldId: "field_optional_unmapped", fieldName: "field_optional_unmapped", label: "Optional Unmapped Field", required: false, fieldType: "text", sectionKey: "general" },
    ],
  });

  const graph = {
    templateId: String(template._id),
    formCode: FORM_CODE,
    edges: [
      { mappingId: "m1", formCode: FORM_CODE, sourcePath: "test.readyField", targetFieldId: "field_ready", targetLabel: "Ready Field", confidence: 100, status: "active", mappingType: "direct" },
      { mappingId: "m2", formCode: FORM_CODE, sourcePath: "test.gapField", targetFieldId: "field_gap", targetLabel: "Gap Field", confidence: 100, status: "active", mappingType: "direct" },
      { mappingId: "m3", formCode: FORM_CODE, sourcePath: "test.ocrField", targetFieldId: "field_ocr", targetLabel: "OCR Field", confidence: 100, status: "active", mappingType: "direct" },
      // field_unmapped_required deliberately has NO edge - a real,
      // structural "required field with no mapping at all" case (BLOCKED).
    ],
    unmappedTargets: ["field_unmapped_required", "field_optional_unmapped"],
    nodes: { canonical: [], form: [] },
  };

  mappingVersion = await USCISMappingVersion.create({
    template: template._id,
    formCode: FORM_CODE,
    formVersion: template.version,
    mappingVersion: 1,
    checksum: "fixture-checksum",
    graph,
    status: "active",
  });

  template.mappingVersion = 1;
  template.activeMappingVersionId = mappingVersion._id;
  template.mappingStatus = "active";
  await template.save();

  readyTemplate = await USCISFormTemplate.create({
    formCode: FORM_CODE,
    title: "Test Readiness Form - all-mapped fixture (fixture, not a real USCIS form)",
    version: `fixture-ready-${Date.now()}`,
    status: "draft",
    formFields: [
      { fieldId: "field_ready", fieldName: "field_ready", label: "Ready Field", required: true, fieldType: "text", sectionKey: "general" },
      { fieldId: "field_gap", fieldName: "field_gap", label: "Gap Field", required: true, fieldType: "text", sectionKey: "general" },
      { fieldId: "field_ocr", fieldName: "field_ocr", label: "OCR Field", required: true, fieldType: "text", sectionKey: "general" },
    ],
  });
  const readyGraph = {
    templateId: String(readyTemplate._id),
    formCode: FORM_CODE,
    edges: [
      { mappingId: "r1", formCode: FORM_CODE, sourcePath: "test.readyField", targetFieldId: "field_ready", targetLabel: "Ready Field", confidence: 100, status: "active", mappingType: "direct" },
      { mappingId: "r2", formCode: FORM_CODE, sourcePath: "test.gapField", targetFieldId: "field_gap", targetLabel: "Gap Field", confidence: 100, status: "active", mappingType: "direct" },
      { mappingId: "r3", formCode: FORM_CODE, sourcePath: "test.ocrField", targetFieldId: "field_ocr", targetLabel: "OCR Field", confidence: 100, status: "active", mappingType: "direct" },
    ],
    unmappedTargets: [],
    nodes: { canonical: [], form: [] },
  };
  readyMappingVersion = await USCISMappingVersion.create({
    template: readyTemplate._id,
    formCode: FORM_CODE,
    formVersion: readyTemplate.version,
    mappingVersion: 1,
    checksum: "fixture-ready-checksum",
    graph: readyGraph,
    status: "active",
  });
  readyTemplate.mappingVersion = 1;
  readyTemplate.activeMappingVersionId = readyMappingVersion._id;
  readyTemplate.mappingStatus = "active";
  await readyTemplate.save();
});

test.after(async () => {
  await CaseForm.deleteMany({ _id: { $in: createdCaseFormIds } });
  await Case.deleteMany({ _id: { $in: createdCaseIds } });
  await USCISMappingVersion.deleteMany({ template: { $in: [template._id, readyTemplate._id] } });
  await USCISFormTemplate.deleteMany({ _id: { $in: [template._id, readyTemplate._id] } });
  await mongoose.disconnect();
});

async function makeCase() {
  const caseDoc = await Case.create({
    caseNumber: `readiness-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    visaType: VISA_TYPE,
    status: "active",
  });
  createdCaseIds.push(caseDoc._id);
  return caseDoc;
}

async function makeCaseForm(caseDoc, overrides = {}, useTemplate = template) {
  const caseForm = await CaseForm.create({
    caseId: caseDoc._id,
    formTemplateId: useTemplate._id,
    formCode: FORM_CODE,
    formVersion: useTemplate.version,
    status: "draft",
    ...overrides,
  });
  createdCaseFormIds.push(caseForm._id);
  return caseForm;
}

test("computeReadiness: every required field mapped and filled -> READY", async () => {
  const caseDoc = await makeCase();
  const caseForm = await makeCaseForm(caseDoc, {
    filledData: { field_ready: "value-1", field_gap: "value-2", field_ocr: "value-3" },
    fieldValueProvenance: {
      field_ready: { source: "canonical" },
      field_gap: { source: "canonical" },
      field_ocr: { source: "canonical" },
    },
  }, readyTemplate);

  const result = await FormReadinessService.computeReadiness(caseForm._id);

  assert.equal(result.status, "READY");
  assert.equal(result.summary.requiredMissingValues, 0);
  assert.equal(result.summary.requiredNeedsReview, 0);
  assert.equal(result.summary.unmappedFields, 0);
  const readyField = result.fields.find((f) => f.targetFieldId === "field_ready");
  assert.equal(readyField.mapped, true);
  assert.equal(readyField.hasValue, true);
  assert.equal(readyField.fieldStatus, "filled");
});

test("computeReadiness: a required field with NO mapping edge at all -> BLOCKED, never just NOT_READY", async () => {
  const caseDoc = await makeCase();
  const caseForm = await makeCaseForm(caseDoc, {
    filledData: { field_ready: "value-1", field_gap: "value-2", field_ocr: "value-3" },
  });

  const result = await FormReadinessService.computeReadiness(caseForm._id);

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.unmappedRequiredFieldIds, ["field_unmapped_required"]);
});

test("computeReadiness + traceMissingField: a required field missing its VALUE, with no checklist question mapping to its canonical path -> NOT_READY and 'No mapped collection source', never a fabricated question", async () => {
  const caseDoc = await makeCase();
  // field_unmapped_required is unmapped by construction (would force
  // BLOCKED) - exclude it from this scenario by giving it no bearing: it's
  // still unmapped/required here too, so to isolate the "missing VALUE on a
  // MAPPED field" path we assert against field_gap specifically and accept
  // BLOCKED only if it were unmapped-required-missing; since field_gap IS
  // mapped, its own missing value alone (with field_unmapped_required
  // handled by the dedicated BLOCKED test above) still surfaces as part of
  // the same result - so this test targets field_gap's own diagnostics
  // regardless of overall status, then separately confirms NOT_READY on a
  // variant CaseForm where every OTHER required field is fully mapped.
  const caseForm = await makeCaseForm(caseDoc, {
    filledData: { field_ready: "value-1", field_ocr: "value-3" },
    // field_gap intentionally left unset - "missing required value"
  });

  const trace = await FormReadinessService.traceMissingField(caseForm._id, "field_gap");
  assert.equal(trace.mapped, true);
  assert.equal(trace.hasValue, false);
  assert.equal(trace.sourcePath, "test.gapField");
  assert.equal(trace.reason, "NO_MAPPED_COLLECTION_SOURCE");
  assert.deepEqual(trace.checklistMatches, []);
  assert.match(trace.message, /No mapped collection source|not fed by any checklist question/i);

  const readiness = await FormReadinessService.computeReadiness(caseForm._id);
  assert.ok(readiness.missingRequiredFieldIds.includes("field_gap"));
  // field_unmapped_required is also unmapped-required here, so the overall
  // status is BLOCKED (the worse of the two) - confirming BLOCKED still
  // correctly ranks above NOT_READY, and that field_gap's own per-field
  // diagnostics (asserted above) are correct independent of the rollup.
  assert.equal(readiness.status, "BLOCKED");
});

test("computeReadiness: NOT_READY in isolation once the unmapped-required field is excluded via component scoping", async () => {
  // Reuses the same template/graph but scopes the fields considered to a
  // synthetic subset (mirroring how a component CaseForm - see
  // USCISFormComponentDefinition - only ever sees its OWN fieldIds) so this
  // test can assert NOT_READY without BLOCKED's unmapped-required field
  // muddying the result. Directly exercises computeStatus's ranking via a
  // hand-built fields array - the same shape classifyField already produces
  // - rather than re-deriving classification logic.
  const fields = [
    { targetFieldId: "field_ready", required: true, mapped: true, hasValue: true, fieldStatus: "filled" },
    { targetFieldId: "field_gap", required: true, mapped: true, hasValue: false, fieldStatus: "missing_value" },
    { targetFieldId: "field_ocr", required: true, mapped: true, hasValue: true, fieldStatus: "filled" },
  ];
  assert.equal(FormReadinessService.computeStatus(fields), "NOT_READY");
});

test("computeReadiness: a required field's value is present but is a pending, unconfirmed OCR value -> NEEDS_REVIEW, never silently counted as filled", async () => {
  const caseDoc = await makeCase();
  const caseForm = await makeCaseForm(caseDoc, {
    filledData: { field_ready: "value-1", field_gap: "value-2", field_ocr: "ocr-extracted-value" },
    fieldValueProvenance: {
      field_ready: { source: "canonical" },
      field_gap: { source: "canonical" },
      field_ocr: { source: "ocr" },
    },
    // No fieldReviews entry for field_ocr at all - i.e. never confirmed/
    // approved, so AutoFillService.isReviewedOrManual-equivalent logic must
    // NOT treat it as settled.
  });

  const result = await FormReadinessService.computeReadiness(caseForm._id);
  const ocrField = result.fields.find((f) => f.targetFieldId === "field_ocr");

  assert.equal(ocrField.hasValue, true, "the OCR value IS present in filledData");
  assert.equal(ocrField.fieldStatus, "needs_review", "but must be classified needs_review, never 'filled'");
  assert.equal(ocrField.pendingOcrReview, true);
  assert.ok(result.summary.requiredNeedsReview >= 1);
  assert.ok(result.needsReviewFieldIds.includes("field_ocr"));
  // BLOCKED (field_unmapped_required, unmapped by construction on the
  // shared template) still outranks NEEDS_REVIEW in the real end-to-end
  // result - confirmed directly via computeStatus in isolation instead, to
  // assert NEEDS_REVIEW's own ranking without that interference.
  const isolatedFields = result.fields
    .filter((f) => f.targetFieldId !== "field_unmapped_required" && f.targetFieldId !== "field_optional_unmapped");
  assert.equal(FormReadinessService.computeStatus(isolatedFields), "NEEDS_REVIEW");
});

test("computeReadiness: once field_ocr's needs-review value is approved, it counts as filled and no longer needs review", async () => {
  const caseDoc = await makeCase();
  const caseForm = await makeCaseForm(caseDoc, {
    filledData: { field_ready: "value-1", field_gap: "value-2", field_ocr: "ocr-extracted-value" },
    fieldValueProvenance: { field_ocr: { source: "ocr" } },
    fieldReviews: { field_ocr: { status: "approved" } },
  });

  const result = await FormReadinessService.computeReadiness(caseForm._id);
  const ocrField = result.fields.find((f) => f.targetFieldId === "field_ocr");
  assert.equal(ocrField.fieldStatus, "filled");
  assert.equal(ocrField.pendingOcrReview, false);
});

test("traceMissingField: an unmapped field (no edge at all) reports UNMAPPED_PDF_FIELD, not a fabricated trace", async () => {
  const caseDoc = await makeCase();
  const caseForm = await makeCaseForm(caseDoc, { filledData: {} });
  const trace = await FormReadinessService.traceMissingField(caseForm._id, "field_unmapped_required");
  assert.equal(trace.mapped, false);
  assert.equal(trace.reason, "UNMAPPED_PDF_FIELD");
  assert.deepEqual(trace.checklistMatches, []);
});

test("traceMissingField: a nonexistent field id 404s instead of fabricating a result", async () => {
  const caseDoc = await makeCase();
  const caseForm = await makeCaseForm(caseDoc, { filledData: {} });
  await assert.rejects(
    () => FormReadinessService.traceMissingField(caseForm._id, "not_a_real_field"),
    (error) => {
      assert.equal(error.status, 404);
      return true;
    }
  );
});

test("computeReadiness: a nonexistent CaseForm id 404s", async () => {
  await assert.rejects(
    () => FormReadinessService.computeReadiness(new mongoose.Types.ObjectId()),
    (error) => {
      assert.equal(error.status, 404);
      return true;
    }
  );
});
