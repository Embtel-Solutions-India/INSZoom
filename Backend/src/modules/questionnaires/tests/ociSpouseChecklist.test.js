// OCI - Spouse of Foreign Origin (4th Indian Timeline subtype): registration, isolation from the other three, no forms / mappings, spouse / marriage rules, staff-review flags.
const test = require("node:test");
const assert = require("node:assert/strict");
const { OCI_SPOUSE_CHECKLIST_DEFINITIONS, CHECKLIST_KEY, INSTRUCTIONS } = require("../ociSpouseChecklist");
const { OCI_CHECKLIST_DEFINITIONS } = require("../ociChecklists");
const { OCI_BIRTH_CHECKLIST_DEFINITIONS } = require("../ociBirthChecklist");
const { OCI_MINOR_CHECKLIST_DEFINITIONS } = require("../ociMinorChecklist");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");

const { isQuestionVisible, isQuestionRequired, validateQuestionValue, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = OCI_SPOUSE_CHECKLIST_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `oci_spouse_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const a = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [`oci_spouse_${k}`, v]));

test("fourth OCI subtype: own checklist, client role, not a default, no forms, no canonical paths; the other three are untouched", () => {
  assert.equal(definition.key, CHECKLIST_KEY);
  assert.equal(definition.visaType, "OCI");
  assert.equal(definition.checklistRole, "client");
  assert.equal(definition.isDefault, false);
  for (const line of INSTRUCTIONS) assert.ok(definition.description.includes(line), line);
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  const filing = filingTypes.getFilingType("OCI_SPOUSE_OF_FOREIGN_ORIGIN");
  assert.deepEqual([filing.visaType, filing.questionnaireKey], ["OCI", CHECKLIST_KEY]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key));
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1);
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "OCI").length, 0);
  const others = [OCI_CHECKLIST_DEFINITIONS[0], OCI_BIRTH_CHECKLIST_DEFINITIONS[0], OCI_MINOR_CHECKLIST_DEFINITIONS[0]];
  assert.deepEqual(others.map((item) => item.key), ["oci_adult_former_indian_passport_checklist", "oci_adult_foreign_citizen_by_birth_checklist", "oci_minor_foreign_citizen_never_held_passport_checklist"]);
  assert.equal(others[0].questions.length, 73);
  const otherKeys = new Set(others.flatMap((item) => item.questions.map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => otherKeys.has(question.key)), "no question key is shared with the other subtypes");
});

test("every supplied field and document item is present", () => {
  for (const name of ["full_name", "phone", "marital_status", "distinguishing_mark", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "father_name", "father_nationality", "father_occupation", "mother_name", "mother_nationality", "mother_occupation",
    "spouse_based_oci", "spouse_category", "spouse_name", "spouse_dob", "spouse_passport_number", "spouse_passport_issue", "spouse_passport_expiry", "spouse_passport_place", "spouse_address", "spouse_oci_number", "spouse_oci_issue", "spouse_oci_place", "spouse_nationality", "spouse_occupation", "marriage_date", "marriage_location", "marriage_registered", "marriage_apostilled", "marriage_subsisting", "multiple_living_spouses", "multiple_spouses", "spouse_other_living_spouse", "spouse_other_spouses",
    "current_occupation", "prior_oci_applied", "oci_surrendered_or_cancelled", "relatives_in_india",
    "doc_digital_photo", "doc_signature", "physical_photos_ack", "doc_current_passport", "doc_birth_certificate", "birth_certificate_issued_country", "ancestor_birth_certificates", "doc_ancestor_birth_certificates", "doc_marriage_certificate", "doc_marriage_translation", "doc_spouse_oci_card", "doc_spouse_indian_passport", "legal_status_document", "doc_name_change", "doc_employer_letter", "doc_previous_indian_visa", "doc_us_address_proof", "doc_native_address_proof"]) assert.ok(q(name), name);
  assert.deepEqual(q("spouse_category").options.map((o) => o.value), ["Indian passport holder", "OCI cardholder"]);
  assert.deepEqual(q("marriage_location").options.map((o) => o.value), ["India", "Abroad"]);
  assert.deepEqual(q("root_ancestor_relationship").options.map((o) => o.value), ["Self", "Father", "Mother", "Grandparent", "Great-grandparent"]);
  assert.equal(q("physical_photos_ack").type, "radio");
});

test("spouse category: OCI fields and evidence only for an OCI cardholder; Indian-passport evidence only for an Indian passport holder; passport details for both", () => {
  const oci = a({ spouse_category: "OCI cardholder" });
  const indian = a({ spouse_category: "Indian passport holder" });
  const ociOnly = ["spouse_oci_number", "spouse_oci_issue", "spouse_oci_place", "doc_spouse_oci_passport", "doc_spouse_oci_card", "doc_spouse_oci_basis_documents"];
  const indianOnly = ["doc_spouse_indian_passport", "doc_spouse_legal_status"];
  assert.deepEqual(ociOnly.map((n) => state(n, {}).visible), ociOnly.map(() => false));
  assert.deepEqual(ociOnly.map((n) => state(n, oci).required), ociOnly.map(() => true));
  assert.deepEqual(ociOnly.map((n) => state(n, indian).visible), ociOnly.map(() => false));
  assert.deepEqual(indianOnly.map((n) => state(n, oci).visible), [false, false]);
  assert.deepEqual(indianOnly.map((n) => state(n, indian).required), [true, false], "the legal-status document is 'where applicable'");
  for (const answers of [oci, indian]) for (const n of ["spouse_name", "spouse_dob", "spouse_passport_number", "spouse_passport_issue", "spouse_passport_expiry", "spouse_passport_place", "spouse_address", "spouse_nationality", "spouse_occupation", "marriage_date"]) assert.equal(state(n, answers).required, true, n);
});

test("marriage location: registration question for India, apostille question for abroad - never both; the certificate is always required, translation only when not in English", () => {
  assert.deepEqual([state("marriage_registered", a({ marriage_location: "India" })).required, state("marriage_apostilled", a({ marriage_location: "India" })).visible], [true, false]);
  assert.deepEqual([state("marriage_apostilled", a({ marriage_location: "Abroad" })).required, state("marriage_registered", a({ marriage_location: "Abroad" })).visible], [true, false]);
  assert.deepEqual([state("marriage_registered", {}).visible, state("marriage_apostilled", {}).visible], [false, false]);
  assert.equal(state("doc_marriage_certificate", {}).required, true);
  assert.ok(/Marriage Registrar/.test(q("doc_marriage_certificate").description) && /religious body/.test(q("doc_marriage_certificate").description));
  assert.equal(state("doc_marriage_translation", a({ marriage_certificate_not_english: "No" })).visible, false);
  assert.equal(state("doc_marriage_translation", a({ marriage_certificate_not_english: "Yes" })).required, true);
});

test("multiple-spouse groups appear only on Yes; OCI card number in a record is optional (N/A)", () => {
  assert.deepEqual([state("multiple_spouses", a({ multiple_living_spouses: "No" })).visible, state("multiple_spouses", a({ multiple_living_spouses: "Yes" })).required], [false, true]);
  assert.deepEqual([state("spouse_other_spouses", a({ spouse_other_living_spouse: "No" })).visible, state("spouse_other_spouses", a({ spouse_other_living_spouse: "Yes" })).required], [false, true]);
  for (const name of ["multiple_spouses", "spouse_other_spouses"]) {
    const fields = q(name).metadata.fields;
    assert.equal(fields.length, 4);
    assert.deepEqual(fields.map((f) => f.required), [true, true, true, false], `${name}: the OCI card number is only for someone who holds one`);
  }
});

test("applicant's birth certificate: country of ISSUANCE asked; authentication only when issued outside India", () => {
  assert.equal(state("birth_certificate_issued_country", {}).required, true);
  assert.equal(state("birth_certificate_authentication", {}).visible, false);
  assert.equal(state("birth_certificate_authentication", a({ birth_certificate_issued_country: "India" })).visible, false);
  assert.equal(state("birth_certificate_authentication", a({ birth_certificate_issued_country: "Canada", country_of_birth: "India" })).required, true, "issuance, not birth country, decides");
  assert.equal(q("birth_certificate_authentication").options.length, 2);
});

test("ancestors' birth certificates: several lineage records + uploads", () => {
  assert.equal(q("ancestor_birth_certificates").repeatable, true);
  assert.equal(state("ancestor_birth_certificates").required, true);
  assert.equal(q("ancestor_birth_certificates").metadata.fields.length, 4);
  assert.equal(state("doc_ancestor_birth_certificates").required, true);
  assert.equal(state("doc_ancestor_authentication_evidence").required, false);
});

test("staff-review flags and the marital-status warning (nothing decides eligibility)", () => {
  const flags = (name) => (q(name).metadata.staffReview || []);
  assert.equal(flags("marital_status")[0].operator, "not_equals");
  assert.equal(flags("spouse_based_oci")[0].value, "No");
  assert.equal(flags("marriage_subsisting")[0].value, "No");
  assert.equal(flags("multiple_living_spouses")[0].value, "Yes");
  assert.equal(flags("spouse_other_living_spouse")[0].value, "Yes");
  // the client's marital-status answer other than Married is only a (non-blocking) warning
  const married = validateQuestionValue(q("marital_status"), "Married");
  const single = validateQuestionValue(q("marital_status"), "Single / Never Married");
  assert.deepEqual([married.errors.length, married.warnings.length], [0, 0]);
  assert.deepEqual([single.errors.length, single.warnings.length], [0, 1]);
  // dates: a spouse's date of birth in the future is an error
  assert.equal(validateQuestionValue(q("spouse_dob"), "2999-01-01").errors.length, 1);
  assert.equal(validateQuestionValue(q("spouse_dob"), "1990-01-01").errors.length, 0);
});

test("employment, legal status, name change, previous visa, address proofs, prior OCI, surrender, relatives", () => {
  assert.deepEqual([state("employer_name_address", a({ employment_situation: "Employed" })).required, state("employer_name_address", a({ employment_situation: "Student" })).visible, state("retired_organization", a({ employment_situation: "Retired" })).required], [true, false, true]);
  const evidence = { Employed: "doc_employer_letter", "Self-employed / Business owner": "doc_self_employment", Retired: "doc_retirement_proof", Student: "doc_student_proof", "Never employed or self-employed": "doc_never_employed_statement" };
  for (const situation of Object.keys(evidence)) for (const [other, doc] of Object.entries(evidence)) assert.equal(state(doc, a({ employment_situation: situation })).visible, other === situation, `${doc}/${situation}`);
  assert.equal(state("legal_status_document", a({ holds_us_passport: "Yes" })).visible, false);
  const green = a({ holds_us_passport: "No", legal_status_document: "Green Card" });
  assert.deepEqual([state("doc_green_card", green).required, state("doc_ead", green).visible, state("doc_extension_receipt", green).visible], [true, false, false]);
  assert.deepEqual([state("doc_extension_receipt", { ...green, ...a({ visa_extension_pending: "Yes" }) }).required, state("doc_expired_visa", { ...green, ...a({ visa_extension_pending: "Yes" }) }).required], [true, true]);
  assert.deepEqual([state("previous_names", a({ used_previous_name: "No" })).visible, state("doc_name_change", a({ used_previous_name: "Yes" })).required], [false, true]);
  assert.deepEqual([state("doc_previous_indian_visa", a({ previous_indian_visa: "No" })).visible, state("doc_previous_indian_visa", a({ previous_indian_visa: "Yes" })).required], [false, true]);
  assert.equal(state("doc_us_address_proof").required, true);
  assert.equal(state("doc_native_address_proof", a({ current_nationality: "United States" })).visible, false);
  assert.equal(state("doc_native_address_proof", a({ current_nationality: "Canada" })).required, true);
  const dual = a({ current_nationality: "Canada", dual_citizen: "Yes" });
  assert.deepEqual([state("dual_citizen_countries", dual).required, state("doc_native_address_proof_second", dual).required], [true, true]);
  assert.deepEqual([state("prior_oci_applications", a({ prior_oci_applied: "No" })).visible, state("prior_oci_applications", a({ prior_oci_applied: "Yes" })).required], [false, true]);
  assert.deepEqual([state("oci_surrender_details", a({ oci_surrendered_or_cancelled: "No" })).visible, state("oci_surrender_details", a({ oci_surrendered_or_cancelled: "Yes" })).required], [false, true]);
  assert.deepEqual([q("relatives_in_india").repeatable, state("relatives_in_india").required, q("relatives_in_india").metadata.fields.length], [true, false, 4]);
});
