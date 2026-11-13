// Adult Foreign citizen and never held Indian passport (never held an Indian passport): the SECOND subtype of the OCI visa type under "Indian Timeline Cases".
//   key "oci_adult_foreign_citizen_by_birth_checklist", question keys "oci_birth_<name>" (a different prefix from the first subtype, so the two never collide).
// Same shape as the first subtype (questionnaires/ociChecklists.js, which is untouched): single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the OCI
// Every question is always visible to the client (no show-when rules) and optional everywhere, including Admin.
const { buildQuestion, PHYSICAL_PHOTOS_OPTIONS } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");
const INSTRUCTIONS = [
  "Complete the questionnaire thoroughly to enable accurate petition preparation.",
  "Mark N/A for questions or document categories that do not apply.",
  "All submitted supporting document copies must be in color.",
  "Provide valid documents only. Expired documents or inaccurate details may result in application delays.",
];

const CHECKLIST_KEY = "oci_adult_foreign_citizen_by_birth_checklist";
const SUBTYPE_LABEL = "Adult Foreign citizen and never held Indian passport";
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

// ---- 1. Applicant Basic Contact Information ----
text(S_CONTACT, "full_name", "Applicant Full Name");
phone(S_CONTACT, "phone", "Phone Number");

// ---- 3A. Personal & Background Details ----
select(S_A, "marital_status", "Marital Status", ["Single / Never Married", "Married", "Divorced", "Widowed", "Separated"]);
text(S_A, "distinguishing_mark", "Visible Distinguishing Mark", { required: false, description: "Enter N/A if none." });
select(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", ["Self", "Father", "Mother", "Grandparent", "Great-grandparent"], { description: "e.g., Self / Father / Mother / Grandparent" });
country(S_A, "country_of_birth", "Country of Birth");
text(S_A, "place_of_birth", "Place of Birth (Province/Town/City)");
country(S_A, "current_nationality", "Current Nationality");

// ---- 3B. Family Information ----
text(S_B, "father_name", "Father's Full Name");
country(S_B, "father_nationality", "Father's Nationality");
text(S_B, "father_occupation", "Father's Occupation", { required: false });
text(S_B, "mother_name", "Mother's Full Name");
country(S_B, "mother_nationality", "Mother's Nationality");
text(S_B, "mother_occupation", "Mother's Occupation", { required: false });
yesNo(S_B, "spouse_based_oci", "Are you applying for OCI on the basis of an Indian spouse / spouse's OCI card?");
text(S_B, "spouse_name", "Spouse's Full Name", { required: false, description: "Mark N/A if not applicable." });
date(S_B, "spouse_dob", "Spouse's Date of Birth", { required: false });
country(S_B, "spouse_nationality", "Spouse's Nationality", { required: false });
text(S_B, "spouse_occupation", "Spouse's Occupation", { required: false });
date(S_B, "marriage_date", "Marriage Date", { required: false });

// ---- 3C. Employment & Occupation Details ----
text(S_C, "current_occupation", "Current Occupation / Designation", { description: "Enter N/A if not applicable." });
longText(S_C, "employer_name_address", "Employer Name and Office Address", { required: false });
phone(S_C, "employer_phone", "Employer Contact Number", { required: false });
text(S_C, "retired_organization", "If Retired, Dept / Office / Organization", { required: false });

// ---- 3D. Prior OCI History & Relatives in India ----
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

// ---- 2. Required Document Checklist: exactly 17 items, in the questionnaire's order ----
// Every question is always visible to the client (no show-when rules). Each category is ONE entry (a file question accepts several files);
// the guideline text from the questionnaire is the hint. All copies must be in COLOR and valid (not expired).
// `passportInformation: false` on the three situational items whose title mentions a passport (see passportInformation.js).
const PASSPORT_OPT_OUT = new Set(["doc_legal_status_usa", "doc_spouse_passport", "doc_parents_naturalization_passports"]);
const doc = (name, label, description, required = false) => file(S_DOCS, name, label, { required, description, ...(PASSPORT_OPT_OUT.has(name) ? { passportOptOut: true } : {}) });
doc("doc_digital_photo_signature", "1. Digital Photograph & Signature",
  "Part 1 - Photograph: use a white background and wear dark-colored attire; the photograph must be no older than two months; your shoulders must be clearly visible; ensure there is no glare or shadow on your face or anywhere in the photograph; provide a high-quality HD photograph (upload it here). Part 2 - Signature: sign on a plain white sheet of paper using a dark-colored pen; ensure your signature is clear and properly visible; scan the signed page in high quality (upload it here).", true);
add(S_DOCS, "physical_photos_ack", "2. Physical Photographs", "radio", {
  required: true,
  options: PHYSICAL_PHOTOS_OPTIONS,
  description: "Three (3) identical physical passport-sized photographs (2 inch x 2 inch, white background) to be submitted at the time of application lodging. Do not upload them here.",
});
doc("doc_current_passport", "3. Current Valid Passport", "Color copy of the first two and last two pages of your current valid passport (must have at least 9 months validity remaining).", true);
doc("doc_birth_certificate", "4. Birth Certificate", "Official copy. If born outside India, it must be apostilled by the relevant foreign government authority or attested by the appropriate foreign mission. The birth certificate must reflect: names of parents; date of birth; and nationality. Birth certificates issued by hospitals are not acceptable.", true);
doc("doc_indian_origin_evidence", "5. Copy of Evidence of Indian origin of parents or grandparents or great grandparents",
  "Copies of Indian Passports - FIRST 2 AND LAST 2 PAGES; copy of the Domicile Certificate issued by the Competent Authority; copy of the Nativity Certificate from the Competent Authority; OCI card of parents along with documents on the basis of which PIO/OCI card was issued; any other proof substantiating the request. Note: if proof of Indian origin of parents is not available, the documents provided should be sufficient to establish family lineage to prove Indian origin. If family lineage to prove Indian origin is not established, the application is liable to be rejected.", true);
doc("doc_parents_oci_pio_cards", "6. Parents' OCI / PIO Cards", "Copies of PIO/OCI cards of parents (if applicable) along with the supporting documents used when their cards were issued.");
doc("doc_legal_status_usa", "7. Legal Status in USA (Non-US Passport Holders)", "Color copy of Green Card (front & back), valid EAD card, or long-term US Visa. If extension is pending, submit I-797A / I-797C Notice along with the expired visa.");
doc("doc_marital_status_proof", "8. Proof of Marital Status", "Marriage Certificate, Divorce Decree, or Death Certificate (as applicable). Note: Parents' Marriage Certificate is required if applying based on parents' eligibility.");
doc("doc_spouse_passport", "9. Current Valid Passport of Spouse", "Please provide a clear scanned copy of your spouse's valid passport (bio-data page).");
doc("doc_name_change", "10. Proof of Name Change", "Legal Name Change Document from a local court or a duly notarized affidavit. Previous names must be stated in the application.");
doc("doc_employment_verification", "11. Employment / Work Verification",
  "If employed, a letter from the employer describing the job profile may be provided. If self-employed / doing business, some documentary proof of self-employment/business may be provided. If retired, some documentary proof regarding retirement and details of the last employer may be provided. If a student, some documentary proof, e.g. admission letter, may be provided. If never employed/self-employed, a written statement may be submitted.");
doc("doc_parents_naturalization_passports", "12. Parents' Naturalization & Passports", "Copies of Naturalization Certificates and current foreign passports of parents.");
doc("doc_parents_spouse_oci_cards", "13. Parents' & Spouse OCI Cards", "Copies of OCI cards issued to parents and/or spouse (if applicable and available).");
doc("doc_previous_indian_visa", "14. Previous Indian Visa", "Copy of previously issued Indian Visa, if ever obtained.");
doc("doc_us_address_proof", "15. Proof of USA Address", "State-issued ID, Driver's License, Utility Bill (Water/Gas/Electric/Phone - under 3 months old), Valid Lease Agreement, Mortgage Statement, or recent Tax Return.", true);
doc("doc_native_address_proof", "16. Native Address Proof (Non-US Nationals)", "Address proof from native/home country. If unavailable, submit a notarized statement detailing native address. Dual citizens must provide native address proof for both countries.");
doc("doc_parents_marriage_certificate", "17. Parent's Marriage Certificate (Apostilled)", "This document applies only if the applicant is applying for OCI applications based on their parents.");


function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
  };
  const questionKey = key(spec.name);
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document", ...(spec.passportOptOut ? { passportInformation: false } : {}) } });
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
