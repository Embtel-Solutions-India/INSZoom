// Indian E-Tourist Visa -> E-Visa: registration, exact labels and order, field types, conditional / required rules, document checklist, isolation. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { INDIAN_ETOURIST_EVISA_DEFINITIONS, CHECKLIST_KEY, SECTIONS } = require("../indianEtouristEvisaChecklist");
const { INDIAN_ETOURIST_BUSINESS_DEFINITIONS } = require("../indianEtouristBusinessChecklist");
const { slugSection } = require("../definitionHelpers");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../singlePartyChecklists");

const { isQuestionVisible, isQuestionRequired, validateResponse, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = INDIAN_ETOURIST_EVISA_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `inev_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const a = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [`inev_${k}`, v]));
const labelsOf = (section) => definition.questions.filter((question) => question.sectionKey === slugSection(section)).map((question) => question.label);

test("registration: E-Visa is the second subtype of Indian E-Tourist Visa and carries its own checklist; Business Visa and other types untouched", () => {
  const evisa = filingTypes.getFilingType("INDIAN_ETOURIST_SUBTYPE_2");
  const business = filingTypes.getFilingType("INDIAN_ETOURIST_BUSINESS");
  assert.deepEqual([evisa.label, evisa.visaType, evisa.questionnaireKey], ["E-Visa", "INDIAN-E-TOURIST-VISA", CHECKLIST_KEY]);
  assert.equal(business.questionnaireKey, "indian_etourist_business_visa_checklist");
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1);
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.visaType === "INDIAN-E-TOURIST-VISA").length, 2);
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.filter((item) => item.visaType === "INDIAN-E-TOURIST-VISA").length, 0, "no scaffold checklist next to the real one");
  assert.deepEqual(visaCategories.VISA_CATEGORIES["INDIAN-E-TOURIST-VISA"].subTypes, ["Business Visa", "E-Visa"]);
  assert.equal(definition.isDefault, false);
  assert.equal(definition.checklistRole, "client");
  assert.equal(definition.description, undefined, "no banner or extra text");
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => others.has(question.key)), "no question key shared with another checklist");
  assert.equal(INDIAN_ETOURIST_BUSINESS_DEFINITIONS[0].questions.length > 100, true, "the Business Visa checklist is unchanged");
});

test("sections, exact labels and order", () => {
  assert.equal(SECTIONS.length, 12);
  const S = (n) => SECTIONS[n + 1]; // S(0) = Section A ... S(10) = Section K
  assert.deepEqual(labelsOf(SECTIONS[0]), ["Applicant Name", "Phone Number"]);
  assert.deepEqual(labelsOf(S(0)), ["Surname (Last Name)", "Given Name (First Name)", "Previous / Other Name(s) (if any)", "Gender", "Marital Status", "Date of Marriage", "Date of Birth", "Religion", "Place of Birth (City/Town, State)", "Country of Birth", "Current Citizenship / Nationality", "Citizenship/National Id No.", "Visible Identification Marks", "Highest Educational Qualification", "Qualification acquired from College/University"]);
  assert.deepEqual(labelsOf(S(1)), ["Passport Number", "Date of Issue", "Date of Expiry", "Place / Authority of Issue", "Do you hold any other Passport or Identity Certificate?", "If Yes, Passport / IC Number", "If Yes, Country of Issue", "If Yes, Date of Issue", "If Yes, Place of Issue", "If Yes, Nationality mentioned therein"]);
  assert.deepEqual(labelsOf(S(2)), ["Present Residential Address", "Permanent Address", "Mobile / Phone Number", "Email Address"]);
  assert.equal(labelsOf(S(3)).length, 15);
  assert.deepEqual(labelsOf(S(4)), ["Were your parents or grandparents (paternal/maternal) Pakistan nationals or from Pakistan-held territories?", "If Yes, provide detailed information"]);
  assert.deepEqual(labelsOf(S(5)), ["Visa Service Type Requested", "Requested Visa Duration / Validity", "Number of Entries Required", "Expected Date of Journey / Arrival", "Designated Port of Arrival in India", "Expected Port of Exit from India"]);
  assert.equal(labelsOf(S(6)).length, 9);
  assert.equal(labelsOf(S(7)).length, 12, "11 supplied questions + the e-Visa details follow-up");
  assert.equal(labelsOf(S(8)).length, 8, "7 supplied questions + the military details follow-up");
  assert.equal(labelsOf(S(9)).length, 6);
  assert.deepEqual(labelsOf(S(10)), ["Current Valid Passport (Color scanned copy of First & Last page)", "Recent Passport-Style Color Photograph (White background)", "Invitation Letter from Inviting Person/Host in India (If applicable)"]);
  assert.equal(definition.questions.length, 2 + 15 + 10 + 4 + 15 + 2 + 6 + 9 + 12 + 8 + 6 + 3);
});

test("answer types and options", () => {
  const type = (name) => q(name).type;
  assert.deepEqual(["applicant_phone", "mobile", "employer_phone", "ref_phone", "emergency_phone"].map(type), Array(5).fill("phone"));
  assert.equal(type("email"), "email");
  for (const name of ["date_of_marriage", "date_of_birth", "passport_issue_date", "passport_expiry_date", "other_passport_issue_date", "journey_date"]) assert.equal(type(name), "date");
  for (const name of ["present_address", "permanent_address", "pakistan_origin_details", "tour_operator_details", "stay_address", "contact_in_india", "prev_stay_address", "prev_cities", "permission_denied_details", "countries_10_years", "employer_address", "military_details", "ref_address", "emergency_address", "applied_evisa_details"]) assert.equal(type(name), "textarea");
  assert.deepEqual(q("gender").options.map((o) => o.value), ["Male", "Female", "Transgender"]);
  assert.deepEqual(q("marital_status").options.map((o) => o.value), ["Single", "Married", "Divorced", "Widowed"]);
  assert.deepEqual(q("visa_service_type").options.map((o) => o.value), ["E-Tourist Visa"], "the visa service type is one fixed value");
  assert.equal(type("visa_duration"), "text");
  assert.equal(q("visa_duration").description, "e.g., 30 Days / 1 Year / 5 Years");
  assert.deepEqual(q("entries").options.map((o) => o.value), ["Double Entry", "Multiple Entry"]);
  assert.deepEqual(q("purpose").options.map((o) => o.value), ["Tourism", "Recreation", "Sightseeing", "Meeting Friends/Relatives"]);
  for (const name of ["other_passport", "pakistan_origin", "hotel_booked", "tour_operator", "applied_evisa", "visited_india", "permission_denied", "saarc", "name_changed", "military"]) assert.deepEqual(q(name).options.map((o) => o.value), ["Yes", "No"], name);
  assert.ok(q("country_of_birth").options.length > 100 && q("citizenship").options.length > 100, "country selectors");
});

test("no show-when rules: every question is always visible; exact required list; situational items optional", () => {
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, question.key + " has no show-when rule");
    assert.equal(isQuestionVisible(question, {}, client), true, question.key + " visible with no answers");
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("inev_", "")).sort();
  assert.deepEqual(required, ["applicant_name", "applicant_phone", "surname", "given_name", "gender", "marital_status", "date_of_birth", "religion", "place_of_birth", "country_of_birth", "citizenship", "citizenship_id", "identification_marks", "education",
    "passport_number", "passport_issue_date", "passport_expiry_date", "passport_authority", "other_passport", "present_address", "permanent_address", "mobile", "email",
    "father_name", "father_nationality", "father_birth", "father_occupation", "mother_name", "mother_nationality", "mother_birth", "mother_occupation", "pakistan_origin",
    "visa_service_type", "visa_duration", "entries", "journey_date", "port_arrival", "port_exit", "purpose", "place_1", "hotel_booked", "tour_operator", "stay_address", "contact_in_india",
    "applied_evisa", "visited_india", "permission_denied", "countries_10_years", "saarc", "name_changed", "occupation", "designation", "employer_name", "employer_address", "employer_phone", "military",
    "ref_name", "ref_address", "ref_phone", "emergency_name", "emergency_address", "emergency_phone", "doc_passport", "doc_photo"].sort());
  for (const name of ["other_names", "qualification_institution", "father_prev_nationality", "mother_prev_nationality", "place_2", "past_occupation", "date_of_marriage", "spouse_name", "spouse_nationality", "spouse_prev_nationality", "spouse_birth", "spouse_occupation",
    "other_passport_number", "other_passport_country", "other_passport_issue_date", "other_passport_place", "other_passport_nationality", "pakistan_origin_details", "hotel_name", "tour_operator_details", "applied_evisa_details",
    "prev_stay_address", "prev_cities", "prev_visa_number", "prev_visa_issue", "permission_denied_details", "military_details", "doc_invitation"]) assert.equal(state(name).required, false, name);
  assert.equal(q("identification_marks").description, "e.g., Mole, scar, or 'None'");
  assert.equal(q("date_of_marriage").description, "DD/MM/YYYY (If applicable)");
  assert.equal(q("countries_10_years").description, "List all countries");
  assert.equal(q("port_arrival").description, "Airport / Seaport name");
  assert.equal(q("military_details").label, "If Yes give details");
  assert.equal(q("doc_invitation").description, "Submission format: Email Attachment");
  assert.equal(definition.title, "INDIAN E-TOURIST VISA (E-VISA) APPLICATION QUESTIONNAIRE");
});

test("document checklist: passport and photo required, invitation letter optional; each is an upload", () => {
  const docs = ["doc_passport", "doc_photo", "doc_invitation"];
  for (const name of docs) assert.equal(q(name).type, "file", `${name} is an upload`);
  assert.equal(state("doc_passport").required, true);
  assert.equal(state("doc_photo").required, true);
  assert.deepEqual(state("doc_invitation"), { visible: true, required: false });
  assert.equal(new Set(docs.map((name) => q(name).metadata.documentType)).size, 3, "each upload persists under its own document type");
});

test("required-field validation: a missing required answer is rejected, a hidden or optional one never is", () => {
  const full = a({ applicant_name: "Asha Rao", marital_status: "Single" });
  const missing = (name, answers) => {
    const question = q(name);
    const visible = isQuestionVisible(question, answers, client);
    return visible && isQuestionRequired(question, answers) && (answers[question.key] === undefined || answers[question.key] === "");
  };
  assert.equal(missing("surname", full), true);
  assert.equal(missing("spouse_name", full), false, "no spouse details demanded from an unmarried applicant");
  assert.equal(missing("other_names", full), false);
  assert.equal(typeof validateResponse, "function");
});
