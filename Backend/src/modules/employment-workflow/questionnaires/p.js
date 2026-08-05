const { clean } = require("./shared");
const { SALARY_UNITS } = require("./l1a");

const key = "p";

// Anchored so a bare "p" only matches the P classification itself (P-1A /
// P-1B / P-3) and never an unrelated word containing the letter — unlike
// h1b/l1a's substring regexes, "p" alone is too short to safely leave
// unanchored.
function matches(value) {
  return /^p[\s-]?(1a|1b|3)?$/i.test(String(value || "").trim());
}

const P_CLASSIFICATIONS = ["P-1A", "P-1B", "P-3"];

// Common employer document list — "Documents Required" from the source,
// always shown regardless of sub-type.
const COMMON_EMPLOYER_DOCUMENTS = [
  { name: "Copy of the Business license", documentType: "business_license", description: "Upload from the employer document repository." },
  { name: "Copy of Articles of incorporation", documentType: "articles_of_incorporation", description: "Upload from the employer document repository." },
  { name: "Company letter Head in word document", documentType: "company_letterhead", description: "Upload from the employer document repository." },
  { name: "Itinerary of events, performances, or competitions (dates, locations, venues)", documentType: "p_event_itinerary", description: "Itinerary covering the events, performances, or competitions the beneficiary will take part in." },
];

// Evidence group shown ONLY when pClassification === "P-1A" (Athlete) —
// source heading "Evidence of international recognition:".
const P1A_EVIDENCE_DOCUMENTS = [
  { name: "Contracts with major U.S. leagues or teams", documentType: "p1a_us_league_contracts", description: "Contracts with major U.S. leagues or teams." },
  { name: "International rankings, records, awards, medals", documentType: "p1a_rankings_awards", description: "Evidence of international rankings, records, awards, or medals." },
  { name: "Media coverage", documentType: "p1a_media_coverage", description: "Media coverage of the athlete." },
  { name: "Letters of recommendation from experts in the sport", documentType: "p1a_expert_recommendation_letters", description: "Letters of recommendation from recognized experts in the sport." },
  { name: "Proof of participation in significant competitions", documentType: "p1a_significant_competitions_proof", description: "Proof of participation in significant competitions." },
  { name: "Copy of the contract between the athlete and the U.S. employer", documentType: "p1a_athlete_us_employer_contract", description: "Contract between the athlete and the U.S. employer." },
];

// Evidence group shown ONLY when pClassification === "P-1B" (Entertainment
// Group) — source heading "For P-1B (Entertainment Group)".
const P1B_EVIDENCE_DOCUMENTS = [
  { name: "Evidence the group has been internationally recognized for a sustained and substantial period (at least 75% of members must have been with the group for at least 1 year); Awards, press coverage, critical reviews, testimonials", documentType: "p1b_sustained_recognition_evidence", description: "Evidence of sustained, substantial international recognition (75% membership continuity for at least 1 year) — awards, press coverage, critical reviews, testimonials." },
  { name: "Proof of prior performances on a distinguished level", documentType: "p1b_distinguished_performances_proof", description: "Proof of prior performances on a distinguished level." },
];

// Evidence group shown ONLY when pClassification === "P-3" (Culturally
// Unique Program) — source heading "For P-3 (Culturally Unique Program)".
// The two "written expert opinions"/"letters from experts" items are
// document UPLOADS the client provides, not the (out-of-scope) expert-opinion-
// letter generation feature.
const P3_EVIDENCE_DOCUMENTS = [
  { name: "Documentation that the performance is culturally unique: Written expert opinions, testimonials", documentType: "p3_expert_opinions_testimonials", description: "Written expert opinions and testimonials on the cultural uniqueness of the performance." },
  { name: "Documentation that the performance is culturally unique: Media coverage, photos, video", documentType: "p3_media_photos_video", description: "Media coverage, photos, and video documenting the performance's cultural uniqueness." },
  { name: "Documentation that the performance is culturally unique: Cultural history or explanation of the art form", documentType: "p3_cultural_history_explanation", description: "Cultural history or explanation of the art form." },
  { name: "Letters from experts, cultural organizations, or scholars", documentType: "p3_expert_letters", description: "Letters from experts, cultural organizations, or scholars." },
];

const employerDocuments = [
  ...COMMON_EMPLOYER_DOCUMENTS.map((doc) => ({ ...doc, required: true, category: "business", targetRole: "employer", status: "requested" })),
  ...P1A_EVIDENCE_DOCUMENTS.map((doc) => ({ ...doc, required: true, category: "p1a_evidence", targetRole: "employer", status: "requested" })),
  ...P1B_EVIDENCE_DOCUMENTS.map((doc) => ({ ...doc, required: true, category: "p1b_evidence", targetRole: "employer", status: "requested" })),
  ...P3_EVIDENCE_DOCUMENTS.map((doc) => ({ ...doc, required: true, category: "p3_evidence", targetRole: "employer", status: "requested" })),
];

// Verbatim from the source's "Documents Required from Beneficiary/Employee:"
// list — 6 items, identical for all three sub-types. Reuses the same
// documentType keys as H-1B/L-1A for the documents that are the same concept
// (passport, SSN copy, driver's license/state ID, prior I-797s) — the
// documentType is internal plumbing, not the user-visible label, which stays
// verbatim per-item below.
const employeeDocuments = [
  { name: "All I-797 (prior notice/receipt of approvals)", documentType: "previous_i797_notices", description: "Prior USCIS approval or receipt notices, if any.", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "I-20/ F1 approval notices, if you were in the USA on student visa.", documentType: "i20_f1_approval_notices", description: "I-20/F-1 approval notices, if applicable.", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of I-94 (Arrival-Departure record)", documentType: "employee_i94_copy", description: "Copy of the Arrival-Departure record.", required: true, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of the passport", documentType: "passport", description: "Biographic passport pages.", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of SSN must be signed by bearer (if any)", documentType: "employee_ssn_copy", description: "Social Security card copy, signed by the bearer.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of US Driver's license or State Identification card (if any)", documentType: "employee_drivers_license_or_state_id", description: "US Driver's license or State Identification card.", required: false, category: "identity", targetRole: "employee", status: "requested" },
];

function normalizeEmployer(payload = {}) {
  return {
    pClassification: payload.pClassification || "",
    company: {
      name: clean(payload.company?.name || payload.companyName),
      address: clean(payload.company?.address || payload.companyAddress),
      fein: clean(payload.company?.fein || payload.fein),
      businessType: clean(payload.company?.businessType || payload.businessType),
      yearEstablished: payload.company?.yearEstablished ?? payload.yearEstablished ?? "",
      totalUsEmployees: payload.company?.totalUsEmployees ?? payload.totalUsEmployees ?? "",
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

// No ad-hoc single conditional document beyond the three sub-type evidence
// groups — those gate via the questionnaire condition engine on the
// pClassification answer (see employmentChecklists.js's buildPEmployerChecklist),
// not via this helper. Exported for module-shape parity with h1b.js/l1a.js.
function employerConditionalDocuments() {
  return {};
}

// P Checklist for Beneficiary — "Information About YOU". Identical for all
// three sub-types; no prior-stay history table (unlike H-1B/L-1A).
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
    // Completed if inside the United States
    immigrationStatus: {
      insideUnitedStates: payload.immigrationStatus?.insideUnitedStates || payload.insideUnitedStates || "",
      dateOfLastArrival: payload.immigrationStatus?.dateOfLastArrival || payload.dateOfLastArrival || "",
      i94Number: clean(payload.immigrationStatus?.i94Number || payload.i94Number),
      currentVisaStatus,
      currentStatusExpirationDate: payload.immigrationStatus?.currentStatusExpirationDate || payload.currentStatusExpirationDate || profile.visaExpirationDate || "",
      // Completed if applying from outside the United States
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
      heldPVisaLastSevenYears: otherInfoIn.heldPVisaLastSevenYears || payload.heldPVisaLastSevenYears || "",
      deniedPVisaLastSevenYears: otherInfoIn.deniedPVisaLastSevenYears || payload.deniedPVisaLastSevenYears || "",
      pVisaDenialExplanation: clean(otherInfoIn.pVisaDenialExplanation || payload.pVisaDenialExplanation),
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
function fieldCatalog() {
  return [
    { path: "employer.pClassification", label: "P Classification", section: "employer", required: true, type: "select", options: P_CLASSIFICATIONS, masterDataPath: "visaVariant" },
    { path: "employer.company.name", label: "Company Name", section: "employer", required: true },
    { path: "employer.company.address", label: "Company Address (complete address)", section: "employer", type: "textarea" },
    { path: "employer.company.fein", label: "Federal Employer Identification Number (FEIN)", section: "employer", required: true },
    { path: "employer.company.businessType", label: "Type of Business", section: "employer", required: true },
    { path: "employer.company.yearEstablished", label: "Year Established", section: "employer", required: true },
    { path: "employer.company.totalUsEmployees", label: "Total no. of employees in USA", section: "employer" },
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
    { path: "employer.endClient.name", label: "End Client name if applicable - (Legal Business Name of secondary entity must contain at least 5 characters)", section: "employer" },
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
    { path: "employee.otherInformation.heldPVisaLastSevenYears", label: "Have you ever been given P visa in the past 7 years?", section: "employee" },
    { path: "employee.otherInformation.deniedPVisaLastSevenYears", label: "Have you ever been denied P visa in the past 7 years?", section: "employee" },
    { path: "employee.otherInformation.pVisaDenialExplanation", label: "If Yes, please explain", section: "employee", type: "textarea", condition: { field: "employee.otherInformation.deniedPVisaLastSevenYears", operator: "equals", value: "yes" } },
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
  P_CLASSIFICATIONS,
  COMMON_EMPLOYER_DOCUMENTS,
  P1A_EVIDENCE_DOCUMENTS,
  P1B_EVIDENCE_DOCUMENTS,
  P3_EVIDENCE_DOCUMENTS,
};
