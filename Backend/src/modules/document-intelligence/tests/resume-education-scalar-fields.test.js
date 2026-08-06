// DB-free unit test for deriveEducationScalarFields (extraction-mapping.service.js).
// The one behavior worth pinning down with a test, per the task that added
// this function: rank order wins over chronological order when picking the
// "primary" education entry to project into flat scalar fields.
const assert = require("node:assert/strict");
const test = require("node:test");
const { deriveEducationScalarFields, EDUCATION_LEVEL_RANK } = require("../services/extraction-mapping.service");

function fieldsWithEducation(entries) {
  return [{ key: "education", value: entries, confidence: 90 }];
}

test("deriveEducationScalarFields picks the highest-RANKED entry, not the most recent, when out of chronological order", () => {
  const fields = fieldsWithEducation([
    { institution: "MIT", degreeType: "doctorate", major: "Physics", awardDate: "1998-05-01", confidence: 92 },
    { institution: "State College", degreeType: "bachelors", major: "History", awardDate: "2021-05-01", confidence: 88 },
  ]);
  const derived = deriveEducationScalarFields(fields);
  const byKey = Object.fromEntries(derived.map((entry) => [entry.key, entry.value]));
  assert.equal(byKey.educationHighestLevel, "doctorate", "the older doctorate must win over the newer bachelor's");
  assert.equal(byKey.educationDegreeType, "doctorate");
  assert.equal(byKey.educationInstitutionName, "MIT");
  assert.equal(byKey.educationMajorFieldOfStudy, "Physics");
  assert.equal(byKey.educationDegreeAwardDate, "1998-05-01");
});

test("deriveEducationScalarFields returns [] when there is no education field or no entries", () => {
  assert.deepEqual(deriveEducationScalarFields([]), []);
  assert.deepEqual(deriveEducationScalarFields([{ key: "education", value: [], confidence: 0 }]), []);
  assert.deepEqual(deriveEducationScalarFields([{ key: "employment", value: [{ employer: "Acme" }], confidence: 90 }]), []);
});

test("deriveEducationScalarFields returns [] when no entry has a recognized degreeType", () => {
  const fields = fieldsWithEducation([{ institution: "Unknown U", degreeType: null, major: "Undeclared", confidence: 40 }]);
  assert.deepEqual(deriveEducationScalarFields(fields), []);
});

test("EDUCATION_LEVEL_RANK is ordered lowest to highest, matching the I-129 Data Collection Supplement's own 9 options", () => {
  assert.deepEqual(EDUCATION_LEVEL_RANK, [
    "no_diploma", "high_school", "some_college", "college_no_degree",
    "associates", "bachelors", "masters", "professional", "doctorate",
  ]);
});
