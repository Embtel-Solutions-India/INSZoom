// OCI - Minor Foreign citizen and held Indian passport: the FIFTH (last) subtype of the OCI visa type under "Indian Timeline Cases".
//   key "oci_minor_foreign_citizen_held_passport_checklist", question keys "oci_minorheld_<name>" (a prefix of its own: no key is shared with the other four subtypes).
// Same shape as the other four (ociChecklists.js, ociBirthChecklist.js, ociMinorChecklist.js, ociSpouseChecklist.js - all untouched): single-person, client role, NO USCIS forms,
// NO canonical mappings, not a default of the OCI visa type (the subtype's own filing-type entry names this checklist). A conditional question carries conditionalLogic (never required
// while hidden); one that is shown but only sometimes required carries metadata.requireWhen. Nothing here decides eligibility: where the supplied text states no exact rule, the item
// stays visible and staff decide.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");
const { INSTRUCTIONS } = require("./ociBirthChecklist");

const CHECKLIST_KEY = "oci_minor_foreign_citizen_held_passport_checklist";
const SUBTYPE_LABEL = "Minor Foreign citizen and held Indian passport";
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

const key = (name) => `oci_minorheld_${name}`;
const rule = (name, operator, value) => ({ questionKey: key(name), operator, ...(value === undefined ? {} : { value }) });
const all = (...rules) => ({ mode: "all", rules, groups: [] });
const any = (...rules) => ({ mode: "any", rules, groups: [] });
const eq = (name, value) => all(rule(name, "equals", value));

const SPECS = [];
const add = (section, name, label, type, extras = {}) => SPECS.push({ section, name, label, type, required: extras.required !== false, ...extras });
const text = (section, name, label, extras) => add(section, name, label, "text", extras);
const longText = (section, name, label, extras) => add(section, name, label, "textarea", extras);
const phone = (section, name, label, extras) => add(section, name, label, "phone", extras);
const country = (section, name, label, extras) => add(section, name, label, "select", { options: COUNTRY_OPTIONS, ...extras });
const select = (section, name, label, options, extras) => add(section, name, label, "select", { options, ...extras });
const yesNo = (section, name, label, extras) => add(section, name, label, "radio", { options: YES_NO, ...extras });
const file = (section, name, label, extras) => add(section, name, label, "file", extras);
const group = (section, name, label, config, extras) => add(section, name, label, "repeating_group", { group: config, ...extras });
const col = (columnKey, label, type = "text", extras = {}) => ({ key: columnKey, label, type, required: true, ...extras });

// ---- contact ----
text(S_CONTACT, "full_name", "Applicant Full Name");
phone(S_CONTACT, "phone", "Phone Number");

// ---- A ----
text(S_A, "distinguishing_mark", "Visible Distinguishing Mark", { required: false, description: "Enter N/A if none." });
select(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", ["Self", "Father", "Mother", "Grandparent", "Great-grandparent", "Other"]);
text(S_A, "root_ancestor_other", "Other relationship (please specify)", { cond: eq("root_ancestor_relationship", "Other") });
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
  columns: [col("name", "Name / Relationship"), col("reference_number", "Reference Number"), col("date_applied", "Date When Applied", "date"), col("place_applied", "Place Where Applied"), col("status", "Status")],
}, { cond: eq("prior_oci_applied", "Yes") });
yesNo(S_C, "oci_surrendered_or_cancelled", "Have you ever surrendered or had a previous OCI card cancelled?");
longText(S_C, "oci_surrender_details", "Please give details", { cond: eq("oci_surrendered_or_cancelled", "Yes"), description: "Kept for staff review; nothing is decided from this answer." });
group(S_C, "relatives_in_india", "Details of family members / relatives currently residing in India", {
  itemLabel: "Relative", addLabel: "+ Add Relative", summaryFields: ["name", "relationship"],
  columns: [col("name", "Relative Name"), col("relationship", "Relationship"), col("age", "Age", "number", { min: 0, max: 130, step: "1" }), col("address", "Present Address in India", "textarea")],
}, { required: false, description: "Optional. Leave empty if you have no relatives currently residing in India." });

// ---- Documents (15 categories) ----
// 1. Digital photograph; signature OR left thumb impression
file(S_DOCS, "doc_digital_photo", "Digital Photograph", { description: "White background and dark-colored attire; taken no more than two months ago; shoulders clearly visible; no glare or shadows on the face or anywhere in the photograph; high-quality HD photograph. (If you cannot upload it here, send it by email as instructed by your case manager.) Required whether or not the minor can sign." });
yesNo(S_DOCS, "can_sign", "Can the minor sign their own signature?", { description: "If yes, a signature is needed; if no, a left thumb impression is needed instead (one of the two, never both)." });
file(S_DOCS, "doc_signature", "Signature", { cond: eq("can_sign", "Yes"), description: "Sign on a plain white sheet of paper with a dark-colored pen; make sure the signature is clear and properly visible; scan the signed page in high quality. (If you cannot upload it here, send it by email as instructed by your case manager.)" });
file(S_DOCS, "doc_thumb_impression", "Left thumb impression", { cond: eq("can_sign", "No"), description: "Left thumb impression in blue ink on a plain white sheet of paper; a clear photograph or scan of it. (If you cannot upload it here, send it by email as instructed by your case manager.)" });
// 2. Physical photographs (an acknowledgement, never an upload)
add(S_DOCS, "physical_photos_ack", "Physical Photographs", "radio", {
  options: [{ label: "I will provide three identical physical passport-sized photographs when the application is lodged", value: "confirmed" }],
  description: "Three identical physical passport-sized photographs, 2 inches x 2 inches, white background, submitted physically at the time of application lodging - they are not the same as the digital photograph and are not uploaded here.",
});
// 3. Current valid passport; 4. last-held Indian passport (a different document)
file(S_DOCS, "doc_current_passport", "Current Valid Passport", { description: "Color copies of the first two and last two pages of the minor's current valid passport (several files can be added). The passport must have at least nine months of validity remaining." });
file(S_DOCS, "doc_last_indian_passport", "Last-Held Indian Passport", { description: "A color copy of the last Indian passport the minor held - not the current foreign passport." });
// 5. Naturalization certificate, or (alternative) the parents' affidavit + both parents' certificates; 6. surrender certificate
yesNo(S_DOCS, "naturalized_through_parents", "Did the applicant acquire naturalization through their parents?", { required: false, description: "If yes and there is no separate certificate, the alternative evidence below is provided INSTEAD of the applicant's own certificate." });
const THROUGH_PARENTS = eq("naturalized_through_parents", "Yes");
file(S_DOCS, "doc_naturalization_certificate", "Naturalization Certificate", { cond: all(rule("naturalized_through_parents", "not_equals", "Yes")), description: "A copy of the naturalization certificate. It must be signed in the designated space. (Not needed if the applicant naturalized through the parents and has no separate certificate - see the alternative.)" });
file(S_DOCS, "doc_parents_affidavit", "Alternative: notarized affidavit signed by both parents", { cond: THROUGH_PARENTS, description: "Instead of a separate certificate: a notarized affidavit signed by both parents." });
file(S_DOCS, "doc_parents_naturalization_certificates", "Alternative: copies of both parents' naturalization certificates", { cond: THROUGH_PARENTS });
add(S_DOCS, "naturalization_year", "Year of naturalization", "number", { required: false, min: 1900, max: 2100, step: "1", description: "Used for the surrender certificate (naturalized from 2010 onwards). If you do not know the year, leave it empty - staff will confirm whether the certificate applies." });
// shown when the year is 2010 or later OR not given (never silently treated as unnecessary); required only when the year says 2010 or later
file(S_DOCS, "doc_surrender_certificate", "Surrender Certificate", {
  required: false,
  requireWhen: all(rule("naturalization_year", "gte", 2010)),
  cond: any(rule("naturalization_year", "gte", 2010), rule("naturalization_year", "empty")),
  description: "Applies only to applicants naturalized from 2010 onwards. If the year of naturalization is not given above, staff will confirm whether it applies.",
});
// 7. Birth certificate. The supplied text states a rule for an applicant born in the USA and an authentication rule for one born outside India; nothing is stated for one born in India,
//    so nothing is asked of such an applicant (documented in the report; staff can still request it).
const BORN_OUTSIDE_INDIA = all(rule("country_of_birth", "not_empty"), rule("country_of_birth", "not_equals", "India"));
file(S_DOCS, "doc_birth_certificate", "Birth Certificate", { cond: BORN_OUTSIDE_INDIA, description: "A copy of the birth certificate showing the names of the parents, the date of birth and the nationality. Hospital-issued birth certificates are not acceptable." });
select(S_DOCS, "birth_certificate_authentication", "How is the birth certificate authenticated?", ["Apostilled by the foreign government authority", "Attested by the appropriate foreign mission"], { cond: BORN_OUTSIDE_INDIA, description: "Born outside India: one of the two (never both)." });
file(S_DOCS, "doc_birth_certificate_self_attested", "Self-attested copy of the apostilled / attested birth certificate", { cond: BORN_OUTSIDE_INDIA, description: "Do not send the original apostilled or attested document to VFS or a Consulate office." });
// 8. Legal status in the US (non-US passport holders)
yesNo(S_DOCS, "holds_us_passport", "Is the applicant a U.S. passport holder?");
const NO_US_PASSPORT = eq("holds_us_passport", "No");
select(S_DOCS, "legal_status_document", "Legal status document you will provide", ["Green Card", "Employment Authorization Document (EAD)", "Long-term U.S. visa"], { cond: NO_US_PASSPORT });
file(S_DOCS, "doc_green_card", "Green Card (front and back)", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Green Card")) });
file(S_DOCS, "doc_ead", "Valid Employment Authorization Document (EAD)", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Employment Authorization Document (EAD)")) });
file(S_DOCS, "doc_long_term_visa", "Long-term U.S. visa", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Long-term U.S. visa")) });
yesNo(S_DOCS, "visa_extension_pending", "Is a visa extension pending?", { cond: NO_US_PASSPORT });
const EXTENSION_PENDING = all(rule("holds_us_passport", "equals", "No"), rule("visa_extension_pending", "equals", "Yes"));
file(S_DOCS, "doc_extension_receipt", "I-797A or I-797C notice for the pending extension", { cond: EXTENSION_PENDING, description: "Document evidence only." });
file(S_DOCS, "doc_expired_visa", "Expired visa", { cond: EXTENSION_PENDING });
// 9. Proof of name change
yesNo(S_DOCS, "used_previous_name", "Has the applicant ever changed their name?");
group(S_DOCS, "previous_names", "Previous name(s)", { itemLabel: "Previous name", addLabel: "+ Add Name", summaryFields: ["name"], columns: [col("name", "Previous name")] }, { cond: eq("used_previous_name", "Yes"), description: "Previous names must be stated in the application." });
file(S_DOCS, "doc_name_change", "Proof of name change", { cond: eq("used_previous_name", "Yes"), description: "A legal name-change document from a local court, or a duly notarized affidavit." });
// 10. Current passports of the parents (per parent; nothing assumed about an Indian passport)
yesNo(S_DOCS, "father_holds_passport", "Does the father currently hold a passport?");
file(S_DOCS, "doc_father_passport", "Father's current passport", { cond: eq("father_holds_passport", "Yes"), description: "A color copy. If he holds an Indian passport, provide its first two and last pages." });
yesNo(S_DOCS, "mother_holds_passport", "Does the mother currently hold a passport?");
file(S_DOCS, "doc_mother_passport", "Mother's current passport", { cond: eq("mother_holds_passport", "Yes"), description: "A color copy. If she holds an Indian passport, provide its first two and last pages." });
// 11. Parents' marriage certificate, or the evidence of the circumstance (never all three at once unless they all apply)
yesNo(S_DOCS, "parents_divorced", "Are the parents divorced?", { required: false });
yesNo(S_DOCS, "parent_deceased", "Is either parent deceased?", { required: false });
file(S_DOCS, "doc_parents_marriage_certificate", "Parents' marriage certificate", { cond: all(rule("parents_divorced", "not_equals", "Yes"), rule("parent_deceased", "not_equals", "Yes")), description: "If the marriage was solemnized in India: a certificate issued by the Marriage Registrar (a certificate issued by a religious body is not acceptable)." });
file(S_DOCS, "doc_parents_divorce_decree", "Parents' divorce decree", { cond: eq("parents_divorced", "Yes"), description: "A copy of the divorce decree." });
file(S_DOCS, "doc_parent_death_certificate", "Death certificate of the deceased parent", { cond: eq("parent_deceased", "Yes"), description: "A copy of the death certificate." });
// 12. Parents' OCI cards (optional)
yesNo(S_DOCS, "father_holds_oci", "Does the father hold, or has he ever obtained, an OCI card?", { required: false });
file(S_DOCS, "doc_father_oci_card", "Father's OCI card", { required: false, cond: eq("father_holds_oci", "Yes"), description: "Upload it if available." });
yesNo(S_DOCS, "mother_holds_oci", "Does the mother hold, or has she ever obtained, an OCI card?", { required: false });
file(S_DOCS, "doc_mother_oci_card", "Mother's OCI card", { required: false, cond: eq("mother_holds_oci", "Yes"), description: "Upload it if available." });
// 13. Previous Indian visa
yesNo(S_DOCS, "previous_indian_visa", "Has the applicant previously been issued an Indian visa?");
file(S_DOCS, "doc_previous_indian_visa", "Copy of the previously issued Indian visa", { cond: eq("previous_indian_visa", "Yes") });
// 14. Proof of US address
select(S_DOCS, "us_address_proof_type", "U.S. address proof you will provide", ["State-issued ID", "Driver's license", "Utility bill (water, gas, electricity or telephone) issued within the previous three months", "Valid lease agreement", "Mortgage statement", "Recent tax return"]);
file(S_DOCS, "doc_us_address_proof", "Proof of U.S. address", { description: "Upload the document of the type selected above (only one is needed). A utility bill must be issued within the previous three months." });
// 15. Native address proof (non-US nationals, dual citizens)
const NON_US = all(rule("current_nationality", "not_equals", "United States"), rule("current_nationality", "not_empty"));
const DUAL = all(rule("current_nationality", "not_equals", "United States"), rule("dual_citizen", "equals", "Yes"));
yesNo(S_DOCS, "dual_citizen", "Does the applicant hold dual citizenship?", { cond: NON_US });
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
  if (spec.type === "number") return buildQuestion(questionKey, spec.label, "number", spec.section, order, { ...common, metadata: { min: spec.min, max: spec.max, step: spec.step } });
  if (spec.type !== "repeating_group") return buildQuestion(questionKey, spec.label, spec.type, spec.section, order, { ...common, metadata: {} });
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

function buildOciMinorHeldChecklist() {
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
    description: `For minor foreign citizens who previously held an Indian passport and are applying for Overseas Citizen of India (OCI) registration.\n\n${INSTRUCTIONS.map((line) => `• ${line}`).join("\n")}`,
    sections: SECTIONS,
    questions,
  };
}

const OCI_MINOR_HELD_CHECKLIST_DEFINITIONS = [buildOciMinorHeldChecklist()];

module.exports = { INSTRUCTIONS, CHECKLIST_KEY, SUBTYPE_LABEL, OCI_MINOR_HELD_CHECKLIST_DEFINITIONS, buildOciMinorHeldChecklist };
