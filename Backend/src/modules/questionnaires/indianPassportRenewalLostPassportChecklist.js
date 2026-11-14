// Indian Passport Renewal (Indian Timeline Cases) -> subtype 2 "Minor Indian in Lieu of lost Passport": Document Checklist & Questionnaire (Minor Indian in Lieu of lost Passport).
//   key "indian_passport_renewal_minor_lost_passport_checklist", question keys "iprlost_<name>".
// Checklist-only like the OCI / Renunciation / E-Tourist subtypes: single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the visa type - the subtype's
// own filing type (config/filingTypes.js) names this checklist, so a case gets it ONLY when this subtype is selected. The title carries the visa type, like subtype 1
// ("Indian Passport Renewal - Minor Indian Passport Holder"): "Indian Passport Renewal - Minor Indian in Lieu of lost Passport".
// Exactly the questions of the supplied checklist, every one ALWAYS visible (no show-when rules); core items required, situational ones optional. The supplied text is kept as hints;
// the heading ("CHECKLIST FOR INDIAN PASSPORT RENEWAL") is not a question, and the "IMPORTANT INSTRUCTIONS" paragraphs are NOT included (owner decision: no checklist carries them).
const { buildQuestion, PHYSICAL_PHOTOS_OPTIONS } = require("./definitionHelpers");

const CHECKLIST_KEY = "indian_passport_renewal_minor_lost_passport_checklist";
const SUBTYPE_LABEL = "Minor Indian in Lieu of lost Passport";
const CHECKLIST_TITLE = "Indian Passport Renewal - Minor Indian in Lieu of lost Passport";
const VISA_TYPE = "INDIAN-PASSPORT-RENEWAL";
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = ["Yes", "No"];

const S0 = "Applicant Details";
const S1 = "1. Document Checklist";
const S2 = "2. Applicant Personal Particulars";
const S3 = "3. Family Details";
const S4 = "4. Emergency Contact Details";
const SECTIONS = [S0, S1, S2, S3, S4];

const REISSUE_REASONS = ["Change in Existing Personal Particulars", "Damage Passport", "Exhaustion of pages", "Lost passport", "Validity expired more than 3 years ago", "Validity expired within 3 years/due to expire"];
const EDUCATION = ["10th Pass and Above", "7th Pass or Less", "Between 8th and 9th Standard", "Graduate and Above"];

const key = (name) => `iprlost_${name}`;
const SPECS = [];
const add = (section, name, label, type, extras = {}) => SPECS.push({ section, name, label, type, required: extras.required !== false, ...extras });
const text = (s, n, l, e) => add(s, n, l, "text", e);
const phone = (s, n, l, e) => add(s, n, l, "phone", e);
const email = (s, n, l, e) => add(s, n, l, "email", e);
const date = (s, n, l, e) => add(s, n, l, "date", { rules: [{ type: "date", message: "Enter a valid date." }], ...e });
const address = (s, n, l, e) => add(s, n, l, "address", e);
const radio = (s, n, l, options, e) => add(s, n, l, "radio", { options: options.map((value) => ({ label: value, value })), ...e });
const file = (s, n, l, e) => add(s, n, l, "file", e);
const group = (s, n, l, config, e) => add(s, n, l, "repeating_group", { group: config, ...e });
const col = (columnKey, label, type = "text", extras = {}) => ({ key: columnKey, label, type, required: true, ...extras });
const lines = (...items) => items.join("\n");

// ---- Applicant details (top of the form) ----
text(S0, "applicant_name", "Applicant Name");
phone(S0, "applicant_phone", "Phone Number");
email(S0, "applicant_email", "E-mail ID");

// ---- 1. Document Checklist: the 11 supplied rows (row 7 is the Indian address, asked as 7 fields) ----
// The platform makes any item with "passport" in its label or key always required (passportInformation.js). The booklet type, the parents' passport copy and the parents' passport
// numbers are required anyway; the re-issue reason and the copy of the applicant's own Indian passport (it is the LOST passport, so it may not be available) are optional and opt out.
const PASSPORT_OPT_OUT = new Set(["reissue_reason", "doc_current_indian_passport"]);
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
    "Important: The physical photographs must be exactly the same as the photograph(s) you upload here."
  ),
});
doc("doc_us_status", "Copy of the valid status in USA", lines(
  "(Notarized)",
  "• Green Card - FRONT AND BACK",
  "• EAD - FRONT AND BACK",
  "• I-797A Approval Notice",
  "• Work permit/Study Permit",
  "• U.S. Visa Stamp",
  "• Notarized recently expired Visa and notarized I-797A Approval notice together with notarized I797C Receipt Notice for filing of a request for extension before the expiry of Visa or I-797A. Notarized copy of proof of extension, if B1/B2 is expired and have a receipt for extension of stay or an approval for extension of stay.",
  "• Notarized hotel bill - If the customer on L1/L3 staying in a hotel for a project for the past couple of months and doesn’t have the address proof or state ID."
));
doc("doc_current_indian_passport", "Copy of current Indian Passport", "First three and last two pages of the most recent Indian passport.");
doc("doc_us_address_proof", "Copy of Proof of address in USA", lines(
  "• State Issued ID",
  "• Driving license",
  "• Utility Bill - Water / Gas / Electricity (should be recent, no more than 3 months old)",
  "• Valid Lease Agreement MUST BE SIGNED BY THE TENANT AND LANDLORD",
  "• Mortgage",
  "• Income Tax return (1040)",
  "• For College/University Students living on campus in university housing/dormitories, a letter from your institution on the institution letterhead explaining the exact address that you presently reside in will suffice",
  "• Marriage Certificate in case the address in spouse’s name",
  "• In case of applicant residing with parents/children/brother/Sister, a notarized undertaking from them with one of the notarized copies of address proof as indicated above"
), true);
doc("doc_police_report", "Copy of Detailed and Approved Police Report:", lines(
  "In case of Loss passport – Police report with the name of the applicant (s) and reference of the lost document (s) (e.g. Passport)",
  "NOTE: CURRENT POLICE REPORT MUST NOT BE MORE THAN 6 MONTHS OLD. The Police report should be approved and not pending, detailed and must include applicant’s information. The report should also give information on how the passport is lost or stolen."
), true);
doc("doc_indian_address_proof", "Copy of Indian address proof", lines(
  "(The address details provided below must match the address mentioned on your supporting document)",
  "• Aadhar Card",
  "• Recent Bank Statement from Government bank",
  "• Driver’s license",
  "• Utility bill not older than 3 months",
  "• Voter Card ID",
  "• Copy of Ration card which has the parents name – Should have names of applicant and parents",
  "• Copy of Photo passbook of PSU Bank",
  "• Copy of Parents Passport copy as their name is on the applicant passport",
  "• Parents or relatives address of Indian address proof"
), true);
// row 7: the complete Indian address, exactly as it appears on the Indian address proof
text(S1, "indian_house_street", "House no. and street name", { required: false, description: "Please provide the complete Indian address exactly as it appears on the Indian address proof document submitted above:" });
text(S1, "indian_village_town_city", "Village/Town/City", { required: false });
text(S1, "indian_pin_code", "PIN code", { required: false });
text(S1, "indian_state_ut", "State/UT", { required: false });
text(S1, "indian_district", "District", { required: false });
text(S1, "indian_police_station", "Area Police station", { required: false });
phone(S1, "indian_relative_contact", "Please provide contact number of your relative who residing on your address", { required: false });
doc("doc_pan_voter_id", "Copy PAN & VOTER ID (if available):", "Color", true);
doc("doc_parent_indian_passport", "Copy of Parent’s Indian Passport", "Copies of both parents’ first and last page of the Valid Indian Passport", true);
doc("doc_parent_us_status", "Copy of Parent’s valid legal status in USA", "Notarized copies of both parents’ valid legal status in the USA");
doc("doc_birth_certificate", "Copy of Birth Certificate", "A copy of the applicant’s birth certificate is required", true);

// ---- 2. Applicant Personal Particulars ----
radio(S2, "applying_for", "Applying for", ["Fresh passport", "Re-issue passport"]);
radio(S2, "reissue_reason", "If Re-issue passport,", REISSUE_REASONS, { required: false, ...optOut("reissue_reason") });
radio(S2, "processing_type", "Application Processing Type", ["Normal", "Tatkal"]);
radio(S2, "booklet_type", "Passport Booklet Type", ["36 Pages", "60 Pages"]);
text(S2, "distinguishing_mark", "Visible distinguishing mark (if any)", { required: false });
radio(S2, "education_level", "Educational Qualification of the applicant", EDUCATION, { description: "(Choose any one):" });
text(S2, "place_of_birth", "Place of Birth (Village/Town/City)");
text(S2, "district", "District");
text(S2, "state_ut", "State/UT");
text(S2, "employment_type", "Employment Type");
text(S2, "education_exact", "Educational Qualification", { required: false, description: "Exact education qualification" });
radio(S2, "citizenship_by", "Citizenship of India by", ["Birth", "Descent", "Registration / Naturalization"], { description: "(Choose any one)" });
address(S2, "us_address", "Complete U.S. Residential Address");
date(S2, "us_address_since", "Residing at U.S. Address Since (MM/DD/YYYY)");
text(S2, "aadhaar_number", "Aadhaar Number (if available)", { required: false });
text(S2, "pan_number", "PAN  Number (if available)", { required: false });
text(S2, "voter_id_number", "Voter ID number (if available)", { required: false });

// ---- 3. Family Details ----
const parent = (prefix, who) => {
  text(S3, `${prefix}_surname`, `${who}’s Surname`);
  text(S3, `${prefix}_given_name`, `${who}’s Given name`);
  text(S3, `${prefix}_nationality`, `${who}’s Nationality`);
  text(S3, `${prefix}_citizenship`, `${who}’s Citizenship`);
  text(S3, `${prefix}_passport_number`, `${who}’s Passport number`);
  phone(S3, `${prefix}_contact_number`, `${who}’s contact number`);
  email(S3, `${prefix}_email`, `${who}’s Email-ID`, { required: false });
  text(S3, `${prefix}_aadhar_number`, `${who}’s Aadhar number (if available)`, { required: false });
  text(S3, `${prefix}_voter_id_number`, `${who}’s Voter ID number (if available)`, { required: false });
  text(S3, `${prefix}_pan_number`, `${who}’s PAN number (if available)`, { required: false });
  text(S3, `${prefix}_driving_license_number`, `${who}’s Driving License number (if available)`, { required: false });
};
parent("father", "Father");
parent("mother", "Mother");
radio(S3, "parent_government_employee", "Is either the Parents are Government Employee", YES_NO);

// ---- 4. Emergency Contact Details ----
group(S4, "emergency_contacts", "Emergency Contact Details", {
  itemLabel: "Contact", addLabel: "+ Add Contact", summaryFields: ["full_name", "contact_no"],
  columns: [col("full_name", "Full Name"), col("address", "Address", "textarea"), col("contact_no", "Contact No.", "phone"), col("email", "Email ID", "email", { required: false })],
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

function buildIndianPassportRenewalLostPassportChecklist() {
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
    description: "For a minor Indian applying for Indian Passport Renewal in lieu of a lost passport.",
    sections: SECTIONS,
    questions,
  };
}

const INDIAN_PASSPORT_RENEWAL_LOST_PASSPORT_DEFINITIONS = [buildIndianPassportRenewalLostPassportChecklist()];

module.exports = { CHECKLIST_KEY, CHECKLIST_TITLE, SUBTYPE_LABEL, VISA_TYPE, SECTIONS, INDIAN_PASSPORT_RENEWAL_LOST_PASSPORT_DEFINITIONS, buildIndianPassportRenewalLostPassportChecklist };
