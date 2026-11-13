// OCI (Overseas Citizen of India) - the "Indian Timeline Cases" section. One checklist per OCI SUBTYPE; this file holds the first:
//   Adult Foreign citizen and held Indian passport   (key "oci_adult_former_indian_passport_checklist")
//
// A single-person case type (like GC-NVC / the single-party filings): ONE client questionnaire answered by the applicant, NO USCIS forms, NO canonical mappings (nothing here
// carries a canonicalPath). The case manager creates the case in Admin (OCI + the subtype), the checklist is assigned to the client by the single-party filing mechanism
// (single-party-filings/single-party-filing.controller.js, registry config/filingTypes.js), the client answers / uploads / saves and submits, and Admin reads the same Answer rows.
//
// The checklist is NOT a default template of the OCI visa type (isDefault false): a later OCI subtype must never be handed the wrong subtype's checklist; the subtype's
// own filing-type entry names exactly which checklist a case gets.
//
// Exactly the questions of the supplied checklist, every one ALWAYS visible (no show-when rules); core items required, situational ones optional. "N/A" is an ordinary text
// answer wherever a question is free text (the opening instruction).
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");

const CHECKLIST_KEY = "oci_adult_former_indian_passport_checklist";
const OCI_VISA_TYPE = "OCI";
const SUBTYPE_LABEL = "Adult Foreign citizen and held Indian passport";
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));

const S_INSTRUCTIONS = "Instructions";
const S_CONTACT = "Applicant Contact Information";
const S_A = "A. Personal and Background Details";
const S_B = "B. Family Information";
const S_C = "C. Employment and Occupation Details";
const S_D = "D. Prior OCI History and Relatives in India";
const S_DOCS = "Required Documents";
const SECTIONS = [S_INSTRUCTIONS, S_CONTACT, S_A, S_B, S_C, S_D, S_DOCS];

const INSTRUCTIONS = [
  "Complete the questionnaire thoroughly to enable accurate petition preparation.",
  "Enter N/A for questions or document categories that do not apply.",
  "All supporting document copies must be provided in color.",
  "Submit valid documents only. Expired documents or inaccurate information may cause application delays.",
];

const key = (name) => `oci_adult_${name}`;

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

// ---- Instructions (informational; shown at the top of the checklist - not answer fields) ----
// (carried by the checklist description below)

// ---- 1. Applicant Basic Contact Information ----
text(S_CONTACT, "full_name", "Applicant Full Name");
phone(S_CONTACT, "phone", "Phone Number");

// ---- 3A. Personal & Background Details ----
select(S_A, "marital_status", "Marital Status", ["Single / Never Married", "Married", "Divorced", "Widowed", "Separated"]);
text(S_A, "distinguishing_mark", "Visible Distinguishing Mark", { required: false });
text(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", { description: "e.g., Self / Father / Mother / Grandparent" });
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
yesNo(S_B, "spouse_based_oci", "Are you applying OCI on the basis of an Indian Spouse/Spouse's OCI card?");
text(S_B, "spouse_name", "Spouse's Full Name", { required: false });
date(S_B, "spouse_dob", "Spouse's Date of Birth", { required: false });
country(S_B, "spouse_nationality", "Spouse's Nationality", { required: false });
text(S_B, "spouse_occupation", "Spouse's Occupation", { required: false });
date(S_B, "marriage_date", "Marriage Date", { required: false });

// ---- 3C. Employment & Occupation Details ----
text(S_C, "current_occupation", "Current Occupation / Designation");
longText(S_C, "employer_name_address", "Employer Name & Office Address", { required: false });
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

// ---- 2. Required Document Checklist: exactly 14 items, in the questionnaire's order ----
// Every question is always visible (no show-when rules). Each category is ONE entry (a file question accepts several files); the questionnaire's guideline text is the hint.
// Core documents are required; the ones the guidelines describe as situational ("only applies to", "if applicable", "if ever obtained") are optional.
const lines = (...items) => items.join("\n");
// The platform makes any item with "passport" in its name required (passportInformation.js); this one applies only to non-US passport holders, so it opts out explicitly.
const PASSPORT_OPT_OUT = new Set(["doc_legal_status_usa"]);
const doc = (name, label, description, required = false) => file(S_DOCS, name, label, { required, description, ...(PASSPORT_OPT_OUT.has(name) ? { passportOptOut: true } : {}) });
doc("doc_photo_signature", "Digital Photograph & Signature", lines(
  "Part 1: Photograph Requirements",
  "- Use a white background and wear dark-colored attire.",
  "- The photograph must be no older than two months.",
  "- Your shoulders must be clearly visible.",
  "- Ensure there is no glare or shadow on your face or anywhere in the photograph.",
  "- Please provide a high-quality HD photograph via email.",
  "Part 2: Signature Requirements",
  "- Please sign on a plain white sheet of paper using a dark-colored pen.",
  "- Ensure your signature is clear and properly visible.",
  "- Please scan the signed page in high quality and send it to us via email."
), true);
add(S_DOCS, "physical_photos_ack", "Physical Photographs", "radio", {
  options: [{ label: "I will provide three identical physical passport-sized photographs when the application is lodged", value: "confirmed" }],
  description: "Three (3) identical physical passport-sized photographs (2 inch x 2 inch, white background) to be submitted at the time of application lodging.",
});
doc("doc_current_passport", "Current Valid Passport", "Color copy of the first two and last two pages of your current valid passport (must have at least 9 months validity remaining).", true);
doc("doc_last_indian_passport", "Copy of Indian passport", "The last held Indian Passport", true);
doc("doc_naturalization_certificate", "Copy of Naturalization Certificate", "The naturalization certificate should be duly signed at the designated space. If the applicant has acquired naturalization through parents and the applicant doesn't possess separate naturalization certificate, a notarized affidavit signed by both parents may be submitted along with copies of their naturalization certificates", true);
doc("doc_surrender_certificate", "Copy of Surrender Certificate", "Note: This only applies to applicants who were naturalized from 2010 onwards.");
doc("doc_legal_status_usa", "Legal Status in USA (Non-US Passport Holders)", "Color copy of Green Card (Front & Back), valid EAD card, or long-term US Visa. If extension is pending, submit I-797A / I-797C Notice along with the expired visa.");
doc("doc_marital_status_proof", "Proof of Marital Status", lines(
  "Copy of the marriage certificate, if married.",
  "Copy of the divorce decree, if divorced. If re-married, include a copy of the marriage certificate.",
  "Copy of the Death certificate, if the spouse is deceased.",
  "If proof of marital status is not available, a notarized affidavit may be submitted, thereby confirming the marital status and indicating the reasons for nonavailability of requisite certificate."
));
doc("doc_name_change", "Proof of Name Change", "Legal Name Change Document from a local court or a duly notarized affidavit. Previous names must be stated in the application.");
doc("doc_employment_verification", "Employment / Work Verification", lines(
  "If an applicant is employed, a letter from the employer describing the job profile of the applicant may be provided.",
  "If the applicant is self-employed / doing business, some documentary proof of self employment/business may be provided.",
  "If the applicant is retired, some documentary proof regarding retirement and details of the last employer may be provided.",
  "If the applicant is a student, some documentary proof, e. g. admission letter, may be provided.",
  "If the applicant has never been employed/self-employed, a written statement may be submitted."
));
doc("doc_parents_spouse_oci_cards", "Parents' & Spouse OCI Cards", "Copies of OCI cards issued to parents and/or spouse (if applicable and available).");
doc("doc_previous_indian_visa", "Previous Indian Visa", "Copy of previously issued Indian Visa, if ever obtained.");
doc("doc_us_address_proof", "Proof of USA Address", "State-issued ID, Driver's License, Utility Bill (Water/Gas/Electric/Phone - under 3 months old), Valid Lease Agreement, Mortgage Statement, or recent Tax Return.", true);
doc("doc_native_address_proof", "Native Address Proof (Non-US Nationals)", "Address proof from native/home country. If unavailable, submit a notarized statement detailing native address. Dual citizens must provide native address proof for both countries.");


function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
  };
  const questionKey = key(spec.name);
  if (spec.type === "file") {
    return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document", ...(spec.passportOptOut ? { passportInformation: false } : {}) } });
  }
  if (spec.type === "number") {
    return buildQuestion(questionKey, spec.label, "number", spec.section, order, { ...common, metadata: { min: spec.min, max: spec.max, step: spec.step } });
  }
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

function buildOciAdultChecklist() {
  const counters = new Map();
  const questions = SPECS.map((spec) => {
    const order = (counters.get(spec.section) || 0) + 1;
    counters.set(spec.section, order);
    return buildField(spec, order);
  });
  return {
    key: CHECKLIST_KEY,
    title: SUBTYPE_LABEL,
    visaType: OCI_VISA_TYPE,
    visaTypes: [OCI_VISA_TYPE],
    checklistRole: "client",
    isDefault: false, // assigned only by the OCI subtype's own filing type (never to another OCI subtype)
    reconcileMetadata: true,
    description: `For adult foreign citizens who previously held an Indian passport and are applying for Overseas Citizen of India (OCI) registration.\n\n${INSTRUCTIONS.map((line) => `• ${line}`).join("\n")}`,
    sections: SECTIONS.filter((section) => section !== S_INSTRUCTIONS),
    questions,
  };
}

const OCI_CHECKLIST_DEFINITIONS = [buildOciAdultChecklist()];

module.exports = { CHECKLIST_KEY, OCI_VISA_TYPE, SUBTYPE_LABEL, INSTRUCTIONS, OCI_CHECKLIST_DEFINITIONS, buildOciAdultChecklist };
