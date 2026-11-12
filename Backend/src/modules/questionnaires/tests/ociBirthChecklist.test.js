// Adult Foreign citizen by birth and never held Indian passport (2nd Indian Timeline subtype): registration, isolation from the first subtype, no forms / mappings, conditional rules.
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
  assert.equal(first.questions.length, 73);
  const firstKeys = new Set(first.questions.map((question) => question.key));
  assert.ok(!definition.questions.some((question) => firstKeys.has(question.key)), "no question key is shared between the two subtypes");
  assert.equal(filingTypes.getFilingType("OCI_ADULT_FORMER_INDIAN_PASSPORT").questionnaireKey, first.key);
});

test("the 17 document categories and all questionnaire fields are present", () => {
  for (const name of ["full_name", "phone", "marital_status", "distinguishing_mark", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "father_name", "mother_name", "spouse_based_oci", "current_occupation", "prior_oci_applied", "oci_surrendered_or_cancelled", "relatives_in_india",
    "doc_digital_photo", "doc_signature", "physical_photos_ack", "doc_current_passport", "doc_birth_certificate", "doc_indian_origin_evidence", "indian_origin_lineage", "doc_father_oci_card", "doc_mother_oci_card", "legal_status_document", "doc_marriage_certificate", "doc_spouse_passport", "doc_name_change",
    "doc_employer_letter", "doc_father_naturalization_certificate", "doc_mother_foreign_passport", "doc_family_oci_cards", "doc_previous_indian_visa", "doc_us_address_proof", "doc_native_address_proof", "doc_parents_marriage_certificate"]) assert.ok(q(name), name);
  assert.deepEqual(q("root_ancestor_relationship").options.map((o) => o.value), ["Self", "Father", "Mother", "Grandparent", "Great-grandparent"]);
  assert.equal(q("physical_photos_ack").type, "radio", "physical photographs are an acknowledgement, never an upload");
  assert.equal(q("doc_digital_photo").type, "file");
  assert.equal(q("doc_signature").type, "file");
});

test("birth certificate: authentication only when born outside India", () => {
  assert.equal(state("doc_birth_certificate").required, true);
  assert.equal(state("birth_certificate_authentication", { oci_birth_country_of_birth: "India" }).visible, false);
  assert.equal(state("birth_certificate_authentication", {}).visible, false);
  assert.equal(state("birth_certificate_authentication", { oci_birth_country_of_birth: "Canada" }).required, true);
  assert.equal(q("birth_certificate_authentication").options.length, 2, "one of two alternatives, never both");
});

test("Indian origin: several documents + a lineage group; parents' OCI/PIO per parent; parent-based marriage certificate", () => {
  assert.equal(state("doc_indian_origin_evidence").required, true);
  assert.equal(q("indian_origin_lineage").repeatable, true);
  assert.equal(state("indian_origin_lineage").required, true);
  assert.equal(q("indian_origin_lineage").metadata.fields.length, 3);
  assert.deepEqual(["doc_father_oci_card", "doc_father_oci_supporting", "doc_mother_oci_card"].map((n) => state(n, {}).visible), [false, false, false]);
  assert.deepEqual([state("doc_father_oci_card", { oci_birth_father_holds_oci: "Yes" }).required, state("doc_mother_oci_card", { oci_birth_father_holds_oci: "Yes" }).visible], [true, false]);
  assert.deepEqual([state("doc_parents_marriage_certificate", { oci_birth_root_ancestor_relationship: "Father" }).required, state("doc_parents_marriage_certificate", { oci_birth_root_ancestor_relationship: "Mother" }).required], [true, true]);
  assert.equal(state("doc_parents_marriage_certificate", { oci_birth_root_ancestor_relationship: "Grandparent", oci_birth_marital_status: "Married" }).visible, false, "not required just because the applicant is married");
  assert.equal(state("doc_marriage_certificate", { oci_birth_root_ancestor_relationship: "Father" }).visible, false, "the applicant's own and the parents' marriage certificates are separate");
});

test("spouse fields and passport, own marital evidence", () => {
  const single = { oci_birth_marital_status: "Single / Never Married", oci_birth_spouse_based_oci: "No" };
  assert.deepEqual(["spouse_name", "doc_spouse_passport", "doc_marriage_certificate", "doc_divorce_decree", "doc_death_certificate"].map((n) => state(n, single).visible), [false, false, false, false, false]);
  assert.deepEqual([state("spouse_name", { oci_birth_marital_status: "Married" }).required, state("doc_spouse_passport", { oci_birth_marital_status: "Married" }).required, state("doc_marriage_certificate", { oci_birth_marital_status: "Married" }).required], [true, true, true]);
  assert.equal(state("doc_spouse_passport", { oci_birth_marital_status: "Single / Never Married", oci_birth_spouse_based_oci: "Yes" }).required, true);
  assert.equal(state("doc_divorce_decree", { oci_birth_marital_status: "Divorced" }).required, true);
  assert.equal(state("doc_death_certificate", { oci_birth_marital_status: "Widowed" }).required, true);
});

test("legal status, name change, employment, parents' naturalization, previous visa, address proofs, prior OCI, surrender, relatives", () => {
  assert.equal(state("legal_status_document", { oci_birth_holds_us_passport: "Yes" }).visible, false);
  const green = { oci_birth_holds_us_passport: "No", oci_birth_legal_status_document: "Green Card" };
  assert.deepEqual([state("doc_green_card", green).required, state("doc_ead", green).visible, state("doc_extension_receipt", green).visible], [true, false, false]);
  assert.deepEqual([state("doc_extension_receipt", { ...green, oci_birth_visa_extension_pending: "Yes" }).required, state("doc_expired_visa", { ...green, oci_birth_visa_extension_pending: "Yes" }).required], [true, true]);
  assert.deepEqual([state("previous_names", { oci_birth_used_previous_name: "No" }).visible, state("doc_name_change", { oci_birth_used_previous_name: "Yes" }).required], [false, true]);
  const evidence = { Employed: "doc_employer_letter", "Self-employed / Business owner": "doc_self_employment", Retired: "doc_retirement_proof", Student: "doc_student_proof", "Never employed or self-employed": "doc_never_employed_statement" };
  for (const situation of Object.keys(evidence)) for (const [other, doc] of Object.entries(evidence)) assert.equal(state(doc, { oci_birth_employment_situation: situation }).visible, other === situation, `${doc}/${situation}`);
  assert.deepEqual([state("employer_name_address", { oci_birth_employment_situation: "Student" }).visible, state("employer_name_address", { oci_birth_employment_situation: "Employed" }).required], [false, true]);
  assert.deepEqual([state("doc_father_naturalization_certificate", { oci_birth_father_naturalization: "No / Not applicable (N/A)" }).visible, state("doc_father_naturalization_certificate", { oci_birth_father_naturalization: "Yes" }).required, state("doc_mother_foreign_passport", { oci_birth_father_naturalization: "Yes" }).visible], [false, true, false]);
  assert.deepEqual([state("doc_previous_indian_visa", { oci_birth_previous_indian_visa: "No" }).visible, state("doc_previous_indian_visa", { oci_birth_previous_indian_visa: "Yes" }).required], [false, true]);
  assert.equal(state("doc_us_address_proof").required, true);
  assert.equal(state("doc_native_address_proof", { oci_birth_current_nationality: "United States" }).visible, false);
  assert.equal(state("doc_native_address_proof", { oci_birth_current_nationality: "Canada" }).required, true);
  const dual = { oci_birth_current_nationality: "Canada", oci_birth_dual_citizen: "Yes" };
  assert.deepEqual([state("dual_citizen_countries", dual).required, state("doc_native_address_proof_second", dual).required, state("doc_native_address_proof_second", { ...dual, oci_birth_dual_citizen: "No" }).visible], [true, true, false]);
  assert.deepEqual([state("prior_oci_applications", { oci_birth_prior_oci_applied: "No" }).visible, state("prior_oci_applications", { oci_birth_prior_oci_applied: "Yes" }).required], [false, true]);
  assert.equal(q("prior_oci_applications").metadata.fields.length, 6);
  assert.deepEqual([state("oci_surrender_details", { oci_birth_oci_surrendered_or_cancelled: "No" }).visible, state("oci_surrender_details", { oci_birth_oci_surrendered_or_cancelled: "Yes" }).required], [false, true]);
  assert.deepEqual([q("relatives_in_india").repeatable, state("relatives_in_india").required, q("relatives_in_india").metadata.fields.length], [true, false, 4]);
  assert.equal(state("doc_family_oci_cards").required, false);
  assert.equal(state("distinguishing_mark").required, false);
});
