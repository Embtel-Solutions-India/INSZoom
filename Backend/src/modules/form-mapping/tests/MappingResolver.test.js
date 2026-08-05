const assert = require("node:assert/strict");
const test = require("node:test");
const MappingResolver = require("../services/MappingResolver");

test("MappingResolver resolves nested and array paths", () => {
  const data = { employmentHistory: [{ employerName: "Acme" }], beneficiary: { address: { city: "Austin" } } };
  assert.equal(MappingResolver.resolvePath(data, "employmentHistory[0].employerName"), "Acme");
  assert.equal(MappingResolver.resolvePath(data, "beneficiary.address.city"), "Austin");
});

test("MappingResolver resolves conditional rules", () => {
  const data = { case: { visaType: "H1B" }, beneficiary: { firstName: "Jane" } };
  assert.equal(MappingResolver.resolveConditionalRule({ field: "case.visaType", value: "H1B" }, data), true);
  assert.equal(MappingResolver.resolveConditionalRule({ field: "beneficiary.firstName", operator: "exists" }, data), true);
});

test("MappingResolver resolves derived full name and age", () => {
  const data = { beneficiary: { firstName: "Jane", lastName: "Doe", dateOfBirth: "1990-01-01" } };
  assert.equal(MappingResolver.resolveDerivedValue({ derived: "fullName" }, data), "Jane Doe");
  assert.equal(typeof MappingResolver.resolveDerivedValue({ derived: "age" }, data), "number");
});

test("MappingResolver resolves canonical mappings from root profile", () => {
  const data = { person: { firstName: "Jane" } };
  const result = MappingResolver.resolveMapping({ source: "canonical", path: "person.firstName" }, data);
  assert.equal(result.value, "Jane");
  assert.equal(result.sourceField, "person.firstName");
});

test("MappingResolver executes stored transform objects", () => {
  const data = {
    person: { firstName: "Jane", middleName: "Q", lastName: "Doe", dob: "1990-01-02" },
  };
  const fullName = MappingResolver.resolveMapping({
    source: "canonical",
    path: "person.fullName",
    transform: {
      type: "concat",
      fields: ["person.firstName", "person.middleName", "person.lastName"],
      separator: " ",
    },
  }, data);
  const date = MappingResolver.resolveMapping({
    source: "canonical",
    path: "person.dob",
    transform: { type: "date", format: "mm/dd/yyyy" },
  }, data);

  assert.equal(fullName.value, "Jane Q Doe");
  assert.equal(date.value, "01/02/1990");
});
