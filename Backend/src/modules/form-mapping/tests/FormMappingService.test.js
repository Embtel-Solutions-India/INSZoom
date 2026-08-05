const assert = require("node:assert/strict");
const test = require("node:test");
const FormMappingService = require("../services/FormMappingService");

test("FormMappingService maps template fields from canonical data", () => {
  const template = {
    formCode: "I-129",
    version: "01/17/25",
    formFields: [
      {
        fieldId: "part2.firstName",
        label: "First name",
        required: true,
        mappings: [{ source: "beneficiary", path: "firstName" }],
      },
      {
        fieldId: "part2.fullName",
        label: "Full name",
        mappings: [{ source: "beneficiary", derived: "fullName" }],
      },
    ],
  };
  const result = FormMappingService.mapTemplate(template, { beneficiary: { firstName: "Jane", lastName: "Doe" } });
  assert.equal(result.filledData.part2.firstName, "Jane");
  assert.equal(result.filledData.part2.fullName, "Jane Doe");
  assert.equal(result.completion.percent, 100);
  assert.equal(result.validation.isValid, true);
});

test("FormMappingService respects field conditional logic", () => {
  const template = {
    formFields: [
      {
        fieldId: "h1b.employerName",
        label: "Employer",
        showWhen: { field: "case.visaType", value: "H1B" },
        mappings: [{ source: "company", path: "name" }],
      },
      {
        fieldId: "l1.managerName",
        label: "Manager",
        showWhen: { field: "case.visaType", value: "L1" },
        mappings: [{ source: "company", path: "manager" }],
      },
    ],
  };
  const result = FormMappingService.mapTemplate(template, { case: { visaType: "H1B" }, company: { name: "Acme" } });
  assert.equal(result.filledData.h1b.employerName, "Acme");
  assert.equal(result.filledData.l1, undefined);
});
