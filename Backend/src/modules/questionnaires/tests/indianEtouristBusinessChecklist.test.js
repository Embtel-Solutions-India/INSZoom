// Indian E-Tourist Visa -> Business Visa: registration, second-subtype placeholder, order, exact labels, conditional/required rules, isolation. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { INDIAN_ETOURIST_BUSINESS_DEFINITIONS, CHECKLIST_KEY, SECTIONS, INSTRUCTIONS } = require("../indianEtouristBusinessChecklist");
const { slugSection } = require("../definitionHelpers");
const { OCI_CHECKLIST_DEFINITIONS } = require("../ociChecklists");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../singlePartyChecklists");

const { isQuestionVisible, isQuestionRequired, validateResponse, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = INDIAN_ETOURIST_BUSINESS_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `inbiz_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const a = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [`inbiz_${k}`, v]));
const labelsOf = (section) => definition.questions.filter((question) => question.sectionKey === slugSection(section)).map((question) => question.label);

test("registration: parent type, two selectable subtypes, only Business Visa has a checklist; no forms / mappings", () => {
  const business = filingTypes.getFilingType("INDIAN_ETOURIST_BUSINESS");
  const second = filingTypes.getFilingType("INDIAN_ETOURIST_SUBTYPE_2");
  assert.deepEqual([business.visaType, business.questionnaireKey, business.label], ["INDIAN-E-TOURIST-VISA", CHECKLIST_KEY, "Business Visa"]);
  assert.deepEqual([second.visaType, second.questionnaireKey, second.label], ["INDIAN-E-TOURIST-VISA", "indian_etourist_evisa_checklist", "E-Visa"]);
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.filter((item) => item.visaType === "INDIAN-E-TOURIST-VISA").length, 0, "no scaffold checklist for either subtype");
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1);
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.visaType === "INDIAN-E-TOURIST-VISA").length, 2, "one checklist per subtype (Business Visa, E-Visa)");
  for (const entry of [business, second]) assert.ok(!filingTypes.groupedForSelection().standalone.some((item) => item.key === entry.key));
  const registry = visaCategories.VISA_CATEGORIES["INDIAN-E-TOURIST-VISA"];
  assert.deepEqual([registry.caseStructure, registry.forms, registry.noForms, registry.subTypes.length], ["single", [], true, 2]);
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "INDIAN-E-TOURIST-VISA").length, 0);
  assert.equal(definition.isDefault, false);
  assert.equal(definition.checklistRole, "client");
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  assert.equal(visaCategories.VISA_CATEGORIES.OCI.subTypes.length, 5, "OCI untouched");
  assert.equal(OCI_CHECKLIST_DEFINITIONS[0].questions.length, 73);
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => others.has(question.key)));
});

test("the dropdown copies (backend + Admin) list Indian E-Tourist Visa with exactly two subtypes", () => {
  const backend = require("../../../config/visaDropdown").VISA_TYPE_OPTIONS;
  assert.ok(backend.some((option) => option.value === "indianetourist" && option.canonicalLabel === "INDIAN-E-TOURIST-VISA"));
  const admin = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  assert.ok(admin.includes("value: 'indianetourist', label: 'Indian E-Tourist Visa'"));
  assert.ok(admin.includes("new Set(['oci', 'uspassportminor', 'indianetourist'])"));
  assert.ok(admin.includes("value: 'INDIAN_ETOURIST_BUSINESS', label: 'Business Visa'"));
  assert.ok(admin.includes("value: 'INDIAN_ETOURIST_SUBTYPE_2'"));
});

test("sections, source text, order and counts", () => {
  assert.equal(SECTIONS.length, 12);
  assert.equal(definition.title, "INDIAN BUSINESS VISA APPLICATION QUESTIONNAIRE");
  assert.equal(definition.description, INSTRUCTIONS, "no agency heading or banner");
  assert.equal(INSTRUCTIONS, "Please answer all applicable questions thoroughly to assist us in preparing an accurate visa application. If a specific item does not apply to you, write 'N/A'. Physical evidence is not required for every field, but completeness prevents processing delays.");
  assert.deepEqual(labelsOf(SECTIONS[0]), ["Applicant Name", "Phone Number"]);
  assert.equal(labelsOf(SECTIONS[1]).length, 15);
  assert.equal(labelsOf(SECTIONS[2]).length, 10);
  assert.deepEqual(labelsOf(SECTIONS[3]), ["Present Residential Address", "Permanent Address", "Mobile / Phone Number", "Email Address"]);
  assert.equal(labelsOf(SECTIONS[4]).length, 15);
  assert.equal(labelsOf(SECTIONS[5]).length, 2);
  assert.deepEqual(labelsOf(SECTIONS[6]), ["Visa Service Type Requested", "Requested Visa Duration / Validity", "Number of Entries Required", "Expected Date of Journey / Arrival", "Designated Port of Arrival in India", "Expected Port of Exit from India"]);
  assert.equal(labelsOf(SECTIONS[7]).length, 9);
  assert.equal(labelsOf(SECTIONS[8]).length, 12, "11 source questions + the 'If Yes, state details' follow-up");
  assert.equal(labelsOf(SECTIONS[9]).length, 8, "7 source questions + the 'If Yes give details' follow-up");
  assert.equal(labelsOf(SECTIONS[10]).length, 6);
  const docs = labelsOf(SECTIONS[11]);
  assert.deepEqual(docs.filter((label) => !/ - Signature$| - optional supporting file$/.test(label)).map((label) => label.replace(/ - Photograph$/, "")), [
    "Digital Photograph & Signature", "Physical Photographs", "Copy of proof of address", "Copy of valid legal status in the USA (for Non-US passport holder)", "Copy of Passport", "Copy of Invitation Letter From The Company In India",
    "Copy of Letter From Applicant’s Company In The Usa", "Copy of Letter Of Incorporation From The Company In India", "Copy of Proof Of Renunciation", "Copy of Marriage Certificate", "Additional Documents For Minor Applicants",
    "Certificate of incorporation from Indian company", "Confirmed To and Fro travel tickets", "Turnover certificate", "Hotel booking in India", "A letter of Sponsorship by the Indian Company"]);
  assert.equal(docs.length, 18, "16 documents; the photograph and signature are two upload slots and Physical Photographs has an optional file");
  assert.deepEqual(q("gender").options.map((o) => o.value), ["Male", "Female", "Transgender"]);
  assert.deepEqual(q("marital_status").options.map((o) => o.value), ["Single", "Married", "Divorced", "Widowed"]);
  assert.deepEqual(q("entries").options.map((o) => o.value), ["Double Entry", "Multiple Entry"]);
  assert.deepEqual(q("purpose").options.map((o) => o.value), ["Tourism", "Recreation", "Sightseeing", "Meeting Friends/Relatives"]);
  assert.deepEqual(q("visa_service_type").options.map((o) => o.value), ["E-Tourist Visa"]);
  assert.equal(q("permanent_address").description, "Write 'Same' if identical to present address");
  assert.equal(q("saarc").description, "Afghanistan, Bangladesh, Bhutan, Maldives, Nepal, Pakistan, Sri Lanka");
  assert.equal(q("visa_duration").description, "e.g., 30 Days / 1 Year / 5 Years");
  assert.equal(q("education").description, "e.g., High School, Graduate, Post Graduate, Professional");
  assert.equal(q("qualification_institution").description, "e.g., M.B.A, B.Sc in computer Science, BBA etc");
  assert.ok(q("doc_invitation_india").description.includes("Duration of stay in lndia (per trip -if applicable)"));
  const banned = /bay area|law firm|attorneys licensed|paseo|fremont|bayareaimmigration|disclaimer|important note|client information form/i;
  for (const text of [definition.title, definition.description, ...definition.sections, ...definition.questions.flatMap((question) => [question.label, question.description || ""])]) assert.ok(!banned.test(text), `no agency/legal text: ${text.slice(0, 60)}`);
  assert.equal(q("doc_sponsorship_letter").description, undefined);
  assert.equal(new Set(definition.questions.map((question) => question.key)).size, definition.questions.length);
});

test("married vs not married; other passport; hotel / tour operator; travel history; employment follow-ups", () => {
  for (const name of ["date_of_marriage", "spouse_name", "spouse_nationality", "spouse_birth", "spouse_occupation", "spouse_prev_nationality"]) {
    for (const status of ["Single", "Divorced", "Widowed", undefined]) assert.equal(state(name, a({ marital_status: status })).visible, false, `${name} / ${status}`);
  }
  for (const name of ["date_of_marriage", "spouse_name", "spouse_nationality", "spouse_birth", "spouse_occupation"]) assert.deepEqual(Object.values(state(name, a({ marital_status: "Married" }))), [true, true], name);
  assert.deepEqual(Object.values(state("spouse_prev_nationality", a({ marital_status: "Married" }))), [true, false]);
  const follow = (gate, names) => names.forEach((name) => {
    assert.equal(state(name, a({ [gate]: "No" })).visible, false, `${name} hidden on No`);
    assert.equal(state(name).visible, false);
    assert.deepEqual(Object.values(state(name, a({ [gate]: "Yes" }))), [true, true], `${name} required on Yes`);
  });
  follow("other_passport", ["other_passport_number", "other_passport_country", "other_passport_issue_date", "other_passport_place", "other_passport_nationality"]);
  follow("pakistan_origin", ["pakistan_origin_details"]);
  follow("hotel_booked", ["hotel_name", "doc_hotel_booking"]);
  follow("tour_operator", ["tour_operator_details"]);
  follow("applied_evisa", ["applied_evisa_details"]);
  follow("visited_india", ["prev_stay_address", "prev_cities", "prev_visa_number", "prev_visa_issue"]);
  follow("permission_denied", ["permission_denied_details"]);
  follow("military", ["military_details"]);
  assert.equal(state("prev_stay_address", a({ applied_evisa: "Yes", visited_india: "No" })).visible, false, "e-Visa answer does not imply a visit");
  assert.notEqual(q("passport_issue_date").key, q("other_passport_issue_date").key);
});

test("required / optional; conditional documents are not universally enforced", () => {
  for (const name of ["applicant_name", "applicant_phone", "surname", "given_name", "gender", "marital_status", "date_of_birth", "religion", "place_of_birth", "country_of_birth", "citizenship", "citizenship_id", "identification_marks", "education", "passport_number", "passport_issue_date", "passport_expiry_date", "passport_authority", "other_passport",
    "present_address", "permanent_address", "mobile", "email", "father_name", "father_nationality", "father_birth", "father_occupation", "mother_name", "mother_nationality", "mother_birth", "mother_occupation", "pakistan_origin", "visa_service_type", "visa_duration", "entries", "journey_date", "port_arrival", "port_exit", "purpose", "place_1", "hotel_booked", "tour_operator", "stay_address", "contact_in_india",
    "applied_evisa", "visited_india", "permission_denied", "countries_10_years", "saarc", "name_changed", "occupation", "designation", "employer_name", "employer_address", "employer_phone", "military", "ref_name", "ref_address", "ref_phone", "emergency_name", "emergency_address", "emergency_phone",
    "doc_photo", "doc_signature", "physical_photos", "doc_address_proof", "doc_passport", "doc_invitation_india", "doc_letter_usa", "doc_company_incorporation_cert", "doc_tickets", "doc_turnover", "doc_sponsorship_letter"]) assert.equal(state(name).required, true, name);
  for (const name of ["other_names", "qualification_institution", "father_prev_nationality", "mother_prev_nationality", "place_2", "past_occupation", "doc_physical_photos_file", "doc_incorporation_letter", "doc_renunciation", "doc_marriage_certificate", "doc_minor"]) assert.equal(state(name).required, false, name);
  assert.deepEqual(Object.values(state("doc_hotel_booking")), [false, false], "no hotel booking document without a booked hotel");
  assert.deepEqual(Object.values(state("doc_legal_status", a({ citizenship: "United States" }))), [false, false], "a US citizen is not asked for US legal status");
  assert.deepEqual(Object.values(state("doc_legal_status", a({ citizenship: "India" }))), [true, true], "a non-US applicant is (platform rule: passport-named questions are always required once shown)");
});

test("validation: date, email, phone; a complete unmarried applicant with no conditionals is accepted; omissions are reported", () => {
  const base = a({
    applicant_name: "A B", applicant_phone: "5125550100", surname: "B", given_name: "A", gender: "Male", marital_status: "Single", date_of_birth: "1985-02-03", religion: "X", place_of_birth: "Pune, MH", country_of_birth: "India", citizenship: "United States", citizenship_id: "123", identification_marks: "None", education: "Graduate",
    passport_number: "P1", passport_issue_date: "2020-01-01", passport_expiry_date: "2030-01-01", passport_authority: "NY", other_passport: "No",
    present_address: "1 Main", permanent_address: "Same", mobile: "5125550100", email: "a@b.co",
    father_name: "F", father_nationality: "I", father_birth: "Pune, India", father_occupation: "O", mother_name: "M", mother_nationality: "I", mother_birth: "Pune, India", mother_occupation: "O",
    pakistan_origin: "No", visa_service_type: "E-Tourist Visa", visa_duration: "1 Year", entries: "Multiple Entry", journey_date: "2027-01-01", port_arrival: "DEL", port_exit: "DEL",
    purpose: "Tourism", place_1: "Delhi", hotel_booked: "No", tour_operator: "No", stay_address: "x", contact_in_india: "y",
    applied_evisa: "No", visited_india: "No", permission_denied: "No", countries_10_years: "USA", saarc: "No", name_changed: "No",
    occupation: "Engineer", designation: "SE", employer_name: "Co", employer_address: "addr", employer_phone: "5125550101", military: "No",
    ref_name: "R", ref_address: "addr", ref_phone: "5125550102", emergency_name: "E", emergency_address: "addr", emergency_phone: "5125550103",
  });
  const result = validateResponse(definition, definition.questions, base, client);
  assert.deepEqual(result.errors, []);
  const missing = result.missingRequired.map((item) => item.questionKey).sort();
  assert.deepEqual(missing, ["inbiz_doc_address_proof", "inbiz_doc_company_incorporation_cert", "inbiz_doc_invitation_india", "inbiz_doc_letter_usa", "inbiz_doc_passport", "inbiz_doc_photo", "inbiz_doc_signature", "inbiz_doc_sponsorship_letter", "inbiz_doc_tickets", "inbiz_doc_turnover", "inbiz_physical_photos"], "only the required documents remain; conditional ones are not demanded");
  const married = validateResponse(definition, definition.questions, { ...base, inbiz_marital_status: "Married" }, client);
  assert.ok(married.missingRequired.some((item) => item.questionKey === "inbiz_spouse_name") && married.missingRequired.some((item) => item.questionKey === "inbiz_date_of_marriage"));
  const bad = validateResponse(definition, definition.questions, { ...base, inbiz_email: "nope", inbiz_mobile: "12", inbiz_date_of_birth: "zzz" }, client);
  for (const key of ["inbiz_email", "inbiz_mobile", "inbiz_date_of_birth"]) assert.ok(bad.errors.some((error) => error.questionKey === key), key);
});

test("the single-party controller guards both ensureTemplate calls, so a subtype without a checklist is created without one", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../single-party-filings/single-party-filing.controller.js"), "utf8");
  const calls = source.match(/ensureTemplate\(filingType\.questionnaireKey/g) || [];
  const guarded = source.match(/if \(filingType\.questionnaireKey\) await questionnaireService\.ensureTemplate\(filingType\.questionnaireKey/g) || [];
  assert.equal(calls.length, guarded.length);
  assert.equal((source.match(/filingType\.questionnaireKey \? await Questionnaire\.findOne/g) || []).length, 2);
});
