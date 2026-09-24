// E-2 Treaty Investor — three checklists per the employer/employee
// (two-party) checklist architecture already established by h1b.js/l1a.js:
//   1. E2_VISA (checklistRole "employer") — ONE consolidated checklist
//      covering employer info, employee info, and treaty/ownership/staff
//      data, since the source document bundles all of this into one form
//      the employer/preparer fills out.
//   2. E2_BUSINESS_PLAN (checklistRole "business_plan") — reuses the exact
//      "business_plan" role L-1A already established.
//   3. E2_SUPPORTING_DOCUMENTS (checklistRole "supporting_documents") — a
//      minimal, document-only checklist; no additional documents beyond
//      these three were found required for E-2 elsewhere in the system.
//
// This file only exports the static field/document catalog, mirroring
// l1a.js's shape; Backend/src/modules/questionnaires/employmentChecklists.js
// converts it into real Questionnaire/Question template definitions.

const key = "e2";

function matches(value) {
  return /e[\s-]?2\b/i.test(String(value || "").trim());
}

// ---------------------------------------------------------------------------
// Checklist 3 — E2_SUPPORTING_DOCUMENTS
// ---------------------------------------------------------------------------
const SUPPORTING_DOCUMENTS = [
  { name: "Business License", documentType: "e2_business_license", description: "Current business license for the E-2 enterprise." },
  { name: "Articles of Incorporation", documentType: "e2_articles_of_incorporation", description: "Formation/incorporation documents for the E-2 enterprise." },
  { name: "Company Letterhead", documentType: "e2_company_letterhead", description: "E-2 enterprise letterhead." },
];

const supportingDocuments = SUPPORTING_DOCUMENTS.map((doc) => ({
  ...doc,
  required: true,
  category: "e2_supporting",
  targetRole: "employer",
  status: "requested",
}));

// ---------------------------------------------------------------------------
// Select-option constants
// ---------------------------------------------------------------------------
const SOURCE_OF_FUNDS_OPTIONS = ["Savings", "Sale of property or business", "Gift", "Loan secured or unsecured"];
const BUSINESS_STRUCTURE_OPTIONS = ["LLC", "Corporation", "Other"];
const NEW_OR_EXISTING_OPTIONS = ["New", "Existing"];
const E2_RELATIONSHIP_TYPES = ["Parent", "Branch", "Subsidiary", "Affiliate", "Joint Venture"];
const MARKETING_CHANNEL_OPTIONS = ["Online", "Website", "Social media", "Flyers", "Local advertisements", "Other"];

// Flat catalog of every field the E2_VISA and E2_BUSINESS_PLAN checklists
// understand, for employmentChecklists.js's fieldQuestionsFromCatalog() to
// convert into real Question documents. Paths are prefixed
// "employer.e2BusinessPlan." (Checklist 1 — business_plan role) or
// "employer.e2." (Checklist 2 — employer role) so the two checklists can be
// built by filtering on the prefix, exactly like L-1A's
// "employer.businessPlan." split in l1a.js/employmentChecklists.js.
//
// Repeatable sub-documents (e.g. partners, top competitors, ownership rows)
// are listed with repeatable:true; employmentChecklists.js's
// REPEATABLE_FIELDS map describes their columns for the generic
// repeating-row editor.
function fieldCatalog() {
  const entries = [
    // =========================================================================
    // Checklist 1 — E2_BUSINESS_PLAN (checklistRole: "business_plan")
    // =========================================================================

    // A. Personal & Immigration Information
    { path: "employer.e2BusinessPlan.personal.fullName", label: "Full Name (as per passport)", section: "employer" },
    { path: "employer.e2BusinessPlan.personal.dateOfBirth", label: "Date of Birth", section: "employer", type: "date" },
    { path: "employer.e2BusinessPlan.personal.nationality", label: "Nationality", section: "employer" },
    { path: "employer.e2BusinessPlan.personal.currentCountryOfResidence", label: "Current Country of Residence", section: "employer" },
    // Driver question, per the task spec's own instruction ("add that driver
    // question"), gating "Current Visa Status" immediately below.
    { path: "employer.e2BusinessPlan.personal.currentlyInUnitedStates", label: "Are you currently in the U.S.?", section: "employer", type: "radio" },
    { path: "employer.e2BusinessPlan.personal.currentVisaStatus", label: "Current Visa Status (if in U.S.)", section: "employer", condition: { field: "employer.e2BusinessPlan.personal.currentlyInUnitedStates", operator: "equals", value: "yes" } },
    { path: "employer.e2BusinessPlan.personal.previouslyAppliedE2", label: "Have you previously applied for an E-2 visa?", section: "employer", type: "radio" },
    { path: "employer.e2BusinessPlan.personal.previousE2ApplicationDetails", label: "If Yes, please provide details", section: "employer", type: "textarea", condition: { field: "employer.e2BusinessPlan.personal.previouslyAppliedE2", operator: "equals", value: "yes" } },
    { path: "employer.e2BusinessPlan.personal.priorVisaRefusals", label: "Any prior U.S. visa refusals?", section: "employer", type: "radio" },
    { path: "employer.e2BusinessPlan.personal.priorVisaRefusalsExplanation", label: "If Yes, please explain", section: "employer", type: "textarea", condition: { field: "employer.e2BusinessPlan.personal.priorVisaRefusals", operator: "equals", value: "yes" } },

    // B. Business Overview
    { path: "employer.e2BusinessPlan.business.proposedName", label: "Proposed Business Name", section: "employer" },
    { path: "employer.e2BusinessPlan.business.address", label: "Business Address (U.S. location)", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.business.industryType", label: "Type of Business (Industry)", section: "employer" },
    { path: "employer.e2BusinessPlan.business.newOrExisting", label: "New business or existing business?", section: "employer", type: "select", options: NEW_OR_EXISTING_OPTIONS },
    { path: "employer.e2BusinessPlan.business.dateEstablished", label: "If existing: Date established", section: "employer", type: "date", condition: { field: "employer.e2BusinessPlan.business.newOrExisting", operator: "equals", value: "Existing" } },
    { path: "employer.e2BusinessPlan.business.conceptDescription", label: "Brief description of business concept", section: "employer", type: "textarea" },

    // C. Investment Details
    { path: "employer.e2BusinessPlan.investment.totalInvestmentAmount", label: "Total Investment Amount (USD)", section: "employer", type: "currency" },
    { path: "employer.e2BusinessPlan.investment.amountAlreadyInvested", label: "Amount already invested", section: "employer", type: "currency" },
    { path: "employer.e2BusinessPlan.investment.amountRemaining", label: "Amount remaining to be invested", section: "employer", type: "currency" },
    { path: "employer.e2BusinessPlan.investment.equipmentInvestment", label: "Equipment investment", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.investment.leaseInvestment", label: "Lease investment", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.investment.inventoryInvestment", label: "Inventory investment", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.investment.marketingInvestment", label: "Marketing investment", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.investment.salariesInvestment", label: "Salaries investment", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.investment.otherExpenses", label: "Other expenses", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.investment.sourceOfFunds", label: "Source of funds", section: "employer", type: "multi_select", options: SOURCE_OF_FUNDS_OPTIONS },
    { path: "employer.e2BusinessPlan.investment.sourceOfFundsExplanation", label: "Detailed explanation of source of funds", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.investment.sourceOfFundsDocuments", label: "Supporting documents for source of funds", section: "employer", type: "file" },

    // D. Ownership Structure
    { path: "employer.e2BusinessPlan.ownership.ownershipPercentage", label: "Ownership percentage of employer/business", section: "employer", type: "percent" },
    { path: "employer.e2BusinessPlan.ownership.businessStructure", label: "Business structure", section: "employer", type: "select", options: BUSINESS_STRUCTURE_OPTIONS },
    { path: "employer.e2BusinessPlan.ownership.businessStructureOther", label: "If Other, please specify", section: "employer", condition: { field: "employer.e2BusinessPlan.ownership.businessStructure", operator: "equals", value: "Other" } },
    // Driver question, per the task spec's own instruction ("use a simple
    // ... Yes/No driver"), gating the repeating group below.
    { path: "employer.e2BusinessPlan.ownership.hasPartnersOrShareholders", label: "Do you have partners/shareholders?", section: "employer", type: "radio" },
    { path: "employer.e2BusinessPlan.ownership.partners", label: "List of partners/shareholders", section: "employer", repeatable: true, condition: { field: "employer.e2BusinessPlan.ownership.hasPartnersOrShareholders", operator: "equals", value: "yes" } },
    { path: "employer.e2BusinessPlan.ownership.organizationalChart", label: "Organizational chart", section: "employer", type: "file", required: false },

    // E. Business Model & Operations
    { path: "employer.e2BusinessPlan.operations.productsServices", label: "Products/services offered", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.operations.pricingStrategy", label: "Pricing strategy", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.operations.targetCustomers", label: "Target customers", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.operations.usp", label: "Unique selling point (USP)", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.operations.revenueGeneration", label: "How will the business generate revenue?", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.operations.suppliersVendors", label: "Suppliers/vendors, if identified", section: "employer", type: "textarea", required: false },
    { path: "employer.e2BusinessPlan.operations.locationDetails", label: "Business location details / why this location?", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.operations.dailyOperationsPlan", label: "Daily operations plan", section: "employer", type: "textarea" },

    // F. Market Analysis
    { path: "employer.e2BusinessPlan.market.targetMarket", label: "Target market (demographics/location)", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.market.marketDemand", label: "Market demand", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.market.topCompetitors", label: "Top 3 competitors", section: "employer", repeatable: true },
    { path: "employer.e2BusinessPlan.market.successRationale", label: "Why will the business succeed in this market?", section: "employer", type: "textarea" },

    // G. Hiring Plan
    { path: "employer.e2BusinessPlan.hiring.employeesByYear", label: "Number of employees to be hired, Year 1–5", section: "employer", repeatable: true },
    { path: "employer.e2BusinessPlan.hiring.jobTitlesAndRoles", label: "Job titles and roles", section: "employer", repeatable: true },
    { path: "employer.e2BusinessPlan.hiring.salaryEstimates", label: "Salary estimates", section: "employer", repeatable: true },
    { path: "employer.e2BusinessPlan.hiring.hiringTimeline", label: "Hiring timeline", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.hiring.employeesWillBeUsWorkers", label: "Will employees be U.S. workers?", section: "employer", type: "radio" },

    // H. Financial Projections
    { path: "employer.e2BusinessPlan.financial.expectedMonthlyRevenue", label: "Expected monthly revenue", section: "employer", type: "currency" },
    { path: "employer.e2BusinessPlan.financial.expectedAnnualGrowthPercent", label: "Expected annual growth (%)", section: "employer", type: "percent" },
    { path: "employer.e2BusinessPlan.financial.rent", label: "Rent", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.financial.payroll", label: "Payroll", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.financial.utilities", label: "Utilities", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.financial.marketing", label: "Marketing", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.financial.miscellaneous", label: "Miscellaneous", section: "employer", type: "currency", required: false },
    { path: "employer.e2BusinessPlan.financial.assumptions", label: "Financial assumptions/expectations", section: "employer", type: "textarea", required: false },

    // I. Investor/Principal Background (section label only — not a case type)
    { path: "employer.e2BusinessPlan.background.educationalQualifications", label: "Educational qualifications", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.background.workExperience", label: "Work experience, especially business-related", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.background.previousBusinessOwnership", label: "Previous business ownership, if any", section: "employer", type: "textarea", required: false },
    { path: "employer.e2BusinessPlan.background.experienceSupport", label: "How does your experience support this business?", section: "employer", type: "textarea" },

    // J. Lease & Location
    { path: "employer.e2BusinessPlan.lease.leaseSigned", label: "Lease agreement signed?", section: "employer", type: "radio" },
    { path: "employer.e2BusinessPlan.lease.monthlyRent", label: "Monthly rent", section: "employer", type: "currency", condition: { field: "employer.e2BusinessPlan.lease.leaseSigned", operator: "equals", value: "yes" } },
    { path: "employer.e2BusinessPlan.lease.leaseDuration", label: "Lease duration", section: "employer", condition: { field: "employer.e2BusinessPlan.lease.leaseSigned", operator: "equals", value: "yes" } },
    { path: "employer.e2BusinessPlan.lease.premisesSize", label: "Size of premises", section: "employer", required: false },
    { path: "employer.e2BusinessPlan.lease.locationPhotos", label: "Photos of location", section: "employer", type: "file", required: false },

    // K. Licenses & Registrations
    { path: "employer.e2BusinessPlan.licenses.businessRegistered", label: "Business registered?", section: "employer", type: "radio" },
    { path: "employer.e2BusinessPlan.licenses.einObtained", label: "EIN obtained?", section: "employer", type: "radio" },
    { path: "employer.e2BusinessPlan.licenses.licensesIdentified", label: "Required licenses/permits identified?", section: "employer", type: "radio" },
    { path: "employer.e2BusinessPlan.licenses.approvalsObtained", label: "Approvals already obtained", section: "employer", type: "textarea", required: false },

    // L. Marketing & Growth
    { path: "employer.e2BusinessPlan.marketing.channels", label: "Marketing channels", section: "employer", type: "multi_select", options: MARKETING_CHANNEL_OPTIONS, required: false },
    { path: "employer.e2BusinessPlan.marketing.launchStrategy", label: "Launch strategy", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.marketing.customerAcquisitionPlan", label: "Customer acquisition plan", section: "employer", type: "textarea" },
    { path: "employer.e2BusinessPlan.marketing.expansionPlan", label: "Expansion plan/future growth", section: "employer", type: "textarea" },

    // =========================================================================
    // Checklist 2 — E2_VISA (checklistRole: "employer")
    // One consolidated checklist — employer, employee, treaty, ownership, and
    // staffing information — per the task spec's architectural decision.
    // =========================================================================

    // Employer Information
    { path: "employer.e2.company.name", label: "Full name of company", section: "employer" },
    { path: "employer.e2.company.fein", label: "FEIN", section: "employer" },
    { path: "employer.e2.company.address", label: "Employer full address", section: "employer", type: "textarea" },
    { path: "employer.e2.company.businessType", label: "Type of business", section: "employer" },
    { path: "employer.e2.company.yearEstablished", label: "Year established", section: "employer", type: "number" },
    { path: "employer.e2.company.totalUsEmployees", label: "Total number of employees in U.S. company", section: "employer", type: "number" },
    { path: "employer.e2.company.website", label: "Employer company website", section: "employer", required: false },
    { path: "employer.e2.company.netIncome", label: "Net income", section: "employer", type: "currency" },
    { path: "employer.e2.company.grossAnnualIncome", label: "Gross annual income", section: "employer", type: "currency" },
    { path: "employer.e2.signingPerson.firstName", label: "Signing person's first name", section: "employer" },
    { path: "employer.e2.signingPerson.lastName", label: "Signing person's last name", section: "employer" },
    { path: "employer.e2.signingPerson.title", label: "Signing person's designation/title", section: "employer" },
    { path: "employer.e2.signingPerson.email", label: "Signing person's email", section: "employer", type: "email" },
    { path: "employer.e2.signingPerson.mobilePhone", label: "Signing person's mobile number", section: "employer", type: "phone" },

    // Employee Information
    { path: "employer.e2.employee.jobTitle", label: "Employee job title as per offer letter", section: "employer" },
    { path: "employer.e2.employee.salary", label: "Employee salary as per offer letter", section: "employer", type: "currency" },
    { path: "employer.e2.employee.jobLocations", label: "Employee job location", section: "employer", repeatable: true },
    { path: "employer.e2.employee.workLocationClients", label: "Company/end-client name for each work location", section: "employer", repeatable: true },
    { path: "employer.e2.employee.startDate", label: "Employment start date", section: "employer", type: "date" },
    { path: "employer.e2.employee.jobDescription", label: "Job description & responsibilities", section: "employer", type: "textarea" },

    // Treaty Information
    { path: "employer.e2.treaty.countryName", label: "Name of country signatory to treaty with United States", section: "employer" },

    // Employer Outside United States — all conditional on the driver below.
    { path: "employer.e2.foreignEmployer.exists", label: "Is there an employer outside the United States?", section: "employer", type: "radio" },
    { path: "employer.e2.foreignEmployer.name", label: "Employer name", section: "employer", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.totalEmployees", label: "Total number of employees", section: "employer", type: "number", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.streetNumberAndName", label: "Street Number and Name", section: "employer", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.aptSteFlr", label: "Apt./Ste./Flr.", section: "employer", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.cityTown", label: "City/Town", section: "employer", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.province", label: "Province", section: "employer", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.postalCode", label: "Postal Code", section: "employer", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.country", label: "Country", section: "employer", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.zipCode", label: "ZIP Code", section: "employer", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.principalProductOrService", label: "Principal product/merchandise/service", section: "employer", type: "textarea", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },
    { path: "employer.e2.foreignEmployer.employeePositionDutiesYears", label: "Employee's position, duties and years employed", section: "employer", type: "textarea", condition: { field: "employer.e2.foreignEmployer.exists", operator: "equals", value: "yes" } },

    // U.S./Foreign Company Relationship
    { path: "employer.e2.relationship.type", label: "Relationship", section: "employer", type: "select", options: E2_RELATIONSHIP_TYPES },
    { path: "employer.e2.relationship.placeOfIncorporation", label: "Place of incorporation/establishment in U.S.", section: "employer" },
    { path: "employer.e2.relationship.dateOfIncorporation", label: "Date of incorporation/establishment", section: "employer", type: "date" },

    // Ownership
    { path: "employer.e2.ownership.owners", label: "Ownership", section: "employer", repeatable: true },
    { path: "employer.e2.ownership.assets", label: "Assets", section: "employer", type: "currency" },
    { path: "employer.e2.ownership.netWorth", label: "Net Worth", section: "employer", type: "currency" },
    { path: "employer.e2.ownership.netAnnualIncome", label: "Net Annual Income", section: "employer", type: "currency" },

    // Staff in the United States
    { path: "employer.e2.staff.treatyNationalsInExecutiveRoles", label: "Number of executive/managerial employees who are treaty-country nationals in E/L/H status", section: "employer", type: "number" },
    { path: "employer.e2.staff.specialQualificationsInEmployees", label: "Number of persons with special qualifications in E/L/H status", section: "employer", type: "number" },
    { path: "employer.e2.staff.totalExecutiveManagerialPositions", label: "Total executive/managerial positions in U.S.", section: "employer", type: "number" },
    { path: "employer.e2.staff.totalSpecialQualificationPositions", label: "Total positions requiring special qualifications", section: "employer", type: "number" },
    // Driver questions, per the task spec's own instruction, gating the two
    // conditional staff fields below.
    { path: "employer.e2.staff.qualifyingEmployeeIsExecutiveManager", label: "Is the qualifying employee an executive/manager?", section: "employer", type: "radio" },
    { path: "employer.e2.staff.employeesSupervisedByQualifyingExecutive", label: "Number of employees supervised by qualifying executive/manager", section: "employer", type: "number", condition: { field: "employer.e2.staff.qualifyingEmployeeIsExecutiveManager", operator: "equals", value: "yes" } },
    { path: "employer.e2.staff.qualifyingEmployeeBasedOnSpecialQualifications", label: "Is the qualifying employee based on special qualifications?", section: "employer", type: "radio" },
    { path: "employer.e2.staff.specialQualificationsExplanation", label: "Explanation of why special qualifications are essential", section: "employer", type: "textarea", condition: { field: "employer.e2.staff.qualifyingEmployeeBasedOnSpecialQualifications", operator: "equals", value: "yes" } },

    // Treaty Investor — labeled sub-section (not a separate case type),
    // gated on the driver below.
    { path: "employer.e2.investor.filingForE2TreatyInvestor", label: "Filing for an E-2 Treaty Investor?", section: "employer", type: "radio" },
    { path: "employer.e2.investor.cashInvestment", label: "Cash investment", section: "employer", type: "currency", condition: { field: "employer.e2.investor.filingForE2TreatyInvestor", operator: "equals", value: "yes" } },
    { path: "employer.e2.investor.equipment", label: "Equipment", section: "employer", type: "currency", condition: { field: "employer.e2.investor.filingForE2TreatyInvestor", operator: "equals", value: "yes" } },
    { path: "employer.e2.investor.inventory", label: "Inventory", section: "employer", type: "currency", condition: { field: "employer.e2.investor.filingForE2TreatyInvestor", operator: "equals", value: "yes" } },
    { path: "employer.e2.investor.premises", label: "Premises", section: "employer", type: "currency", condition: { field: "employer.e2.investor.filingForE2TreatyInvestor", operator: "equals", value: "yes" } },
    { path: "employer.e2.investor.other", label: "Other", section: "employer", type: "currency", condition: { field: "employer.e2.investor.filingForE2TreatyInvestor", operator: "equals", value: "yes" } },
    { path: "employer.e2.investor.totalInvestment", label: "Total investment", section: "employer", type: "currency", condition: { field: "employer.e2.investor.filingForE2TreatyInvestor", operator: "equals", value: "yes" } },
  ];
  // Required by default unless the field's own wording says "if any" /
  // "if identified" / "optional" (those entries set required:false above)
  // or it only applies conditionally on a prior answer (those already carry
  // their own `condition` and are forced not-required unconditionally —
  // they're only required once actually visible) — mirrors l1a.js's
  // fieldCatalog() convention exactly.
  return entries.map((entry) => ({
    ...entry,
    required: entry.condition ? false : entry.required !== false,
  }));
}

module.exports = {
  key,
  matches,
  supportingDocuments,
  SOURCE_OF_FUNDS_OPTIONS,
  BUSINESS_STRUCTURE_OPTIONS,
  NEW_OR_EXISTING_OPTIONS,
  E2_RELATIONSHIP_TYPES,
  MARKETING_CHANNEL_OPTIONS,
  fieldCatalog,
};
