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
  assert.equal(visaCategories.VISA_CATEGORIES.OCI.subTypes.length, 6, "OCI untouched");
  assert.equal(OCI_CHECKLIST_DEFINITIONS[0].questions.length, 43);
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => others.has(question.key)));
});

test("the dropdown copies (backend + Admin) list Indian E-Tourist Visa with exactly two subtypes", () => {
  const backend = require("../../../config/visaDropdown").VISA_TYPE_OPTIONS;
  assert.ok(backend.some((option) => option.value === "indianetourist" && option.canonicalLabel === "INDIAN-E-TOURIST-VISA"));
  const admin = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  assert.ok(admin.includes("value: 'indianetourist', label: 'Indian E-Tourist Visa'"));
  assert.ok(admin.includes("new Set(['oci', 'uspassportminor', 'indianetourist', 'renunciation', 'indianpassportrenewal', 'usvisitorvisa'])"));
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
  assert.deepEqual(docs, [
    "Digital Photograph & Signature", "Physical Photographs", "Copy of proof of address", "Copy of valid legal status in the USA (for Non-US passport holder)", "Copy of Passport", "Copy of Invitation Letter From The Company In India",
    "Copy of Letter From Applicant’s Company In The Usa", "Copy of Letter Of Incorporation From The Company In India", "Copy of Proof Of Renunciation", "Copy of Marriage Certificate", "Additional Documents For Minor Applicants",
    "Certificate of incorporation from Indian company", "Confirmed To and Fro travel tickets", "Turnover certificate", "Hotel booking in India", "A letter of Sponsorship by the Indian Company"]);
  assert.equal(docs.length, 16, "exactly the 16 supplied documents, one item each");
  assert.equal(definition.questions.length, 105, "104 supplied questions + the 'If Yes, state details' follow-up of the e-Visa question");
  assert.deepEqual(q("gender").options.map((o) => o.value), ["Male", "Female", "Transgender"]);
  assert.deepEqual(q("marital_status").options.map((o) => o.value), ["Single", "Married", "Divorced", "Widowed"]);
  assert.deepEqual(q("entries").options.map((o) => o.value), ["Double Entry", "Multiple Entry"]);
  assert.deepEqual(q("purpose").options.map((o) => o.value), ["Tourism", "Recreation", "Sightseeing", "Meeting Friends/Relatives"]);
  assert.deepEqual(q("visa_service_type").options.map((o) => o.value), ["E-Tourist Visa"]);
  assert.equal(q("permanent_address").description, "Write 'Same' if identical to present address");
  assert.equal(q("saarc").description, "Afghanistan, Bangladesh, Bhutan, Maldives, Nepal, Pakistan, Sri Lanka");
  assert.equal(q("visa_duration").description, "e.g., 30 Days / 1 Year / 5 Years");
  assert.equal(q("identification_marks").description, "e.g., Mole, scar, or 'None'");
  assert.equal(q("date_of_marriage").description, "DD/MM/YYYY (If applicable)");
  assert.equal(q("countries_10_years").description, "List all countries");
  assert.equal(q("port_arrival").description, "Airport / Seaport name");
  assert.equal(q("education").description, "e.g., High School, Graduate, Post Graduate, Professional");
  assert.equal(q("qualification_institution").description, "e.g., M.B.A, B.Sc in computer Science, BBA etc");
  assert.ok(q("doc_invitation_india").description.includes("Duration of stay in lndia (per trip -if applicable)"));
  const banned = /bay area|law firm|attorneys licensed|paseo|fremont|bayareaimmigration|disclaimer|important note|client information form/i;
  for (const text of [definition.title, definition.description, ...definition.sections, ...definition.questions.flatMap((question) => [question.label, question.description || ""])]) assert.ok(!banned.test(text), `no agency/legal text: ${text.slice(0, 60)}`);
  assert.equal(q("doc_sponsorship_letter").description, undefined);
  assert.equal(new Set(definition.questions.map((question) => question.key)).size, definition.questions.length);
});

test("no show-when rules: every question is always visible; exact required list; situational items optional", () => {
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, question.key + " has no show-when rule");
    assert.equal(isQuestionVisible(question, {}, client), true, question.key + " visible with no answers");
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("inbiz_", "")).sort();
  assert.deepEqual(required, ["applicant_name", "applicant_phone", "surname", "given_name", "gender", "marital_status", "date_of_birth", "religion", "place_of_birth", "country_of_birth", "citizenship", "citizenship_id", "identification_marks", "education",
    "passport_number", "passport_issue_date", "passport_expiry_date", "passport_authority", "other_passport", "present_address", "permanent_address", "mobile", "email",
    "father_name", "father_nationality", "father_birth", "father_occupation", "mother_name", "mother_nationality", "mother_birth", "mother_occupation", "pakistan_origin",
    "visa_service_type", "visa_duration", "entries", "journey_date", "port_arrival", "port_exit", "purpose", "place_1", "hotel_booked", "tour_operator", "stay_address", "contact_in_india",
    "applied_evisa", "visited_india", "permission_denied", "countries_10_years", "saarc", "name_changed", "occupation", "designation", "employer_name", "employer_address", "employer_phone", "military",
    "ref_name", "ref_address", "ref_phone", "emergency_name", "emergency_address", "emergency_phone",
    "doc_photo_signature", "physical_photos", "doc_address_proof", "doc_passport", "doc_invitation_india", "doc_letter_usa"].sort());
  for (const name of ["date_of_marriage", "other_passport_number", "other_passport_country", "other_passport_issue_date", "other_passport_place", "other_passport_nationality", "spouse_name", "spouse_nationality", "spouse_birth", "spouse_occupation",
    "pakistan_origin_details", "hotel_name", "tour_operator_details", "applied_evisa_details", "prev_stay_address", "prev_cities", "prev_visa_number", "prev_visa_issue", "permission_denied_details", "military_details",
    "doc_legal_status", "doc_incorporation_letter", "doc_renunciation", "doc_marriage_certificate", "doc_minor", "doc_company_incorporation_cert", "doc_tickets", "doc_turnover", "doc_hotel_booking", "doc_sponsorship_letter"]) assert.equal(state(name).required, false, name);
  assert.equal(q("doc_photo"), undefined, "photograph and signature are ONE document");
  assert.equal(q("doc_physical_photos_file"), undefined, "no extra optional physical-photos file");
});

test("validation: date, email, phone; a complete applicant is accepted; omissions are reported", () => {
  const base = a({
    applicant_name: "A B", applicant_phone: "5125550100", surname: "B", given_name: "A", gender: "Male", marital_status: "Single", date_of_birth: "1985-02-03", religion: "X", place_of_birth: "Pune, MH", country_of_birth: "India", citizenship: "United States", citizenship_id: "ID1", identification_marks: "None", education: "Graduate",
    passport_number: "P1", passport_issue_date: "2020-01-01", passport_expiry_date: "2030-01-01", passport_authority: "NY", other_passport: "No",
    present_address: "1 Main", permanent_address: "Same", mobile: "5125550100", email: "a@b.co",
    father_name: "F", father_nationality: "I", father_birth: "Pune, India", father_occupation: "O", mother_name: "M", mother_nationality: "I", mother_birth: "Pune, India", mother_occupation: "O",
    pakistan_origin: "No", visa_service_type: "E-Tourist Visa", visa_duration: "1 Year", entries: "Multiple Entry", journey_date: "2027-01-01", port_arrival: "DEL", port_exit: "DEL",
    purpose: "Tourism", place_1: "Delhi", hotel_booked: "No", tour_operator: "No", stay_address: "x", contact_in_india: "y",
    applied_evisa: "No", visited_india: "No", permission_denied: "No", countries_10_years: "USA", saarc: "No", name_changed: "No",
    occupation: "Engineer", designation: "SE", employer_name: "Co", employer_address: "addr", employer_phone: "5125550101", military: "No",
    ref_name: "R", ref_address: "addr", ref_phone: "5125550102", emergency_name: "E", emergency_address: "addr", emergency_phone: "5125550103",
    physical_photos: require("../definitionHelpers").PHYSICAL_PHOTOS_LINE,
  });
  const result = validateResponse(definition, definition.questions, base, client);
  assert.deepEqual(result.errors, []);
  const missing = result.missingRequired.map((item) => item.questionKey).sort();
  assert.deepEqual(missing, ["inbiz_doc_address_proof", "inbiz_doc_invitation_india", "inbiz_doc_letter_usa", "inbiz_doc_passport", "inbiz_doc_photo_signature"], "only the required uploads are missing");
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
