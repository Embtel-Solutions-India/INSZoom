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
  assert.equal(others[0].questions.length, 43);
  const otherKeys = new Set(others.flatMap((item) => item.questions.map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => otherKeys.has(question.key)), "no question key is shared with the other subtypes");
});

test("questionnaire fields: the supplied questions, with the supplied answer types", () => {
  const type = (name) => q(name).type;
  assert.deepEqual([type("full_name"), type("phone"), type("distinguishing_mark"), type("root_ancestor_relationship"), type("place_of_birth")], ["text", "phone", "text", "text", "text"]);
  assert.equal(q("root_ancestor_relationship").description, "e.g., Self / Father / Mother / Grandparent");
  for (const name of ["father_name", "father_occupation", "mother_name", "mother_occupation", "spouse_name", "spouse_passport_number", "spouse_passport_place", "spouse_occupation", "current_occupation", "retired_organization"]) assert.equal(type(name), "text", name);
  for (const name of ["spouse_dob", "spouse_passport_issue", "spouse_passport_expiry", "spouse_oci_issue", "marriage_date"]) assert.equal(type(name), "date", name);
  for (const name of ["spouse_address", "employer_name_address"]) assert.equal(type(name), "textarea", name);
  assert.equal(type("employer_phone"), "phone");
  for (const name of ["spouse_based_oci", "marriage_registered", "marriage_apostilled", "marriage_subsisting", "multiple_living_spouses", "spouse_other_living_spouse", "prior_oci_applied", "oci_surrendered_or_cancelled"]) assert.deepEqual(q(name).options.map((o) => o.value), ["Yes", "No"], name);
  assert.deepEqual(q("marriage_location").options.map((o) => o.value), ["India", "Abroad"]);
  // nothing that is not in the supplied list
  for (const absent of ["spouse_category", "employment_situation", "birth_certificate_issued_country", "birth_certificate_authentication", "ancestors", "holds_us_passport", "dual_citizen", "used_previous_name", "previous_indian_visa", "marriage_certificate_not_english"]) assert.equal(q(absent), undefined, `${absent} is not asked`);
  assert.equal(definition.questions.length, 58);
});

test("no show-when rules: every question visible with no answers; exact required list; exact labels", () => {
  assert.equal(definition.questions.length, 58);
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, question.key + " has no show-when rule");
    assert.equal(isQuestionVisible(question, {}, client), true, question.key + " visible with no answers");
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("oci_spouse_", "")).sort();
  assert.deepEqual(required, ["full_name", "phone", "marital_status", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "father_name", "father_nationality", "mother_name", "mother_nationality", "spouse_based_oci", "spouse_name", "spouse_dob", "spouse_passport_number", "spouse_passport_issue", "spouse_passport_expiry", "spouse_passport_place", "spouse_address", "spouse_nationality", "spouse_occupation", "marriage_date", "marriage_location", "marriage_subsisting", "multiple_living_spouses", "spouse_other_living_spouse", "current_occupation", "prior_oci_applied", "oci_surrendered_or_cancelled", "doc_photo_signature", "physical_photos_ack", "doc_current_passport", "doc_birth_certificate", "doc_ancestors_birth_certificates", "doc_marriage_certificate", "doc_spouse_documents", "doc_us_address_proof"].sort());
  for (const name of ["father_occupation", "mother_occupation", "spouse_oci_number", "spouse_oci_issue", "spouse_oci_place", "marriage_registered", "marriage_apostilled", "multiple_spouses", "spouse_other_spouses", "employer_name_address", "employer_phone", "retired_organization", "prior_oci_applications", "oci_surrender_details", "relatives_in_india", "distinguishing_mark"]) assert.equal(state(name).required, false, name);
  assert.equal(q("multiple_spouses").metadata.fields.length, 4);
  assert.deepEqual(q("prior_oci_applications").metadata.fields.map((f) => f.label), ["Name / Relationship", "Reference no.", "Date when applied (DD/MM/YYYY)", "Place where applied", "Status"]);
  assert.equal(q("marriage_location").label, "Whether married in India or abroad / outside India?");
  assert.equal(q("marriage_subsisting").label, "Whether marriage still subsisting?");
  assert.equal(q("multiple_living_spouses").label, "Whether you have more than one living spouse?");
  assert.equal(q("spouse_other_living_spouse").label, "Whether your spouse has any other living spouse?");
  assert.equal(q("relatives_in_india").label, "Details of family members / relatives currently residing in India (if any)");
});

test("the Required Documents section lists exactly the 13 supplied requirements, in order, one item each", () => {
  const docs = definition.questions.filter((question) => question.sectionKey === "required_documents");
  assert.deepEqual(docs.map((question) => question.label), [
    "Digital Photograph & Signature", "Physical Photographs", "Current Valid Passport", "Copy of Birth Certificate of applicant (Apostille)",
    "Copy of Birth certificate of applicant's parents or grandparents or great grandparents (Apostille)", "Copy of Marriage certificate",
    "In the case of spouse of an OCI Cardholder / In the case of Spouse of an Indian passport holder", "Legal Status in USA (Non-US Passport Holders)", "Proof of Name Change",
    "Copy of Employment / Work letter", "Previous Indian Visa", "Proof of USA Address", "Native Address Proof (Non-US Nationals)",
  ]);
  assert.equal(q("physical_photos_ack").type, "radio");
  for (const question of docs.filter((item) => item.key !== "oci_spouse_physical_photos_ack")) assert.equal(question.type, "file", question.label);
  assert.match(q("doc_photo_signature").description, /Part 1: Photograph Requirements[\s\S]*Part 2: Signature Requirements/);
  assert.match(q("doc_marriage_certificate").description, /Marriage Registrar[\s\S]*apostilled[\s\S]*translated in English/);
  assert.match(q("doc_employment_letter").description, /employed[\s\S]*self-employed[\s\S]*retired[\s\S]*student[\s\S]*never been employed/);
  // statuses: core documents required; the "may be provided / if ever obtained" ones optional
  for (const name of ["doc_photo_signature", "physical_photos_ack", "doc_current_passport", "doc_birth_certificate", "doc_ancestors_birth_certificates", "doc_marriage_certificate", "doc_us_address_proof"]) assert.equal(state(name).required, true, name);
  for (const name of ["doc_legal_status_usa", "doc_name_change", "doc_employment_letter", "doc_previous_indian_visa", "doc_native_address_proof"]) assert.deepEqual(state(name), { visible: true, required: false }, name);
  // the spouse documents are always shown and required; the legal-status document is always shown and optional (explicit passport opt-out)
  assert.deepEqual(state("doc_spouse_documents"), { visible: true, required: true });
  assert.deepEqual(state("doc_legal_status_usa"), { visible: true, required: false });
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

