// E-3 Australian Specialty Occupation — employer/employee (two-party)
// checklist architecture already established by h1b.js/l1a.js (NOT e2.js's
// single-consolidated-checklist shape: E-3, like H-1B, has a genuine
// employer-files-this vs. beneficiary-files-that split).
//
// Field paths deliberately reuse H-1B's own "employer.company.*"/
// "employer.signingPerson.*"/"employer.position.*"/"employer.workLocations"/
// "employee.personal.*"/"employee.immigrationStatus.*" convention wherever
// this checklist's content is the same underlying data (company info,
// signing person, job title/salary, work locations, beneficiary personal/
// passport/immigration-status fields) — this is what makes
// employmentChecklists.js's existing SECTION_PREFIX_MAP, EMPLOYEE_CANONICAL_PATHS,
// and REPEATABLE_FIELDS entries apply for free, with zero new registration
// for those fields. Only genuinely E-3-specific fields (LCA/DOL verification
// wording differences, E-3-specific eligibility history) get new paths.
//
// This file only exports the static field/document catalog, mirroring
// h1b.js's/e2.js's shape; Backend/src/modules/questionnaires/employmentChecklists.js
// converts it into real Questionnaire/Question template definitions.

const key = "e3";

function matches(value) {
  return /e[\s-]?3\b/i.test(String(value || "").trim());
}

// Verbatim from the authoritative source's "Please send the following
// documents:" list (Part 3) plus the FEIN proof document (Part 1,
// conditional — built directly in employmentChecklists.js's
// buildE3EmployerChecklist(), same pattern as H-1B's own feinProof, not
// listed here since it needs the DOL-conditional wiring, not a static list).
// FEIN/business-license/incorporation/letterhead document types are the
// exact same real-world documents H-1B's checklist already requests —
// reused verbatim rather than creating duplicate E-3-prefixed types.
const employerDocuments = [
  {
    name: "Copy of the Business license",
    documentType: "business_license",
    description: "Upload from the employer document repository.",
    required: true,
    category: "business",
    targetRole: "employer",
    status: "requested",
  },
  {
    name: "Copy of Articles of incorporation",
    documentType: "articles_of_incorporation",
    description: "Upload from the employer document repository.",
    required: true,
    category: "business",
    targetRole: "employer",
    status: "requested",
  },
  {
    name: "Company letter Head in word document",
    documentType: "company_letterhead",
    description: "Upload from the employer document repository.",
    required: true,
    category: "business",
    targetRole: "employer",
    status: "requested",
  },
];

// Verbatim from the authoritative source's "Documents Required from
// Beneficiary/Employee:" list — 15 items. Reuses H-1B's exact document types
// for every document that is the same real-world evidence (rule: never
// create a duplicate document type for the same evidence). Only genuinely
// new: awards/achievements/certifications (no H-1B equivalent) and the
// Australian-citizenship-or-birth-certificate combined proof (E-3's own
// nationality-eligibility evidence, distinct from a generic birth
// certificate used elsewhere for e.g. family-based relationship evidence).
const employeeDocuments = [
  { name: "All Academic Certificates with transcripts", documentType: "academic_certificates", description: "Education credential documents with transcripts.", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of educational credential evaluation report", documentType: "credential_evaluation_report", description: "Credential evaluation report for education completed outside the United States.", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of the training/diploma certificates, if any", documentType: "training_diploma_certificates", description: "Training, diploma, or certification documents.", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of any awards, appraisals, achievements or certifications, if any", documentType: "awards_achievements_certifications", description: "Awards, appraisals, achievements, or certifications, if any.", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of the recent updated resume", documentType: "updated_resume", description: "Current resume for the E-3 petition (soft copy).", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Copy of the previous work experience letters", documentType: "previous_work_experience_letters", description: "Experience letters from previous employers.", required: false, category: "employment", targetRole: "employee", status: "requested" },
  { name: "All I-797 (prior notice/receipt of approvals), if any", documentType: "previous_i797_notices", description: "Prior USCIS approval or receipt notices.", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of I-94 (Arrival-Departure record)", documentType: "employee_i94_copy", description: "Copy of the Arrival-Departure record.", required: true, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of the passport", documentType: "passport", description: "Biographic passport pages.", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Australian Citizenship Certificate or Birth Certificate", documentType: "australian_citizenship_or_birth_certificate", description: "Australian Citizenship Certificate, or a Birth Certificate, evidencing Australian nationality.", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of SSN, must be signed by bearer (if any)", documentType: "employee_ssn_copy", description: "Social Security card copy, signed by the bearer.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of US Driver's license or State Identification card (if any)", documentType: "employee_drivers_license_or_state_id", description: "US Driver's license or State Identification card.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of recent W2", documentType: "w2", description: "Most recent W-2.", required: false, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Last 3 months pay stubs", documentType: "last_3_months_pay_slips", description: "Recent pay slips from the last three months.", required: false, category: "employment", targetRole: "employee", status: "requested" },
];

// I-20/F-1 approval notices ("if you were in the USA on Student visa") is
// conditional (not a static list entry, same treatment as H-1B's own
// f1_opt_stem_documents) — built in buildE3EmployeeChecklist() so it can
// carry the currentVisaStatus condition.

function addressFields(prefix, label, required = false) {
  const section = prefix.startsWith("employer") ? "employer" : "employee";
  return [
    { path: `${prefix}.street`, label: `${label} Street`, section, required },
    { path: `${prefix}.county`, label: `${label} County`, section, required },
    { path: `${prefix}.city`, label: `${label} City`, section, required },
    { path: `${prefix}.state`, label: `${label} State`, section, required },
    { path: `${prefix}.zipCode`, label: `${label} Zip Code`, section, required },
  ];
}

// Flat catalog of every field this checklist understands, for
// employmentChecklists.js's fieldQuestionsFromCatalog() to convert into real
// Question documents (mirrors h1b.js's/e2.js's own fieldCatalog() shape).
function fieldCatalog() {
  const entries = [
    // =========================================================================
    // E3_EMPLOYER (checklistRole: "employer") — PART 1: DOL/LCA verification
    // =========================================================================
    { path: "employer.lca.firstLcaFiling", label: "Are you filing LCA for the first time since the company has been established?", section: "employer", type: "radio" },
    {
      path: "employer.lca.dolVerified",
      label: "Company verification with DOL has been done or not?",
      section: "employer",
      type: "radio",
      condition: { field: "employer.lca.firstLcaFiling", operator: "equals", value: "yes" },
    },

    // PART 2 — Employer Information
    { path: "employer.company.fullName", label: "Full name of the Company", section: "employer", required: true },
    { path: "employer.company.fein", label: "FEIN no of the Company", section: "employer", required: true },
    ...addressFields("employer.company.address", "Employer Address", true),
    { path: "employer.company.daytimePhone", label: "Employer's day time Phone Number", section: "employer", type: "phone", required: true },
    { path: "employer.company.faxNumber", label: "Employer's Fax Number", section: "employer", type: "phone", required: false },
    { path: "employer.company.businessType", label: "Type of Business", section: "employer", required: true },
    { path: "employer.company.yearEstablished", label: "Year established", section: "employer", type: "number", required: true },
    { path: "employer.company.naicsCode", label: "NAICS Code", section: "employer", required: true },
    { path: "employer.signingPerson.firstName", label: "First name of signing person", section: "employer", required: true },
    { path: "employer.signingPerson.lastName", label: "Last name of signing person", section: "employer", required: true },
    { path: "employer.signingPerson.title", label: "Designation/Title of the signing person", section: "employer", required: true },
    { path: "employer.signingPerson.email", label: "Email of the signing person", section: "employer", type: "email", required: true },
    { path: "employer.signingPerson.mobilePhone", label: "Mobile Phone Number of the signing person", section: "employer", type: "phone", required: true },
    { path: "employer.position.jobTitle", label: "Employee's Job Title as per offer letter", section: "employer", required: true },
    { path: "employer.position.offeredSalary", label: "Employee's salary as per offer letter", section: "employer", type: "currency", required: true },
    { path: "employer.endClient.name", label: "End Client name (Legal Business Name of secondary entity must contain at least 5 characters)", section: "employer", required: true },
    {
      path: "employer.workLocations",
      label: "Employee's Job Location — mention all the addresses in which the beneficiary is going to work along with the company/end client name",
      section: "employer",
      repeatable: true,
    },
    { path: "employer.position.employmentStartDate", label: "Start date of employment for the employee", section: "employer", type: "date", required: true },
    { path: "employer.jobDescription.duties", label: "Job description & Responsibilities", section: "employer", type: "textarea", required: true },
    { path: "employer.workforce.totalUsEmployees", label: "Total Number of Employees in US company on your payroll", section: "employer", type: "number", required: true },

    // PART 3
    { path: "employer.company.website", label: "Employer's company website", section: "employer", type: "url", required: false },
    { path: "employer.company.netIncome", label: "Net Income of the company", section: "employer", type: "currency", required: true },
    { path: "employer.company.grossAnnualIncome", label: "Gross annual Income of the company", section: "employer", type: "currency", required: true },

    // =========================================================================
    // E3_EMPLOYEE (checklistRole: "employee") — Beneficiary questionnaire
    // =========================================================================
    { path: "employee.personal.lastName", label: "Last Name", section: "employee", required: true },
    { path: "employee.personal.firstName", label: "First Name", section: "employee", required: true },
    { path: "employee.personal.middleName", label: "Middle Name", section: "employee", required: false },
    {
      path: "employee.personal.otherNamesUsed",
      label: "All other names used (include maiden name and names from all previous marriages, if any)",
      section: "employee",
      required: false,
    },
    { path: "employee.personal.dateOfBirth", label: "Date of birth", section: "employee", required: true },
    { path: "employee.personal.countryOfBirth", label: "Country of birth", section: "employee", required: true },
    { path: "employee.personal.provinceStateOfBirth", label: "Province/State of birth", section: "employee", required: false },
    { path: "employee.personal.countryOfCitizenship", label: "Country of citizenship", section: "employee", required: true },
    { path: "employee.personal.socialSecurityNumber", label: "Social Security Number", section: "employee", required: false },
    { path: "employee.personal.alienRegistrationNumber", label: "A # (written on work authorization card/OPT card), if available", section: "employee", required: false },
    { path: "employee.personal.latestPriorPetitionNumber", label: "Latest prior petition number", section: "employee", required: false },
    { path: "employee.personal.sevisNumber", label: "SEVIS Number (Student and Exchange Visitor Information System)", section: "employee", required: false },
    { path: "employee.personal.currentUsAddress.street", label: "Current U.S. address — Street", section: "employee", required: true },
    { path: "employee.personal.currentUsAddress.apartment", label: "Current U.S. address — Apt#", section: "employee", required: false },
    { path: "employee.personal.currentUsAddress.city", label: "Current U.S. address — City", section: "employee", required: true },
    { path: "employee.personal.currentUsAddress.state", label: "Current U.S. address — State", section: "employee", required: true },
    { path: "employee.personal.currentUsAddress.zipCode", label: "Current U.S. address — Zip Code", section: "employee", required: true },

    // "If you are inside the United States, complete the following:" —
    // conditional section, same insideUnitedStates driver H-1B already uses.
    { path: "employee.immigrationStatus.insideUnitedStates", label: "Are you currently inside the United States?", section: "employee", type: "radio" },
    {
      path: "employee.immigrationStatus.dateOfLastArrival",
      label: "Date of last arrival",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" },
    },
    {
      path: "employee.immigrationStatus.i94Number",
      label: "I-94 #",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" },
    },
    {
      path: "employee.immigrationStatus.currentVisaStatus",
      label: "Current visa status",
      section: "employee",
      type: "select",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" },
    },
    {
      path: "employee.immigrationStatus.currentStatusExpirationDate",
      label: "Date status expires",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" },
    },

    // Passport Details
    { path: "employee.personal.passportNumber", label: "Passport number", section: "employee", required: true },
    { path: "employee.personal.passportIssueDate", label: "Date passport issued", section: "employee", required: true },
    { path: "employee.personal.passportExpirationDate", label: "Date passport expires", section: "employee", required: true },

    // Other Information / eligibility questions — Q1-Q7 verbatim.
    { path: "employee.immigrationHistory.hasValidPassport", label: "Do you or any other person in this petition have a valid passport?", section: "employee", type: "radio" },
    { path: "employee.immigrationStatus.replaceI94", label: "Do you also intend to replace your I-94?", section: "employee", type: "radio" },
    { path: "employee.immigrationHistory.hasDependents", label: "Are there any dependents (spouse/children) for whom visa has to be filed?", section: "employee", type: "radio" },
    {
      path: "employee.immigrationHistory.numberOfDependents",
      label: "How many dependents?",
      section: "employee",
      type: "number",
      condition: { field: "employee.immigrationHistory.hasDependents", operator: "equals", value: "yes" },
    },
    { path: "employee.immigrationHistory.inRemovalProceedings", label: "Is any person including you in removal proceedings?", section: "employee", type: "radio" },
    {
      path: "employee.immigrationHistory.removalProceedingsExplanation",
      label: "Please explain",
      section: "employee",
      type: "textarea",
      condition: { field: "employee.immigrationHistory.inRemovalProceedings", operator: "equals", value: "yes" },
    },
    { path: "employee.immigrationHistory.employerFiledGreenCard", label: "Did this company ever file an immigrant petition (Green Card) for you in the past?", section: "employee", type: "radio" },
    { path: "employee.immigrationHistory.heldE3LastSevenYears", label: "Have you ever been given an E-3 visa in the past 7 years?", section: "employee", type: "radio" },
    { path: "employee.immigrationHistory.deniedE3LastSevenYears", label: "Have you ever been denied an E-3 visa in the past 7 years?", section: "employee", type: "radio" },
    {
      path: "employee.immigrationHistory.e3DenialExplanation",
      label: "Please explain",
      section: "employee",
      type: "textarea",
      condition: { field: "employee.immigrationHistory.deniedE3LastSevenYears", operator: "equals", value: "yes" },
    },
  ];
  // Required by default unless the field's own wording says "if any"/"if
  // available" (those entries set required:false above) or it only applies
  // conditionally on a prior answer (forced not-required unconditionally —
  // mirrors h1b.js's/e2.js's fieldCatalog() convention exactly).
  return entries.map((entry) => ({
    ...entry,
    required: entry.condition ? false : entry.required !== false,
  }));
}

module.exports = {
  key,
  matches,
  employerDocuments,
  employeeDocuments,
  fieldCatalog,
};
