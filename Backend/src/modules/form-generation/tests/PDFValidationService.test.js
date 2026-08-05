const assert = require("node:assert/strict");
const test = require("node:test");
const PDFValidationService = require("../services/PDFValidationService");

test("PDFValidationService blocks missing PDF template", () => {
  const result = PDFValidationService.validate({ filledData: {} }, { formFields: [], pdfFieldMappings: [] });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "PDF_TEMPLATE_MISSING");
});

test("PDFValidationService validates required mapped fields", () => {
  const caseForm = { filledData: { part1: { name: "Acme" } } };
  const template = {
    pdfTemplatePath: "templates/i-129.pdf",
    pdfFieldMappings: [{ caseField: "part1.name", pdfField: "CompanyName" }],
    formFields: [{ fieldId: "part1.name", label: "Company Name", required: true }],
  };
  const result = PDFValidationService.validate(caseForm, template);
  assert.equal(result.valid, true);
  assert.equal(result.mappedFieldCount, 1);
});

test("PDFValidationService classifies enterprise validation issues", () => {
  const caseForm = {
    filledData: {
      part1: {
        email: "bad-email",
        passportNumber: "12",
        receiptNumber: "abc",
      },
    },
  };
  const template = {
    pdfTemplatePath: "templates/i-129.pdf",
    pdfFieldMappings: [
      { caseField: "part1.email", pdfField: "Email" },
      { caseField: "part1.passportNumber", pdfField: "Passport" },
      { caseField: "part1.receiptNumber", pdfField: "Receipt" },
    ],
    validationConfiguration: {
      requiredAttachments: [{ documentType: "passport", message: "Passport copy is required" }],
    },
    // required:true here matters (Phase H4): a format check on a
    // NON-required field is downgraded to a warning rather than a hard
    // block, since H0's auto-scanned fieldType/semanticType inference is
    // confirmed unreliable (e.g. real I-129 fields mis-tagged "date") - a
    // wrong guess on an optional field shouldn't block generation. These
    // fixture fields are required so the format checks below still
    // exercise the ERROR path this test asserts on.
    formFields: [
      { fieldId: "part1.email", label: "Email", fieldType: "email", required: true },
      { fieldId: "part1.passportNumber", label: "Passport Number", required: true, validationRules: { passport: true } },
      { fieldId: "part1.receiptNumber", label: "Receipt Number", validationRules: { receiptNumber: true } },
    ],
  };
  const result = PDFValidationService.validate(caseForm, template, { documents: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.code === "INVALID_EMAIL"));
  assert.ok(result.errors.some((issue) => issue.code === "INVALID_PASSPORT"));
  assert.ok(result.errors.some((issue) => issue.code === "REQUIRED_ATTACHMENT_MISSING"));
  assert.ok(result.warnings.some((issue) => issue.code === "INVALID_RECEIPT_NUMBER"));
});
