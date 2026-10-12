const assert = require("node:assert/strict");
const test = require("node:test");
const { SB1_CHECKLIST_DEFINITION: def } = require("../sb1Checklist");
const { isPassportInformation } = require("../passportInformation");
// Platform-wide rule (passportInformation.js, applied when questionnaire.service loads): passport information is never optional in any
// checklist. It is the one exception to "everything optional"; the stored Question.required flag is always false regardless.
const optionalExceptPassport = (item) => item.required === isPassportInformation(item);
const { isQuestionVisible, validateQuestionValue, validateResponse } = require("../questionnaire.service");
const CanonicalFieldRegistryService = require("../../form-mapping/services/CanonicalFieldRegistryService");
const { getCaseStructure } = require("../../../config/visaCategories");
const { categoryForVisa } = require("../../../integrations/ghl/ghlAuxOutbound");

// SB-1 Visa Questionnaire - the internal client intake for a returning resident. Not a government form: no question is mapped to any PDF.
// DB-free; the end-to-end behaviour is in sb1-e2e.test.js.

const byKey = new Map(def.questions.map((item) => [item.key, item]));
const question = (key) => { assert.ok(byKey.has(key), `${key} must exist`); return byKey.get(key); };
const client = { role: "client" };
const visible = (answers) => new Set(def.questions.filter((item) => isQuestionVisible(item, answers, client)).map((item) => item.key));

test("registered as the single-person SB-1 questionnaire: client role, default, titled 'SB-1 Visa Questionnaire'", () => {
  assert.equal(def.title, "SB-1 Visa Questionnaire");
  assert.equal(def.visaType, "SB-1");
  assert.equal(def.checklistRole, "client");
  assert.equal(def.isDefault, true);
  assert.equal(def.reconcileMetadata, true);
  assert.equal(getCaseStructure("SB-1"), "single");
});

test("all 13 sections of the specification are present, in order", () => {
  assert.deepEqual(def.sections.slice(0, 13), [
    "Information About You", "Marital Information", "Close Family Members in the United States", "Previous Immigration Record", "Previous Immigrant Visa",
    "Adjustment of Status", "Initial Entry as Lawful Permanent Resident", "Last Entry as Lawful Permanent Resident", "Most Recent Departure",
    "Continuing U.S. Ties", "Reason for Delayed Return", "Periods Outside the United States", "Employment Outside the United States",
  ]);
});

test("every question is optional, except passport information which the platform always requires", () => {
  def.questions.forEach((item) => assert.ok(optionalExceptPassport(item), item.key));
  assert.deepEqual(def.questions.filter((item) => item.required).map((item) => item.key), ["sb1_doc_passport", "sb1_doc_passportEntryExitStamps"]);
});

test("every non-file question is bound to a registered canonical path, with no form-specific or government-form binding", () => {
  const registered = new Set(CanonicalFieldRegistryService.list({}).map((field) => field.path));
  def.questions.filter((item) => item.type !== "file").forEach((item) => {
    const path = item.mapping?.canonicalPath;
    assert.ok(path, `${item.key} has no canonical path`);
    assert.ok(registered.has(path), `${path} is not registered`);
    assert.doesNotMatch(path, /^(ds|i-?\d|form|uscis)/i, `${path} is form-specific`);
    assert.equal(item.mapping.uscisFormNumber, undefined, `${item.key} must not point at a government form`);
    assert.deepEqual(item.uscisMappings || [], []);
  });
});

test("canonical crosswalk reuses existing paths for facts the platform already stores", () => {
  const expect = {
    client_firstName: "person.firstName", client_lastName: "person.lastName", client_dateOfBirth: "person.dob", client_placeOfBirthCountry: "person.countryOfBirth",
    client_placeOfBirthCity: "person.cityTownOfBirth", client_telephoneNumber: "contact.phone", client_currentHomeAddressLine1: "contact.address.line1",
    client_currentHomeAddressCountry: "contact.address.country", client_maritalStatus: "person.maritalStatus", client_aNumber: "person.alienNumber",
    client_spouseFirstName: "family.spouse.firstName", client_spouseLastName: "family.spouse.lastName",
    client_continuingUSTies: "immigration.returningResident.continuingUSTiesAndRetentionEfforts", client_reasonForNotReturning: "immigration.returningResident.reasonsForDelayedReturn",
    client_initialLprEntryDate: "immigration.permanentResidentHistory.initialEntry.date", client_lastLprEntryDate: "immigration.permanentResidentHistory.lastEntry.date",
    client_mostRecentDepartureDate: "immigration.permanentResidentHistory.mostRecentDeparture.date",
    client_periodsOutsideUs: "immigration.residenceAbroadPeriods", client_closeFamilyMembers: "familyMembersInUS",
    client_employedOutsideUs: "immigration.returningResident.employmentOutsideUS.sinceMostRecentDeparture", client_foreignEmployment: "immigration.returningResident.employmentOutsideUS.records",
  };
  for (const [key, path] of Object.entries(expect)) assert.equal(question(key).mapping.canonicalPath, path, key);
  // initial entry, last entry and departure are stored independently; previous visa is separate from the card
  const paths = def.questions.map((item) => item.mapping?.canonicalPath).filter(Boolean);
  assert.equal(new Set(paths.filter((path) => /permanentResidentHistory/.test(path))).size, 7);
  assert.ok(paths.every((path) => !/^applicant\./.test(path)), "applicant.* is not a canonical namespace");
});

test("spouse questions appear only when the marital status is Married", () => {
  const spouse = def.questions.filter((item) => /^client_spouse|^client_dateOfMarriage/.test(item.key)).map((item) => item.key);
  assert.ok(spouse.length >= 15);
  const single = visible({ client_maritalStatus: "Single" });
  const married = visible({ client_maritalStatus: "Married" });
  spouse.forEach((key) => { assert.ok(!single.has(key), `${key} hidden for Single`); assert.ok(married.has(key), `${key} shown for Married`); });
  ["Widowed", "Divorced"].forEach((status) => assert.ok(!visible({ client_maritalStatus: status }).has("client_spouseFirstName")));
  assert.deepEqual(question("client_maritalStatus").options.map((option) => option.value), ["Single", "Married", "Widowed", "Divorced"]);
});

test("employer table is shown only when employed outside the US; the 'Yes' answer creates no employer / employee record", () => {
  assert.ok(!visible({ client_employedOutsideUs: "No" }).has("client_foreignEmployment"));
  assert.ok(visible({ client_employedOutsideUs: "Yes" }).has("client_foreignEmployment"));
  assert.doesNotMatch(JSON.stringify(def.questions.map((item) => item.mapping)), /company\.|employer\./);
});

test("repeatable tables: other names, family members, periods abroad, employers - no fixed maximum, structured address columns", () => {
  ["client_otherNamesUsed", "client_closeFamilyMembers", "client_periodsOutsideUs", "client_foreignEmployment"].forEach((key) => {
    const item = question(key);
    assert.equal(item.type, "repeating_group", key);
    assert.equal(item.repeatableConfig?.max, undefined, `${key} has no maximum`);
  });
  const address = question("client_closeFamilyMembers").metadata.fields.map((field) => field.key).filter((key) => /^address/.test(key));
  assert.deepEqual(address, ["addressLine1", "addressCity", "addressState", "addressPostalCode", "addressCountry"]);
  assert.ok(question("client_closeFamilyMembers").metadata.fields.find((field) => field.key === "relationship").options.includes("Other"));
  assert.ok(question("client_spouseUsResidenceStatus").options.some((option) => option.value === "Other"));
});

test("periods abroad and employment rows: an end date before the start date is flagged; incomplete rows are kept, not dropped", () => {
  const periods = question("client_periodsOutsideUs");
  const bad = validateQuestionValue(periods, [{ fromDate: "2022-06-01", toDate: "2021-01-01", country: "India" }]);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /end date/i);
  assert.equal(validateQuestionValue(periods, [{ fromDate: "2021-01-01", toDate: "2022-01-01", country: "India" }]).errors.length, 0);
  assert.equal(validateQuestionValue(periods, [{ fromDate: "2021-01-01" }, {}, { country: "India" }]).errors.length, 0, "incomplete rows are valid (every field is optional)");
  assert.equal(validateQuestionValue(question("client_foreignEmployment"), [{ employerName: "Acme", fromDate: "2020-05-01", toDate: "2020-01-01" }]).errors.length, 1);
  // more than six periods (the old paper-form limit) are fine
  assert.equal(validateQuestionValue(periods, Array.from({ length: 9 }, (_, index) => ({ fromDate: `20${10 + index}-01-01`, toDate: `20${10 + index}-12-31`, country: "India" }))).errors.length, 0);
});

test("dates cannot be in the future, an A-Number is format-checked, and a hidden answer never blocks submission", () => {
  assert.equal(validateQuestionValue(question("client_dateOfBirth"), "2999-01-01").errors.length, 1);
  assert.equal(validateQuestionValue(question("client_mostRecentDepartureDate"), "2999-01-01").errors.length, 1);
  assert.equal(validateQuestionValue(question("client_aNumber"), "A-123456789").errors.length, 0);
  assert.equal(validateQuestionValue(question("client_aNumber"), "bad").errors.length, 1);
  assert.equal(validateQuestionValue(question("client_aNumber"), "").errors.length, 0, "optional");
  const stored = { client_maritalStatus: "Single", client_spouseDateOfBirth: "2999-01-01" };
  assert.equal(validateResponse({ _id: "q", key: def.key, version: 1 }, def.questions, stored, client).valid, true);
});

test("narrative answers are stored verbatim as long text and the checklist makes no eligibility decision", () => {
  ["client_continuingUSTies", "client_reasonForNotReturning", "client_reasonForLeavingUs"].forEach((key) => assert.equal(question(key).type, "textarea", key));
  assert.equal(question("client_continuingUSTies").label, "What continuing ties have you maintained with the United States? What efforts have you made to avoid abandoning your permanent resident status in the United States?");
  assert.equal(question("client_reasonForNotReturning").label, "What are the reasons for not returning to the United States until the time of this application?");
  assert.ok(!def.questions.some((item) => /eligib/i.test(item.key)));
});

test("documents: the ten specified categories exist, all optional, travel / tax / prolonged-stay evidence accept several files", () => {
  const docs = def.questions.filter((item) => item.type === "file");
  const labels = docs.map((item) => item.label).join(" | ");
  ["Passport", "Permanent Resident Card", "Re-entry Permit", "Airline tickets", "entry/exit stamps", "tax returns", "W-2", "Employment verification letter", "property ownership", "business ownership", "beyond the applicant's control"]
    .forEach((text) => assert.match(labels, new RegExp(text, "i"), text));
  docs.forEach((item) => { assert.ok(optionalExceptPassport(item), item.key); assert.equal(item.metadata.documentType, item.key); });
  assert.deepEqual(docs.find((item) => item.key === "sb1_doc_reentryPermit").conditionalLogic.rules[0], { questionKey: "client_hasReentryPermit", operator: "equals", value: "Yes" });
  assert.ok(!visible({ client_hasReentryPermit: "No" }).has("sb1_doc_reentryPermit"));
});

test("staff-only: visibility lists client + staff roles only (no attorney, employer, petitioner, beneficiary)", () => {
  def.questions.forEach((item) => {
    assert.ok(item.visibility.roles.includes("client"));
    ["attorney", "employer", "employee", "petitioner", "beneficiary", "joint_sponsor"].forEach((role) => assert.ok(!item.visibility.roles.includes(role), `${item.key}/${role}`));
  });
});

test("the GHL pipeline treats SB-1 as an immigrant case", () => {
  assert.equal(categoryForVisa("SB-1", "", []), "immigrant");
});
