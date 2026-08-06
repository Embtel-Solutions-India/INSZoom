// H-1B/L-1A OCR-autofill allowlist. Keyed by each checklist's OWN document
// slot names (Document.documentType / the value the client's Autofill
// button actually sends - see employmentChecklists.js's h1b.employerDocuments
// / h1b.employeeDocuments / l1a.employerDocuments / l1a.employeeDocuments
// and BAIS/Frontend's AUTOFILL_SOURCES), not by the AI-classification-oriented
// type names (passport/resume/i94/...) used inside document-intelligence/
// schemas + extractors.
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

  // --- L-1A (employment-workflow/questionnaires/l1a.js) ---
  "us_articles_of_incorporation",
  "ein_assignment_letter",
  "us_statement_of_information",
  "us_business_license",
  "us_lease_agreement",
  "us_business_premises_photographs",
  "us_company_website",
  "us_company_brochure",
  "us_commercial_transaction_documents",
  "us_federal_tax_return",
  "us_bank_statements",
  "us_business_plan",
  "us_stock_ownership_certificates",
  "us_organizational_chart",
  "us_beneficiary_duties_letter",
  "us_company_letterhead",
  "foreign_business_registration",
  "foreign_lease_agreement",
  "foreign_business_premises_photographs",
  "foreign_company_website",
  "foreign_company_brochure",
  "foreign_business_transaction_documents",
  "foreign_tax_returns",
  "foreign_bank_statements",
  "us_foreign_relationship_evidence",
  "beneficiary_offer_letter",
  "beneficiary_foreign_pay_stubs",
  "minutes_dispatching_beneficiary",
  "beneficiary_correspondence_evidence",
  "foreign_company_letterhead",
  "foreign_employer_org_chart",
  "foreign_employment_verification_letter",
  "last_3_months_pay_slips",
  "loi_mou_signed_contracts",

  // --- K-1 (family-workflow/questionnaires/k1.js) ---
  "petitioner_us_passport",
  "petitioner_naturalization_citizenship_birth_certificate",
  "petitioner_ssn_copy",
  "petitioner_drivers_license_or_state_id",
  "petitioner_passport_photos_hard_copy",
  "petitioner_met_in_person_photos",
  "petitioner_travel_itinerary",
  "petitioner_intent_to_marry_letter",
  "petitioner_marriage_termination_documents",
  "beneficiary_passport_copy",
  "beneficiary_passport_photos_hard_copy",
  "beneficiary_intent_to_marry_letter",
  "beneficiary_marriage_termination_documents",

  // --- K-3 (family-workflow/questionnaires/k3.js) - additions beyond what K-1 already covers ---
  "petitioner_i130_receipt_notice",
  "petitioner_marriage_certificate_and_photos",
  "beneficiary_national_identity_card",
];

module.exports = { AUTOFILL_DOCUMENT_TYPES };
