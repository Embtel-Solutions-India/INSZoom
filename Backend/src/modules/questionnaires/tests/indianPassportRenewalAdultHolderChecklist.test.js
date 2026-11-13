// Indian Passport Renewal (Indian Timeline Cases) -> subtype 4 "Adult Indian Passport Holder": registration, isolation (shown only for its own subtype, separate from the Renunciation
// subtype of the same name), exact questions, no show-when rules, upload-here wording and the shared physical-photographs option.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { INDIAN_PASSPORT_RENEWAL_ADULT_HOLDER_DEFINITIONS, CHECKLIST_KEY, SECTIONS, INSTRUCTIONS } = require("../indianPassportRenewalAdultHolderChecklist");
const { CHECKLIST_KEY: MINOR_HOLDER_KEY } = require("../indianPassportRenewalMinorChecklist");
const { CHECKLIST_KEY: LOST_KEY } = require("../indianPassportRenewalLostPassportChecklist");
const { CHECKLIST_KEY: DAMAGE_KEY } = require("../indianPassportRenewalDamagePassportChecklist");
const { CHECKLIST_KEY: RENUNCIATION_ADULT_HOLDER_KEY } = require("../renunciationAdultHolderChecklist");
const { slugSection, PHYSICAL_PHOTOS_OPTIONS } = require("../definitionHelpers");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../singlePartyChecklists");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = INDIAN_PASSPORT_RENEWAL_ADULT_HOLDER_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `ipradu_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const labelsOf = (section) => definition.questions.filter((question) => question.sectionKey === slugSection(section)).map((question) => question.label);

test("registration: subtype 4 of Indian Passport Renewal has its own checklist, assigned only through its own filing type", () => {
  const filing = filingTypes.getFilingType("INDIAN_PASSPORT_RENEWAL_ADULT_HOLDER");
  assert.deepEqual([filing.label, filing.visaType, filing.category, filing.section, filing.questionnaireKey], ["Adult Indian Passport Holder", "INDIAN-PASSPORT-RENEWAL", "indian_timeline", "indian_timeline", CHECKLIST_KEY]);
  assert.equal(definition.title, "Indian Passport Renewal - Adult Indian Passport Holder", "the title carries the visa type: Renunciation has a subtype of the same name");
  assert.deepEqual([definition.key, definition.visaType, definition.checklistRole, definition.isDefault], [CHECKLIST_KEY, "INDIAN-PASSPORT-RENEWAL", "client", false]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key), "not offered in the status-change pickers");
  assert.deepEqual(visaCategories.VISA_CATEGORIES["INDIAN-PASSPORT-RENEWAL"].subTypes, ["Adult Indian Passport Holder", "Minor Indian in Lieu of damage Passport", "Minor Indian in Lieu of lost Passport", "Minor Indian Passport Holder"]);
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1, "registered exactly once");
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.filter((item) => item.visaType === "INDIAN-PASSPORT-RENEWAL").length, 0, "no competing scaffold checklist");
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "INDIAN-PASSPORT-RENEWAL").length, 0, "no USCIS forms");
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  // isolation: four subtypes, four different checklists, none a default; the same-named Renunciation subtype keeps its own
  const renewal = filingTypes.listFilingTypes().filter((item) => item.visaType === "INDIAN-PASSPORT-RENEWAL");
  assert.equal(renewal.length, 4);
  assert.equal(new Set(renewal.map((item) => item.questionnaireKey)).size, 4, "four different checklists");
  assert.deepEqual(filingTypes.listFilingTypes().filter((item) => item.questionnaireKey === CHECKLIST_KEY).map((item) => item.key), ["INDIAN_PASSPORT_RENEWAL_ADULT_HOLDER"]);
  assert.equal(new Set([CHECKLIST_KEY, MINOR_HOLDER_KEY, LOST_KEY, DAMAGE_KEY, RENUNCIATION_ADULT_HOLDER_KEY]).size, 5, "also different from the Renunciation subtype of the same name");
  assert.deepEqual(filingTypes.listFilingTypes().filter((item) => item.questionnaireKey === RENUNCIATION_ADULT_HOLDER_KEY).map((item) => item.key), ["RENUNCIATION_ADULT_INDIAN_PASSPORT_HOLDER"]);
  for (const item of VISA_TEMPLATE_DEFINITIONS.filter((entry) => entry.visaType === "INDIAN-PASSPORT-RENEWAL")) assert.equal(item.isDefault, false, `${item.key} is never a default`);
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => others.has(question.key)), "no question key shared with another checklist");
  assert.equal(new Set(definition.questions.map((question) => question.key)).size, definition.questions.length, "no duplicate keys");
  const admin = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  assert.ok(admin.includes("value: 'INDIAN_PASSPORT_RENEWAL_ADULT_HOLDER', label: 'Adult Indian Passport Holder'"), "the subtype is selectable in Admin");
});

test("sections, exact labels, options and counts", () => {
  assert.deepEqual(SECTIONS, definition.sections);
  assert.equal(SECTIONS.length, 5);
  for (const line of INSTRUCTIONS) assert.ok(definition.description.includes(line), "the instructions text is carried");
  assert.deepEqual(labelsOf(SECTIONS[0]), ["Applicant Name", "Phone Number", "E-mail ID"]);
  assert.deepEqual(labelsOf(SECTIONS[1]), [
    "Digital Photograph & Signature", "Physical Photographs", "Copy of the valid status in USA", "Copy of current Indian Passport", "Copy of Proof of address in USA", "Copy of Indian address proof",
    "House no. and street name", "Village/Town/City", "PIN code", "State/UT", "District", "Area Police station", "Please provide contact number of your relative who residing on your address",
    "Copy PAN & VOTER ID (if available):",
  ]);
  assert.deepEqual(labelsOf(SECTIONS[2]), ["Applying for", "If Re-issue passport,", "Application Processing Type", "Passport Booklet Type", "Visible distinguishing mark (if any)", "Educational Qualification of the applicant", "Marital Status", "Spouse’s surname", "Spouse’s Given name",
    "Place of Birth (Village/Town/City)", "District", "State/UT", "Employment Type", "Educational Qualification", "Citizenship of India by", "Complete U.S. Residential Address", "Residing at U.S. Address Since (MM/DD/YYYY)", "Aadhaar Number (if available)", "PAN  Number (if available)", "Voter ID number (if available)"]);
  assert.deepEqual(labelsOf(SECTIONS[3]), ["Father’s Surname", "Father’s Given name", "Mother’s Surname", "Mother’s Given name", "Legal Guardian's Surname (if applicable)", "Legal Guardian's Given name (if applicable)"]);
  assert.deepEqual(labelsOf(SECTIONS[4]), ["Emergency Contact Details"]);
  assert.equal(definition.questions.length, 3 + 14 + 20 + 6 + 1);
  assert.equal(definition.questions.filter((question) => question.type === "file").length, 6);
  assert.deepEqual(q("marital_status").options.map((o) => o.value), ["Divorced", "Married", "Separated", "Single", "Widow/ Widower"]);
  assert.deepEqual(q("applying_for").options.map((o) => o.value), ["Fresh passport", "Re-issue passport"]);
  assert.deepEqual(q("citizenship_by").options.map((o) => o.value), ["Birth", "Descent", "Registration / Naturalization"]);
  assert.deepEqual([q("us_address").type, q("us_address_since").type, q("indian_relative_contact").type], ["address", "date", "phone"]);
  assert.deepEqual(q("emergency_contacts").metadata.fields.map((f) => [f.label, f.type]), [["Full Name", "text"], ["Address", "textarea"], ["Contact No.", "phone"], ["Email ID", "email"]]);
  assert.equal(q("emergency_contacts").repeatableConfig.min, 1, "at least one emergency contact");
  const photo = q("doc_photo_signature").description;
  assert.match(photo, /Part 1: Photograph Requirements[\s\S]*Part 2: Signature Requirements/);
  assert.ok(photo.includes("Please upload a high-quality HD photograph here.") && photo.endsWith("and upload it here."), "uploaded here, no e-mail wording");
  assert.doesNotMatch(photo, /thumb|e-?mail|send/i, "adult: no thumb-impression note");
  assert.equal(q("education_exact").description, "Exact education qualification");
  assert.ok(!JSON.stringify(definition).includes("Perticulars") && !JSON.stringify(definition).includes("Martial"), "the 'Perticulars' and 'Martial' typos are corrected");
});

test("Physical Photographs uses the shared required option; no show-when rules; exact required list", () => {
  const physical = q("physical_photos_ack");
  assert.equal(physical.type, "radio");
  assert.equal(physical.required, true);
  assert.deepEqual(physical.options, PHYSICAL_PHOTOS_OPTIONS);
  assert.match(physical.description, /the photograph\(s\) you upload here\.$/);
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, `${question.key} has no show-when rule`);
    assert.equal(isQuestionVisible(question, {}, client), true, `${question.key} visible with no answers`);
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("ipradu_", "")).sort();
  assert.deepEqual(required, ["applicant_name", "applicant_phone", "applicant_email", "doc_photo_signature", "physical_photos_ack", "doc_current_indian_passport", "doc_us_address_proof", "doc_indian_address_proof", "doc_pan_voter_id",
    "applying_for", "processing_type", "booklet_type", "education_level", "marital_status", "place_of_birth", "district", "state_ut", "employment_type", "citizenship_by", "us_address", "us_address_since",
    "father_surname", "father_given_name", "mother_surname", "mother_given_name", "emergency_contacts"].sort());
  for (const name of ["doc_us_status", "indian_house_street", "indian_village_town_city", "indian_pin_code", "indian_state_ut", "indian_district", "indian_police_station", "indian_relative_contact", "reissue_reason", "distinguishing_mark", "spouse_surname", "spouse_given_name",
    "education_exact", "aadhaar_number", "pan_number", "voter_id_number", "guardian_surname", "guardian_given_name"]) assert.equal(state(name).required, false, name);
  for (const name of ["doc_current_indian_passport", "booklet_type", "doc_pan_voter_id", "marital_status"]) assert.equal(state(name).required, true, name);
});
