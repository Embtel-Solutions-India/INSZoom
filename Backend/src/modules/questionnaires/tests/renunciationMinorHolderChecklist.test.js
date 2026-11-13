// Renunciation (Indian Timeline Cases) -> subtype 3 "Minor Indian Passport Holder": registration, isolation (shown only for its own subtype), exact questions, no show-when rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RENUNCIATION_MINOR_HOLDER_DEFINITIONS, CHECKLIST_KEY, SECTIONS } = require("../renunciationMinorHolderChecklist");
const { CHECKLIST_KEY: MINOR_NO_KEY } = require("../renunciationMinorNoPassportChecklist");
const { CHECKLIST_KEY: ADULT_NO_KEY } = require("../renunciationAdultNoPassportChecklist");
const { slugSection } = require("../definitionHelpers");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../singlePartyChecklists");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = RENUNCIATION_MINOR_HOLDER_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `renmph_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const labelsOf = (section) => definition.questions.filter((question) => question.sectionKey === slugSection(section)).map((question) => question.label);

test("registration: subtype 3 of Renunciation has its own checklist, named after the subtype, assigned only through its own filing type", () => {
  const filing = filingTypes.getFilingType("RENUNCIATION_MINOR_INDIAN_PASSPORT_HOLDER");
  assert.deepEqual([filing.label, filing.visaType, filing.category, filing.section, filing.questionnaireKey], ["Minor Indian Passport Holder", "RENUNCIATION", "indian_timeline", "indian_timeline", CHECKLIST_KEY]);
  assert.equal(definition.title, "Minor Indian Passport Holder", "the checklist is named after its subtype");
  assert.deepEqual([definition.key, definition.visaType, definition.checklistRole, definition.isDefault], [CHECKLIST_KEY, "RENUNCIATION", "client", false]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key), "not offered in the status-change pickers");
  assert.deepEqual(visaCategories.VISA_CATEGORIES.RENUNCIATION.subTypes, ["Minor without Indian passport", "Adult Indian Citizen without Indian Passport", "Minor Indian Passport Holder", "Adult Indian Passport Holder"]);
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1, "registered exactly once");
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.filter((item) => item.visaType === "RENUNCIATION").length, 0, "no competing scaffold checklist");
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "RENUNCIATION").length, 0, "no USCIS forms");
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  // isolation: every Renunciation subtype is tied to its OWN checklist and no other; none is a default, so a subtype never receives another's checklist
  const renunciation = filingTypes.listFilingTypes().filter((item) => item.visaType === "RENUNCIATION");
  assert.equal(renunciation.length, 4);
  assert.equal(new Set(renunciation.map((item) => item.questionnaireKey)).size, 4, "four different checklists");
  assert.deepEqual(filingTypes.listFilingTypes().filter((item) => item.questionnaireKey === CHECKLIST_KEY).map((item) => item.key), ["RENUNCIATION_MINOR_INDIAN_PASSPORT_HOLDER"]);
  assert.deepEqual(new Set([CHECKLIST_KEY, MINOR_NO_KEY, ADULT_NO_KEY]).size, 3);
  for (const item of VISA_TEMPLATE_DEFINITIONS.filter((entry) => entry.visaType === "RENUNCIATION")) assert.equal(item.isDefault, false, `${item.key} is never a default`);
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => others.has(question.key)), "no question key shared with another checklist");
  assert.equal(new Set(definition.questions.map((question) => question.key)).size, definition.questions.length, "no duplicate keys");
  const admin = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  assert.ok(admin.includes("value: 'RENUNCIATION_MINOR_INDIAN_PASSPORT_HOLDER', label: 'Minor Indian Passport Holder'"), "the subtype is selectable in Admin");
});

test("sections, exact labels and counts", () => {
  assert.deepEqual(SECTIONS, definition.sections);
  assert.equal(SECTIONS.length, 5);
  assert.deepEqual(labelsOf(SECTIONS[0]), ["Applicant Name", "Phone Number", "E-mail ID"]);
  assert.deepEqual(labelsOf(SECTIONS[1]), ["Digital Photograph & Signature", "Physical Photographs", "Copy of Current Address Proof", "Copy of Current Passport", "Copy of Recent Indian Passport", "Copy of Naturalization Certificate"]);
  assert.deepEqual(labelsOf(SECTIONS[2]), ["Visible distinguishing mark (if any)", "Educational Qualification of the applicant", "Place of Birth (Village/Town/City)", "District", "State/UT"]);
  assert.deepEqual(labelsOf(SECTIONS[3]), ["Father’s Surname", "Father’s Given name", "Mother’s Surname", "Mother’s Given name", "Legal Guardian's Surname (if applicable)", "Legal Guardian's Given name (if applicable)", "Father’s Passport No.", "Father’s Date of Naturalization", "Mother’s Passport No.", "Mother’s Date of Naturalization"]);
  assert.deepEqual(labelsOf(SECTIONS[4]), ["Emergency Contact Details"]);
  assert.equal(definition.questions.length, 3 + 6 + 5 + 10 + 1);
  assert.equal(q("physical_photos_ack").type, "radio", "the physical photographs are an acknowledgement, never an upload");
  assert.equal(definition.questions.filter((question) => question.type === "file").length, 5);
  assert.deepEqual(q("education").options.map((o) => o.value), ["10th Pass and Above", "7th Pass or Less", "Between 8th and 9th Standard", "Graduate and Above"]);
  assert.deepEqual([q("applicant_phone").type, q("applicant_email").type, q("father_naturalization_date").type, q("mother_naturalization_date").type], ["phone", "email", "date", "date"]);
  assert.deepEqual(q("emergency_contacts").metadata.fields.map((f) => [f.label, f.type]), [["Full Name", "text"], ["Address", "textarea"], ["Contact No.", "phone"]]);
  assert.equal(q("emergency_contacts").repeatable, true);
  assert.equal(q("emergency_contacts").repeatableConfig.min, 1, "at least one emergency contact");
  assert.match(q("doc_photo_signature").description, /Part 1: Photograph Requirements[\s\S]*Part 2: Signature Requirements[\s\S]*left thumb impression/);
  assert.ok(q("doc_photo_signature").description.endsWith("send a clear photo of it"), "the thumb note is exactly as supplied");
  assert.match(q("physical_photos_ack").description, /exactly the same as the photograph\(s\) you send to us\.$/);
  assert.match(q("doc_address_proof").description, /ANY ONE required[\s\S]*Driving license \(FRONT AND BACK\)[\s\S]*affidavit of address proof/);
  assert.equal(q("doc_recent_indian_passport").description, "First three and last two pages of the most recent Indian passport.");
  assert.equal(q("father_passport_no").description, "If the applicant has gained naturalization through parents, please provide information below:");
  assert.equal(q("education").description, "Choose any one:");
  assert.equal(q("father_given_name").label, "Father’s Given name", "the 'GIven' typo is corrected");
});

test("no show-when rules: every question is always visible; exact required list; the parents' passport numbers are optional", () => {
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, `${question.key} has no show-when rule`);
    assert.equal(isQuestionVisible(question, {}, client), true, `${question.key} visible with no answers`);
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("renmph_", "")).sort();
  assert.deepEqual(required, ["applicant_name", "applicant_phone", "applicant_email", "doc_photo_signature", "physical_photos_ack", "doc_address_proof", "doc_current_passport", "doc_recent_indian_passport", "doc_naturalization_certificate",
    "education", "place_of_birth", "district", "state_ut", "father_surname", "father_given_name", "mother_surname", "mother_given_name", "emergency_contacts"].sort());
  for (const name of ["distinguishing_mark", "guardian_surname", "guardian_given_name", "father_passport_no", "father_naturalization_date", "mother_passport_no", "mother_naturalization_date"]) assert.equal(state(name).required, false, name);
  assert.equal(state("doc_current_passport").required, true);
  assert.equal(state("doc_recent_indian_passport").required, true, "the minor holds an Indian passport, so its copy is required");
});
