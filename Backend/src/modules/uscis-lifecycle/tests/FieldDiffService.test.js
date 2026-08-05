const assert = require("node:assert/strict");
const test = require("node:test");
const FieldDiffService = require("../services/FieldDiffService");

test("FieldDiffService detects added removed and modified fields", () => {
  const oldFields = [
    { fieldId: "beneficiary.lastName", type: "text", validation: { required: true } },
    { fieldId: "faxNumber", type: "text" },
  ];
  const newFields = [
    { fieldId: "beneficiary.lastName", type: "textarea", validation: { required: true } },
    { fieldId: "employerPhone", type: "text" },
  ];
  const diff = FieldDiffService.diff(oldFields, newFields);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.modified, 1);
});

test("FieldDiffService detects likely renamed fields", () => {
  const diff = FieldDiffService.diff(
    [{ fieldId: "beneficiaryLastName", label: "Beneficiary Last Name", type: "text" }],
    [{ fieldId: "beneficiaryFamilyName", label: "Beneficiary Family Name", type: "text" }]
  );
  assert.equal(diff.summary.renamed, 1);
});
