const { clean } = require("./shared");

// EB-1C (Multinational Manager / Executive) - an employer-sponsored immigrant petition (Form I-140). Same employer / employee split as every
// other employer-sponsored visa in this registry (see eb1b.js): the U.S. petitioner answers the EMPLOYER checklist, the beneficiary the
// EMPLOYEE checklist. This module is the single source of the 43 supplied document requirements - exact labels, stable ids and canonical
// targets - and eb1cChecklists.js turns it into the two Questionnaire templates.
//
// EVERY item is optional (a client may save or submit with everything blank). The item numbers below are the numbers of the supplied
// specification; each question keeps its number in metadata.itemNumber.
//
// Canonical targets: these are the supplied semantic paths. A document upload stores its file reference in the existing Document model (the
// question's documentType == its key); the canonical path only names where the evidence belongs, it never holds file content. The two website
// URLs and the structured answers below are scalar canonical values.

const key = "eb1c";

// Tolerant of "EB1C", "EB-1C", "EB 1C", "eb1-c" ... (same tolerance as eb1b.js).
function matches(value) {
  return /eb[\s-]?1[\s-]?c\b/i.test(String(value || ""));
}

const EMPLOYER_SECTIONS = {
  us: "U.S. Company Documents",
  foreign: "Foreign Company Documents",
  relationship: "Qualifying Relationship Evidence",
};
const EMPLOYEE_SECTIONS = {
  employment: "Beneficiary Employment and Immigration Documents",
  family: "Spouse and Children",
};

// type "file" = a document upload; "url" = a website address (stored as text, validated as a URL).
const item = (no, id, label, section, category, canonical, extra = {}) => ({ no, id, label, section, category, canonical, type: "file", ...extra });
const url = (no, id, label, section, canonical, groupWith) => ({ no, id, label, section, category: "business", canonical, type: "url", groupId: groupWith });

const U = "petitioner.usCompany";
const F = "petitioner.foreignCompany";
const Q = "petitioner.qualifyingRelationship";

// ── Employer / petitioner checklist ──────────────────────────────────────────────────────────────────────────────────────────────────
const EMPLOYER_ITEMS = [
  // U.S. company documents (1-16)
  item("1", "us_articles_of_incorporation", "Articles of Incorporation", "us", "business", `${U}.documents.articlesOfIncorporation`),
  item("2", "us_ein_assignment_letter", "EIN Assignment letter from the Internal Revenue Service", "us", "business", `${U}.documents.einAssignmentLetter`),
  item("3", "us_statement_of_information", "Statement of Information filed with the Secretary of State", "us", "business", `${U}.documents.statementOfInformation`),
  item("4", "us_business_license", "Business License of the U.S. Company", "us", "business", `${U}.documents.businessLicense`),
  item("5", "us_office_lease", "Office Lease Agreement", "us", "business", `${U}.documents.officeLeaseAgreement`),
  item("6", "us_premises_photographs", "Photographs of business premises (inside and outside – showing company name, logo, address, and staff at work)", "us", "business", `${U}.documents.businessPremisesPhotographs`),
  item("7", "us_website_screenshots", "Company website screenshots / URL", "us", "business", `${U}.documents.websiteScreenshots`, { groupId: "us_website" }),
  url("7a", "us_website_url", "Company website URL", "us", `${U}.websiteUrl`, "us_website"),
  item("8", "us_brochures_marketing", "Company brochure and marketing materials", "us", "business", `${U}.documents.brochuresAndMarketingMaterials`),
  item("9", "us_commercial_transactions", "Commercial contracts, invoices, bills of lading, purchase orders, client agreements, etc.", "us", "business", `${U}.documents.commercialTransactions`),
  item("10", "us_federal_tax_return", "Recently filed Federal tax return", "us", "financial", `${U}.documents.federalTaxReturn`),
  item("11", "us_bank_statements", "Recent bank statements", "us", "financial", `${U}.documents.bankStatements`),
  item("12", "us_payroll_summary", "Payroll summary for all U.S. employees", "us", "financial", `${U}.documents.usEmployeePayrollSummary`),
  item("13", "us_org_chart_subordinate_resumes", "Organizational chart of the U.S. entity (showing subordinate staff reporting to beneficiary). Include subordinate staff résumés.", "us", "business", `${U}.documents.usOrganizationalChartAndSubordinateResumes`),
  item("14", "us_proposed_duties_letter", "Letter from authorized representative describing beneficiary’s intended managerial/executive duties. Should specify duties performed by subordinate staff relieving the beneficiary of operational tasks.", "us", "employment", `${U}.documents.proposedManagerialExecutiveDutiesLetter`),
  item("15", "us_proof_of_operations", "Proof of U.S. company operations (client lists, vendor agreements, CRM screenshots, shipment documents, etc.)", "us", "business", `${U}.documents.proofOfOperations`),
  item("16", "us_letterhead_word", "Company letterhead in Microsoft Word format.", "us", "business", `${U}.documents.letterheadWordFile`),
  // Foreign company documents and qualifying relationship (17-25, 31)
  item("17", "foreign_business_registration", "Business registration documents (Certificate of Incorporation, MOA/AOA, GST, PAN, etc.)", "foreign", "business", `${F}.documents.businessRegistration`),
  item("18", "foreign_office_lease", "Office Lease Agreement", "foreign", "business", `${F}.documents.officeLeaseAgreement`),
  item("19", "foreign_premises_photographs", "Photographs of business premises (inside and outside, showing company name, logo, staff at work, and work areas)", "foreign", "business", `${F}.documents.businessPremisesPhotographs`),
  item("20", "foreign_website", "Company website", "foreign", "business", `${F}.documents.websiteEvidence`, { groupId: "foreign_website" }),
  url("20a", "foreign_website_url", "Foreign company website URL", "foreign", `${F}.websiteUrl`, "foreign_website"),
  item("21", "foreign_brochures_marketing", "Company brochures / marketing materials", "foreign", "business", `${F}.documents.brochuresAndMarketingMaterials`),
  item("22", "foreign_business_transactions", "Documents of business transactions (contracts, invoices, bills of lading, letters of credit, purchase orders, etc.)", "foreign", "business", `${F}.documents.businessTransactions`),
  item("23", "foreign_tax_returns", "Recently filed tax returns", "foreign", "financial", `${F}.documents.taxReturns`),
  item("24", "foreign_bank_statements", "Recent bank statements", "foreign", "financial", `${F}.documents.bankStatements`),
  item("25", "qualifying_relationship_evidence", "Documents showing qualifying relationship between U.S. and foreign company (shareholding pattern, ownership chart, Board Resolutions, MOA/AOA, capital structure proof)", "relationship", "business", `${Q}.documents.ownershipAndCorporateRelationshipEvidence`),
  item("31", "foreign_letterhead_word", "Foreign company letterhead in Microsoft Word format.", "foreign", "business", `${F}.documents.letterheadWordFile`),
  // Additional qualifying-relationship evidence (41-43)
  item("41", "qualifying_initial_capital_bank_statements", "Bank statements evidencing initial capital investment.", "relationship", "financial", `${Q}.documents.initialCapitalInvestmentBankStatements`),
  item("42", "qualifying_shareholding_ownership_chart", "Shareholding pattern / ownership chart.", "relationship", "business", `${Q}.documents.shareholdingAndOwnershipChart`),
  item("43", "qualifying_us_entity_board_resolution", "Board Resolution approving establishment of U.S. entity.", "relationship", "business", `${Q}.documents.usEntityEstablishmentBoardResolution`),
];

// ── Employee / beneficiary checklist ─────────────────────────────────────────────────────────────────────────────────────────────────
const B = "beneficiary.foreignEmployment";
const EMPLOYEE_ITEMS = [
  item("26", "beneficiary_offer_appointment_letter", "Offer/Appointment letter of the beneficiary.", "employment", "employment", `${B}.offerAppointmentLetter`),
  item("27", "beneficiary_pay_stubs", "Pay stubs for one continuous year of employment abroad.", "employment", "financial", `${B}.payStubs`),
  item("28", "beneficiary_us_dispatch_authorization", "Extract from Board Meeting Minutes or other official documentation dispatching beneficiary to the U.S. for managerial/executive purposes.", "employment", "employment", `${B}.usDispatchAuthorization`),
  item("29", "beneficiary_duties_evidence", "Detailed managerial/executive duties performed by beneficiary at foreign entity with percentage allocation.", "employment", "employment", `${B}.managerialExecutiveDutiesEvidence`),
  item("30", "beneficiary_managerial_authority_evidence", "Copies of emails, memos, letters, or orders showing beneficiary’s managerial authority, including supervision, personnel recommendations, operational instructions and approvals, and performance reviews for one continuous year.", "employment", "employment", `${B}.managerialAuthorityEvidence`),
  item("32", "beneficiary_employment_verification_letter", "Employment verification letter from foreign company HR.", "employment", "employment", `${B}.employmentVerificationLetter`),
  item("33", "beneficiary_resume_cv", "Updated résumé/CV of beneficiary.", "employment", "employment", "beneficiary.documents.resumeCv"),
  item("34", "beneficiary_passport", "Passport of beneficiary (all pages).", "employment", "identity", "beneficiary.immigration.passportAllPages"),
  item("35", "beneficiary_us_visa_copies", "U.S. visa copies (L-1A / H-1B / others).", "employment", "immigration", "beneficiary.immigration.usVisaCopies"),
  item("36", "beneficiary_i94", "I-94 of beneficiary.", "employment", "immigration", "beneficiary.immigration.i94"),
];

// Structured percentage allocation for item 29 (supplementary, all optional; never inferred from the upload). Shown next to item 29.
const DUTY_PERCENTAGES = [
  { id: "duties_managing_function_pct", label: "Percentage of time spent managing a department, division, or function", canonical: `${B}.duties.managingDepartmentFunctionPercentage` },
  { id: "duties_supervision_pct", label: "Percentage of time spent supervising managerial, supervisory, or professional employees, or managing an essential function", canonical: `${B}.duties.supervisionOrEssentialFunctionPercentage` },
  { id: "duties_personnel_authority_pct", label: "Percentage of time spent exercising hiring, termination, personnel recommendation, or senior-level authority", canonical: `${B}.duties.personnelAuthorityPercentage` },
  { id: "duties_operational_discretion_pct", label: "Percentage of time spent exercising discretion over daily operations", canonical: `${B}.duties.operationalDiscretionPercentage` },
];

// Family (items 37-40). Applicability answers are optional; an unanswered one means "unknown", never "no".
const FAMILY = {
  hasSpouse: { id: "has_spouse", label: "Does the beneficiary have a spouse?", canonical: "beneficiary.family.hasSpouse" },
  hasChildren: { id: "has_children", label: "Does the beneficiary have any children?", canonical: "beneficiary.family.hasChildren" },
  childCount: { id: "child_count", label: "How many children?", canonical: "beneficiary.family.childCount" },
};
const SPOUSE_ITEMS = [
  item("37a", "spouse_passport", "Passport of spouse.", "family", "identity", "beneficiary.family.spouse.documents.passport"),
  item("38a", "spouse_i94", "I-94 of spouse (if applicable).", "family", "immigration", "beneficiary.family.spouse.immigration.i94"),
  item("40", "spouse_marriage_certificate", "Marriage Certificate (if applicable).", "family", "family", "beneficiary.family.spouse.documents.marriageCertificate"),
];
// A child's documents are one numbered record per child (each with its own uploads), shown for as many children as the client says there are.
const MAX_CHILD_RECORDS = 6;
const CHILD_ITEMS = [
  { no: "37b", id: "passport", label: "Passport of child.", category: "identity", canonical: "documents.passport" },
  { no: "38b", id: "i94", label: "I-94 of child (if applicable).", category: "immigration", canonical: "immigration.i94" },
  { no: "39", id: "birth_certificate", label: "Birth Certificates of children.", category: "family", canonical: "documents.birthCertificate" },
];
const childRecords = () => Array.from({ length: MAX_CHILD_RECORDS }, (_, index) => index + 1);
const childDocuments = () => childRecords().flatMap((childNumber) => CHILD_ITEMS.map((definition) => ({
  no: definition.no, id: `child_${childNumber}_${definition.id}`, label: definition.label, section: `child_${childNumber}`, category: definition.category,
  canonical: `beneficiary.family.children[${childNumber - 1}].${definition.canonical}`, type: "file", childNumber,
})));

const documentType = (definition) => `eb1c_${definition.id}`;
const toDocument = (definition, targetRole) => ({
  name: definition.label,
  documentType: documentType(definition),
  description: `EB-1C checklist item ${definition.no}.`,
  category: definition.category,
  required: false,
  targetRole,
  status: "requested",
});

// What the case's standing document list receives (registry.standardDocuments): every unconditional upload. Spouse / child documents are
// conditional on the family answers, so they are NOT standing items (same rule as H-1B's dependentDocuments).
const employerDocuments = EMPLOYER_ITEMS.filter((definition) => definition.type === "file").map((definition) => toDocument(definition, "employer"));
const employeeDocuments = EMPLOYEE_ITEMS.map((definition) => toDocument(definition, "employee"));
const dependentDocuments = [...SPOUSE_ITEMS, ...childDocuments()].map((definition) => toDocument(definition, "employee"));

function normalizeEmployer(payload = {}) {
  return {
    company: {
      legalName: clean(payload.company?.legalName || payload.legalName || payload.companyName),
      address: clean(payload.company?.address || payload.address),
      ein: clean(payload.company?.ein || payload.ein),
      websiteUrl: clean(payload.company?.websiteUrl || payload.websiteUrl),
    },
    foreignCompany: {
      legalName: clean(payload.foreignCompany?.legalName || payload.foreignCompanyName),
      websiteUrl: clean(payload.foreignCompany?.websiteUrl || payload.foreignWebsiteUrl),
    },
  };
}

function normalizeEmployee(payload = {}, profile = {}) {
  return {
    personal: {
      lastName: clean(payload.personal?.lastName || payload.lastName || profile.lastName),
      firstName: clean(payload.personal?.firstName || payload.firstName || profile.firstName),
      dateOfBirth: payload.personal?.dateOfBirth || payload.dateOfBirth || profile.dateOfBirth || "",
      countryOfBirth: clean(payload.personal?.countryOfBirth || payload.countryOfBirth || profile.countryOfBirth),
      email: clean(payload.personal?.email || payload.email || profile.email),
    },
    // an unanswered applicability question stays "" (unknown); it is never coerced to "no"
    family: {
      hasSpouse: payload.family?.hasSpouse ?? payload.hasSpouse ?? "",
      hasChildren: payload.family?.hasChildren ?? payload.hasChildren ?? "",
    },
    updatedAt: new Date(),
  };
}

// Flat catalog for the document-intelligence matcher and any consumer of registry.fieldCatalog(). Documents are not listed (they are files, not
// scalar answers); the scalar answers are.
function fieldCatalog() {
  return [
    ...EMPLOYER_ITEMS.filter((definition) => definition.type === "url").map((definition) => ({ path: `employer.${definition.id}`, label: definition.label, section: "employer", type: "text", required: false })),
    { path: `employee.${FAMILY.hasSpouse.id}`, label: FAMILY.hasSpouse.label, section: "employee", type: "boolean", required: false },
    { path: `employee.${FAMILY.hasChildren.id}`, label: FAMILY.hasChildren.label, section: "employee", type: "boolean", required: false },
    { path: `employee.${FAMILY.childCount.id}`, label: FAMILY.childCount.label, section: "employee", type: "number", required: false },
    ...DUTY_PERCENTAGES.map((definition) => ({ path: `employee.${definition.id}`, label: definition.label, section: "employee", type: "number", required: false })),
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
  fieldCatalog,
  documentType,
  EMPLOYER_SECTIONS,
  EMPLOYEE_SECTIONS,
  EMPLOYER_ITEMS,
  EMPLOYEE_ITEMS,
  SPOUSE_ITEMS,
  CHILD_ITEMS,
  MAX_CHILD_RECORDS,
  childRecords,
  childDocuments,
  DUTY_PERCENTAGES,
  FAMILY,
};
