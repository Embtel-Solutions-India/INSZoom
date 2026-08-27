const assert = require("node:assert/strict");
const test = require("node:test");

const { mappingsFor } = require("../config/field-mapping.registry");
const h1b = require("../../employment-workflow/questionnaires/h1b");

const h1bQuestionKeys = new Set(
  h1b.fieldCatalog()
    .filter((entry) => !entry.repeatable)
    .map((entry) => entry.path.replace(/\./g, "_"))
);

test("LCA field mapping covers confirmed employee, employer, and position fields", () => {
  const mappings = mappingsFor("lca");

  const expected = {
    firstName: "employee_personal_firstName",
    lastName: "employee_personal_lastName",
    dateOfBirth: "employee_personal_dateOfBirth",
    countryOfBirth: "employee_personal_countryOfBirth",
    alienNumber: "employee_personal_alienRegistrationNumber",
    passportNumber: "employee_personal_passportNumber",
    employerLegalName: "employer_company_fullName",
    employerEin: "employer_company_fein",
    employerPhone: "employer_company_daytimePhone",
    naicsCode: "employer_company_naicsCode",
    totalWorkers: "employer_workforce_totalUsEmployees",
    socCode: "employer_position_socCode",
    jobTitle: "employer_position_jobTitle",
    offeredWageRate: "employer_position_offeredSalary",
    employmentBeginDate: "employer_position_employmentStartDate",
  };

  for (const [fieldKey, questionKey] of Object.entries(expected)) {
    assert.ok(mappings[fieldKey]?.questionnaire?.includes(questionKey), `${fieldKey} should map to ${questionKey}`);
  }
});

test("LCA mappings only target scalar H-1B questionnaire keys that exist", () => {
  const mappings = mappingsFor("lca");

  for (const mapping of Object.values(mappings)) {
    for (const questionKey of mapping.questionnaire || []) {
      assert.ok(h1bQuestionKeys.has(questionKey), `${questionKey} is not an active H-1B scalar question key`);
    }
  }
});

test("certified_lca_eta9035 uses the same deterministic mappings as lca", () => {
  assert.deepEqual(mappingsFor("certified_lca_eta9035"), mappingsFor("lca"));
});
