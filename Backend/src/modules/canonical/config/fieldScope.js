// Canonical profile paths that describe the CURRENT case/petition, not an
// immutable fact about the person. A person's Beneficiary/Client record is
// shared across every case they have (Case.beneficiary is a many-cases-to-one
// pointer) and gets written to per-case by client-intake (see
// client-intake.service.js's flattenIntakeData + the beneficiary-sync it
// triggers) - so anything case-scoped that ends up stored on that shared
// record must never be read back into a DIFFERENT case's canonicalProfile.
//
// Centralized here (rather than special-cased per question/mapping) so any
// new beneficiary-sourced entry added later to CanonicalBuilderService's
// DATABASE_FIELD_MAP is automatically protected without a matching code
// change - just add its target path to this set if it's petition-specific.
//
// Identity/history facts (name, DOB, passport, nationality, prior addresses,
// prior education, prior immigration history) are intentionally NOT listed
// here - those are safe, and expected, to carry over between a person's cases.
const CASE_SCOPED_CANONICAL_PATHS = new Set([
  // Petition-specific employer/wage/offer details - a new case (new employer,
  // new petition) must start with none of these until answered for THIS case.
  "employment",
  // "Current" immigration status/visa type as understood by a specific
  // petition's processing, not a durable identity fact.
  "immigration.currentStatus",
  "immigration.currentVisaType",
]);

module.exports = { CASE_SCOPED_CANONICAL_PATHS };
