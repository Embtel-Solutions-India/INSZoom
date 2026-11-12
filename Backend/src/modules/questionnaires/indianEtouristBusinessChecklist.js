// Indian E-Tourist Visa -> subtype "Business Visa": INDIAN BUSINESS VISA APPLICATION QUESTIONNAIRE (+ Section K, the Mandatory Document Checklist).
//   key "indian_etourist_business_visa_checklist", question keys "inbiz_<name>".
// Checklist-only like the OCI subtypes: single-person, client role, NO USCIS forms, NO canonical mappings, not a default of the visa type
// (the subtype's own filing type names this checklist). Source wording is preserved verbatim (the "lndia" spelling and the "E-Tourist Visa" value inside a Business Visa questionnaire are kept as supplied). The agency heading, legal disclaimer, contact details and closing note of the source are deliberately NOT included: only section names and questions. A conditional question carries conditionalLogic
// (never required while hidden). A document the source marks conditional but whose applicability the case data cannot decide is shown as OPTIONAL
// (staff decide on review); nothing here invents a legal requirement.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");

const CHECKLIST_KEY = "indian_etourist_business_visa_checklist";
const CHECKLIST_TITLE = "INDIAN BUSINESS VISA APPLICATION QUESTIONNAIRE";
const SUBTYPE_LABEL = "Business Visa";
const INSTRUCTIONS = "Please answer all applicable questions thoroughly to assist us in preparing an accurate visa application. If a specific item does not apply to you, write 'N/A'. Physical evidence is not required for every field, but completeness prevents processing delays.";

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

const key = (name) => `inbiz_${name}`;
const rule = (name, operator, value) => ({ questionKey: key(name), operator, ...(value === undefined ? {} : { value }) });
const all = (...rules) => ({ mode: "all", rules, groups: [] });
const eq = (name, value) => all(rule(name, "equals", value));
const YES = (name) => eq(name, "Yes");
const MARRIED = eq("marital_status", "Married");
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
date(SA, "date_of_marriage", "Date of Marriage", { cond: MARRIED });
date(SA, "date_of_birth", "Date of Birth");
text(SA, "religion", "Religion");
text(SA, "place_of_birth", "Place of Birth (City/Town, State)");
country(SA, "country_of_birth", "Country of Birth");
country(SA, "citizenship", "Current Citizenship / Nationality");
text(SA, "citizenship_id", "Citizenship/National Id No.");
text(SA, "identification_marks", "Visible Identification Marks", { description: "Enter 'None' if there are none." });
text(SA, "education", "Highest Educational Qualification", { description: "e.g., High School, Graduate, Post Graduate, Professional" });
text(SA, "qualification_institution", "Qualification acquired from College/University", { required: false, description: "e.g., M.B.A, B.Sc in computer Science, BBA etc" });

// ---- B ----
text(SB, "passport_number", "Passport Number");
date(SB, "passport_issue_date", "Date of Issue");
date(SB, "passport_expiry_date", "Date of Expiry");
text(SB, "passport_authority", "Place / Authority of Issue");
yesNo(SB, "other_passport", "Do you hold any other Passport or Identity Certificate?");
text(SB, "other_passport_number", "If Yes, Passport / IC Number", { cond: YES("other_passport") });
country(SB, "other_passport_country", "If Yes, Country of Issue", { cond: YES("other_passport") });
date(SB, "other_passport_issue_date", "If Yes, Date of Issue", { cond: YES("other_passport") });
text(SB, "other_passport_place", "If Yes, Place of Issue", { cond: YES("other_passport") });
text(SB, "other_passport_nationality", "If Yes, Nationality mentioned therein", { cond: YES("other_passport") });

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
text(SD, "spouse_name", "Spouse's Full Name", { cond: MARRIED, description: "SPOUSE'S DETAILS" });
text(SD, "spouse_nationality", "Spouse's Nationality", { cond: MARRIED });
text(SD, "spouse_prev_nationality", "Spouse's Previous Nationality (if any)", { cond: MARRIED, required: false });
text(SD, "spouse_birth", "Spouse's Place & Country of Birth", { cond: MARRIED });
text(SD, "spouse_occupation", "Spouse's Occupation", { cond: MARRIED });

// ---- E ----
yesNo(SE, "pakistan_origin", "Were your parents or grandparents (paternal/maternal) Pakistan nationals or from Pakistan-held territories?");
longText(SE, "pakistan_origin_details", "If Yes, provide detailed information", { cond: YES("pakistan_origin") });

// ---- F ----
select(SF, "visa_service_type", "Visa Service Type Requested", ["E-Tourist Visa"]);
text(SF, "visa_duration", "Requested Visa Duration / Validity", { description: "e.g., 30 Days / 1 Year / 5 Years" });
select(SF, "entries", "Number of Entries Required", ["Double Entry", "Multiple Entry"]);
date(SF, "journey_date", "Expected Date of Journey / Arrival");
text(SF, "port_arrival", "Designated Port of Arrival in India");
text(SF, "port_exit", "Expected Port of Exit from India");

// ---- G ----
select(SG, "purpose", "Primary Purpose of Visit", ["Tourism", "Recreation", "Sightseeing", "Meeting Friends/Relatives"]);
text(SG, "place_1", "Cities / Places to Visit (Location 1)");
text(SG, "place_2", "Cities / Places to Visit (Location 2)", { required: false });
yesNo(SG, "hotel_booked", "Have you booked hotel/resort accommodations?");
text(SG, "hotel_name", "If Yes, Hotel / Resort Name & City", { cond: YES("hotel_booked") });
yesNo(SG, "tour_operator", "Is your trip organized through a Tour Operator?");
longText(SG, "tour_operator_details", "If Yes, Tour Operator Name & Address", { cond: YES("tour_operator") });
longText(SG, "stay_address", "Address of Accommodation / Stay in India");
longText(SG, "contact_in_india", "Contact Person / Relative in India (Name, Address & Relationship)");

// ---- H ----
yesNo(SH, "applied_evisa", "Have you previously applied for an Indian e-Visa?", { description: "Yes / No - If Yes, state details" });
longText(SH, "applied_evisa_details", "If Yes, state details", { cond: YES("applied_evisa") });
yesNo(SH, "visited_india", "Have you visited India previously?");
longText(SH, "prev_stay_address", "If Yes, Address of Previous Stay in India", { cond: YES("visited_india") });
longText(SH, "prev_cities", "If Yes, Cities Visited Previously", { cond: YES("visited_india") });
text(SH, "prev_visa_number", "If Yes, Previous Visa Number & Type", { cond: YES("visited_india") });
text(SH, "prev_visa_issue", "If Yes, Place & Date of Visa Issue", { cond: YES("visited_india") });
yesNo(SH, "permission_denied", "Has permission to visit or extend stay in India ever been denied?");
longText(SH, "permission_denied_details", "If Yes, when and by whom (Mention control no. & date also)", { cond: YES("permission_denied") });
longText(SH, "countries_10_years", "Countries visited in the last 10 years", { description: "List every country, separated by commas or on separate lines." });
yesNo(SH, "saarc", "Have you visited any SAARC countries (except your home country) in the past 3 years?", { description: "Afghanistan, Bangladesh, Bhutan, Maldives, Nepal, Pakistan, Sri Lanka" });
yesNo(SH, "name_changed", "Have you ever officially changed your name?");

// ---- I ----
text(SI, "occupation", "Current Occupation / Profession Type", { description: "Note for Homemakers / Dependent Students\nProvide details of father's or spouse's occupation above" });
text(SI, "designation", "Designation / Rank / Job Title");
text(SI, "employer_name", "Employer / Business Name");
longText(SI, "employer_address", "Employer / Business Address");
phone(SI, "employer_phone", "Employer Phone Number");
text(SI, "past_occupation", "Past Occupation, if any", { required: false });
yesNo(SI, "military", "Are/were you in a Military/SemiMilitary/Police/Security. Organization?");
longText(SI, "military_details", "If Yes give details", { cond: YES("military") });

// ---- J ----
text(SJ, "ref_name", "Name", { description: "REFERENCE IN INDIA" });
longText(SJ, "ref_address", "Full Address");
phone(SJ, "ref_phone", "Phone Number");
text(SJ, "emergency_name", "Name", { description: "EMERGENCY CONTACT (HOME COUNTRY)" });
longText(SJ, "emergency_address", "Full Address & Relationship");
phone(SJ, "emergency_phone", "Phone Number");

// ---- K: 16 document entries, in the supplied order (K1 has two upload slots) ----
const lines = (...items) => items.join("\n");
const LETTER_FOOTER = "Letters need to be signed by authorised signatory of the company, proxy signatures are not acceptable.";
const LETTER_ITEMS = ["Purpose of Visit", "Applicants Name", "Passport number", "Start & Expiry date of the passport", "Duration of stay in lndia (per trip -if applicable)"];
file(SK, "doc_photo", "Digital Photograph & Signature - Photograph", { description: lines("Part 1: Photograph Requirements", "- Use a white background and wear dark-colored attire.", "- The photograph must be no older than two months.", "- Your shoulders must be clearly visible.", "- Ensure there is no glare or shadow on your face or anywhere in the photograph.", "- Please provide a high-quality HD photograph via email.") });
file(SK, "doc_signature", "Digital Photograph & Signature - Signature", { description: lines("Part 2: Signature Requirements", "- Please sign on a plain white sheet of paper using a dark-colored pen.", "- Ensure your signature is clear and properly visible.", "- Please scan the signed page in high quality and send it to us via email.") });
add(SK, "physical_photos", "Physical Photographs", "radio", {
  options: [{ label: "I will provide three identical physical passport-sized photographs when submitting my application", value: "confirmed" }],
  description: lines("Please provide three (3) identical physical passport-sized photographs (2 inches × 2 inches) with a white background at the time of submitting your application.", "Important: The physical photographs must be exactly the same as the photograph(s) you send to us via email."),
});
file(SK, "doc_physical_photos_file", "Physical Photographs - optional supporting file", { required: false, description: "Optional. An uploaded image does not replace the physical photographs." });
file(SK, "doc_address_proof", "Copy of proof of address", { description: lines("- State Issued ID OR", "- Driving license OR", "- Utility Bill - (Water / Gas / Electricity (should be recent, no more than 3 months old) OR", "- Valid Lease Agreement OR", "- Mortgage OR", "- Income Tax return OR", "- For College/University Students living on campus in University housing/dormitories, a letter from your institution on the institution letterhead explaining the exact address that you presently reside in will suffice.", "- Marriage Certificate in case the address in spouse’s name, birth certificate of child in case of minor applicant along with parent’s address proof.", "- In case of applicant residing with parents/children/ relatives, a notarized undertaking from them with one of the copies of address proof as indicated above.", "- Hotel bill - If the customer on L1/L3 staying in a hotel for a project for the past couple of months and don’t have the address proof or state ID.") });
// the platform rule (passportInformation.js) makes any question whose label mentions a passport always required once visible, so applicability is decided by the
// applicant's own Current Citizenship answer instead: shown (and then required) only for a non-US applicant, hidden for a US citizen
const NON_US = all(rule("citizenship", "not_empty"), rule("citizenship", "not_equals", "United States"));
file(SK, "doc_legal_status", "Copy of valid legal status in the USA (for Non-US passport holder)", { cond: NON_US, description: lines("- Valid Green Card – FRONT AND BACK", "- Valid Visa", "- Valid EAD – FRONT AND BACK", "- Valid I-797A Approval Notice", "- Valid Work permit/Study Permit", "- Recently expired Visa and I-797A Approval notice together with I-797C Receipt Notice for filing of a request for extension before the expiry of Visa or I-797A copy of proof of extension, if B1/B2 is expired and have a receipt for extension of stay or an approval for extension of stay.") });
file(SK, "doc_passport", "Copy of Passport", { description: "Original as well as a copy of passport (biographical pages only). Passport should have a minimum validity of six months and must have at least two blank pages." });
file(SK, "doc_invitation_india", "Copy of Invitation Letter From The Company In India", { description: lines("Letter on Company letterhead from the company in India indicating the nature of applicant's business, duration of stay, the validity of visa applied for, places and organizations to be visited during the stay. Details regarding the company, undertaking for full financial responsibility to ensure travel and repatriation, if applicable, and relationship history with the employee.", "Addressed to concerned authority on the company's letter head.", LETTER_FOOTER, ...LETTER_ITEMS.map((item) => `- ${item}`)) });
file(SK, "doc_letter_usa", "Copy of Letter From Applicant’s Company In The Usa", { description: lines("Letter from the applicant's company in the US on a company letterhead stating that all expenses will be paid for by the company and indicating the nature of applicant's business, duration of stay, he/she will not receive any form of remuneration from any other source in India and will remain employee of same company, [Sales turnover certificate (For Pakistani Passport Holders only)] the validity of visa applied for, places and organizations to be visited during stay", "Addressed to concerned authority on the company's letter head.", LETTER_FOOTER, ...LETTER_ITEMS.map((item) => `- ${item}`)) });
file(SK, "doc_incorporation_letter", "Copy of Letter Of Incorporation From The Company In India", { required: false, description: "This letter is not required if the applicant is visiting Government of India institutions for meetings, etc." });
file(SK, "doc_renunciation", "Copy of Proof Of Renunciation", { required: false, description: lines("Certificate of renunciation issued by the Embassy/Consulate of India", "Deemed surrender certificate issued by the Embassy/Consulate of India Both - Cancelled/ Surrendered Passport along with the copy of the Surrender/Renunciation Certificate would be needed for Indian passports surrendered after May 2010") });
file(SK, "doc_marriage_certificate", "Copy of Marriage Certificate", { required: false, description: "Additional Documents For Dependent Business Visa For Spouse" });
file(SK, "doc_minor", "Additional Documents For Minor Applicants", { required: false, description: lines("- Parental Authorization Form (Annexure-B) duly signed by both parents and notarized", "- Birth certificate of minor applicant – Copy", "- Passports and Marriage Certificate of parents – Copy", "- US visa status documents of non-US national parents – Copy.", "- If Indian parents do not hold valid US visa status, an explanation for the same may be provided.") });
file(SK, "doc_company_incorporation_cert", "Certificate of incorporation from Indian company");
file(SK, "doc_tickets", "Confirmed To and Fro travel tickets");
file(SK, "doc_turnover", "Turnover certificate");
file(SK, "doc_hotel_booking", "Hotel booking in India", { cond: YES("hotel_booked") });
file(SK, "doc_sponsorship_letter", "A letter of Sponsorship by the Indian Company");

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
  if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document" } });
  return buildQuestion(questionKey, spec.label, spec.type, spec.section, order, { ...common, metadata: {} });
}

function buildIndianEtouristBusinessChecklist() {
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
    isDefault: false, // assigned only by the Business Visa subtype's own filing type
    reconcileMetadata: true,
    description: INSTRUCTIONS,
    sections: SECTIONS,
    questions,
  };
}

const INDIAN_ETOURIST_BUSINESS_DEFINITIONS = [buildIndianEtouristBusinessChecklist()];

module.exports = { CHECKLIST_KEY, CHECKLIST_TITLE, SUBTYPE_LABEL, INSTRUCTIONS, SECTIONS, INDIAN_ETOURIST_BUSINESS_DEFINITIONS, buildIndianEtouristBusinessChecklist };
