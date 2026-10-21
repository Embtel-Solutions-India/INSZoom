const test = require("node:test");
const assert = require("node:assert/strict");
const { effectiveReadOnly, keepsLock } = require("../field-lock-policy");

const field = (over) => ({ fieldName: "form1[0].#subform[1].Line1a_CityorTown[0]", fieldType: "text", pdfFieldType: "text", readOnly: true, ...over });

test("a field USCIS marks read-only is fillable when it is a text / date / number box, a checkbox, a drop-down, a list box or a radio group", () => {
  assert.equal(effectiveReadOnly(field()), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "textarea" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "date" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "number" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "alienNumber" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "checkbox", pdfFieldType: "checkbox" })), false);
  // the I-907 "State" list: a read-only drop-down is fillable too
  assert.equal(effectiveReadOnly(field({ fieldName: "bform[1].Part1_Line7_PhysicalAddress_State[0]", fieldType: "dropdown", pdfFieldType: "dropdown" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "radio", pdfFieldType: "radio" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "multiselect", pdfFieldType: "optionList" })), false);
  assert.equal(effectiveReadOnly(field({ fieldType: "dropdown", pdfFieldType: undefined })), false); // the importer type alone is enough
});

test("signatures, barcodes, computed fields and widgets nobody can fill in keep their lock", () => {
  assert.equal(effectiveReadOnly(field({ fieldType: "signature", fieldName: "form1[0].#subform[5].Line1a_SignatureofPetitioner[0]" })), true);
  assert.equal(effectiveReadOnly(field({ fieldType: "textarea", fieldName: "form1[0].Page1[0].PDF417BarCode1[0]", fieldLabel: "Form 1 0 Page Set 0 Page 1 0 Pdf 417 Bar Code 1 0" })), true);
  assert.equal(effectiveReadOnly(field({ calculated: true })), true);
  // a computed drop-down, or a signature / barcode widget of any kind, stays locked
  assert.equal(effectiveReadOnly(field({ fieldType: "dropdown", pdfFieldType: "dropdown", calculated: true })), true);
  assert.equal(effectiveReadOnly(field({ fieldType: "radio", pdfFieldType: "radio", fieldName: "form1[0].Page1[0].PDF417BarCode1[0]" })), true);
  assert.equal(effectiveReadOnly(field({ fieldType: "signature", pdfFieldType: "dropdown" })), true);
  // push buttons and unknown widget kinds cannot be filled in
  assert.equal(effectiveReadOnly(field({ fieldType: "button", pdfFieldType: "PDFButton" })), true);
  assert.equal(effectiveReadOnly(field({ fieldType: "unknown", pdfFieldType: "unknown" })), true);
  assert.equal(keepsLock(field({ fieldType: "signature" })), true);
});

test("a field that was not read-only stays editable, and either spelling of the flag is read", () => {
  assert.equal(effectiveReadOnly(field({ readOnly: false })), false);
  assert.equal(effectiveReadOnly({ fieldName: "x", fieldType: "text" }), false);
  assert.equal(effectiveReadOnly(field({ readOnly: undefined, readonly: true, fieldType: "signature" })), true);
});
