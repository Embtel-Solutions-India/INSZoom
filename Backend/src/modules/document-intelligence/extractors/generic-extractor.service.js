const providerRegistry = require("../providers/document-intelligence-provider.registry");

const FIELD_SCHEMAS = {
  visa: ["visaType", "controlNumber", "issueDate", "expirationDate", "issuingCountry", "passportNumber"],
  i94: ["admissionDate", "classOfAdmission", "expirationDate", "i94Number"],
  driver_license: ["firstName", "lastName", "middleName", "dateOfBirth", "licenseNumber", "street", "city", "state", "zipCode", "issueDate", "expirationDate"],
  degree: ["university", "degree", "major", "graduationDate", "country"],
  lca: ["socCode", "socTitle", "jobTitle", "prevailingWageLevel", "offeredWageRate", "wageUnit", "employmentBeginDate", "employmentEndDate", "worksiteAddress", "employerLegalName", "employerFein"],
  i20: ["studentName", "sevisId", "schoolName", "programStartDate", "programEndDate", "educationLevel", "major", "schoolCode", "designatedSchoolOfficial"],
  credential_evaluation: ["originalCredential", "originalInstitution", "originalCountry", "usEquivalentDegree", "fieldOfStudy", "evaluatingAgency", "evaluationDate"],
  transcript: ["university", "degree", "major", "graduationDate", "country", "gpa"],
  publication: ["title", "authors", "journal", "publicationDate", "doi", "citationCount"],
  award: ["awardName", "issuer", "date", "category"],
  patent: ["patentNumber", "patentTitle", "inventors", "issueDate"],
  membership: ["organization", "membershipLevel", "startDate", "criteria"],
  press: ["title", "publisher", "publicationDate", "url", "summary"],
  salary: ["employer", "salaryAmount", "currency", "period", "date"],
  recommendation_letter: ["recommenderName", "recommenderTitle", "organization", "relationship", "date", "summary"],
  resume: ["education", "employment", "researchExperience", "publications", "awards", "patents", "skills", "professionalMemberships"],
  birth_certificate: ["fullName", "dateOfBirth", "placeOfBirth", "parentNames", "registrationNumber", "registrationDate", "issuingCountry", "issuingAuthority"],
  marriage_certificate: ["spouseOneName", "spouseTwoName", "marriageDate", "marriagePlace", "registrationNumber", "registrationDate", "issuingCountry", "issuingAuthority"],
  divorce_certificate: ["partyNames", "decreeDate", "court", "caseNumber", "issuingCountry"],
  employment_letter: ["employeeName", "employer", "jobTitle", "employmentStartDate", "employmentEndDate", "salary", "workLocation", "signatory"],
  experience_letter: ["employeeName", "employer", "jobTitle", "employmentStartDate", "employmentEndDate", "duties", "skills", "signatory"],
  employment_verification_letter: ["employeeName", "employer", "jobTitle", "employmentStartDate", "employmentStatus", "salary", "workLocation", "signatory"],
  offer_letter: ["employeeName", "employer", "jobTitle", "startDate", "salary", "workLocation", "employmentType", "signatory"],
  paystub: ["employeeName", "employer", "payPeriodStart", "payPeriodEnd", "payDate", "grossPay", "netPay", "yearToDatePay", "currency"],
  w2: ["employeeName", "employeeSsnLastFour", "employer", "employerEin", "taxYear", "wages", "federalTaxWithheld"],
  tax_return: ["taxpayerNames", "taxYear", "filingStatus", "adjustedGrossIncome", "taxableIncome", "employers", "formType"],
  bank_statement: ["accountHolder", "institution", "accountLastFour", "statementStartDate", "statementEndDate", "openingBalance", "closingBalance", "currency"],
  business_registration: ["legalName", "registrationNumber", "entityType", "formationDate", "jurisdiction", "registeredAddress", "status"],
  business_license: ["legalName", "licenseNumber", "licenseType", "issuingAuthority", "jurisdiction", "issueDate", "expirationDate", "businessAddress", "status"],
  articles_of_incorporation: ["legalName", "entityType", "formationDate", "jurisdiction", "registeredAgent", "businessPurpose", "incorporators"],
  organizational_chart: ["organizationName", "entities", "ownershipRelationships", "departments", "positions"],
  financial_statement: ["organizationName", "periodStart", "periodEnd", "revenue", "expenses", "netIncome", "assets", "liabilities", "currency"],
  company_document: ["organizationName", "documentTitle", "documentDate", "registrationNumber", "jurisdiction", "summary"],
  uscis_notice: ["formNumber", "receiptNumber", "noticeType", "noticeDate", "petitioner", "beneficiary", "priorityDate", "serviceCenter", "responseDueDate"],
  previous_uscis_form: ["formNumber", "editionDate", "petitioner", "beneficiary", "receiptNumber", "filingDate", "status"],
  approval_notice: ["formNumber", "receiptNumber", "noticeDate", "validFrom", "validTo", "petitioner", "beneficiary", "classification", "serviceCenter"],
  rfe: ["formNumber", "receiptNumber", "noticeDate", "responseDueDate", "requestedEvidence", "petitioner", "beneficiary", "serviceCenter"],
  noid: ["formNumber", "receiptNumber", "noticeDate", "responseDueDate", "grounds", "petitioner", "beneficiary", "serviceCenter"],
  medical_examination: ["applicantName", "dateOfBirth", "examinationDate", "physicianName", "physicianLicense", "vaccinationStatus", "sealedStatus"],
  police_certificate: ["subjectName", "dateOfBirth", "certificateNumber", "issueDate", "issuingCountry", "issuingAuthority", "result"],
  photograph: ["subjectName", "photoDate", "dimensions", "qualityAssessment"],
  supporting_evidence: ["documentTitle", "issuer", "documentDate", "subjects", "summary", "relevance"],
  other: ["summary", "documentDate", "issuer"],
};

function extractionPrompt(documentType, document) {
  const fields = FIELD_SCHEMAS[documentType] || FIELD_SCHEMAS.other;
  return [
    "Extract immigration document data using visual document understanding. Return strict JSON only. Do not hallucinate. Use null for unavailable fields.",
    "Every scalar field must be returned as { \"value\": any, \"confidence\": 0-100 }.",
    "Arrays may contain structured objects, each with best available fields and optional confidence. Preserve complete employment, education, travel, family, and financial histories when present.",
    `Document type: ${documentType}.`,
    `Required top-level fields: ${fields.join(", ")}.`,
    "Also return:",
    "{",
    '  "fields": { "fieldName": { "value": "...", "confidence": 95 } },',
    '  "entities": {},',
    '  "rawText": "important visible text only",',
    '  "evidenceCategories": ["Identity"],',
    '  "overallConfidence": 0-100',
    "}",
    `Filename: ${document.originalName || document.originalFileName || document.fileName || ""}`,
  ].join("\n");
}

async function extract({ document, buffer, documentType }) {
  const result = await providerRegistry.generateStructuredJson({
    prompt: extractionPrompt(documentType, document),
    buffer,
    mimeType: document.mimeType || document.fileType,
  });
  return {
    fields: result.fields || {},
    entities: result.entities || {},
    rawText: result.rawText || "",
    evidenceCategories: result.evidenceCategories || [],
    overallConfidence: Math.max(0, Math.min(100, Number(result.overallConfidence) || 0)),
    raw: result,
  };
}

module.exports = {
  FIELD_SCHEMAS,
  extract,
  extractionPrompt,
};
