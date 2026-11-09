// Pure name-replacement logic for renaming a case. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateNameInput, splitName, composeFullName, replaceNames, replaceInText, isNamePartsObject } = require("../caseRename.core");

test("validation: a company takes one name, a person a first and last name", () => {
  assert.deepEqual(validateNameInput({ name: "  Suruchi   Inc. " }, { kind: "company" }), { name: "Suruchi Inc.", parts: null });
  assert.ok(validateNameInput({ name: "  " }, { kind: "company" }).error);
  const person = validateNameInput({ firstName: "Aditya", middleName: "K", lastName: "Nautiyal" }, { kind: "person" });
  assert.equal(person.name, "Aditya K Nautiyal");
  assert.ok(validateNameInput({ firstName: "Aditya" }, { kind: "person" }).error, "last name is required");
  assert.ok(validateNameInput({ lastName: "X" }, { kind: "person" }).error, "first name is required");
  assert.equal(validateNameInput({ name: "Ajay Kumar" }, { kind: "person" }).parts.lastName, "Kumar", "a full name alone is split");
  assert.ok(validateNameInput({ firstName: "A".repeat(100), lastName: "B".repeat(100) }, { kind: "person" }).error, "too long");
  assert.equal(validateNameInput({ name: "Bad\u0000 Name\n" }, { kind: "company" }).name, "Bad Name", "control characters are stripped");
});

test("splitName / composeFullName", () => {
  assert.deepEqual(splitName("P. Ravi Kumar"), { firstName: "P.", middleName: "Ravi", lastName: "Kumar" });
  assert.deepEqual(splitName("Cher"), { firstName: "Cher", middleName: "", lastName: "" });
  assert.equal(composeFullName({ firstName: "A", middleName: "", lastName: "B" }), "A B");
});

test("a company name is replaced wherever it stands alone, nothing else changes", () => {
  const tree = {
    questionnaireData: { masterData: { employer: { company: { fullName: "VINDHAM LLC", city: "Dallas" } } } },
    profile: { company: { name: "Vindham LLC" }, petitioner: { name: "vindham  llc" }, notes: "Vindham LLC is the petitioner" },
    list: ["Vindham LLC", "Other Corp"],
  };
  const { value, changes } = replaceNames(tree, { oldName: "Vindham LLC", newName: "SURUCHI INC." });
  assert.equal(value.questionnaireData.masterData.employer.company.fullName, "SURUCHI INC.");
  assert.equal(value.questionnaireData.masterData.employer.company.city, "Dallas");
  assert.equal(value.profile.company.name, "SURUCHI INC.");
  assert.equal(value.profile.petitioner.name, "SURUCHI INC.", "case and spacing are tolerated");
  assert.equal(value.profile.notes, "Vindham LLC is the petitioner", "free text that merely mentions the name is left alone");
  assert.deepEqual(value.list, ["SURUCHI INC.", "Other Corp"]);
  assert.equal(changes.length, 4);
  assert.equal(tree.profile.company.name, "Vindham LLC", "the input is never mutated");
});

test("a person: parts are rewritten only on the object that belongs to the renamed person", () => {
  const tree = {
    person: { firstName: "Aditya", middleName: "", lastName: "Nautiyal", fullName: "Aditya Nautiyal" },
    spouse: { firstName: "Aditya", lastName: "Sharma", fullName: "Aditya Sharma" }, // same first name, different person
    beneficiary: { firstName: "Anirudh", lastName: "Nautiyal" }, // same family name, different person
  };
  const { value } = replaceNames(tree, { oldName: "Aditya Nautiyal", newName: "Aditya Kumar Nautiyal", parts: { firstName: "Aditya", middleName: "Kumar", lastName: "Nautiyal" } });
  assert.deepEqual(value.person, { firstName: "Aditya", middleName: "Kumar", lastName: "Nautiyal", fullName: "Aditya Kumar Nautiyal" });
  assert.deepEqual(value.spouse, tree.spouse);
  assert.deepEqual(value.beneficiary, tree.beneficiary);
});

test("a corrected spelling changes first and last name fields (given / family keys too)", () => {
  const tree = { person: { givenName: "Hanqi", familyName: "Zhang", fullName: "Hanqi 'Dylan' Zhang" }, clientName: "Hanqi 'Dylan' Zhang" };
  const { value } = replaceNames(tree, { oldName: "Hanqi 'Dylan' Zhang", newName: "Hanqi Zhang", parts: { firstName: "Hanqi", middleName: "", lastName: "Zhang" } });
  assert.equal(value.clientName, "Hanqi Zhang");
  assert.equal(value.person.fullName, "Hanqi Zhang");
  assert.equal(value.person.familyName, "Zhang");
  const typo = replaceNames({ p: { firstName: "Leslie", lastName: "Ane", fullName: "Leslie Ane" } }, { oldName: "Leslie Ane", newName: "Leslie Anne", parts: { firstName: "Leslie", middleName: "", lastName: "Anne" } });
  assert.equal(typo.value.p.lastName, "Anne");
  assert.equal(typo.value.p.fullName, "Leslie Anne");
});

test("a middle name is added when the person's data has none", () => {
  const { value, changes } = replaceNames({ person: { firstName: "Ravi", lastName: "Kumar" } }, { oldName: "Ravi Kumar", newName: "Ravi S Kumar", parts: { firstName: "Ravi", middleName: "S", lastName: "Kumar" } });
  assert.equal(value.person.middleName, "S");
  assert.ok(changes.some((change) => change.path === "person.middleName"));
});

test("a company never gets person-part rewrites", () => {
  const { value } = replaceNames({ a: { firstName: "Vindham", lastName: "LLC" } }, { oldName: "Vindham LLC", newName: "SURUCHI INC.", parts: null });
  assert.deepEqual(value.a, { firstName: "Vindham", lastName: "LLC" });
});

test("card names that CONTAIN the old name are replaced as text, only for the listed keys", () => {
  const tree = { integrations: { ghl: { displayName: "Vindham LLC, Aditya Nautiyal", other: "Vindham LLC, x" } } };
  const { value } = replaceNames(tree, { oldName: "Vindham LLC", newName: "SURUCHI INC.", textKeys: ["displayName"] });
  assert.equal(value.integrations.ghl.displayName, "SURUCHI INC., Aditya Nautiyal");
  assert.equal(value.integrations.ghl.other, "Vindham LLC, x");
});

test("non-plain values (dates, ids) and missing input pass through untouched", () => {
  const when = new Date();
  const fakeId = new (class ObjectId { constructor() { this.s = "Vindham LLC"; } })();
  const tree = { when, id: fakeId, nothing: null, n: 5 };
  const { value, changes } = replaceNames(tree, { oldName: "Vindham LLC", newName: "X" });
  assert.equal(value.when, when);
  assert.equal(value.id, fakeId);
  assert.equal(changes.length, 0);
  assert.equal(replaceNames({ a: 1 }, { oldName: "", newName: "X" }).changes.length, 0);
  assert.equal(replaceInText(undefined, "a", "b").changed, false);
});

test("isNamePartsObject needs both parts to match the old name", () => {
  assert.equal(isNamePartsObject({ firstName: "Ajay", lastName: "Kumar" }, "Ajay Kumar"), true);
  assert.equal(isNamePartsObject({ firstName: "Ajay", lastName: "Singh" }, "Ajay Kumar"), false);
  assert.equal(isNamePartsObject({ firstName: "Ajay" }, "Ajay Kumar"), false);
  assert.equal(isNamePartsObject({ firstName: "Ajay", lastName: "Kumar" }, "Ajay"), false);
});

test("findNameParts returns the person's real parts from the case data, not a guess", () => {
  const { findNameParts } = require("../caseRename.core");
  const profile = { person: { firstName: "Mary Ann", middleName: "", lastName: "Smith" }, spouse: { firstName: "Mary", lastName: "Jones" } };
  assert.deepEqual(findNameParts([null, profile], "Mary Ann Smith"), { firstName: "Mary Ann", middleName: "", lastName: "Smith" });
  assert.equal(findNameParts([{ x: 1 }], "Mary Ann Smith"), null);
  assert.equal(findNameParts([profile], "Someone Else"), null);
});
