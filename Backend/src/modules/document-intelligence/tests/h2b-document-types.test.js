// Phase H2b — H-1B OCR autofill document-type expansion. Pure config/logic
// checks, no DB needed (unlike h2-autofill.test.js) - these verify the
// allowlist, classification enum/aliases, and extractor wiring are all
// internally consistent, independent of any real Mongo/Gemini call.
const assert = require("node:assert/strict");
const test = require("node:test");

const { AUTOFILL_DOCUMENT_TYPES } = require("../config/autofill-document-types");
const { DOCUMENT_TYPES, normalizeDocumentType } = require("../schemas/document-intelligence.schema");
const DocumentExtraction = require("../../../models/DocumentExtraction");
const { FIELD_SCHEMAS } = require("../extractors/generic-extractor.service");
const { EXTRACTOR_MAP, EVIDENCE_HINTS, getExtractor } = require("../extractors/extractor-router.service");
const genericExtractor = require("../extractors/generic-extractor.service");

const REQUIRED_LEGACY_H1B_ALLOWLIST = [
  "passport",
  "employee_i94_copy",
  "previous_i797_notices",
  "updated_resume",
  "certified_lca_eta9035",
  "academic_certificates",
  "credential_evaluation_report",
  "employee_drivers_license_or_state_id",
];

const REQUIRED_PRODUCTION_OCR_TYPES = [
  "passport",
  "visa",
  "i94",
  "resume",
  "degree",
  "transcript",
  "employment_letter",
  "experience_letter",
  "paystub",
  "tax_return",
  "business_license",
  "articles_of_incorporation",
  "lca",
  "i20",
  "marriage_certificate",
  "birth_certificate",
  "supporting_evidence",
];

test("AUTOFILL_DOCUMENT_TYPES preserves H-1B checklist slots and supports production OCR intake types", () => {
  for (const type of [...REQUIRED_LEGACY_H1B_ALLOWLIST, ...REQUIRED_PRODUCTION_OCR_TYPES]) {
    assert.ok(AUTOFILL_DOCUMENT_TYPES.includes(type), `${type} must be accepted by the autofill route`);
  }
});

test("driver_license is a first-class classification type (no longer silently aliased to other)", () => {
  assert.ok(DOCUMENT_TYPES.includes("driver_license"));
  assert.equal(normalizeDocumentType("driver_license"), "driver_license");
  assert.equal(normalizeDocumentType("Driver-License"), "driver_license");
});

test("lca, i20, business_license, and credential_evaluation are real classification types with their own field schemas", () => {
  assert.ok(DOCUMENT_TYPES.includes("lca"));
  assert.ok(DOCUMENT_TYPES.includes("i20"));
  assert.ok(DOCUMENT_TYPES.includes("business_license"));
  assert.ok(DOCUMENT_TYPES.includes("credential_evaluation"));
  assert.ok(Array.isArray(FIELD_SCHEMAS.lca) && FIELD_SCHEMAS.lca.length > 0);
  assert.ok(Array.isArray(FIELD_SCHEMAS.i20) && FIELD_SCHEMAS.i20.length > 0);
  assert.ok(Array.isArray(FIELD_SCHEMAS.business_license) && FIELD_SCHEMAS.business_license.length > 0);
  assert.ok(Array.isArray(FIELD_SCHEMAS.credential_evaluation) && FIELD_SCHEMAS.credential_evaluation.length > 0);
  assert.ok(Array.isArray(FIELD_SCHEMAS.driver_license) && FIELD_SCHEMAS.driver_license.length > 0);
});

test("defensive aliases route checklist-native / variant spellings to their real classification type", () => {
  assert.equal(normalizeDocumentType("updated_resume"), "resume");
  assert.equal(normalizeDocumentType("credential_evaluation_report"), "credential_evaluation");
  assert.equal(normalizeDocumentType("eta9035"), "lca");
  assert.equal(normalizeDocumentType("eta_9035"), "lca");
  assert.equal(normalizeDocumentType("certified_lca_eta9035"), "lca");
  assert.equal(normalizeDocumentType("employee_i94_copy"), "i94");
  assert.equal(normalizeDocumentType("previous_i797_notices"), "approval_notice");
  assert.equal(normalizeDocumentType("state_id"), "driver_license");
});

test("DocumentExtraction's classification enum accepts the new types", () => {
  const enumValues = DocumentExtraction.schema.path("documentType").enumValues;
  assert.ok(enumValues.includes("lca"));
  assert.ok(enumValues.includes("i20"));
  assert.ok(enumValues.includes("business_license"));
  assert.ok(enumValues.includes("credential_evaluation"));
  assert.ok(enumValues.includes("driver_license"));
  const classificationEnumValues = DocumentExtraction.schema.path("classification.documentType").enumValues;
  assert.ok(classificationEnumValues.includes("lca"));
  assert.ok(classificationEnumValues.includes("i20"));
  assert.ok(classificationEnumValues.includes("business_license"));
  assert.ok(classificationEnumValues.includes("credential_evaluation"));
});

test("the new types route to the generic extractor and carry an evidence-category hint", () => {
  assert.equal(getExtractor("driver_license"), genericExtractor);
  assert.equal(getExtractor("lca"), genericExtractor);
  assert.equal(getExtractor("i20"), genericExtractor);
  assert.equal(getExtractor("business_license"), genericExtractor);
  assert.equal(getExtractor("credential_evaluation"), genericExtractor);
  assert.equal(EXTRACTOR_MAP.driver_license, genericExtractor);
  assert.deepEqual(EVIDENCE_HINTS.driver_license, ["Identity"]);
  assert.deepEqual(EVIDENCE_HINTS.lca, ["Employment"]);
  assert.deepEqual(EVIDENCE_HINTS.i20, ["Immigration", "Education"]);
  assert.deepEqual(EVIDENCE_HINTS.business_license, ["Business"]);
  assert.deepEqual(EVIDENCE_HINTS.credential_evaluation, ["Education"]);
});
