// Adult Foreign citizen by birth and never held Indian passport (2nd Indian Timeline subtype): registration, isolation from the first subtype, no forms / mappings, all questions visible + optional.
const test = require("node:test");
const assert = require("node:assert/strict");
const { OCI_BIRTH_CHECKLIST_DEFINITIONS, CHECKLIST_KEY, INSTRUCTIONS } = require("../ociBirthChecklist");
const { OCI_CHECKLIST_DEFINITIONS } = require("../ociChecklists");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = OCI_BIRTH_CHECKLIST_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `oci_birth_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};

test("second OCI subtype: its own checklist, client role, not a default, no forms, no canonical paths; the first subtype is untouched", () => {
  assert.equal(definition.key, CHECKLIST_KEY);
  assert.equal(definition.title, "Adult Foreign citizen by birth and never held Indian passport");
  assert.equal(definition.visaType, "OCI");
  assert.equal(definition.checklistRole, "client");
  assert.equal(definition.isDefault, false);
  for (const line of INSTRUCTIONS) assert.ok(definition.description.includes(line), line);
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  const filing = filingTypes.getFilingType("OCI_ADULT_FOREIGN_CITIZEN_BY_BIRTH");
  assert.deepEqual([filing.visaType, filing.questionnaireKey], ["OCI", CHECKLIST_KEY]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key));
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1);
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "OCI").length, 0);
  // first subtype: same key, no question key shared with the new one
  const first = OCI_CHECKLIST_DEFINITIONS[0];
  assert.equal(first.key, "oci_adult_former_indian_passport_checklist");
  assert.equal(first.questions.length, 43);
  const firstKeys = new Set(first.questions.map((question) => question.key));
  assert.ok(!definition.questions.some((question) => firstKeys.has(question.key)), "no question key is shared between the two subtypes");
  assert.equal(filingTypes.getFilingType("OCI_ADULT_FORMER_INDIAN_PASSPORT").questionnaireKey, first.key);
});

test("the 17 document categories and all questionnaire fields are present", () => {
  for (const name of ["full_name", "phone", "marital_status", "distinguishing_mark", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "father_name", "mother_name", "spouse_based_oci", "current_occupation", "prior_oci_applied", "oci_surrendered_or_cancelled", "relatives_in_india",
    "doc_digital_photo_signature", "physical_photos_ack", "doc_current_passport", "doc_birth_certificate", "doc_indian_origin_evidence", "doc_parents_oci_pio_cards", "doc_legal_status_usa", "doc_marital_status_proof", "doc_spouse_passport", "doc_name_change", "doc_employment_verification",
    "doc_parents_naturalization_passports", "doc_parents_spouse_oci_cards", "doc_previous_indian_visa", "doc_us_address_proof", "doc_native_address_proof", "doc_parents_marriage_certificate"]) assert.ok(q(name), name);
  assert.deepEqual(q("root_ancestor_relationship").options.map((o) => o.value), ["Self", "Father", "Mother", "Grandparent", "Great-grandparent"]);
  assert.equal(q("physical_photos_ack").type, "radio", "physical photographs are an acknowledgement, never an upload");
  assert.equal(q("doc_digital_photo_signature").type, "file");
});


test("17 document items; every question always visible; core items required, situational ones optional", () => {
  const section = q("doc_current_passport").sectionKey;
  const docs = definition.questions.filter((question) => question.sectionKey === section);
  assert.equal(docs.length, 17, "one entry per document category of the checklist");
  assert.equal(docs.filter((question) => question.type === "file").length, 16, "16 uploads + the physical-photographs acknowledgement");
  assert.deepEqual(docs.map((question) => question.label.split(".")[0]), Array.from({ length: 17 }, (_, n) => String(n + 1)), "questionnaire order 1-17");
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, `${question.key} has no show-when rule`);
    assert.equal(isQuestionVisible(question, {}, client), true, `${question.key} visible with no answers`);
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("oci_birth_", "")).sort();
  assert.deepEqual(required, ["current_nationality", "current_occupation", "country_of_birth", "doc_birth_certificate", "doc_current_passport", "doc_digital_photo_signature", "doc_indian_origin_evidence", "doc_us_address_proof", "father_name", "father_nationality", "full_name", "marital_status", "mother_name", "mother_nationality", "oci_surrendered_or_cancelled", "phone", "physical_photos_ack", "place_of_birth", "prior_oci_applied", "root_ancestor_relationship", "spouse_based_oci"].sort());
  for (const name of ["doc_parents_oci_pio_cards", "doc_legal_status_usa", "doc_marital_status_proof", "doc_spouse_passport", "doc_name_change", "doc_employment_verification", "doc_parents_naturalization_passports", "doc_parents_spouse_oci_cards", "doc_previous_indian_visa", "doc_native_address_proof", "doc_parents_marriage_certificate", "spouse_name", "marriage_date", "employer_name_address", "prior_oci_applications", "oci_surrender_details", "relatives_in_india", "distinguishing_mark"]) assert.equal(state(name).required, false, name);
  assert.equal(q("root_ancestor_relationship").description, "e.g., Self / Father / Mother / Grandparent", "hint kept");
  assert.equal(q("prior_oci_applications").metadata.fields.length, 5);
  assert.equal(q("relatives_in_india").metadata.fields.length, 4);
});
