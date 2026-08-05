const { clean } = require("./shared");

const key = "l1a";

function matches(value) {
  return /l[\s-]?1a\b/i.test(String(value || ""));
}

// Petitioner (employer) checklist for L-1A — "Documents from the U.S. Company".
const US_COMPANY_DOCUMENTS = [
  { name: "Articles of Incorporation", documentType: "us_articles_of_incorporation", description: "Formation documents for the U.S. petitioning entity." },
  { name: "EIN Assignment Letter", documentType: "ein_assignment_letter", description: "EIN assignment letter issued by the Internal Revenue Service." },
  { name: "Statement of Information", documentType: "us_statement_of_information", description: "State-filed Statement of Information for the U.S. entity." },
  { name: "Business License", documentType: "us_business_license", description: "Current business license for the U.S. entity." },
  { name: "Lease", documentType: "us_lease_agreement", description: "Lease agreement for the U.S. business premises." },
  { name: "Business Premises Photographs", documentType: "us_business_premises_photographs", description: "Interior and exterior photographs showing company name, logo, address, and personnel at work in major work areas." },
  { name: "Company Website", documentType: "us_company_website", description: "Printout or screenshot of the U.S. company website." },
  { name: "Brochure", documentType: "us_company_brochure", description: "U.S. company marketing brochure." },
  { name: "Commercial Contracts / Invoices / Bills of Lading / Letters of Credit", documentType: "us_commercial_transaction_documents", description: "Evidence of ongoing U.S. business activity." },
  { name: "Recently Filed Federal Tax Return", documentType: "us_federal_tax_return", description: "Most recently filed federal tax return for the U.S. entity." },
  { name: "Recent Bank Statements", documentType: "us_bank_statements", description: "Recent bank statements for the U.S. entity." },
  { name: "Business Plan", documentType: "us_business_plan", description: "U.S. entity business plan." },
  // Source item 13 of 16 — listed unconditionally, in this exact position,
  // between Business Plan and Organizational Chart. Visibility is narrowed
  // to ownership-based relationships (see employerConditionalDocuments
  // below) as a documented judgment call, not a source instruction: a
  // Branch is the same legal entity as the foreign company, so there is no
  // separate "stock" to hold evidence of. Flagged for sign-off.
  { name: "Stock Ownership Certificates", documentType: "us_stock_ownership_certificates", description: "Evidence of stock ownership establishing the qualifying relationship (not applicable for a Branch relationship)." },
  { name: "Organizational Chart", documentType: "us_organizational_chart", description: "Org chart including subordinate staff reporting to the beneficiary, with subordinate staff resumes attached." },
  { name: "Letter Describing Beneficiary's Duties", documentType: "us_beneficiary_duties_letter", description: "Letter from an authorized representative of the U.S. entity describing the beneficiary's expected duties, specifying which duties are performed by subordinate staff so the beneficiary is relieved to do solely managerial work." },
  { name: "Company Letterhead (Microsoft Word format)", documentType: "us_company_letterhead", description: "U.S. company letterhead as an editable .docx file." },
];

// Convenience alias so employmentChecklists.js's conditional-visibility logic
// (and employerConditionalDocuments below) can reference this specific
// document without re-deriving it from the array by index.
const STOCK_OWNERSHIP_CERTIFICATES_DOCUMENT = US_COMPANY_DOCUMENTS.find((doc) => doc.documentType === "us_stock_ownership_certificates");

// Petitioner (employer) checklist for L-1A — "Documents from the Foreign (outside U.S.) Company".
const FOREIGN_COMPANY_DOCUMENTS = [
  { name: "Business Registration Documents", documentType: "foreign_business_registration", description: "Registration/incorporation documents for the foreign entity." },
  { name: "Lease", documentType: "foreign_lease_agreement", description: "Lease agreement for the foreign business premises." },
  { name: "Business Premises Photographs", documentType: "foreign_business_premises_photographs", description: "Interior and exterior photographs showing company name, logo, address, and personnel at work in major work areas." },
  { name: "Company Website", documentType: "foreign_company_website", description: "Printout or screenshot of the foreign company website." },
  { name: "Brochure", documentType: "foreign_company_brochure", description: "Foreign company marketing brochure." },
  { name: "Business Transaction Documents", documentType: "foreign_business_transaction_documents", description: "Contracts, bills of lading, letters of credit, and similar records of business activity." },
  { name: "Recently Filed Tax Returns", documentType: "foreign_tax_returns", description: "Most recently filed tax returns for the foreign entity." },
  { name: "Recent Bank Statements", documentType: "foreign_bank_statements", description: "Recent bank statements for the foreign entity." },
  { name: "Relationship Evidence (U.S. & Foreign Companies)", documentType: "us_foreign_relationship_evidence", description: "Documents showing the relationship between the U.S. and foreign companies." },
  { name: "Offer Letter", documentType: "beneficiary_offer_letter", description: "Signed offer letter for the beneficiary." },
  { name: "Pay Stubs (Continuous Year)", documentType: "beneficiary_foreign_pay_stubs", description: "Beneficiary's foreign pay stubs covering one continuous year." },
  { name: "Minutes of the Meeting of the Directors", documentType: "minutes_dispatching_beneficiary", description: "Extract from the Minutes of the Meeting of the Directors, or other official documentation, regarding dispatching the beneficiary to the U.S. for management purposes." },
  { name: "Beneficiary Correspondence Evidence", documentType: "beneficiary_correspondence_evidence", description: "Copies of emails, memos, letters, and other dispatches from the beneficiary (while abroad) showing them supervising/controlling subordinate staff, hiring/firing or recommending personnel actions, issuing day-to-day operational orders, and performance reviews for subordinate staff over one continuous year." },
  { name: "Letterhead (Microsoft Word format)", documentType: "foreign_company_letterhead", description: "Foreign company letterhead as an editable .docx file." },
];

// Source's foreign-documents item 13 ("Detailed Managerial Duties at foreign
// entity as per following sections and % of each: a-d") is a percentage
// breakdown, not a file upload, so it isn't in FOREIGN_COMPANY_DOCUMENTS
// above — employmentChecklists.js renders these 4 as number questions
// positioned between item 12 (Minutes of the Meeting) and item 14
// (Beneficiary Correspondence Evidence), matching the source's exact
// position for this item.
const MANAGERIAL_DUTY_BREAKDOWN_FIELDS = [
  { key: "managesOrgPercent", label: "Manages a corporation, department, subdivision, or function (%)" },
  { key: "supervisesStaffPercent", label: "Supervises and controls the work of other supervisory, professional, or managerial employees, or else manages essential functions (%)" },
  { key: "hiringFiringAuthorityPercent", label: "Has the authority to make personal decisions as to hiring and termination, or else function at a senior level (%)" },
  { key: "discretionOverOperationsPercent", label: "Exercises discretion over the day to day operations of the activity or function for which he or she has authority (%)" },
];

const employerDocuments = [
  ...US_COMPANY_DOCUMENTS.map((doc) => ({ ...doc, required: true, category: "us_business", targetRole: "employer", status: "requested" })),
  ...FOREIGN_COMPANY_DOCUMENTS.map((doc) => ({ ...doc, required: true, category: "foreign_business", targetRole: "employer", status: "requested" })),
];

const employeeDocuments = [
  { name: "Passport", documentType: "passport", description: "Biographic passport pages.", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Updated Resume", documentType: "updated_resume", description: "Current resume covering the qualifying foreign employment.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Foreign Employer Organizational Chart", documentType: "foreign_employer_org_chart", description: "Org chart or role verification letter from the foreign qualifying organization.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Foreign Employment Verification Letter", documentType: "foreign_employment_verification_letter", description: "Letter confirming title, dates, and duties of the qualifying foreign employment.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "All Previous I-797 Approval / Receipt Notices", documentType: "previous_i797_notices", description: "Prior USCIS approval or receipt notices, if any.", required: false, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Last 3 Months Pay Slips", documentType: "last_3_months_pay_slips", description: "Recent pay slips from the last three months.", required: true, category: "employment", targetRole: "employee", status: "requested" },
];

const RELATIONSHIP_TYPES = ["Parent", "Branch", "Subsidiary", "Affiliate", "Joint Venture"];
const SALARY_UNITS = ["Hour", "Week", "Bi-weekly", "Month", "Year"];
const ENTITY_TYPES_INDIA = ["Pvt Ltd", "LLP", "Partnership", "Proprietorship"];
const ENTITY_TYPES_US = ["LLC", "C-Corp", "S-Corp", "Inc."];

// Shown once, above every section of the business plan checklist.
const BUSINESS_PLAN_INTRO = "Kindly complete every section of this checklist to the best of your knowledge. The accuracy and completeness of this information directly impacts the strength of your L1A business plan and supporting documentation. If a particular field does not apply, please write \"N/A\".";

const emptyShareholder = () => ({ name: "", percentage: "", role: "" });

// L1A Visa – Business Plan Checklist. Assigned to the employer alongside the
// petitioner checklist for every L-1A case — same save action, same
// employer-side questionnaire.
function normalizeBusinessPlan(payload = {}) {
  const foreignParentCompanyIn = payload.foreignParentCompany || {};
  const usCompanyIn = payload.usCompany || {};
  const executiveProfileIn = payload.executiveProfile || {};
  const marketAnalysisIn = payload.marketAnalysis || {};
  const shareholders = Array.isArray(foreignParentCompanyIn.shareholders) && foreignParentCompanyIn.shareholders.length
    ? foreignParentCompanyIn.shareholders.map((item) => ({ ...emptyShareholder(), ...item }))
    : [emptyShareholder(), emptyShareholder(), emptyShareholder(), emptyShareholder()];

  return {
    // 1. Foreign Parent Company Details
    foreignParentCompany: {
      // 1.1 Company Identity
      legalName: clean(foreignParentCompanyIn.legalName),
      brandName: clean(foreignParentCompanyIn.brandName),
      entityType: clean(foreignParentCompanyIn.entityType),
      dateOfIncorporation: foreignParentCompanyIn.dateOfIncorporation || "",
      cinLlpin: clean(foreignParentCompanyIn.cinLlpin),
      gstin: clean(foreignParentCompanyIn.gstin),
      pan: clean(foreignParentCompanyIn.pan),
      industrySector: clean(foreignParentCompanyIn.industrySector),
      website: clean(foreignParentCompanyIn.website),
      officialEmail: clean(foreignParentCompanyIn.officialEmail),
      officialPhone: clean(foreignParentCompanyIn.officialPhone),
      // 1.2 Registered & Operating Addresses
      registeredOfficeAddress: clean(foreignParentCompanyIn.registeredOfficeAddress),
      headOfficeAddress: clean(foreignParentCompanyIn.headOfficeAddress),
      branchAddresses: clean(foreignParentCompanyIn.branchAddresses),
      premisesOwnedOrLeased: clean(foreignParentCompanyIn.premisesOwnedOrLeased),
      officeAreaSqFt: foreignParentCompanyIn.officeAreaSqFt ?? "",
      // 1.3 Ownership & Shareholding Structure
      totalAuthorizedCapital: foreignParentCompanyIn.totalAuthorizedCapital ?? "",
      totalPaidUpCapital: foreignParentCompanyIn.totalPaidUpCapital ?? "",
      shareholders,
      additionalShareholders: clean(foreignParentCompanyIn.additionalShareholders),
      directors: clean(foreignParentCompanyIn.directors),
      ultimateBeneficialOwner: clean(foreignParentCompanyIn.ultimateBeneficialOwner),
      // 1.4 Workforce & Organizational Strength
      totalEmployees: foreignParentCompanyIn.totalEmployees ?? "",
      fullTimeEmployees: foreignParentCompanyIn.fullTimeEmployees ?? "",
      partTimeEmployees: foreignParentCompanyIn.partTimeEmployees ?? "",
      numberOfManagers: foreignParentCompanyIn.numberOfManagers ?? "",
      numberOfSupervisors: foreignParentCompanyIn.numberOfSupervisors ?? "",
      numberOfOperationalStaff: foreignParentCompanyIn.numberOfOperationalStaff ?? "",
      departmentTeamSizes: clean(foreignParentCompanyIn.departmentTeamSizes),
      reportingStructure: clean(foreignParentCompanyIn.reportingStructure),
      // 1.5 Financial Performance & Turnover
      turnoverLastFY: foreignParentCompanyIn.turnoverLastFY ?? "",
      turnoverFYBeforeLast: foreignParentCompanyIn.turnoverFYBeforeLast ?? "",
      turnoverThreeYearsAgo: foreignParentCompanyIn.turnoverThreeYearsAgo ?? "",
      netProfitLast3Years: clean(foreignParentCompanyIn.netProfitLast3Years),
      totalAssets: foreignParentCompanyIn.totalAssets ?? "",
      totalLiabilities: foreignParentCompanyIn.totalLiabilities ?? "",
      banks: clean(foreignParentCompanyIn.banks),
      existingLoans: clean(foreignParentCompanyIn.existingLoans),
      proposedUsInvestment: foreignParentCompanyIn.proposedUsInvestment ?? "",
      // 1.6 Products, Services & Operations in India
      productsOffered: clean(foreignParentCompanyIn.productsOffered),
      servicesOffered: clean(foreignParentCompanyIn.servicesOffered),
      primaryRevenueProduct: clean(foreignParentCompanyIn.primaryRevenueProduct),
      deliveryModel: clean(foreignParentCompanyIn.deliveryModel),
      keyClients: clean(foreignParentCompanyIn.keyClients),
      keySuppliers: clean(foreignParentCompanyIn.keySuppliers),
      certifications: clean(foreignParentCompanyIn.certifications),
      awards: clean(foreignParentCompanyIn.awards),
      usp: clean(foreignParentCompanyIn.usp),
    },
    // 2. U.S. Company Details
    usCompany: {
      // 2.1 U.S. Entity Identity
      legalName: clean(usCompanyIn.legalName),
      stateOfIncorporation: clean(usCompanyIn.stateOfIncorporation),
      dateOfIncorporation: usCompanyIn.dateOfIncorporation || "",
      entityType: clean(usCompanyIn.entityType),
      ein: clean(usCompanyIn.ein),
      registeredAgent: clean(usCompanyIn.registeredAgent),
      officeAddress: clean(usCompanyIn.officeAddress),
      premisesType: clean(usCompanyIn.premisesType),
      officeSizeSqFt: usCompanyIn.officeSizeSqFt ?? "",
      leaseTerm: clean(usCompanyIn.leaseTerm),
      website: clean(usCompanyIn.website),
      contactEmail: clean(usCompanyIn.contactEmail),
      contactPhone: clean(usCompanyIn.contactPhone),
      // 2.2 Ownership & Corporate Relationship
      relationshipType: clean(usCompanyIn.relationshipType),
      percentOwnedByParent: usCompanyIn.percentOwnedByParent ?? "",
      otherShareholders: clean(usCompanyIn.otherShareholders),
      totalAuthorizedShares: usCompanyIn.totalAuthorizedShares ?? "",
      sharesIssued: usCompanyIn.sharesIssued ?? "",
      capitalInvested: usCompanyIn.capitalInvested ?? "",
      additionalCapitalPlanned: usCompanyIn.additionalCapitalPlanned ?? "",
      directorsManagers: clean(usCompanyIn.directorsManagers),
      proofOfOwnershipAvailable: clean(usCompanyIn.proofOfOwnershipAvailable),
      // 2.3 Services / Products Offered by the U.S. Company
      exactServices: clean(usCompanyIn.exactServices),
      productsSold: clean(usCompanyIn.productsSold),
      sameAsIndiaOrDifferent: clean(usCompanyIn.sameAsIndiaOrDifferent),
      targetIndustries: clean(usCompanyIn.targetIndustries),
      targetCustomerProfile: clean(usCompanyIn.targetCustomerProfile),
      geographicMarkets: clean(usCompanyIn.geographicMarkets),
      serviceDeliveryModel: clean(usCompanyIn.serviceDeliveryModel),
      pricingModel: clean(usCompanyIn.pricingModel),
      differentiators: clean(usCompanyIn.differentiators),
      existingProspectiveClients: clean(usCompanyIn.existingProspectiveClients),
      hasLoiMouContracts: usCompanyIn.hasLoiMouContracts || "",
      // 2.4 U.S. Workforce – Current & Projected
      currentUsEmployees: usCompanyIn.currentUsEmployees ?? "",
      currentEmployeeNamesRoles: clean(usCompanyIn.currentEmployeeNamesRoles),
      hiringNext6Months: clean(usCompanyIn.hiringNext6Months),
      hiringYear1: clean(usCompanyIn.hiringYear1),
      hiringYear2: clean(usCompanyIn.hiringYear2),
      hiringYear3: clean(usCompanyIn.hiringYear3),
      managerialPositionsPlanned: usCompanyIn.managerialPositionsPlanned ?? "",
      professionalPositionsPlanned: usCompanyIn.professionalPositionsPlanned ?? "",
      subordinateStaffForExecutive: clean(usCompanyIn.subordinateStaffForExecutive),
      // 2.5 U.S. Financial Plan & Turnover Projection
      totalInitialCapitalUsd: usCompanyIn.totalInitialCapitalUsd ?? "",
      sourceOfFunding: clean(usCompanyIn.sourceOfFunding),
      projectedRevenueYear1: usCompanyIn.projectedRevenueYear1 ?? "",
      projectedRevenueYear2: usCompanyIn.projectedRevenueYear2 ?? "",
      projectedRevenueYear3: usCompanyIn.projectedRevenueYear3 ?? "",
      projectedRevenueYear4: usCompanyIn.projectedRevenueYear4 ?? "",
      projectedRevenueYear5: usCompanyIn.projectedRevenueYear5 ?? "",
      estimatedPayrollCostYear1: usCompanyIn.estimatedPayrollCostYear1 ?? "",
      estimatedOperationalCostYear1: usCompanyIn.estimatedOperationalCostYear1 ?? "",
      breakEvenTimeline: clean(usCompanyIn.breakEvenTimeline),
    },
    // 3. L1A Executive / Beneficiary Profile
    executiveProfile: {
      fullLegalName: clean(executiveProfileIn.fullLegalName),
      designationIndia: clean(executiveProfileIn.designationIndia),
      proposedDesignationUs: clean(executiveProfileIn.proposedDesignationUs),
      dateOfJoiningIndianCompany: executiveProfileIn.dateOfJoiningIndianCompany || "",
      totalYearsExperience: executiveProfileIn.totalYearsExperience ?? "",
      educationalQualifications: clean(executiveProfileIn.educationalQualifications),
      keyResponsibilitiesIndia: clean(executiveProfileIn.keyResponsibilitiesIndia),
      directReportsIndia: executiveProfileIn.directReportsIndia ?? "",
      departmentsManaged: clean(executiveProfileIn.departmentsManaged),
      majorAchievements: clean(executiveProfileIn.majorAchievements),
      decisionMakingAuthority: clean(executiveProfileIn.decisionMakingAuthority),
      proposedResponsibilitiesUs: clean(executiveProfileIn.proposedResponsibilitiesUs),
      leadershipImpact: clean(executiveProfileIn.leadershipImpact),
    },
    // 4. Market, Competition & Growth Strategy
    marketAnalysis: {
      industrySizeTrends: clean(marketAnalysisIn.industrySizeTrends),
      topCompetitors: clean(marketAnalysisIn.topCompetitors),
      indirectCompetitors: clean(marketAnalysisIn.indirectCompetitors),
      whyUsMarket: clean(marketAnalysisIn.whyUsMarket),
      marketingSalesStrategy: clean(marketAnalysisIn.marketingSalesStrategy),
      strategicPartnershipsPlanned: clean(marketAnalysisIn.strategicPartnershipsPlanned),
      keyRisks: clean(marketAnalysisIn.keyRisks),
      riskMitigationPlan: clean(marketAnalysisIn.riskMitigationPlan),
    },
  };
}

const LOI_MOU_CONTRACTS_DOCUMENT = {
  name: "Letters of Intent / MOUs / Signed Contracts", documentType: "loi_mou_signed_contracts", description: "U.S. company's existing or prospective Letters of Intent, MOUs, or signed client contracts.",
};

function normalizeEmployer(payload = {}) {
  const workLocations = Array.isArray(payload.workLocations) && payload.workLocations.length
    ? payload.workLocations.map((location) => ({
      companyName: clean(location.companyName),
      street: clean(location.street),
      city: clean(location.city),
      state: clean(location.state),
      zipCode: clean(location.zipCode),
    }))
    : [{ companyName: "", street: "", city: "", state: "", zipCode: "" }];

  return {
    // Information about the US company
    usCompany: {
      name: clean(payload.usCompany?.name || payload.companyName),
      address: {
        street: clean(payload.usCompany?.address?.street || payload.companyStreet),
        city: clean(payload.usCompany?.address?.city || payload.companyCity),
        state: clean(payload.usCompany?.address?.state || payload.companyState),
        zipCode: clean(payload.usCompany?.address?.zipCode || payload.companyZipCode),
        country: clean(payload.usCompany?.address?.country || payload.companyCountry || "USA"),
      },
      fein: clean(payload.usCompany?.fein || payload.fein || payload.ein),
      businessType: clean(payload.usCompany?.businessType || payload.businessType),
      yearEstablished: payload.usCompany?.yearEstablished ?? payload.yearEstablished ?? "",
      totalUsEmployees: payload.usCompany?.totalUsEmployees ?? payload.totalUsEmployees ?? "",
      grossAnnualIncome: payload.usCompany?.grossAnnualIncome ?? payload.grossAnnualIncome ?? "",
      netAnnualIncome: payload.usCompany?.netAnnualIncome ?? payload.netAnnualIncome ?? "",
      website: clean(payload.usCompany?.website || payload.website),
    },
    signingPerson: {
      firstName: clean(payload.signingPerson?.firstName || payload.signingFirstName),
      lastName: clean(payload.signingPerson?.lastName || payload.signingLastName),
      title: clean(payload.signingPerson?.title || payload.signingTitle),
      email: clean(payload.signingPerson?.email || payload.signingEmail),
      mobilePhone: clean(payload.signingPerson?.mobilePhone || payload.signingMobilePhone),
    },
    // Information about the foreign company
    foreignCompany: {
      name: clean(payload.foreignCompany?.name || payload.foreignCompanyName),
      address: {
        street: clean(payload.foreignCompany?.address?.street || payload.foreignCompanyStreet),
        city: clean(payload.foreignCompany?.address?.city || payload.foreignCompanyCity),
        stateProvince: clean(payload.foreignCompany?.address?.stateProvince || payload.foreignCompanyStateProvince),
        zipPostalCode: clean(payload.foreignCompany?.address?.zipPostalCode || payload.foreignCompanyZipPostalCode),
        country: clean(payload.foreignCompany?.address?.country || payload.foreignCompanyCountry),
      },
      employmentStartDate: payload.foreignCompany?.employmentStartDate || payload.foreignEmploymentStartDate || "",
      employmentEndDate: payload.foreignCompany?.employmentEndDate || payload.foreignEmploymentEndDate || "",
      relationshipType: payload.foreignCompany?.relationshipType || payload.relationshipType || "",
      stockOwnershipPercentage: payload.foreignCompany?.stockOwnershipPercentage ?? payload.stockOwnershipPercentage ?? "",
      website: clean(payload.foreignCompany?.website || payload.foreignCompanyWebsite),
      // Beneficiary's managerial duties abroad, broken down by USCIS managerial-capacity
      // criteria — filled in as percentages rather than as a document upload.
      managerialDutiesBreakdown: {
        managesOrgPercent: payload.foreignCompany?.managerialDutiesBreakdown?.managesOrgPercent ?? payload.managesOrgPercent ?? "",
        supervisesStaffPercent: payload.foreignCompany?.managerialDutiesBreakdown?.supervisesStaffPercent ?? payload.supervisesStaffPercent ?? "",
        hiringFiringAuthorityPercent: payload.foreignCompany?.managerialDutiesBreakdown?.hiringFiringAuthorityPercent ?? payload.hiringFiringAuthorityPercent ?? "",
        discretionOverOperationsPercent: payload.foreignCompany?.managerialDutiesBreakdown?.discretionOverOperationsPercent ?? payload.discretionOverOperationsPercent ?? "",
      },
    },
    // Information about proposed employment in the USA
    position: {
      jobTitle: clean(payload.position?.jobTitle || payload.jobTitle),
      offeredSalary: payload.position?.offeredSalary ?? payload.offeredSalary ?? "",
      salaryUnit: payload.position?.salaryUnit || payload.salaryUnit || "",
      dutiesDescription: clean(payload.position?.dutiesDescription || payload.dutiesDescription),
    },
    endClient: {
      name: clean(payload.endClient?.name || payload.endClientName),
    },
    workLocations,
    // L1A Visa – Business Plan Checklist, assigned alongside this questionnaire.
    businessPlan: normalizeBusinessPlan(payload.businessPlan || {}),
  };
}

function employerConditionalDocuments(questionnaire) {
  return {
    // A Branch is the same legal entity as the foreign company — there's no
    // separate stock to hold evidence of, so only require this when the
    // relationship is ownership-based.
    stockOwnershipCertificatesRequired: Boolean(questionnaire.foreignCompany?.relationshipType) && questionnaire.foreignCompany.relationshipType !== "Branch",
    stockOwnershipCertificatesDocumentType: STOCK_OWNERSHIP_CERTIFICATES_DOCUMENT.documentType,
    // Business plan §2.3 — only relevant when the employer confirms they have
    // LOIs/MOUs/signed contracts to attach as supporting evidence.
    loiMouContractsRequired: questionnaire.businessPlan?.usCompany?.hasLoiMouContracts === "yes",
    loiMouContractsDocumentType: LOI_MOU_CONTRACTS_DOCUMENT.documentType,
  };
}

// L-1 Checklist for Beneficiary — "Information About YOU" + prior H/L stay history.
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
      heldL1ALastSevenYears: otherInfoIn.heldL1ALastSevenYears || payload.heldL1ALastSevenYears || "",
      deniedL1ALastSevenYears: otherInfoIn.deniedL1ALastSevenYears || payload.deniedL1ALastSevenYears || "",
      l1aDenialExplanation: clean(otherInfoIn.l1aDenialExplanation || payload.l1aDenialExplanation),
    },
    // Prior periods of stay in the U.S. in H/L classification, last 6 years.
    previousHLStatusHistory: Array.isArray(payload.previousHLStatusHistory) && payload.previousHLStatusHistory.length
      ? payload.previousHLStatusHistory.map((stay) => ({
        name: clean(stay.name),
        visaClassification: stay.visaClassification || "",
        arrivalDate: stay.arrivalDate || "",
        departureDate: stay.departureDate || "",
      }))
      : [{ name: "", visaClassification: "", arrivalDate: "", departureDate: "" }],
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
// understand (including the nested business plan), for the document-intelligence
// auto-fill matcher to target. Repeatable sub-documents (workLocations, shareholders,
// previousHLStatusHistory) are listed with repeatable:true and are surfaced for
// review only, not auto-written.
function fieldCatalog() {
  const entries = [
    { path: "employer.usCompany.name", label: "US Company Legal Name", section: "employer" },
    { path: "employer.usCompany.address.street", label: "US Company Address Street", section: "employer" },
    { path: "employer.usCompany.address.city", label: "US Company Address City", section: "employer" },
    { path: "employer.usCompany.address.state", label: "US Company Address State", section: "employer" },
    { path: "employer.usCompany.address.zipCode", label: "US Company Address Zip Code", section: "employer" },
    { path: "employer.usCompany.address.country", label: "US Company Address Country", section: "employer" },
    { path: "employer.usCompany.fein", label: "US Company FEIN", section: "employer" },
    { path: "employer.usCompany.businessType", label: "US Company Business Type", section: "employer" },
    { path: "employer.usCompany.yearEstablished", label: "US Company Year Established", section: "employer" },
    { path: "employer.usCompany.totalUsEmployees", label: "US Company Total US Employees", section: "employer" },
    { path: "employer.usCompany.grossAnnualIncome", label: "US Company Gross Annual Income", section: "employer" },
    { path: "employer.usCompany.netAnnualIncome", label: "US Company Net Annual Income", section: "employer" },
    { path: "employer.usCompany.website", label: "US Company Website", section: "employer" },
    { path: "employer.signingPerson.firstName", label: "Signing Person First Name", section: "employer" },
    { path: "employer.signingPerson.lastName", label: "Signing Person Last Name", section: "employer" },
    { path: "employer.signingPerson.title", label: "Signing Person Title", section: "employer" },
    { path: "employer.signingPerson.email", label: "Signing Person Email", section: "employer" },
    { path: "employer.signingPerson.mobilePhone", label: "Signing Person Mobile Phone", section: "employer" },
    { path: "employer.foreignCompany.name", label: "Foreign Company Name", section: "employer" },
    { path: "employer.foreignCompany.address.street", label: "Foreign Company Address Street", section: "employer" },
    { path: "employer.foreignCompany.address.city", label: "Foreign Company Address City", section: "employer" },
    { path: "employer.foreignCompany.address.stateProvince", label: "Foreign Company Address State/Province", section: "employer" },
    { path: "employer.foreignCompany.address.zipPostalCode", label: "Foreign Company Address Zip/Postal Code", section: "employer" },
    { path: "employer.foreignCompany.address.country", label: "Foreign Company Address Country", section: "employer" },
    { path: "employer.foreignCompany.employmentStartDate", label: "Foreign Employment Start Date", section: "employer" },
    { path: "employer.foreignCompany.employmentEndDate", label: "Foreign Employment End Date", section: "employer" },
    { path: "employer.foreignCompany.relationshipType", label: "US/Foreign Relationship Type", section: "employer" },
    { path: "employer.foreignCompany.stockOwnershipPercentage", label: "Stock Ownership Percentage", section: "employer" },
    { path: "employer.foreignCompany.website", label: "Foreign Company Website", section: "employer" },
    { path: "employer.position.jobTitle", label: "Job Title", section: "employer" },
    { path: "employer.position.offeredSalary", label: "Offered Salary", section: "employer" },
    { path: "employer.position.salaryUnit", label: "Salary Unit", section: "employer" },
    { path: "employer.position.dutiesDescription", label: "Duties Description", section: "employer" },
    // Source: "End Client name if applicable" — explicitly conditional.
    { path: "employer.endClient.name", label: "End Client Name", section: "employer", required: false },
    { path: "employer.workLocations", label: "Work Locations", section: "employer", repeatable: true },

    // Business Plan Checklist — Foreign Parent Company
    { path: "employer.businessPlan.foreignParentCompany.legalName", label: "Foreign Parent Company Legal Name", section: "employer" },
    // Source: "Brand / trading name (if different)" — explicitly conditional.
    { path: "employer.businessPlan.foreignParentCompany.brandName", label: "Foreign Parent Company Brand Name", section: "employer", required: false },
    { path: "employer.businessPlan.foreignParentCompany.entityType", label: "Foreign Parent Company Entity Type", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.dateOfIncorporation", label: "Foreign Parent Company Date of Incorporation", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.cinLlpin", label: "Foreign Parent Company CIN/LLPIN", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.gstin", label: "Foreign Parent Company GSTIN", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.pan", label: "Foreign Parent Company PAN", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.industrySector", label: "Forei gn Parent Company Industry Sector", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.website", label: "Foreign Parent Company Website", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.officialEmail", label: "Foreign Parent Company Official Email", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.officialPhone", label: "Foreign Parent Company Official Phone", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.registeredOfficeAddress", label: "Foreign Parent Company Registered Office Address", section: "employer" },
    // Source: "Head office address (if different)" — explicitly conditional.
    { path: "employer.businessPlan.foreignParentCompany.headOfficeAddress", label: "Foreign Parent Company Head Office Address", section: "employer", required: false },
    { path: "employer.businessPlan.foreignParentCompany.branchAddresses", label: "Foreign Parent Company Branch Addresses", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.premisesOwnedOrLeased", label: "Foreign Parent Company Premises Owned or Leased", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.officeAreaSqFt", label: "Foreign Parent Company Office Area (Sq Ft)", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.totalAuthorizedCapital", label: "Foreign Parent Company Total Authorized Capital", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.totalPaidUpCapital", label: "Foreign Parent Company Total Paid-Up Capital", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.shareholders", label: "Foreign Parent Company Shareholders", section: "employer", repeatable: true },
    // Source: "Additional shareholders (if any)" — explicitly conditional.
    { path: "employer.businessPlan.foreignParentCompany.additionalShareholders", label: "Foreign Parent Company Additional Shareholders", section: "employer", required: false },
    { path: "employer.businessPlan.foreignParentCompany.directors", label: "Foreign Parent Company Directors", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.ultimateBeneficialOwner", label: "Foreign Parent Company Ultimate Beneficial Owner", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.totalEmployees", label: "Foreign Parent Company Total Employees", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.fullTimeEmployees", label: "Foreign Parent Company Full-Time Employees", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.partTimeEmployees", label: "Foreign Parent Company Part-Time Employees", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.numberOfManagers", label: "Foreign Parent Company Number of Managers", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.numberOfSupervisors", label: "Foreign Parent Company Number of Supervisors", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.numberOfOperationalStaff", label: "Foreign Parent Company Number of Operational Staff", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.departmentTeamSizes", label: "Foreign Parent Company Department Team Sizes", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.reportingStructure", label: "Foreign Parent Company Reporting Structure", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.turnoverLastFY", label: "Foreign Parent Company Turnover Last FY", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.turnoverFYBeforeLast", label: "Foreign Parent Company Turnover FY Before Last", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.turnoverThreeYearsAgo", label: "Foreign Parent Company Turnover Three Years Ago", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.netProfitLast3Years", label: "Foreign Parent Company Net Profit Last 3 Years", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.totalAssets", label: "Foreign Parent Company Total Assets", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.totalLiabilities", label: "Foreign Parent Company Total Liabilities", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.banks", label: "Foreign Parent Company Banks", section: "employer" },
    // Source: "Existing loans / credit facilities (if any)" — explicitly conditional.
    { path: "employer.businessPlan.foreignParentCompany.existingLoans", label: "Foreign Parent Company Existing Loans", section: "employer", required: false },
    { path: "employer.businessPlan.foreignParentCompany.proposedUsInvestment", label: "Foreign Parent Company Proposed US Investment", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.productsOffered", label: "Foreign Parent Company Products Offered", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.servicesOffered", label: "Foreign Parent Company Services Offered", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.primaryRevenueProduct", label: "Foreign Parent Company Primary Revenue Product", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.deliveryModel", label: "Foreign Parent Company Delivery Model", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.keyClients", label: "Foreign Parent Company Key Clients", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.keySuppliers", label: "Foreign Parent Company Key Suppliers", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.certifications", label: "Foreign Parent Company Certifications", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.awards", label: "Foreign Parent Company Awards", section: "employer" },
    { path: "employer.businessPlan.foreignParentCompany.usp", label: "Foreign Parent Company USP", section: "employer" },

    // Business Plan Checklist — US Company
    { path: "employer.businessPlan.usCompany.legalName", label: "US Company Legal Name (Business Plan)", section: "employer" },
    { path: "employer.businessPlan.usCompany.stateOfIncorporation", label: "US Company State of Incorporation", section: "employer" },
    { path: "employer.businessPlan.usCompany.dateOfIncorporation", label: "US Company Date of Incorporation", section: "employer" },
    { path: "employer.businessPlan.usCompany.entityType", label: "US Company Entity Type", section: "employer" },
    { path: "employer.businessPlan.usCompany.ein", label: "US Company EIN", section: "employer" },
    { path: "employer.businessPlan.usCompany.registeredAgent", label: "US Company Registered Agent", section: "employer" },
    { path: "employer.businessPlan.usCompany.officeAddress", label: "US Company Office Address", section: "employer" },
    { path: "employer.businessPlan.usCompany.premisesType", label: "US Company Premises Type", section: "employer" },
    { path: "employer.businessPlan.usCompany.officeSizeSqFt", label: "US Company Office Size (Sq Ft)", section: "employer" },
    { path: "employer.businessPlan.usCompany.leaseTerm", label: "US Company Lease Term", section: "employer" },
    { path: "employer.businessPlan.usCompany.website", label: "US Company Website (Business Plan)", section: "employer" },
    { path: "employer.businessPlan.usCompany.contactEmail", label: "US Company Contact Email", section: "employer" },
    { path: "employer.businessPlan.usCompany.contactPhone", label: "US Company Contact Phone", section: "employer" },
    { path: "employer.businessPlan.usCompany.relationshipType", label: "US Company Relationship Type", section: "employer" },
    { path: "employer.businessPlan.usCompany.percentOwnedByParent", label: "US Company Percent Owned by Parent", section: "employer" },
    { path: "employer.businessPlan.usCompany.otherShareholders", label: "US Company Other Shareholders", section: "employer" },
    { path: "employer.businessPlan.usCompany.totalAuthorizedShares", label: "US Company Total Authorized Shares", section: "employer" },
    { path: "employer.businessPlan.usCompany.sharesIssued", label: "US Company Shares Issued", section: "employer" },
    { path: "employer.businessPlan.usCompany.capitalInvested", label: "US Company Capital Invested", section: "employer" },
    { path: "employer.businessPlan.usCompany.additionalCapitalPlanned", label: "US Company Additional Capital Planned", section: "employer" },
    { path: "employer.businessPlan.usCompany.directorsManagers", label: "US Company Directors/Managers", section: "employer" },
    { path: "employer.businessPlan.usCompany.proofOfOwnershipAvailable", label: "US Company Proof of Ownership Available", section: "employer" },
    { path: "employer.businessPlan.usCompany.exactServices", label: "US Company Exact Services", section: "employer" },
    { path: "employer.businessPlan.usCompany.productsSold", label: "US Company Products Sold", section: "employer" },
    { path: "employer.businessPlan.usCompany.sameAsIndiaOrDifferent", label: "US Company Same as Foreign Operations or Different", section: "employer" },
    { path: "employer.businessPlan.usCompany.targetIndustries", label: "US Company Target Industries", section: "employer" },
    { path: "employer.businessPlan.usCompany.targetCustomerProfile", label: "US Company Target Customer Profile", section: "employer" },
    { path: "employer.businessPlan.usCompany.geographicMarkets", label: "US Company Geographic Markets", section: "employer" },
    { path: "employer.businessPlan.usCompany.serviceDeliveryModel", label: "US Company Service Delivery Model", section: "employer" },
    { path: "employer.businessPlan.usCompany.pricingModel", label: "US Company Pricing Model", section: "employer" },
    { path: "employer.businessPlan.usCompany.differentiators", label: "US Company Differentiators", section: "employer" },
    { path: "employer.businessPlan.usCompany.existingProspectiveClients", label: "US Company Existing/Prospective Clients", section: "employer" },
    { path: "employer.businessPlan.usCompany.hasLoiMouContracts", label: "US Company Has LOI/MOU Contracts", section: "employer" },
    { path: "employer.businessPlan.usCompany.currentUsEmployees", label: "US Company Current US Employees", section: "employer" },
    { path: "employer.businessPlan.usCompany.currentEmployeeNamesRoles", label: "US Company Current Employee Names/Roles", section: "employer" },
    { path: "employer.businessPlan.usCompany.hiringNext6Months", label: "US Company Hiring Next 6 Months", section: "employer" },
    { path: "employer.businessPlan.usCompany.hiringYear1", label: "US Company Hiring Year 1", section: "employer" },
    { path: "employer.businessPlan.usCompany.hiringYear2", label: "US Company Hiring Year 2", section: "employer" },
    { path: "employer.businessPlan.usCompany.hiringYear3", label: "US Company Hiring Year 3", section: "employer" },
    { path: "employer.businessPlan.usCompany.managerialPositionsPlanned", label: "US Company Managerial Positions Planned", section: "employer" },
    { path: "employer.businessPlan.usCompany.professionalPositionsPlanned", label: "US Company Professional Positions Planned", section: "employer" },
    { path: "employer.businessPlan.usCompany.subordinateStaffForExecutive", label: "US Company Subordinate Staff for Executive", section: "employer" },
    { path: "employer.businessPlan.usCompany.totalInitialCapitalUsd", label: "US Company Total Initial Capital (USD)", section: "employer" },
    { path: "employer.businessPlan.usCompany.sourceOfFunding", label: "US Company Source of Funding", section: "employer" },
    { path: "employer.businessPlan.usCompany.projectedRevenueYear1", label: "US Company Projected Revenue Year 1", section: "employer" },
    { path: "employer.businessPlan.usCompany.projectedRevenueYear2", label: "US Company Projected Revenue Year 2", section: "employer" },
    { path: "employer.businessPlan.usCompany.projectedRevenueYear3", label: "US Company Projected Revenue Year 3", section: "employer" },
    { path: "employer.businessPlan.usCompany.projectedRevenueYear4", label: "US Company Projected Revenue Year 4", section: "employer" },
    { path: "employer.businessPlan.usCompany.projectedRevenueYear5", label: "US Company Projected Revenue Year 5", section: "employer" },
    { path: "employer.businessPlan.usCompany.estimatedPayrollCostYear1", label: "US Company Estimated Payroll Cost Year 1", section: "employer" },
    { path: "employer.businessPlan.usCompany.estimatedOperationalCostYear1", label: "US Company Estimated Operational Cost Year 1", section: "employer" },
    { path: "employer.businessPlan.usCompany.breakEvenTimeline", label: "US Company Break-Even Timeline", section: "employer" },

    // Business Plan Checklist — Executive Profile & Market Analysis
    { path: "employer.businessPlan.executiveProfile.fullLegalName", label: "Executive Full Legal Name", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.designationIndia", label: "Executive Designation (Foreign)", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.proposedDesignationUs", label: "Executive Proposed Designation (US)", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.dateOfJoiningIndianCompany", label: "Executive Date of Joining Foreign Company", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.totalYearsExperience", label: "Executive Total Years Experience", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.educationalQualifications", label: "Executive Educational Qualifications", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.keyResponsibilitiesIndia", label: "Executive Key Responsibilities (Foreign)", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.directReportsIndia", label: "Executive Direct Reports (Foreign)", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.departmentsManaged", label: "Executive Departments Managed", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.majorAchievements", label: "Executive Major Achievements", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.decisionMakingAuthority", label: "Executive Decision Making Authority", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.proposedResponsibilitiesUs", label: "Executive Proposed Responsibilities (US)", section: "employer" },
    { path: "employer.businessPlan.executiveProfile.leadershipImpact", label: "Executive Leadership Impact", section: "employer" },
    { path: "employer.businessPlan.marketAnalysis.industrySizeTrends", label: "Market Industry Size/Trends", section: "employer" },
    { path: "employer.businessPlan.marketAnalysis.topCompetitors", label: "Market Top Competitors", section: "employer" },
    { path: "employer.businessPlan.marketAnalysis.indirectCompetitors", label: "Market Indirect Competitors", section: "employer" },
    { path: "employer.businessPlan.marketAnalysis.whyUsMarket", label: "Market Why US Market", section: "employer" },
    { path: "employer.businessPlan.marketAnalysis.marketingSalesStrategy", label: "Market Marketing/Sales Strategy", section: "employer" },
    { path: "employer.businessPlan.marketAnalysis.strategicPartnershipsPlanned", label: "Market Strategic Partnerships Planned", section: "employer" },
    { path: "employer.businessPlan.marketAnalysis.keyRisks", label: "Market Key Risks", section: "employer" },
    { path: "employer.businessPlan.marketAnalysis.riskMitigationPlan", label: "Market Risk Mitigation Plan", section: "employer" },

    // Employee / beneficiary side
    { path: "employee.personal.lastName", label: "Last Name", section: "employee" },
    { path: "employee.personal.firstName", label: "First Name", section: "employee" },
    { path: "employee.personal.middleName", label: "Middle Name", section: "employee" },
    // Source: "All other names used ... if any" — explicitly conditional.
    { path: "employee.personal.otherNamesUsed", label: "Other Names Used", section: "employee", required: false },
    { path: "employee.personal.dateOfBirth", label: "Date of Birth", section: "employee" },
    { path: "employee.personal.countryOfBirth", label: "Country of Birth", section: "employee" },
    { path: "employee.personal.provinceStateOfBirth", label: "Province/State of Birth", section: "employee" },
    { path: "employee.personal.countryOfCitizenship", label: "Country of Citizenship", section: "employee" },
    { path: "employee.personal.socialSecurityNumber", label: "Social Security Number", section: "employee" },
    // Source: "A # ... if available" — explicitly conditional.
    { path: "employee.personal.alienRegistrationNumber", label: "Alien Registration Number", section: "employee", required: false },
    { path: "employee.personal.latestPriorPetitionNumber", label: "Latest Prior Petition Number", section: "employee" },
    { path: "employee.personal.sevisNumber", label: "SEVIS Number", section: "employee" },
    // Source: "Employment Authorization Document EAD Number (If any)" — explicitly conditional.
    { path: "employee.personal.eadNumber", label: "EAD Number", section: "employee", required: false },
    { path: "employee.personal.currentUsAddress.street", label: "Current US Address Street", section: "employee" },
    { path: "employee.personal.currentUsAddress.apartment", label: "Current US Address Apartment", section: "employee" },
    { path: "employee.personal.currentUsAddress.city", label: "Current US Address City", section: "employee" },
    { path: "employee.personal.currentUsAddress.state", label: "Current US Address State", section: "employee" },
    { path: "employee.personal.currentUsAddress.zipCode", label: "Current US Address Zip Code", section: "employee" },
    { path: "employee.personal.passportNumber", label: "Passport Number", section: "employee" },
    { path: "employee.personal.passportIssueDate", label: "Passport Issue Date", section: "employee" },
    { path: "employee.personal.passportExpirationDate", label: "Passport Expiration Date", section: "employee" },
    { path: "employee.personal.passportCountryOfIssuance", label: "Passport Country of Issuance", section: "employee" },
    { path: "employee.immigrationStatus.insideUnitedStates", label: "Inside United States", section: "employee" },
    { path: "employee.immigrationStatus.dateOfLastArrival", label: "Date of Last Arrival", section: "employee" },
    { path: "employee.immigrationStatus.i94Number", label: "I-94 Number", section: "employee" },
    { path: "employee.immigrationStatus.currentVisaStatus", label: "Current Visa Status", section: "employee" },
    { path: "employee.immigrationStatus.currentStatusExpirationDate", label: "Current Status Expiration Date", section: "employee" },
    { path: "employee.immigrationStatus.consulateForStamping", label: "Consulate for Stamping", section: "employee" },
    { path: "employee.immigrationStatus.foreignResidentialAddress.street", label: "Foreign Residential Address Street", section: "employee" },
    { path: "employee.immigrationStatus.foreignResidentialAddress.apartment", label: "Foreign Residential Address Apartment", section: "employee" },
    { path: "employee.immigrationStatus.foreignResidentialAddress.city", label: "Foreign Residential Address City", section: "employee" },
    { path: "employee.immigrationStatus.foreignResidentialAddress.state", label: "Foreign Residential Address State", section: "employee" },
    { path: "employee.immigrationStatus.foreignResidentialAddress.country", label: "Foreign Residential Address Country", section: "employee" },
    { path: "employee.immigrationStatus.foreignResidentialAddress.zipCode", label: "Foreign Residential Address Zip Code", section: "employee" },
    { path: "employee.otherInformation.hasValidPassport", label: "Has Valid Passport", section: "employee" },
    { path: "employee.otherInformation.replaceI94", label: "Replace I-94", section: "employee" },
    { path: "employee.otherInformation.hasDependents", label: "Has Dependents", section: "employee" },
    // Only asked once hasDependents is answered "yes" — mirrors the same
    // condition-on-a-yes/no-field pattern already used by o1.js/p.js's
    // otherInformation.numberOfDependents.
    { path: "employee.otherInformation.numberOfDependents", label: "If Yes, how many?", section: "employee", condition: { field: "employee.otherInformation.hasDependents", operator: "equals", value: "yes" } },
    { path: "employee.otherInformation.inRemovalProceedings", label: "In Removal Proceedings", section: "employee" },
    { path: "employee.otherInformation.employerFiledGreenCard", label: "Employer Filed Green Card", section: "employee" },
    { path: "employee.otherInformation.heldL1ALastSevenYears", label: "Held L-1A Last Seven Years", section: "employee" },
    { path: "employee.otherInformation.deniedL1ALastSevenYears", label: "Denied L-1A Last Seven Years", section: "employee" },
    // Source: "Have you ever been denied L1A visa in the past 7 years
    // (Yes/No)? If Yes, please explain." — normalizeEmployee() already reads
    // this field (l1aDenialExplanation) but it was missing from fieldCatalog
    // entirely, so it never had a renderable question. Mirrors o1.js/p.js's
    // equivalent otherInformation.*VisaDenialExplanation entry.
    { path: "employee.otherInformation.l1aDenialExplanation", label: "If Yes, please explain", section: "employee", type: "textarea", condition: { field: "employee.otherInformation.deniedL1ALastSevenYears", operator: "equals", value: "yes" } },
    { path: "employee.previousHLStatusHistory", label: "Previous H/L Status History", section: "employee", repeatable: true },
  ];
  // Required by default, per the authoritative source checklist — every
  // field is mandatory unless its own wording explicitly says "if any" /
  // "if applicable" / "if available" (those entries set required: false
  // explicitly above) or it only applies conditionally on a prior answer
  // (those already carry their own `condition`, so forcing them required
  // unconditionally would be wrong — they're required only once visible).
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
  normalizeEmployer,
  normalizeEmployee,
  employerConditionalDocuments,
  RELATIONSHIP_TYPES,
  SALARY_UNITS,
  ENTITY_TYPES_INDIA,
  ENTITY_TYPES_US,
  STOCK_OWNERSHIP_CERTIFICATES_DOCUMENT,
  LOI_MOU_CONTRACTS_DOCUMENT,
  MANAGERIAL_DUTY_BREAKDOWN_FIELDS,
  BUSINESS_PLAN_INTRO,
  fieldCatalog,
};
