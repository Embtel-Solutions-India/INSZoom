const { clean } = require("./shared");
const { SALARY_UNITS } = require("./l1a");

const key = "o1";

// Anchored the same way as p.js's "p" matcher — "o1" alone is short enough
// that an unanchored regex could false-match unrelated text.
function matches(value) {
  return /^o[\s-]?1[\s-]?(a|b)?$/i.test(String(value || "").trim());
}

const O_CLASSIFICATIONS = ["O-1A", "O-1B"];

// Verbatim from the source's "Documents Required" list — 5 items, common to
// both O-1A and O-1B (the employer checklist is shared, unlike the employee
// side's variant-gated criteria).
const COMMON_EMPLOYER_DOCUMENTS = [
  { name: "Copy of Article of Incorporation", documentType: "o1_articles_of_incorporation", description: "Upload from the employer document repository." },
  { name: "Copy of Business License", documentType: "o1_business_license", description: "Upload from the employer document repository." },
  { name: "Copy of Company Brochure", documentType: "o1_company_brochure", description: "Upload from the employer document repository." },
  { name: "Contract between petitioner and beneficiary", documentType: "o1_petitioner_beneficiary_contract", description: "Signed contract between the petitioner and the beneficiary." },
  { name: "Blank Letterhead in word format", documentType: "o1_blank_letterhead", description: "Company letterhead as an editable .docx file." },
];

const employerDocuments = COMMON_EMPLOYER_DOCUMENTS.map((doc) => ({ ...doc, required: true, category: "business", targetRole: "employer", status: "requested" }));

// Verbatim from the source's "Documents Required from Beneficiary/Employee:"
// list — 11 items, identical for O-1A and O-1B. The source's "Copy of
// updated resume (We have )" has a stray, meaningless "(We have )" fragment —
// treated as a typo and dropped from the label per the task's own note;
// flagged for sign-off, not carried forward.
const employeeDocuments = [
  { name: "Copy of I-94 (Arrival-Departure record)", documentType: "employee_i94_copy", description: "Copy of the Arrival-Departure record.", required: true, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of the passport", documentType: "passport", description: "Biographic passport pages.", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of updated resume", documentType: "updated_resume", description: "Current resume for the O-1 petition.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Copy of SSN, must be signed by bearer (if any)", documentType: "employee_ssn_copy", description: "Social Security card copy, signed by the bearer.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of US Driver's license or State Identification card (if any)", documentType: "employee_drivers_license_or_state_id", description: "US Driver's license or State Identification card.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Academic Certificates with transcripts", documentType: "academic_certificates", description: "Education credential documents with transcripts.", required: true, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of educational credential evaluation report", documentType: "credential_evaluation_report", description: "Credential evaluation report for education completed outside the United States.", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of the training/diploma certificates", documentType: "training_diploma_certificates", description: "Training, diploma, or certification documents.", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of any awards, appraisals, achievements or certifications", documentType: "o1_awards_appraisals_certifications", description: "Awards, appraisals, achievements, or certifications.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Copy of the previous work experience letters", documentType: "previous_work_experience_letters", description: "Experience letters from previous employers.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "All I-797 (prior notice/receipt of approvals)", documentType: "previous_i797_notices", description: "Prior USCIS approval or receipt notices, if any.", required: false, category: "immigration", targetRole: "employee", status: "requested" },
];

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
}

// O-1A criteria — heading "Documents fulfilling criterias-", 10 criteria,
// verbatim. Criteria with no explicit "Please share" sub-item bullets (2, 3,
// 5, 7) get exactly one document, whose label IS the full criterion
// sentence — there is no shorter verbatim label available in the source, so
// nothing is invented. Criterion 8 has three lettered sub-groups (A/B/C);
// 8A ("10 professional profiles...") is a text response, not a document.
const O1A_CRITERIA_HEADING = "Documents fulfilling criterias-";
const O1A_CRITERIA = [
  {
    number: 1,
    heading: "Criterion 1: Receipt of lesser nationally or internationally recognized prizes or awards for excellence in the field of endeavor.",
    items: [
      { name: "Clear photos/scans of all award certificates or trophies" },
      { name: "Any award plaques, medals, or official recognition letters" },
      { name: "If you were holding or receiving the award in a ceremony, please share those pictures as well" },
      { name: "Links or announcements showing the award is prestigious (if available)", required: false },
    ],
  },
  {
    number: 2,
    heading: "Criterion 2: Membership in associations in the field for which classification is sought that require outstanding achievement of their members, as judged by recognized national or international experts in their disciplines or fields. (If you have)",
    required: false,
    items: [
      { name: "Criterion 2: Membership in associations in the field for which classification is sought that require outstanding achievement of their members, as judged by recognized national or international experts in their disciplines or fields. (If you have)", required: false },
    ],
  },
  {
    number: 3,
    heading: "Criterion 3: Published material about the person in professional or major trade publications or other major media relating to the person's work in the field for which classification is sought. Such evidence must include the title, date, and author of the material, and any necessary translation.",
    items: [
      { name: "Criterion 3: Published material about the person in professional or major trade publications or other major media relating to the person's work in the field for which classification is sought. Such evidence must include the title, date, and author of the material, and any necessary translation." },
    ],
  },
  {
    number: 4,
    heading: "Criterion 4: The person's participation, either individually or on a panel, as a judge of the work of others in the same or an allied field of specification for which classification is sought.",
    items: [
      { name: "All invitation emails asking you to serve as a judge, reviewer, panelist, or evaluator" },
      { name: "Proof that you successfully completed the judging/review work (confirmation emails, certificates, thank-you notes)" },
      { name: "Screenshots from the journal/conference system showing your reviewer role" },
      { name: "Photos of you participating in judging panels or evaluation events (if available)", required: false },
    ],
  },
  {
    number: 5,
    heading: "Criterion 5: The person's original scientific, scholarly, artistic, athletic, or business-related contributions of major significance in the field. (Patent or anything showing your work and your original idea or innovation)",
    items: [
      { name: "Criterion 5: The person's original scientific, scholarly, artistic, athletic, or business-related contributions of major significance in the field. (Patent or anything showing your work and your original idea or innovation)" },
    ],
  },
  {
    number: 6,
    heading: "Criterion 6: The person's authorship of scholarly articles in the field, in professional or major trade publications or other major media.",
    items: [
      { name: "Publications in professionally-relevant peer-reviewed journals" },
      { name: "Published conference presentations at nationally or internationally recognized conferences" },
    ],
  },
  {
    number: 7,
    heading: "Criterion 7: Display of the person's work in the field at artistic exhibitions or showcases (If any)",
    required: false,
    items: [
      { name: "Criterion 7: Display of the person's work in the field at artistic exhibitions or showcases (If any)", required: false },
    ],
  },
  {
    number: 8,
    heading: "Criterion 8: The person has performed in a leading or critical role for organizations or establishments that have a distinguished reputation.",
    subgroups: [
      {
        letter: "A",
        title: "Recommendation Letter Signers",
        type: "textarea",
        label: "A. Recommendation Letter Signers",
        description: "Please provide 10 professional profiles (with LinkedIn or contact details) of people who can sign strong recommendation letters, such as: Senior executives or managers; Clients or peers working with you or worked with you.",
      },
      {
        letter: "B",
        title: "Proof of Your Critical Role",
        items: [
          { name: "Emails from leadership praising your work or highlighting your key contributions" },
          { name: "Performance reviews or appraisal letters" },
          { name: "Internal announcements recognizing your role" },
          { name: "Evidence that your work was essential to major projects" },
        ],
      },
      {
        letter: "C",
        title: "Leadership & Team Management Evidence",
        items: [
          { name: "Company organizational chart showing people reporting to you" },
          { name: "Documents proving you led teams or managed key functions" },
          { name: "Project leadership emails or delegation records" },
          { name: "Any proof that you supervised multiple employees or led strategic initiatives" },
        ],
      },
    ],
  },
  {
    number: 9,
    heading: "Criterion 9: The person has commanded a high salary, or other significantly high remuneration for services, in relation to others in the field.",
    items: [
      { name: "Offer letters or employment contracts" },
      { name: "Pay stubs or tax documents (W-2, Form 1099)" },
      { name: "Compensation comparisons (industry wage data)" },
    ],
  },
  {
    number: 10,
    heading: "Criterion 10: Commercial successes in the performing arts, as shown by box office receipts or record, cassette, compact disk, or video sales (If any)",
    required: false,
    items: [
      { name: "Revenue reports, business growth metrics", required: false },
      { name: "Media coverage of your business success", required: false },
      { name: "Investor funding proof", required: false },
      { name: "Market impact evidence", required: false },
    ],
  },
];

// O-1B criteria — heading verbatim below, 6 criteria, all with explicit
// numbered "Please Share" sub-items. The legal criterion text (`heading`,
// straight from the regulatory definition) is untouched and was never
// chef-specific to begin with; only the illustrative "Please share"
// examples below have been generalized to fit any O-1B arts/entertainment
// applicant (not just the source's culinary examples), per sign-off.
const O1B_CRITERIA_HEADING = "Please share as many supporting documents as possible to help us meet the O-1B eligibility criteria, including documents that fulfill the required criteria.";
const O1B_CRITERIA = [
  {
    number: 1,
    heading: "Criterion 1: Evidence that the beneficiary has performed, and will perform, services as a lead or starring participant in productions or events which have a distinguished reputation as evidenced by critical reviews, advertisements, publicity releases, publications, contracts, or endorsements.",
    items: [
      { name: "Contracts for festivals, expos, or major venue engagements" },
      { name: "Event brochures showing your name as a featured performer/artist" },
      { name: "Posters / advertisements listing you as a headliner" },
      { name: "Event website screenshots" },
      { name: "Critical reviews of the event" },
      { name: "Evidence the event is reputed (media coverage about the event itself)" },
      { name: "Invitations as a featured guest artist, headliner, or ambassador for the field" },
      { name: "Proof of high-profile or celebrity-associated engagements" },
    ],
  },
  {
    number: 2,
    heading: "Criterion 2: Evidence that the beneficiary has achieved national or international recognition for achievements evidenced by critical reviews or other published materials by or about the beneficiary in major newspapers, trade journals, magazines, or other publications.",
    items: [
      { name: "Newspaper articles about you" },
      { name: "Magazine interviews" },
      { name: "Trade journal publications (industry-specific magazines)" },
      { name: "Online news articles (with publication name, date, author)" },
      { name: "TV interview transcripts" },
      { name: "Video interviews by recognized media channels" },
      { name: "Awards coverage" },
    ],
  },
  {
    number: 3,
    heading: "Criterion 3: Evidence that the beneficiary has performed, and will perform, in a lead, starring, or critical role for organizations and establishments that have a distinguished reputation evidenced by articles in newspapers, trade journals, publications, or testimonials.",
    items: [
      { name: "Employment letters stating your leading title/role (e.g. \"Lead,\" \"Principal,\" \"Director\")" },
      { name: "Detailed experience letters explaining your leadership role" },
      { name: "Organizational charts showing you at the top" },
      { name: "Media articles about the organization/establishment" },
      { name: "Industry-recognized rating or certification proof (if applicable)", required: false },
      { name: "Organization's awards" },
      { name: "Revenue or ranking status of the establishment" },
      { name: "Testimonials from owners/leadership explaining your importance" },
    ],
  },
  {
    number: 4,
    heading: "Criterion 4: Evidence that the beneficiary has a record of major commercial or critically acclaimed successes as evidenced by such indicators as title, rating, standing in the field, box office receipts, motion pictures or television ratings, and other occupational achievements reported in trade journals, major newspapers, or other publications.",
    items: [
      { name: "Revenue reports during your tenure" },
      { name: "Increase in ratings attributable to your work" },
      { name: "Online rating/review-platform improvements" },
      { name: "Awards won during your employment" },
      { name: "Media mentioning the organization's success" },
      { name: "Celebrity endorsements" },
      { name: "Engagements for major corporate or diplomatic events" },
    ],
  },
  {
    number: 5,
    heading: "Criterion 5: Evidence that the beneficiary has received significant recognition for achievements from organizations, critics, government agencies, or other recognized experts in the field in which the beneficiary is engaged. Such testimonials must be in a form which clearly indicates the author's authority, expertise, and knowledge of the beneficiary's achievements.",
    items: [
      { name: "Detailed expert letters (major organizations, recognized leaders in the field)" },
      { name: "Letters from critics in the field" },
      { name: "Letters from training institute/academy directors" },
      { name: "Letters from relevant government or industry boards (if any)", required: false },
      { name: "Award-issuing body letters" },
    ],
  },
  {
    number: 6,
    heading: "Criterion 6: Evidence that the beneficiary has either commanded a high salary or will command a high salary or other substantial remuneration for services in relation to others in the field, as evidenced by contracts or other reliable evidence.",
    items: [
      { name: "Employment contracts" },
      { name: "Pay slips" },
      { name: "Tax returns (if available)", required: false },
      { name: "Offer letter showing current salary" },
      { name: "Industry wage comparison report (prevailing wage data)" },
      { name: "Proof of consultation fees / event fees" },
    ],
  },
];

function normalizeEmployer(payload = {}) {
  return {
    oClassification: payload.oClassification || "",
    company: {
      name: clean(payload.company?.name || payload.companyName),
      address: clean(payload.company?.address || payload.companyAddress),
      fein: clean(payload.company?.fein || payload.fein),
      businessType: clean(payload.company?.businessType || payload.businessType),
      yearEstablished: payload.company?.yearEstablished ?? payload.yearEstablished ?? "",
      totalEmployees: payload.company?.totalEmployees ?? payload.totalEmployees ?? "",
      grossAnnualIncome: payload.company?.grossAnnualIncome ?? payload.grossAnnualIncome ?? "",
      netAnnualIncome: payload.company?.netAnnualIncome ?? payload.netAnnualIncome ?? "",
      website: clean(payload.company?.website || payload.website),
    },
    signingPerson: {
      firstName: clean(payload.signingPerson?.firstName || payload.signingFirstName),
      lastName: clean(payload.signingPerson?.lastName || payload.signingLastName),
      title: clean(payload.signingPerson?.title || payload.signingTitle),
      email: clean(payload.signingPerson?.email || payload.signingEmail),
      mobilePhone: clean(payload.signingPerson?.mobilePhone || payload.signingMobilePhone),
    },
    position: {
      jobTitle: clean(payload.position?.jobTitle || payload.jobTitle),
      offeredSalary: payload.position?.offeredSalary ?? payload.offeredSalary ?? "",
      salaryUnit: payload.position?.salaryUnit || payload.salaryUnit || "",
      jobLocation: clean(payload.position?.jobLocation || payload.jobLocation),
      dutiesDescription: clean(payload.position?.dutiesDescription || payload.dutiesDescription),
      natureOfEvent: clean(payload.position?.natureOfEvent || payload.natureOfEvent),
    },
    endClient: {
      name: clean(payload.endClient?.name || payload.endClientName),
    },
  };
}

function employerConditionalDocuments() {
  return {};
}

function normalizeEmployee(payload = {}, profile = {}) {
  const otherInfoIn = payload.otherInformation || {};
  const hasDependents = otherInfoIn.hasDependents || payload.hasDependents || "";
  const currentVisaStatus = payload.immigrationStatus?.currentVisaStatus || payload.currentVisaStatus || profile.currentVisaStatus || profile.immigrationStatus || "";
  const socialSecurityNumber = clean(payload.personal?.socialSecurityNumber || payload.socialSecurityNumber || profile.socialSecurityNumber || profile.ssn);
  const eadNumber = clean(payload.personal?.eadNumber || payload.eadNumber);

  return {
    personal: {
      lastName: clean(payload.personal?.lastName || payload.lastName || profile.lastName),
      firstName: clean(payload.personal?.firstName || payload.firstName || profile.firstName),
      middleName: clean(payload.personal?.middleName || payload.middleName || profile.middleName),
      otherNamesUsed: clean(payload.personal?.otherNamesUsed || payload.otherNamesUsed),
      dateOfBirth: payload.personal?.dateOfBirth || payload.dateOfBirth || profile.dateOfBirth || "",
      countryOfBirth: clean(payload.personal?.countryOfBirth || payload.countryOfBirth || profile.countryOfBirth),
      provinceStateOfBirth: clean(payload.personal?.provinceStateOfBirth || payload.provinceStateOfBirth),
      countryOfCitizenship: clean(payload.personal?.countryOfCitizenship || payload.countryOfCitizenship || profile.countryOfCitizenship || profile.nationality),
      socialSecurityNumber,
      alienRegistrationNumber: clean(payload.personal?.alienRegistrationNumber || payload.alienRegistrationNumber || profile.alienRegistrationNumber),
      latestPriorPetitionNumber: clean(payload.personal?.latestPriorPetitionNumber || payload.latestPriorPetitionNumber),
      sevisNumber: clean(payload.personal?.sevisNumber || payload.sevisNumber || profile.sevisNumber),
      eadNumber,
      currentUsAddress: {
        street: clean(payload.personal?.currentUsAddress?.street || payload.currentUsStreet || profile.address),
        apartment: clean(payload.personal?.currentUsAddress?.apartment || payload.currentUsApartment || profile.apartment),
        city: clean(payload.personal?.currentUsAddress?.city || payload.currentUsCity || profile.city),
        state: clean(payload.personal?.currentUsAddress?.state || payload.currentUsState || profile.state),
        zipCode: clean(payload.personal?.currentUsAddress?.zipCode || payload.currentUsZipCode || profile.zipCode),
      },
      passportNumber: clean(payload.personal?.passportNumber || payload.passportNumber || profile.passportNumber),
      passportIssueDate: payload.personal?.passportIssueDate || payload.passportIssueDate || profile.passportIssueDate || "",
      passportExpirationDate: payload.personal?.passportExpirationDate || payload.passportExpirationDate || profile.passportExpirationDate || "",
      passportCountryOfIssuance: clean(payload.personal?.passportCountryOfIssuance || payload.passportCountryOfIssuance || profile.passportCountry),
    },
    immigrationStatus: {
      insideUnitedStates: payload.immigrationStatus?.insideUnitedStates || payload.insideUnitedStates || "",
      dateOfLastArrival: payload.immigrationStatus?.dateOfLastArrival || payload.dateOfLastArrival || "",
      i94Number: clean(payload.immigrationStatus?.i94Number || payload.i94Number),
      currentVisaStatus,
      currentStatusExpirationDate: payload.immigrationStatus?.currentStatusExpirationDate || payload.currentStatusExpirationDate || profile.visaExpirationDate || "",
      consulateForStamping: clean(payload.immigrationStatus?.consulateForStamping || payload.consulateForStamping),
      foreignResidentialAddress: {
        street: clean(payload.immigrationStatus?.foreignResidentialAddress?.street || payload.foreignStreet),
        apartment: clean(payload.immigrationStatus?.foreignResidentialAddress?.apartment || payload.foreignApartment),
        city: clean(payload.immigrationStatus?.foreignResidentialAddress?.city || payload.foreignCity),
        state: clean(payload.immigrationStatus?.foreignResidentialAddress?.state || payload.foreignState),
        country: clean(payload.immigrationStatus?.foreignResidentialAddress?.country || payload.foreignCountry),
        zipCode: clean(payload.immigrationStatus?.foreignResidentialAddress?.zipCode || payload.foreignZipCode),
      },
    },
    otherInformation: {
      hasValidPassport: otherInfoIn.hasValidPassport || payload.hasValidPassport || (profile.passportNumber ? "yes" : ""),
      replaceI94: otherInfoIn.replaceI94 || payload.replaceI94 || "",
      hasDependents,
      numberOfDependents: otherInfoIn.numberOfDependents ?? payload.numberOfDependents ?? profile.numberOfDependents ?? "",
      inRemovalProceedings: otherInfoIn.inRemovalProceedings || payload.inRemovalProceedings || "",
      employerFiledGreenCard: otherInfoIn.employerFiledGreenCard || payload.employerFiledGreenCard || "",
      heldO1VisaLastSevenYears: otherInfoIn.heldO1VisaLastSevenYears || payload.heldO1VisaLastSevenYears || "",
      deniedO1VisaLastSevenYears: otherInfoIn.deniedO1VisaLastSevenYears || payload.deniedO1VisaLastSevenYears || "",
      o1VisaDenialExplanation: clean(otherInfoIn.o1VisaDenialExplanation || payload.o1VisaDenialExplanation),
    },
    conditionalDocuments: {
      i94Required: (payload.immigrationStatus?.insideUnitedStates || payload.insideUnitedStates) === "yes",
      ssnCardRequired: Boolean(socialSecurityNumber),
      eadCardRequired: Boolean(eadNumber),
      dependentDocumentsRequired: hasDependents === "yes",
    },
    updatedAt: new Date(),
  };
}

// Flat catalog of every scalar field the employer/employee normalizers above
// understand, for the document-intelligence auto-fill matcher to target.
// oClassification carries masterDataPath: "visaVariant" — the general
// visa-variant display mechanism (see employmentChecklists.js /
// resolveDisplayVisa) mirrors this straight onto
// case.questionnaireData.masterData.visaVariant via the existing
// buildMasterCaseData()/inferMasterDataPath() pipeline, with zero schema or
// resolver changes.
function fieldCatalog() {
  return [
    { path: "employer.oClassification", label: "O-1 Classification", section: "employer", required: true, type: "select", options: O_CLASSIFICATIONS, masterDataPath: "visaVariant" },
    { path: "employer.company.name", label: "Company Name", section: "employer", required: true },
    { path: "employer.company.address", label: "Company Address (complete address)", section: "employer", type: "textarea" },
    { path: "employer.company.fein", label: "Federal Employer Identification Number (FEIN)", section: "employer", required: true },
    { path: "employer.company.businessType", label: "Type of Business", section: "employer", required: true },
    { path: "employer.company.yearEstablished", label: "Year Established", section: "employer", required: true },
    { path: "employer.company.totalEmployees", label: "Total number of employees", section: "employer" },
    { path: "employer.company.grossAnnualIncome", label: "Gross annual income of the company", section: "employer" },
    { path: "employer.company.netAnnualIncome", label: "Net annual income of the company", section: "employer" },
    { path: "employer.signingPerson.firstName", label: "First name of signing person", section: "employer", required: true },
    { path: "employer.signingPerson.lastName", label: "Last name of signing person", section: "employer", required: true },
    { path: "employer.signingPerson.title", label: "Designation/ Title of the signing person", section: "employer" },
    { path: "employer.signingPerson.email", label: "Email of the signing person", section: "employer", required: true },
    { path: "employer.signingPerson.mobilePhone", label: "Mobile Phone Number of the signing person", section: "employer" },
    { path: "employer.company.website", label: "Website Link", section: "employer" },
    { path: "employer.position.jobTitle", label: "Job title as per offer letter", section: "employer", required: true },
    { path: "employer.position.offeredSalary", label: "Salary as per offer letter", section: "employer", required: true },
    { path: "employer.position.salaryUnit", label: "Offered Salary is per Hour/Week/Bi-weekly/Month/Year?", section: "employer", required: true, type: "select", options: SALARY_UNITS },
    { path: "employer.endClient.name", label: "End Client name if applicable - (Legal Business Name of the secondary entity must contain at least 5 characters)", section: "employer" },
    { path: "employer.position.jobLocation", label: "Job Location (Complete address) - Mention all the addresses in which the beneficiary is going to work along with the company/end client name", section: "employer", required: true, type: "textarea" },
    { path: "employer.position.dutiesDescription", label: "Detailed Job description and responsibilities (should be same on offer letter)", section: "employer", required: true, type: "textarea" },
    { path: "employer.position.natureOfEvent", label: "Explain the Nature of the event", section: "employer", required: true, type: "textarea" },

    // Employee / beneficiary side
    { path: "employee.personal.lastName", label: "Last Name", section: "employee", required: true },
    { path: "employee.personal.firstName", label: "First Name", section: "employee", required: true },
    { path: "employee.personal.middleName", label: "Middle Name", section: "employee" },
    { path: "employee.personal.otherNamesUsed", label: "All other names used (include maiden name and names from all previous marriages, if any)", section: "employee" },
    { path: "employee.personal.dateOfBirth", label: "Date of birth (mm/dd/yyyy)", section: "employee", required: true },
    { path: "employee.personal.countryOfBirth", label: "Country of birth", section: "employee", required: true },
    { path: "employee.personal.provinceStateOfBirth", label: "Province/State of birth", section: "employee" },
    { path: "employee.personal.countryOfCitizenship", label: "Country of citizenship", section: "employee", required: true },
    { path: "employee.personal.socialSecurityNumber", label: "Social Security Number", section: "employee" },
    { path: "employee.personal.alienRegistrationNumber", label: "A # (written on work authorization card/OPT card), if available", section: "employee" },
    { path: "employee.personal.latestPriorPetitionNumber", label: "Latest prior petition number", section: "employee" },
    { path: "employee.personal.sevisNumber", label: "SEVIS Number (Student and Exchange Visitor Information System)", section: "employee" },
    { path: "employee.personal.eadNumber", label: "Employment Authorization Document EAD Number (If any)", section: "employee" },
    { path: "employee.personal.currentUsAddress.street", label: "Current U.S. address (street, apt#, city, state and zip code)", section: "employee" },
    { path: "employee.personal.currentUsAddress.apartment", label: "Current U.S. address apartment", section: "employee" },
    { path: "employee.personal.currentUsAddress.city", label: "Current U.S. address city", section: "employee" },
    { path: "employee.personal.currentUsAddress.state", label: "Current U.S. address state", section: "employee" },
    { path: "employee.personal.currentUsAddress.zipCode", label: "Current U.S. address zip code", section: "employee" },
    { path: "employee.immigrationStatus.insideUnitedStates", label: "Are you inside the United States?", section: "employee" },
    { path: "employee.immigrationStatus.dateOfLastArrival", label: "Date of last arrival", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" } },
    { path: "employee.immigrationStatus.i94Number", label: "I-94 #", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" } },
    { path: "employee.immigrationStatus.currentVisaStatus", label: "Current visa status", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" } },
    { path: "employee.immigrationStatus.currentStatusExpirationDate", label: "Date status expires (mm/dd/yyyy)", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" } },
    { path: "employee.personal.passportNumber", label: "Passport number", section: "employee", required: true },
    { path: "employee.personal.passportIssueDate", label: "Date passport issued (mm/dd/yyyy)", section: "employee" },
    { path: "employee.personal.passportExpirationDate", label: "Date passport expires (mm/dd/yyyy)", section: "employee" },
    { path: "employee.personal.passportCountryOfIssuance", label: "Passport or travel document country of issuance", section: "employee" },
    { path: "employee.immigrationStatus.consulateForStamping", label: "US Consulate you will visit (Mention City & Country)", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" } },
    { path: "employee.immigrationStatus.foreignResidentialAddress.street", label: "Your foreign address (Street, Apt #, City, State, Country and Zipcode)", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" } },
    { path: "employee.immigrationStatus.foreignResidentialAddress.apartment", label: "Foreign address apartment", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" } },
    { path: "employee.immigrationStatus.foreignResidentialAddress.city", label: "Foreign address city", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" } },
    { path: "employee.immigrationStatus.foreignResidentialAddress.state", label: "Foreign address state", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" } },
    { path: "employee.immigrationStatus.foreignResidentialAddress.country", label: "Foreign address country", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" } },
    { path: "employee.immigrationStatus.foreignResidentialAddress.zipCode", label: "Foreign address zip code", section: "employee", condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" } },
    { path: "employee.otherInformation.hasValidPassport", label: "Do you or any other person in this petition have a valid passport", section: "employee" },
    { path: "employee.otherInformation.replaceI94", label: "Do you also intend to replace your I-94?", section: "employee" },
    { path: "employee.otherInformation.hasDependents", label: "Are there any dependents (spouse/children) for whom visa has to be filed?", section: "employee" },
    { path: "employee.otherInformation.numberOfDependents", label: "If Yes, how many?", section: "employee", condition: { field: "employee.otherInformation.hasDependents", operator: "equals", value: "yes" } },
    { path: "employee.otherInformation.inRemovalProceedings", label: "Is any person including you in removal proceedings?", section: "employee" },
    { path: "employee.otherInformation.employerFiledGreenCard", label: "Did this company ever filed an immigrant petition (Green card) for you in the past?", section: "employee" },
    { path: "employee.otherInformation.heldO1VisaLastSevenYears", label: "Have you ever been given O1 visa in the past 7 years?", section: "employee" },
    { path: "employee.otherInformation.deniedO1VisaLastSevenYears", label: "Have you ever been denied O1 visa in the past 7 years?", section: "employee" },
    { path: "employee.otherInformation.o1VisaDenialExplanation", label: "If Yes, please explain", section: "employee", type: "textarea", condition: { field: "employee.otherInformation.deniedO1VisaLastSevenYears", operator: "equals", value: "yes" } },
  ];
}

module.exports = {
  key,
  matches,
  employerDocuments,
  employeeDocuments,
  normalizeEmployer,
  normalizeEmployee,
  employerConditionalDocuments,
  fieldCatalog,
  O_CLASSIFICATIONS,
  COMMON_EMPLOYER_DOCUMENTS,
  O1A_CRITERIA_HEADING,
  O1A_CRITERIA,
  O1B_CRITERIA_HEADING,
  O1B_CRITERIA,
  slug,
};
