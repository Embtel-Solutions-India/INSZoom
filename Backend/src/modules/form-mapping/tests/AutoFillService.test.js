const assert = require("node:assert/strict");
const test = require("node:test");
const AutoFillService = require("../services/AutoFillService");

test("AutoFillService merge preserves attorney-reviewed fields", () => {
  const caseForm = {
    filledData: { part1: { firstName: "Manual Jane", lastName: "Old" } },
    fieldValues: { "part1.firstName": "Manual Jane", "part1.lastName": "Old" },
    sourceAttribution: {
      "part1.firstName": { source: "AttorneyOverride", verificationStatus: "manual_override" },
    },
    manualOverrides: {
      "part1.firstName": { value: "Manual Jane" },
    },
    fieldReviews: {},
  };
  const template = {
    formFields: [
      { fieldId: "part1.firstName", label: "First Name", mappings: [{ source: "canonical", path: "person.firstName", mappingType: "direct" }] },
      { fieldId: "part1.lastName", label: "Last Name", mappings: [{ source: "canonical", path: "person.lastName", mappingType: "direct" }] },
    ],
  };
  const mapped = {
    fieldValues: { "part1.firstName": "OCR Jane", "part1.lastName": "Doe" },
    sourceAttribution: {
      "part1.firstName": { source: "canonical", sourceField: "person.firstName", confidence: 90 },
      "part1.lastName": { source: "canonical", sourceField: "person.lastName", confidence: 95 },
    },
  };

  const merged = AutoFillService.mergeMappedFields(caseForm, template, mapped, { person: { firstName: "OCR Jane", lastName: "Doe" } });
  assert.equal(merged.filledData.part1.firstName, "Manual Jane");
  assert.equal(merged.filledData.part1.lastName, "Doe");
  assert.equal(merged.updatedFields.length, 1);
  assert.equal(merged.skippedFields[0].fieldId, "part1.firstName");
});

test("AutoFillService reset removes only auto-filled fields", () => {
  const data = { part1: { firstName: "Manual Jane", lastName: "Doe" } };
  const fieldValues = { "part1.firstName": "Manual Jane", "part1.lastName": "Doe" };
  AutoFillService.deletePath(data, "part1.lastName");
  AutoFillService.deletePath(fieldValues, "part1.lastName");
  assert.equal(data.part1.lastName, undefined);
  assert.equal(fieldValues["part1.lastName"], undefined);
  assert.equal(data.part1.firstName, "Manual Jane");
});
