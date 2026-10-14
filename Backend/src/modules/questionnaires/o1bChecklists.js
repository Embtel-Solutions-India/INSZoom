// O-1B (Arts / Motion Picture & Television extraordinary ability) - the two Questionnaire templates of the employer-sponsored case:
//   o1b_employer_checklist  "O-1B Employer Checklist"  (checklistRole "employer")   questions E1-E19
//   o1b_employee_checklist  "O-1B Employee Checklist"  (checklistRole "employee")   questions B1-B30 + the six O-1B evidentiary criteria
// Built with the same shared builder every other checklist uses and provisioned exactly like EB-1C / TN: the principal (employer) case gets the
// employer checklist, each employee case the employee checklist; both start as drafts until a case manager approves them (checklist-gate.js).
// The earlier shared o1_* templates keep serving O-1A / bare O-1 and every existing case that already references them; they no longer match O-1B,
// so a new O-1B case never receives both versions.
//
// EVERYTHING here is optional: every question is stored required:false and flagged metadata.optional, so a client can save or submit with every
// answer blank. A Yes/No answer that was never given stays unknown (never false). Addresses are free-text (textarea) answers that the canonical
// layer splits only where the text shows the parts (AddressParser never guesses). Document questions are attachments, never scalar form values.

const { buildQuestion } = require("./definitionHelpers");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const O1B_VISA_TYPES = ["O-1B", "O1B"];
const URL_RULE = { type: "regex", value: "^https?://[^\\s/$.?#][^\\s]*\\.[^\\s]{2,}$", message: "Enter a full web address, for example https://www.example.com", severity: "error" };
const NUMBER_RULE = { type: "min", value: 0, message: "Enter a valid number", severity: "error" };

const S = {
  company: "Information About the Company",
  signer: "Authorized Signing Person",
  website: "Company Website",
  employment: "Information About Proposed Employment",
  employerDocs: "Documents Required From the Employer",
  you: "Information About You",
  employeeDocs: "Documents Required From the Beneficiary",
  criteria: "O-1B Evidentiary Criteria",
};

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// [no, key, label, type, canonicalPath, section, extras]
const EMPLOYER = [
  ["E1", "company_name", "Company Name:", "text", "company.name", S.company],
  ["E2", "company_address", "Company Address (complete address):", "textarea", "company.address.formatted", S.company],
  ["E3", "company_fein", "Federal Employer Identification Number (FEIN):", "text", "company.ein", S.company],
  ["E4", "company_business_type", "Type of Business:", "text", "company.industry", S.company],
  ["E5", "company_year_established", "Year Established:", "number", "company.yearEstablished", S.company, { rules: [NUMBER_RULE] }],
  ["E6", "company_total_employees", "Total number of employees:", "number", "company.numberOfEmployees", S.company, { rules: [NUMBER_RULE] }],
  ["E7", "company_gross_annual_income", "Gross annual income of the company:", "currency", "company.grossAnnualIncome", S.company],
  ["E8", "company_net_annual_income", "Net annual income of the company:", "currency", "company.netAnnualIncome", S.company],
  ["E9", "signatory_first_name", "First name of signing person:", "text", "company.authorizedRepresentative.firstName", S.signer],
  ["E10", "signatory_last_name", "Last name of signing person:", "text", "company.authorizedRepresentative.lastName", S.signer],
  ["E11", "signatory_title", "Designation/ Title of the signing person:", "text", "company.authorizedRepresentative.title", S.signer],
  ["E12", "signatory_email", "Email of the signing person:", "email", "company.authorizedRepresentative.email", S.signer],
  ["E13", "signatory_mobile_phone", "Mobile Phone Number of the signing person:", "phone", "company.authorizedRepresentative.phone", S.signer],
  ["E14", "company_website_url", "Website Link:", "text", "company.website", S.website, { rules: [URL_RULE], format: "url" }],
  ["E15", "offered_salary", "Salary as per offer letter:", "currency", "employment.wage", S.employment],
  [
    "E16", "work_locations",
    "Job Location (Complete address) - Mention all the addresses in which the beneficiary is going to work along with the company/end client name:",
    "repeating_group", "employment.workLocations", S.employment,
    {
      itemLabel: "Job location",
      fields: [
        { key: "address", label: "Job Location (Complete address)", type: "text", canonicalPath: "employment.workLocations[].address" },
        { key: "companyOrEndClientName", label: "Company/End Client Name", type: "text", canonicalPath: "employment.workLocations[].companyOrEndClientName" },
      ],
    },
  ],
  ["E17", "doc_articles_of_incorporation", "Copy of Article of Incorporation", "file", "petitioner.company.documents.articlesOfIncorporation", S.employerDocs],
  ["E18", "doc_business_license", "Copy of Business License", "file", "petitioner.company.documents.businessLicense", S.employerDocs],
  ["E19", "doc_blank_letterhead_word", "Blank Letterhead in word", "file", "petitioner.company.documents.blankLetterheadWordFile", S.employerDocs, { description: "As an editable Word/.docx file." }],
];

const CRITERIA = [
  ["criterion1LeadOrStarringParticipation", "Criterion 1: Evidence that the beneficiary has performed, and will perform, services as a lead or starring participant in productions or events which have a distinguished reputation as evidenced by critical reviews, advertisements, publicity releases, publications, contracts, or endorsements."],
  ["criterion2NationalInternationalRecognition", "Criterion 2: Evidence that the beneficiary has achieved national or international recognition for achievements evidenced by critical reviews or other published materials by or about the beneficiary in major newspapers, trade journals, magazines, or other publications."],
  ["criterion3DistinguishedOrganizationRole", "Criterion 3: Evidence that the beneficiary has performed, and will perform, in a lead, starring, or critical role for organizations and establishments that have a distinguished reputation evidenced by articles in newspapers, trade journals, publications, or testimonials."],
  ["criterion4CommercialOrCriticalSuccess", "Criterion 4: Evidence that the beneficiary has a record of major commercial or critically acclaimed successes as evidenced by such indicators as title, rating, standing in the field, box office receipts, motion pictures or television ratings, and other occupational achievements reported in trade journals, major newspapers, or other publications."],
  ["criterion5SignificantRecognition", "Criterion 5: Evidence that the beneficiary has received significant recognition for achievements from organizations, critics, government agencies, or other recognized experts in the field in which the beneficiary is engaged. Such testimonials must be in a form which clearly indicates the author's authority, expertise, and knowledge of the beneficiary's achievements."],
  ["criterion6HighSalaryOrRemuneration", "Criterion 6: Evidence that the beneficiary has either commanded a high salary or will command a high salary or other substantial remuneration for services in relation to others in the field, as evidenced by contracts or other reliable evidence."],
];

const EMPLOYEE = [
  ["B1", "last_name", "Last Name:", "text", "person.lastName", S.you],
  ["B2", "first_name", "First Name:", "text", "person.firstName", S.you],
  ["B3", "middle_name", "Middle Name:", "text", "person.middleName", S.you],
  ["B4", "other_names", "All other names used (include maiden name and names from all previous marriages, if any):", "text", "beneficiary.otherNames", S.you],
  ["B5", "date_of_birth", "Date of birth (mm/dd/yyyy):", "date", "person.dob", S.you],
  ["B6", "country_of_birth", "Country of birth:", "text", "person.countryOfBirth", S.you],
  ["B7", "state_province_of_birth", "Province/State of birth:", "text", "person.provinceOfBirth", S.you],
  ["B8", "country_of_citizenship", "Country of citizenship:", "text", "person.citizenship", S.you],
  ["B9", "ssn", "Social Security Number:", "text", "person.ssn", S.you],
  ["B10", "a_number", "A # (written on work authorization card/OPT card), if available:", "text", "person.alienNumber", S.you],
  ["B11", "current_us_address", "Current U.S. address (street, apt#, city, state and zip code):", "textarea", "contact.address.formatted", S.you],
  ["B12", "consulate", "US Consulate you will visit (Mention City & Country:", "text", "beneficiary.consularProcessing.consulateCityCountry", S.you],
  ["B13", "foreign_address", "Your foreign address (Street, Apt #, City, State, Country and Zipcode):", "textarea", "contact.foreignAddress.formatted", S.you],
  ["B14", "has_valid_passport", "Do you or any other person in this petition have a valid passport (Yes/No):", "boolean", "beneficiary.immigration.petitionHasValidPassport", S.you],
  ["B15", "intend_replace_i94", "Do you also intend to replace your I-94 (Yes/No)?", "boolean", "beneficiary.immigration.intendToReplaceI94", S.you],
  [
    "B16", "dependents", "Are there any dependents (spouse/children) for whom visa has to be filed (Yes/No)? If Yes, how many?",
    "repeating_group", "beneficiary.dependents", S.you,
    {
      itemLabel: "Dependent",
      description: "Add one entry per dependent. Leave empty if there are none.",
      fields: [
        { key: "fullName", label: "Dependent's full name", type: "text", canonicalPath: "beneficiary.dependents[].fullName" },
        { key: "relationship", label: "Relationship to beneficiary", type: "select", options: ["Spouse", "Child"], canonicalPath: "beneficiary.dependents[].relationship" },
        { key: "dateOfBirth", label: "Dependent's date of birth", type: "date", canonicalPath: "beneficiary.dependents[].dateOfBirth" },
        { key: "countryOfCitizenship", label: "Dependent's country of citizenship", type: "text", canonicalPath: "beneficiary.dependents[].countryOfCitizenship" },
      ],
    },
  ],
  ["B17", "in_removal_proceedings", "Is any person including you in removal proceedings (Yes/No)?", "boolean", "beneficiary.immigration.anyPersonInRemovalProceedings", S.you],
  ["B18", "prior_immigrant_petition", "Did this company ever filed an immigrant petition (Green card) for you in the past (Yes/No)?", "boolean", "beneficiary.immigration.petitionerPreviouslyFiledImmigrantPetition", S.you],
  ["B19", "o1_issued_past_7_years", "Have you ever been given O1 visa in the past 7 years (Yes/No)?", "boolean", "beneficiary.immigration.o1VisaIssuedInPastSevenYears", S.you],
  ["B20", "o1_denied_past_7_years", "Have you ever been denied O1 visa in the past 7 years (Yes/No)? If Yes, please explain.", "boolean", "beneficiary.immigration.o1VisaDeniedInPastSevenYears", S.you],
  ["B20a", "o1_denial_explanation", "If Yes, please explain.", "textarea", "beneficiary.immigration.o1VisaDenialExplanation", S.you, { showWhen: { key: "o1_denied_past_7_years", value: "Yes" } }],
  ["B21", "doc_i94", "Copy of I-94 (Arrival-Departure record)", "file", "beneficiary.documents.i94", S.employeeDocs],
  ["B22", "doc_passport", "Copy of the passport", "file", "beneficiary.documents.passport", S.employeeDocs],
  ["B23", "doc_resume", "Copy of updated resume", "file", "beneficiary.documents.resumeCv", S.employeeDocs],
  ["B24", "doc_ssn", "Copy of SSN, must be signed by bearer (if any)", "file", "beneficiary.documents.signedSsnCopy", S.employeeDocs],
  ["B25", "doc_drivers_license", "Copy of US Driver’s license or State Identification card (if any)", "file", "beneficiary.documents.usDriversLicenseOrStateId", S.employeeDocs],
  ["B26", "doc_academic_certificates", "Academic Certificates with transcripts", "file", "beneficiary.documents.academicCertificatesAndTranscripts", S.employeeDocs],
  ["B27", "doc_training_diplomas", "Copy of the training/diploma certificates", "file", "beneficiary.documents.trainingDiplomaCertificates", S.employeeDocs],
  ["B28", "doc_awards", "Copy of any awards, appraisals, achievements or certifications", "file", "beneficiary.documents.awardsAppraisalsAchievementsCertifications", S.employeeDocs],
  ["B29", "doc_experience_letters", "Copy of the previous work experience letters", "file", "beneficiary.documents.previousWorkExperienceLetters", S.employeeDocs],
  ["B30", "doc_prior_i797", "All I-797 (prior notice/receipt of approvals)", "file", "beneficiary.immigration.priorI797Notices", S.employeeDocs, { description: "You can add several I-797 notices." }],
  ...CRITERIA.map(([id, label], index) => [`C${index + 1}`, id, label, "file", `beneficiary.o1bEvidence.${id}`, S.criteria]),
];

function build(role, rows, meta, prefix = "o1b") {
  const visibility = role === "employer"
    ? { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] }
    : { roles: ["employee", ...STAFF_ROLES], portals: ["employee", "admin"] };
  const sections = [];
  const counters = new Map();
  const keyOf = (shortKey) => `${prefix}_${role}_${shortKey}`;
  const questions = rows.map(([no, shortKey, label, type, canonicalPath, section, extras = {}]) => {
    if (!sections.includes(section)) sections.push(section);
    const order = (counters.get(section) || 0) + 1;
    counters.set(section, order);
    const key = keyOf(shortKey);
    const isFile = type === "file";
    const isGroup = type === "repeating_group";
    return buildQuestion(key, label, type, section, order, {
      required: false,
      description: extras.description,
      options: extras.options || (type === "boolean" ? ["Yes", "No"] : []),
      evidenceCategory: isFile ? "supporting_document" : undefined,
      mapping: { canonicalPath },
      ...(extras.rules ? { validationRules: extras.rules } : {}),
      ...(extras.showWhen ? { conditionalLogic: { mode: "all", rules: [{ questionKey: keyOf(extras.showWhen.key), operator: "equals", value: extras.showWhen.value }], groups: [] } } : {}),
      ...(isGroup ? { repeatable: true } : {}),
      metadata: {
        itemNumber: no,
        requirement: "optional",
        optional: true,
        ...(isFile ? { documentType: key, category: "supporting_document", multiple: true } : {}),
        ...(extras.format ? { format: extras.format } : {}),
        ...(extras.sensitive ? { sensitive: true } : {}),
        ...(isGroup ? { repeatableFields: extras.fields, itemLabel: extras.itemLabel } : {}),
        ...(type === "boolean" ? { canonicalType: "boolean (unanswered = unknown)" } : {}),
      },
      visibility,
    });
  });
  return { ...meta, sections, questions };
}

const employerChecklist = build("employer", EMPLOYER, {
  key: "o1b_employer_checklist",
  title: "O-1B Employer Checklist",
  visaType: "O-1B",
  visaTypes: O1B_VISA_TYPES,
  checklistRole: "employer",
  isDefault: true,
  description: "Information about the U.S. petitioner, its authorized signer and the proposed employment. Everything is optional - answer what you can and save.",
});
const employeeChecklist = build("employee", EMPLOYEE, {
  key: "o1b_employee_checklist",
  title: "O-1B Employee Checklist",
  visaType: "O-1B",
  visaTypes: O1B_VISA_TYPES,
  checklistRole: "employee",
  isDefault: true,
  description: "Information about the beneficiary, supporting documents and evidence for the six O-1B criteria. Everything is optional - answer what you can and save.",
});

const O1B_CHECKLIST_DEFINITIONS = [employerChecklist, employeeChecklist];

module.exports = { O1B_CHECKLIST_DEFINITIONS, O1B_VISA_TYPES, CRITERIA, slug, build, EMPLOYER, STAFF_ROLES, URL_RULE, NUMBER_RULE };
