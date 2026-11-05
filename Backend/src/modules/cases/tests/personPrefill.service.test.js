// Phase 3A: a returning person's own facts carried into a new case - matched by meaning, only the person's own facts, never over an answer. DB-free.
const assert = require("node:assert/strict");
const test = require("node:test");
const { selfNamespace, factOf, normalizeDate, valueFor } = require("../personPrefill.service");

const q = (key, path, type = "text", extra = {}) => ({ key, type, mapping: { canonicalPath: path }, ...extra });

test("self namespace = the party most of the checklist's questions use", () => {
  const petitionerChecklist = [q("a", "petitioner.firstName"), q("b", "petitioner.dateOfBirth", "date"), q("c", "beneficiary.firstName")];
  assert.equal(selfNamespace(petitionerChecklist), "petitioner");
  const nvc = [q("a", "beneficiary.firstName"), q("b", "beneficiary.dateOfBirth"), q("c", "petitioner.lastName")];
  assert.equal(selfNamespace(nvc), "beneficiary");
  assert.equal(selfNamespace([q("a", "person.firstName"), q("b", "contact.email")]), "", "person.* / contact.* checklists have no party namespace");
});

test("the same fact under every name: petitioner.* / beneficiary.* / person.* / contact.* and the name variants", () => {
  assert.equal(factOf(q("x", "petitioner.dateOfBirth", "date"), "petitioner"), "dateOfBirth");
  assert.equal(factOf(q("x", "beneficiary.dateOfBirth", "date"), "beneficiary"), "dateOfBirth");
  assert.equal(factOf(q("x", "person.dob", "date"), ""), "dateOfBirth");
  assert.equal(factOf(q("x", "petitioner.aNumber"), "petitioner"), "aNumber");
  assert.equal(factOf(q("x", "beneficiary.alienRegistrationNumber"), "beneficiary"), "aNumber");
  assert.equal(factOf(q("x", "person.alienNumber"), ""), "aNumber");
  assert.equal(factOf(q("x", "beneficiary.nationality"), "beneficiary"), "countryOfCitizenship");
  assert.equal(factOf(q("x", "petitioner.countryOfCitizenship"), "petitioner"), "countryOfCitizenship");
  assert.equal(factOf(q("x", "contact.address.zip"), ""), "address.zip");
  assert.equal(factOf(q("x", "petitioner.address.postalCode"), "petitioner"), "address.zip");
  assert.equal(factOf(q("x", "beneficiary.passport.number"), "beneficiary"), "passport.number");
});

test("never someone else: the other party namespace, relatives, employment, status, files, history lists", () => {
  // a petitioner checklist asks about the RELATIVE under beneficiary.* - never the petitioner's own data
  assert.equal(factOf(q("x", "beneficiary.firstName"), "petitioner"), null);
  // an employee checklist's petitioner.* is the EMPLOYER
  assert.equal(factOf(q("x", "petitioner.email"), "beneficiary"), null);
  for (const path of ["petitioner.father.firstName", "petitioner.currentSpouse.dateOfBirth", "beneficiary.family.spouse.documents.passport", "petitioner.currentEmployer.name", "beneficiary.currentVisaStatus", "petitioner.i94Number", "petitioner.householdMember.fullName"]) {
    assert.equal(factOf(q("x", path), path.split(".")[0]), null, path);
  }
  assert.equal(factOf(q("x", "beneficiary.passport.number", "file"), "beneficiary"), null, "a file question is never filled with text");
  assert.equal(factOf(q("x", "petitioner.addressHistory", "repeating_group"), "petitioner"), null);
  assert.equal(factOf(q("x", "petitioner.firstName", "signature"), "petitioner"), null);
  assert.equal(factOf(q("x", "employment.jobTitle"), ""), null);
  assert.equal(factOf({ key: "x", type: "text" }, "petitioner"), null, "no canonical path -> never matched by label");
});

test("dates: one normalized form; an ambiguous day/month is never guessed", () => {
  assert.equal(normalizeDate("1990-03-25"), "1990-03-25");
  assert.equal(normalizeDate("1990-03-25T00:00:00.000Z"), "1990-03-25");
  assert.equal(normalizeDate("03/25/1990"), "1990-03-25", "mm/dd/yyyy");
  assert.equal(normalizeDate("25-03-1990"), "1990-03-25", "dd-mm-yyyy");
  assert.equal(normalizeDate("05/05/1990"), "1990-05-05");
  assert.equal(normalizeDate("03/04/1990"), null, "03/04 could be March 4 or 3 April");
  assert.equal(normalizeDate("1990-02-30"), null);
  assert.equal(normalizeDate("not a date"), null);
});

test("values: a drop-down gets only one of its own options; structured values are not carried; text passes", () => {
  const select = q("g", "petitioner.gender", "select", { options: ["Male", "Female"] });
  assert.equal(valueFor(select, "female"), "Female");
  assert.equal(valueFor(select, "F"), undefined, "not one of its options -> left for the person");
  assert.equal(valueFor(q("c", "beneficiary.countryOfBirth", "select", { options: [{ value: "India", label: "India" }] }), "India"), "India");
  assert.equal(valueFor(q("d", "petitioner.dateOfBirth", "date"), "03/25/1990"), "1990-03-25");
  assert.equal(valueFor(q("d", "petitioner.dateOfBirth", "date"), "03/04/1990"), undefined);
  assert.equal(valueFor(q("n", "petitioner.firstName"), "Sam"), "Sam");
  assert.equal(valueFor(q("n", "petitioner.firstName"), { first: "Sam" }), undefined);
});

test("wiring: every path that adds a case to a returning person pre-fills after the checklist exists", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");
  const cases = read("cases", "case.controller.js");
  assert.match(cases, /await lifecycleOrchestrator\.initializeCase\(principalCase, req\.user, req\);\s*\/\/ one login, many cases \(Phase 3A\)[\s\S]{0,400}if \(multiCase && existingHadCase && caseStructure === "single"\)/);
  assert.match(cases, /if \(!client\.createdUser\) setImmediate\(\(\) => require\("\.\/personPrefill\.service"\)/, "Add to this person's login");
  assert.match(read("single-party-filings", "single-party-filing.controller.js"), /if \(!client\.createdUser\) setImmediate\(\(\) => require\("\.\.\/cases\/personPrefill\.service"\)/);
  assert.match(read("family-workflow", "family-workflow.controller.js"), /prefillPersonFromEarlierCases\(caseData\._id, caseData\.petitionerUser, \{ targetRole: "petitioner" \}\)/);
});
