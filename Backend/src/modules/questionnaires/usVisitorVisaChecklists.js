// US Visitor Visa (Indian Timeline Cases): a visa type with NO subtype and TWO checklists, both belonging to this visa type only:
//   1. "us_visitor_visa_applicant_checklist"  - VISITOR VISA DOCUMENT CHECKLIST & QUESTIONNAIRE   (question keys "usvv_<name>")
//   2. "us_visitor_visa_i134_checklist"       - I-134 Checklist: Questionnaire for the Sponsor    (question keys "usvi_<name>")
// Both are DEFAULT checklists of the visa type "US-VISITOR-VISA" (isDefault + visaType + client role - the path GC-NVC / PERM use): a case gets exactly the default checklists whose
// visa type equals the case's visa type, so these two reach US Visitor Visa cases and no other case. They are shown in order, the applicant checklist first and the sponsor questionnaire
// second (settings.checklistOrder). Single-person, client role, NO USCIS forms, NO canonical mappings.
// Exactly the questions of the supplied checklists, every one ALWAYS visible (no show-when rules); core items required, situational ones optional. The "IMPORTANT INSTRUCTIONS" block
// is not included (owner decision: no checklist carries instructions text), there is no e-mail wording, and neither checklist asks for physical photographs.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");

const VISA_TYPE = "US-VISITOR-VISA";
const APPLICANT_KEY = "us_visitor_visa_applicant_checklist";
const I134_KEY = "us_visitor_visa_i134_checklist";
const APPLICANT_TITLE = "US Visitor Visa - Visitor Visa Document Checklist & Questionnaire";
const I134_TITLE = "US Visitor Visa - I-134 Checklist: Questionnaire for the Sponsor";

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));
const MARITAL = ["Single / Never Married", "Married", "Divorced", "Widowed", "Separated"];
const GENDER = ["Male", "Female", "Other"];

// ---- tiny spec DSL (one list of specs per checklist) ----
function dsl() {
  const specs = [];
  const add = (section, name, label, type, extras = {}) => specs.push({ section, name, label, type, required: extras.required !== false, ...extras });
  return {
    specs, add,
    text: (s, n, l, e) => add(s, n, l, "text", e),
    longText: (s, n, l, e) => add(s, n, l, "textarea", e),
    phone: (s, n, l, e) => add(s, n, l, "phone", e),
    email: (s, n, l, e) => add(s, n, l, "email", e),
    date: (s, n, l, e) => add(s, n, l, "date", { rules: [{ type: "date", message: "Enter a valid date." }], ...e }),
    country: (s, n, l, e) => add(s, n, l, "select", { options: COUNTRY_OPTIONS, ...e }),
    select: (s, n, l, options, e) => add(s, n, l, "select", { options, ...e }),
    yesNo: (s, n, l, e) => add(s, n, l, "radio", { options: YES_NO, ...e }),
    choice: (s, n, l, options, e) => add(s, n, l, "radio", { options: options.map((value) => ({ label: value, value })), ...e }),
    number: (s, n, l, e) => add(s, n, l, "number", { min: 0, step: "1", ...e }),
    file: (s, n, l, e) => add(s, n, l, "file", e),
    group: (s, n, l, config, e) => add(s, n, l, "repeating_group", { group: config, ...e }),
  };
}
const col = (columnKey, label, type = "text", extras = {}) => ({ key: columnKey, label, type, required: true, ...extras });
const lines = (...items) => items.join("\n");

// =====================================================================================================================
// Checklist 1: VISITOR VISA DOCUMENT CHECKLIST & QUESTIONNAIRE
// =====================================================================================================================
const A = dsl();
const S1 = "1. Applicant Basic Contact Information";
const S2 = "2. Required Document Checklist";
const SA = "A. Personal & Background Details";
const SB = "B. Passport Details";
const SC = "C. Travel Information";
const SD = "D. Person traveling with You";
const SE = "E. USA Contact Information";
const SF = "F. Family Information";
const SG = "G. Primary Occupation";
const SH = "H. Education Details";
const SI = "I. Additional Information";
const APPLICANT_SECTIONS = [S1, S2, SA, SB, SC, SD, SE, SF, SG, SH, SI];

A.text(S1, "applicant_name", "Applicant Full Name");
A.phone(S1, "applicant_phone", "Phone Number");
A.email(S1, "applicant_email", "Email Id");

// the platform makes any item with "passport" in its label or key always required (passportInformation.js): the passport copy and the passport details are required anyway
A.file(S2, "doc_passport_copy", "Copy of Passport", { description: "Color copy of the first two and last two pages of your current valid passport (must have more than 6 months validity remaining)." });
A.file(S2, "doc_photograph", "Photograph", { description: "One Digital US Passport size photo (2’ X 2’)" });

A.text(SA, "surname", "Applicant’s Surname");
A.text(SA, "given_name", "Applicant’s Given Name");
A.select(SA, "marital_status", "Marital Status", MARITAL);
A.date(SA, "date_of_birth", "Date of Birth");
A.text(SA, "birth_place", "City, State & Country of Birth");
A.text(SA, "national_id_number", "National Identification Number", { required: false });
A.longText(SA, "home_address", "Home Address of the person");
A.phone(SA, "phone", "Phone number");
A.email(SA, "email", "Email id");

A.text(SB, "passport_number", "Passport Number");
A.country(SB, "passport_country", "Country Issued Passport number");
A.text(SB, "issued_city", "City where issued");
A.text(SB, "issued_state", "State where issued", { required: false });
A.date(SB, "issuance_date", "Issuance date");
A.date(SB, "expiration_date", "Expiration date");
A.yesNo(SB, "passport_lost_or_stolen", "Have you ever lost a passport or had one stolen?");

A.date(SC, "travel_date", "Tentative date of travel");
A.text(SC, "stay_length", "Tentative length of stay in US");
A.longText(SC, "us_stay_address", "Address where you will stay in the US");
A.text(SC, "trip_payer", "Person/ Entity Paying for your trip");
A.text(SC, "sponsor_name", "Name of Sponsor", { required: false });
A.longText(SC, "sponsor_address", "Address of the Sponsor", { required: false });
A.phone(SC, "sponsor_phone", "Telephone Number of the Sponsor", { required: false });
A.email(SC, "sponsor_email", "Email address of Sponsor", { required: false });
A.text(SC, "sponsor_relationship", "Relationship to you", { required: false });

A.text(SD, "companion_name", "Name of the Person", { required: false });
A.text(SD, "companion_relation", "Relation to You", { required: false });
A.yesNo(SD, "been_to_usa", "Have you ever been to the USA?", { description: "If Yes, please provide the below details:" });
A.group(SD, "us_visits", "US visits", {
  itemLabel: "Visit", addLabel: "+ Add Visit", summaryFields: ["travel_date", "duration"], max: 5,
  columns: [col("travel_date", "US Travel date (mm/dd/yyyy)", "date"), col("duration", "Duration of the stay")],
}, { required: false });
A.yesNo(SD, "visa_issued", "Have you ever been issued a USA Visa?", { description: "If Yes, please provide details below:" });
A.date(SD, "visa_issuance_date", "Visa Issuance Date", { required: false });
A.text(SD, "visa_number", "Visa number", { required: false, description: "(it is a red color number on your visa stamp on your passport)" });
A.longText(SD, "countries_last_five_years", "List of the Countries that you have traveled in the last five years");
A.yesNo(SD, "visa_refused", "Have you ever been refused a US Visa, been refused admission to the United States or withdrawn your application for admission at the point of entry?");

A.text(SE, "contact_name", "Contact Name in USA");
A.text(SE, "contact_organization", "Organization name in the USA", { required: false });
A.text(SE, "contact_relationship", "Relationship to you");
A.longText(SE, "contact_address", "USA Contact Address");
A.phone(SE, "contact_phone", "Phone Number");
A.email(SE, "contact_email", "Email Address", { required: false });

A.text(SF, "father_first_name", "Father’s first name");
A.text(SF, "father_surname", "Father’s surname");
A.date(SF, "father_dob", "Father DOB(mm/dd/yyyy)");
A.yesNo(SF, "father_in_usa", "Is your Father in the USA?");
A.text(SF, "mother_first_name", "Mother’s first name");
A.text(SF, "mother_surname", "Mother’s surname");
A.date(SF, "mother_dob", "Mother DOB(mm/dd/yyyy)");
A.yesNo(SF, "mother_in_usa", "Is your Mother in the USA?");
A.yesNo(SF, "relatives_in_usa", "Do you have any immediate relatives in the USA?", { description: "If Yes, then" });
A.group(SF, "relatives", "Immediate relatives in the USA", {
  itemLabel: "Relative", addLabel: "+ Add Relative", summaryFields: ["name", "surname"],
  columns: [col("name", "Relative’s name"), col("surname", "Relative’s surname"), col("status", "Status in the USA"), col("relationship", "Relationship to you")],
}, { required: false });
A.text(SF, "spouse_first_name", "Spouse’s first name", { required: false, description: "IF Married:" });
A.text(SF, "spouse_surname", "Spouse’s surname", { required: false });
A.date(SF, "spouse_dob", "Spouse DOB(mm/dd/yyyy)", { required: false });
A.country(SF, "spouse_nationality", "Spouse Nationality", { required: false });
A.text(SF, "spouse_birth_city", "Spouse City of Birth", { required: false });
A.country(SF, "spouse_birth_country", "Spouse Country of birth", { required: false });
A.longText(SF, "spouse_address", "Spouse Address", { required: false });

A.text(SG, "employer_name", "Employer Name", { required: false, description: "If Employed or Self-Employed (Mention Current Employment Below)" });
A.longText(SG, "employer_address", "Address", { required: false });
A.phone(SG, "employer_phone", "Phone number", { required: false });
A.text(SG, "income_per_annum", "Income per Annum", { required: false });
A.date(SG, "employment_start", "Date of Joining(mm/dd/yyyy)", { required: false });
A.text(SG, "designation", "Designation", { required: false });
A.longText(SG, "duties", "Briefly describe your duties", { required: false });
A.group(SG, "employment_history", "Employment history", {
  itemLabel: "Employment", addLabel: "+ Add Employment", summaryFields: ["employer_name", "job_title"], max: 3,
  columns: [col("employer_name", "Employer/Company Name"), col("employer_address", "Full Employer/Company Address", "textarea"), col("employer_phone", "Telephone Number", "phone"), col("job_title", "Your Job Title"),
    col("supervisor_name", "Supervisor's name"), col("supervisor_surname", "Supervisor's surname"), col("start_date", "Employment Start Date(mm/dd/yyyy)", "date"), col("end_date", "Employment End Date(mm/dd/yyyy)", "date"), col("duties", "Briefly describe your duties", "textarea")],
}, { required: false, description: "If you were previously employed, provide your employment history for the last 5 years in the table below:" });
A.text(SG, "retired_employer_name", "Employer Name", { required: false, description: "If Retired:" });
A.longText(SG, "retired_address", "Address", { required: false });
A.phone(SG, "retired_phone", "Phone number", { required: false });
A.text(SG, "retired_income", "Income per Annum", { required: false });
A.date(SG, "retired_start", "Date of Joining(mm/dd/yyyy)", { required: false });
A.date(SG, "retired_end", "Date of leaving(mm/dd/yyyy)", { required: false });
A.text(SG, "retired_designation", "Designation", { required: false });
A.longText(SG, "retired_duties", "Briefly describe your duties", { required: false });
A.text(SG, "retired_supervisor_name", "Supervisor's Name", { required: false });
A.text(SG, "retired_supervisor_surname", "Supervisor's surname", { required: false });

A.group(SH, "education", "Educational institutions", {
  itemLabel: "Institution", addLabel: "+ Add Institution", summaryFields: ["name", "course"], max: 3,
  columns: [col("name", "Name of Institution"), col("address", "Full Address of Institution", "textarea"), col("course", "Course of Study"), col("from", "Date of Attendance From (mm/dd/yyyy)", "date"), col("to", "Date of Attendance To (mm/dd/yyyy)", "date")],
}, { required: false, description: "Provide the following information on the educational institution(s) you have attended that are secondary level or above:" });

A.text(SI, "social_security_number", "Social Security Number(if available)", { required: false });
A.group(SI, "social_media", "Social media", {
  itemLabel: "Platform", addLabel: "+ Add Platform", summaryFields: ["platform", "identifier"],
  columns: [col("platform", "Social Media Provider/Platform"), col("identifier", "Social Media Identifier")],
}, { required: false, description: "List each Social Media platform that you have used within the last 5 years. If none, then mention none." });
A.text(SI, "us_driver_license_number", "US Driver's License Number", { required: false, description: "If you ever hold a U.S. Driver's License, provide the following details:" });
A.text(SI, "us_driver_license_state", "US State that issued Driver's License", { required: false });
A.text(SI, "languages", "Provide a List of Languages You Speak", { required: false });

// =====================================================================================================================
// Checklist 2: I-134 Checklist - Questionnaire for the Sponsor
// =====================================================================================================================
const B = dsl();
const T1 = "I. Sponsor Information";
const T2 = "II. Employment Status";
const T3 = "III. Assets";
const T4 = "IV. Beneficiary Details";
const T5 = "V. Required Document Checklist";
const I134_SECTIONS = [T1, T2, T3, T4, T5];

B.text(T1, "sponsor_surname", "Sponsor’s Surname");
B.text(T1, "sponsor_given_name", "Sponsor’s Given");
B.date(T1, "sponsor_dob", "Date of Birth");
B.text(T1, "sponsor_birth_city", "City or Town of Birth");
B.text(T1, "sponsor_birth_state", "State or Province of Birth", { required: false });
B.country(T1, "sponsor_birth_country", "Country of Birth");
B.text(T1, "sponsor_a_number", "Alien Registration Number (A-Number) (if any)", { required: false });
B.text(T1, "sponsor_relationship", "What is your relationship to the beneficiary?");
B.text(T1, "sponsor_income", "Current annual income");
B.longText(T1, "sponsor_address", "Sponsor's Current address");
B.text(T1, "sponsor_us_status", "Sponsor's Current status in the USA", { required: false });
B.number(T1, "other_forms_count", "How many other Form I-134, Form I-134A, Form I-864, Form I-864EZ, and Form I-864A have you previously submitted on behalf of a person (including yourself, if applicable) and your support obligation has not ended?", { required: false, description: "Please provide the details below (Do not include the beneficiary)" });
B.group(T1, "other_forms", "Details of the other forms submitted", {
  itemLabel: "Person", addLabel: "+ Add Person", summaryFields: ["full_name", "relationship"],
  columns: [col("full_name", "Full Name"), col("dob", "Date of Birth", "date"), col("relationship", "Relationship to You"), col("a_number", "A Number", "text", { required: false }), col("receipt_number", "Receipt Number", "text", { required: false })],
}, { required: false });
B.number(T1, "dependents_count", "How many dependents do you support (including yourself)?", { required: false, description: "Do not include the above members and the beneficiary name:" });
B.group(T1, "dependents", "Dependents you support", {
  itemLabel: "Dependent", addLabel: "+ Add Dependent", summaryFields: ["full_name", "relationship"],
  columns: [col("full_name", "Full Name"), col("dob", "Date of Birth (dd/mm/yyyy)", "date"), col("relationship", "Relationship to you"), col("a_number", "A-Number (If any)", "text", { required: false }), col("receipt_number", "Receipt Number (If any)", "text", { required: false })],
}, { required: false });

B.choice(T2, "employment_status", "Employment status", ["Employed (full-time, part-time, seasonal)", "Self-employed", "Unemployed, not employed, or retired", "Other"]);
B.text(T2, "employed_title", "Title/Position", { required: false, description: "If employed (full-time, part-time, seasonal):" });
B.text(T2, "employed_employer", "Name of Employer", { required: false });
B.text(T2, "self_employed_title", "Title/Profession", { required: false, description: "If self-employed:" });
B.text(T2, "unemployed_specify", "Please specify", { required: false, description: "If unemployed, not employed, or retired:" });
B.text(T2, "other_explain", "Please explain", { required: false, description: "If other:" });

B.group(T3, "assets", "Assets", {
  itemLabel: "Asset", addLabel: "+ Add Asset", summaryFields: ["asset_type", "amount"],
  columns: [col("asset_type", "Type of Asset"), col("location", "City & State (if the asset is a property or Real Estate Asset)", "text", { required: false }), col("amount", "Amount (Cash Value) (U.S. dollars)", "number", { min: 0 })],
}, { required: false, description: lines("Please provide the information listed below and submit the relevant supporting documents:",
  "Type of Asset (For example, Bank Account - Saving or Checking, Annuities, Stocks, Bonds, Certificates of Deposit, Retirement or Educational Account, Real Estate Holdings, Personal Property (net value))") });

B.text(T4, "beneficiary_surname", "Beneficiary Surname");
B.text(T4, "beneficiary_given_name", "Beneficiary Given name");
B.select(T4, "beneficiary_gender", "Gender", GENDER);
B.date(T4, "beneficiary_dob", "Date of Birth");
B.text(T4, "beneficiary_birth_place", "Place of birth");
B.text(T4, "beneficiary_birth_city", "City or Town of Birth");
B.text(T4, "beneficiary_birth_state", "State or Province of Birth", { required: false });
B.country(T4, "beneficiary_birth_country", "Country of Birth");
B.country(T4, "beneficiary_citizenship", "Country of Citizenship or Nationality");
B.text(T4, "beneficiary_a_number", "Alien Registration Number (A-Number) (if any)", { required: false });
B.select(T4, "beneficiary_marital_status", "Marital status", MARITAL);
B.longText(T4, "beneficiary_current_address", "Current Address");
B.longText(T4, "beneficiary_physical_address", "Physical Address", { required: false });
B.date(T4, "stay_from", "From (mm/dd/yyyy)", { description: "Period of stay in U.S:" });
B.date(T4, "stay_to", "To (mm/dd/yyyy)");
B.phone(T4, "beneficiary_phone", "Telephone number", { required: false });
B.email(T4, "beneficiary_email", "Email ID", { required: false });

B.file(T5, "doc_passport_copy", "Copy of current valid passport");
B.file(T5, "doc_tax_returns", "Copy of tax returns for the most recent year");
B.file(T5, "doc_bank_statements", "Copy of bank statements for last 3 months");
B.file(T5, "doc_sponsor_us_status", "If the sponsor is in the USA, then provide proof of US Status (for e.g. green card, Citizenship certificate, I-797 Approval notice, etc)", { required: false });

// =====================================================================================================================
function buildDefinition({ key, title, order, description, sections, specs, prefix, visaType = VISA_TYPE }) {
  const counters = new Map();
  const questions = specs.map((spec) => {
    const n = (counters.get(spec.section) || 0) + 1;
    counters.set(spec.section, n);
    const questionKey = `${prefix}${spec.name}`;
    const common = { required: spec.required, description: spec.description, options: spec.options, visibility: VISIBILITY, ...(spec.rules ? { validationRules: spec.rules } : {}) };
    if (spec.type === "file") return buildQuestion(questionKey, spec.label, "file", spec.section, n, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document" } });
    if (spec.type === "number") return buildQuestion(questionKey, spec.label, "number", spec.section, n, { ...common, metadata: { min: spec.min, max: spec.max, step: spec.step } });
    if (spec.type !== "repeating_group") return buildQuestion(questionKey, spec.label, spec.type, spec.section, n, { ...common, metadata: {} });
    const config = spec.group;
    return buildQuestion(questionKey, spec.label, "repeating_group", spec.section, n, {
      ...common,
      metadata: {
        itemLabel: config.itemLabel, addLabel: config.addLabel, confirmRemove: `Remove this ${config.itemLabel.toLowerCase()}? This cannot be undone.`,
        summaryFields: config.summaryFields, fields: config.columns, repeatableFields: config.columns,
      },
      repeatable: true,
      repeatableConfig: { min: spec.required ? 1 : 0, ...(config.max ? { max: config.max } : {}), labelTemplate: `${config.itemLabel} {n}`, allowClientAdd: true },
    });
  });
  return {
    key, title, description, sections, questions,
    visaType,
    visaTypes: [visaType],
    checklistRole: "client",
    isDefault: true, // assigned to every case of THIS visa type (and only to those): the same path GC-NVC / PERM use
    reconcileMetadata: true,
    settings: { checklistOrder: order }, // shown one after another: the applicant checklist first, the sponsor questionnaire second
  };
}

const buildApplicantChecklist = () => buildDefinition({ key: APPLICANT_KEY, title: APPLICANT_TITLE, order: 1, prefix: "usvv_", sections: APPLICANT_SECTIONS, specs: A.specs, description: "US Visitor Visa: document checklist and applicant questionnaire." });
const buildI134Checklist = () => buildDefinition({ key: I134_KEY, title: I134_TITLE, order: 2, prefix: "usvi_", sections: I134_SECTIONS, specs: B.specs, description: "US Visitor Visa: I-134 questionnaire for the sponsor." });

const US_VISITOR_VISA_DEFINITIONS = [buildApplicantChecklist(), buildI134Checklist()];

module.exports = { buildDefinition, APPLICANT_SPECS: A.specs, VISA_TYPE, APPLICANT_KEY, I134_KEY, APPLICANT_TITLE, I134_TITLE, APPLICANT_SECTIONS, I134_SECTIONS, US_VISITOR_VISA_DEFINITIONS, buildApplicantChecklist, buildI134Checklist };
