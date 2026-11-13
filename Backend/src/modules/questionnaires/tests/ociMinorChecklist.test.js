// OCI - Minor Foreign citizen and never held Indian passport (3rd Indian Timeline subtype): registration, isolation from the other two, no forms / mappings, conditional rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const { OCI_MINOR_CHECKLIST_DEFINITIONS, CHECKLIST_KEY, INSTRUCTIONS } = require("../ociMinorChecklist");
const { OCI_CHECKLIST_DEFINITIONS } = require("../ociChecklists");
const { OCI_BIRTH_CHECKLIST_DEFINITIONS } = require("../ociBirthChecklist");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = OCI_MINOR_CHECKLIST_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `oci_minor_${name}`);
const client = { role: "client" };
const a = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [`oci_minor_${k}`, v]));
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};

test("third OCI subtype: its own checklist, client role, not a default, no forms, no canonical paths; the other two are untouched", () => {
  assert.equal(definition.key, CHECKLIST_KEY);
  assert.equal(definition.title, "Minor Foreign citizen and never held Indian passport");
  assert.equal(definition.visaType, "OCI");
  assert.equal(definition.checklistRole, "client");
  assert.equal(definition.isDefault, false);
  for (const line of INSTRUCTIONS) assert.ok(definition.description.includes(line), line);
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  const filing = filingTypes.getFilingType("OCI_MINOR_FOREIGN_CITIZEN_NEVER_HELD");
  assert.deepEqual([filing.visaType, filing.questionnaireKey], ["OCI", CHECKLIST_KEY]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key));
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1);
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "OCI").length, 0);
  // the first two: same keys / counts, and no question key shared with the new one
  assert.equal(OCI_CHECKLIST_DEFINITIONS[0].key, "oci_adult_former_indian_passport_checklist");
  assert.equal(OCI_CHECKLIST_DEFINITIONS[0].questions.length, 43);
  assert.equal(OCI_BIRTH_CHECKLIST_DEFINITIONS[0].key, "oci_adult_foreign_citizen_by_birth_checklist");
  const others = new Set([...OCI_CHECKLIST_DEFINITIONS[0].questions, ...OCI_BIRTH_CHECKLIST_DEFINITIONS[0].questions].map((question) => question.key));
  assert.ok(!definition.questions.some((question) => others.has(question.key)), "no question key is shared with the other subtypes");
  assert.equal(filingTypes.getFilingType("OCI_ADULT_FORMER_INDIAN_PASSPORT").questionnaireKey, OCI_CHECKLIST_DEFINITIONS[0].key);
  assert.equal(filingTypes.getFilingType("OCI_ADULT_FOREIGN_CITIZEN_BY_BIRTH").questionnaireKey, OCI_BIRTH_CHECKLIST_DEFINITIONS[0].key);
});

test("questionnaire fields (minor-specific: no marital status / occupation / spouse) are present", () => {
  for (const name of ["full_name", "phone", "distinguishing_mark", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "is_student", "institution_name", "institution_address", "institution_phone", "father_name", "father_nationality", "father_occupation", "mother_name", "mother_nationality", "mother_occupation", "prior_oci_applied", "prior_oci_applications", "oci_surrendered_or_cancelled", "oci_surrender_details", "relatives_in_india"]) assert.ok(q(name), `${name} exists`);
  for (const absent of ["marital_status", "current_occupation", "spouse_name", "spouse_based_oci", "employment_situation", "can_sign", "holds_us_passport", "dual_citizen", "used_previous_name", "previous_indian_visa", "indian_origin_lineage", "father_naturalization", "parents_marital_status"]) assert.equal(q(absent), undefined, `${absent} is not asked`);
  assert.equal(q("root_ancestor_relationship").type, "text");
  assert.equal(state("distinguishing_mark").required, false);
  assert.equal(state("relatives_in_india").required, false);
  assert.deepEqual([state("prior_oci_applications", a({ prior_oci_applied: "No" })).visible, state("prior_oci_applications", a({ prior_oci_applied: "Yes" })).required], [false, true]);
  assert.deepEqual([state("oci_surrender_details", a({ oci_surrendered_or_cancelled: "No" })).visible, state("oci_surrender_details", a({ oci_surrendered_or_cancelled: "Yes" })).required], [false, true]);
  assert.deepEqual([q("relatives_in_india").repeatable, q("relatives_in_india").metadata.fields.length], [true, 4]);
});

test("the Required Documents section lists exactly the 13 supplied requirements, in order, one item each", () => {
  const docs = definition.questions.filter((question) => question.sectionKey === "required_documents");
  assert.deepEqual(docs.map((question) => question.label), [
    "Digital Photograph & Signature", "Physical Photographs", "Current Valid Passport", "Copy of Birth Certificate", "Copy of Evidence of Indian origin of Parents or grandparents or great grandparents",
    "Legal Status in USA (Non-US Passport Holders)", "Proof of Name Change", "Copy of Naturalization and current foreign passport of the Parents", "Copy of Marriage Certificate of Parents",
    "Parents' OCI Cards", "Previous Indian Visa", "Proof of USA Address", "Native Address Proof (Non-US Nationals)",
  ]);
  assert.equal(q("physical_photos_ack").type, "radio");
  for (const question of docs.filter((item) => item.key !== "oci_minor_physical_photos_ack")) assert.equal(question.type, "file", question.label);
  assert.match(q("doc_photo_signature").description, /Part 1: Photograph Requirements[\s\S]*Part 2: Signature Requirements[\s\S]*left thumb impression/);
  assert.match(q("doc_birth_certificate").description, /born in the USA[\s\S]*apostilled[\s\S]*VFS or Consulate/);
  assert.match(q("doc_indian_origin_evidence").description, /Domicile Certificate[\s\S]*Nativity Certificate[\s\S]*Any other proof/);
  assert.match(q("doc_parents_marriage_certificate").description, /Marriage Registrar[\s\S]*religious body[\s\S]*divorce decree[\s\S]*death certificate/);
  for (const name of ["doc_photo_signature", "physical_photos_ack", "doc_current_passport", "doc_indian_origin_evidence", "doc_parents_marriage_certificate", "doc_us_address_proof"]) assert.equal(state(name).required, true, name);
  for (const name of ["doc_birth_certificate", "doc_legal_status_usaCertOrPassport", "doc_name_change", "doc_parents_naturalizationCertOrPassport", "doc_parents_oci_cards", "doc_previous_indian_visa", "doc_native_address_proof"]) assert.deepEqual(state(name), { visible: true, required: false }, name);
  assert.deepEqual([state("doc_legal_status_usaCertOrPassport", a({ current_nationality: "United States" })), state("doc_legal_status_usaCertOrPassport", a({ current_nationality: "Canada" }))], [{ visible: true, required: false }, { visible: true, required: false }], "Legal Status is always shown, optional");
});

test("student details only when 'Are you a student?' is Yes", () => {
  for (const name of ["institution_name", "institution_address", "institution_phone"]) {
    assert.equal(state(name, { oci_minor_is_student: "No" }).visible, false, name);
    assert.equal(state(name, {}).visible, false, name);
    assert.equal(state(name, { oci_minor_is_student: "Yes" }).required, true, name);
  }
});

