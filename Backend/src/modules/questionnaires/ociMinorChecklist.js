// OCI - Minor Foreign citizen and never held Indian passport: the THIRD subtype of the OCI visa type under "Indian Timeline Cases".
//   key "oci_minor_foreign_citizen_never_held_passport_checklist", question keys "oci_minor_<name>" (a prefix of its own: no key is shared with the other two subtypes).
// Same shape as the other two (questionnaires/ociChecklists.js, ociBirthChecklist.js - both untouched): single-person, client role, NO USCIS forms, NO canonical mappings, not a
// default of the OCI visa type (the subtype's own filing-type entry names this checklist). Every conditional question carries conditionalLogic, so it is never required while hidden;
// a question that is always shown but only sometimes required carries metadata.requireWhen instead.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");
const { INSTRUCTIONS } = require("./ociBirthChecklist");

const CHECKLIST_KEY = "oci_minor_foreign_citizen_never_held_passport_checklist";
const SUBTYPE_LABEL = "Minor Foreign citizen and never held Indian passport";
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));

const S_CONTACT = "Applicant Contact Information";
const S_A = "A. Personal and Background Details";
const S_B = "B. Family Information";
const S_C = "C. Prior OCI History and Relatives in India";
const S_DOCS = "Required Documents";
const SECTIONS = [S_CONTACT, S_A, S_B, S_C, S_DOCS];

const key = (name) => `oci_minor_${name}`;
const rule = (name, operator, value) => ({ questionKey: key(name), operator, ...(value === undefined ? {} : { value }) });
const all = (...rules) => ({ mode: "all", rules, groups: [] });
const any = (...rules) => ({ mode: "any", rules, groups: [] });
const eq = (name, value) => all(rule(name, "equals", value));

const SPECS = [];
const add = (section, name, label, type, extras = {}) => SPECS.push({ section, name, label, type, required: extras.required !== false, ...extras });
const text = (section, name, label, extras) => add(section, name, label, "text", extras);
const longText = (section, name, label, extras) => add(section, name, label, "textarea", extras);
const phone = (section, name, label, extras) => add(section, name, label, "phone", extras);
const date = (section, name, label, extras) => add(section, name, label, "date", extras);
const country = (section, name, label, extras) => add(section, name, label, "select", { options: COUNTRY_OPTIONS, ...extras });
const select = (section, name, label, options, extras) => add(section, name, label, "select", { options, ...extras });
const yesNo = (section, name, label, extras) => add(section, name, label, "radio", { options: YES_NO, ...extras });
const file = (section, name, label, extras) => add(section, name, label, "file", extras);
const group = (section, name, label, config, extras) => add(section, name, label, "repeating_group", { group: config, ...extras });
const col = (columnKey, label, type = "text", extras = {}) => ({ key: columnKey, label, type, required: true, ...extras });

// ---- contact (the minor applicant; no guardian fields: this checklist has none) ----
text(S_CONTACT, "full_name", "Applicant Full Name");
phone(S_CONTACT, "phone", "Phone Number");

// ---- A ----
text(S_A, "distinguishing_mark", "Visible Distinguishing Mark", { required: false, description: "Enter N/A if none." });
select(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", ["Self", "Father", "Mother", "Grandparent", "Great-grandparent"]);
country(S_A, "country_of_birth", "Country of Birth");
text(S_A, "place_of_birth", "Place of Birth (Province/Town/City)");
country(S_A, "current_nationality", "Current Nationality");
yesNo(S_A, "is_student", "Are you a student?");
text(S_A, "institution_name", "Institution Name", { cond: eq("is_student", "Yes") });
longText(S_A, "institution_address", "Institution Complete Address", { cond: eq("is_student", "Yes") });
phone(S_A, "institution_phone", "Institution Contact Number", { cond: eq("is_student", "Yes") });

// ---- B ----
text(S_B, "father_name", "Father's Full Name");
country(S_B, "father_nationality", "Father's Nationality");
text(S_B, "father_occupation", "Father's Occupation");
text(S_B, "mother_name", "Mother's Full Name");
country(S_B, "mother_nationality", "Mother's Nationality");
text(S_B, "mother_occupation", "Mother's Occupation");

// ---- C ----
yesNo(S_C, "prior_oci_applied", "Have you or any member of your family applied for OCI registration earlier?");
group(S_C, "prior_oci_applications", "Previous OCI applications", {
  itemLabel: "Application", addLabel: "+ Add Application", summaryFields: ["name", "reference_number"],
  columns: [col("name", "Name"), col("relationship", "Relationship"), col("reference_number", "Reference Number"), col("date_applied", "Date When Applied", "date"), col("place_applied", "Place Where Applied"), col("status", "Application Status")],
}, { cond: eq("prior_oci_applied", "Yes") });
yesNo(S_C, "oci_surrendered_or_cancelled", "Have you ever surrendered an OCI card or had a previous OCI card cancelled?");
longText(S_C, "oci_surrender_details", "Please give details", { cond: eq("oci_surrendered_or_cancelled", "Yes") });
group(S_C, "relatives_in_india", "Family members / relatives currently residing in India", {
  itemLabel: "Relative", addLabel: "+ Add Relative", summaryFields: ["name", "relationship"],
  columns: [col("name", "Relative Name"), col("relationship", "Relationship"), col("age", "Age", "number", { min: 0, max: 130, step: "1" }), col("address", "Present Address in India", "textarea")],
}, { required: false, description: "Optional. Leave empty if you have no relatives currently residing in India." });

// ---- Documents (13 categories) ----
// 1. Digital photograph; signature OR left thumb impression
file(S_DOCS, "doc_digital_photo", "Digital Photograph", { description: "White background and dark-colored attire; taken no more than two months ago; shoulders clearly visible; no glare or shadows on the face or anywhere in the photograph; high-quality HD photograph. (If you cannot upload it here, send it by email as instructed by your case manager.) Required whether or not the minor can sign." });
yesNo(S_DOCS, "can_sign", "Can the minor sign?", { description: "If yes, a signature is needed; if no, a left thumb impression is needed instead (one of the two, never both)." });
file(S_DOCS, "doc_signature", "Signature", { cond: eq("can_sign", "Yes"), description: "Sign on a plain white sheet of paper with a dark-colored pen; make sure the signature is clear and properly visible; scan the signed page in high quality. (If you cannot upload it here, send it by email as instructed by your case manager.)" });
file(S_DOCS, "doc_thumb_impression", "Left thumb impression", { cond: eq("can_sign", "No"), description: "Left thumb impression in blue ink on a plain white sheet of paper; a clear photograph of it. (If you cannot upload it here, send the photograph by email as instructed by your case manager.)" });
// 2. Physical photographs (an acknowledgement, never an upload)
add(S_DOCS, "physical_photos_ack", "Physical Photographs", "radio", {
  options: [{ label: "I will provide three identical physical passport-sized photographs when the application is lodged", value: "confirmed" }],
  description: "Three identical physical passport-sized photographs, 2 inches x 2 inches, white background, submitted physically at the time of application lodging - do not upload them here.",
});
// 3. Current valid passport
file(S_DOCS, "doc_current_passport", "Current Valid Passport", { description: "Color copies of the first two and last two pages of the minor's current valid passport. The passport must have at least nine months of validity remaining." });
// 4. Birth certificate. The supplied text only states a rule for an applicant born in the USA and an authentication rule for one born outside India; nothing is stated for one born in India,
//    so nothing is asked of such an applicant (see the report: documented ambiguity).
const BORN_OUTSIDE_INDIA = all(rule("country_of_birth", "not_empty"), rule("country_of_birth", "not_equals", "India"));
file(S_DOCS, "doc_birth_certificate", "Birth Certificate", { cond: BORN_OUTSIDE_INDIA, description: "A copy of the birth certificate showing the names of the parents, the date of birth and the nationality. Hospital-issued birth certificates are not acceptable." });
select(S_DOCS, "birth_certificate_authentication", "How is the birth certificate authenticated?", ["Apostilled by the foreign government authority", "Attested by the appropriate foreign mission"], { cond: BORN_OUTSIDE_INDIA, description: "Because the applicant was born outside India: one of the two (never both)." });
file(S_DOCS, "doc_birth_certificate_self_attested", "Self-attested copy of the apostilled / attested birth certificate", { cond: BORN_OUTSIDE_INDIA, description: "Do not send the original apostilled or attested document to VFS or a Consulate office." });
// 5. Evidence of Indian origin (several documents; the lineage is recorded alongside)
group(S_DOCS, "indian_origin_lineage", "Indian origin: ancestor and lineage", {
  itemLabel: "Ancestor", addLabel: "+ Add Ancestor", summaryFields: ["ancestor_name", "relationship"],
  columns: [col("ancestor_name", "Ancestor's name"), col("relationship", "Relationship to you", "select", { options: ["Father", "Mother", "Grandfather", "Grandmother", "Great-grandfather", "Great-grandmother"] }), col("evidence_type", "Evidence of that ancestor's Indian origin", "select", { options: ["Indian passport", "Domicile certificate", "Nativity certificate", "Parents' OCI card with supporting documents", "Other documentary proof"] })],
}, { description: "Establish Indian origin through the relevant parent, grandparent or great-grandparent. Add one entry per ancestor; if one document does not establish the lineage, add further evidence." });
file(S_DOCS, "doc_indian_origin_evidence", "Evidence of Indian origin", { description: "Upload as many documents as needed: Indian passport copies (first two and last two pages), domicile certificate, nativity certificate (issued by the competent authority), a parent's OCI card with the documents it was issued on, or any other proof of Indian origin. You do not need every type." });
// 6. Legal status in the US (non-US passport holders)
yesNo(S_DOCS, "holds_us_passport", "Do you hold a U.S. passport?");
const NO_US_PASSPORT = eq("holds_us_passport", "No");
select(S_DOCS, "legal_status_document", "Legal status document you will provide", ["Green Card", "Employment Authorization Document (EAD)", "Long-term U.S. visa"], { cond: NO_US_PASSPORT });
file(S_DOCS, "doc_green_card", "Green Card (front and back)", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Green Card")) });
file(S_DOCS, "doc_ead", "Valid Employment Authorization Document (EAD)", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Employment Authorization Document (EAD)")) });
file(S_DOCS, "doc_long_term_visa", "Long-term U.S. visa", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Long-term U.S. visa")) });
yesNo(S_DOCS, "visa_extension_pending", "Is a visa extension pending?", { cond: NO_US_PASSPORT });
const EXTENSION_PENDING = all(rule("holds_us_passport", "equals", "No"), rule("visa_extension_pending", "equals", "Yes"));
file(S_DOCS, "doc_extension_receipt", "I-797A or I-797C notice for the pending extension", { cond: EXTENSION_PENDING });
file(S_DOCS, "doc_expired_visa", "Expired visa", { cond: EXTENSION_PENDING });
// 7. Proof of name change
yesNo(S_DOCS, "used_previous_name", "Has the minor ever used a previous name or legally changed their name?");
group(S_DOCS, "previous_names", "Previous name(s)", { itemLabel: "Previous name", addLabel: "+ Add Name", summaryFields: ["name"], columns: [col("name", "Previous name")] }, { cond: eq("used_previous_name", "Yes") });
file(S_DOCS, "doc_name_change", "Proof of name change", { cond: eq("used_previous_name", "Yes"), description: "A legal name-change document from a local court, or a duly notarized affidavit." });
// 8. Parents' naturalization certificates and current foreign passports (each parent separately; N/A allowed)
select(S_DOCS, "father_naturalization", "Has your father acquired foreign nationality?", ["Yes", "No / Not applicable (N/A)"]);
file(S_DOCS, "doc_father_naturalization_certificate", "Father's naturalization certificate", { cond: eq("father_naturalization", "Yes") });
file(S_DOCS, "doc_father_foreign_passport", "Father's current foreign passport", { cond: eq("father_naturalization", "Yes") });
select(S_DOCS, "mother_naturalization", "Has your mother acquired foreign nationality?", ["Yes", "No / Not applicable (N/A)"]);
file(S_DOCS, "doc_mother_naturalization_certificate", "Mother's naturalization certificate", { cond: eq("mother_naturalization", "Yes") });
file(S_DOCS, "doc_mother_foreign_passport", "Mother's current foreign passport", { cond: eq("mother_naturalization", "Yes") });
// 9. Marriage certificate of the parents. One status is chosen; its evidence is required, and the other evidence stays available (optional) for a situation with more than one circumstance.
const requireWhen = (...rules) => ({ mode: "all", rules, groups: [] });
select(S_DOCS, "parents_marital_status", "Parents' marital status", ["Married", "Divorced", "One parent deceased"], { description: "If more than one circumstance applies, choose the main one and add the other evidence below." });
const STATUS_ASKED = all(rule("parents_marital_status", "not_empty"));
file(S_DOCS, "doc_parents_marriage_certificate", "Parents' marriage certificate", { required: false, requireWhen: requireWhen(rule("parents_marital_status", "equals", "Married")), cond: STATUS_ASKED, description: "If the marriage was solemnized in India: a certificate issued by the Marriage Registrar (a certificate issued by a religious body is not acceptable)." });
file(S_DOCS, "doc_parents_divorce_decree", "Parents' divorce decree", { required: false, requireWhen: requireWhen(rule("parents_marital_status", "equals", "Divorced")), cond: STATUS_ASKED, description: "A copy of the divorce decree (if the parents are divorced)." });
file(S_DOCS, "doc_parent_death_certificate", "Death certificate of the deceased parent", { required: false, requireWhen: requireWhen(rule("parents_marital_status", "equals", "One parent deceased")), cond: STATUS_ASKED, description: "A copy of the death certificate (if one parent is deceased)." });
// 10. Parents' OCI cards (optional; never required)
yesNo(S_DOCS, "father_holds_oci", "Does your father hold, or has he ever obtained, an OCI card?", { required: false });
file(S_DOCS, "doc_father_oci_card", "Father's OCI card", { required: false, cond: eq("father_holds_oci", "Yes"), description: "Upload it if available. If the same card and supporting documents are already uploaded as Indian-origin evidence above, you do not need to upload them again." });
yesNo(S_DOCS, "mother_holds_oci", "Does your mother hold, or has she ever obtained, an OCI card?", { required: false });
file(S_DOCS, "doc_mother_oci_card", "Mother's OCI card", { required: false, cond: eq("mother_holds_oci", "Yes"), description: "Upload it if available. If the same card and supporting documents are already uploaded as Indian-origin evidence above, you do not need to upload them again." });
// 11. Previous Indian visa
yesNo(S_DOCS, "previous_indian_visa", "Has the minor ever been issued an Indian visa?");
file(S_DOCS, "doc_previous_indian_visa", "Copy of the previously issued Indian visa", { cond: eq("previous_indian_visa", "Yes") });
// 12. Proof of US address
select(S_DOCS, "us_address_proof_type", "U.S. address proof you will provide", ["State-issued ID", "Driver's license", "Utility bill (water, gas, electricity or telephone) dated within the last three months", "Valid lease agreement", "Mortgage statement", "Recent tax return"]);
file(S_DOCS, "doc_us_address_proof", "Proof of U.S. address", { description: "Upload the document of the type selected above (only one is needed)." });
// 13. Native address proof (non-US nationals, dual citizens)
const NON_US = all(rule("current_nationality", "not_equals", "United States"), rule("current_nationality", "not_empty"));
const DUAL = all(rule("current_nationality", "not_equals", "United States"), rule("dual_citizen", "equals", "Yes"));
yesNo(S_DOCS, "dual_citizen", "Is the minor a dual citizen?", { cond: NON_US });
file(S_DOCS, "doc_native_address_proof", "Proof of the address in the native / home country", { cond: NON_US, description: "If proof is unavailable, upload a notarized statement detailing the native address instead." });
group(S_DOCS, "dual_citizen_countries", "Countries of citizenship and native address", {
  itemLabel: "Country", addLabel: "+ Add Country", summaryFields: ["country"], columns: [col("country", "Country", "select", { options: COUNTRY_OPTIONS }), col("address", "Native address in that country", "textarea")],
}, { cond: DUAL, description: "Dual citizens give native-address proof for both countries." });
file(S_DOCS, "doc_native_address_proof_second", "Proof of the address in the second country of citizenship", { cond: DUAL });

function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
    ...(spec.cond ? { conditionalLogic: spec.cond } : {}),
  };
  const questionKey = key(spec.name);
  const requireMeta = spec.requireWhen ? { requireWhen: spec.requireWhen } : {};
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document", ...requireMeta } });
  if (spec.type !== "repeating_group") return buildQuestion(questionKey, spec.label, spec.type, spec.section, order, { ...common, metadata: { ...requireMeta } });
  const config = spec.group;
  return buildQuestion(questionKey, spec.label, "repeating_group", spec.section, order, {
    ...common,
    metadata: {
      itemLabel: config.itemLabel, addLabel: config.addLabel, confirmRemove: `Remove this ${config.itemLabel.toLowerCase()}? This cannot be undone.`,
      summaryFields: config.summaryFields, fields: config.columns, repeatableFields: config.columns,
    },
    repeatable: true,
    repeatableConfig: { min: spec.required ? 1 : 0, labelTemplate: `${config.itemLabel} {n}`, allowClientAdd: true },
  });
}

function buildOciMinorChecklist() {
  const counters = new Map();
  const questions = SPECS.map((spec) => {
    const order = (counters.get(spec.section) || 0) + 1;
    counters.set(spec.section, order);
    return buildField(spec, order);
  });
  return {
    key: CHECKLIST_KEY,
    title: SUBTYPE_LABEL,
    visaType: "OCI",
    visaTypes: ["OCI"],
    checklistRole: "client",
    isDefault: false, // assigned only by this subtype's own filing type
    reconcileMetadata: true,
    description: `For minor foreign citizens who have never held an Indian passport and are applying for Overseas Citizen of India (OCI) registration.\n\n${INSTRUCTIONS.map((line) => `• ${line}`).join("\n")}`,
    sections: SECTIONS,
    questions,
  };
}

const OCI_MINOR_CHECKLIST_DEFINITIONS = [buildOciMinorChecklist()];

module.exports = { INSTRUCTIONS, CHECKLIST_KEY, SUBTYPE_LABEL, OCI_MINOR_CHECKLIST_DEFINITIONS, buildOciMinorChecklist };
