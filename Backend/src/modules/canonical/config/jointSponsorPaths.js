// Canonical paths for a JOINT SPONSOR (the individual who agrees to financially support the beneficiary - Form I-134 Part 2 / Part 5, Form I-864 joint sponsor), under BOTH party roots:
//   petitioner.jointSponsor.*   family cases: the petitioner supplies the joint sponsor's details (their checklist is sent to the petitioner only)
//   beneficiary.jointSponsor.*  employer-employee cases: the employee (the beneficiary) supplies them
// A form box reads the petitioner path first and falls back to the beneficiary path (PartRuleInferenceService), so whichever party filled the checklist in is the one that fills the form.
// Never a third party root (docs/GENERIC_PARTY_CANONICAL_MODEL.md). Registered additively in CanonicalFieldRegistryService: a path that is already registered keeps its own entry.
const ROOTS = Object.freeze(["petitioner.jointSponsor", "beneficiary.jointSponsor"]);

// [fact, type]
const FACTS = Object.freeze([
  ["lastName", "text"],
  ["firstName", "text"],
  ["middleName", "text"],
  ["dateOfBirth", "date"],
  ["ssn", "ssn"],
  ["aNumber", "alienNumber"],
  ["email", "email"],
  ["phone", "phone"],
  ["mobilePhone", "phone"],
  ["mailingAddress", "text"], // one composite address answer, split into the form's boxes by the "address" transform
  ["relationshipToPetitioner", "text"],
]);

const JOINT_SPONSOR_FIELDS = Object.freeze(ROOTS.flatMap((root) => FACTS.map(([fact, type]) => Object.freeze({ path: `${root}.${fact}`, aliases: [], type }))));

module.exports = { JOINT_SPONSOR_FIELDS, ROOTS, FACTS };
