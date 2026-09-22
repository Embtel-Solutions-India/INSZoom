// I-140 (Immigrant Petition for Alien Worker) — shared petitioner +
// beneficiary checklist content, verbatim from the business's "Petitioner
// Checklist for I-140" and "Beneficiary Checklist for I-140" source
// documents. Applies to EB-2 and EB-3 (both file the same Form I-140 as
// their independent petition, regardless of subtype) — ONE definition,
// reused by both via employmentChecklists.js's `visaTypes: ["EB-2","EB-3"]`
// (the same "one questionnaire, several visaTypes" convention p.js's own
// checklist already uses for P-1A/P-1B/P-3), never duplicated per visa
// type. Deliberately excludes EB-2 NIW/EB-2 PERM/EB-3 Skilled Worker/
// Professional/Other Worker's own already-existing, already-correct
// mappings - this is only for the bare "EB-2"/"EB-3" case type.
//
// Unlike h1b.js/l1a.js/eb1b.js (full employment-workflow visa modules with
// matches()/normalizeEmployer()/normalizeEmployee(), consumed by both
// registry.js's flat-checklist system AND employmentChecklists.js), this
// file is a content source for employmentChecklists.js only - mirrors
// family-workflow's familyBasedImmigrantPetition.js in that respect. The
// flat Case.checklistItems system (registry.js/visaChecklists.js) is a
// separate, secondary concern already empty for bare EB-2/EB-3 before this
// change and left untouched - out of this task's scope (the business asked
// for the two named checklists, which live in the Questionnaire system,
// same as EB-1B's own real checklist experience).
const key = "i140";

const petitionerDocuments = [
  { name: "Petitioner's Tax Returns", documentType: "i140_petitioner_tax_returns", required: true, category: "financial", targetRole: "employer", status: "requested" },
  { name: "Incorporation Papers", documentType: "i140_petitioner_incorporation_papers", required: true, category: "business", targetRole: "employer", status: "requested" },
  { name: "Business License", documentType: "i140_petitioner_business_license", required: true, category: "business", targetRole: "employer", status: "requested" },
  { name: "Original Labor Certification", documentType: "i140_petitioner_original_labor_certification", required: true, category: "immigration", targetRole: "employer", status: "requested" },
  { name: "Soft copy of company letterhead", documentType: "i140_petitioner_letterhead", description: "As an editable Word/.docx file.", required: true, category: "business", targetRole: "employer", status: "requested" },
  { name: "Offer Letter", documentType: "i140_petitioner_offer_letter", required: true, category: "employment", targetRole: "employer", status: "requested" },
  { name: "Employment Verification Letter", documentType: "i140_petitioner_employment_verification_letter", required: true, category: "employment", targetRole: "employer", status: "requested" },
];

const beneficiaryDocuments = [
  { name: "Degree evaluation", documentType: "i140_beneficiary_degree_evaluation", required: true, category: "education", targetRole: "employee", status: "requested" },
  { name: "Degrees and transcripts", documentType: "i140_beneficiary_degrees_and_transcripts", required: true, category: "education", targetRole: "employee", status: "requested" },
  { name: "Awards / certifications", documentType: "i140_beneficiary_awards_certifications", required: false, category: "evidence", targetRole: "employee", status: "requested" },
  { name: "Current resume (covering the last six years)", documentType: "i140_beneficiary_resume_six_years", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Offer letter", documentType: "i140_beneficiary_offer_letter", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Previous approval notices", documentType: "i140_beneficiary_previous_approval_notices", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Passport pages", documentType: "i140_beneficiary_passport_pages", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "I-94", documentType: "i140_beneficiary_i94", required: true, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Social Security Number", documentType: "i140_beneficiary_ssn", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Driver's license / state ID", documentType: "i140_beneficiary_drivers_license_or_state_id", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Experience letters", documentType: "i140_beneficiary_experience_letters", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Recent pay stubs", documentType: "i140_beneficiary_pay_stubs", required: false, category: "financial", targetRole: "employee", status: "requested" },
  { name: "W-2", documentType: "i140_beneficiary_w2", required: false, category: "financial", targetRole: "employee", status: "requested" },
];

// Spouse/children documents - only relevant when the beneficiary includes
// dependents; each dependent's own supporting documents, not the
// beneficiary's own.
const dependentDocuments = [
  { name: "Dependent's I-94 / passport", documentType: "i140_dependent_i94_or_passport", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Dependent's recent approval notice", documentType: "i140_dependent_approval_notice", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Relationship certificate", documentType: "i140_dependent_relationship_certificate", description: "Marriage certificate (spouse) or birth certificate (child).", required: false, category: "immigration", targetRole: "employee", status: "requested" },
];

function fieldCatalog() {
  const entries = [
    // ── Petitioner / company information ──
    { path: "employer.company.legalName", label: "Company Name", section: "employer" },
    { path: "employer.company.currentAddress", label: "Current Address", section: "employer" },
    { path: "employer.company.ein", label: "IRS Employer Identification Number (EIN)", section: "employer" },
    { path: "employer.company.petitionerSsn", label: "U.S. SSN, if any", section: "employer", required: false },
    { path: "employer.company.uscisOnlineAccountNumber", label: "USCIS Online Account Number", section: "employer", required: false },
    { path: "employer.company.contactEmail", label: "Contact Person Email", section: "employer", type: "email" },
    { path: "employer.company.taxId", label: "Tax ID", section: "employer" },
    { path: "employer.company.businessType", label: "Type of Business", section: "employer" },
    { path: "employer.company.dateEstablished", label: "Date Established", section: "employer", type: "date" },
    { path: "employer.company.employeeCount", label: "Current Number of Employees", section: "employer", type: "number" },
    { path: "employer.company.grossAnnualIncome", label: "Gross Annual Income", section: "employer", type: "currency" },
    { path: "employer.company.netAnnualIncome", label: "Net Annual Income", section: "employer", type: "currency" },
    { path: "employer.company.naicsCode", label: "NAICS Code", section: "employer" },

    // ── Labor certification ──
    { path: "employer.laborCertification.dolCaseNumber", label: "Labor Certification DOL Case Number", section: "employer" },
    { path: "employer.laborCertification.dolFilingDate", label: "Labor Certification DOL Filing Date", section: "employer", type: "date" },
    { path: "employer.laborCertification.dolExpirationDate", label: "Labor Certification DOL Expiration Date", section: "employer", type: "date" },

    // ── Position ──
    { path: "employer.position.jobTitle", label: "Job Title Offered", section: "employer" },
    { path: "employer.position.socCode", label: "SOC Code", section: "employer" },
    { path: "employer.position.beneficiaryWorkAddress", label: "Beneficiary Work Address", section: "employer" },
    { path: "employer.position.salary", label: "Salary", section: "employer", type: "currency" },

    // ── Signing person ──
    { path: "employer.signingPerson.firstName", label: "Signing Person's First Name", section: "employer" },
    { path: "employer.signingPerson.lastName", label: "Signing Person's Last Name", section: "employer" },
    { path: "employer.signingPerson.title", label: "Signing Person's Designation / Title", section: "employer" },
    { path: "employer.signingPerson.email", label: "Signing Person's Email", section: "employer", type: "email" },
    { path: "employer.signingPerson.mobilePhone", label: "Signing Person's Mobile Number", section: "employer", type: "phone" },

    // ── Beneficiary personal information ──
    { path: "employee.personal.lastName", label: "Last Name", section: "employee" },
    { path: "employee.personal.firstName", label: "First Name", section: "employee" },
    { path: "employee.personal.dateOfBirth", label: "Date of Birth", section: "employee", type: "date" },
    { path: "employee.personal.cityOfBirth", label: "City of Birth", section: "employee" },
    { path: "employee.personal.stateOfBirth", label: "State of Birth", section: "employee", required: false },
    { path: "employee.personal.countryOfBirth", label: "Country of Birth", section: "employee" },
    { path: "employee.personal.currentAddress", label: "Current Address", section: "employee" },
    { path: "employee.personal.email", label: "Email", section: "employee", type: "email" },
    { path: "employee.personal.phonePrimary", label: "Contact Number (Primary)", section: "employee", type: "phone" },
    { path: "employee.personal.phoneSecondary", label: "Contact Number (Secondary)", section: "employee", type: "phone", required: false },
    { path: "employee.personal.foreignAddress", label: "Foreign Address", section: "employee", required: false },

    // ── Immigration status ──
    { path: "employee.immigrationStatus.lastArrivalDate", label: "Last Date of Arrival", section: "employee", type: "date" },
    { path: "employee.immigrationStatus.i94Number", label: "Latest I-94 Number", section: "employee" },
    { path: "employee.immigrationStatus.statusExpiryDate", label: "Current Status Expiration Date", section: "employee", type: "date" },
    { path: "employee.immigrationStatus.ssn", label: "SSN", section: "employee" },
    { path: "employee.immigrationStatus.alienNumber", label: "A Number", section: "employee", required: false },
    { path: "employee.immigrationStatus.priorImmigrantPetitionFiled", label: "Has Any Immigrant Visa Petition Ever Been Filed For You?", section: "employee", type: "radio" },
    { path: "employee.immigrationStatus.priorImmigrantPetitionDetails", label: "Prior Petition Details (form, date filed, result)", section: "employee", required: false, condition: { field: "employee.immigrationStatus.priorImmigrantPetitionFiled", operator: "equals", value: "Yes" } },

    // ── Spouse / children (only when included) ──
    { path: "employee.otherInformation.hasDependents", label: "Include Spouse/Children in This Petition?", section: "employee", type: "radio" },
    { path: "employee.i140SpouseChildren", label: "Spouse / Children", section: "employee", required: false, repeatable: true, condition: { field: "employee.otherInformation.hasDependents", operator: "equals", value: "yes" } },
  ];
  return entries.map((entry) => ({ ...entry, required: entry.condition ? false : entry.required !== false }));
}

const REPEATABLE_FIELDS = {
  "employee.i140SpouseChildren": [
    { key: "firstName", label: "First Name", type: "text" },
    { key: "lastName", label: "Last Name", type: "text" },
    { key: "relationship", label: "Relationship", type: "text" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
    { key: "countryOfBirth", label: "Country of Birth", type: "text" },
  ],
};

module.exports = { key, petitionerDocuments, beneficiaryDocuments, dependentDocuments, fieldCatalog, REPEATABLE_FIELDS };
