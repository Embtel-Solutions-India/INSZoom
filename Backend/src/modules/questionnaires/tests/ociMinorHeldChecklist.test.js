// OCI - Minor Foreign citizen and held Indian passport (5th / last Indian Timeline subtype): registration, isolation, no forms / mappings, all questions always shown, core required, situational optional.
const test = require("node:test");
const assert = require("node:assert/strict");
const { OCI_MINOR_HELD_CHECKLIST_DEFINITIONS, CHECKLIST_KEY, INSTRUCTIONS } = require("../ociMinorHeldChecklist");
const { OCI_CHECKLIST_DEFINITIONS } = require("../ociChecklists");
const { OCI_BIRTH_CHECKLIST_DEFINITIONS } = require("../ociBirthChecklist");
const { OCI_MINOR_CHECKLIST_DEFINITIONS } = require("../ociMinorChecklist");
const { OCI_SPOUSE_CHECKLIST_DEFINITIONS } = require("../ociSpouseChecklist");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const definition = OCI_MINOR_HELD_CHECKLIST_DEFINITIONS[0];
const q = (name) => definition.questions.find((question) => question.key === `oci_minorheld_${name}`);
const client = { role: "client" };
const state = (name, answers = {}) => {
  const question = q(name);
  assert.ok(question, `${name} exists`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};
const a = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [`oci_minorheld_${k}`, v]));

test("fifth OCI subtype: own checklist, client role, not a default, no forms, no canonical paths; the other four are untouched", () => {
  assert.equal(definition.key, CHECKLIST_KEY);
  assert.equal(definition.title, "Minor Foreign citizen and held Indian passport");
  assert.equal(definition.visaType, "OCI");
  assert.equal(definition.checklistRole, "client");
  assert.equal(definition.isDefault, false);
  for (const line of INSTRUCTIONS) assert.ok(definition.description.includes(line), line);
  for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  const filing = filingTypes.getFilingType("OCI_MINOR_FOREIGN_CITIZEN_HELD");
  assert.deepEqual([filing.visaType, filing.questionnaireKey], ["OCI", CHECKLIST_KEY]);
  assert.ok(!filingTypes.groupedForSelection().standalone.some((entry) => entry.key === filing.key));
  assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === CHECKLIST_KEY).length, 1);
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "OCI").length, 0);
  assert.equal(visaCategories.VISA_CATEGORIES.OCI.subTypes.length, 6);
  const others = [OCI_CHECKLIST_DEFINITIONS[0], OCI_BIRTH_CHECKLIST_DEFINITIONS[0], OCI_MINOR_CHECKLIST_DEFINITIONS[0], OCI_SPOUSE_CHECKLIST_DEFINITIONS[0]];
  assert.equal(others[0].questions.length, 43);
  const otherKeys = new Set(others.flatMap((item) => item.questions.map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => otherKeys.has(question.key)), "no question key is shared with the other subtypes");
  assert.equal(new Set(["OCI_ADULT_FORMER_INDIAN_PASSPORT", "OCI_ADULT_FOREIGN_CITIZEN_BY_BIRTH", "OCI_MINOR_FOREIGN_CITIZEN_NEVER_HELD", "OCI_SPOUSE_OF_FOREIGN_ORIGIN", "OCI_MINOR_FOREIGN_CITIZEN_HELD"].map((k) => filingTypes.getFilingType(k).questionnaireKey)).size, 5, "five distinct checklists");
});

test("questionnaire fields and exactly the 15 supplied document requirements are present", () => {
  for (const name of ["full_name", "phone", "distinguishing_mark", "root_ancestor_relationship", "country_of_birth", "place_of_birth", "current_nationality", "is_student", "institution_name", "institution_address", "institution_phone", "father_name", "father_nationality", "father_occupation", "mother_name", "mother_nationality", "mother_occupation", "prior_oci_applied", "prior_oci_applications", "oci_surrendered_or_cancelled", "oci_surrender_details", "relatives_in_india"]) assert.ok(q(name), `${name} exists`);
  for (const absent of ["marital_status", "current_occupation", "spouse_name"]) assert.equal(q(absent), undefined);
  assert.equal(q("root_ancestor_relationship").type, "text");
  assert.equal(q("root_ancestor_other"), undefined);
  assert.equal(state("distinguishing_mark").required, false);
  assert.equal(state("relatives_in_india").required, false);
});

test("the Required Documents section lists exactly the 15 supplied requirements, in order, one item each, all always shown", () => {
  const docs = definition.questions.filter((question) => question.sectionKey === "required_documents");
  assert.deepEqual(docs.map((question) => question.label), [
    "Digital Photograph & Signature", "Physical Photographs", "Current Valid Passport", "Copy of Indian passport", "Copy of Naturalization Certificate", "Copy of Surrender Certificate",
    "Copy of Birth Certificate", "Legal Status in USA (Non-US Passport Holders)", "Proof of Name Change", "Copy of current passport of the Parents", "Copy of Marriage Certificate of Parents",
    "Parents' OCI Cards", "Previous Indian Visa", "Proof of USA Address", "Native Address Proof (Non-US Nationals)",
  ]);
  assert.equal(docs.length, 15);
  for (const question of docs) assert.deepEqual(state(question.key.replace("oci_minorheld_", "")), { visible: true, required: question.required }, `${question.label} is always shown`);
  assert.deepEqual([state("doc_legal_status_usa", a({ current_nationality: "United States" })), state("doc_legal_status_usa", a({ current_nationality: "Canada" }))], [{ visible: true, required: false }, { visible: true, required: false }], "Legal Status is always shown, optional");
  assert.equal(q("physical_photos_ack").type, "radio", "the physical photographs are an acknowledgement, not an upload");
  for (const question of docs.filter((item) => item.key !== "oci_minorheld_physical_photos_ack")) assert.equal(question.type, "file", question.label);
  assert.equal(definition.questions.filter((question) => question.type === "file").length, 14);
  const required = docs.filter((question) => question.required).map((question) => question.label);
  assert.deepEqual(required, ["Digital Photograph & Signature", "Physical Photographs", "Current Valid Passport", "Copy of Indian passport", "Copy of Naturalization Certificate", "Copy of current passport of the Parents", "Copy of Marriage Certificate of Parents", "Proof of USA Address"]);
  assert.match(q("doc_photo_signature").description, /Part 1: Photograph Requirements[\s\S]*Part 2: Signature Requirements[\s\S]*left thumb impression/);
  assert.match(q("doc_birth_certificate").description, /apostilled[\s\S]*VFS or Consulate/);
  assert.match(q("doc_parents_marriage_certificate").description, /Marriage Registrar[\s\S]*religious body[\s\S]*divorce decree[\s\S]*death certificate/);
  assert.match(q("doc_us_address_proof").description, /under 3 months old/);
});

test("no show-when rules: every question is visible with no answers; exact required list; exact labels and hints of the supplied checklist", () => {
  assert.equal(definition.questions.length, 37);
  for (const question of definition.questions) {
    assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, `${question.key} has no show-when rule`);
    assert.equal(isQuestionVisible(question, {}, client), true, `${question.key} visible with no answers`);
  }
  const required = definition.questions.filter((question) => question.required).map((question) => question.key.replace("oci_minorheld_", "")).sort();
  assert.deepEqual(required, ["current_nationality", "country_of_birth", "doc_current_passport", "doc_last_indian_passport", "doc_naturalization_certificate", "doc_parents_marriage_certificate", "doc_parents_passports", "doc_photo_signature", "doc_us_address_proof", "father_name", "father_nationality", "full_name", "is_student", "mother_name", "mother_nationality", "oci_surrendered_or_cancelled", "phone", "physical_photos_ack", "place_of_birth", "prior_oci_applied", "root_ancestor_relationship"].sort());
  for (const name of ["institution_name", "institution_address", "institution_phone", "father_occupation", "mother_occupation", "prior_oci_applications", "oci_surrender_details", "relatives_in_india", "distinguishing_mark", "doc_legal_status_usa"]) assert.equal(state(name).required, false, name);
  const sections = definition.sections;
  assert.ok(sections.includes("D. Prior OCI History and Relatives in India") && !sections.some((name) => name.startsWith("C.")), "lettered D, there is no C");
  assert.deepEqual(q("prior_oci_applications").metadata.fields.map((f) => f.label), ["Name / Relationship", "Reference no.", "Date when applied (DD/MM/YYYY)", "Place where applied", "Status"]);
  assert.deepEqual(q("relatives_in_india").metadata.fields.map((f) => f.label), ["Relative Name", "Relationship", "Age", "Present Address in India"]);
  assert.equal(q("relatives_in_india").label, "Details of family members / relatives currently residing in India (if any)");
  assert.equal(q("root_ancestor_relationship").description, "e.g., Self / Father / Mother / Grandparent");
});
