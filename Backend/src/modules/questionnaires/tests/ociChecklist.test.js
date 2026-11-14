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

test("14 document items in the supplied order, one each; every question always visible; exact required list", () => {
  assert.equal(definition.questions.length, 43);
  const docs = definition.questions.filter((question) => question.sectionKey === "required_documents");
  assert.deepEqual(docs.map((question) => question.label), [
    "Digital Photograph & Signature", "Physical Photographs", "Current Valid Passport", "Copy of Indian passport", "Copy of Naturalization Certificate", "Copy of Surrender Certificate",
    "Legal Status in USA (Non-US Passport Holders)", "Proof of Marital Status", "Proof of Name Change", "Employment / Work Verification", "Parents' & Spouse OCI Cards", "Previous Indian Visa",
    "Proof of USA Address", "Native Address Proof (Non-US Nationals)",
  ]);
  assert.equal(q("physical_photos_ack").type, "radio", "physical photographs are an acknowledgement, never an upload");
  for (const question of docs.filter((item) => item.key !== "oci_adult_physical_photos_ack")) assert.equal(question.type, "file", question.label);
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, question.key + " has no show-when rule");
    assert.equal(isQuestionVisible(question, {}, client), true, question.key + " visible with no answers");
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("oci_adult_", "")).sort();
  assert.deepEqual(required, ["full_name", "phone", "marital_status", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "father_name", "father_nationality", "mother_name", "mother_nationality", "spouse_based_oci", "current_occupation", "prior_oci_applied", "oci_surrendered_or_cancelled", "doc_photo_signature", "physical_photos_ack", "doc_current_passport", "doc_last_indian_passport", "doc_naturalization_certificate", "doc_us_address_proof"].sort());
  for (const name of ["distinguishing_mark", "father_occupation", "mother_occupation", "spouse_name", "spouse_dob", "spouse_nationality", "spouse_occupation", "marriage_date", "employer_name_address", "employer_phone", "retired_organization", "prior_oci_applications", "oci_surrender_details", "relatives_in_india", "doc_surrender_certificate", "doc_legal_status_usa", "doc_marital_status_proof", "doc_name_change", "doc_employment_verification", "doc_parents_spouse_oci_cards", "doc_previous_indian_visa", "doc_native_address_proof"]) assert.equal(state(name).required, false, name);
});

test("the supplied labels, answer types and hints", () => {
  const type = (name) => q(name).type;
  assert.deepEqual([type("root_ancestor_relationship"), type("marital_status"), type("spouse_based_oci"), type("marriage_date"), type("employer_phone"), type("phone")], ["text", "select", "radio", "date", "phone", "phone"]);
  assert.equal(q("root_ancestor_relationship").description, "e.g., Self / Father / Mother / Grandparent");
  assert.equal(q("spouse_based_oci").label, "Are you applying OCI on the basis of an Indian Spouse/Spouse's OCI card?");
  assert.deepEqual(q("prior_oci_applications").metadata.fields.map((f) => f.label), ["Name / Relationship", "Reference no.", "Date when applied (DD/MM/YYYY)", "Place where applied", "Status"]);
  assert.deepEqual(q("relatives_in_india").metadata.fields.map((f) => f.label), ["Relative Name", "Relationship", "Age", "Present Address in India"]);
  assert.equal(q("relatives_in_india").label, "Details of family members / relatives currently residing in India (if any)");
  assert.match(q("doc_photo_signature").description, /Part 1: Photograph Requirements[\s\S]*Part 2: Signature Requirements/);
  assert.match(q("doc_naturalization_certificate").description, /notarized affidavit signed by both parents/);
  assert.match(q("doc_surrender_certificate").description, /naturalized from 2010 onwards/);
  assert.match(q("doc_marital_status_proof").description, /marriage certificate[\s\S]*divorce decree[\s\S]*Death certificate[\s\S]*notarized affidavit/);
  assert.match(q("doc_employment_verification").description, /employed[\s\S]*self-employed[\s\S]*retired[\s\S]*student[\s\S]*never been employed/);
  assert.match(q("doc_us_address_proof").description, /under 3 months old/);
});
