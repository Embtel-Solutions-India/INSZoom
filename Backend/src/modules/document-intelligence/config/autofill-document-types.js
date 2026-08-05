// H-1B OCR-autofill allowlist. Keyed by the H-1B checklist's OWN document
// slot names (Document.documentType / the value the client's Autofill
// button actually sends - see employmentChecklists.js's h1b.employerDocuments
// / h1b.employeeDocuments and BAIS/Frontend's AUTOFILL_SOURCES), not by the
// AI-classification-oriented type names (passport/resume/i94/...) used
// inside document-intelligence/schemas + extractors.
//
// This used to be derived from field-mapping.registry.js's FIELD_MAPPINGS
// (only "passport"/"resume" ever defined there, so every other real H-1B
// document type - I-94, I-797, LCA, degree, DL/ID - was rejected with a 400
// before ever reaching extraction). Confirmed empirically (reading
// uploadAndExtractNow -> processDocument) that document classification is
// driven entirely by the AI's own independent visual judgment of the file
// (classifier.classifyWithRetry), never by this client-declared value - this
// allowlist is purely an input gate, not an extraction-routing table, so no
// separate alias/mapping layer is needed here for extraction to work; the
// classifier just needs its own DOCUMENT_TYPES/FIELD_SCHEMAS to cover these
// documents once past the gate (see document-intelligence.schema.js,
// generic-extractor.service.js).
const AUTOFILL_DOCUMENT_TYPES = [
  "passport",
  "visa",
  "i94",
  "resume",
  "cv",
  "degree",
  "transcript",
  "employment_letter",
  "experience_letter",
  "employment_verification_letter",
  "offer_letter",
  "paystub",
  "w2",
  "tax_return",
  "business_license",
  "business_registration",
  "articles_of_incorporation",
  "lca",
  "i20",
  "marriage_certificate",
  "birth_certificate",
  "supporting_evidence",
  "uscis_notice",
  "previous_uscis_form",
  "approval_notice",
  "employee_i94_copy",
  "previous_i797_notices",
  "updated_resume",
  "certified_lca_eta9035",
  "academic_certificates",
  "credential_evaluation_report",
  "employee_drivers_license_or_state_id",
];

module.exports = { AUTOFILL_DOCUMENT_TYPES };
