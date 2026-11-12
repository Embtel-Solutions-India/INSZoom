// OCI - Minor Foreign citizen and held Indian passport (5th / last Indian Timeline subtype): registration, isolation, no forms / mappings, conditional rules.
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
  assert.equal(visaCategories.VISA_CATEGORIES.OCI.subTypes.length, 5);
  const others = [OCI_CHECKLIST_DEFINITIONS[0], OCI_BIRTH_CHECKLIST_DEFINITIONS[0], OCI_MINOR_CHECKLIST_DEFINITIONS[0], OCI_SPOUSE_CHECKLIST_DEFINITIONS[0]];
  assert.equal(others[0].questions.length, 73);
  const otherKeys = new Set(others.flatMap((item) => item.questions.map((question) => question.key)));
  assert.ok(!definition.questions.some((question) => otherKeys.has(question.key)), "no question key is shared with the other subtypes");
  assert.equal(new Set(["OCI_ADULT_FORMER_INDIAN_PASSPORT", "OCI_ADULT_FOREIGN_CITIZEN_BY_BIRTH", "OCI_MINOR_FOREIGN_CITIZEN_NEVER_HELD", "OCI_SPOUSE_OF_FOREIGN_ORIGIN", "OCI_MINOR_FOREIGN_CITIZEN_HELD"].map((k) => filingTypes.getFilingType(k).questionnaireKey)).size, 5, "five distinct checklists");
});

test("questionnaire fields and the 15 document categories are present", () => {
  for (const name of ["full_name", "phone", "distinguishing_mark", "root_ancestor_relationship", "root_ancestor_other", "country_of_birth", "place_of_birth", "current_nationality", "is_student", "institution_name", "institution_address", "institution_phone", "father_name", "father_nationality", "father_occupation", "mother_name", "mother_nationality", "mother_occupation", "prior_oci_applied", "prior_oci_applications", "oci_surrendered_or_cancelled", "oci_surrender_details", "relatives_in_india",
    "doc_digital_photo", "can_sign", "doc_signature", "doc_thumb_impression", "physical_photos_ack", "doc_current_passport", "doc_last_indian_passport", "doc_naturalization_certificate", "doc_parents_affidavit", "doc_parents_naturalization_certificates", "doc_surrender_certificate", "doc_birth_certificate", "legal_status_document", "doc_name_change", "doc_father_passport", "doc_mother_passport", "doc_parents_marriage_certificate", "doc_parents_divorce_decree", "doc_parent_death_certificate", "doc_father_oci_card", "doc_mother_oci_card", "doc_previous_indian_visa", "doc_us_address_proof", "doc_native_address_proof"]) assert.ok(q(name), name);
  for (const absent of ["marital_status", "current_occupation", "spouse_name"]) assert.equal(q(absent), undefined);
  assert.deepEqual(q("root_ancestor_relationship").options.map((o) => o.value), ["Self", "Father", "Mother", "Grandparent", "Great-grandparent", "Other"]);
  assert.equal(state("root_ancestor_other", a({ root_ancestor_relationship: "Father" })).visible, false);
  assert.equal(state("root_ancestor_other", a({ root_ancestor_relationship: "Other" })).required, true);
  assert.equal(state("distinguishing_mark").required, false);
  assert.equal(state("relatives_in_india").required, false);
  assert.equal(q("physical_photos_ack").type, "radio");
  assert.notEqual(q("doc_last_indian_passport"), undefined);
  assert.equal(state("doc_last_indian_passport").required, true);
  assert.equal(state("doc_current_passport").required, true);
});

test("photograph always required; signature xor left thumb impression", () => {
  assert.equal(state("doc_digital_photo", a({ can_sign: "No" })).required, true);
  assert.deepEqual([state("doc_signature", {}).visible, state("doc_thumb_impression", {}).visible], [false, false]);
  assert.deepEqual([state("doc_signature", a({ can_sign: "Yes" })).required, state("doc_thumb_impression", a({ can_sign: "Yes" })).visible], [true, false]);
  assert.deepEqual([state("doc_thumb_impression", a({ can_sign: "No" })).required, state("doc_signature", a({ can_sign: "No" })).visible], [true, false]);
});

test("naturalization certificate vs the parents' alternative; surrender certificate with a known / unknown year", () => {
  assert.deepEqual([state("doc_naturalization_certificate", {}).required, state("doc_parents_affidavit", {}).visible], [true, false]);
  assert.deepEqual([state("doc_naturalization_certificate", a({ naturalized_through_parents: "No" })).required, state("doc_parents_affidavit", a({ naturalized_through_parents: "No" })).visible], [true, false]);
  const parents = a({ naturalized_through_parents: "Yes" });
  assert.deepEqual([state("doc_naturalization_certificate", parents).visible, state("doc_parents_affidavit", parents).required, state("doc_parents_naturalization_certificates", parents).required], [false, true, true], "the alternative replaces the personal certificate");
  assert.deepEqual([state("doc_surrender_certificate", a({ naturalization_year: 2009 })).visible, state("doc_surrender_certificate", a({ naturalization_year: 2010 })).required, state("doc_surrender_certificate", a({ naturalization_year: 2024 })).required], [false, true, true]);
  const unknown = state("doc_surrender_certificate", {});
  assert.deepEqual([unknown.visible, unknown.required], [true, false], "an unknown year is never silently treated as 'not needed' - it stays visible for staff, and is not forced");
});

test("birth certificate: for an applicant born outside India (the documented ambiguity: nothing is asked of one born in India)", () => {
  const ids = ["doc_birth_certificate", "birth_certificate_authentication", "doc_birth_certificate_self_attested"];
  assert.deepEqual(ids.map((n) => state(n, {}).visible), [false, false, false]);
  assert.deepEqual(ids.map((n) => state(n, a({ country_of_birth: "India" })).visible), [false, false, false]);
  for (const c of ["United States", "Canada"]) assert.deepEqual(ids.map((n) => state(n, a({ country_of_birth: c })).required), [true, true, true]);
  assert.equal(q("birth_certificate_authentication").options.length, 2);
  assert.ok(/VFS/.test(q("doc_birth_certificate_self_attested").description));
});

test("student details, name change, previous visa, prior OCI, surrender, relatives", () => {
  for (const name of ["institution_name", "institution_address", "institution_phone"]) assert.deepEqual([state(name, a({ is_student: "No" })).visible, state(name, a({ is_student: "Yes" })).required], [false, true]);
  assert.deepEqual([state("previous_names", a({ used_previous_name: "No" })).visible, state("previous_names", a({ used_previous_name: "Yes" })).required, state("doc_name_change", a({ used_previous_name: "Yes" })).required], [false, true, true]);
  assert.deepEqual([state("doc_previous_indian_visa", a({ previous_indian_visa: "No" })).visible, state("doc_previous_indian_visa", a({ previous_indian_visa: "Yes" })).required], [false, true]);
  assert.deepEqual([state("prior_oci_applications", a({ prior_oci_applied: "No" })).visible, state("prior_oci_applications", a({ prior_oci_applied: "Yes" })).required], [false, true]);
  assert.equal(q("prior_oci_applications").metadata.fields.length, 5);
  assert.deepEqual([state("oci_surrender_details", a({ oci_surrendered_or_cancelled: "No" })).visible, state("oci_surrender_details", a({ oci_surrendered_or_cancelled: "Yes" })).required], [false, true]);
  assert.deepEqual([q("relatives_in_india").repeatable, q("relatives_in_india").metadata.fields.length], [true, 4]);
});

test("parents: passports per parent, marital evidence (only the circumstance that applies), OCI cards optional", () => {
  assert.deepEqual([state("doc_father_passport", a({ father_holds_passport: "No" })).visible, state("doc_father_passport", a({ father_holds_passport: "Yes" })).required, state("doc_mother_passport", a({ father_holds_passport: "Yes" })).visible], [false, true, false]);
  const ev = ["doc_parents_marriage_certificate", "doc_parents_divorce_decree", "doc_parent_death_certificate"];
  assert.deepEqual(ev.map((n) => state(n, {}).visible), [true, false, false], "default: the marriage certificate only");
  assert.deepEqual(ev.map((n) => state(n, a({ parents_divorced: "Yes" })).visible), [false, true, false]);
  assert.deepEqual(ev.map((n) => state(n, a({ parent_deceased: "Yes" })).visible), [false, false, true]);
  assert.deepEqual(ev.map((n) => state(n, a({ parents_divorced: "Yes", parent_deceased: "Yes" })).required), [false, true, true], "both circumstances -> both pieces of evidence, no marriage certificate");
  assert.ok(/Marriage Registrar/.test(q("doc_parents_marriage_certificate").description) && /religious body/.test(q("doc_parents_marriage_certificate").description));
  assert.deepEqual([state("doc_father_oci_card", {}).visible, state("doc_father_oci_card", a({ father_holds_oci: "Yes" })).visible, state("doc_father_oci_card", a({ father_holds_oci: "Yes" })).required], [false, true, false]);
});

test("legal status and address proofs", () => {
  assert.equal(state("legal_status_document", a({ holds_us_passport: "Yes" })).visible, false);
  const green = a({ holds_us_passport: "No", legal_status_document: "Green Card" });
  assert.deepEqual([state("doc_green_card", green).required, state("doc_ead", green).visible, state("doc_extension_receipt", green).visible], [true, false, false]);
  assert.deepEqual([state("doc_extension_receipt", { ...green, ...a({ visa_extension_pending: "Yes" }) }).required, state("doc_expired_visa", { ...green, ...a({ visa_extension_pending: "Yes" }) }).required], [true, true]);
  assert.equal(state("doc_us_address_proof").required, true);
  assert.ok(/three months/.test(q("doc_us_address_proof").description) && q("us_address_proof_type").options.some((o) => /previous three months/.test(o.value)));
  assert.equal(state("doc_native_address_proof", a({ current_nationality: "United States" })).visible, false);
  assert.equal(state("doc_native_address_proof", a({ current_nationality: "Canada" })).required, true);
  const dual = a({ current_nationality: "Canada", dual_citizen: "Yes" });
  assert.deepEqual([state("dual_citizen_countries", dual).required, state("doc_native_address_proof_second", dual).required, state("doc_native_address_proof_second", a({ current_nationality: "Canada", dual_citizen: "No" })).visible], [true, true, false]);
});
