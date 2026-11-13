// US Passport Renewal for Minors (DS-11, under 16): registration, isolation, section order, exact labels, required/conditional rules, validation. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { US_PASSPORT_MINOR_CHECKLIST_DEFINITIONS, CHECKLIST_KEY, CATEGORY, SECTIONS } = require("../usPassportMinorChecklist");
const { OCI_CHECKLIST_DEFINITIONS } = require("../ociChecklists");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");

const { isQuestionVisible, isQuestionRequired, validateQuestionValue, validateResponse, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = US_PASSPORT_MINOR_CHECKLIST_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `ds11minor_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const a = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [`ds11minor_${k}`, v]));
const labelsOf = (section) => definition.questions.filter((question) => question.sectionKey === require("../definitionHelpers").slugSection(section)).map((question) => question.label);

test("registration: own checklist, client role, not a default, no forms, registered once, assigned only by its own filing type", () => {
  assert.equal(definition.key, CHECKLIST_KEY);
  assert.equal(definition.checklistRole, "client");
  assert.equal(definition.isDefault, false);
  assert.equal(definition.visaType, "US-PASSPORT-MINOR");
  const filing = filingTypes.getFilingType("US_PASSPORT_MINOR_DS11");
  assert.deepEqual([filing.visaType, filing.questionnaireKey, filing.section], ["US-PASSPORT-MINOR", CHECKLIST_KEY, "indian_timeline"]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key));
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1, "registered exactly once (no scaffold duplicate)");
  const registry = visaCategories.VISA_CATEGORIES["US-PASSPORT-MINOR"];
  assert.deepEqual([registry.caseStructure, registry.forms, registry.noForms], ["single", [], true]);
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "US-PASSPORT-MINOR").length, 0);
  assert.equal(visaCategories.VISA_CATEGORIES.OCI.subTypes.length, 5, "OCI untouched");
  assert.equal(OCI_CHECKLIST_DEFINITIONS[0].questions.length, 43, "an existing checklist is unchanged");
  const others = VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY);
  const otherKeys = new Set(others.flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => otherKeys.has(question.key)), "no question key is shared with any other checklist");
  assert.equal(new Set(definition.questions.map((question) => question.key)).size, definition.questions.length, "no duplicate keys");
});

test("five sections in order with the exact supplied question labels and counts", () => {
  assert.deepEqual(SECTIONS, definition.sections);
  assert.equal(SECTIONS.length, 5);
  assert.deepEqual(labelsOf(SECTIONS[0]), ["First Name", "Middle Name", "Last Name", "Other Names Used", "Date of Birth (MM/DD/YYYY)", "Social Security Number (SSN)*", "City of Birth", "State / Territory of Birth", "Country of Birth", "USCIS Registration A-Number (if any)", "Sex (M / F / X)", "Height (Feet & Inches)", "Hair Color", "Eye Color", "Occupation", "School Name"]);
  assert.deepEqual(labelsOf(SECTIONS[1]), ["Full Mailing Address", "In Care Of Full Name (Parent/Guardian receiving mail)", "Is Mailing Address same as Permanent Address?", "Full Permanent Address (if different)", "Email Address", "Phone / Mobile Number"]);
  assert.deepEqual(labelsOf(SECTIONS[2]), ["Date of Departure (MM/DD/YYYY)", "Date of Return (MM/DD/YYYY)", "Countries to be Visited", "Full Name (First & Last)", "Full Mailing Address", "Telephone / Contact Number", "Email Address", "Relationship with Minor"]);
  assert.equal(labelsOf(SECTIONS[3])[0], "Select application category / product requested:");
  assert.deepEqual(labelsOf(SECTIONS[4]).slice(0, 5), ["Father's / Parent 1 First & Middle Name", "Father's / Parent 1 Last Name", "Date of Birth (MM/DD/YYYY)", "Place of Birth (City, State, Country)", "U.S. Citizen?"]);
  assert.deepEqual(labelsOf(SECTIONS[4]).slice(5, 6), ["Mother's / Parent 2 First & Middle Name"]);
  assert.equal(definition.questions.length, 16 + 6 + 8 + 5 + 10);
  assert.deepEqual(q("category").options.map((o) => o.value), Object.values(CATEGORY));
  assert.deepEqual(q("sex").options.map((o) => o.value), ["M", "F", "X"]);
  assert.deepEqual(q("prev_status").options.map((o) => o.value), ["Submitted", "Lost", "Stolen*"]);
  assert.deepEqual(q("occupation").options.map((o) => o.value), ["Student / Child"]);
  assert.equal(q("ssn").description, "SSN Requirement: You must provide an SSN if issued. If the child has NEVER been issued an SSN, enter 000-00-0000.");
  assert.equal(labelsOf(SECTIONS[2]).length, 8);
});

test("no show-when rules: every question is always visible; exact required list; one set of recent-passport fields", () => {
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, question.key + " has no show-when rule");
    assert.equal(isQuestionVisible(question, {}, client), true, question.key + " visible with no answers");
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("ds11minor_", "")).sort();
  assert.deepEqual(required, ["first_name", "last_name", "date_of_birth", "ssn", "city_of_birth", "country_of_birth", "sex", "height", "hair_color", "eye_color", "occupation", "mailing_address", "mailing_same_as_permanent", "email", "phone", "emergency_name", "emergency_address", "emergency_phone", "emergency_relationship", "category", "parent1_first_middle_name", "parent1_last_name", "parent1_dob", "parent1_place_of_birth", "parent1_us_citizen"].sort());
  for (const name of ["middle_name", "other_names", "state_of_birth", "a_number", "school_name", "in_care_of", "permanent_address", "departure_date", "return_date", "countries_to_visit", "emergency_email", "prev_number", "prev_issue_date", "prev_status", "prev_expiry_date", "parent2_first_middle_name", "parent2_last_name", "parent2_dob", "parent2_place_of_birth", "parent2_us_citizen"]) assert.equal(state(name).required, false, name);
  for (const gone of ["card_number", "card_issue_date", "card_status", "card_expiry_date"]) assert.equal(q(gone), undefined, gone + " (the second Passport Card set) is not in the supplied checklist");
  const hints = definition.questions.filter((question) => question.description).map((question) => question.key.replace("ds11minor_", "")).sort();
  assert.deepEqual(hints, ["departure_date", "emergency_name", "ssn"], "only the hints that are in the supplied checklist");
});

test("an applicant with every required answer is complete (recent-passport fields and Parent 2 are optional)", () => {
  const answers = a({
    first_name: "A", last_name: "B", date_of_birth: "2018-04-02", ssn: "000-00-0000", city_of_birth: "Austin", state_of_birth: "TX", country_of_birth: "United States", sex: "F", height: "3 ft 5 in", hair_color: "Brown", eye_color: "Brown", occupation: "Student / Child",
    mailing_address: { line1: "1 Main", city: "Austin" }, mailing_same_as_permanent: "Yes", email: "a@b.co", phone: "+15125550100",
    emergency_name: "C D", emergency_address: { line1: "2 Oak" }, emergency_phone: "5125550101", emergency_relationship: "Aunt",
    category: CATEGORY.first,
    parent1_first_middle_name: "P", parent1_last_name: "B", parent1_dob: "1985-01-01", parent1_place_of_birth: "Delhi, India", parent1_us_citizen: "No",
    parent2_first_middle_name: "M", parent2_last_name: "B", parent2_dob: "1986-02-02", parent2_place_of_birth: "Austin, TX, USA", parent2_us_citizen: "Yes",
  });
  const result = validateResponse(definition, definition.questions, answers, client);
  assert.deepEqual(result.missingRequired, []);
  assert.deepEqual(result.errors, []);
  assert.notEqual(answers.ds11minor_parent1_dob, answers.ds11minor_parent2_dob, "parents stored independently");
});

test("backend validation: SSN (incl. placeholder), A-Number, height, email, phone, dates", () => {
  const errs = (name, value) => validateQuestionValue(q(name), value).errors;
  assert.deepEqual(errs("ssn", "123-45-6789"), []);
  assert.deepEqual(errs("ssn", "000-00-0000"), [], "placeholder accepted");
  assert.deepEqual(errs("ssn", "123456789"), []);
  assert.equal(errs("ssn", "12-345").length, 1);
  assert.equal(errs("ssn", "abc").length, 1);
  assert.equal(q("ssn").metadata.sensitive, true);
  assert.deepEqual(errs("a_number", "A123456789"), []);
  assert.deepEqual(errs("a_number", ""), [], "optional blank");
  assert.equal(errs("a_number", "A12").length, 1);
  for (const ok of ["4 ft 6 in", "4'6\"", "5-11", "3 feet 0 inches"]) assert.deepEqual(errs("height", ok), [], ok);
  for (const bad of ["tall", "7 ft 2 in", "4 ft 12 in"]) assert.equal(errs("height", bad).length, 1, bad);
  assert.equal(errs("email", "nope").length, 1);
  assert.equal(errs("emergency_email", "nope").length, 1);
  assert.deepEqual(errs("emergency_email", ""), []);
  assert.equal(errs("phone", "12").length, 1);
  assert.equal(errs("emergency_phone", "12").length, 1);
  for (const name of ["date_of_birth", "departure_date", "return_date", "prev_issue_date", "prev_expiry_date", "parent1_dob", "parent2_dob"]) assert.ok(errs(name, "not-a-date").length >= 1, name);
  assert.equal(errs("date_of_birth", "2999-01-01").length, 1, "DOB in the future");
  assert.deepEqual(errs("prev_expiry_date", "2031-06-01"), [], "an expiry date may be in the future");
});

test("prefill mappings reuse existing canonical paths only for the minor's own fields; parents are never mapped", () => {
  const mapped = Object.fromEntries(definition.questions.filter((question) => question.mapping).map((question) => [question.key, question.mapping.canonicalPath]));
  assert.deepEqual(mapped, { ds11minor_first_name: "person.firstName", ds11minor_last_name: "person.lastName", ds11minor_date_of_birth: "person.dob", ds11minor_country_of_birth: "person.countryOfBirth", ds11minor_phone: "contact.phone" });
});
