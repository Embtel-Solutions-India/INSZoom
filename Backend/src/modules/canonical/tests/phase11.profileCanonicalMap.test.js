const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANONICAL_TO_EMPLOYEE_PROFILE,
  CANONICAL_TO_EMPLOYER_PROFILE,
  EMPLOYEE_PROFILE_TO_CANONICAL,
  EMPLOYER_PROFILE_TO_CANONICAL,
  ownerForCanonicalPath,
  profilePathForCanonical,
} = require("../config/profileCanonicalMap");

test("Phase 11 profile crosswalk maps known System B fields to existing canonical paths", () => {
  assert.equal(EMPLOYER_PROFILE_TO_CANONICAL.legalName, "company.name");
  assert.equal(EMPLOYER_PROFILE_TO_CANONICAL["address.street"], "company.address.line1");
  assert.equal(EMPLOYEE_PROFILE_TO_CANONICAL.firstName, "person.firstName");
  assert.equal(EMPLOYEE_PROFILE_TO_CANONICAL.dateOfBirth, "person.dob");
  assert.equal(EMPLOYEE_PROFILE_TO_CANONICAL["passport.number"], "person.passport.number");
});

test("Phase 11 reverse crosswalk routes direct canonical paths to one profile owner only", () => {
  assert.equal(CANONICAL_TO_EMPLOYER_PROFILE["company.name"], "legalName");
  assert.equal(CANONICAL_TO_EMPLOYEE_PROFILE["person.lastName"], "lastName");
  assert.equal(profilePathForCanonical("company.name", "employer"), "legalName");
  assert.equal(profilePathForCanonical("person.dob", "employee"), "dateOfBirth");
  assert.equal(ownerForCanonicalPath("company.ein"), "employer");
  assert.equal(ownerForCanonicalPath("person.firstName"), "employee");
});

test("Phase 11 crosswalk refuses legacy raw Answer paths instead of inventing mappings", () => {
  assert.equal(profilePathForCanonical("raw.questionnaireAnswers.employee_info_firstName.value", "employee"), null);
  assert.equal(profilePathForCanonical("raw.questionnaireAnswers.employer_company_name.value", "employer"), null);
});
