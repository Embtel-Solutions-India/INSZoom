const assert = require("node:assert/strict");
const test = require("node:test");
const FormComparisonService = require("../services/FormComparisonService");

test("FormComparisonService generates report and severity", () => {
  const report = FormComparisonService.compare(
    { formCode: "I-129", editionDate: new Date("2025-01-17"), formFields: [{ fieldId: "oldField", type: "text" }] },
    { formCode: "I-129", editionDate: new Date("2026-10-01"), formFields: [{ fieldId: "newField", type: "text" }] }
  );
  assert.equal(report.formCode, "I-129");
  assert.equal(report.editionDate.changed, true);
  assert.ok(report.fieldDiff.summary.totalChanges >= 1);
});
