const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const EMPLOYER_FIELD_GROUPS = [
  {
    label: "LCA Readiness",
    fields: [
      { path: "isFirstLca", label: "First LCA filing for this company?", type: "select", options: YES_NO },
      { path: "dolVerificationCompleted", label: "DOL company verification completed?", type: "select", options: YES_NO },
      { path: "feinProofDocumentReference", label: "FEIN proof document reference" },
    ],
  },
  {
    label: "Company",
    fields: [
      { path: "legalName", label: "Legal company name" },
      { path: "dbaName", label: "DBA (if any)" },
      { path: "ein", label: "FEIN / EIN" },
      { path: "businessType", label: "Type of business" },
      { path: "businessWebsite", label: "Company website", type: "url" },
      { path: "yearEstablished", label: "Year established", type: "number" },
      { path: "naicsCode", label: "NAICS code" },
      { path: "numberOfEmployees", label: "Total employees on U.S. payroll", type: "number" },
      { path: "numberOfH1BWorkers", label: "Employees on H-1B", type: "number" },
      { path: "numberOfH1BL1Workers", label: "Employees on H-1B, L-1A, and L-1B", type: "number" },
      { path: "businessDescription", label: "Business description", type: "textarea", span: "full" },
    ],
  },
  {
    label: "Company Address",
    fields: [
      { path: "address.street", label: "Street address" },
      { path: "address.street2", label: "Suite / unit" },
      { path: "address.city", label: "City" },
      { path: "address.county", label: "County" },
      { path: "address.state", label: "State" },
      { path: "address.zipCode", label: "ZIP code" },
      { path: "address.country", label: "Country" },
    ],
  },
  {
    label: "Contact",
    fields: [
      { path: "contact.name", label: "Employer contact name" },
      { path: "contact.title", label: "Employer contact title" },
      { path: "contact.phone", label: "Daytime phone" },
      { path: "contact.fax", label: "Fax number" },
      { path: "contact.email", label: "Contact email", type: "email" },
    ],
  },
  {
    label: "Signing Authority",
    fields: [
      { path: "authorizedRepresentative.firstName", label: "Signing person first name" },
      { path: "authorizedRepresentative.lastName", label: "Signing person last name" },
      { path: "authorizedRepresentative.title", label: "Signing person title" },
      { path: "authorizedRepresentative.email", label: "Signing person email", type: "email" },
      { path: "authorizedRepresentative.phone", label: "Signing person mobile phone" },
    ],
  },
  {
    label: "Offered Position",
    fields: [
      { path: "offeredPosition.jobTitle", label: "Employee job title as per offer letter" },
      { path: "offeredPosition.salary", label: "Employee salary as per offer letter" },
      { path: "offeredPosition.startDate", label: "Start date of employment", type: "date" },
      { path: "offeredPosition.endClientName", label: "End client name" },
      { path: "offeredPosition.jobDescription", label: "Job description and responsibilities", type: "textarea", span: "full" },
    ],
  },
  {
    label: "Work Location",
    fields: [
      { path: "workSiteAddress.companyName", label: "Company / end client at worksite" },
      { path: "workSiteAddress.street", label: "Street address" },
      { path: "workSiteAddress.city", label: "City" },
      { path: "workSiteAddress.county", label: "County" },
      { path: "workSiteAddress.state", label: "State" },
      { path: "workSiteAddress.zipCode", label: "ZIP code" },
      { path: "additionalWorkSites", label: "Additional worksites", type: "textarea", span: "full" },
    ],
  },
  {
    label: "Financials and Company Documents",
    fields: [
      { path: "netAnnualIncome", label: "Net income" },
      { path: "grossAnnualIncome", label: "Gross annual income" },
      { path: "businessLicenseReference", label: "Business license document reference" },
      { path: "stateIncorporationReference", label: "Articles of incorporation reference" },
      { path: "companyLetterheadReference", label: "Company letterhead document reference" },
      { path: "irsDocumentReference", label: "IRS FEIN assignment document reference" },
    ],
  },
];

export const EMPLOYEE_FIELD_GROUPS = [
  {
    label: "H-1B Filing Type",
    fields: [
      {
        path: "h1bClassification",
        label: "Applying for",
        type: "select",
        options: ["New H-1B Regular Cap", "New H-1B Master's Cap", "Extension", "Transfer", "Amendment", "Concurrent"],
      },
      { path: "capSelectionNoticeReference", label: "H-1B CAP selection notice reference" },
    ],
  },
  {
    label: "Identity",
    fields: [
      { path: "firstName", label: "First name" },
      { path: "middleName", label: "Middle name" },
      { path: "lastName", label: "Last name" },
      { path: "otherNamesUsed", label: "All other names used", type: "textarea", span: "full" },
      { path: "dateOfBirth", label: "Date of birth", type: "date" },
      { path: "countryOfBirth", label: "Country of birth" },
      { path: "stateProvinceOfBirth", label: "Province / state of birth" },
      { path: "countryOfCitizenship", label: "Country of citizenship" },
      { path: "socialSecurityNumber", label: "Social Security Number" },
      { path: "alienRegistrationNumber", label: "A-Number" },
      { path: "priorPetitionNumber", label: "Latest prior petition number" },
      { path: "sevisId", label: "SEVIS number" },
    ],
  },
  {
    label: "Contact and Current U.S. Address",
    fields: [
      { path: "email", label: "Email", type: "email" },
      { path: "phone", label: "Phone" },
      { path: "currentAddress.street", label: "Street address" },
      { path: "currentAddress.street2", label: "Apartment / unit" },
      { path: "currentAddress.city", label: "City" },
      { path: "currentAddress.state", label: "State" },
      { path: "currentAddress.zipCode", label: "ZIP code" },
      { path: "currentAddress.country", label: "Country" },
    ],
  },
  {
    label: "U.S. Status",
    fields: [
      { path: "lastArrivalDate", label: "Date of last arrival", type: "date" },
      { path: "i94Number", label: "I-94 number" },
      { path: "currentVisaStatus", label: "Current visa status" },
      { path: "currentVisaExpiry", label: "Date status expires", type: "date" },
    ],
  },
  {
    label: "Passport",
    fields: [
      { path: "hasValidPassport", label: "Valid passport?", type: "select", options: YES_NO },
      { path: "passport.number", label: "Passport number" },
      { path: "passport.country", label: "Issuing country" },
      { path: "passport.issueDate", label: "Issue date", type: "date" },
      { path: "passport.expirationDate", label: "Expiration date", type: "date" },
      { path: "passport.placeOfIssue", label: "Place of issue" },
    ],
  },
  {
    label: "Consular Processing / Foreign Address",
    fields: [
      { path: "consulateLocation", label: "U.S. consulate city and country" },
      { path: "foreignAddress.street", label: "Foreign street address" },
      { path: "foreignAddress.street2", label: "Foreign apartment / unit" },
      { path: "foreignAddress.city", label: "Foreign city" },
      { path: "foreignAddress.state", label: "Foreign state / province" },
      { path: "foreignAddress.zipCode", label: "Foreign postal code" },
      { path: "foreignAddress.country", label: "Foreign country" },
    ],
  },
  {
    label: "Education",
    fields: [
      { path: "highestEducationLevel", label: "Highest level of education" },
      { path: "primaryFieldOfStudy", label: "Major / primary field of study" },
      { path: "usAdvancedDegree.hasDegree", label: "U.S. master's or higher degree?", type: "select", options: YES_NO },
      { path: "usAdvancedDegree.institutionName", label: "U.S. institution name" },
      { path: "usAdvancedDegree.degreeAwardedDate", label: "Date degree awarded", type: "date" },
      { path: "usAdvancedDegree.degreeType", label: "Type of U.S. degree" },
      { path: "usAdvancedDegree.institutionAddress", label: "U.S. institution address", type: "textarea", span: "full" },
    ],
  },
  {
    label: "Family, I-94, and Background",
    fields: [
      { path: "replaceI94", label: "Intend to replace I-94?", type: "select", options: YES_NO },
      { path: "hasDependents", label: "Dependents filing H-4?", type: "select", options: YES_NO },
      { path: "dependentCount", label: "Number of dependents", type: "number" },
      { path: "inRemovalProceedings", label: "Any person in removal proceedings?", type: "select", options: YES_NO },
      { path: "priorImmigrantPetitionByCompany", label: "Company filed immigrant petition before?", type: "select", options: YES_NO },
      { path: "priorH1BInLastSevenYears", label: "H-1B held in last 7 years?", type: "select", options: YES_NO },
      { path: "h1bDeniedInLastSevenYears", label: "H-1B denied in last 7 years?", type: "select", options: YES_NO },
      { path: "h1bDenialExplanation", label: "H-1B denial explanation", type: "textarea", span: "full" },
    ],
  },
  {
    label: "Prior H/L Stay",
    fields: [
      { path: "priorHLStayHistory", label: "Prior H-1B/L-1 periods in the U.S. for last 6 years", type: "textarea", span: "full" },
    ],
  },
  {
    label: "Position",
    fields: [
      { path: "positionTitle", label: "Job title" },
      { path: "startDate", label: "Start date", type: "date" },
    ],
  },
  {
    label: "Employee Documents",
    fields: [
      { path: "documentReferences.academicCertificates", label: "Academic certificates / transcripts reference" },
      { path: "documentReferences.credentialEvaluation", label: "Credential evaluation report reference" },
      { path: "documentReferences.trainingCertificates", label: "Training / diploma certificates reference" },
      { path: "documentReferences.resume", label: "Updated resume reference" },
      { path: "documentReferences.experienceLetters", label: "Previous work experience letters reference" },
      { path: "documentReferences.priorI797", label: "All prior I-797 notices reference" },
      { path: "documentReferences.i20F1Notices", label: "I-20 / F-1 approval notices reference" },
      { path: "documentReferences.i94", label: "I-94 record reference" },
      { path: "documentReferences.passport", label: "Passport copy reference" },
      { path: "documentReferences.ssn", label: "Signed SSN copy reference" },
      { path: "documentReferences.driverLicense", label: "Driver license / state ID reference" },
      { path: "documentReferences.recentPayslips", label: "Recent 3 months payslips reference" },
      { path: "documentReferences.dependentDocuments", label: "Dependent documents reference", type: "textarea", span: "full" },
    ],
  },
];
