const test = require("node:test");
const assert = require("node:assert/strict");
const { derivePassportScalarFields } = require("../services/extraction-mapping.service");

const derive = (value) => Object.fromEntries(derivePassportScalarFields([{ key: "placeOfBirth", value, confidence: 90 }]).map((f) => [f.key, f.value]));

test("city, country -> country of birth and state/city", () => {
  assert.deepEqual(derive("TORONTO, CANADA"), { countryOfBirth: "Canada", placeOfBirthState: "TORONTO" });
  assert.deepEqual(derive("Houston, Texas, U.S.A."), { countryOfBirth: "United States", placeOfBirthState: "Houston, Texas" });
});

test("an Indian state is never mistaken for the country", () => {
  assert.deepEqual(derive("MUMBAI, MAHARASHTRA"), { placeOfBirthState: "MUMBAI, MAHARASHTRA" });
});

test("a single token is kept as province/state only", () => {
  assert.deepEqual(derive("DELHI"), { placeOfBirthState: "DELHI" });
});

test("no place of birth yields nothing", () => {
  assert.deepEqual(derivePassportScalarFields([{ key: "firstName", value: "A" }]), []);
});
