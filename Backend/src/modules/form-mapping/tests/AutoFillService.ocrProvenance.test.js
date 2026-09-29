const assert = require("node:assert/strict");
const test = require("node:test");
const AutoFillService = require("../services/AutoFillService");

// Phase 3C/3D: OCR -> canonical -> CaseForm.fieldValueProvenance wiring.
// DB-free unit tests exercising AutoFillService.mergeMappedFields directly
// with plain objects, matching the existing style of
// AutoFillService.test.js in this same directory (no Mongoose document
// required - mergeMappedFields only ever reads plain caseForm/template/
// mapped/canonicalData shapes).

const template = {
  formFields: [
    { fieldId: "part1.firstName", label: "First Name", mappings: [{ source: "canonical", path: "person.firstName", mappingType: "direct" }] },
  ],
};

test("(a) a high-confidence OCR-derived canonical value reaches CaseForm.filledData with fieldValueProvenance.source === 'ocr'", () => {
  const caseForm = { filledData: {}, fieldValues: {}, sourceAttribution: {}, fieldValueProvenance: {} };
  const mapped = {
    fieldValues: { "part1.firstName": "Ada" },
    sourceAttribution: {
      "part1.firstName": { source: "canonical", sourceField: "person.firstName", confidence: 96 },
    },
  };
  // fieldMetadata is exactly what CanonicalMergeService.merge() produces for
  // the winning candidate at this path - here simulating that the winner
  // came from CanonicalBuilderService.addOcrCandidates (sourceType "ocr").
  const canonicalData = {
    person: { firstName: "Ada" },
    fieldMetadata: {
      "person.firstName": { sourceType: "ocr", sourceId: "extraction-1", sourceDocumentId: "document-1", confidence: 96 },
    },
  };

  const merged = AutoFillService.mergeMappedFields(caseForm, template, mapped, canonicalData);

  assert.equal(merged.filledData.part1.firstName, "Ada");
  assert.equal(merged.updatedFields.length, 1);
  const provenance = merged.fieldValueProvenance["part1.firstName"];
  assert.ok(provenance, "fieldValueProvenance must be populated for an OCR-sourced field");
  assert.equal(provenance.source, "ocr");
  assert.equal(provenance.sourceId, "extraction-1");
  assert.equal(provenance.sourceDocumentId, "document-1");
  assert.equal(provenance.canonicalValue, "Ada");
  assert.equal(provenance.revision, 1);
});

test("(b) when no OCR candidate is eligible (low-confidence extraction was filtered out upstream), the field is simply absent from canonicalData and never reaches CaseForm - fieldValueProvenance stays untouched", () => {
  const caseForm = { filledData: {}, fieldValues: {}, sourceAttribution: {}, fieldValueProvenance: {} };
  // No entry for "part1.firstName" at all in mapped.fieldValues, because
  // FormMappingService.mapTemplate found nothing at canonicalData's
  // person.firstName - exactly what happens when
  // CanonicalBuilderService.addOcrCandidates gated out a low-confidence/
  // unreviewed field (see CanonicalBuilderService.ocrGate.test.js) and
  // nothing else supplied that path.
  const mapped = {
    fieldValues: {},
    sourceAttribution: {
      "part1.firstName": { source: "unmapped", sourceField: "", confidence: 0 },
    },
  };
  const canonicalData = { fieldMetadata: {} };

  const merged = AutoFillService.mergeMappedFields(caseForm, template, mapped, canonicalData);

  assert.equal(merged.filledData.part1?.firstName, undefined, "an unreviewed low-confidence OCR value must never auto-populate CaseForm.filledData");
  assert.equal(merged.updatedFields.length, 0);
  assert.deepEqual(merged.fieldValueProvenance, {}, "no provenance entry should be created for a field that never had an eligible source value");
});

test("(c) an existing case_manager_override survives an OCR rerun - generate() never overwrites its value or its provenance", () => {
  // Simulates a CaseForm where a case manager previously called
  // overrideFieldById on "part1.firstName" (which sets manualOverrides AND
  // fieldValueProvenance.source = "case_manager_override" - see
  // AutoFillService.overrideFieldById).
  const caseForm = {
    filledData: { part1: { firstName: "Manually Corrected Name" } },
    fieldValues: { "part1.firstName": "Manually Corrected Name" },
    sourceAttribution: {
      "part1.firstName": { source: "AttorneyOverride", verificationStatus: "manual_override" },
    },
    manualOverrides: {
      "part1.firstName": { value: "Manually Corrected Name" },
    },
    fieldReviews: {},
    fieldValueProvenance: {
      "part1.firstName": {
        source: "case_manager_override",
        canonicalValue: "Manually Corrected Name",
        overriddenAt: new Date("2026-01-01"),
        overriddenBy: "case-manager-1",
        revision: 1,
      },
    },
  };
  // A fresh OCR extraction reruns and now offers a competing value for the
  // same PDF field.
  const mapped = {
    fieldValues: { "part1.firstName": "Ada (fresh OCR rerun)" },
    sourceAttribution: {
      "part1.firstName": { source: "canonical", sourceField: "person.firstName", confidence: 96 },
    },
  };
  const canonicalData = {
    fieldMetadata: {
      "person.firstName": { sourceType: "ocr", sourceId: "extraction-2", sourceDocumentId: "document-2", confidence: 96 },
    },
  };

  const merged = AutoFillService.mergeMappedFields(caseForm, template, mapped, canonicalData);

  assert.equal(merged.filledData.part1.firstName, "Manually Corrected Name", "the case-manager override value must not be silently overwritten by a fresh OCR rerun");
  assert.equal(merged.skippedFields[0]?.fieldId, "part1.firstName");
  const provenance = merged.fieldValueProvenance["part1.firstName"];
  assert.equal(provenance.source, "case_manager_override", "the override's provenance must survive the OCR rerun unchanged");
  assert.equal(provenance.canonicalValue, "Manually Corrected Name");
  assert.equal(provenance.revision, 1, "an untouched skipped field's provenance must not be bumped/rewritten");
});
