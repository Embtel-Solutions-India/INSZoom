// PERM (labor certification) - Employer + Employee checklists.
//
// PERM is an employer_employee matter with exactly ONE employee (the person the
// labor certification is filed for), so there are two checklists, assigned
// AUTOMATICALLY at case creation by the same default-assignment path every
// other employer/employee visa uses (isDefault + visaTypes + checklistRole):
//
//   perm_employer_information   checklistRole "employer"  (the sponsoring company)
//   perm_employee_information   checklistRole "employee"  (the PERM beneficiary)
//
// The employee checklist carries four sections - Employee Information,
// Employee Qualification, Employment History (a repeating group: any number of
// jobs, "+ Add Employment") and Required Documents. Nothing here is a USCIS
// form mapping: PERM is a Department of Labor process.
//
// Question wording follows the PERM source questionnaire; helper text below is
// instructional only and never changes the meaning of a question.

const { buildQuestion } = require("./definitionHelpers");
const { US_STATES, COUNTRIES, IMMIGRATION_STATUSES, EDUCATION_LEVELS } = require("../../config/geoOptions");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const PERM_VISA_TYPES = ["PERM"];

const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const NOT_US = { questionKey: "employee_education_institution_country", operator: "not_equals", value: "United States" };
const IS_US = { questionKey: "employee_education_institution_country", operator: "equals", value: "United States" };

const when = (...rules) => ({ mode: "all", rules, groups: [] });
const rule = (questionKey, value, operator = "equals") => ({ questionKey, operator, value });

// ── Employer Information ────────────────────────────────────────────────
const EMPLOYER_SECTION = "Employer Information";
const EMPLOYER_QUESTIONS = [
  { path: "employer.company_name", label: "Full Name of the Employer (company)", type: "text", required: true, map: "company.name" },
  { path: "employer.address", label: "Address (include Suite #, State and Zip code)", type: "address", required: true, map: "company.address" },
  { path: "employer.county", label: "County Area", type: "text", required: true, map: "company.address.county" },
  { path: "employer.total_employees", label: "Total Number of employees", type: "number", required: true, map: "company.numberOfEmployees",
    rules: [{ type: "min", value: 1, message: "Total number of employees must be at least 1." }] },
  { path: "employer.state_id_number", label: "State ID number", type: "text", required: true, format: "state_id", map: "company.stateIdNumber",
    description: "Your state employer / unemployment-insurance account number, normally 8-9 digits. Enter every digit exactly as issued - keep any leading zeros.",
    rules: [{ type: "regex", value: "^\\d{8,9}$", message: "State ID number must be 8 or 9 digits (numbers only, keep leading zeros)." }] },
  { path: "employer.ein", label: "Federal EIN Tax ID", type: "text", required: true, format: "ein", map: "company.ein",
    description: "The 9-digit Employer Identification Number assigned by the IRS, in the format XX-XXXXXXX.",
    rules: [{ type: "regex", value: "^\\d{2}-?\\d{7}$", message: "EIN must be 9 digits, for example 12-3456789." }] },
  { path: "employer.business_phone", label: "Business Phone Number", type: "phone", required: true, map: "company.phone" },
  { path: "employer.fax", label: "Fax Number", type: "phone", required: false, map: "company.fax" },
  { path: "employer.contact_person_name", label: "Name of the Contact Person", type: "text", required: true, map: "company.contact.name",
    description: "The person who will receive and respond to Department of Labor and recruitment correspondence for this filing." },
  { path: "employer.contact_person_designation", label: "Contact Person's Designation", type: "text", required: true, map: "company.contact.title" },
  { path: "employer.contact_person_phone", label: "Phone number of the above contact person (with Extension)", type: "phone", required: true, map: "company.contact.phone" },
  { path: "employer.contact_person_phone_extension", label: "Extension (if any)", type: "text", required: false, map: "company.contact.phoneExtension",
    rules: [{ type: "regex", value: "^\\d{1,8}$", message: "Extension must be numbers only." }] },
  { path: "employer.contact_person_email", label: "Email Address", type: "email", required: true, map: "company.contact.email" },
  { path: "employer.website", label: "Company's website", type: "text", required: false, map: "company.website",
    rules: [{ type: "regex", value: "^(https?:\\/\\/)?([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}(\\/\\S*)?$", message: "Enter a valid website address, for example https://www.example.com." }] },
  { path: "employer.additional_phone", label: "Any additional number where we may contact you", type: "phone", required: false, map: "company.additionalPhone" },
  { path: "employer.is_federal_contractor", label: "Are you a federal contractor?", type: "radio", required: true, options: YES_NO, map: "company.isFederalContractor" },
  { path: "employer.is_ada_compliant", label: "Are you ADA Compliant?", type: "radio", required: true, options: YES_NO, map: "company.isAdaCompliant" },
  { path: "employer.union_status", label: "Special characteristics that applies to your company - Union shop or nonunion shop", type: "select", required: true, map: "company.unionStatus",
    options: ["Union Shop", "Nonunion Shop"] },
  { path: "employer.apprentice_registration_number", label: "Apprentice Registration number", type: "text", required: false, map: "company.apprenticeRegistrationNumber" },
  { path: "employer.company_profile", label: "Company profile", type: "rich_text", required: true, map: "company.description",
    description: "A short description of the company: what it does, its size and history, and its main products or services." },
];

// ── Employee Information ────────────────────────────────────────────────
const EMPLOYEE_SECTION = "Employee Information";
const QUALIFICATION_SECTION = "Employee Qualification";
const HISTORY_SECTION = "Employment History";
const DOCUMENTS_SECTION = "Required Documents";

const stateOptions = US_STATES;
const geo = (list) => list.map((value) => (typeof value === "object" ? value : { label: value, value }));

const EMPLOYEE_QUESTIONS = [
  { path: "employee.first_name", label: "First Name", type: "text", required: true, map: "person.firstName" },
  { path: "employee.middle_name", label: "Full Middle Name", type: "text", required: false, map: "person.middleName" },
  { path: "employee.last_name", label: "Last Name", type: "text", required: true, map: "person.lastName" },
  { path: "employee.address", label: "Full Address", type: "text", required: true, map: "contact.address.line1" },
  { path: "employee.city", label: "City", type: "text", required: true, map: "contact.address.city" },
  { path: "employee.state", label: "State Abbreviation", type: "select", required: true, options: stateOptions, map: "contact.address.state" },
  { path: "employee.country", label: "Country", type: "select", required: true, options: geo(COUNTRIES), map: "contact.address.country" },
  { path: "employee.zip_code", label: "Zip code", type: "text", required: true, map: "contact.address.zip",
    rules: [{ type: "maxLength", value: 12, message: "Zip / postal code is too long." }] },
  { path: "employee.phone", label: "Phone no. of current residence", type: "phone", required: true, map: "contact.phone" },
  { path: "employee.citizenship_country", label: "Country of Citizenship", type: "select", required: true, options: geo(COUNTRIES), map: "person.citizenship" },
  { path: "employee.birth_country", label: "Country of Birth", type: "select", required: true, options: geo(COUNTRIES), map: "person.countryOfBirth" },
  { path: "employee.date_of_birth", label: "Date of Birth", type: "date", required: true, map: "person.dob" },
  { path: "employee.current_us_status", label: "Current status in United States (H1, H4, B1, L1, etc.)", type: "select", required: true,
    options: geo(IMMIGRATION_STATUSES), map: "immigration.currentStatus" },
  { path: "employee.alien_registration_number", label: "Alien Registration Number (A#, if available)", type: "text", required: false, map: "person.alienNumber",
    rules: [{ type: "regex", value: "^[Aa]?-?\\d{7,9}$", message: "A-Number is 7 to 9 digits, for example A123456789." }] },
  { path: "employee.i94_number", label: "Latest I-94 Number (put all 11 digits)", type: "text", required: false, map: "immigration.i94.number",
    rules: [{ type: "regex", value: "^\\d{11}$", message: "I-94 number must be exactly 11 digits." }] },
  { path: "employee.highest_education", label: "Highest level of education received", type: "select", required: true, options: geo(EDUCATION_LEVELS), map: "education.0.degree" },
  { path: "employee.major_field", label: "Specify major field(s) of study", type: "text", required: true, map: "education.0.field" },
  { path: "employee.education_completion_year", label: "Year when education was completed", type: "text", required: true, map: "education.0.completionYear",
    rules: [{ type: "regex", value: "^(19|20)\\d{2}$", message: "Enter a 4-digit year, for example 2016." }] },
  { path: "employee.education_institution_name", label: "Name of the Institution", type: "text", required: true, map: "education.0.institution" },
  { path: "employee.education_institution_address", label: "Address of the Institution", type: "text", required: true, map: "education.0.institutionAddress" },
  { path: "employee.education_institution_city", label: "City", type: "text", required: true, map: "education.0.institutionCity" },
  // Only meaningful for a U.S. institution - a foreign institution is never forced to give a U.S. state/ZIP.
  { path: "employee.education_institution_state", label: "State", type: "select", required: true, options: stateOptions, map: "education.0.institutionState", conditionalLogic: when(IS_US) },
  { path: "employee.education_institution_country", label: "Country", type: "select", required: true, options: geo(COUNTRIES), map: "education.0.institutionCountry" },
  { path: "employee.education_institution_zip", label: "Zipcode", type: "text", required: true, map: "education.0.institutionZip", conditionalLogic: when(IS_US),
    rules: [{ type: "regex", value: "^\\d{5}(-\\d{4})?$", message: "Enter a 5-digit ZIP code (or ZIP+4)." }] },
];

const QUALIFICATION_QUESTIONS = [
  { path: "employee.qualifying_experience_with_petitioner", type: "radio", required: true, options: YES_NO, map: "perm.qualifyingExperienceWithPetitioner",
    label: "Did you gain any of the qualifying experience with the employer in a position substantially comparable to the job opportunity requested? For how long have you been employed in this company (who is filing your Labor)?" },
  { path: "employee.qualifying_experience_years", label: "How long have you been employed by this employer? - Years", type: "number", required: true, map: "perm.qualifyingExperienceYears",
    conditionalLogic: when(rule("employee_qualifying_experience_with_petitioner", "Yes")),
    rules: [{ type: "min", value: 0, message: "Years cannot be negative." }, { type: "max", value: 70, message: "Please check the number of years." }] },
  { path: "employee.qualifying_experience_months", label: "How long have you been employed by this employer? - Months", type: "number", required: false, map: "perm.qualifyingExperienceMonths",
    conditionalLogic: when(rule("employee_qualifying_experience_with_petitioner", "Yes")),
    rules: [{ type: "min", value: 0, message: "Months cannot be negative." }, { type: "max", value: 11, message: "Months must be between 0 and 11." }] },
  { path: "employee.employer_paid_education_training", type: "radio", required: true, options: YES_NO, map: "perm.employerPaidEducationTraining",
    label: "Did the employer pay for any of your education or training necessary to satisfy any of the employer's job requirements for this position?" },
  { path: "employee.currently_employed_by_petitioner", type: "radio", required: true, options: YES_NO, map: "perm.currentlyEmployedByPetitioner",
    label: "Are you currently employed by the petitioning employer?" },
];

// ── Employment History (repeating group) ────────────────────────────────
const HISTORY_INSTRUCTIONS = [
  "List all jobs you have held during the past 5 years. Also list any other experience that qualifies you for the job opportunity for which the employer is seeking PERM Certification.",
  "Only provide information about the company that was your direct employer. Client information where you worked as a consultant is not needed.",
];

const HISTORY_COLUMNS = [
  { key: "company_name", label: "Company's Name (company that ran payroll or held H1B)", type: "text", required: true },
  { key: "address", label: "Full Address", type: "text", required: true },
  { key: "city", label: "City", type: "text", required: true },
  { key: "state", label: "State", type: "combo", required: true, options: US_STATES },
  { key: "country", label: "Country", type: "select", required: true, options: geo(COUNTRIES) },
  { key: "zip_code", label: "Zipcode", type: "text", required: true },
  { key: "supervisor_name", label: "Name of Supervisor", type: "text", required: true },
  { key: "supervisor_phone", label: "Phone Number of Supervisor", type: "phone", required: true },
  { key: "business_type", label: "Type of Business", type: "text", required: true },
  { key: "job_title", label: "Job Title", type: "text", required: true },
  { key: "start_date", label: "Start Date", type: "date", required: true },
  { key: "is_current", label: "I currently work here (End Date = Present)", type: "checkbox", required: false },
  { key: "end_date", label: "End Date", type: "date", required: true, hiddenWhen: { field: "is_current", equals: true }, requiredUnless: { field: "is_current", equals: true } },
  { key: "hours_per_week", label: "Number of Hours Worked per Week", type: "number", required: true, min: 0.5, max: 168, step: "0.5" },
  { key: "job_details", label: "Job Details / Duties and Responsibilities", type: "textarea", required: true },
  { key: "skills_tools", label: "Tools/Languages/Skill-sets Used", type: "textarea", required: true },
];

const HISTORY_METADATA = {
  sourcePath: "employee.employment_history",
  instructions: HISTORY_INSTRUCTIONS,
  itemLabel: "Job",
  addLabel: "+ Add Employment",
  confirmRemove: "Remove this employment record? This cannot be undone.",
  summaryFields: ["job_title", "company_name"],
  periodFields: { start: "start_date", end: "end_date", current: "is_current" },
  fields: HISTORY_COLUMNS,
  repeatableFields: HISTORY_COLUMNS, // the admin answers panel reads this key
  rowRules: [{ type: "dateOrder", start: "start_date", end: "end_date", current: "is_current", message: "Start date cannot be after End date." }],
  order: "mostRecentFirst",
};

// ── Supporting documents (employee side) ────────────────────────────────
const VALIDITY_NOTE = "Upload clear, complete, valid copies. Expired, cropped or unreadable documents will delay your labor certification.";
const PERM_DOCUMENTS = [
  { name: "Latest Resume", documentType: "perm_resume", description: VALIDITY_NOTE, required: true, category: "employment" },
  { name: "Degree documents", documentType: "perm_degree_documents", description: VALIDITY_NOTE, required: true, category: "education" },
  { name: "Mark sheets / transcripts", documentType: "perm_transcripts", description: VALIDITY_NOTE, required: true, category: "education" },
  { name: "Experience letters", documentType: "perm_experience_letters", description: `${VALIDITY_NOTE} Provide a letter from each employer listed in your employment history.`, required: true, category: "employment" },
];
// Required only when the education was NOT completed in the United States.
const DEGREE_EVALUATION = {
  name: "Degree evaluation", documentType: "perm_degree_evaluation", category: "education", required: true,
  description: `Required because your education was completed outside the United States. ${VALIDITY_NOTE}`,
};

// ── builders ────────────────────────────────────────────────────────────
function questionFromSpec(spec, section, order, visibility) {
  const key = spec.path.replace(/\./g, "_");
  return buildQuestion(key, spec.label, spec.type, section, order, {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    metadata: { sourcePath: spec.path, ...(spec.format ? { format: spec.format } : {}) },
    ...(spec.map ? { mapping: { canonicalPath: spec.map } } : {}),
    ...(spec.rules ? { validationRules: spec.rules } : {}),
    ...(spec.conditionalLogic ? { conditionalLogic: spec.conditionalLogic } : {}),
    visibility,
  });
}

function sectionQuestions(specs, section, visibility, startOrder = 0) {
  return specs.map((spec, index) => questionFromSpec(spec, section, startOrder + index + 1, visibility));
}

function buildPermEmployerChecklist() {
  const visibility = { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] };
  return {
    key: "perm_employer_information",
    title: "PERM - Employer Information Checklist",
    visaType: "PERM",
    visaTypes: PERM_VISA_TYPES,
    checklistRole: "employer",
    isDefault: true,
    description: "Information about the company sponsoring the PERM labor certification.",
    sections: [EMPLOYER_SECTION],
    questions: sectionQuestions(EMPLOYER_QUESTIONS, EMPLOYER_SECTION, visibility),
  };
}

function buildPermEmployeeChecklist() {
  const visibility = { roles: ["employee", ...STAFF_ROLES], portals: ["employee", "admin"] };
  const history = buildQuestion("employee_employment_history", "Employment History", "repeating_group", HISTORY_SECTION, 1, {
    required: true,
    description: HISTORY_INSTRUCTIONS.join("\n\n"),
    metadata: HISTORY_METADATA,
    mapping: { canonicalPath: "perm.employmentHistory" },
    visibility,
    repeatable: true,
    repeatableConfig: { min: 1, labelTemplate: "Job {n}", allowClientAdd: true },
  });
  const documents = PERM_DOCUMENTS.map((doc, index) => buildQuestion(doc.documentType, doc.name, "file", DOCUMENTS_SECTION, index + 1, {
    description: doc.description,
    required: doc.required,
    evidenceCategory: doc.category,
    metadata: { documentType: doc.documentType, category: doc.category },
    visibility,
  }));
  documents.push(buildQuestion(DEGREE_EVALUATION.documentType, DEGREE_EVALUATION.name, "file", DOCUMENTS_SECTION, documents.length + 1, {
    description: DEGREE_EVALUATION.description,
    required: DEGREE_EVALUATION.required,
    evidenceCategory: DEGREE_EVALUATION.category,
    metadata: { documentType: DEGREE_EVALUATION.documentType, category: DEGREE_EVALUATION.category, questionnaireOnly: true },
    visibility,
    // Only once the institution's country is known AND it is not the U.S.
    conditionalLogic: when({ questionKey: NOT_US.questionKey, operator: "not_empty" }, NOT_US),
  }));
  return {
    key: "perm_employee_information",
    title: "PERM - Employee Information Checklist",
    visaType: "PERM",
    visaTypes: PERM_VISA_TYPES,
    checklistRole: "employee",
    isDefault: true,
    description: "Information about the employee for whom the PERM labor certification is being filed.",
    sections: [EMPLOYEE_SECTION, QUALIFICATION_SECTION, HISTORY_SECTION, DOCUMENTS_SECTION],
    questions: [
      ...sectionQuestions(EMPLOYEE_QUESTIONS, EMPLOYEE_SECTION, visibility),
      ...sectionQuestions(QUALIFICATION_QUESTIONS, QUALIFICATION_SECTION, visibility),
      history,
      ...documents,
    ],
  };
}

module.exports = {
  buildPermEmployerChecklist, buildPermEmployeeChecklist,
  PERM_VISA_TYPES, HISTORY_COLUMNS, HISTORY_METADATA, EMPLOYER_QUESTIONS, EMPLOYEE_QUESTIONS, QUALIFICATION_QUESTIONS, PERM_DOCUMENTS, DEGREE_EVALUATION,
};
