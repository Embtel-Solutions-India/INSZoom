const assert = require("node:assert/strict");
const test = require("node:test");
const CanonicalMergeService = require("../services/CanonicalMergeService");
const CanonicalValidationService = require("../services/CanonicalValidationService");

test("CanonicalMergeService applies source priority and records conflicts", () => {
  const result = CanonicalMergeService.merge([
    { path: "person.firstName", value: "Jon", sourceType: "ocr", confidence: 92, status: "needs_review" },
    { path: "person.firstName", value: "John", sourceType: "questionnaire", confidence: 85, status: "submitted" },
    { path: "person.lastName", value: "smith", sourceType: "questionnaire", confidence: 80 },
    { path: "contact.email", value: "JOHN@EXAMPLE.COM", sourceType: "database", confidence: 70 },
    { path: "case.visaType", value: "I-130", sourceType: "database", confidence: 70 },
    { path: "person.dob", value: "1990-01-02", sourceType: "database", confidence: 70 },
  ]);

  assert.equal(result.profile.person.firstName, "Jon");
  assert.equal(result.profile.person.lastName, "Smith");
  assert.equal(result.profile.contact.email, "john@example.com");
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].path, "person.firstName");
  assert.equal(result.fieldMetadata["person.firstName"].sourceType, "ocr");
});

test("CanonicalValidationService reports missing and conflicting fields", async () => {
  const validation = await CanonicalValidationService.validate({
    profile: {
      person: { firstName: "John", lastName: "Smith", dob: "1990-01-02" },
      contact: { email: "john@example.com" },
      case: { visaType: "H-1B" },
      documents: [],
    },
    conflicts: [{ conflictId: "1", path: "person.firstName", status: "pending_review" }],
  }, { forms: ["I-129"] });

  assert.equal(validation.valid, false);
  assert.equal(validation.status, "invalid");
  assert.equal(typeof validation.completeness, "number");
  assert.equal(typeof validation.readinessScore, "number");
  assert.ok(validation.warnings.some((warning) => warning.code === "CANONICAL_CONFLICT_PENDING"));
  assert.ok(validation.missingFields.some((field) => field.path === "person.passport.number"));
  assert.ok(validation.errors.some((error) => error.code === "REQUIRED_DOCUMENT_MISSING"));
});
