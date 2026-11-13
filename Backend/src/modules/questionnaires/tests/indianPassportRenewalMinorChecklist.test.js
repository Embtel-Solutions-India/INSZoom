// Indian Passport Renewal (Indian Timeline Cases) -> subtype 1 "Minor Indian Passport Holder": registration, isolation (shown only for its own subtype, separate from the Renunciation
// subtype of the same name), exact questions, no show-when rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { INDIAN_PASSPORT_RENEWAL_MINOR_DEFINITIONS, CHECKLIST_KEY, SECTIONS, INSTRUCTIONS } = require("../indianPassportRenewalMinorChecklist");
const { CHECKLIST_KEY: RENUNCIATION_MINOR_HOLDER_KEY } = require("../renunciationMinorHolderChecklist");
const { slugSection } = require("../definitionHelpers");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../singlePartyChecklists");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = INDIAN_PASSPORT_RENEWAL_MINOR_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `iprmin_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const labelsOf = (section) => definition.questions.filter((question) => question.sectionKey === slugSection(section)).map((question) => question.label);

test("registration: new visa type Indian Passport Renewal; subtype 1 has its own checklist, assigned only through its own filing type", () => {
  const filing = filingTypes.getFilingType("INDIAN_PASSPORT_RENEWAL_MINOR_HOLDER");
  assert.deepEqual([filing.label, filing.visaType, filing.category, filing.section, filing.questionnaireKey], ["Minor Indian Passport Holder", "INDIAN-PASSPORT-RENEWAL", "indian_timeline", "indian_timeline", CHECKLIST_KEY]);
  assert.equal(definition.title, "Indian Passport Renewal - Minor Indian Passport Holder", "the title carries the visa type: Renunciation has a subtype of the same name");
  assert.deepEqual([definition.key, definition.visaType, definition.checklistRole, definition.isDefault], [CHECKLIST_KEY, "INDIAN-PASSPORT-RENEWAL", "client", false]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key), "not offered in the status-change pickers");
  const registry = visaCategories.VISA_CATEGORIES["INDIAN-PASSPORT-RENEWAL"];
  assert.deepEqual([registry.caseStructure, registry.forms, registry.noForms, registry.label, registry.subTypes], ["single", [], true, "Indian Passport Renewal", ["Adult Indian Passport Holder", "Minor Indian in Lieu of damage Passport", "Minor Indian in Lieu of lost Passport", "Minor Indian Passport Holder"]]);
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1, "registered exactly once");
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.filter((item) => item.visaType === "INDIAN-PASSPORT-RENEWAL").length, 0, "no competing scaffold checklist");
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "INDIAN-PASSPORT-RENEWAL").length, 0, "no USCIS forms");
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  // isolation: tied to its own filing type only; the same-named Renunciation subtype keeps its own, different checklist
  assert.deepEqual(filingTypes.listFilingTypes().filter((item) => item.questionnaireKey === CHECKLIST_KEY).map((item) => item.key), ["INDIAN_PASSPORT_RENEWAL_MINOR_HOLDER"]);
  assert.notEqual(CHECKLIST_KEY, RENUNCIATION_MINOR_HOLDER_KEY);
  assert.deepEqual(filingTypes.listFilingTypes().filter((item) => item.questionnaireKey === RENUNCIATION_MINOR_HOLDER_KEY).map((item) => item.key), ["RENUNCIATION_MINOR_INDIAN_PASSPORT_HOLDER"]);
  // one checklist per Indian Passport Renewal subtype, each reachable only through its own filing type
  const renewal = filingTypes.listFilingTypes().filter((item) => item.visaType === "INDIAN-PASSPORT-RENEWAL");
  assert.equal(new Set(renewal.map((item) => item.questionnaireKey)).size, renewal.length, "no two subtypes share a checklist");
  assert.deepEqual(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.visaType === "INDIAN-PASSPORT-RENEWAL").map((item) => item.key).sort(), renewal.map((item) => item.questionnaireKey).sort());
  assert.equal(visaCategories.VISA_CATEGORIES.RENUNCIATION.subTypes.length, 4, "Renunciation untouched");
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => others.has(question.key)), "no question key shared with another checklist");
  assert.equal(new Set(definition.questions.map((question) => question.key)).size, definition.questions.length, "no duplicate keys");
  const admin = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  const backend = fs.readFileSync(path.join(__dirname, "../../../config/visaDropdown.js"), "utf8");
  const line = "{ value: 'indianpassportrenewal', label: 'Indian Passport Renewal', canonicalLabel: 'INDIAN-PASSPORT-RENEWAL' }";
  assert.ok(admin.includes(line) && backend.includes(line), "the same dropdown entry in both copies");
  assert.ok(admin.includes("'indianpassportrenewal'])"), "an Indian Timeline visa type in the Admin picker");
  assert.ok(admin.includes("value: 'INDIAN_PASSPORT_RENEWAL_MINOR_HOLDER', label: 'Minor Indian Passport Holder'"), "the subtype is selectable in Admin");
});

test("sections, exact labels, options and counts", () => {
  assert.deepEqual(SECTIONS, definition.sections);
  assert.equal(SECTIONS.length, 5);
  for (const line of INSTRUCTIONS) assert.ok(definition.description.includes(line), "the instructions text is carried");
  assert.deepEqual(labelsOf(SECTIONS[0]), ["Applicant Name", "Phone Number", "E-mail ID"]);
  assert.deepEqual(labelsOf(SECTIONS[1]), [
    "Digital Photograph & Signature", "Physical Photographs", "Copy of the valid status in USA", "Copy of current Indian Passport", "Copy of Proof of address in USA", "Copy of Indian address proof",
    "House no. and street name", "Village/Town/City", "PIN code", "State/UT", "District", "Area Police station", "Please provide contact number of your relative who residing on your address",
    "Copy PAN & VOTER ID (if available):", "Copy of Parent’s Indian Passport", "Copy of Parent’s valid legal status in USA", "Copy of Birth Certificate",
  ]);
  assert.deepEqual(labelsOf(SECTIONS[2]), ["Applying for", "If Re-issue passport,", "Application Processing Type", "Passport Booklet Type", "Visible distinguishing mark (if any)", "Educational Qualification of the applicant", "Place of Birth (Village/Town/City)", "District", "State/UT",
    "Employment Type", "Educational Qualification", "Citizenship of India by", "Complete U.S. Residential Address", "Residing at U.S. Address Since (MM/DD/YYYY)", "Aadhaar Number (if available)", "PAN  Number (if available)", "Voter ID number (if available)"]);
  const parentLabels = (who) => [`${who}’s Surname`, `${who}’s Given name`, `${who}’s Citizenship`, `${who}’s Passport number`, `${who}’s contact number`, `${who}’s Email-ID`, `${who}’s Aadhar number (if available)`, `${who}’s Voter ID number (if available)`, `${who}’s PAN number (if available)`, `${who}’s Driving License number (if available)`];
  assert.deepEqual(labelsOf(SECTIONS[3]), [...parentLabels("Father"), ...parentLabels("Mother"), "Is either the Parents are Government Employee"]);
  assert.deepEqual(labelsOf(SECTIONS[4]), ["Emergency Contact Details"]);
  assert.equal(definition.questions.length, 3 + 17 + 17 + 21 + 1);
  assert.equal(q("physical_photos_ack").type, "radio", "the physical photographs are an acknowledgement, never an upload");
  assert.equal(definition.questions.filter((question) => question.type === "file").length, 9);
  assert.deepEqual(q("applying_for").options.map((o) => o.value), ["Fresh passport", "Re-issue passport"]);
  assert.deepEqual(q("reissue_reason").options.map((o) => o.value), ["Change in Existing Personal Particulars", "Damage Passport", "Exhaustion of pages", "Lost passport", "Validity expired more than 3 years ago", "Validity expired within 3 years/due to expire"]);
  assert.deepEqual(q("processing_type").options.map((o) => o.value), ["Normal", "Tatkal"]);
  assert.deepEqual(q("booklet_type").options.map((o) => o.value), ["36 Pages", "60 Pages"]);
  assert.deepEqual(q("education_level").options.map((o) => o.value), ["10th Pass and Above", "7th Pass or Less", "Between 8th and 9th Standard", "Graduate and Above"]);
  assert.deepEqual(q("citizenship_by").options.map((o) => o.value), ["Birth", "Descent", "Registration / Naturalization"]);
  assert.deepEqual(q("parent_government_employee").options.map((o) => o.value), ["Yes", "No"]);
  assert.deepEqual([q("us_address").type, q("us_address_since").type, q("father_email").type, q("mother_contact_number").type, q("indian_relative_contact").type], ["address", "date", "email", "phone", "phone"]);
  assert.deepEqual(q("emergency_contacts").metadata.fields.map((f) => [f.label, f.type]), [["Full Name", "text"], ["Address", "textarea"], ["Contact No.", "phone"], ["Email ID", "email"]]);
  assert.equal(q("emergency_contacts").repeatableConfig.min, 1, "at least one emergency contact");
  assert.match(q("doc_photo_signature").description, /Part 1: Photograph Requirements[\s\S]*Part 2: Signature Requirements[\s\S]*left thumb impression[\s\S]*upload a clear photo of it here\.$/);
  assert.match(q("doc_us_status").description, /^\(Notarized\)[\s\S]*Green Card - FRONT AND BACK[\s\S]*U\.S\. Visa Stamp[\s\S]*Notarized hotel bill/);
  assert.match(q("doc_us_address_proof").description, /MUST BE SIGNED BY THE TENANT AND LANDLORD[\s\S]*Income Tax return \(1040\)/);
  assert.match(q("doc_indian_address_proof").description, /^\(The address details provided below must match[\s\S]*Aadhar Card[\s\S]*Voter Card ID[\s\S]*Ration card/);
  assert.equal(q("indian_house_street").description, "Please provide the complete Indian address exactly as it appears on the Indian address proof document submitted above:");
  assert.equal(q("doc_pan_voter_id").description, "Color");
  assert.equal(q("education_level").description, "(Choose any one):");
  assert.equal(q("education_exact").description, "Exact education qualification", "the second education question carries the exact-qualification hint");
  assert.ok(labelsOf(SECTIONS[2]).includes("If Re-issue passport,") && !JSON.stringify(definition).includes("Perticulars"), "the 'Perticulars' typo is corrected");
});

test("no show-when rules: every question is always visible; exact required list", () => {
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, `${question.key} has no show-when rule`);
    assert.equal(isQuestionVisible(question, {}, client), true, `${question.key} visible with no answers`);
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("iprmin_", "")).sort();
  assert.deepEqual(required, ["applicant_name", "applicant_phone", "applicant_email", "doc_photo_signature", "physical_photos_ack", "doc_current_indian_passport", "doc_us_address_proof", "doc_indian_address_proof", "doc_pan_voter_id", "doc_parent_indian_passport", "doc_birth_certificate",
    "applying_for", "processing_type", "booklet_type", "education_level", "place_of_birth", "district", "state_ut", "employment_type", "citizenship_by", "us_address", "us_address_since",
    "father_surname", "father_given_name", "father_citizenship", "father_passport_number", "father_contact_number", "mother_surname", "mother_given_name", "mother_citizenship", "mother_passport_number", "mother_contact_number", "parent_government_employee", "emergency_contacts"].sort());
  for (const name of ["doc_us_status", "doc_parent_us_status", "indian_house_street", "indian_village_town_city", "indian_pin_code", "indian_state_ut", "indian_district", "indian_police_station", "indian_relative_contact", "reissue_reason", "distinguishing_mark", "education_exact",
    "aadhaar_number", "pan_number", "voter_id_number", "father_email", "mother_email", "father_aadhar_number", "mother_aadhar_number", "father_voter_id_number", "mother_voter_id_number", "father_pan_number", "mother_pan_number", "father_driving_license_number", "mother_driving_license_number"]) assert.equal(state(name).required, false, name);
  for (const name of ["doc_current_indian_passport", "doc_parent_indian_passport", "booklet_type", "father_passport_number", "mother_passport_number", "doc_pan_voter_id"]) assert.equal(state(name).required, true, name);
});
