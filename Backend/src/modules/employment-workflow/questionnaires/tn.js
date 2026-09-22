// TN (NAFTA/USMCA professional) — content-only module, mirrors i140.js's
// minimal shape exactly (not the fuller h1b.js pattern, which additionally
// implements normalizeEmployer/normalizeEmployee for the flat registry.js
// checklist system — not registered there for the same reason i140.js
// isn't: the real checklist experience for TN, like I-140, lives entirely
// in the Questionnaire system via employmentChecklists.js's conversion).
//
// Source: the supplied "Employer Checklist for TN Visa" and "Employee
// Checklist for TN Visa" documents. Every field label/document name below
// is verbatim from that source.

const key = "tn";

const petitionerDocuments = [
  { name: "Copy of Article of Incorporation", documentType: "tn_petitioner_articles_of_incorporation", required: true, category: "business", targetRole: "employer", status: "requested" },
  { name: "Copy of Business License", documentType: "tn_petitioner_business_license", required: true, category: "business", targetRole: "employer", status: "requested" },
  { name: "Copy of Company Brochure", documentType: "tn_petitioner_company_brochure", required: false, category: "business", targetRole: "employer", status: "requested" },
  { name: "Company's Previous Year's Tax Returns", documentType: "tn_petitioner_previous_year_tax_returns", required: true, category: "financial", targetRole: "employer", status: "requested" },
  { name: "Offer Letter", documentType: "tn_petitioner_offer_letter", required: true, category: "employment", targetRole: "employer", status: "requested" },
  { name: "Company Letterhead in Word Format", documentType: "tn_petitioner_letterhead", description: "As an editable Word/.docx file.", required: true, category: "business", targetRole: "employer", status: "requested" },
];

// Verbatim from the "Documents Required from Beneficiary/Employee:" list —
// 12 items. All conditional/optional documents kept explicitly optional
// per the source's own "if applicable"/"if any" qualifiers (integration
// prompt §7).
const beneficiaryDocuments = [
  { name: "TN Visa Letter", documentType: "tn_beneficiary_visa_letter", required: true, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Academic Certificates with Transcripts", documentType: "tn_beneficiary_academic_certificates", required: true, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of Educational Credential Evaluation Report", documentType: "tn_beneficiary_credential_evaluation_report", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of the Training/Diploma Certificates, if applicable", documentType: "tn_beneficiary_training_diploma_certificates", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of Any Awards, Appraisals, Achievements or Certifications, if applicable", documentType: "tn_beneficiary_awards_certifications", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of the Recent Updated Resume", documentType: "tn_beneficiary_updated_resume", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Copy of the Previous Work Experience Letters", documentType: "tn_beneficiary_previous_work_experience_letters", required: false, category: "employment", targetRole: "employee", status: "requested" },
  { name: "All I-797 (Prior Notice/Receipt of Approvals), if any", documentType: "tn_beneficiary_previous_i797_notices", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of I-94 (Arrival-Departure Record), if currently inside the US", documentType: "tn_beneficiary_i94_copy", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of the Passport", documentType: "tn_beneficiary_passport", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Proof of Canadian/Mexican Citizenship", documentType: "tn_beneficiary_proof_of_citizenship", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of SSN, Must Be Signed by Bearer, if any", documentType: "tn_beneficiary_ssn_copy", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of US Driver's License or State Identification Card, if any", documentType: "tn_beneficiary_drivers_license_or_state_id", required: false, category: "identity", targetRole: "employee", status: "requested" },
];

function fieldCatalog() {
  return [
    // ── Company information ──────────────────────────────────────────────
    { path: "employer.company.legalName", label: "Company Name", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.company.address", label: "Company Address (complete address)", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.company.fein", label: "Federal Employer Identification Number (FEIN)", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.company.businessType", label: "Type of Business", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.company.yearEstablished", label: "Year Established", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.company.totalUsEmployees", label: "Total No. of Employees in the USA", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.company.grossAnnualIncome", label: "Gross Annual Income of the Company", section: "employer", sectionTitle: "Information About the Company", required: true, type: "currency" },
    { path: "employer.company.netAnnualIncome", label: "Net Annual Income of the Company", section: "employer", sectionTitle: "Information About the Company", required: true, type: "currency" },
    { path: "employer.company.website", label: "Website Link", section: "employer", sectionTitle: "Information About the Company", required: false },
    { path: "employer.signingPerson.firstName", label: "First Name of Signing Person", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.signingPerson.lastName", label: "Last Name of Signing Person", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.signingPerson.title", label: "Designation/Title of the Signing Person", section: "employer", sectionTitle: "Information About the Company", required: true },
    { path: "employer.signingPerson.email", label: "Email of the Signing Person", section: "employer", sectionTitle: "Information About the Company", required: true, type: "email" },
    { path: "employer.signingPerson.mobilePhone", label: "Mobile Phone Number of the Signing Person", section: "employer", sectionTitle: "Information About the Company", required: true },

    // ── Proposed employment ───────────────────────────────────────────────
    { path: "employer.position.jobTitle", label: "Job Title as per Offer Letter", section: "employer", sectionTitle: "Information About Proposed Employment", required: true },
    { path: "employer.position.salary", label: "Salary as per Offer Letter", section: "employer", sectionTitle: "Information About Proposed Employment", required: true, type: "currency" },
    {
      path: "employer.position.salaryFrequency",
      label: "Offered Salary is Per",
      section: "employer",
      sectionTitle: "Information About Proposed Employment",
      required: true,
      type: "select",
      options: ["Hour", "Week", "Bi-weekly", "Month", "Year"],
    },
    { path: "employer.endClient.name", label: "End Client Name, if applicable", section: "employer", sectionTitle: "Information About Proposed Employment", required: false, description: "Legal Business Name of secondary entity must contain at least 5 characters." },
    {
      path: "employer.workLocations",
      label: "Job Locations",
      section: "employer",
      sectionTitle: "Information About Proposed Employment",
      required: true,
      repeatable: true,
      description: "Mention all the addresses in which the beneficiary is going to work along with the company/end client name.",
    },
    { path: "employer.jobDescription.duties", label: "Detailed Job Description and Responsibilities", section: "employer", sectionTitle: "Information About Proposed Employment", required: true, type: "textarea", description: "Should be the same as on the offer letter." },

    // ── Employee — Information About You ─────────────────────────────────
    { path: "employee.personal.lastName", label: "Last Name", section: "employee", sectionTitle: "Information About You", required: true },
    { path: "employee.personal.firstName", label: "First Name", section: "employee", sectionTitle: "Information About You", required: true },
    { path: "employee.personal.middleName", label: "Middle Name", section: "employee", sectionTitle: "Information About You", required: false },
    { path: "employee.personal.otherNamesUsed", label: "All Other Names Used (include maiden name and names from all previous marriages, if any)", section: "employee", sectionTitle: "Information About You", required: false },
    { path: "employee.personal.dateOfBirth", label: "Date of Birth", section: "employee", sectionTitle: "Information About You", required: true, type: "date" },
    { path: "employee.personal.countryOfBirth", label: "Country of Birth", section: "employee", sectionTitle: "Information About You", required: true },
    { path: "employee.personal.provinceStateOfBirth", label: "Province/State of Birth", section: "employee", sectionTitle: "Information About You", required: false },
    { path: "employee.personal.countryOfCitizenship", label: "Country of Citizenship", section: "employee", sectionTitle: "Information About You", required: true },
    { path: "employee.personal.ssn", label: "Social Security Number", section: "employee", sectionTitle: "Information About You", required: false },
    { path: "employee.personal.aNumber", label: "A # (written on work authorization card/OPT card), if available", section: "employee", sectionTitle: "Information About You", required: false },
    { path: "employee.personal.latestPriorPetitionNumber", label: "Latest Prior Petition Number", section: "employee", sectionTitle: "Information About You", required: false },
    { path: "employee.personal.sevisNumber", label: "SEVIS Number (Student and Exchange Visitor Information System)", section: "employee", sectionTitle: "Information About You", required: false },
    { path: "employee.personal.currentUsAddress", label: "Current U.S. Address (street, apt#, city, state and zip code)", section: "employee", sectionTitle: "Information About You", required: true },

    // ── Conditional: currently inside the United States ──────────────────
    { path: "employee.immigrationStatus.insideUnitedStates", label: "Are you currently inside the United States?", section: "employee", sectionTitle: "If You Are Inside the United States", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationStatus.dateOfLastArrival", label: "Date of Last Arrival", section: "employee", sectionTitle: "If You Are Inside the United States", type: "date", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "Yes" } },
    { path: "employee.immigrationStatus.i94Number", label: "I-94 #", section: "employee", sectionTitle: "If You Are Inside the United States", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "Yes" } },
    { path: "employee.immigrationStatus.currentVisaStatus", label: "Current Visa Status", section: "employee", sectionTitle: "If You Are Inside the United States", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "Yes" } },
    { path: "employee.immigrationStatus.statusExpirationDate", label: "Date Status Expires", section: "employee", sectionTitle: "If You Are Inside the United States", type: "date", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "Yes" } },

    // ── Conditional: applying from outside the United States ─────────────
    { path: "employee.immigrationStatus.applyingFromOutsideUs", label: "Are you applying from Outside the United States?", section: "employee", sectionTitle: "If Applying from Outside the USA", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationStatus.consulateCity", label: "U.S. Consulate to Be Visited — City", section: "employee", sectionTitle: "If Applying from Outside the USA", condition: { field: "employee.immigrationStatus.applyingFromOutsideUs", operator: "equals", value: "Yes" } },
    { path: "employee.immigrationStatus.consulateCountry", label: "U.S. Consulate to Be Visited — Country", section: "employee", sectionTitle: "If Applying from Outside the USA", condition: { field: "employee.immigrationStatus.applyingFromOutsideUs", operator: "equals", value: "Yes" } },
    { path: "employee.immigrationStatus.foreignAddress", label: "Your Foreign Address (Street, Apt #, City, State, Country and Zipcode)", section: "employee", sectionTitle: "If Applying from Outside the USA", condition: { field: "employee.immigrationStatus.applyingFromOutsideUs", operator: "equals", value: "Yes" } },

    // ── Passport information ──────────────────────────────────────────────
    { path: "employee.passport.number", label: "Passport Number", section: "employee", sectionTitle: "Passport Information", required: true },
    { path: "employee.passport.issueDate", label: "Passport Issue Date", section: "employee", sectionTitle: "Passport Information", required: true, type: "date" },
    { path: "employee.passport.expirationDate", label: "Passport Expiration Date", section: "employee", sectionTitle: "Passport Information", required: true, type: "date" },

    // ── Additional TN eligibility/history questions (§6) ──────────────────
    { path: "employee.immigrationHistory.hasValidPassport", label: "Does the applicant or any other person in this petition have a valid passport?", section: "employee", sectionTitle: "Additional Information", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationHistory.intendsToReplaceI94", label: "Does the applicant intend to replace their I-94?", section: "employee", sectionTitle: "Additional Information", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationHistory.hasDependents", label: "Are there dependents (spouse/children) for whom a visa/status application is required?", section: "employee", sectionTitle: "Additional Information", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationHistory.numberOfDependents", label: "Number of Dependents", section: "employee", sectionTitle: "Additional Information", type: "number", condition: { field: "employee.immigrationHistory.hasDependents", operator: "equals", value: "Yes" } },
    { path: "employee.immigrationHistory.inRemovalProceedings", label: "Is any person included in the matter in removal proceedings?", section: "employee", sectionTitle: "Additional Information", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationHistory.employerFiledImmigrantPetition", label: "Has this company previously filed an immigrant petition/Green Card petition for the employee?", section: "employee", sectionTitle: "Additional Information", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationHistory.hadTnLastSevenYears", label: "Has the employee received a TN visa during the previous 7 years?", section: "employee", sectionTitle: "Additional Information", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationHistory.previousTnDenied", label: "Has the employee been denied a TN visa during the previous 7 years?", section: "employee", sectionTitle: "Additional Information", required: true, type: "radio", options: ["Yes", "No"] },
    { path: "employee.immigrationHistory.previousTnDenialExplanation", label: "Please explain", section: "employee", sectionTitle: "Additional Information", type: "textarea", condition: { field: "employee.immigrationHistory.previousTnDenied", operator: "equals", value: "Yes" } },
  ];
}

const REPEATABLE_FIELDS = {
  "employer.workLocations": [
    { key: "companyOrEndClientName", label: "Company/End Client Name", type: "text" },
    { key: "address", label: "Complete Address", type: "text" },
  ],
};

module.exports = { key, petitionerDocuments, beneficiaryDocuments, fieldCatalog, REPEATABLE_FIELDS };
