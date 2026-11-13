// Renunciation (Indian Timeline Cases) -> subtype 1 "Minor without Indian passport": registration, isolation (the checklist belongs to its subtype only), exact questions, no show-when rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RENUNCIATION_MINOR_NO_PASSPORT_DEFINITIONS, CHECKLIST_KEY, SECTIONS } = require("../renunciationMinorNoPassportChecklist");
const { slugSection } = require("../definitionHelpers");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../singlePartyChecklists");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = RENUNCIATION_MINOR_NO_PASSPORT_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `renmin_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const labelsOf = (section) => definition.questions.filter((question) => question.sectionKey === slugSection(section)).map((question) => question.label);

test("registration: new visa type Renunciation; subtype 1 has its own checklist, named after the subtype, assigned only through its own filing type", () => {
  const filing = filingTypes.getFilingType("RENUNCIATION_MINOR_WITHOUT_INDIAN_PASSPORT");
  assert.deepEqual([filing.label, filing.visaType, filing.category, filing.section, filing.questionnaireKey], ["Minor without Indian passport", "RENUNCIATION", "indian_timeline", "indian_timeline", CHECKLIST_KEY]);
  assert.equal(definition.title, "Minor without Indian passport", "the checklist is named after its subtype");
  assert.deepEqual([definition.key, definition.visaType, definition.checklistRole, definition.isDefault], [CHECKLIST_KEY, "RENUNCIATION", "client", false]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key), "not offered in the status-change pickers");
  const registry = visaCategories.VISA_CATEGORIES.RENUNCIATION;
  assert.deepEqual([registry.caseStructure, registry.forms, registry.noForms, registry.label, registry.subTypes], ["single", [], true, "Renunciation", ["Minor without Indian passport"]]);
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1, "registered exactly once");
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.filter((item) => item.visaType === "RENUNCIATION").length, 0, "no competing scaffold checklist");
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "RENUNCIATION").length, 0, "no USCIS forms");
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  // isolation: no other filing type points at this checklist, and no other checklist is tied to the Renunciation visa type
  assert.deepEqual(filingTypes.listFilingTypes().filter((item) => item.questionnaireKey === CHECKLIST_KEY).map((item) => item.key), ["RENUNCIATION_MINOR_WITHOUT_INDIAN_PASSPORT"]);
  assert.deepEqual(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.visaType === "RENUNCIATION").map((item) => item.key), [CHECKLIST_KEY]);
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => others.has(question.key)), "no question key shared with another checklist");
  assert.equal(new Set(definition.questions.map((question) => question.key)).size, definition.questions.length, "no duplicate keys");
});

test("the backend dropdown and the Admin copy list Renunciation as an Indian Timeline visa type with its subtype", () => {
  const admin = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  const backend = fs.readFileSync(path.join(__dirname, "../../../config/visaDropdown.js"), "utf8");
  const line = "{ value: 'renunciation', label: 'Renunciation', canonicalLabel: 'RENUNCIATION' }";
  assert.ok(admin.includes(line) && backend.includes(line), "the same dropdown entry in both copies");
  assert.ok(admin.includes("'renunciation'])"), "an Indian Timeline visa type in the Admin picker");
  assert.ok(admin.includes("value: 'RENUNCIATION_MINOR_WITHOUT_INDIAN_PASSPORT', label: 'Minor without Indian passport'"), "the subtype is selectable");
});

test("sections, exact labels and counts", () => {
  assert.deepEqual(SECTIONS, definition.sections);
  assert.equal(SECTIONS.length, 5);
  assert.deepEqual(labelsOf(SECTIONS[0]), ["Applicant Name", "Phone Number", "E-mail ID"]);
  assert.deepEqual(labelsOf(SECTIONS[1]), [
    "Digital Photograph & Signature", "Physical Photographs", "Copy of Current Address Proof", "Copy of Current Passport", "Copy of Recent Indian Passport", "Copy of Naturalization Certificate",
    "Copy of Proof of Indian Origin", "Copy of Police report:", "As you don’t have the most recent Indian passport, please provide one document:",
  ]);
  assert.deepEqual(labelsOf(SECTIONS[2]), ["Indian passport number", "Place of Issue (Indian Passport)", "Issued date (Indian Passport)", "Expiry date (Indian Passport)", "Visible distinguishing mark (if any)", "Educational Qualification of the applicant", "Place of Birth (Village/Town/City)", "District", "State/UT"]);
  assert.deepEqual(labelsOf(SECTIONS[3]), ["Father’s Surname", "Father’s Given name", "Mother’s Surname", "Mother’s Given name", "Legal Guardian's Surname (if applicable)", "Legal Guardian's Given name (if applicable)", "From where you have travelled to U.S for first time", "Date when you arrived in U.S.A for first time", "Father’s Passport No.", "Father’s Date of Naturalization", "Mother’s Passport No.", "Mother’s Date of Naturalization"]);
  assert.deepEqual(labelsOf(SECTIONS[4]), ["Emergency Contact Details"]);
  assert.equal(definition.questions.length, 3 + 9 + 9 + 12 + 1);
  assert.equal(q("physical_photos_ack").type, "radio", "the physical photographs are an acknowledgement, never an upload");
  assert.equal(definition.questions.filter((question) => question.type === "file").length, 8);
  assert.deepEqual(q("education").options.map((o) => o.value), ["10th Pass and Above", "7th Pass or Less", "Between 8th and 9th Standard", "Graduate and Above"]);
  assert.deepEqual([q("applicant_phone").type, q("applicant_email").type, q("first_arrival_date").type, q("indian_passport_issue_date").type, q("father_naturalization_date").type], ["phone", "email", "date", "date", "date"]);
  assert.deepEqual(q("emergency_contacts").metadata.fields.map((f) => [f.label, f.type]), [["Full Name", "text"], ["Address", "textarea"], ["Contact No.", "phone"]]);
  assert.equal(q("emergency_contacts").repeatable, true);
  assert.equal(q("emergency_contacts").repeatableConfig.min, 1, "at least one emergency contact");
  assert.match(q("doc_photo_signature").description, /Part 1: Photograph Requirements[\s\S]*Part 2: Signature Requirements[\s\S]*left thumb impression/);
  assert.match(q("doc_address_proof").description, /ANY ONE required[\s\S]*Driving license \(FRONT AND BACK\)[\s\S]*affidavit of address proof/);
  assert.match(q("doc_proof_of_indian_origin").description, /any TWO documents[\s\S]*Voter ID[\s\S]*Board Certificate[\s\S]*Birth Certificate[\s\S]*parent’s proof of Indian origin/);
  assert.match(q("doc_police_report").description, /naturalized after 2010[\s\S]*Green Card[\s\S]*NOT BE MORE THAN 6 MONTHS OLD/);
  assert.equal(q("indian_passport_number").description, "If you don’t have copy of Indian passport, please provide below information:");
  assert.equal(q("father_passport_no").description, "If the applicant has gained naturalization through parents, please provide information below:");
  assert.equal(q("education").description, "Choose any one:");
});

test("no show-when rules: every question is always visible; exact required list; the passport rule does not force the Indian-passport items", () => {
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, `${question.key} has no show-when rule`);
    assert.equal(isQuestionVisible(question, {}, client), true, `${question.key} visible with no answers`);
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("renmin_", "")).sort();
  assert.deepEqual(required, ["applicant_name", "applicant_phone", "applicant_email", "doc_photo_signature", "physical_photos_ack", "doc_address_proof", "doc_current_passport", "doc_naturalization_certificate", "education", "place_of_birth", "district", "state_ut",
    "father_surname", "father_given_name", "mother_surname", "mother_given_name", "first_travel_from", "first_arrival_date", "emergency_contacts"].sort());
  for (const name of ["doc_recent_indian_passport", "doc_proof_of_indian_origin", "doc_police_report", "doc_indian_citizenship_alternative", "indian_passport_number", "indian_passport_place", "indian_passport_issue_date", "indian_passport_expiry_date", "distinguishing_mark",
    "guardian_surname", "guardian_given_name", "father_passport_no", "father_naturalization_date", "mother_passport_no", "mother_naturalization_date"]) assert.equal(state(name).required, false, name);
  assert.equal(state("doc_current_passport").required, true, "the current foreign passport copy stays required");
});
