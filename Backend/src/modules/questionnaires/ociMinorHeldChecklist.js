// OCI - Minor Foreign citizen and held Indian passport: the FIFTH (last) subtype of the OCI visa type under "Indian Timeline Cases".
//   key "oci_minor_foreign_citizen_held_passport_checklist", question keys "oci_minorheld_<name>" (a prefix of its own: no key is shared with the other four subtypes).
// Same shape as the other subtypes: single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the OCI visa type (the subtype's own
// filing-type entry names this checklist). Exactly the questions of the supplied checklist, every one ALWAYS visible (no show-when rules); core items required, situational optional.
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
const S_C = "D. Prior OCI History and Relatives in India"; // lettered D (there is no C) exactly as in the supplied checklist
const S_DOCS = "Required Documents";
const SECTIONS = [S_CONTACT, S_A, S_B, S_C, S_DOCS];

const key = (name) => `oci_minorheld_${name}`;

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
text(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", { description: "e.g., Self / Father / Mother / Grandparent" });
country(S_A, "country_of_birth", "Country of Birth");
text(S_A, "place_of_birth", "Place of Birth (Province/Town/City)");
country(S_A, "current_nationality", "Current Nationality");
yesNo(S_A, "is_student", "Are you a student?", { description: "If Yes, please provide the institution details below." });
text(S_A, "institution_name", "Institution Name", { required: false });
longText(S_A, "institution_address", "Institution Complete Address", { required: false });
phone(S_A, "institution_phone", "Institution Contact Number", { required: false });

// ---- B ----
text(S_B, "father_name", "Father's Full Name");
country(S_B, "father_nationality", "Father's Nationality");
text(S_B, "father_occupation", "Father's Occupation", { required: false });
text(S_B, "mother_name", "Mother's Full Name");
country(S_B, "mother_nationality", "Mother's Nationality");
text(S_B, "mother_occupation", "Mother's Occupation", { required: false });

// ---- C ----
yesNo(S_C, "prior_oci_applied", "Have you or any member of your family applied for OCI registration earlier?");
group(S_C, "prior_oci_applications", "If Yes, details", {
  itemLabel: "Application", addLabel: "+ Add Application", summaryFields: ["name", "reference_number"],
  columns: [col("name", "Name / Relationship"), col("reference_number", "Reference no."), col("date_applied", "Date when applied (DD/MM/YYYY)", "date"), col("place_applied", "Place where applied"), col("status", "Status")],
}, { required: false, description: "Fill in only if you answered Yes above." });
yesNo(S_C, "oci_surrendered_or_cancelled", "Have you ever surrendered or had a previous OCI card cancelled?");
longText(S_C, "oci_surrender_details", "If Yes, details", { required: false, description: "Fill in only if you answered Yes above." });
group(S_C, "relatives_in_india", "Details of family members / relatives currently residing in India (if any)", {
  itemLabel: "Relative", addLabel: "+ Add Relative", summaryFields: ["name", "relationship"],
  columns: [col("name", "Relative Name"), col("relationship", "Relationship"), col("age", "Age", "number", { min: 0, max: 130, step: "1" }), col("address", "Present Address in India", "textarea")],
}, { required: false, description: "Leave empty if you have no relatives currently residing in India." });

// ---- Documents: exactly the 15 document requirements of the supplied checklist, one item each, with its guidelines as the description ----
// Core documents are required; the ones the guidelines describe as "if", "only applies to" or "if ever obtained" are optional (the applicant marks N/A when a category does not apply).
const lines = (...items) => items.join("\n");
file(S_DOCS, "doc_photo_signature", "Digital Photograph & Signature", { description: lines(
  "Part 1: Photograph Requirements",
  "- Use a white background and wear dark-colored attire.",
  "- The photograph must be no older than two months.",
  "- Your shoulders must be clearly visible.",
  "- Ensure there is no glare or shadow on your face or anywhere in the photograph.",
  "- Please provide a high-quality HD photograph via email.",
  "Part 2: Signature Requirements",
  "- Please sign on a plain white sheet of paper using a dark-colored pen.",
  "- Ensure your signature is clear and properly visible.",
  "- Please scan the signed page in high quality and send it to us via email.",
  "Note: If the minor cannot sign, please provide their left thumb impression. Kindly capture the impression using blue ink on a plain white sheet and send a clear photo of it via email."
) });
add(S_DOCS, "physical_photos_ack", "Physical Photographs", "radio", {
  options: [{ label: "I will provide three identical physical passport-sized photographs when the application is lodged", value: "confirmed" }],
  description: "Three (3) identical physical passport-sized photographs (2 inch x 2 inch, white background) to be submitted at the time of application lodging.",
});
file(S_DOCS, "doc_current_passport", "Current Valid Passport", { description: "Color copy of the first two and last two pages of your current valid passport (must have at least 9 months validity remaining)." });
file(S_DOCS, "doc_last_indian_passport", "Copy of Indian passport", { description: "The last held Indian Passport" });
file(S_DOCS, "doc_naturalization_certificate", "Copy of Naturalization Certificate", { description: "The naturalization certificate should be duly signed at the designated space. If the applicant has acquired naturalization through parents and the applicant doesn't possess separate naturalization certificate, a notarized affidavit signed by both parents may be submitted along with copies of their naturalization certificates" });
file(S_DOCS, "doc_surrender_certificate", "Copy of Surrender Certificate", { required: false, description: "Note: This only applies to applicants who were naturalized from 2010 onwards." });
file(S_DOCS, "doc_birth_certificate", "Copy of Birth Certificate", { required: false, description: lines(
  "A copy of the birth certificate may be provided, if the applicant was born in the USA. It must reflect:",
  "(i) Names of Parents",
  "(ii) Date of Birth",
  "(iii) Nationality.",
  "Birth certificates issued by hospitals are not acceptable.",
  "Note: If the applicant was born outside of India, the birth certificate must either be apostilled by the relevant foreign government or attested by the appropriate foreign mission. Do not send original apostilled documents to the VFS or Consulate office. We require self-attested copies of the apostilled documents instead."
) });
// The platform makes any item with "passport" in its name required (passportInformation.js); this one applies only to non-US passport holders, so it opts out explicitly: always shown, optional.
file(S_DOCS, "doc_legal_status_usa", "Legal Status in USA (Non-US Passport Holders)", { required: false, passportOptOut: true, description: "Color copy of Green Card (Front & Back), valid EAD card, or long-term US Visa. If extension is pending, submit I-797A / I-797C Notice along with the expired visa." });
file(S_DOCS, "doc_name_change", "Proof of Name Change", { required: false, description: "Legal Name Change Document from a local court or a duly notarized affidavit. Previous names must be stated in the application." });
file(S_DOCS, "doc_parents_passports", "Copy of current passport of the Parents", { description: "If parents are holding Indian passport, please provide first two and last pages of the Indian passport copies." });
file(S_DOCS, "doc_parents_marriage_certificate", "Copy of Marriage Certificate of Parents", { description: "If the marriage is solemnized in India, a Marriage Certificate issued by Marriage Registrar is required. Marriage Certificate issued by any religious body is not acceptable. If parents are divorced, a copy of the divorce decree may be provided. If one parent is not alive, a copy of the death certificate may be provided." });
file(S_DOCS, "doc_parents_oci_cards", "Parents' OCI Cards", { required: false, description: "Copies of OCI cards issued to parents (if ever obtained and available)." });
file(S_DOCS, "doc_previous_indian_visa", "Previous Indian Visa", { required: false, description: "Copy of previously issued Indian Visa, if ever obtained." });
file(S_DOCS, "doc_us_address_proof", "Proof of USA Address", { description: "State-issued ID, Driver's License, Utility Bill (Water/Gas/Electric/Phone - under 3 months old), Valid Lease Agreement, Mortgage Statement, or recent Tax Return." });
file(S_DOCS, "doc_native_address_proof", "Native Address Proof (Non-US Nationals)", { required: false, description: "Address proof from native/home country. If unavailable, submit a notarized statement detailing native address. Dual citizens must provide native address proof for both countries." });

function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
  };
  const questionKey = key(spec.name);
  const requireMeta = spec.requireWhen ? { requireWhen: spec.requireWhen } : {};
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document", ...requireMeta, ...(spec.passportOptOut ? { passportInformation: false } : {}) } });
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
