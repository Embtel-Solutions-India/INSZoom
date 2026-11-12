// Adult Foreign citizen by birth and never held Indian passport (never held an Indian passport): the SECOND subtype of the OCI visa type under "Indian Timeline Cases".
//   key "oci_adult_foreign_citizen_by_birth_checklist", question keys "oci_birth_<name>" (a different prefix from the first subtype, so the two never collide).
// Same shape as the first subtype (questionnaires/ociChecklists.js, which is untouched): single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the OCI
// visa type (the subtype's own filing-type entry names this checklist). Every conditional question carries conditionalLogic, so it is never required while hidden.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");
const INSTRUCTIONS = [
  "Complete the questionnaire thoroughly to enable accurate petition preparation.",
  "Mark N/A for questions or document categories that do not apply.",
  "All submitted supporting document copies must be in color.",
  "Provide valid documents only. Expired documents or inaccurate details may result in application delays.",
];

const CHECKLIST_KEY = "oci_adult_foreign_citizen_by_birth_checklist";
const SUBTYPE_LABEL = "Adult Foreign citizen by birth and never held Indian passport";
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));

const S_CONTACT = "Applicant Contact Information";
const S_A = "A. Personal and Background Details";
const S_B = "B. Family Information";
const S_C = "C. Employment and Occupation Details";
const S_D = "D. Prior OCI History and Relatives in India";
const S_DOCS = "Required Documents";
const SECTIONS = [S_CONTACT, S_A, S_B, S_C, S_D, S_DOCS];

const key = (name) => `oci_birth_${name}`;
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

// ---- contact ----
text(S_CONTACT, "full_name", "Applicant Full Name");
phone(S_CONTACT, "phone", "Phone Number");

// ---- A ----
select(S_A, "marital_status", "Marital Status", ["Single / Never Married", "Married", "Divorced", "Widowed", "Separated"]);
text(S_A, "distinguishing_mark", "Visible Distinguishing Mark", { required: false, description: "Enter N/A if none." });
select(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", ["Self", "Father", "Mother", "Grandparent", "Great-grandparent"]);
country(S_A, "country_of_birth", "Country of Birth");
text(S_A, "place_of_birth", "Place of Birth (Province/Town/City)");
country(S_A, "current_nationality", "Current Nationality");

// "applying on the basis of a parent's eligibility": the root Indian ancestor is the applicant's father or mother
const PARENT_BASED = any(rule("root_ancestor_relationship", "equals", "Father"), rule("root_ancestor_relationship", "equals", "Mother"));

// ---- B ----
text(S_B, "father_name", "Father's Full Name");
country(S_B, "father_nationality", "Father's Nationality");
text(S_B, "father_occupation", "Father's Occupation");
text(S_B, "mother_name", "Mother's Full Name");
country(S_B, "mother_nationality", "Mother's Nationality");
text(S_B, "mother_occupation", "Mother's Occupation");
yesNo(S_B, "spouse_based_oci", "Are you applying for OCI on the basis of an Indian spouse / spouse's OCI card?");
const SPOUSE_APPLIES = any(rule("marital_status", "equals", "Married"), rule("spouse_based_oci", "equals", "Yes"));
text(S_B, "spouse_name", "Spouse's Full Name", { cond: SPOUSE_APPLIES });
date(S_B, "spouse_dob", "Spouse's Date of Birth", { cond: SPOUSE_APPLIES });
country(S_B, "spouse_nationality", "Spouse's Nationality", { cond: SPOUSE_APPLIES });
text(S_B, "spouse_occupation", "Spouse's Occupation", { cond: SPOUSE_APPLIES });
date(S_B, "marriage_date", "Marriage Date", { cond: SPOUSE_APPLIES });

// ---- C ----
text(S_C, "current_occupation", "Current Occupation / Designation", { description: "Enter N/A if not applicable." });
select(S_C, "employment_situation", "Current employment situation", ["Employed", "Self-employed / Business owner", "Retired", "Student", "Never employed or self-employed"]);
longText(S_C, "employer_name_address", "Employer Name and Office Address", { cond: eq("employment_situation", "Employed") });
phone(S_C, "employer_phone", "Employer Contact Number", { cond: eq("employment_situation", "Employed") });
text(S_C, "retired_organization", "If Retired, Department / Office / Organization", { cond: eq("employment_situation", "Retired") });

// ---- D ----
yesNo(S_D, "prior_oci_applied", "Have you or any member of your family applied for OCI registration earlier?");
group(S_D, "prior_oci_applications", "Previous OCI applications", {
  itemLabel: "Application", addLabel: "+ Add Application", summaryFields: ["name", "reference_number"],
  columns: [col("name", "Name"), col("relationship", "Relationship"), col("reference_number", "Reference Number"), col("date_applied", "Date When Applied", "date"), col("place_applied", "Place Where Applied"), col("status", "Application Status")],
}, { cond: eq("prior_oci_applied", "Yes") });
yesNo(S_D, "oci_surrendered_or_cancelled", "Have you ever surrendered an OCI card or had a previous OCI card cancelled?");
longText(S_D, "oci_surrender_details", "Please give details", { cond: eq("oci_surrendered_or_cancelled", "Yes") });
group(S_D, "relatives_in_india", "Family members / relatives currently residing in India", {
  itemLabel: "Relative", addLabel: "+ Add Relative", summaryFields: ["name", "relationship"],
  columns: [col("name", "Relative Name"), col("relationship", "Relationship"), col("age", "Age", "number", { min: 0, max: 130, step: "1" }), col("address", "Present Address in India", "textarea")],
}, { required: false, description: "Optional. Leave empty if you have no relatives currently residing in India." });

// ---- Documents (17 categories) ----
// 1. Digital photograph and signature
file(S_DOCS, "doc_digital_photo", "Digital Photograph", { description: "White background; dark-colored attire; taken no more than two months ago; shoulders clearly visible; no glare or shadows on the face or anywhere in the photograph; high-quality HD photograph. (If you cannot upload it here, send it by email as instructed by your case manager.)" });
file(S_DOCS, "doc_signature", "Signature", { description: "Sign on a plain white sheet with a dark-colored pen; make sure the signature is clear and properly visible; scan the signed page in high quality. (If you cannot upload it here, send it by email as instructed by your case manager.)" });
// 2. Physical photographs (an acknowledgement, never an upload)
add(S_DOCS, "physical_photos_ack", "Physical Photographs", "radio", {
  options: [{ label: "I will provide three identical physical passport-sized photographs when the application is lodged", value: "confirmed" }],
  description: "Three identical physical passport-sized photographs, 2 inches × 2 inches, white background, submitted physically at the time of application lodging - do not upload them here.",
});
// 3. Current valid passport
file(S_DOCS, "doc_current_passport", "Current Valid Passport", { description: "Color copies of the first two and last two pages of your current valid passport. The passport must have at least nine months of validity remaining." });
// 4. Birth certificate (+ conditional authentication when born outside India)
const BORN_OUTSIDE_INDIA = all(rule("country_of_birth", "not_empty"), rule("country_of_birth", "not_equals", "India"));
file(S_DOCS, "doc_birth_certificate", "Birth Certificate", { description: "An official birth certificate (hospital-issued certificates are not acceptable) showing the names of your parents, your date of birth and your nationality." });
select(S_DOCS, "birth_certificate_authentication", "How is the birth certificate authenticated?", ["Apostilled by the foreign government authority", "Attested by the appropriate foreign mission"], { cond: BORN_OUTSIDE_INDIA, description: "Required because you were born outside India: the birth certificate you upload must carry one of these (only one is needed)." });
// 5. Evidence of Indian origin (several documents; the lineage is recorded alongside)
group(S_DOCS, "indian_origin_lineage", "Indian origin: ancestor and lineage", {
  itemLabel: "Ancestor", addLabel: "+ Add Ancestor", summaryFields: ["ancestor_name", "relationship"],
  columns: [col("ancestor_name", "Ancestor's name"), col("relationship", "Relationship to you", "select", { options: ["Father", "Mother", "Grandfather", "Grandmother", "Great-grandfather", "Great-grandmother"] }), col("evidence_type", "Evidence of that ancestor's Indian origin", "select", { options: ["Indian passport", "Domicile certificate", "Nativity certificate", "Parents' OCI card with supporting documents", "Other documentary proof"] })],
}, { description: "Establish your Indian origin through your parent, grandparent or great-grandparent. If direct proof of your parents' Indian origin is unavailable, the documents you submit must sufficiently establish the family lineage - otherwise the application may be rejected. Add one entry per ancestor." });
file(S_DOCS, "doc_indian_origin_evidence", "Evidence of Indian origin", { description: "Upload as many documents as needed: Indian passport copies (first two and last two pages), domicile certificate, nativity certificate (issued by the competent authority), parents' OCI cards with the documents they were based on, or any other proof of Indian origin. You do not need every type." });
// 6. Parents' OCI / PIO cards and supporting documents (per parent)
yesNo(S_DOCS, "father_holds_oci", "Does your father hold an OCI / PIO card?", { required: false });
file(S_DOCS, "doc_father_oci_card", "Father's OCI / PIO card", { cond: eq("father_holds_oci", "Yes") });
file(S_DOCS, "doc_father_oci_supporting", "Documents used when your father's card was issued", { cond: eq("father_holds_oci", "Yes") });
yesNo(S_DOCS, "mother_holds_oci", "Does your mother hold an OCI / PIO card?", { required: false });
file(S_DOCS, "doc_mother_oci_card", "Mother's OCI / PIO card", { cond: eq("mother_holds_oci", "Yes") });
file(S_DOCS, "doc_mother_oci_supporting", "Documents used when your mother's card was issued", { cond: eq("mother_holds_oci", "Yes") });
// 7. Legal status in the US (non-US passport holders)
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
// 8. Proof of marital status (the applicant's own)
file(S_DOCS, "doc_marriage_certificate", "Marriage certificate", { cond: eq("marital_status", "Married") });
file(S_DOCS, "doc_divorce_decree", "Divorce decree", { cond: eq("marital_status", "Divorced") });
file(S_DOCS, "doc_death_certificate", "Death certificate of the spouse", { cond: eq("marital_status", "Widowed") });
// 9. Spouse's passport
file(S_DOCS, "doc_spouse_passport", "Current valid passport of spouse", { cond: SPOUSE_APPLIES, description: "A clear scanned copy of the biographical-data page of your spouse's valid passport." });
// 10. Proof of name change
yesNo(S_DOCS, "used_previous_name", "Have you ever used a previous name or legally changed your name?");
group(S_DOCS, "previous_names", "Previous name(s)", { itemLabel: "Previous name", addLabel: "+ Add Name", summaryFields: ["name"], columns: [col("name", "Previous name")] }, { cond: eq("used_previous_name", "Yes") });
file(S_DOCS, "doc_name_change", "Proof of name change", { cond: eq("used_previous_name", "Yes"), description: "A legal name-change document from a local court, or a duly notarized affidavit." });
// 11. Employment / work verification
file(S_DOCS, "doc_employer_letter", "Employer letter describing your job profile", { cond: eq("employment_situation", "Employed") });
file(S_DOCS, "doc_self_employment", "Documentary proof of self-employment or business", { cond: eq("employment_situation", "Self-employed / Business owner") });
file(S_DOCS, "doc_retirement_proof", "Documentary proof of retirement", { cond: eq("employment_situation", "Retired"), description: "Also give the details of your last employer in section C." });
file(S_DOCS, "doc_student_proof", "Documentary proof of studies (for example an admission letter)", { cond: eq("employment_situation", "Student") });
file(S_DOCS, "doc_never_employed_statement", "Written statement confirming you have never been employed or self-employed", { cond: eq("employment_situation", "Never employed or self-employed") });
// 12. Parents' naturalization certificates and current foreign passports (each parent separately; N/A allowed)
select(S_DOCS, "father_naturalization", "Was your father naturalized?", ["Yes", "No / Not applicable (N/A)"]);
file(S_DOCS, "doc_father_naturalization_certificate", "Father's naturalization certificate", { cond: eq("father_naturalization", "Yes") });
file(S_DOCS, "doc_father_foreign_passport", "Father's current foreign passport", { cond: eq("father_naturalization", "Yes") });
select(S_DOCS, "mother_naturalization", "Was your mother naturalized?", ["Yes", "No / Not applicable (N/A)"]);
file(S_DOCS, "doc_mother_naturalization_certificate", "Mother's naturalization certificate", { cond: eq("mother_naturalization", "Yes") });
file(S_DOCS, "doc_mother_foreign_passport", "Mother's current foreign passport", { cond: eq("mother_naturalization", "Yes") });
// 13. Parents' and spouse's OCI cards (optional). The parents' cards are uploaded once, under item 6 above; this item is for the spouse's card and anything else.
yesNo(S_DOCS, "spouse_holds_oci", "Does your spouse hold an OCI card?", { required: false, cond: SPOUSE_APPLIES });
file(S_DOCS, "doc_family_oci_cards", "Copies of OCI cards of your spouse (and any other family member)", { required: false, description: "Your parents' OCI / PIO cards were already requested above - do not upload them a second time." });
// 14. Previous Indian visa
yesNo(S_DOCS, "previous_indian_visa", "Have you ever been issued an Indian visa?");
file(S_DOCS, "doc_previous_indian_visa", "Copy of the previously issued Indian visa", { cond: eq("previous_indian_visa", "Yes") });
// 15. Proof of US address
select(S_DOCS, "us_address_proof_type", "U.S. address proof you will provide", ["State-issued ID", "Driver's license", "Utility bill (water, gas, electricity or telephone) dated within the last three months", "Valid lease agreement", "Mortgage statement", "Recent tax return"]);
file(S_DOCS, "doc_us_address_proof", "Proof of U.S. address", { description: "Upload the document of the type selected above (only one is needed)." });
// 16. Native address proof (non-US nationals, dual citizens)
const NON_US = all(rule("current_nationality", "not_equals", "United States"), rule("current_nationality", "not_empty"));
const DUAL = all(rule("current_nationality", "not_equals", "United States"), rule("dual_citizen", "equals", "Yes"));
yesNo(S_DOCS, "dual_citizen", "Are you a dual citizen?", { cond: NON_US });
file(S_DOCS, "doc_native_address_proof", "Proof of your address in your native / home country", { cond: NON_US, description: "If proof is unavailable, upload a notarized statement detailing your native address instead." });
group(S_DOCS, "dual_citizen_countries", "Countries of citizenship and native address", {
  itemLabel: "Country", addLabel: "+ Add Country", summaryFields: ["country"], columns: [col("country", "Country", "select", { options: COUNTRY_OPTIONS }), col("address", "Native address in that country", "textarea")],
}, { cond: DUAL, description: "Dual citizens give native-address proof for both countries." });
file(S_DOCS, "doc_native_address_proof_second", "Proof of your address in your second country of citizenship", { cond: DUAL });
// 17. Parents' marriage certificate, apostilled (only for an application based on a parent's eligibility)
file(S_DOCS, "doc_parents_marriage_certificate", "Parents' marriage certificate (apostilled)", { cond: PARENT_BASED, description: "Applies because your application is based on a parent's eligibility. The certificate must be apostilled." });

function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
    ...(spec.cond ? { conditionalLogic: spec.cond } : {}),
  };
  const questionKey = key(spec.name);
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document" } });
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

function buildOciBirthChecklist() {
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
    description: `For adult foreign citizens born as foreign citizens who have never held an Indian passport and are applying for OCI registration.\n\n${INSTRUCTIONS.map((line) => `• ${line}`).join("\n")}`,
    sections: SECTIONS,
    questions,
  };
}

const OCI_BIRTH_CHECKLIST_DEFINITIONS = [buildOciBirthChecklist()];

module.exports = { INSTRUCTIONS, CHECKLIST_KEY, SUBTYPE_LABEL, OCI_BIRTH_CHECKLIST_DEFINITIONS, buildOciBirthChecklist };
