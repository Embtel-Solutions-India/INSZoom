// K-3 (spouse of a U.S. citizen) — REAL, verbatim petitioner + beneficiary
// checklist content (replaces the prior minimal scaffold). Mirrors the shape
// of k1.js (key, matches, *Documents, fieldCatalog()) so both remain
// self-contained, independent entries in registry.js — the employer/employee
// path is never read from or written to here.
//
// Q&A CONTENT: per the K-3 content spec, every field/section/repeating-group/
// conditional in the K-3 petitioner (sections 1-9) and beneficiary (sections
// 1-14, minus the header) checklists is IDENTICAL to the already-authored
// and signed-off K-1 content - the spec explicitly says to take the K-1
// field content as the source of truth and replicate it field-for-field.
// Reusing k1's fieldCatalog()/REPEATABLE_FIELDS directly (rather than
// hand-retyping ~90 field entries into a second copy) is the most faithful
// possible form of that replication - it is impossible for the two to drift,
// which hand-transcription cannot guarantee. This does NOT share K-1's
// TEMPLATE RECORDS: familyChecklists.js still provisions K-3 as its own,
// fully separate Questionnaire/Question documents (own `key`s, own
// `visaType: "K3"`, own document lists below) - only the Q&A-generating
// source function is shared, exactly as l1a.js's business-plan checklist
// reuses l1a.fieldCatalog() without that being "sharing a template" with
// L-1A's employer checklist. Flagged at sign-off as an interpretation call.
const k1 = require("./k1");

const key = "k3";

function matches(value) {
  return /^k[\s-]?3$/i.test(String(value || "").trim());
}

// "Petitioner Documents — 'From US Sponsor/ Petitioner:'" — verbatim, 8
// items, K-3's own marriage-based list (K-1's met-in-person group and
// 90-day intent-to-marry letter do NOT appear here; K-3 instead adds the
// I-130 receipt notice and the marriage certificate/photos item).
const petitionerDocuments = [
  { name: "Copy of U.S passport", documentType: "petitioner_us_passport", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of US Naturalization/ Citizenship/ Birth certificate", documentType: "petitioner_naturalization_citizenship_birth_certificate", required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of SSN", documentType: "petitioner_ssn_copy", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of Driver's license or State Identification card", documentType: "petitioner_drivers_license_or_state_id", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Passport photos(2pcs) of the petitioner- Hard copy", documentType: "petitioner_passport_photos_hard_copy", required: false, category: "identity", targetRole: "petitioner", status: "requested", hardCopy: true },
  { name: "Copy of I-130 receipt notice", documentType: "petitioner_i130_receipt_notice", required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of marriage certificate and marriage photos", documentType: "petitioner_marriage_certificate_and_photos", required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Marriage termination documents (such as divorce decrees, death certificate), if applicable", documentType: "petitioner_marriage_termination_documents", required: false, category: "immigration", targetRole: "petitioner", status: "requested" },
];

// "Documents required from Beneficiary:" — verbatim, 4 items, K-3's own list
// (adds National identity card; does NOT have K-1's 90-day intent-to-marry
// letter, since K-3 beneficiaries are already married to the petitioner).
const beneficiaryDocuments = [
  { name: "Copy of Passport of the beneficiary", documentType: "beneficiary_passport_copy", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "National identity card", documentType: "beneficiary_national_identity_card", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "Passport size photos(2pcs) of the beneficiary- Hard copy", documentType: "beneficiary_passport_photos_hard_copy", required: false, category: "identity", targetRole: "beneficiary", status: "requested", hardCopy: true },
  { name: "Marriage termination documents (such as divorce decrees, death certificate), if applicable", documentType: "beneficiary_marriage_termination_documents", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
];

// Identical Q&A content to K-1 (see file banner) — reused directly, not
// retyped, so it can never drift from the signed-off source.
const fieldCatalog = k1.fieldCatalog;
const REPEATABLE_FIELDS = k1.REPEATABLE_FIELDS;

module.exports = { key, matches, petitionerDocuments, beneficiaryDocuments, fieldCatalog, REPEATABLE_FIELDS };
