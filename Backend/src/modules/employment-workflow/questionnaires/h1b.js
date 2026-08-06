const { clean, emptyDependent } = require("./shared");

const key = "h1b";

function matches(value) {
  return /h[\s-]?1b/i.test(String(value || ""));
}

// Verbatim from the authoritative source's employer document list ("Please
// send the following documents:") — exactly 3 items. An unrelated "Employment
// Offer Letter" document previously lived here; the source does not list one
// under this checklist (the offer letter's job-title/salary/duties are
// captured as PART-2 fields instead), so it was removed.
//
// certified_lca_eta9035 is an ADDITION beyond the literal source list (Phase 2
// coverage audit, flagged for attorney sign-off): every H-1B petition (new,
// extension, transfer, or amendment) requires a DOL-certified Labor Condition
// Application filed with the I-129 — the source checklist never asked for it,
// but its absence would make the checklist incomplete for actual filing.
const employerDocuments = [
  {
    name: "Certified Labor Condition Application (LCA / ETA-9035)",
    documentType: "certified_lca_eta9035",
    description: "DOL-certified Labor Condition Application (ETA Form 9035/9035E), required for every H-1B petition.",
    required: true,
    category: "immigration",
    targetRole: "employer",
    status: "requested",
  },
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
// Beneficiary/Employee:" list — 12 items. "Academic Certificates" and
// "Academic Transcripts" were previously two separate documents; the source
// has one line ("Academic Certificates with transcripts"), so they're merged
// here into a single document.
const employeeDocuments = [
  { name: "Academic Certificates with transcripts", documentType: "academic_certificates", description: "Education credential documents with transcripts.", required: true, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of educational credential evaluation report", documentType: "credential_evaluation_report", description: "Credential evaluation report for education completed outside the United States.", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of the training/diploma certificates", documentType: "training_diploma_certificates", description: "Training, diploma, or certification documents.", required: false, category: "education", targetRole: "employee", status: "requested" },
  { name: "Copy of the recent updated resume", documentType: "updated_resume", description: "Current resume for the H-1B petition.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Copy of the previous work experience letters", documentType: "previous_work_experience_letters", description: "Experience letters from previous employers.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "All I-797 (prior notice/receipt of approvals)", documentType: "previous_i797_notices", description: "Prior USCIS approval or receipt notices.", required: true, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of I-94 (Arrival-Departure record)", documentType: "employee_i94_copy", description: "Copy of the Arrival-Departure record.", required: true, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of the passport", documentType: "passport", description: "Biographic passport pages.", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of SSN, must be signed by bearer (if any)", documentType: "employee_ssn_copy", description: "Social Security card copy, signed by the bearer.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of US Driver's license or State Identification card (if any)", documentType: "employee_drivers_license_or_state_id", description: "US Driver's license or State Identification card.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Recent 3 Months payslips", documentType: "last_3_months_pay_slips", description: "Recent pay slips from the last three months.", required: true, category: "employment", targetRole: "employee", status: "requested" },
];

// Verbatim from the authoritative source's "Documents Required from
// Dependents (if applying for H-4 for family):" list — 6 items, conditional
// on the employee having H-4 dependents. Previously not modeled at all.
const dependentDocuments = [
  { name: "All prior notice of approvals of dependents", documentType: "dependent_prior_approval_notices", description: "Prior USCIS approval or receipt notices for dependents.", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of I-94 (Arrival-Departure record)", documentType: "dependent_i94_copy", description: "Copy of the dependent's Arrival-Departure record.", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Copy of the passport", documentType: "dependent_passport", description: "Dependent's biographic passport pages.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Evidence of relationship (such as marriage certificate and birth certificate)", documentType: "dependent_relationship_evidence", description: "Marriage certificate and/or birth certificate evidencing the relationship.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of SSN, must be signed by the bearer (if any)", documentType: "dependent_ssn_copy", description: "Social Security card copy, signed by the bearer.", required: false, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Copy of US Driver's license or State Identification card (if any)", documentType: "dependent_drivers_license_or_state_id", description: "US Driver's license or State Identification card.", required: false, category: "identity", targetRole: "employee", status: "requested" },
];

function normalizeEmployer(payload = {}) {
  return {
    lca: {
      firstLcaFiling: payload.lca?.firstLcaFiling || payload.firstLcaFiling || "",
      dolVerified: payload.lca?.dolVerified || payload.dolVerified || "",
    },
    company: {
      fullName: clean(payload.company?.fullName || payload.companyName),
      fein: clean(payload.company?.fein || payload.fein || payload.ein),
      address: {
        street: clean(payload.company?.address?.street || payload.companyStreet),
        county: clean(payload.company?.address?.county || payload.companyCounty),
        city: clean(payload.company?.address?.city || payload.companyCity),
        state: clean(payload.company?.address?.state || payload.companyState),
        zipCode: clean(payload.company?.address?.zipCode || payload.companyZipCode),
        country: clean(payload.company?.address?.country || payload.companyCountry || "USA"),
      },
      daytimePhone: clean(payload.company?.daytimePhone || payload.daytimePhone),
      faxNumber: clean(payload.company?.faxNumber || payload.faxNumber),
      businessType: clean(payload.company?.businessType || payload.businessType),
      yearEstablished: payload.company?.yearEstablished ?? payload.yearEstablished ?? "",
      naicsCode: clean(payload.company?.naicsCode || payload.naicsCode),
      website: clean(payload.company?.website || payload.website),
      netIncome: payload.company?.netIncome ?? payload.netIncome ?? "",
      grossAnnualIncome: payload.company?.grossAnnualIncome ?? payload.grossAnnualIncome ?? "",
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
      employmentStartDate: payload.position?.employmentStartDate || payload.employmentStartDate || "",
      // SOC code + prevailing wage level are collected on the H-1B Data
      // Collection & Filing Fee Exemption Supplement (confirmed present on
      // the provisioned I-129 template: Line5_SOCCode, WageLevelBox) — added
      // per the Phase 2 coverage audit, flagged for attorney sign-off.
      socCode: clean(payload.position?.socCode || payload.socCode),
      wageLevel: clean(payload.position?.wageLevel || payload.wageLevel),
    },
    endClient: {
      name: clean(payload.endClient?.name || payload.endClientName),
    },
    workLocations: Array.isArray(payload.workLocations) && payload.workLocations.length
      ? payload.workLocations.map((location) => ({
        companyName: clean(location.companyName),
        street: clean(location.street),
        county: clean(location.county),
        city: clean(location.city),
        state: clean(location.state),
        zipCode: clean(location.zipCode),
      }))
      : [{ companyName: "", street: "", county: "", city: "", state: "", zipCode: "" }],
    jobDescription: {
      duties: clean(payload.jobDescription?.duties || payload.duties),
    },
    workforce: {
      totalUsEmployees: payload.workforce?.totalUsEmployees ?? payload.totalUsEmployees ?? "",
      h1bEmployees: payload.workforce?.h1bEmployees ?? payload.h1bEmployees ?? "",
      h1bL1Employees: payload.workforce?.h1bL1Employees ?? payload.h1bL1Employees ?? "",
      // H-1B Data Collection Supplement Section A (confirmed present on the
      // provisioned I-129 template: H1BSecALine1a/1c) — added per the Phase 2
      // coverage audit, flagged for attorney sign-off on exact wording.
      isH1bDependentOrWillfulViolator: payload.workforce?.isH1bDependentOrWillfulViolator || payload.isH1bDependentOrWillfulViolator || "",
      isAcwiaFeeExempt: payload.workforce?.isAcwiaFeeExempt || payload.isAcwiaFeeExempt || "",
    },
  };
}

function requiresFeinProof(questionnaire = {}) {
  return questionnaire.lca?.firstLcaFiling === "yes" && questionnaire.lca?.dolVerified === "no";
}

function employerConditionalDocuments(questionnaire) {
  return {
    feinProofRequired: requiresFeinProof(questionnaire),
    feinProofDocumentType: "irs_fein_assignment_letter",
  };
}

function normalizeEmployee(payload = {}, profile = {}) {
  const filingType = payload.filingType || "";
  const currentVisaStatus = payload.immigrationStatus?.currentVisaStatus || payload.currentVisaStatus || profile.currentVisaStatus || profile.immigrationStatus || "";
  const hasDependents = payload.immigrationHistory?.hasH4Dependents || payload.hasH4Dependents || "";
  const normalizedDependents = Array.isArray(payload.dependents) && payload.dependents.length ? payload.dependents.map((item) => ({ ...emptyDependent(), ...item })) : [];
  return {
    filingType,
    personal: {
      lastName: clean(payload.personal?.lastName || payload.lastName || profile.lastName),
      firstName: clean(payload.personal?.firstName || payload.firstName || profile.firstName),
      middleName: clean(payload.personal?.middleName || payload.middleName || profile.middleName),
      otherNamesUsed: clean(payload.personal?.otherNamesUsed || payload.otherNamesUsed),
      // I-129 Part 3 requires the beneficiary's gender (confirmed present on
      // the provisioned I-129 template: Line1_Gender) — the source checklist
      // never asked for it. Added per the Phase 2 coverage audit, flagged
      // for attorney sign-off.
      gender: clean(payload.personal?.gender || payload.gender || profile.gender),
      dateOfBirth: payload.personal?.dateOfBirth || payload.dateOfBirth || profile.dateOfBirth || "",
      countryOfBirth: clean(payload.personal?.countryOfBirth || payload.countryOfBirth || profile.countryOfBirth),
      provinceStateOfBirth: clean(payload.personal?.provinceStateOfBirth || payload.provinceStateOfBirth),
      countryOfCitizenship: clean(payload.personal?.countryOfCitizenship || payload.countryOfCitizenship || profile.countryOfCitizenship || profile.nationality),
      socialSecurityNumber: clean(payload.personal?.socialSecurityNumber || payload.socialSecurityNumber || profile.socialSecurityNumber || profile.ssn),
      alienRegistrationNumber: clean(payload.personal?.alienRegistrationNumber || payload.alienRegistrationNumber || payload.aNumber || profile.alienRegistrationNumber),
      latestPriorPetitionNumber: clean(payload.personal?.latestPriorPetitionNumber || payload.latestPriorPetitionNumber),
      sevisNumber: clean(payload.personal?.sevisNumber || payload.sevisNumber || profile.sevisNumber),
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
    },
    immigrationStatus: {
      insideUnitedStates: payload.immigrationStatus?.insideUnitedStates || payload.insideUnitedStates || "",
      dateOfLastArrival: payload.immigrationStatus?.dateOfLastArrival || payload.dateOfLastArrival || "",
      i94Number: clean(payload.immigrationStatus?.i94Number || payload.i94Number),
      currentVisaStatus,
      currentStatusExpirationDate: payload.immigrationStatus?.currentStatusExpirationDate || payload.currentStatusExpirationDate || profile.visaExpirationDate || "",
      replaceI94: payload.immigrationStatus?.replaceI94 || payload.replaceI94 || "",
      consulateForStamping: clean(payload.immigrationStatus?.consulateForStamping || payload.consulateForStamping),
      hasSsn: payload.immigrationStatus?.hasSsn || payload.hasSsn || "",
      hasDriverLicense: payload.immigrationStatus?.hasDriverLicense || payload.hasDriverLicense || "",
      foreignResidentialAddress: {
        street: clean(payload.immigrationStatus?.foreignResidentialAddress?.street || payload.foreignStreet),
        apartment: clean(payload.immigrationStatus?.foreignResidentialAddress?.apartment || payload.foreignApartment),
        city: clean(payload.immigrationStatus?.foreignResidentialAddress?.city || payload.foreignCity),
        stateProvince: clean(payload.immigrationStatus?.foreignResidentialAddress?.stateProvince || payload.foreignStateProvince),
        country: clean(payload.immigrationStatus?.foreignResidentialAddress?.country || payload.foreignCountry),
        zipPostalCode: clean(payload.immigrationStatus?.foreignResidentialAddress?.zipPostalCode || payload.foreignZipPostalCode),
      },
    },
    education: {
      highestLevel: payload.education?.highestLevel || payload.highestLevel || "",
      majorFieldOfStudy: clean(payload.education?.majorFieldOfStudy || payload.majorFieldOfStudy || profile.educationHistory?.[0]?.fieldOfStudy),
      hasUsMastersOrHigher: payload.education?.hasUsMastersOrHigher || payload.hasUsMastersOrHigher || "",
      usInstitutionName: clean(payload.education?.usInstitutionName || payload.usInstitutionName),
      degreeAwardDate: payload.education?.degreeAwardDate || payload.degreeAwardDate || "",
      degreeType: clean(payload.education?.degreeType || payload.degreeType),
      institutionAddress: clean(payload.education?.institutionAddress || payload.institutionAddress),
      credentialEvaluationRequired: payload.education?.credentialEvaluationRequired || payload.credentialEvaluationRequired || "",
    },
    immigrationHistory: {
      hasValidPassport: payload.immigrationHistory?.hasValidPassport || payload.hasValidPassport || (profile.passportNumber ? "yes" : ""),
      hasH4Dependents: hasDependents,
      numberOfDependents: payload.immigrationHistory?.numberOfDependents ?? payload.numberOfDependents ?? profile.numberOfDependents ?? "",
      inRemovalProceedings: payload.immigrationHistory?.inRemovalProceedings || payload.inRemovalProceedings || "",
      employerFiledGreenCard: payload.immigrationHistory?.employerFiledGreenCard || payload.employerFiledGreenCard || "",
      heldH1bLastSevenYears: payload.immigrationHistory?.heldH1bLastSevenYears || payload.heldH1bLastSevenYears || "",
      deniedH1bLastSevenYears: payload.immigrationHistory?.deniedH1bLastSevenYears || payload.deniedH1bLastSevenYears || "",
      h1bDenialExplanation: clean(payload.immigrationHistory?.h1bDenialExplanation || payload.h1bDenialExplanation),
    },
    // H-1B cap-registration fields (Phase H6) - only meaningful for a
    // New/cap filing. Distinct from the beneficiary's CURRENT passport
    // above: registration happens months before filing, sometimes on a
    // different or since-renewed passport, and the H Classification
    // Supplement asks for the document actually used AT registration, not
    // whichever one is current now.
    capRegistration: {
      beneficiaryConfirmationNumber: clean(payload.capRegistration?.beneficiaryConfirmationNumber || payload.beneficiaryConfirmationNumber),
      passportNumber: clean(payload.capRegistration?.passportNumber || payload.capRegistrationPassportNumber),
      passportCountry: clean(payload.capRegistration?.passportCountry || payload.capRegistrationPassportCountry),
      passportExpirationDate: payload.capRegistration?.passportExpirationDate || payload.capRegistrationPassportExpirationDate || "",
    },
    previousHLStatusHistory: Array.isArray(payload.previousHLStatusHistory) && payload.previousHLStatusHistory.length
      ? payload.previousHLStatusHistory.map((stay) => ({
        visaClassification: stay.visaClassification || "",
        arrivalDate: stay.arrivalDate || "",
        departureDate: stay.departureDate || "",
      }))
      : [{ visaClassification: "", arrivalDate: "", departureDate: "" }],
    conditionalDocuments: {
      capSelectionNoticeRequired: filingType === "New H1B",
      f1DocumentsRequired: ["F-1", "OPT", "STEM OPT"].includes(currentVisaStatus),
      i94Required: (payload.immigrationStatus?.insideUnitedStates || payload.insideUnitedStates) === "yes",
      ssnCardRequired: (payload.immigrationStatus?.hasSsn || payload.hasSsn) === "yes",
      driverLicenseRequired: (payload.immigrationStatus?.hasDriverLicense || payload.hasDriverLicense) === "yes",
      usMastersDocumentsRequired: (payload.education?.hasUsMastersOrHigher || payload.hasUsMastersOrHigher) === "yes",
      credentialEvaluationRequired: (payload.education?.credentialEvaluationRequired || payload.credentialEvaluationRequired) === "yes",
      dependentProfileRequired: hasDependents === "yes",
      dependentSsnRequired: hasDependents === "yes" && normalizedDependents.some((item) => item.hasSsn === "yes"),
      dependentDriverLicenseRequired: hasDependents === "yes" && normalizedDependents.some((item) => item.hasDriverLicense === "yes"),
    },
    dependents: normalizedDependents,
    updatedAt: new Date(),
  };
}

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

// Flat catalog of every scalar field the employer/employee normalizers above
// understand, for the document-intelligence auto-fill matcher to target.
// Repeatable sub-documents (workLocations, dependents, previousHLStatusHistory)
// are listed with repeatable:true and are surfaced for review only, not auto-written.
function fieldCatalog() {
  return [
    { path: "employer.lca.firstLcaFiling", label: "First LCA Filing", section: "employer" },
    { path: "employer.lca.dolVerified", label: "DOL Verified", section: "employer" },
    { path: "employer.company.fullName", label: "Company Legal Name", section: "employer", required: true },
    { path: "employer.company.fein", label: "Company FEIN", section: "employer", required: true },
    ...addressFields("employer.company.address", "Company Address", true),
    { path: "employer.company.address.country", label: "Company Address Country", section: "employer" },
    { path: "employer.company.daytimePhone", label: "Company Daytime Phone", section: "employer" },
    { path: "employer.company.faxNumber", label: "Company Fax Number", section: "employer" },
    { path: "employer.company.businessType", label: "Company Business Type", section: "employer" },
    { path: "employer.company.yearEstablished", label: "Company Year Established", section: "employer" },
    { path: "employer.company.naicsCode", label: "Company NAICS Code", section: "employer" },
    { path: "employer.company.website", label: "Company Website", section: "employer" },
    { path: "employer.company.netIncome", label: "Company Net Income", section: "employer" },
    { path: "employer.company.grossAnnualIncome", label: "Company Gross Annual Income", section: "employer" },
    { path: "employer.signingPerson.firstName", label: "Signing Person First Name", section: "employer", required: true },
    { path: "employer.signingPerson.lastName", label: "Signing Person Last Name", section: "employer", required: true },
    { path: "employer.signingPerson.title", label: "Signing Person Title", section: "employer" },
    { path: "employer.signingPerson.email", label: "Signing Person Email", section: "employer", required: true },
    { path: "employer.signingPerson.mobilePhone", label: "Signing Person Mobile Phone", section: "employer" },
    { path: "employer.position.jobTitle", label: "Job Title", section: "employer", required: true },
    { path: "employer.position.offeredSalary", label: "Offered Salary", section: "employer", required: true },
    { path: "employer.position.employmentStartDate", label: "Employment Start Date", section: "employer", required: true },
    // H-1B Data Collection & Filing Fee Exemption Supplement fields, added
    // per the Phase 2 coverage audit (confirmed present on the provisioned
    // I-129 template — see h1b.js normalizeEmployer's comments for citations).
    { path: "employer.position.socCode", label: "SOC (Standard Occupational Classification) Code", section: "employer", required: true },
    {
      path: "employer.position.wageLevel",
      label: "Prevailing Wage Level",
      section: "employer",
      required: true,
      type: "select",
      options: ["Level I", "Level II", "Level III", "Level IV"],
    },
    { path: "employer.endClient.name", label: "End Client Name", section: "employer" },
    { path: "employer.jobDescription.duties", label: "Job Duties Description", section: "employer" },
    { path: "employer.workforce.totalUsEmployees", label: "Total US Employees", section: "employer" },
    { path: "employer.workforce.h1bEmployees", label: "H-1B Employees Count", section: "employer" },
    { path: "employer.workforce.h1bL1Employees", label: "H-1B/L-1 Employees Count", section: "employer" },
    {
      path: "employer.workforce.isH1bDependentOrWillfulViolator",
      label: "Is the petitioner an H-1B-dependent employer, or has it been found to be a willful violator?",
      section: "employer",
      required: true,
    },
    {
      path: "employer.workforce.isAcwiaFeeExempt",
      label: "Is the petitioner exempt from the ACWIA fee under Public Law 114-113?",
      section: "employer",
      required: true,
    },
    { path: "employer.workLocations", label: "Work Locations", section: "employer", repeatable: true },

    { path: "employee.filingType", label: "Filing Type", section: "employee" },
    {
      path: "employee.filingCapType",
      label: "New H1B CAP Type",
      section: "employee",
      type: "select",
      options: ["Regular CAP", "Master's CAP"],
      condition: { field: "employee.filingType", operator: "equals", value: "New H1B" },
    },
    { path: "employee.personal.lastName", label: "Last Name", section: "employee", required: true },
    { path: "employee.personal.firstName", label: "First Name", section: "employee", required: true },
    { path: "employee.personal.middleName", label: "Middle Name", section: "employee" },
    { path: "employee.personal.otherNamesUsed", label: "Other Names Used", section: "employee" },
    // I-129 Part 3 requires the beneficiary's gender (confirmed present on
    // the provisioned I-129 template: Line1_Gender) — added per the Phase 2
    // coverage audit; the source checklist never asked for it.
    {
      path: "employee.personal.gender",
      label: "Gender",
      section: "employee",
      required: true,
      type: "select",
      options: ["Male", "Female"],
    },
    { path: "employee.personal.dateOfBirth", label: "Date of Birth", section: "employee", required: true },
    { path: "employee.personal.countryOfBirth", label: "Country of Birth", section: "employee", required: true },
    { path: "employee.personal.provinceStateOfBirth", label: "Province/State of Birth", section: "employee" },
    { path: "employee.personal.countryOfCitizenship", label: "Country of Citizenship", section: "employee", required: true },
    { path: "employee.personal.socialSecurityNumber", label: "Social Security Number", section: "employee" },
    { path: "employee.personal.alienRegistrationNumber", label: "Alien Registration Number", section: "employee" },
    { path: "employee.personal.latestPriorPetitionNumber", label: "Latest Prior Petition Number", section: "employee" },
    { path: "employee.personal.sevisNumber", label: "SEVIS Number", section: "employee" },
    { path: "employee.personal.currentUsAddress.street", label: "Current US Address Street", section: "employee" },
    { path: "employee.personal.currentUsAddress.apartment", label: "Current US Address Apartment", section: "employee" },
    { path: "employee.personal.currentUsAddress.city", label: "Current US Address City", section: "employee" },
    { path: "employee.personal.currentUsAddress.state", label: "Current US Address State", section: "employee" },
    { path: "employee.personal.currentUsAddress.zipCode", label: "Current US Address Zip Code", section: "employee" },
    { path: "employee.personal.passportNumber", label: "Passport Number", section: "employee", required: true },
    { path: "employee.personal.passportIssueDate", label: "Passport Issue Date", section: "employee" },
    { path: "employee.personal.passportExpirationDate", label: "Passport Expiration Date", section: "employee" },
    { path: "employee.immigrationStatus.insideUnitedStates", label: "Inside United States", section: "employee" },
    {
      path: "employee.immigrationStatus.dateOfLastArrival",
      label: "Date of Last Arrival",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" },
    },
    {
      path: "employee.immigrationStatus.i94Number",
      label: "I-94 Number",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" },
    },
    {
      path: "employee.immigrationStatus.currentVisaStatus",
      label: "Current Visa Status",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" },
    },
    {
      path: "employee.immigrationStatus.currentStatusExpirationDate",
      label: "Current Status Expiration Date",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" },
    },
    { path: "employee.immigrationStatus.replaceI94", label: "Replace I-94", section: "employee" },
    {
      path: "employee.immigrationStatus.consulateForStamping",
      label: "Consulate for Stamping",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" },
    },
    { path: "employee.immigrationStatus.hasSsn", label: "Has SSN", section: "employee" },
    { path: "employee.immigrationStatus.hasDriverLicense", label: "Has Driver License", section: "employee" },
    {
      path: "employee.immigrationStatus.foreignResidentialAddress.street",
      label: "Foreign Residential Address Street",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" },
    },
    {
      path: "employee.immigrationStatus.foreignResidentialAddress.apartment",
      label: "Foreign Residential Address Apartment",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" },
    },
    {
      path: "employee.immigrationStatus.foreignResidentialAddress.city",
      label: "Foreign Residential Address City",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" },
    },
    {
      path: "employee.immigrationStatus.foreignResidentialAddress.stateProvince",
      label: "Foreign Residential Address State/Province",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" },
    },
    {
      path: "employee.immigrationStatus.foreignResidentialAddress.country",
      label: "Foreign Residential Address Country",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" },
    },
    {
      path: "employee.immigrationStatus.foreignResidentialAddress.zipPostalCode",
      label: "Foreign Residential Address Zip/Postal Code",
      section: "employee",
      condition: { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" },
    },
    // masterDataPath is set explicitly (to the same dotted path) on every
    // entry below - without it, inferMasterDataPath (questionnaire.service.js)
    // falls through to its generic sectionMap fallback, which resolves this
    // section ("Education", via sectionTitleFor) to the top-level slot
    // buildMasterCaseData pre-seeds as `education: []` (a flat array, meant
    // for an older repeatable-education-history shape), then tries to set a
    // FLAT underscored key like "employee_education_highest_level" AS A
    // PROPERTY OF THAT ARRAY - which MongoDB's $set rejects at save time
    // ("Cannot create field ... in element {education: []}"), because BSON
    // arrays can't take arbitrary string keys. Confirmed empirically: any
    // employee_education_* answer crashed the save before this fix. Every
    // other employee.* field either gets a real canonicalPath
    // (EMPLOYEE_CANONICAL_PATHS above - personal.*/immigrationStatus.* only,
    // deliberately not education) or, like these, needs its own
    // masterDataPath to avoid the same collision.
    { path: "employee.education.highestLevel", label: "Highest Education Level", section: "employee", masterDataPath: "employee.education.highestLevel" },
    { path: "employee.education.majorFieldOfStudy", label: "Major Field of Study", section: "employee", masterDataPath: "employee.education.majorFieldOfStudy" },
    { path: "employee.education.hasUsMastersOrHigher", label: "Has US Masters or Higher", section: "employee", masterDataPath: "employee.education.hasUsMastersOrHigher" },
    {
      path: "employee.education.usInstitutionName",
      label: "US Institution Name",
      section: "employee",
      masterDataPath: "employee.education.usInstitutionName",
      condition: { field: "employee.education.hasUsMastersOrHigher", operator: "equals", value: "yes" },
    },
    {
      path: "employee.education.degreeAwardDate",
      label: "Degree Award Date",
      section: "employee",
      masterDataPath: "employee.education.degreeAwardDate",
      condition: { field: "employee.education.hasUsMastersOrHigher", operator: "equals", value: "yes" },
    },
    {
      path: "employee.education.degreeType",
      label: "Degree Type",
      section: "employee",
      masterDataPath: "employee.education.degreeType",
      condition: { field: "employee.education.hasUsMastersOrHigher", operator: "equals", value: "yes" },
    },
    {
      path: "employee.education.institutionAddress",
      label: "Institution Address",
      section: "employee",
      masterDataPath: "employee.education.institutionAddress",
      condition: { field: "employee.education.hasUsMastersOrHigher", operator: "equals", value: "yes" },
    },
    { path: "employee.immigrationHistory.hasValidPassport", label: "Has Valid Passport", section: "employee" },
    { path: "employee.immigrationHistory.hasH4Dependents", label: "Has H-4 Dependents", section: "employee" },
    {
      path: "employee.immigrationHistory.numberOfDependents",
      label: "Number of Dependents",
      section: "employee",
      condition: { field: "employee.immigrationHistory.hasH4Dependents", operator: "equals", value: "yes" },
    },
    { path: "employee.immigrationHistory.inRemovalProceedings", label: "In Removal Proceedings", section: "employee" },
    { path: "employee.immigrationHistory.employerFiledGreenCard", label: "Employer Filed Green Card", section: "employee" },
    { path: "employee.immigrationHistory.heldH1bLastSevenYears", label: "Held H-1B Last Seven Years", section: "employee" },
    { path: "employee.immigrationHistory.deniedH1bLastSevenYears", label: "Denied H-1B Last Seven Years", section: "employee" },
    {
      path: "employee.immigrationHistory.h1bDenialExplanation",
      label: "Please explain",
      section: "employee",
      type: "textarea",
      condition: { field: "employee.immigrationHistory.deniedH1bLastSevenYears", operator: "equals", value: "yes" },
    },
    // Cap-registration fields (Phase H6) - only asked/required for a
    // New/cap filing, same gate as filingCapType above.
    {
      path: "employee.capRegistration.beneficiaryConfirmationNumber",
      label: "Beneficiary Confirmation Number",
      section: "employee",
      required: true,
      condition: { field: "employee.filingType", operator: "equals", value: "New H1B" },
    },
    {
      path: "employee.capRegistration.passportNumber",
      label: "Passport Number Used at Registration",
      section: "employee",
      required: true,
      condition: { field: "employee.filingType", operator: "equals", value: "New H1B" },
    },
    {
      path: "employee.capRegistration.passportCountry",
      label: "Passport Country Used at Registration",
      section: "employee",
      required: true,
      condition: { field: "employee.filingType", operator: "equals", value: "New H1B" },
    },
    {
      path: "employee.capRegistration.passportExpirationDate",
      label: "Passport Expiration Date Used at Registration",
      section: "employee",
      required: true,
      condition: { field: "employee.filingType", operator: "equals", value: "New H1B" },
    },
    { path: "employee.previousHLStatusHistory", label: "Previous H/L Status History", section: "employee", repeatable: true },
    {
      // Same masterDataPath-collision fix as the education fields above:
      // sectionTitleFor("employee.dependents") resolves to a "Dependents"
      // section, which inferMasterDataPath's sectionMap maps to the
      // top-level `dependents` slot buildMasterCaseData pre-seeds as an
      // ARRAY - without an explicit override, saving an employee_dependents
      // answer crashes the same way ("Cannot create field
      // 'employee_dependents' in element {dependents: []}"), confirmed
      // empirically via h6-conditional-forms.test.js.
      path: "employee.dependents",
      label: "Dependents",
      section: "employee",
      repeatable: true,
      masterDataPath: "questionnaire.dependents",
      condition: { field: "employee.immigrationHistory.hasH4Dependents", operator: "equals", value: "yes" },
    },
  ];
}

module.exports = {
  key,
  matches,
  employerDocuments,
  employeeDocuments,
  dependentDocuments,
  normalizeEmployer,
  normalizeEmployee,
  employerConditionalDocuments,
  fieldCatalog,
};
