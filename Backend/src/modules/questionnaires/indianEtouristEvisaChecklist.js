// Indian E-Tourist Visa -> subtype "E-Visa": personal / passport / contact / family / ancestry / travel / itinerary / history / occupation / references questionnaire (Sections A-K, K = the Mandatory Document Checklist).
//   key "indian_etourist_evisa_checklist", question keys "inev_<name>".
// Checklist-only like the Business Visa subtype: single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the visa type (the subtype's own filing type names this checklist).
// Only section names and questions - no agency heading, banner, contact details or legal text. Every question is ALWAYS visible (no show-when rules); core items are required, situational
// ones (the "If Yes" follow-ups, the spouse block, the invitation letter that is "required only if applicable") are optional. Question labels are exactly as supplied.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");

const CHECKLIST_KEY = "indian_etourist_evisa_checklist";
const CHECKLIST_TITLE = "INDIAN E-TOURIST VISA (E-VISA) APPLICATION QUESTIONNAIRE";
const SUBTYPE_LABEL = "E-Visa";

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));
const DMY = "DD/MM/YYYY";

const S0 = "Preliminary Applicant Information";
const SA = "Section A. Personal Particulars (As shown in Passport)";
const SB = "Section B. Passport Details";
const SC = "Section C. Contact Information";
const SD = "Section D. Family Background";
const SE = "Section E. Ancestry & Origins";
const SF = "Section F. Visa & Travel Preferences";
const SG = "Section G. Purpose of Visit & Itinerary";
const SH = "Section H. Travel History & Background";
const SI = "Section I. Occupation & Employment Details";
const SJ = "Section J. References";
const SK = "Section K. Mandatory Document Checklist";
const SECTIONS = [S0, SA, SB, SC, SD, SE, SF, SG, SH, SI, SJ, SK];

const key = (name) => `inev_${name}`;
const DATE_RULE = [{ type: "date", message: `Enter a valid date (${DMY}).` }];

const SPECS = [];
const add = (section, name, label, type, extras = {}) => SPECS.push({ section, name, label, type, required: extras.required !== false, ...extras });
const text = (s, n, l, e) => add(s, n, l, "text", e);
const longText = (s, n, l, e) => add(s, n, l, "textarea", e);
const phone = (s, n, l, e) => add(s, n, l, "phone", e);
const email = (s, n, l, e) => add(s, n, l, "email", e);
const date = (s, n, l, e) => add(s, n, l, "date", { rules: DATE_RULE, description: DMY, ...e });
const select = (s, n, l, options, e) => add(s, n, l, "select", { options, ...e });
const country = (s, n, l, e) => select(s, n, l, COUNTRY_OPTIONS, e);
const yesNo = (s, n, l, e) => add(s, n, l, "radio", { options: YES_NO, ...e });
const file = (s, n, l, e) => add(s, n, l, "file", e);

// ---- Preliminary ----
text(S0, "applicant_name", "Applicant Name");
phone(S0, "applicant_phone", "Phone Number");

// ---- A ----
text(SA, "surname", "Surname (Last Name)");
text(SA, "given_name", "Given Name (First Name)");
text(SA, "other_names", "Previous / Other Name(s) (if any)", { required: false });
select(SA, "gender", "Gender", ["Male", "Female", "Transgender"]);
select(SA, "marital_status", "Marital Status", ["Single", "Married", "Divorced", "Widowed"]);
date(SA, "date_of_marriage", "Date of Marriage", { required: false, description: "DD/MM/YYYY (If applicable)" });
date(SA, "date_of_birth", "Date of Birth");
text(SA, "religion", "Religion");
text(SA, "place_of_birth", "Place of Birth (City/Town, State)");
country(SA, "country_of_birth", "Country of Birth");
country(SA, "citizenship", "Current Citizenship / Nationality");
text(SA, "citizenship_id", "Citizenship/National Id No.");
text(SA, "identification_marks", "Visible Identification Marks", { description: "e.g., Mole, scar, or 'None'" });
text(SA, "education", "Highest Educational Qualification", { description: "e.g., High School, Graduate, Post Graduate, Professional" });
text(SA, "qualification_institution", "Qualification acquired from College/University", { required: false, description: "e.g., M.B.A, B.Sc in computer Science, BBA etc" });

// ---- B ----
text(SB, "passport_number", "Passport Number");
date(SB, "passport_issue_date", "Date of Issue");
date(SB, "passport_expiry_date", "Date of Expiry");
text(SB, "passport_authority", "Place / Authority of Issue");
yesNo(SB, "other_passport", "Do you hold any other Passport or Identity Certificate?");
text(SB, "other_passport_number", "If Yes, Passport / IC Number", { required: false, passportOptOut: true });
country(SB, "other_passport_country", "If Yes, Country of Issue", { required: false, passportOptOut: true });
date(SB, "other_passport_issue_date", "If Yes, Date of Issue", { required: false, passportOptOut: true });
text(SB, "other_passport_place", "If Yes, Place of Issue", { required: false, passportOptOut: true });
text(SB, "other_passport_nationality", "If Yes, Nationality mentioned therein", { required: false, passportOptOut: true });

// ---- C ----
longText(SC, "present_address", "Present Residential Address");
longText(SC, "permanent_address", "Permanent Address", { description: "Write 'Same' if identical to present address" });
phone(SC, "mobile", "Mobile / Phone Number");
email(SC, "email", "Email Address");

// ---- D ----
text(SD, "father_name", "Father's Full Name", { description: "FATHER'S DETAILS" });
text(SD, "father_nationality", "Father's Nationality");
text(SD, "father_prev_nationality", "Father's Previous Nationality (if any)", { required: false });
text(SD, "father_birth", "Father's Place & Country of Birth");
text(SD, "father_occupation", "Father's Occupation");
text(SD, "mother_name", "Mother's Full Name", { description: "MOTHER'S DETAILS" });
text(SD, "mother_nationality", "Mother's Nationality");
text(SD, "mother_prev_nationality", "Mother's Previous Nationality (if any)", { required: false });
text(SD, "mother_birth", "Mother's Place & Country of Birth");
text(SD, "mother_occupation", "Mother's Occupation");
text(SD, "spouse_name", "Spouse's Full Name", { required: false, description: "SPOUSE'S DETAILS" });
text(SD, "spouse_nationality", "Spouse's Nationality", { required: false });
text(SD, "spouse_prev_nationality", "Spouse's Previous Nationality (if any)", { required: false });
text(SD, "spouse_birth", "Spouse's Place & Country of Birth", { required: false });
text(SD, "spouse_occupation", "Spouse's Occupation", { required: false });

// ---- E ----
yesNo(SE, "pakistan_origin", "Were your parents or grandparents (paternal/maternal) Pakistan nationals or from Pakistan-held territories?");
longText(SE, "pakistan_origin_details", "If Yes, provide detailed information", { required: false });

// ---- F ----
select(SF, "visa_service_type", "Visa Service Type Requested", ["E-Tourist Visa"]); // the one choice of the supplied questionnaire
text(SF, "visa_duration", "Requested Visa Duration / Validity", { description: "e.g., 30 Days / 1 Year / 5 Years" });
select(SF, "entries", "Number of Entries Required", ["Double Entry", "Multiple Entry"]);
date(SF, "journey_date", "Expected Date of Journey / Arrival");
text(SF, "port_arrival", "Designated Port of Arrival in India", { description: "Airport / Seaport name" });
text(SF, "port_exit", "Expected Port of Exit from India");

// ---- G ----
select(SG, "purpose", "Primary Purpose of Visit", ["Tourism", "Recreation", "Sightseeing", "Meeting Friends/Relatives"]);
text(SG, "place_1", "Cities / Places to Visit (Location 1)");
text(SG, "place_2", "Cities / Places to Visit (Location 2)", { required: false });
yesNo(SG, "hotel_booked", "Have you booked hotel/resort accommodations?");
text(SG, "hotel_name", "If Yes, Hotel / Resort Name & City", { required: false });
yesNo(SG, "tour_operator", "Is your trip organized through a Tour Operator?");
longText(SG, "tour_operator_details", "If Yes, Tour Operator Name & Address", { required: false });
longText(SG, "stay_address", "Address of Accommodation / Stay in India");
longText(SG, "contact_in_india", "Contact Person / Relative in India (Name, Address & Relationship)");

// ---- H ----
yesNo(SH, "applied_evisa", "Have you previously applied for an Indian e-Visa?", { description: "Yes / No - If Yes, state details" });
longText(SH, "applied_evisa_details", "If Yes, state details", { required: false });
yesNo(SH, "visited_india", "Have you visited India previously?");
longText(SH, "prev_stay_address", "If Yes, Address of Previous Stay in India", { required: false });
longText(SH, "prev_cities", "If Yes, Cities Visited Previously", { required: false });
text(SH, "prev_visa_number", "If Yes, Previous Visa Number & Type", { required: false });
text(SH, "prev_visa_issue", "If Yes, Place & Date of Visa Issue", { required: false });
yesNo(SH, "permission_denied", "Has permission to visit or extend stay in India ever been denied?");
longText(SH, "permission_denied_details", "If Yes, when and by whom (Mention control no. & date also)", { required: false });
longText(SH, "countries_10_years", "Countries visited in the last 10 years", { description: "List all countries" });
yesNo(SH, "saarc", "Have you visited any SAARC countries (except your home country) in the past 3 years?", { description: "Afghanistan, Bangladesh, Bhutan, Maldives, Nepal, Pakistan, Sri Lanka" });
yesNo(SH, "name_changed", "Have you ever officially changed your name?");

// ---- I ----
text(SI, "occupation", "Current Occupation / Profession Type", { description: "Note for Homemakers / Dependent Students\nProvide details of father's or spouse's occupation above" });
text(SI, "designation", "Designation / Rank / Job Title");
text(SI, "employer_name", "Employer / Business Name");
longText(SI, "employer_address", "Employer / Business Address");
phone(SI, "employer_phone", "Employer Phone Number");
text(SI, "past_occupation", "Past Occupation, if any", { required: false });
yesNo(SI, "military", "Are/were you in a Military/SemiMilitary/Police/Security. Organization?", { description: "If Yes give details" });
longText(SI, "military_details", "If Yes give details", { required: false });

// ---- J ----
text(SJ, "ref_name", "Name", { description: "REFERENCE IN INDIA" });
longText(SJ, "ref_address", "Full Address");
phone(SJ, "ref_phone", "Phone Number");
text(SJ, "emergency_name", "Name", { description: "EMERGENCY CONTACT (HOME COUNTRY)" });
longText(SJ, "emergency_address", "Full Address & Relationship");
phone(SJ, "emergency_phone", "Phone Number");

// ---- K: the three documents (uploaded here) ----
file(SK, "doc_passport", "Current Valid Passport (Color scanned copy of First & Last page)", { description: "Submission format: Upload here" });
file(SK, "doc_photo", "Recent Passport-Style Color Photograph (White background)", { description: "Submission format: Upload here" });
file(SK, "doc_invitation", "Invitation Letter from Inviting Person/Host in India (If applicable)", { required: false, description: "Submission format: Upload here" });

function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
    ...(spec.rules ? { validationRules: spec.rules } : {}),
  };
  const questionKey = key(spec.name);
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document" } });
  return buildQuestion(questionKey, spec.label, spec.type, spec.section, order, { ...common, metadata: { ...(spec.passportOptOut ? { passportInformation: false } : {}) } });
}

function buildIndianEtouristEvisaChecklist() {
  const counters = new Map();
  const questions = SPECS.map((spec) => {
    const order = (counters.get(spec.section) || 0) + 1;
    counters.set(spec.section, order);
    return buildField(spec, order);
  });
  return {
    key: CHECKLIST_KEY,
    title: CHECKLIST_TITLE,
    visaType: "INDIAN-E-TOURIST-VISA",
    visaTypes: ["INDIAN-E-TOURIST-VISA"],
    checklistRole: "client",
    isDefault: false, // assigned only by the E-Visa subtype's own filing type
    reconcileMetadata: true,
    sections: SECTIONS,
    questions,
  };
}

const INDIAN_ETOURIST_EVISA_DEFINITIONS = [buildIndianEtouristEvisaChecklist()];

module.exports = { CHECKLIST_KEY, CHECKLIST_TITLE, SUBTYPE_LABEL, SECTIONS, INDIAN_ETOURIST_EVISA_DEFINITIONS, buildIndianEtouristEvisaChecklist };
