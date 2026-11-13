// OCI - Spouse of Foreign Origin: the FOURTH subtype of the OCI visa type under "Indian Timeline Cases".
//   key "oci_spouse_of_foreign_origin_checklist", question keys "oci_spouse_<name>" (a prefix of its own: no key is shared with the other three subtypes).
// Same shape as the others (ociChecklists.js, ociBirthChecklist.js, ociMinorChecklist.js - all untouched): single-person, client role, NO USCIS forms, NO canonical mappings, not a
// default of the OCI visa type (the subtype's own filing-type entry names this checklist). A conditional question carries conditionalLogic (never required while hidden); one that is
// always shown but sometimes required carries metadata.requireWhen.
//
// STAFF REVIEW: nothing here decides eligibility. An answer that may disqualify (not married, "No" to the spouse-based question, a marriage no longer subsisting, more than one living
// spouse, the spouse's other living spouse) carries metadata.staffReview = [{ questionKey, operator, value, message }]; the Admin answers panel shows an amber "Needs staff review"
// note under that answer. The client sees a non-blocking warning where the rule is a validation rule (marital status).
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");
const { INSTRUCTIONS } = require("./ociBirthChecklist");

const CHECKLIST_KEY = "oci_spouse_of_foreign_origin_checklist";
const SUBTYPE_LABEL = "OCI Checklist for Spouse of Foreign Origin";
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

const key = (name) => `oci_spouse_${name}`;
const rule = (name, operator, value) => ({ questionKey: key(name), operator, ...(value === undefined ? {} : { value }) });
const all = (...rules) => ({ mode: "all", rules, groups: [] });
const any = (...rules) => ({ mode: "any", rules, groups: [] });
const eq = (name, value) => all(rule(name, "equals", value));
const review = (name, operator, value, message) => ({ questionKey: key(name), operator, value, message });

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

const MARRIED_ONLY = [{ type: "regex", value: "^Married$", severity: "warning", message: "This checklist is for an applicant married to an Indian citizen or an OCI cardholder. Your case manager will review your answer." }];
const PAST_DATE = [{ type: "date", value: "past", message: "Enter a date that has already passed." }];

// ---- contact ----
text(S_CONTACT, "full_name", "Applicant Full Name");
phone(S_CONTACT, "phone", "Phone Number");

// ---- A ----
select(S_A, "marital_status", "Marital Status", ["Single / Never Married", "Married", "Divorced", "Widowed"], { rules: MARRIED_ONLY, staffReview: [review("marital_status", "not_equals", "Married", "The applicant is not married - this subtype is for the spouse of an Indian citizen or OCI cardholder.")] });
text(S_A, "distinguishing_mark", "Visible Distinguishing Mark", { required: false, description: "Enter N/A if none." });
select(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", ["Self", "Father", "Mother", "Grandparent", "Great-grandparent"]);
country(S_A, "country_of_birth", "Country of Birth");
text(S_A, "place_of_birth", "Place of Birth (Province/Town/City)");
country(S_A, "current_nationality", "Current Nationality");

// ---- B: parents ----
text(S_B, "father_name", "Father's Full Name");
country(S_B, "father_nationality", "Father's Nationality");
text(S_B, "father_occupation", "Father's Occupation");
text(S_B, "mother_name", "Mother's Full Name");
country(S_B, "mother_nationality", "Mother's Nationality");
text(S_B, "mother_occupation", "Mother's Occupation");

// ---- B: spouse-based application ----
yesNo(S_B, "spouse_based_oci", "Are you applying for OCI on the basis of an Indian spouse / spouse's OCI card?", { staffReview: [review("spouse_based_oci", "equals", "No", "The applicant answered No to the spouse-based OCI question - this subtype does not fit; the subtype is not changed automatically.")] });
select(S_B, "spouse_category", "Spouse Category", ["Indian passport holder", "OCI cardholder"]);
const OCI_SPOUSE = eq("spouse_category", "OCI cardholder");
const INDIAN_SPOUSE = eq("spouse_category", "Indian passport holder");
text(S_B, "spouse_name", "Spouse's Full Name");
date(S_B, "spouse_dob", "Spouse's Date of Birth", { rules: PAST_DATE });
text(S_B, "spouse_passport_number", "Spouse's Passport Number");
date(S_B, "spouse_passport_issue", "Spouse's Passport Issue Date", { rules: PAST_DATE });
date(S_B, "spouse_passport_expiry", "Spouse's Passport Expiry Date", { description: "Must be after the issue date." });
text(S_B, "spouse_passport_place", "Spouse's Passport Issued Place");
longText(S_B, "spouse_address", "Spouse's Local Address / Abroad");
text(S_B, "spouse_oci_number", "Spouse's OCI Number", { cond: OCI_SPOUSE });
date(S_B, "spouse_oci_issue", "Spouse's OCI Issue Date", { cond: OCI_SPOUSE, rules: PAST_DATE });
text(S_B, "spouse_oci_place", "Spouse's OCI Issue Place", { cond: OCI_SPOUSE });
country(S_B, "spouse_nationality", "Spouse's Nationality");
text(S_B, "spouse_occupation", "Spouse's Occupation");
date(S_B, "marriage_date", "Marriage Date", { rules: PAST_DATE });
select(S_B, "marriage_location", "Was the marriage solemnized in India or abroad?", ["India", "Abroad"]);
yesNo(S_B, "marriage_registered", "If married in India, is the marriage registered with the Registrar of Marriages?", { cond: eq("marriage_location", "India") });
yesNo(S_B, "marriage_apostilled", "If married abroad, is the marriage certificate apostilled / certified by the concerned Indian Mission / Post?", { cond: eq("marriage_location", "Abroad") });
yesNo(S_B, "marriage_subsisting", "Is the marriage still subsisting?", { staffReview: [review("marriage_subsisting", "equals", "No", "The marriage is no longer subsisting.")] });
yesNo(S_B, "multiple_living_spouses", "Do you have more than one living spouse?", { staffReview: [review("multiple_living_spouses", "equals", "Yes", "The applicant has more than one living spouse.")] });
group(S_B, "multiple_spouses", "Your other living spouses", {
  itemLabel: "Spouse", addLabel: "+ Add Spouse", summaryFields: ["name", "nationality"],
  columns: [col("name", "Spouse Name"), col("nationality", "Spouse Nationality", "select", { options: COUNTRY_OPTIONS }), col("passport_number", "Spouse Passport Number"), col("oci_card_number", "Spouse OCI Card Number (N/A if none)", "text", { required: false })],
}, { cond: eq("multiple_living_spouses", "Yes") });
yesNo(S_B, "spouse_other_living_spouse", "Does your spouse have any other living spouse?", { staffReview: [review("spouse_other_living_spouse", "equals", "Yes", "The applicant's spouse has another living spouse.")] });
group(S_B, "spouse_other_spouses", "Your spouse's other living spouses", {
  itemLabel: "Other spouse", addLabel: "+ Add Other Spouse", summaryFields: ["name", "nationality"],
  columns: [col("name", "Other Spouse Name"), col("nationality", "Other Spouse Nationality", "select", { options: COUNTRY_OPTIONS }), col("passport_number", "Other Spouse Passport Number"), col("oci_card_number", "Other Spouse OCI Card Number (N/A if none)", "text", { required: false })],
}, { cond: eq("spouse_other_living_spouse", "Yes") });

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

// ---- Documents (5.1 - 5.13) ----
// 5.1 digital photograph, signature
file(S_DOCS, "doc_digital_photo", "Digital Photograph", { description: "White background; dark-colored attire; taken no more than two months ago; shoulders clearly visible; no glare or shadows on the face or anywhere in the photograph; high-quality HD photograph. (If you cannot upload it here, send it by email as instructed by your case manager.)" });
file(S_DOCS, "doc_signature", "Signature", { description: "Sign on a plain white sheet of paper with a dark-colored pen; make sure the signature is clear and properly visible; scan the signed page in high quality. (If you cannot upload it here, send it by email as instructed by your case manager.)" });
// 5.2 physical photographs (an acknowledgement, never an upload)
add(S_DOCS, "physical_photos_ack", "Physical Photographs", "radio", {
  options: [{ label: "I will provide three identical physical passport-sized photographs when the application is lodged", value: "confirmed" }],
  description: "Three identical physical passport-sized photographs, 2 inches x 2 inches, white background, submitted physically at the time of application lodging - do not upload them here.",
});
// 5.3 applicant's passport
file(S_DOCS, "doc_current_passport", "Current Valid Passport of Applicant", { description: "Color copies of the first two and last two pages of your current valid passport. The passport must have at least nine months of validity remaining." });
// 5.4 applicant's birth certificate; country of ISSUANCE asked (it may differ from the country of birth)
file(S_DOCS, "doc_birth_certificate", "Birth Certificate of Applicant", { description: "A copy of your birth certificate. If it was issued outside India it must be apostilled or attested by the concerned foreign mission." });
country(S_DOCS, "birth_certificate_issued_country", "Country that issued the birth certificate");
const ISSUED_OUTSIDE_INDIA = all(rule("birth_certificate_issued_country", "not_empty"), rule("birth_certificate_issued_country", "not_equals", "India"));
select(S_DOCS, "birth_certificate_authentication", "How is the birth certificate authenticated?", ["Apostilled", "Attested by the concerned foreign mission"], { cond: ISSUED_OUTSIDE_INDIA, description: "Issued outside India: one of the two (never both)." });
// 5.5 birth certificates of the parent / grandparent / great-grandparent (several records and uploads)
group(S_DOCS, "ancestor_birth_certificates", "Birth certificates of your parent, grandparent or great-grandparent", {
  itemLabel: "Ancestor", addLabel: "+ Add Ancestor", summaryFields: ["ancestor_name", "relationship"],
  columns: [
    col("ancestor_name", "Ancestor's full name"),
    col("relationship", "Relationship to you", "select", { options: ["Father", "Mother", "Grandfather", "Grandmother", "Great-grandfather", "Great-grandmother"] }),
    col("issued_country", "Country that issued the birth certificate", "select", { options: COUNTRY_OPTIONS }),
    col("authentication", "Authentication", "select", { options: ["Issued in India (copy)", "Apostilled", "Attested by the concerned foreign mission"] }),
  ],
}, { description: "Add one entry per ancestor whose birth certificate establishes your lineage (not every ancestor is needed). Upload the certificates below." });
file(S_DOCS, "doc_ancestor_birth_certificates", "Birth certificates of the ancestors listed above", { description: "A certificate issued in India: a copy. A certificate issued outside India: apostilled or attested by the concerned foreign mission. Upload as many as needed." });
file(S_DOCS, "doc_ancestor_authentication_evidence", "Apostille / attestation evidence for those certificates", { required: false, description: "Only for a certificate issued outside India, if the apostille or attestation is a separate page." });
// 5.6 marriage certificate (evidence depends on where it was solemnized)
file(S_DOCS, "doc_marriage_certificate", "Marriage Certificate", { description: "Solemnized in India: a certificate issued by the Marriage Registrar (a certificate from a religious body is not acceptable). Solemnized outside India: a certificate apostilled or attested by the concerned foreign mission / post." });
yesNo(S_DOCS, "marriage_certificate_not_english", "Is the marriage certificate in a language other than English?", { required: false });
file(S_DOCS, "doc_marriage_translation", "English translation of the marriage certificate", { cond: eq("marriage_certificate_not_english", "Yes"), description: "Prepared by an authorized translator." });
// 5.7 evidence based on the spouse's status (only the package for the chosen category)
file(S_DOCS, "doc_spouse_oci_passport", "Spouse's current valid passport", { cond: OCI_SPOUSE });
file(S_DOCS, "doc_spouse_oci_card", "Spouse's OCI card", { cond: OCI_SPOUSE });
file(S_DOCS, "doc_spouse_oci_basis_documents", "Documents on the basis of which the spouse's OCI card was issued", { cond: OCI_SPOUSE });
file(S_DOCS, "doc_spouse_indian_passport", "Spouse's valid Indian passport", { cond: INDIAN_SPOUSE, description: "Copy including the first two and last two pages." });
file(S_DOCS, "doc_spouse_legal_status", "Spouse's current legal-status document", { cond: INDIAN_SPOUSE, required: false, description: "Where applicable." });
// 5.8 legal status in the US (non-US passport holders)
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
// 5.9 proof of name change
yesNo(S_DOCS, "used_previous_name", "Has the applicant ever used a previous name or legally changed their name?");
group(S_DOCS, "previous_names", "Previous name(s)", { itemLabel: "Previous name", addLabel: "+ Add Name", summaryFields: ["name"], columns: [col("name", "Previous name")] }, { cond: eq("used_previous_name", "Yes"), description: "Previous names must be stated in the application." });
file(S_DOCS, "doc_name_change", "Proof of name change", { cond: eq("used_previous_name", "Yes"), description: "A legal name-change document from a local court, or a duly notarized affidavit." });
// 5.10 employment / work verification
file(S_DOCS, "doc_employer_letter", "Employer letter describing your job profile", { cond: eq("employment_situation", "Employed") });
file(S_DOCS, "doc_self_employment", "Documentary proof of self-employment or business", { cond: eq("employment_situation", "Self-employed / Business owner") });
file(S_DOCS, "doc_retirement_proof", "Documentary proof of retirement", { cond: eq("employment_situation", "Retired"), description: "Also give the details of your last employer in section C." });
file(S_DOCS, "doc_student_proof", "Documentary proof of studies (for example an admission letter)", { cond: eq("employment_situation", "Student") });
file(S_DOCS, "doc_never_employed_statement", "Written statement confirming you have never been employed or self-employed", { cond: eq("employment_situation", "Never employed or self-employed") });
// 5.11 previous Indian visa
yesNo(S_DOCS, "previous_indian_visa", "Has the applicant ever been issued an Indian visa?");
file(S_DOCS, "doc_previous_indian_visa", "Copy of the previously issued Indian visa", { cond: eq("previous_indian_visa", "Yes") });
// 5.12 proof of US address
select(S_DOCS, "us_address_proof_type", "U.S. address proof you will provide", ["State-issued ID", "Driver's license", "Utility bill (water, gas, electricity or telephone) dated within the last three months", "Valid lease agreement", "Mortgage statement", "Recent tax return"]);
file(S_DOCS, "doc_us_address_proof", "Proof of U.S. address", { description: "Upload the document of the type selected above (only one is needed)." });
// 5.13 native address proof (non-US nationals, dual citizens)
const NON_US = all(rule("current_nationality", "not_equals", "United States"), rule("current_nationality", "not_empty"));
const DUAL = all(rule("current_nationality", "not_equals", "United States"), rule("dual_citizen", "equals", "Yes"));
yesNo(S_DOCS, "dual_citizen", "Is the applicant a dual citizen?", { cond: NON_US });
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
    ...(spec.rules ? { validationRules: spec.rules } : {}),
  };
  const questionKey = key(spec.name);
  const reviewMeta = spec.staffReview ? { staffReview: spec.staffReview } : {};
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document" } });
  if (spec.type !== "repeating_group") return buildQuestion(questionKey, spec.label, spec.type, spec.section, order, { ...common, metadata: { ...reviewMeta } });
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

function buildOciSpouseChecklist() {
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
    description: `For eligible foreign-origin applicants applying for OCI registration through marriage to an Indian citizen or an OCI cardholder.\n\n${INSTRUCTIONS.map((line) => `• ${line}`).join("\n")}`,
    sections: SECTIONS,
    questions,
  };
}

const OCI_SPOUSE_CHECKLIST_DEFINITIONS = [buildOciSpouseChecklist()];

module.exports = { INSTRUCTIONS, CHECKLIST_KEY, SUBTYPE_LABEL, OCI_SPOUSE_CHECKLIST_DEFINITIONS, buildOciSpouseChecklist };
