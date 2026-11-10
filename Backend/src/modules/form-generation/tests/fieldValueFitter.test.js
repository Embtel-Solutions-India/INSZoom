const test = require("node:test");
const assert = require("node:assert/strict");
const { fitTextValue } = require("../services/FieldValueFitter");
const PDFFidelityService = require("../services/PDFFidelityService");

const phone = "form1[0].#subform[2].P3_Line4_DaytimeTelePhoneNumber[0]";
const zip = "form1[0].#subform[0].Part1_Line5_MailingAddress_ZipCode[0]";
const email = "form1[0].#subform[8].P4_Line9b_Email[0]";

test("values that fit are written unchanged", () => {
  assert.deepEqual(fitTextValue({ pdfField: phone, value: "9354596545", maxLength: 10 }), { value: "9354596545", status: "unchanged" });
  assert.equal(fitTextValue({ pdfField: email, value: "a@b.com", maxLength: undefined }).status, "unchanged");
});

// Owner rule 2026-11-04: no character limit on any form, ever - an entry is never cut. Separators are dropped only when that makes it fit its boxes.
test("a number that only misses its boxes because of separators is written without them, one character per box", () => {
  assert.deepEqual(fitTextValue({ pdfField: phone, value: "(935) 459-6545", maxLength: 10 }).value, "9354596545");
  assert.equal(fitTextValue({ pdfField: zip, value: "12345-6789", maxLength: 9 }).value, "123456789");
  assert.equal(fitTextValue({ pdfField: "form1[0].Line1_AlienNumber[0]", value: "A-123-456-789", maxLength: 10 }).value, "A123456789");
  assert.equal(fitTextValue({ pdfField: "form1[0].Line5_SSN[0]", value: "123-45-6789", maxLength: 9 }).value, "123456789");
});

test("anything still longer than its box is NEVER cut: the whole entry is returned as too_long (the renderer lifts the box limit)", () => {
  for (const [pdfField, value, maxLength] of [[phone, "+919354596545", 10], [phone, "+1 (935) 459-6545", 10], [zip, "123456", 5], [zip, "12345-6789", 5], [email, "vishu@embtelsolutions.com", 15]]) {
    const result = fitTextValue({ pdfField, value, maxLength });
    assert.equal(result.status, "too_long", value);
    assert.equal(result.value, value, "every character kept");
    assert.match(result.reason, /whole entry.*kept.*lifted/);
  }
});

test("fidelity sampling skips deliberately-blank fields", () => {
  const template = { formFields: [
    { fieldId: "a", fieldName: email, pdfFieldType: "text" },
    { fieldId: "b", fieldName: "other", pdfFieldType: "text" },
  ] };
  const caseForm = { fieldValues: { a: "vishu@embtelsolutions.com", b: "x" } };
  const sampled = PDFFidelityService.sampleFieldNames(caseForm, template, 20, new Set([email]));
  assert.deepEqual(sampled.map((item) => item.fieldName), ["other"]);
});

const { fitChoiceValue } = require("../services/FieldValueFitter");

test("an empty answer on a dropdown is 'nothing selected', never an error", () => {
  for (const value of ["", [""], null, undefined, [], "   "]) {
    assert.equal(fitChoiceValue({ value, options: [" ", " F1 - STUDENT - ACADEMIC"] }).status, "empty");
  }
});

test("a dropdown answer is matched to the form's real choice (code, case, spacing)", () => {
  const options = [" ", " F1 - STUDENT - ACADEMIC", " H1B - SPECIALTY OCCUPATION", " O2 - O-1 SUPPORT"];
  assert.deepEqual(fitChoiceValue({ value: "F1", options }).values, [" F1 - STUDENT - ACADEMIC"]);
  assert.deepEqual(fitChoiceValue({ value: "f-1", options }).values, [" F1 - STUDENT - ACADEMIC"]);
  assert.deepEqual(fitChoiceValue({ value: "O-2", options }).values, [" O2 - O-1 SUPPORT"]);
  assert.equal(fitChoiceValue({ value: " H1B - SPECIALTY OCCUPATION", options }).status, "unchanged");
});

test("an answer that matches no choice is reported, not guessed", () => {
  const result = fitChoiceValue({ value: "Z9", options: [" F1 - STUDENT"] });
  assert.equal(result.status, "dropped");
  assert.match(result.reason, /"Z9" is not one of the choices/);
});

test("a State drop-down accepts the state spelled out or as its code, either way round (never left blank for a spelling difference)", () => {
  const { fitChoiceValue } = require("../services/FieldValueFitter");
  const codes = ["AL", "DE", "NY", "DC"];
  assert.deepEqual(fitChoiceValue({ value: "DELAWARE", options: codes }).values, ["DE"]);
  assert.deepEqual(fitChoiceValue({ value: "new york", options: codes }).values, ["NY"]);
  assert.deepEqual(fitChoiceValue({ value: "District of Columbia", options: codes }).values, ["DC"]);
  assert.deepEqual(fitChoiceValue({ value: "DE", options: ["Alabama", "Delaware"] }).values, ["Delaware"]);
  assert.equal(fitChoiceValue({ value: "DE", options: codes }).status, "unchanged");
  assert.equal(fitChoiceValue({ value: "Atlantis", options: codes }).status, "dropped");
});
