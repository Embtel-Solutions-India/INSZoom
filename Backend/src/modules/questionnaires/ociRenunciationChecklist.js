// OCI -> subtype "OCI RENUNCIATION": OCI RENUNCIATION DOCUMENT CHECKLIST & QUESTIONNAIRE.
//   key "oci_renunciation_checklist", question keys "ocirn_<name>".
// Checklist-only like the other OCI subtypes: single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the OCI visa type - the subtype's own filing type
// (config/filingTypes.js) names this checklist, so a case gets it ONLY when this subtype is selected. Named after its subtype.
// Exactly the questions of the supplied checklist, every one ALWAYS visible (no show-when rules); core items required, situational ones optional. The supplied checklist asks for no
// photograph, so it has no physical-photographs item, and it has no instructions text.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");

const CHECKLIST_KEY = "oci_renunciation_checklist";
const SUBTYPE_LABEL = "OCI RENUNCIATION";
const CHECKLIST_TITLE = SUBTYPE_LABEL;
const VISA_TYPE = "OCI";
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));

const S_CONTACT = "1. Applicant Basic Contact Information";
const S_DOCS = "2. Required Document Checklist";
const S_A = "A. Personal Details";
const S_B = "B. Family Information";
const S_C = "C. Employment & Occupation Details";
const SECTIONS = [S_CONTACT, S_DOCS, S_A, S_B, S_C];

const key = (name) => `ocirn_${name}`;
const SPECS = [];
const add = (section, name, label, type, extras = {}) => SPECS.push({ section, name, label, type, required: extras.required !== false, ...extras });
const text = (s, n, l, e) => add(s, n, l, "text", e);
const longText = (s, n, l, e) => add(s, n, l, "textarea", e);
const phone = (s, n, l, e) => add(s, n, l, "phone", e);
const email = (s, n, l, e) => add(s, n, l, "email", e);
const date = (s, n, l, e) => add(s, n, l, "date", { rules: [{ type: "date", message: "Enter a valid date." }], ...e });
const country = (s, n, l, e) => add(s, n, l, "select", { options: COUNTRY_OPTIONS, ...e });
const select = (s, n, l, options, e) => add(s, n, l, "select", { options, ...e });
const yesNo = (s, n, l, e) => add(s, n, l, "radio", { options: YES_NO, ...e });
const file = (s, n, l, e) => add(s, n, l, "file", e);
const group = (s, n, l, config, e) => add(s, n, l, "repeating_group", { group: config, ...e });
const col = (columnKey, label, type = "text", extras = {}) => ({ key: columnKey, label, type, required: true, ...extras });

// ---- 1. Applicant Basic Contact Information ----
text(S_CONTACT, "applicant_name", "Applicant Full Name");
phone(S_CONTACT, "applicant_phone", "Phone Number");
email(S_CONTACT, "applicant_email", "Email ID");

// ---- 2. Required Document Checklist: the 6 supplied document requirements, one item each ----
// The platform makes any item with "passport" in its label or key always required (passportInformation.js). The current passport copy and the applicant's own passport details are
// required anyway; the items that only apply in some situations (the previous passport, the Non-US passport holders' legal status, the spouse's passport) opt out explicitly.
const PASSPORT_OPT_OUT = new Set(["doc_previous_passport", "doc_legal_status_usa", "spouse_passport_number", "spouse_passport_issue_date"]);
const optOut = (name) => (PASSPORT_OPT_OUT.has(name) ? { passportOptOut: true } : {});
const doc = (name, label, description, required = false) => file(S_DOCS, name, label, { required, description, ...optOut(name) });
doc("doc_origin_oci_card", "Copy of Original OCI Card", "Color copy of first and last two pages", true);
doc("doc_current_passport", "Current Valid Passport", "Color copy of the first two and last two pages of your current valid passport (must have at least 9 months validity remaining).", true);
doc("doc_previous_passport", "Previous passport", "Copy of previous passport which is linked to the OCI card (if current passport not linked with OCI)");
doc("doc_legal_status_usa", "Legal Status in USA (Non-US Passport Holders)", "Color copy of Green Card (Front & Back), valid EAD card, or long-term US Visa. If extension is pending, submit I-797A / I-797C Notice along with the expired visa.");
doc("doc_us_address_proof", "Proof of USA Address", "State-issued ID, Driver's License, Utility Bill (Water/Gas/Electric/Phone - under 3 months old), Valid Lease Agreement, Mortgage Statement, or recent Tax Return.", true);
doc("doc_native_address_proof", "Native Address Proof (Non-US Nationals)", "Address proof from native/home country. If unavailable, submit a notarized statement detailing native address. Dual citizens must provide native address proof for both countries.");

// ---- A. Personal Details ----
text(S_A, "surname", "Surname");
text(S_A, "given_name", "Given name");
select(S_A, "gender", "Gender", ["Male", "Female", "Other"]);
date(S_A, "date_of_birth", "Date of Birth");
country(S_A, "country_of_birth", "Country of Birth");
text(S_A, "place_of_birth", "Place of Birth");
country(S_A, "current_nationality", "Current Nationality");
text(S_A, "visible_mark", "Visible mark", { required: false });
select(S_A, "marital_status", "Marital Status", ["Single / Never Married", "Married", "Divorced", "Widowed", "Separated"]);
text(S_A, "passport_number", "Passport Number");
date(S_A, "passport_issue_date", "Date of Issue");
date(S_A, "passport_expiry_date", "Date of Expiry");
text(S_A, "passport_place_of_issue", "Place of Issue");
longText(S_A, "present_address", "Present Address");
text(S_A, "zip_code", "Zip code");

// ---- B. Family Information ----
text(S_B, "spouse_name", "Spouse's Full Name", { required: false });
date(S_B, "spouse_dob", "Spouse's Date of Birth", { required: false });
country(S_B, "spouse_nationality", "Spouse's Nationality", { required: false });
text(S_B, "spouse_occupation", "Spouse's Occupation", { required: false });
text(S_B, "spouse_passport_number", "Spouse’s Passport number", { required: false, ...optOut("spouse_passport_number") });
date(S_B, "spouse_passport_issue_date", "Date of issue of spouse passport", { required: false, ...optOut("spouse_passport_issue_date") });
yesNo(S_B, "spouse_is_oci_holder", "Whether your spouse is registered as an OCI card holder?");
text(S_B, "spouse_oci_number", "OCI card number in case of OCI card holder spouse", { required: false, description: "If yes, then," });
yesNo(S_B, "children_are_oci_holders", "Whether minor children are registered as OCI card holders?");
group(S_B, "children_oci_cards", "Child name / OCI card No.", {
  itemLabel: "Child", addLabel: "+ Add Child", summaryFields: ["child_name", "oci_card_no"],
  columns: [col("child_name", "Child name"), col("oci_card_no", "OCI card No.")],
}, { required: false, description: "If yes, then:" });

// ---- C. Employment & Occupation Details ----
text(S_C, "current_occupation", "Current Occupation / Designation");
longText(S_C, "employer_name_address", "Employer Name & Office Address", { required: false });
phone(S_C, "employer_phone", "Employer Contact Number", { required: false });
text(S_C, "retired_organization", "If Retired, Dept / Office / Organization", { required: false });

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

function buildOciRenunciationChecklist() {
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
    description: "OCI renunciation: document checklist and questionnaire.",
    sections: SECTIONS,
    questions,
  };
}

const OCI_RENUNCIATION_DEFINITIONS = [buildOciRenunciationChecklist()];

module.exports = { CHECKLIST_KEY, CHECKLIST_TITLE, SUBTYPE_LABEL, VISA_TYPE, SECTIONS, OCI_RENUNCIATION_DEFINITIONS, buildOciRenunciationChecklist };
