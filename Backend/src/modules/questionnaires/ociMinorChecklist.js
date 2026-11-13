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
text(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", { description: "e.g., Self / Father / Mother / Grandparent" });
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

// ---- Documents: exactly the 13 supplied document requirements, one item each, with its guidelines as the description ----
// Core documents are required; the ones the guidelines describe as "may be provided" / "if ever obtained" are optional (the applicant marks N/A when a category does not apply).
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
file(S_DOCS, "doc_birth_certificate", "Copy of Birth Certificate", { required: false, description: lines(
  "A copy of the birth certificate may be provided, if the applicant was born in the USA. It must reflect:",
  "(i) Names of Parents",
  "(ii) Date of Birth",
  "(iii) Nationality.",
  "Birth certificates issued by hospitals are not acceptable.",
  "Note: If the applicant was born outside of India, the birth certificate must either be apostilled by the relevant foreign government or attested by the appropriate foreign mission. Do not send original apostilled documents to the VFS or Consulate office. We require self-attested copies of the apostilled documents instead."
) });
file(S_DOCS, "doc_indian_origin_evidence", "Copy of Evidence of Indian origin of Parents or grandparents or great grandparents", { description: lines(
  "Any of the following documents may be provided:",
  "Copies of Indian Passports - FIRST 2 AND LAST 2 PAGES",
  "Copy of the Domicile Certificate issued by the Competent Authority",
  "Copy of the Nativity Certificate from the Competent Authority",
  "OCI Card of parents along with documents on the basis of which OCI card was issued",
  "Any other proof substantiating the request"
) });
// "CertOrPassport" in the key: the platform makes any item with "passport" in its name required, and this one applies only to non-US passport holders - it is always shown and optional (the applicant marks N/A)
file(S_DOCS, "doc_legal_status_usaCertOrPassport", "Legal Status in USA (Non-US Passport Holders)", { required: false, description: "Color copy of Green Card (Front & Back), valid EAD card, or long-term US Visa. If extension is pending, submit I-797A / I-797C Notice along with the expired visa." });
file(S_DOCS, "doc_name_change", "Proof of Name Change", { required: false, description: "Legal Name Change Document from a local court or a duly notarized affidavit. Previous names must be stated in the application." });
// "CertOrPassport" in the key: the platform makes any passport item required, and this one is only "may be provided" if the parents acquired foreign nationality (an optional document)
file(S_DOCS, "doc_parents_naturalizationCertOrPassport", "Copy of Naturalization and current foreign passport of the Parents", { required: false, description: "If parents have acquired foreign nationality, copies of their naturalization certificates and current foreign passports may be provided." });
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
