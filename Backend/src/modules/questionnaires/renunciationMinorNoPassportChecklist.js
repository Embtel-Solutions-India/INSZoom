// Renunciation (Indian Timeline Cases) -> subtype 1 "Minor without Indian passport": Renunciation Checklist & Questionnaire (Minor without Indian Passport Holder).
//   key "renunciation_minor_without_indian_passport_checklist", question keys "renmin_<name>".
// Checklist-only like the OCI / E-Tourist subtypes: single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the visa type - the subtype's own filing type
// (config/filingTypes.js) names this checklist, so a case gets it ONLY when this subtype is selected. The checklist is named after its subtype, to avoid confusion.
// Exactly the questions of the supplied checklist, every one ALWAYS visible (no show-when rules); core items required, situational ones optional. The supplied text is kept
// as hints; the agency banner ("INDIAN CITIZENSHIP RENUNCIATION SERVICE") is not included.
const { buildQuestion, PHYSICAL_PHOTOS_OPTIONS } = require("./definitionHelpers");

const CHECKLIST_KEY = "renunciation_minor_without_indian_passport_checklist";
const SUBTYPE_LABEL = "Minor without Indian passport";
const CHECKLIST_TITLE = SUBTYPE_LABEL;
const VISA_TYPE = "RENUNCIATION";
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const S0 = "Applicant Details";
const S1 = "1. Renunciation Document Checklist";
const S2 = "2. Applicant Personal Particulars";
const S3 = "3. Family Details";
const S4 = "4. Emergency Contact Details";
const SECTIONS = [S0, S1, S2, S3, S4];

const EDUCATION = ["10th Pass and Above", "7th Pass or Less", "Between 8th and 9th Standard", "Graduate and Above"];

const key = (name) => `renmin_${name}`;
const SPECS = [];
const add = (section, name, label, type, extras = {}) => SPECS.push({ section, name, label, type, required: extras.required !== false, ...extras });
const text = (s, n, l, e) => add(s, n, l, "text", e);
const longText = (s, n, l, e) => add(s, n, l, "textarea", e);
const phone = (s, n, l, e) => add(s, n, l, "phone", e);
const email = (s, n, l, e) => add(s, n, l, "email", e);
const date = (s, n, l, e) => add(s, n, l, "date", { rules: [{ type: "date", message: "Enter a valid date." }], ...e });
const radio = (s, n, l, options, e) => add(s, n, l, "radio", { options: options.map((value) => ({ label: value, value })), ...e });
const file = (s, n, l, e) => add(s, n, l, "file", e);
const group = (s, n, l, config, e) => add(s, n, l, "repeating_group", { group: config, ...e });
const col = (columnKey, label, type = "text", extras = {}) => ({ key: columnKey, label, type, required: true, ...extras });
const lines = (...items) => items.join("\n");

// ---- Applicant details (top of the form) ----
text(S0, "applicant_name", "Applicant Name");
phone(S0, "applicant_phone", "Phone Number");
email(S0, "applicant_email", "E-mail ID");

// ---- 1. Renunciation Document Checklist: the 9 supplied document categories, one item each ----
// The platform makes any item with "passport" in its label or key always required (passportInformation.js). The Indian passport items only apply when the minor has (or had) one,
// so they opt out explicitly: always shown, optional.
const PASSPORT_OPT_OUT = new Set(["doc_recent_indian_passport", "doc_indian_citizenship_alternative", "indian_passport_number", "indian_passport_place", "indian_passport_issue_date", "indian_passport_expiry_date", "father_passport_no", "mother_passport_no"]);
const optOut = (name) => (PASSPORT_OPT_OUT.has(name) ? { passportOptOut: true } : {});
const doc = (name, label, description, required = false) => file(S1, name, label, { required, description, ...optOut(name) });
doc("doc_photo_signature", "Digital Photograph & Signature", lines(
  "Part 1: Photograph Requirements",
  "- Use a white background and wear dark-colored attire.",
  "- The photograph must be no older than two months.",
  "- Your shoulders must be clearly visible.",
  "- Ensure there is no glare or shadow on your face or anywhere in the photograph.",
  "- Please upload a high-quality HD photograph here.",
  "Part 2: Signature Requirements",
  "- Please sign on a plain white sheet of paper using a dark-colored pen.",
  "- Ensure your signature is clear and properly visible.",
  "- Please scan the signed page in high quality and upload it here.",
  "Note: If the minor cannot sign, please provide their left thumb impression. Kindly capture the impression using blue ink on a plain white sheet and upload a clear photo of it here."
), true);
add(S1, "physical_photos_ack", "Physical Photographs", "radio", {
  options: PHYSICAL_PHOTOS_OPTIONS,
  description: lines(
    "Please provide three (3) identical physical passport-sized photographs (2 inches × 2 inches) with a white background at the time of submitting your application.",
    "Important: The physical photographs must be exactly the same as the photograph(s) you upload here. Please ensure that all photos are identical and match the uploaded photo."
  ),
});
doc("doc_address_proof", "Copy of Current Address Proof", lines(
  "(ANY ONE required)",
  "• State-issued Identity Card",
  "• Driving license (FRONT AND BACK)",
  "• Utility bill – water / gas / electricity / telephone (not more than 3 months old)",
  "• Valid Lease Agreement",
  "• Mortgage",
  "• Income Tax Return",
  "Note: If the applicant’s name is not mentioned on address proof, we will prepare an affidavit of address proof which requires notarization."
), true);
doc("doc_current_passport", "Copy of Current Passport", "First three and last two pages of current valid foreign passport.", true);
doc("doc_recent_indian_passport", "Copy of Recent Indian Passport", "First three and last two pages of the most recent Indian passport.");
doc("doc_naturalization_certificate", "Copy of Naturalization Certificate", "Colored copy of Naturalization Certificate.", true);
doc("doc_proof_of_indian_origin", "Copy of Proof of Indian Origin", lines(
  "If you DO NOT possess a Copy of the Indian Passport, it is mandatory to provide any TWO documents from the below:",
  "• Copy of the Election Card/ Voter ID",
  "• Copy of Board Certificate (SSC) or higher level",
  "• Copy of Birth Certificate",
  "• Copy of parent’s proof of Indian origin (First 3 pages and last 2 pages of parents Indian passport copy /Parents Birth Certificate)",
  "Kindly note: This document is applicable only if an applicant submits their Birth Certificate"
));
doc("doc_police_report", "Copy of Police report:", lines(
  "Applicants naturalized after 2010 Provide a police report",
  "Copy of Green Card",
  "NOTE: CURRENT POLICE REPORT MUST NOT BE MORE THAN 6 MONTHS OLD."
));
doc("doc_indian_citizenship_alternative", "As you don’t have the most recent Indian passport, please provide one document:", lines(
  "• Copy of your Indian birth certificate",
  "• School leaving certificate issued by State / Central Board",
  "• Any document showing Proof of Former Indian Citizenship."
));

// ---- 2. Applicant Personal Particulars ----
text(S2, "indian_passport_number", "Indian passport number", { required: false, description: "If you don’t have copy of Indian passport, please provide below information:", ...optOut("indian_passport_number") });
text(S2, "indian_passport_place", "Place of Issue (Indian Passport)", { required: false, ...optOut("indian_passport_place") });
date(S2, "indian_passport_issue_date", "Issued date (Indian Passport)", { required: false, ...optOut("indian_passport_issue_date") });
date(S2, "indian_passport_expiry_date", "Expiry date (Indian Passport)", { required: false, ...optOut("indian_passport_expiry_date") });
text(S2, "distinguishing_mark", "Visible distinguishing mark (if any)", { required: false });
radio(S2, "education", "Educational Qualification of the applicant", EDUCATION, { description: "Choose any one:" });
text(S2, "place_of_birth", "Place of Birth (Village/Town/City)");
text(S2, "district", "District");
text(S2, "state_ut", "State/UT");

// ---- 3. Family Details ----
text(S3, "father_surname", "Father’s Surname");
text(S3, "father_given_name", "Father’s Given name");
text(S3, "mother_surname", "Mother’s Surname");
text(S3, "mother_given_name", "Mother’s Given name");
text(S3, "guardian_surname", "Legal Guardian's Surname (if applicable)", { required: false });
text(S3, "guardian_given_name", "Legal Guardian's Given name (if applicable)", { required: false });
text(S3, "first_travel_from", "From where you have travelled to U.S for first time");
date(S3, "first_arrival_date", "Date when you arrived in U.S.A for first time");
text(S3, "father_passport_no", "Father’s Passport No.", { required: false, description: "If the applicant has gained naturalization through parents, please provide information below:", ...optOut("father_passport_no") });
date(S3, "father_naturalization_date", "Father’s Date of Naturalization", { required: false });
text(S3, "mother_passport_no", "Mother’s Passport No.", { required: false, ...optOut("mother_passport_no") });
date(S3, "mother_naturalization_date", "Mother’s Date of Naturalization", { required: false });

// ---- 4. Emergency Contact Details ----
group(S4, "emergency_contacts", "Emergency Contact Details", {
  itemLabel: "Contact", addLabel: "+ Add Contact", summaryFields: ["full_name", "contact_no"],
  columns: [col("full_name", "Full Name"), col("address", "Address", "textarea"), col("contact_no", "Contact No.", "phone")],
}, { description: "Please provide the contact information of someone other than yourself." });

function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
    ...(spec.rules ? { validationRules: spec.rules } : {}),
  };
  const questionKey = key(spec.name);
  const optOutMeta = spec.passportOptOut ? { passportInformation: false } : {};
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document", ...optOutMeta } });
  if (spec.type !== "repeating_group") return buildQuestion(questionKey, spec.label, spec.type, spec.section, order, { ...common, metadata: { ...optOutMeta } });
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

function buildRenunciationMinorNoPassportChecklist() {
  const counters = new Map();
  const questions = SPECS.map((spec) => {
    const order = (counters.get(spec.section) || 0) + 1;
    counters.set(spec.section, order);
    return buildField(spec, order);
  });
  return {
    key: CHECKLIST_KEY,
    title: CHECKLIST_TITLE,
    visaType: VISA_TYPE,
    visaTypes: [VISA_TYPE],
    checklistRole: "client",
    isDefault: false, // assigned only by this subtype's own filing type
    reconcileMetadata: true,
    description: "Renunciation of Indian citizenship: checklist and questionnaire for a minor applicant without an Indian passport.",
    sections: SECTIONS,
    questions,
  };
}

const RENUNCIATION_MINOR_NO_PASSPORT_DEFINITIONS = [buildRenunciationMinorNoPassportChecklist()];

module.exports = { CHECKLIST_KEY, CHECKLIST_TITLE, SUBTYPE_LABEL, VISA_TYPE, SECTIONS, RENUNCIATION_MINOR_NO_PASSPORT_DEFINITIONS, buildRenunciationMinorNoPassportChecklist };
