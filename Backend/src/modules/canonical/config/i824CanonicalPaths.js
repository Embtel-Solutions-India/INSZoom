// Canonical paths the I-824 petitioner / beneficiary checklists write to (same mechanism as h4CanonicalPaths.js). Three distinct person namespaces:
//   petitioner.*          the person who filed the approved petition (Form I-824 Part 1)
//   principalImmigrant.*  the principal applicant of the approved petition (Part 3 Items 2-4) - collected inside the PETITIONER checklist, never the beneficiary's
//   beneficiary.*         the derivative beneficiary (Part 3 Items 5-10 / 33-34)
// ".documents." paths name WHERE an uploaded file belongs; the file itself lives in the Document model.
const text = (path) => ({ path, aliases: [], type: "text" });
const ADDRESS_PARTS = ["line1", "line2", "city", "state", "postalCode", "country"];
const address = (root) => [text(root), ...ADDRESS_PARTS.map((part) => text(`${root}.${part}`))];

const PERSON_SCALARS = ["lastName", "firstName", "middleName", "dateOfBirth", "countryOfBirth", "countryOfCitizenship", "aNumber"];
const PETITIONER_ONLY = ["organizationName", "currentImmigrationStatus", "citizenshipCertificateNumber", "irsTaxNumber", "ssn", "uscisOnlineAccountNumber"];

const I824_CANONICAL_FIELDS = Object.freeze([
  ...PERSON_SCALARS.map((name) => text(`petitioner.${name}`)),
  ...PETITIONER_ONLY.map((name) => text(`petitioner.${name}`)),
  ...address("petitioner.mailingAddress"),
  ...address("petitioner.physicalAddress"),
  ...PERSON_SCALARS.map((name) => text(`principalImmigrant.${name}`)),
  text("principalImmigrant.daytimeTelephoneNumber"),
  ...address("principalImmigrant.mailingAddress"),
  ...address("principalImmigrant.physicalAddress"),
  text("beneficiary.relationshipToPrincipalApplicant"),
  text("beneficiary.daytimeTelephoneNumber"),
  text("beneficiary.foreignTelephoneNumber"),
  ...address("beneficiary.foreignAddress").filter((field) => field.path === "beneficiary.foreignAddress" || /\.(line1|line2|city|state|postalCode|country)$/.test(field.path)),
  ...["citizenshipCertificate", "greenCard", "passport", "ssnCard", "stateId", "i130ApprovalNotice"].map((name) => text(`petitioner.documents.${name}`)),
  ...["passport", "greenCard", "ssnCard", "stateId", "relationshipEvidence"].map((name) => text(`principalImmigrant.documents.${name}`)),
  ...["passport", "relationshipEvidence"].map((name) => text(`beneficiary.documents.${name}`)),
]);

module.exports = { I824_CANONICAL_FIELDS };
