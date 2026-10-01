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

test("an over-long phone drops its formatting / country code to fit", () => {
  assert.equal(fitTextValue({ pdfField: phone, value: "+919354596545", maxLength: 10 }).value, "9354596545");
  assert.equal(fitTextValue({ pdfField: phone, value: "(935) 459-6545", maxLength: 10 }).value, "9354596545");
  assert.equal(fitTextValue({ pdfField: phone, value: "+1 (935) 459-6545", maxLength: 10 }).value, "9354596545");
});

test("an over-long ZIP is shortened to its digits", () => {
  assert.equal(fitTextValue({ pdfField: zip, value: "123456", maxLength: 5 }).value, "12345");
  assert.equal(fitTextValue({ pdfField: zip, value: "12345-6789", maxLength: 5 }).value, "12345");
});

test("an over-long email (or any other text) is never truncated - it is dropped and reported", () => {
  const result = fitTextValue({ pdfField: email, value: "vishu@embtelsolutions.com", maxLength: 15 });
  assert.equal(result.status, "dropped");
  assert.equal(result.value, "");
  assert.match(result.reason, /25 characters.*allows 15/);
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
