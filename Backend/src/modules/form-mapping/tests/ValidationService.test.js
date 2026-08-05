const assert = require("node:assert/strict");
const test = require("node:test");
const ValidationService = require("../services/ValidationService");

test("ValidationService reports required fields", () => {
  const result = ValidationService.validateField({ fieldId: "part1.name", label: "Name", required: true }, "");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, "REQUIRED");
});

test("ValidationService validates dropdown options", () => {
  const result = ValidationService.validateField({ fieldId: "part1.status", type: "dropdown", options: ["Yes", "No"] }, "Maybe");
  assert.equal(result.errors[0].code, "OPTION");
});

test("ValidationService validates complete template output", () => {
  const template = {
    formFields: [
      { fieldId: "part1.name", label: "Name", required: true },
      { fieldId: "part1.email", type: "email" },
    ],
  };
  const result = ValidationService.validateTemplateOutput(template, { part1: { name: "Jane", email: "jane@example.com" } });
  assert.equal(result.isValid, true);
});
