// O-1A (extraordinary ability in sciences, education, business or athletics) - the two Questionnaire templates of the employer-sponsored case:
//   o1a_employer_checklist  "O-1A Employer Checklist"            (checklistRole "employer")
//   o1a_employee_checklist  "O-1A Employee/Beneficiary Checklist" (checklistRole "employee")  incl. the ten evidence criteria
// Same shared builder, provisioning and approval gate as the O-1B / EB-1C / TN pairs (see o1bChecklists.js). The earlier shared o1_* pair no longer
// matches O-1A (it keeps serving bare "O-1"), so a new O-1A case never receives both; existing cases keep the references and answers they have.
// EVERYTHING is optional (required:false + metadata.optional). Yes/No answers stay unknown until answered. Addresses are structured (address type);
// job locations and other names are repeatable records. Evidence uploads are attachments, never scalar PDF values.

const { COUNTRIES } = require("../../config/geoOptions");
const { build, EMPLOYER, URL_RULE, NUMBER_RULE } = require("./o1bChecklists");

const O1A_VISA_TYPES = ["O-1A", "O1A"];
const S = {
  company: "Information About the Company",
  signer: "Authorized Signing Person",
  website: "Company Website",
  employment: "Information About Proposed Employment",
  employerDocs: "Documents Required From the Employer",
  you: "Information About YOU",
  outside: "Complete the following, if applying from Outside the USA.",
  employeeDocs: "Documents Required From the Beneficiary",
};
const YEAR_RULES = [
  { type: "min", value: 1000, message: "Enter a four-digit year", severity: "error" },
  { type: "max", value: 9999, message: "Enter a four-digit year", severity: "error" },
];
const COUNT_RULE = { type: "min", value: 0, message: "Enter a whole number, 0 or more", severity: "error" };

const WORK_LOCATION_FIELDS = [
  { key: "address", label: "Full street address", type: "text", canonicalPath: "employment.workLocations[].address" },
  { key: "unit", label: "Apartment/Suite", type: "text", canonicalPath: "employment.workLocations[].unit" },
  { key: "city", label: "City", type: "text", canonicalPath: "employment.workLocations[].city" },
  { key: "state", label: "State/Province", type: "text", canonicalPath: "employment.workLocations[].state" },
  { key: "postalCode", label: "ZIP/Postal code", type: "text", canonicalPath: "employment.workLocations[].postalCode" },
  { key: "country", label: "Country", type: "text", canonicalPath: "employment.workLocations[].country" },
  { key: "companyOrEndClientName", label: "Company/End Client Name", type: "text", canonicalPath: "employment.workLocations[].companyOrEndClientName" },
];

// employer rows: the supplied questions with the O-1A-specific shape (structured address, structured job locations, document wording)
const EMPLOYER_ROWS = EMPLOYER.map((row) => {
  const [no, key, label, type, canonical, section, extras = {}] = row;
  if (no === "E2") return [no, key, label, "address", "petitioner.company.address", section];
  if (no === "E5") return [no, key, label, type, canonical, section, { rules: YEAR_RULES }];
  if (no === "E6") return [no, key, label, type, "company.numberOfEmployees", section, { rules: [COUNT_RULE] }];
  if (no === "E16") return [no, key, label, type, canonical, section, { itemLabel: "Job location", fields: WORK_LOCATION_FIELDS }];
  if (no === "E19") return [no, key, "Blank Letterhead in word format", type, "petitioner.company.documents.blankWordLetterhead", section, { description: "As an editable Word/.docx file." }];
  return row;
});

const CRITERIA = [
  ["criterion1Awards", "Receipt of lesser nationally or internationally recognized prizes or awards for excellence in the field of endeavor"],
  ["criterion2Memberships", "Membership in associations in the field for which classification is sought that require outstanding achievement of their members, as judged by recognized national or international experts in their disciplines or fields. ( If you have )"],
  ["criterion3PublishedMaterialAboutBeneficiary", "Published material about the person in professional or major trade publications or other major media relating to the person's work in the field for which classification is sought. Such evidence must include the title, date, and author of the material, and any necessary translation"],
  ["criterion4Judging", "The person's participation, either individually or on a panel, as a judge of the work of others in the same or an allied field of specification for which classification is sought."],
  ["criterion5OriginalContributions", "The person's original scientific, scholarly, artistic, athletic, or business-related contributions of major significance in the field. ( Patent or anything showing your work and your original idea or innovation)"],
  ["criterion6ScholarlyAuthorship", "The person's authorship of scholarly articles in the field, in professional or major trade publications or other major media."],
  ["criterion7ExhibitionsAndShowcases", "Display of the person's work in the field at artistic exhibitions or showcases (If any)"],
  ["criterion8LeadingOrCriticalRole", "The person has performed in a leading or critical role for organizations or establishments that have a distinguished reputation."],
  ["criterion9HighSalaryOrRemuneration", "The person has commanded a high salary, or other significantly high remuneration for services, in relation to others in the field"],
  ["criterion10CommercialSuccesses", "Commercial successes in the performing arts, as shown by box office receipts or record, cassette, compact disk, or video sales ( If any )"],
];

const country = (extra = {}) => ({ options: COUNTRIES, ...extra });
const EMPLOYEE_ROWS = [
  ["B1", "last_name", "Last Name:", "text", "person.lastName", S.you],
  ["B2", "first_name", "First Name:", "text", "person.firstName", S.you],
  ["B3", "middle_name", "Middle Name:", "text", "person.middleName", S.you],
  [
    "B4", "other_names", "All other names used (include maiden name and names from all previous marriages, if any):", "repeating_group", "beneficiary.otherNames", S.you,
    { itemLabel: "Other name", fields: [{ key: "name", label: "Other name used", type: "text", canonicalPath: "beneficiary.otherNames[]" }] },
  ],
  ["B5", "date_of_birth", "Date of birth (mm/dd/yyyy):", "date", "person.dob", S.you],
  ["B6", "country_of_birth", "Country of birth:", "select", "person.countryOfBirth", S.you, country()],
  ["B7", "state_province_of_birth", "Province/State of birth:", "text", "person.provinceOfBirth", S.you],
  ["B8", "country_of_citizenship", "Country of citizenship:", "select", "person.citizenship", S.you, country()],
  ["B9", "ssn", "Social Security Number:", "text", "person.ssn", S.you, { sensitive: true }],
  ["B10", "a_number", "A # (written on work authorization card/OPT card), if available:", "text", "person.alienNumber", S.you],
  ["B11", "latest_prior_petition_number", "Latest prior petition number", "text", "beneficiary.latestPriorPetitionNumber", S.you],
  ["B12", "sevis_number", "SEVIS Number (Student and Exchange Visitor Information System)", "text", "immigration.sevisNumber", S.you],
  ["B13", "ead_number", "Employment Authorization Document EAD Number (If any)", "text", "beneficiary.eadNumber", S.you],
  ["B14", "current_us_address", "Current U.S. address (street, apt#, city, state and zip code):", "address", "beneficiary.currentUSAddress", S.you],
  ["B15", "consulate", "US Consulate you will visit (Mention City & Country:", "text", "beneficiary.consularProcessing.consulateCityCountry", S.outside],
  ["B16", "foreign_address", "Your foreign address (Street, Apt #, City, State, Country and Zipcode):", "address", "beneficiary.foreignAddress", S.outside],
  ["B17", "has_valid_passport", "Do you or any other person in this petition have a valid passport (Yes/No):", "boolean", "beneficiary.petitionHasValidPassport", S.you],
  ["B18", "intend_replace_i94", "Do you also intend to replace your I-94 (Yes/No)?", "boolean", "beneficiary.intendsToReplaceI94", S.you],
  ["B19", "has_dependents", "Are there any dependents (spouse/children) for whom visa has to be filed (Yes/No)? If Yes, how many?", "boolean", "beneficiary.hasDependents", S.you],
  ["B19a", "dependent_count", "If Yes, how many?", "number", "beneficiary.dependentCount", S.you, { rules: [COUNT_RULE], showWhen: { key: "has_dependents", value: "Yes" } }],
  ["B20", "in_removal_proceedings", "Is any person including you in removal proceedings (Yes/No)?", "boolean", "beneficiary.anyPersonInRemovalProceedings", S.you],
  ["B21", "prior_immigrant_petition", "Did this company ever filed an immigrant petition (Green card) for you in the past (Yes/No)?", "boolean", "beneficiary.employerPreviouslyFiledImmigrantPetition", S.you],
  ["B22", "o1_issued_past_7_years", "Have you ever been given O1 visa in the past 7 years (Yes/No)?", "boolean", "beneficiary.hasPreviousO1VisaWithinSevenYears", S.you],
  ["B23", "o1_denied_past_7_years", "Have you ever been denied O1 visa in the past 7 years (Yes/No)? If Yes, please explain.", "boolean", "beneficiary.hasO1VisaDenialWithinSevenYears", S.you],
  ["B23a", "o1_denial_explanation", "If Yes, please explain.", "textarea", "beneficiary.o1VisaDenialExplanation", S.you, { showWhen: { key: "o1_denied_past_7_years", value: "Yes" } }],
  ["D1", "doc_i94", "Copy of I-94 (Arrival-Departure record)", "file", "beneficiary.documents.i94", S.employeeDocs],
  ["D2", "doc_passport", "Copy of the passport", "file", "beneficiary.documents.passport", S.employeeDocs],
  ["D3", "doc_resume", "Copy of updated resume (We have )", "file", "beneficiary.documents.updatedResume", S.employeeDocs],
  ["D4", "doc_ssn", "Copy of SSN, must be signed by bearer (if any)", "file", "beneficiary.documents.signedSSN", S.employeeDocs],
  ["D5", "doc_drivers_license", "Copy of US Driver’s license or State Identification card (if any)", "file", "beneficiary.documents.usGovernmentId", S.employeeDocs],
  ["D6", "doc_academic_certificates", "Academic Certificates with transcripts", "file", "beneficiary.documents.academicCertificatesAndTranscripts", S.employeeDocs],
  ["D7", "doc_credential_evaluation", "Copy of educational credential evaluation report", "file", "beneficiary.documents.educationalCredentialEvaluation", S.employeeDocs],
  ["D8", "doc_training_diplomas", "Copy of the training/diploma certificates", "file", "beneficiary.documents.trainingAndDiplomaCertificates", S.employeeDocs],
  ["D9", "doc_awards", "Copy of any awards, appraisals, achievements or certifications", "file", "beneficiary.documents.awardsAppraisalsAchievementsCertifications", S.employeeDocs],
  ["D10", "doc_experience_letters", "Copy of the previous work experience letters", "file", "beneficiary.documents.previousWorkExperienceLetters", S.employeeDocs],
  ["D11", "doc_prior_i797", "All I-797 (prior notice/receipt of approvals)", "file", "beneficiary.documents.priorI797NoticesAndApprovals", S.employeeDocs],
  ...CRITERIA.map(([id, label], index) => [`C${index + 1}`, id, label, "file", `beneficiary.o1aEvidence.${id}`, `Criterion ${index + 1}`]),
];

const employerChecklist = build("employer", EMPLOYER_ROWS, {
  key: "o1a_employer_checklist",
  title: "O-1A Employer Checklist",
  visaType: "O-1A",
  visaTypes: O1A_VISA_TYPES,
  checklistRole: "employer",
  isDefault: true,
  description: "Information about the U.S. petitioner, its authorized signer and the proposed employment. Everything is optional - answer what you can and save.",
}, "o1a");
const employeeChecklist = build("employee", EMPLOYEE_ROWS, {
  key: "o1a_employee_checklist",
  title: "O-1A Employee/Beneficiary Checklist",
  visaType: "O-1A",
  visaTypes: O1A_VISA_TYPES,
  checklistRole: "employee",
  isDefault: true,
  description: "Information about the beneficiary, supporting documents and evidence for the ten O-1A criteria. Everything is optional - answer what you can and save.",
}, "o1a");

const O1A_CHECKLIST_DEFINITIONS = [employerChecklist, employeeChecklist];

module.exports = { O1A_CHECKLIST_DEFINITIONS, O1A_VISA_TYPES, CRITERIA, EMPLOYEE_ROWS, EMPLOYER_ROWS };
