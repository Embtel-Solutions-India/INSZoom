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
  assert.equal(OCI_CHECKLIST_DEFINITIONS[0].questions.length, 73);
  assert.equal(OCI_BIRTH_CHECKLIST_DEFINITIONS[0].key, "oci_adult_foreign_citizen_by_birth_checklist");
  const others = new Set([...OCI_CHECKLIST_DEFINITIONS[0].questions, ...OCI_BIRTH_CHECKLIST_DEFINITIONS[0].questions].map((question) => question.key));
  assert.ok(!definition.questions.some((question) => others.has(question.key)), "no question key is shared with the other subtypes");
  assert.equal(filingTypes.getFilingType("OCI_ADULT_FORMER_INDIAN_PASSPORT").questionnaireKey, OCI_CHECKLIST_DEFINITIONS[0].key);
  assert.equal(filingTypes.getFilingType("OCI_ADULT_FOREIGN_CITIZEN_BY_BIRTH").questionnaireKey, OCI_BIRTH_CHECKLIST_DEFINITIONS[0].key);
});

test("questionnaire fields (minor-specific: no marital status / occupation / spouse) and the 13 document categories are present", () => {
  for (const name of ["full_name", "phone", "distinguishing_mark", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "is_student", "institution_name", "institution_address", "institution_phone", "father_name", "father_nationality", "father_occupation", "mother_name", "mother_nationality", "mother_occupation", "prior_oci_applied", "oci_surrendered_or_cancelled", "relatives_in_india",
    "doc_digital_photo", "can_sign", "doc_signature", "doc_thumb_impression", "physical_photos_ack", "doc_current_passport", "doc_birth_certificate", "indian_origin_lineage", "doc_indian_origin_evidence", "legal_status_document", "doc_name_change", "doc_father_naturalization_certificate", "doc_mother_foreign_passport", "parents_marital_status", "doc_parents_marriage_certificate", "doc_parents_divorce_decree", "doc_parent_death_certificate", "doc_father_oci_card", "doc_mother_oci_card", "doc_previous_indian_visa", "doc_us_address_proof", "doc_native_address_proof"]) assert.ok(q(name), name);
  for (const absent of ["marital_status", "current_occupation", "spouse_name", "spouse_based_oci", "employment_situation"]) assert.equal(q(absent), undefined, `${absent} is not in the minor checklist`);
  assert.deepEqual(q("root_ancestor_relationship").options.map((o) => o.value), ["Self", "Father", "Mother", "Grandparent", "Great-grandparent"]);
  assert.equal(q("physical_photos_ack").type, "radio", "physical photographs are an acknowledgement, never an upload");
  assert.equal(state("distinguishing_mark").required, false);
  assert.equal(state("relatives_in_india").required, false);
});

test("the photograph is always required; signature xor left thumb impression follows 'Can the minor sign?'", () => {
  assert.equal(state("doc_digital_photo", {}).required, true);
  assert.equal(state("doc_digital_photo", { oci_minor_can_sign: "No" }).required, true);
  assert.equal(state("can_sign").required, true);
  assert.deepEqual([state("doc_signature", {}).visible, state("doc_thumb_impression", {}).visible], [false, false]);
  assert.deepEqual([state("doc_signature", { oci_minor_can_sign: "Yes" }).required, state("doc_thumb_impression", { oci_minor_can_sign: "Yes" }).visible], [true, false]);
  assert.deepEqual([state("doc_thumb_impression", { oci_minor_can_sign: "No" }).required, state("doc_signature", { oci_minor_can_sign: "No" }).visible], [true, false]);
  assert.ok(/blue ink/i.test(q("doc_thumb_impression").description));
});

test("birth certificate: shown and authenticated only when born outside India (the documented ambiguity: nothing is asked of an applicant born in India)", () => {
  assert.deepEqual(["doc_birth_certificate", "birth_certificate_authentication", "doc_birth_certificate_self_attested"].map((n) => state(n, {}).visible), [false, false, false]);
  assert.deepEqual(["doc_birth_certificate", "birth_certificate_authentication", "doc_birth_certificate_self_attested"].map((n) => state(n, { oci_minor_country_of_birth: "India" }).visible), [false, false, false]);
  for (const country of ["United States", "Canada"]) assert.deepEqual(["doc_birth_certificate", "birth_certificate_authentication", "doc_birth_certificate_self_attested"].map((n) => state(n, { oci_minor_country_of_birth: country }).required), [true, true, true], country);
  assert.equal(q("birth_certificate_authentication").options.length, 2, "one of two alternatives, never both");
  assert.ok(/VFS/.test(q("doc_birth_certificate_self_attested").description));
  assert.ok(/hospital/i.test(q("doc_birth_certificate").description));
});

test("Indian origin: several documents + a lineage group", () => {
  assert.equal(state("doc_indian_origin_evidence").required, true);
  assert.equal(q("indian_origin_lineage").repeatable, true);
  assert.equal(state("indian_origin_lineage").required, true);
  assert.equal(q("indian_origin_lineage").metadata.fields.length, 3);
});

test("student details only when 'Are you a student?' is Yes", () => {
  for (const name of ["institution_name", "institution_address", "institution_phone"]) {
    assert.equal(state(name, { oci_minor_is_student: "No" }).visible, false, name);
    assert.equal(state(name, {}).visible, false, name);
    assert.equal(state(name, { oci_minor_is_student: "Yes" }).required, true, name);
  }
});

test("parents' documents: naturalization per parent, marital evidence (all available, the chosen one required), OCI cards optional", () => {
  assert.deepEqual([state("doc_father_naturalization_certificate", { oci_minor_father_naturalization: "No / Not applicable (N/A)" }).visible, state("doc_father_naturalization_certificate", { oci_minor_father_naturalization: "Yes" }).required, state("doc_mother_foreign_passport", { oci_minor_father_naturalization: "Yes" }).visible], [false, true, false]);
  const evidence = ["doc_parents_marriage_certificate", "doc_parents_divorce_decree", "doc_parent_death_certificate"];
  assert.deepEqual(evidence.map((n) => state(n, {}).visible), [false, false, false], "nothing until a status is chosen");
  const statuses = { Married: 0, Divorced: 1, "One parent deceased": 2 };
  for (const [status, index] of Object.entries(statuses)) {
    const answers = { oci_minor_parents_marital_status: status };
    assert.deepEqual(evidence.map((n) => state(n, answers).visible), [true, true, true], "all relevant evidence can be added");
    assert.deepEqual(evidence.map((n) => state(n, answers).required), evidence.map((_, i) => i === index), `only the chosen circumstance's evidence is required (${status})`);
  }
  assert.ok(/Marriage Registrar/.test(q("doc_parents_marriage_certificate").description) && /religious body/.test(q("doc_parents_marriage_certificate").description));
  assert.deepEqual([state("doc_father_oci_card", {}).visible, state("doc_father_oci_card", { oci_minor_father_holds_oci: "Yes" }).visible, state("doc_father_oci_card", { oci_minor_father_holds_oci: "Yes" }).required, state("doc_mother_oci_card", { oci_minor_mother_holds_oci: "Yes" }).required], [false, true, false, false]);
});

test("legal status, name change, previous visa, address proofs, prior OCI, surrender and relatives", () => {
  assert.equal(state("legal_status_document", { oci_minor_holds_us_passport: "Yes" }).visible, false);
  const green = { oci_minor_holds_us_passport: "No", oci_minor_legal_status_document: "Green Card" };
  assert.deepEqual([state("doc_green_card", green).required, state("doc_ead", green).visible, state("doc_extension_receipt", green).visible], [true, false, false]);
  const pending = { ...green, oci_minor_visa_extension_pending: "Yes" };
  assert.deepEqual([state("doc_extension_receipt", pending).required, state("doc_expired_visa", pending).required], [true, true]);
  assert.deepEqual([state("previous_names", { oci_minor_used_previous_name: "No" }).visible, state("previous_names", { oci_minor_used_previous_name: "Yes" }).required, state("doc_name_change", { oci_minor_used_previous_name: "Yes" }).required], [false, true, true]);
  assert.deepEqual([state("doc_previous_indian_visa", { oci_minor_previous_indian_visa: "No" }).visible, state("doc_previous_indian_visa", { oci_minor_previous_indian_visa: "Yes" }).required], [false, true]);
  assert.equal(state("doc_us_address_proof").required, true);
  assert.equal(state("doc_native_address_proof", { oci_minor_current_nationality: "United States" }).visible, false);
  assert.equal(state("doc_native_address_proof", { oci_minor_current_nationality: "Canada" }).required, true);
  const dual = { oci_minor_current_nationality: "Canada", oci_minor_dual_citizen: "Yes" };
  assert.deepEqual([state("dual_citizen_countries", dual).required, state("doc_native_address_proof_second", dual).required, state("doc_native_address_proof_second", { ...dual, oci_minor_dual_citizen: "No" }).visible], [true, true, false]);
  assert.deepEqual([state("prior_oci_applications", { oci_minor_prior_oci_applied: "No" }).visible, state("prior_oci_applications", { oci_minor_prior_oci_applied: "Yes" }).required], [false, true]);
  assert.equal(q("prior_oci_applications").metadata.fields.length, 6);
  assert.deepEqual([state("oci_surrender_details", { oci_minor_oci_surrendered_or_cancelled: "No" }).visible, state("oci_surrender_details", { oci_minor_oci_surrendered_or_cancelled: "Yes" }).required], [false, true]);
  assert.deepEqual([q("relatives_in_india").repeatable, q("relatives_in_india").metadata.fields.length], [true, 4]);
});
