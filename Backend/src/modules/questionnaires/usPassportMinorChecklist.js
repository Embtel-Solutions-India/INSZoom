// US Passport Renewal for Minors (Indian Timeline Cases): DS-11 Passport Application Checklist for Minors (Under Age 16).
//   key "us_passport_minor_ds11_checklist", question keys "ds11minor_<name>".
// Single-person, client role, NO USCIS forms, not a default of the visa type (the subtype's own filing type names this checklist), same builder shape as the OCI subtypes.
// A data-collection questionnaire only: it is not an immigration visa application. The Beneficiary is the minor applicant. A conditional question carries conditionalLogic
// (never required while hidden). Cross-field rules the existing validator cannot express (under-16, return >= departure) are NOT enforced; they are documented in the report.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");

const CHECKLIST_KEY = "us_passport_minor_ds11_checklist";
const SUBTYPE_LABEL = "US Passport Renewal for Minors";
const CHECKLIST_TITLE = "DS-11 Passport Application Checklist for Minors (Under Age 16)";
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));

const S1 = "Section 1: Minor Applicant Details (Form DS-11 Data)";
const S2 = "Section 2: Contact & Delivery Information";
const S3 = "Section 3: Travel Plans & Emergency Contact Details";
const S4 = "Section 4: Minor's Most Recent Passport Details & Product Selection";
const S5 = "Section 5: Applicant's Parents' / Legal Guardians' Details";
const SECTIONS = [S1, S2, S3, S4, S5];

const CATEGORY = {
  first: "First-time applicant (No previous U.S. passport)",
  book: "Have a Passport Book and want to renew/replace it",
  card: "Have a Passport Card and want to renew/replace it",
  both: "Have both Book & Card and want to renew/replace both",
};
const STATUS_OPTIONS = ["Submitted", "Lost", "Stolen*"];
const SSN_HELPER = "SSN Requirement: You must provide an SSN if issued. If the child has NEVER been issued an SSN, enter 000-00-0000.";
const SSN_RULE = [{ type: "regex", value: "^\\d{3}-?\\d{2}-?\\d{4}$", message: "Enter the SSN as 123-45-6789, or 000-00-0000 if none has ever been issued." }];
const PAST_DATE = [{ type: "date", value: "past", message: "Enter a valid date (MM/DD/YYYY) that is not in the future." }];
const ANY_DATE = [{ type: "date", message: "Enter a valid date (MM/DD/YYYY)." }];
const A_NUMBER_RULE = [{ type: "regex", value: "^[Aa]?-?\\d{7,9}$", message: "Enter the A-Number as 7 to 9 digits, for example A123456789." }];
const HEIGHT_RULE = [{ type: "regex", value: "^[1-6]\\s*(?:[Ff][Tt]|[Ff]eet|'|-)\\s*(?:[0-9]|1[01])\\s*(?:[Ii][Nn]|[Ii]nches|\")?$", message: "Enter the height as feet and inches, for example 4 ft 6 in." }];
const HAIR = ["Bald", "Black", "Blond", "Blue", "Brown", "Gray", "Green", "Orange", "Pink", "Purple", "Red", "Sandy", "White"];
const EYES = ["Black", "Blue", "Brown", "Gray", "Green", "Hazel", "Maroon", "Multicolored", "Pink"];

const key = (name) => `ds11minor_${name}`;

const SPECS = [];
const add = (section, name, label, type, extras = {}) => SPECS.push({ section, name, label, type, required: extras.required !== false, ...extras });
const text = (section, name, label, extras) => add(section, name, label, "text", extras);
const longText = (section, name, label, extras) => add(section, name, label, "textarea", extras);
const date = (section, name, label, extras) => add(section, name, label, "date", { rules: ANY_DATE, ...extras });
const phone = (section, name, label, extras) => add(section, name, label, "phone", extras);
const email = (section, name, label, extras) => add(section, name, label, "email", extras);
const address = (section, name, label, extras) => add(section, name, label, "address", extras);
const select = (section, name, label, options, extras) => add(section, name, label, "select", { options, ...extras });
const yesNo = (section, name, label, extras) => add(section, name, label, "radio", { options: YES_NO, ...extras });

// ---- Section 1 ----
text(S1, "first_name", "First Name", { map: "person.firstName" });
text(S1, "middle_name", "Middle Name", { required: false });
text(S1, "last_name", "Last Name", { map: "person.lastName" });
text(S1, "other_names", "Other Names Used", { required: false });
date(S1, "date_of_birth", "Date of Birth (MM/DD/YYYY)", { rules: PAST_DATE, map: "person.dob" });
text(S1, "ssn", "Social Security Number (SSN)*", { rules: SSN_RULE, description: SSN_HELPER });
text(S1, "city_of_birth", "City of Birth");
text(S1, "state_of_birth", "State / Territory of Birth", { required: false });
select(S1, "country_of_birth", "Country of Birth", COUNTRY_OPTIONS, { map: "person.countryOfBirth" });
text(S1, "a_number", "USCIS Registration A-Number (if any)", { required: false, rules: A_NUMBER_RULE });
select(S1, "sex", "Sex (M / F / X)", ["M", "F", "X"]);
text(S1, "height", "Height (Feet & Inches)", { rules: HEIGHT_RULE });
select(S1, "hair_color", "Hair Color", HAIR);
select(S1, "eye_color", "Eye Color", EYES);
select(S1, "occupation", "Occupation", ["Student / Child"]);
text(S1, "school_name", "School Name", { required: false });

// ---- Section 2: contact & delivery (placed here so the supplied section heading exists and each question appears once) ----
address(S2, "mailing_address", "Full Mailing Address");
text(S2, "in_care_of", "In Care Of Full Name (Parent/Guardian receiving mail)", { required: false });
yesNo(S2, "mailing_same_as_permanent", "Is Mailing Address same as Permanent Address?");
address(S2, "permanent_address", "Full Permanent Address (if different)", { required: false });
email(S2, "email", "Email Address");
phone(S2, "phone", "Phone / Mobile Number", { map: "contact.phone" });

// ---- Section 3 ----
date(S3, "departure_date", "Date of Departure (MM/DD/YYYY)", { required: false, description: "A. Travel Plans, If any" });
date(S3, "return_date", "Date of Return (MM/DD/YYYY)", { required: false });
longText(S3, "countries_to_visit", "Countries to be Visited", { required: false });
text(S3, "emergency_name", "Full Name (First & Last)", { description: "B. Emergency Contact Person Details (Someone not traveling with minor)" });
address(S3, "emergency_address", "Full Mailing Address");
phone(S3, "emergency_phone", "Telephone / Contact Number");
email(S3, "emergency_email", "Email Address", { required: false });
text(S3, "emergency_relationship", "Relationship with Minor");

// ---- Section 4: one set of recent-passport details, exactly as the supplied checklist (optional: a first-time applicant has no previous passport) ----
add(S4, "category", "Select application category / product requested:", "radio", { options: Object.values(CATEGORY) });
// opts out of the platform "passport information is always required" rule: a first-time applicant has no previous passport
text(S4, "prev_number", "Most Recent Passport / Card No", { required: false, passportOptOut: true });
date(S4, "prev_issue_date", "Issue Date (MM/DD/YYYY)", { required: false, rules: PAST_DATE });
select(S4, "prev_status", "Status of Recent Document", STATUS_OPTIONS, { required: false });
date(S4, "prev_expiry_date", "Book/Card Expiration Date", { required: false });

// ---- Section 5: Parent 1 is required; Parent 2 is optional (a child may have a single legal guardian) ----
const parent = (prefix, who, required) => {
  text(S5, `${prefix}_first_middle_name`, `${who} First & Middle Name`, { required });
  text(S5, `${prefix}_last_name`, `${who} Last Name`, { required });
  date(S5, `${prefix}_dob`, "Date of Birth (MM/DD/YYYY)", { rules: PAST_DATE, required });
  text(S5, `${prefix}_place_of_birth`, "Place of Birth (City, State, Country)", { required });
  yesNo(S5, `${prefix}_us_citizen`, "U.S. Citizen?", { required });
};
parent("parent1", "Father's / Parent 1", true);
parent("parent2", "Mother's / Parent 2", false);


function buildField(spec, order) {
  return buildQuestion(key(spec.name), spec.label, spec.type, spec.section, order, {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
    ...(spec.rules ? { validationRules: spec.rules } : {}),
    ...(spec.map ? { mapping: { canonicalPath: spec.map } } : {}),
    metadata: { sourcePath: `ds11Minor.${spec.name}`, ...(spec.name === "ssn" ? { sensitive: true } : {}), ...(spec.passportOptOut ? { passportInformation: false } : {}) },
  });
}

function buildUsPassportMinorChecklist() {
  const counters = new Map();
  const questions = SPECS.map((spec) => {
    const order = (counters.get(spec.section) || 0) + 1;
    counters.set(spec.section, order);
    return buildField(spec, order);
  });
  return {
    key: CHECKLIST_KEY,
    title: CHECKLIST_TITLE,
    visaType: "US-PASSPORT-MINOR",
    visaTypes: ["US-PASSPORT-MINOR"],
    checklistRole: "client",
    isDefault: false, // assigned only by this subtype's own filing type
    reconcileMetadata: true,
    description: "Information needed to prepare the DS-11 U.S. passport application for a child under age 16 (first-time application, or renewal/replacement of a Passport Book and/or Passport Card).",
    sections: SECTIONS,
    questions,
  };
}

const US_PASSPORT_MINOR_CHECKLIST_DEFINITIONS = [buildUsPassportMinorChecklist()];

module.exports = { CHECKLIST_KEY, CHECKLIST_TITLE, SUBTYPE_LABEL, CATEGORY, SECTIONS, US_PASSPORT_MINOR_CHECKLIST_DEFINITIONS, buildUsPassportMinorChecklist };
