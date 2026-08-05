const assert = require("node:assert/strict");
const test = require("node:test");
const PDFFieldMapper = require("../services/PDFFieldMapper");

test("PDFFieldMapper maps filledData to official PDF fields", () => {
  const caseForm = { filledData: { beneficiary: { lastName: "Doe" }, part1: { answer: true } } };
  const template = {
    pdfFieldMappings: [
      { caseField: "beneficiary.lastName", pdfField: "Pt1Line1FamilyName", type: "text" },
      { caseField: "part1.answer", pdfField: "Pt1Line2Yes", type: "checkbox" },
    ],
  };
  const result = PDFFieldMapper.mapFields(caseForm, template);
  assert.equal(result.mappedFields.Pt1Line1FamilyName.value, "Doe");
  assert.equal(result.mappedFields.Pt1Line2Yes.value, true);
});

test("PDFFieldMapper supports formFields pdf metadata", () => {
  const caseForm = { filledData: { part2: { firstName: "Jane" } } };
  const template = {
    formFields: [{ fieldId: "part2.firstName", pdfField: "Pt2Line1GivenName", type: "text" }],
  };
  const result = PDFFieldMapper.mapFields(caseForm, template);
  assert.equal(result.mappedFields.Pt2Line1GivenName.caseField, "part2.firstName");
});
