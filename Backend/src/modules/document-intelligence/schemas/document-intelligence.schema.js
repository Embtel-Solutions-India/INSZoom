const DOCUMENT_TYPES = [
  "passport",
  "visa",
  "i94",
  "driver_license",
  "resume",
  "degree",
  "lca",
  "credential_evaluation",
  "transcript",
  "i20",
  "publication",
  "patent",
  "award",
  "membership",
  "press",
  "salary",
  "recommendation_letter",
  "birth_certificate",
  "marriage_certificate",
  "divorce_certificate",
  "employment_letter",
  "experience_letter",
  "employment_verification_letter",
  "offer_letter",
  "paystub",
  "w2",
  "tax_return",
  "bank_statement",
  "business_registration",
  "business_license",
  "articles_of_incorporation",
  "organizational_chart",
  "financial_statement",
  "company_document",
  "uscis_notice",
  "previous_uscis_form",
  "approval_notice",
  "rfe",
  "noid",
  "medical_examination",
  "police_certificate",
  "photograph",
  "supporting_evidence",
  "other",
];

const EVIDENCE_CATEGORIES = [
  "Award",
  "Publication",
  "Patent",
  "Press",
  "Membership",
  "Judging",
  "High Salary",
  "Critical Role",
  "Original Contribution",
  "Authorship",
  "Education",
  "Employment",
  "Identity",
  "Immigration",
  "Recommendation",
  "Civil",
  "Financial",
  "Business",
  "Medical",
  "Legal",
  "Supporting Evidence",
  "Other",
];

const CONFIDENCE_BANDS = {
  AUTO_ACCEPTED: "auto_accepted",
  NEEDS_REVIEW: "needs_review",
  MANUAL_REVIEW: "manual_review",
};

const DOCUMENT_TYPE_ALIASES = {
  current_visa: "visa",
  visa_stamp: "visa",
  recommendation: "recommendation_letter",
  support_letter: "recommendation_letter",
  cv: "resume",
  updated_resume: "resume",
  paystub: "salary",
  financial_document: "salary",
  photo: "photograph",
  state_id: "driver_license",
  national_id: "other",
  eta9035: "lca",
  eta_9035: "lca",
  credential_evaluation_report: "credential_evaluation",
  employee_i94_copy: "i94",
  previous_i797_notices: "approval_notice",
  academic_certificates: "degree",
  certified_lca_eta9035: "lca",
  employee_drivers_license_or_state_id: "driver_license",
  business_license: "business_license",
};

function normalizeDocumentType(value) {
  const normalized = String(value || "other").toLowerCase().replace(/[\s-]+/g, "_");
  return DOCUMENT_TYPES.includes(normalized) ? normalized : DOCUMENT_TYPE_ALIASES[normalized] || "other";
}

function confidenceBand(confidence = 0) {
  const score = Number(confidence) || 0;
  if (score >= 95) return CONFIDENCE_BANDS.AUTO_ACCEPTED;
  if (score >= 80) return CONFIDENCE_BANDS.NEEDS_REVIEW;
  return CONFIDENCE_BANDS.MANUAL_REVIEW;
}

module.exports = {
  CONFIDENCE_BANDS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_ALIASES,
  EVIDENCE_CATEGORIES,
  confidenceBand,
  normalizeDocumentType,
};
