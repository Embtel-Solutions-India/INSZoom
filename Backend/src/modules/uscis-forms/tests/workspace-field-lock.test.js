const test = require("node:test");
const assert = require("node:assert/strict");
const InteractiveFormReviewService = require("../interactive-form-review.service");

const caseForm = { fieldValues: {}, sourceAttribution: {}, manualOverrides: {} };
const view = (field) => InteractiveFormReviewService.buildFieldView({ fieldName: "a", fieldId: "a", fieldType: "text", pdfFieldType: "text", ...field }, caseForm, { profile: {}, conflicts: [] }, []);

test("the workspace unlocks read-only boxes a person may fill in, keeps signatures / barcodes locked, and leaves every other field alone", () => {
  assert.equal(view({ readOnly: true }).readOnly, false);
  assert.equal(view({ readOnly: true, fieldType: "checkbox", pdfFieldType: "checkbox" }).readOnly, false);
  assert.equal(view({ readOnly: true, fieldType: "signature" }).readOnly, true);
  assert.equal(view({ readOnly: true, fieldName: "Page1[0].PDF417BarCode1[0]", fieldType: "textarea" }).readOnly, true);
  // a field that was never read-only carries no new property at all
  assert.equal("readOnly" in view({}), false);
});
