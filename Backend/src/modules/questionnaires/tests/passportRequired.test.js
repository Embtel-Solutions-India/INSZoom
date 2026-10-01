const test = require("node:test");
const assert = require("node:assert/strict");
const { VISA_TEMPLATE_DEFINITIONS, isPassportInformation } = require("../questionnaire.service");

test("passport information is required in every built-in checklist", () => {
  const optional = [];
  let checked = 0;
  for (const definition of VISA_TEMPLATE_DEFINITIONS) {
    for (const question of definition.questions) {
      if (!isPassportInformation(question)) continue;
      checked += 1;
      if (!question.required) optional.push(`${definition.key}:${question.key}`);
    }
  }
  assert.ok(checked > 100, "expected to check the passport questions across all checklists");
  assert.deepEqual(optional, []);
});

test("passport photos and unrelated passport questions are not treated as passport information", () => {
  assert.equal(isPassportInformation({ key: "petitioner_passport_photos_hard_copy", label: "Passport photos(2pcs)" }), false);
  assert.equal(isPassportInformation({ key: "beneficiary_dsOtherNationalityDetails", label: "Country Name and Passport Number (other nationality)" }), false);
  assert.equal(isPassportInformation({ key: "employee_personal_passportNumber", label: "Passport number" }), true);
  assert.equal(isPassportInformation({ key: "passport", label: "Copy of the passport" }), true);
});
