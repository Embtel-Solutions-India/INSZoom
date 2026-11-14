// OCI - Spouse of Foreign Origin: the FOURTH subtype of the OCI visa type under "Indian Timeline Cases".
//   key "oci_spouse_of_foreign_origin_checklist", question keys "oci_spouse_<name>" (a prefix of its own: no key is shared with the other three subtypes).
// Same shape as the others: single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the OCI visa type (the subtype's own filing-type entry names
// this checklist). Exactly the questions of the supplied checklist, every one ALWAYS visible (no show-when rules); core items required, situational ones optional.
//
// STAFF REVIEW: nothing here decides eligibility. An answer that may disqualify (not married, "No" to the spouse-based question, a marriage no longer subsisting, more than one living
// spouse, the spouse's other living spouse) carries metadata.staffReview = [{ questionKey, operator, value, message }]; the Admin answers panel shows an amber "Needs staff review"
// note under that answer. The client sees a non-blocking warning where the rule is a validation rule (marital status).
const { buildQuestion, PHYSICAL_PHOTOS_OPTIONS } = require("./definitionHelpers");
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
text(S_A, "distinguishing_mark", "Visible Distinguishing Mark", { required: false });
text(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", { description: "e.g., Self / Father / Mother / Grandparent" });
country(S_A, "country_of_birth", "Country of Birth");
text(S_A, "place_of_birth", "Place of Birth (Province/Town/City)");
country(S_A, "current_nationality", "Current Nationality");

// ---- B: parents ----
text(S_B, "father_name", "Father's Full Name");
country(S_B, "father_nationality", "Father's Nationality");
text(S_B, "father_occupation", "Father's Occupation", { required: false });
text(S_B, "mother_name", "Mother's Full Name");
country(S_B, "mother_nationality", "Mother's Nationality");
text(S_B, "mother_occupation", "Mother's Occupation", { required: false });

// ---- B: spouse-based application ----
yesNo(S_B, "spouse_based_oci", "Are you applying OCI on the basis of an Indian Spouse/Spouse's OCI card?", { staffReview: [review("spouse_based_oci", "equals", "No", "The applicant answered No to the spouse-based OCI question - this subtype does not fit; the subtype is not changed automatically.")] });
text(S_B, "spouse_name", "Spouse's Full Name");
date(S_B, "spouse_dob", "Spouse's Date of Birth", { rules: PAST_DATE });
text(S_B, "spouse_passport_number", "Spouse's Passport number");
date(S_B, "spouse_passport_issue", "Spouse's Passport issue date (DD/MM/YYYY)", { rules: PAST_DATE });
date(S_B, "spouse_passport_expiry", "Spouse's Passport expiry date (DD/MM/YYYY)");
text(S_B, "spouse_passport_place", "Spouse's Passport issued place");
longText(S_B, "spouse_address", "Spouse's local address / abroad");
// the OCI details exist only if the spouse holds an OCI card (an Indian passport holder has none): optional, N/A where it does not apply
text(S_B, "spouse_oci_number", "Spouse's OCI number", { required: false });
date(S_B, "spouse_oci_issue", "Spouse's OCI issue date", { required: false, rules: PAST_DATE });
text(S_B, "spouse_oci_place", "Spouse's OCI issue place", { required: false });
country(S_B, "spouse_nationality", "Spouse's Nationality");
text(S_B, "spouse_occupation", "Spouse's Occupation");
date(S_B, "marriage_date", "Marriage Date", { rules: PAST_DATE });
select(S_B, "marriage_location", "Whether married in India or abroad / outside India?", ["India", "Abroad"]);
yesNo(S_B, "marriage_registered", "If marriage is solemnised in India, whether the marriage is registered with the Registrar of Marriages?", { required: false });
yesNo(S_B, "marriage_apostilled", "If marriage is solemnised abroad / Outside India, whether the marriage certificate is Apostilled / certified by the Indian Mission / Post Concerned?", { required: false });
yesNo(S_B, "marriage_subsisting", "Whether marriage still subsisting?", { staffReview: [review("marriage_subsisting", "equals", "No", "The marriage is no longer subsisting.")] });
yesNo(S_B, "multiple_living_spouses", "Whether you have more than one living spouse?", { staffReview: [review("multiple_living_spouses", "equals", "Yes", "The applicant has more than one living spouse.")] });
group(S_B, "multiple_spouses", "If yes, please provide details of spouse (you have more than one living spouse)", {
  itemLabel: "Spouse", addLabel: "+ Add Spouse", summaryFields: ["name", "nationality"],
  columns: [col("name", "Name"), col("nationality", "Nationality", "select", { options: COUNTRY_OPTIONS }), col("passport_number", "Passport no"), col("oci_card_number", "OCI card no", "text", { required: false })],
}, { required: false, description: "Fill in only if you answered Yes above." });
yesNo(S_B, "spouse_other_living_spouse", "Whether your spouse has any other living spouse?", { staffReview: [review("spouse_other_living_spouse", "equals", "Yes", "The applicant's spouse has another living spouse.")] });
group(S_B, "spouse_other_spouses", "If yes, please provide details of spouse (your spouse has another living spouse)", {
  itemLabel: "Other spouse", addLabel: "+ Add Other Spouse", summaryFields: ["name", "nationality"],
  columns: [col("name", "Name"), col("nationality", "Nationality", "select", { options: COUNTRY_OPTIONS }), col("passport_number", "Passport no"), col("oci_card_number", "OCI card no", "text", { required: false })],
}, { required: false, description: "Fill in only if you answered Yes above." });

// ---- C ----
text(S_C, "current_occupation", "Current Occupation / Designation");
longText(S_C, "employer_name_address", "Employer Name & Office Address", { required: false });
phone(S_C, "employer_phone", "Employer Contact Number", { required: false });
text(S_C, "retired_organization", "If Retired, Dept / Office / Organization", { required: false });

// ---- D ----
yesNo(S_D, "prior_oci_applied", "Have you or any member of your family applied for OCI registration earlier?");
group(S_D, "prior_oci_applications", "If Yes, details", {
  itemLabel: "Application", addLabel: "+ Add Application", summaryFields: ["name", "reference_number"],
  columns: [col("name", "Name / Relationship"), col("reference_number", "Reference no."), col("date_applied", "Date when applied (DD/MM/YYYY)", "date"), col("place_applied", "Place where applied"), col("status", "Status")],
}, { required: false, description: "Fill in only if you answered Yes above." });
yesNo(S_D, "oci_surrendered_or_cancelled", "Have you ever surrendered or had a previous OCI Card cancelled?");
longText(S_D, "oci_surrender_details", "If Yes, details", { required: false, description: "Fill in only if you answered Yes above." });
group(S_D, "relatives_in_india", "Details of family members / relatives currently residing in India (if any)", {
  itemLabel: "Relative", addLabel: "+ Add Relative", summaryFields: ["name", "relationship"],
  columns: [col("name", "Relative Name"), col("relationship", "Relationship"), col("age", "Age", "number", { min: 0, max: 130, step: "1" }), col("address", "Present Address in India", "textarea")],
}, { required: false, description: "Leave empty if you have no relatives currently residing in India." });

// ---- Documents: exactly the 13 supplied document requirements, one item each, with its guidelines as the description ----
// Core documents are required; the ones the guidelines describe as "may be provided" / "if ever obtained" are optional (the applicant marks N/A when a category does not apply).
const lines = (...items) => items.join("\n");
file(S_DOCS, "doc_photo_signature", "Digital Photograph & Signature", { description: lines(
  "Part 1: Photograph Requirements",
  "- Use a white background and wear dark-colored attire.",
  "- The photograph must be no older than two months.",
  "- Your shoulders must be clearly visible.",
  "- Ensure there is no glare or shadow on your face or anywhere in the photograph.",
  "- Please upload a high-quality HD photograph here.",
  "Part 2: Signature Requirements",
  "- Please sign on a plain white sheet of paper using a dark-colored pen.",
  "- Ensure your signature is clear and properly visible.",
  "- Please scan the signed page in high quality and upload it here."
) });
add(S_DOCS, "physical_photos_ack", "Physical Photographs", "radio", {
  options: PHYSICAL_PHOTOS_OPTIONS,
  description: "Three (3) identical physical passport-sized photographs (2 inch x 2 inch, white background) to be submitted at the time of application lodging.",
});
file(S_DOCS, "doc_current_passport", "Current Valid Passport", { description: "Color copy of the first two and last two pages of your current valid passport (must have at least 9 months validity remaining)." });
file(S_DOCS, "doc_birth_certificate", "Copy of Birth Certificate of applicant (Apostille)", { description: "If the applicant's birth certificate was issued outside of India, it must be apostilled or attested by the concerned foreign Mission." });
file(S_DOCS, "doc_ancestors_birth_certificates", "Copy of Birth certificate of applicant's parents or grandparents or great grandparents (Apostille)", { description: lines(
  "If the birth certificate was issued in India, copy of birth certificate is required",
  "If the birth certificate was issued outside of India, it must be apostilled or attested by concerned foreign mission"
) });
file(S_DOCS, "doc_marriage_certificate", "Copy of Marriage certificate", { description: lines(
  "If the marriage is solemnized in India, a Marriage certificate issued by Marriage Registrar is required.",
  "If the marriage is solemnized in foreign country, it should be apostilled/ attested by the concerned foreign mission/post.",
  "If the marriage certificate is in any foreign language other than English, it should be translated in English by an authorized translator."
) });
file(S_DOCS, "doc_spouse_documents", "In the case of spouse of an OCI Cardholder / In the case of Spouse of an Indian passport holder", { description: lines(
  "In the case of spouse of an OCI Cardholder: Copy of the present valid Passport of the spouse and copy of the OCI Card of the spouse and copies of the documents upon which the OCI Card was issued to the spouse.",
  "In the case of Spouse of an Indian passport holder: Copy of the valid Indian passport copy of the spouse (first two and last two pages). Along with a copy of current legal status."
) });
// The platform makes any item with "passport" in its name required (passportInformation.js); this one applies only to non-US passport holders, so it opts out explicitly: always shown, optional.
file(S_DOCS, "doc_legal_status_usa", "Legal Status in USA (Non-US Passport Holders)", { required: false, passportOptOut: true, description: "Color copy of Green Card (Front & Back), valid EAD card, or long-term US Visa. If extension is pending, submit I-797A / I-797C Notice along with the expired visa." });
file(S_DOCS, "doc_name_change", "Proof of Name Change", { required: false, description: "Legal Name Change Document from a local court or a duly notarized affidavit. Previous names must be stated in the application." });
file(S_DOCS, "doc_employment_letter", "Copy of Employment / Work letter", { required: false, description: lines(
  "If an applicant is employed a letter from the employer describing the job profile of the applicant may be provided.",
  "If the applicant is self-employed / doing business, some documentary proof of self employment/business may be provided.",
  "If the applicant is retired, some documentary proof regarding retirement and details of the last employer may be provided.",
  "If the applicant is a student, some documentary proof, e.g. admission letter, may be provided.",
  "If the applicant has never been employed/self-employed, a written statement may be submitted."
) });
file(S_DOCS, "doc_previous_indian_visa", "Previous Indian Visa", { required: false, description: "Copy of previously issued Indian Visa, if ever obtained." });
file(S_DOCS, "doc_us_address_proof", "Proof of USA Address", { description: "State-issued ID, Driver's License, Utility Bill (Water/Gas/Electric/Phone - under 3 months old), Valid Lease Agreement, Mortgage Statement, or recent Tax Return." });
file(S_DOCS, "doc_native_address_proof", "Native Address Proof (Non-US Nationals)", { required: false, description: "Address proof from native/home country. If unavailable, submit a notarized statement detailing native address. Dual citizens must provide native address proof for both countries." });

function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
    ...(spec.rules ? { validationRules: spec.rules } : {}),
  };
  const questionKey = key(spec.name);
  const reviewMeta = spec.staffReview ? { staffReview: spec.staffReview } : {};
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document", ...(spec.passportOptOut ? { passportInformation: false } : {}) } });
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
