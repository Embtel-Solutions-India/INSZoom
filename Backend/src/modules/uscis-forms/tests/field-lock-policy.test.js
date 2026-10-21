const test = require("node:test");
const assert = require("node:assert/strict");
const { effectiveReadOnly, keepsLock } = require("../field-lock-policy");

const field = (over) => ({ fieldName: "form1[0].#subform[1].Line1a_CityorTown[0]", fieldType: "text", pdfFieldType: "text", readOnly: true, ...over });

test("a field USCIS marks read-only is fillable when it is a plain text / date / number box or a checkbox", () => {
  assert.equal(effectiveReadOnly(field()), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "textarea" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "date" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "number" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "alienNumber" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "checkbox", pdfFieldType: "checkbox" })), false);
});

test("signatures, barcodes, computed fields and non-text widgets keep their lock", () => {
  assert.equal(effectiveReadOnly(field({ fieldType: "signature", fieldName: "form1[0].#subform[5].Line1a_SignatureofPetitioner[0]" })), true);
  assert.equal(effectiveReadOnly(field({ fieldType: "textarea", fieldName: "form1[0].Page1[0].PDF417BarCode1[0]", fieldLabel: "Form 1 0 Page Set 0 Page 1 0 Pdf 417 Bar Code 1 0" })), true);
  assert.equal(effectiveReadOnly(field({ calculated: true })), true);
  assert.equal(effectiveReadOnly(field({ fieldType: "dropdown", pdfFieldType: "dropdown" })), true);
  assert.equal(effectiveReadOnly(field({ fieldType: "radio", pdfFieldType: "radio" })), true);
  assert.equal(keepsLock(field({ fieldType: "signature" })), true);
});

test("a field that was not read-only stays editable, and either spelling of the flag is read", () => {
  assert.equal(effectiveReadOnly(field({ readOnly: false })), false);
  assert.equal(effectiveReadOnly({ fieldName: "x", fieldType: "text" }), false);
  assert.equal(effectiveReadOnly(field({ readOnly: undefined, readonly: true, fieldType: "signature" })), true);
});
