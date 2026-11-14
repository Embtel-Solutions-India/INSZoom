// OCI -> subtype "OCI RENUNCIATION": registration, isolation (shown only for its own subtype; the five existing OCI subtypes are untouched), exact questions, no show-when rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { OCI_RENUNCIATION_DEFINITIONS, CHECKLIST_KEY, SECTIONS } = require("../ociRenunciationChecklist");
const { OCI_CHECKLIST_DEFINITIONS } = require("../ociChecklists");
const { OCI_BIRTH_CHECKLIST_DEFINITIONS } = require("../ociBirthChecklist");
const { OCI_MINOR_CHECKLIST_DEFINITIONS } = require("../ociMinorChecklist");
const { OCI_MINOR_HELD_CHECKLIST_DEFINITIONS } = require("../ociMinorHeldChecklist");
const { OCI_SPOUSE_CHECKLIST_DEFINITIONS } = require("../ociSpouseChecklist");
const { slugSection } = require("../definitionHelpers");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../singlePartyChecklists");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = OCI_RENUNCIATION_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `ocirn_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const labelsOf = (section) => definition.questions.filter((question) => question.sectionKey === slugSection(section)).map((question) => question.label);

test("registration: OCI RENUNCIATION is a sixth OCI subtype with its own checklist, assigned only through its own filing type", () => {
  const filing = filingTypes.getFilingType("OCI_RENUNCIATION");
  assert.deepEqual([filing.label, filing.visaType, filing.category, filing.section, filing.questionnaireKey], ["OCI RENUNCIATION", "OCI", "indian_timeline", "indian_timeline", CHECKLIST_KEY]);
  assert.equal(definition.title, "OCI RENUNCIATION", "the checklist is named after its subtype");
  assert.deepEqual([definition.key, definition.visaType, definition.checklistRole, definition.isDefault], [CHECKLIST_KEY, "OCI", "client", false]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key), "not offered in the status-change pickers");
  const registry = visaCategories.VISA_CATEGORIES.OCI;
  assert.deepEqual([registry.caseStructure, registry.forms, registry.noForms], ["single", [], true]);
  assert.equal(registry.subTypes.length, 6);
  assert.equal(registry.subTypes.at(-1), "OCI RENUNCIATION", "alphabetical: it sorts last among the OCI subtypes");
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1, "registered exactly once");
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.filter((item) => item.key === "OCI_RENUNCIATION").length, 0, "no competing scaffold checklist");
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "OCI").length, 0, "no USCIS forms");
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  // isolation: six OCI subtypes, six different checklists, none a default; the five existing ones are unchanged
  const oci = filingTypes.listFilingTypes().filter((item) => item.visaType === "OCI");
  assert.equal(oci.length, 6);
  assert.equal(new Set(oci.map((item) => item.questionnaireKey)).size, 6, "six different checklists");
  assert.deepEqual(filingTypes.listFilingTypes().filter((item) => item.questionnaireKey === CHECKLIST_KEY).map((item) => item.key), ["OCI_RENUNCIATION"]);
  for (const item of VISA_TEMPLATE_DEFINITIONS.filter((entry) => entry.visaType === "OCI")) assert.equal(item.isDefault, false, `${item.key} is never a default`);
  assert.deepEqual([OCI_CHECKLIST_DEFINITIONS, OCI_BIRTH_CHECKLIST_DEFINITIONS, OCI_MINOR_CHECKLIST_DEFINITIONS, OCI_MINOR_HELD_CHECKLIST_DEFINITIONS, OCI_SPOUSE_CHECKLIST_DEFINITIONS].map((list) => list[0].questions.length), [43, 46, 35, 37, 58], "the other OCI checklists are unchanged");
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key !== CHECKLIST_KEY).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => others.has(question.key)), "no question key shared with another checklist");
  assert.equal(new Set(definition.questions.map((question) => question.key)).size, definition.questions.length, "no duplicate keys");
  const admin = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  assert.ok(admin.includes("value: 'OCI_RENUNCIATION', label: 'OCI RENUNCIATION'"), "the subtype is selectable in Admin");
});

test("sections, exact labels, answer types and counts", () => {
  assert.deepEqual(SECTIONS, definition.sections);
  assert.equal(SECTIONS.length, 5);
  assert.deepEqual(labelsOf(SECTIONS[0]), ["Applicant Full Name", "Phone Number", "Email ID"]);
  assert.deepEqual(labelsOf(SECTIONS[1]), ["Copy of Original OCI Card", "Current Valid Passport", "Previous passport", "Legal Status in USA (Non-US Passport Holders)", "Proof of USA Address", "Native Address Proof (Non-US Nationals)"]);
  assert.deepEqual(labelsOf(SECTIONS[2]), ["Surname", "Given name", "Gender", "Date of Birth", "Country of Birth", "Place of Birth", "Current Nationality", "Visible mark", "Marital Status", "Passport Number", "Date of Issue", "Date of Expiry", "Place of Issue", "Present Address", "Zip code"]);
  assert.deepEqual(labelsOf(SECTIONS[3]), ["Spouse's Full Name", "Spouse's Date of Birth", "Spouse's Nationality", "Spouse's Occupation", "Spouse’s Passport number", "Date of issue of spouse passport", "Whether your spouse is registered as an OCI card holder?", "OCI card number in case of OCI card holder spouse", "Whether minor children are registered as OCI card holders?", "Child name / OCI card No."]);
  assert.deepEqual(labelsOf(SECTIONS[4]), ["Current Occupation / Designation", "Employer Name & Office Address", "Employer Contact Number", "If Retired, Dept / Office / Organization"]);
  assert.equal(definition.questions.length, 3 + 6 + 15 + 10 + 4);
  assert.equal(definition.questions.filter((question) => question.type === "file").length, 6);
  assert.ok(!definition.questions.some((question) => /physical_photos|photo/.test(question.key)), "this checklist asks for no photograph and has no physical-photographs item");
  assert.deepEqual(q("gender").options.map((o) => o.value), ["Male", "Female", "Other"]);
  assert.deepEqual(q("marital_status").options.map((o) => o.value), ["Single / Never Married", "Married", "Divorced", "Widowed", "Separated"]);
  assert.deepEqual([q("applicant_phone").type, q("applicant_email").type, q("date_of_birth").type, q("country_of_birth").type, q("current_nationality").type, q("spouse_nationality").type, q("employer_phone").type, q("present_address").type],
    ["phone", "email", "date", "select", "select", "select", "phone", "textarea"]);
  assert.deepEqual([q("spouse_is_oci_holder").type, q("children_are_oci_holders").type].map((type) => type), ["radio", "radio"]);
  assert.deepEqual(q("children_oci_cards").metadata.fields.map((f) => f.label), ["Child name", "OCI card No."]);
  assert.equal(q("children_oci_cards").repeatable, true);
  assert.equal(q("doc_origin_oci_card").description, "Color copy of first and last two pages");
  assert.equal(q("doc_previous_passport").description, "Copy of previous passport which is linked to the OCI card (if current passport not linked with OCI)");
  assert.match(q("doc_legal_status_usa").description, /Green Card \(Front & Back\)[\s\S]*I-797A \/ I-797C Notice/);
  assert.ok(!/e-?mail|send/i.test(JSON.stringify(definition.questions.map((question) => question.description))), "no e-mail wording");
  assert.ok(!JSON.stringify(definition).includes("Martial"), "the 'Martial' typo is corrected");
});

test("no show-when rules: every question is always visible; exact required list; the passport rule does not force the situational passport items", () => {
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, `${question.key} has no show-when rule`);
    assert.equal(isQuestionVisible(question, {}, client), true, `${question.key} visible with no answers`);
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("ocirn_", "")).sort();
  assert.deepEqual(required, ["applicant_name", "applicant_phone", "applicant_email", "doc_origin_oci_card", "doc_current_passport", "doc_us_address_proof",
    "surname", "given_name", "gender", "date_of_birth", "country_of_birth", "place_of_birth", "current_nationality", "marital_status", "passport_number", "passport_issue_date", "passport_expiry_date", "passport_place_of_issue", "present_address", "zip_code",
    "spouse_is_oci_holder", "children_are_oci_holders", "current_occupation"].sort());
  for (const name of ["doc_previous_passport", "doc_legal_status_usa", "doc_native_address_proof", "visible_mark", "spouse_name", "spouse_dob", "spouse_nationality", "spouse_occupation", "spouse_passport_number", "spouse_passport_issue_date",
    "spouse_oci_number", "children_oci_cards", "employer_name_address", "employer_phone", "retired_organization"]) assert.equal(state(name).required, false, name);
  for (const name of ["doc_current_passport", "passport_number", "passport_issue_date", "passport_expiry_date", "passport_place_of_issue"]) assert.equal(state(name).required, true, name);
});
