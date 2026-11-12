// Adult Foreign citizen and held Indian passport (Indian Timeline Cases): single-person, no forms, no canonical mappings; conditional document / questionnaire rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const { OCI_CHECKLIST_DEFINITIONS, CHECKLIST_KEY, INSTRUCTIONS } = require("../ociChecklists");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = OCI_CHECKLIST_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `oci_adult_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};

test("registered as a single-person OCI subtype: client role, not a default, no forms, no canonical paths", () => {
  assert.equal(definition.key, CHECKLIST_KEY);
  assert.equal(definition.visaType, "OCI");
  assert.equal(definition.checklistRole, "client");
  assert.equal(definition.isDefault, false, "never handed to another OCI subtype automatically");
  assert.equal(definition.title, "Adult Foreign citizen and held Indian passport");
  for (const line of INSTRUCTIONS) assert.ok(definition.description.includes(line), line);
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  const filing = filingTypes.getFilingType("OCI_ADULT_FORMER_INDIAN_PASSPORT");
  assert.equal(filing.visaType, "OCI");
  assert.equal(filing.questionnaireKey, CHECKLIST_KEY);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key), "not offered in the status-change pickers");
  assert.equal(visaCategories.getCaseStructure("OCI"), "single");
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "OCI").length, 0, "no USCIS forms");
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1, "registered exactly once");
});

test("all required questionnaire fields and document categories are present", () => {
  for (const name of ["full_name", "phone", "marital_status", "distinguishing_mark", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "father_name", "father_nationality", "father_occupation", "mother_name", "mother_nationality", "mother_occupation", "spouse_based_oci", "current_occupation", "prior_oci_applied", "oci_surrendered_or_cancelled", "relatives_in_india", "doc_digital_photo", "doc_signature", "physical_photos_ack", "doc_current_passport", "doc_last_indian_passport", "doc_us_address_proof", "doc_previous_indian_visa", "doc_name_change"]) assert.ok(q(name), name);
  assert.deepEqual(q("root_ancestor_relationship").options.map((o) => o.value), ["Self", "Father", "Mother", "Grandparent"]);
  assert.equal(state("distinguishing_mark").required, false);
  assert.equal(state("full_name").required, true);
  assert.equal(state("relatives_in_india").required, false);
  assert.equal(q("doc_digital_photo").type, "file");
  assert.equal(q("doc_signature").type, "file");
  assert.ok(/white background/i.test(q("doc_digital_photo").description) && /plain white sheet/i.test(q("doc_signature").description));
  assert.equal(q("physical_photos_ack").type, "radio", "physical photographs are an acknowledgement, never an upload");
});

test("naturalization: own certificate vs through parents; surrender certificate only from 2010", () => {
  const own = { oci_adult_naturalization_basis: "In my own right (I hold a naturalization certificate)" };
  const parents = { oci_adult_naturalization_basis: "Through my parents (no separate certificate)" };
  assert.deepEqual([state("doc_naturalization_certificate", own).required, state("doc_parents_affidavit", own).visible], [true, false]);
  assert.deepEqual([state("doc_naturalization_certificate", parents).visible, state("doc_parents_affidavit", parents).required, state("doc_parents_naturalization_certificates", parents).required], [false, true, true]);
  assert.equal(state("doc_surrender_certificate", { oci_adult_naturalization_year: 2009 }).visible, false);
  assert.equal(state("doc_surrender_certificate", { oci_adult_naturalization_year: 2010 }).required, true);
  assert.equal(state("doc_surrender_certificate", {}).visible, false);
});

test("legal status (non-US passport holders) and pending extension", () => {
  assert.equal(state("legal_status_document", { oci_adult_holds_us_passport: "Yes" }).visible, false);
  assert.equal(state("legal_status_document", { oci_adult_holds_us_passport: "No" }).required, true);
  const answers = { oci_adult_holds_us_passport: "No", oci_adult_legal_status_document: "Green Card" };
  assert.deepEqual([state("doc_green_card", answers).required, state("doc_ead", answers).visible, state("doc_long_term_visa", answers).visible], [true, false, false]);
  assert.equal(state("doc_extension_receipt", answers).visible, false);
  const pending = { ...answers, oci_adult_visa_extension_pending: "Yes" };
  assert.deepEqual([state("doc_extension_receipt", pending).required, state("doc_expired_visa", pending).required], [true, true]);
  assert.equal(state("doc_extension_receipt", { oci_adult_holds_us_passport: "Yes", oci_adult_visa_extension_pending: "Yes" }).visible, false);
});

test("marital status evidence", () => {
  const single = { oci_adult_marital_status: "Single / Never Married" };
  assert.deepEqual(["doc_marriage_certificate", "doc_divorce_decree", "doc_death_certificate", "doc_marital_affidavit"].map((n) => state(n, single).visible), [false, false, false, false]);
  assert.deepEqual([state("doc_marriage_certificate", { oci_adult_marital_status: "Married" }).required, state("doc_divorce_decree", { oci_adult_marital_status: "Married" }).visible], [true, false]);
  const remarried = { oci_adult_marital_status: "Married", oci_adult_remarried_after_divorce: "Yes" };
  assert.deepEqual([state("doc_divorce_decree", remarried).required, state("doc_marriage_certificate", remarried).required], [true, true]);
  assert.equal(state("doc_divorce_decree", { oci_adult_marital_status: "Divorced" }).required, true);
  assert.equal(state("doc_death_certificate", { oci_adult_marital_status: "Widowed" }).required, true);
  const unavailable = { oci_adult_marital_status: "Married", oci_adult_marital_certificate_unavailable: "Yes" };
  assert.deepEqual([state("doc_marital_affidavit", unavailable).required, state("doc_marriage_certificate", unavailable).visible], [true, false]);
});

test("spouse, employment, name change, previous visa, prior OCI and native address are conditional", () => {
  assert.equal(state("spouse_name", { oci_adult_marital_status: "Single / Never Married", oci_adult_spouse_based_oci: "No" }).visible, false);
  assert.equal(state("spouse_name", { oci_adult_marital_status: "Married" }).required, true);
  assert.equal(state("marriage_date", { oci_adult_marital_status: "Single / Never Married", oci_adult_spouse_based_oci: "Yes" }).required, true);
  assert.deepEqual([state("employer_name_address", { oci_adult_employment_situation: "Employed" }).required, state("employer_name_address", { oci_adult_employment_situation: "Retired" }).visible, state("retired_organization", { oci_adult_employment_situation: "Retired" }).required], [true, false, true]);
  const evidence = { Employed: "doc_employer_letter", "Self-employed / Business owner": "doc_self_employment", Retired: "doc_retirement_proof", Student: "doc_student_proof", "Never employed or self-employed": "doc_never_employed_statement" };
  for (const [situation] of Object.entries(evidence)) {
    for (const [other, otherDoc] of Object.entries(evidence)) assert.equal(state(otherDoc, { oci_adult_employment_situation: situation }).visible, other === situation, `${otherDoc} for ${situation}`);
  }
  assert.deepEqual([state("previous_names", { oci_adult_used_previous_name: "No" }).visible, state("doc_name_change", { oci_adult_used_previous_name: "Yes" }).required], [false, true]);
  assert.deepEqual([state("doc_previous_indian_visa", { oci_adult_previous_indian_visa: "No" }).visible, state("doc_previous_indian_visa", { oci_adult_previous_indian_visa: "Yes" }).required], [false, true]);
  assert.deepEqual([state("prior_oci_applications", { oci_adult_prior_oci_applied: "No" }).visible, state("prior_oci_applications", { oci_adult_prior_oci_applied: "Yes" }).required], [false, true]);
  assert.deepEqual([state("oci_surrender_details", { oci_adult_oci_surrendered_or_cancelled: "No" }).visible, state("oci_surrender_details", { oci_adult_oci_surrendered_or_cancelled: "Yes" }).required], [false, true]);
  assert.equal(state("doc_native_address_proof", { oci_adult_current_nationality: "United States" }).visible, false);
  assert.equal(state("doc_native_address_proof", { oci_adult_current_nationality: "Canada" }).required, true);
  assert.equal(state("doc_native_address_proof_second", { oci_adult_current_nationality: "Canada", oci_adult_dual_citizen: "No" }).visible, false);
  assert.deepEqual([state("dual_citizen_countries", { oci_adult_current_nationality: "Canada", oci_adult_dual_citizen: "Yes" }).required, state("doc_native_address_proof_second", { oci_adult_current_nationality: "Canada", oci_adult_dual_citizen: "Yes" }).required], [true, true]);
  assert.equal(q("prior_oci_applications").repeatable, true);
  assert.equal(q("relatives_in_india").repeatable, true);
  assert.equal(q("prior_oci_applications").metadata.fields.length, 6);
  assert.equal(q("relatives_in_india").metadata.fields.length, 4);
});
