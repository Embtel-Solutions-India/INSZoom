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

// Phase 4 (§I.3) - new semantic-type format transforms.
test("MappingResolver.applyTransform formats ssn as xxx-xx-xxxx from a clean 9-digit value", () => {
  assert.equal(MappingResolver.applyTransform("123456789", { transform: { type: "ssn" } }), "123-45-6789");
  assert.equal(MappingResolver.applyTransform("123-45-6789", { transform: { type: "ssn" } }), "123-45-6789");
});

test("MappingResolver.applyTransform leaves a non-9-digit ssn value untouched rather than producing a malformed one", () => {
  assert.equal(MappingResolver.applyTransform("12345", { transform: { type: "ssn" } }), "12345");
  assert.equal(MappingResolver.applyTransform(undefined, { transform: { type: "ssn" } }), undefined);
});

test("MappingResolver.applyTransform formats alienNumber as A-xxxxxxxxx, adding the prefix if absent", () => {
  assert.equal(MappingResolver.applyTransform("123456789", { transform: { type: "alienNumber" } }), "A-123456789");
  assert.equal(MappingResolver.applyTransform("A123456789", { transform: { type: "alienNumber" } }), "A-123456789");
});

test("MappingResolver.applyTransform formats phone as (xxx) xxx-xxxx, including an 11-digit leading-1 value", () => {
  assert.equal(MappingResolver.applyTransform("5551234567", { transform: { type: "phone" } }), "(555) 123-4567");
  assert.equal(MappingResolver.applyTransform("15551234567", { transform: { type: "phone" } }), "(555) 123-4567");
});

test("MappingResolver.applyTransform passes uscisReceiptNumber through unchanged", () => {
  assert.equal(MappingResolver.applyTransform("EAC1234567890", { transform: { type: "uscisReceiptNumber" } }), "EAC1234567890");
});

test("MappingResolver.applyTransform date/dateFormat regression check (pre-existing, unmodified)", () => {
  assert.equal(MappingResolver.applyTransform("1990-01-15", { transform: { type: "date", format: "mm/dd/yyyy" } }), "01/15/1990");
});
