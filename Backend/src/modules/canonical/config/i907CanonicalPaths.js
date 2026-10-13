// Canonical paths the Form I-907 (Premium Processing) checklist writes to. Same extension mechanism as permCanonicalPaths.js / i90CanonicalPaths.js:
// ANY question.mapping.canonicalPath is promoted into Case.canonicalProfile verbatim, so a path only has to be REGISTERED.
//
// requestFiler.* is the person (or company representative) who FILES the I-907 - deliberately NOT person.*: on a Premium Processing upgrade the
// case's own person.* is the petition's beneficiary / applicant, and the filer's A-Number, name and address must never overwrite it (the I-907
// mapping graph's own regression test guards the same boundary). premiumProcessing.* holds facts about the request and its related case.

const I907_CANONICAL_FIELDS = Object.freeze([
  { path: "requestFiler.alienNumber", aliases: [], type: "text" },
  { path: "requestFiler.uscisOnlineAccountNumber", aliases: [], type: "text" },
  { path: "requestFiler.lastName", aliases: [], type: "text" },
  { path: "requestFiler.firstName", aliases: [], type: "text" },
  { path: "premiumProcessing.companyOrOrganizationName", aliases: [], type: "text" },
  { path: "requestFiler.mailingAddress.streetAddress", aliases: [], type: "text" },
  { path: "requestFiler.mailingAddress.addressLine2", aliases: [], type: "text" },
  { path: "requestFiler.mailingAddress.city", aliases: [], type: "text" },
  { path: "requestFiler.mailingAddress.state", aliases: [], type: "text" },
  { path: "requestFiler.mailingAddress.zipCode", aliases: [], type: "text" },
  { path: "requestFiler.mailingAddress.province", aliases: [], type: "text" },
  { path: "requestFiler.mailingAddress.postalCode", aliases: [], type: "text" },
  { path: "requestFiler.mailingAddress.country", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.sameAsMailingAddress", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.streetAddress", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.addressLine2", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.city", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.state", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.zipCode", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.province", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.postalCode", aliases: [], type: "text" },
  { path: "requestFiler.physicalAddress.country", aliases: [], type: "text" },
  { path: "premiumProcessing.relatedCase.formNumber", aliases: [], type: "text" },
  { path: "premiumProcessing.relatedCase.receiptNumbers[0]", aliases: [], type: "text" },
  { path: "premiumProcessing.relatedCase.receiptNumbers[1]", aliases: [], type: "text" },
  { path: "premiumProcessing.relatedCase.petitionerOrApplicant.lastName", aliases: [], type: "text" },
  { path: "premiumProcessing.relatedCase.petitionerOrApplicant.firstName", aliases: [], type: "text" },
  { path: "premiumProcessing.relatedCase.beneficiary.lastName", aliases: [], type: "text" },
  { path: "premiumProcessing.relatedCase.beneficiary.firstName", aliases: [], type: "text" },
  { path: "premiumProcessing.companyPointOfContact.lastName", aliases: [], type: "text" },
  { path: "premiumProcessing.companyPointOfContact.firstName", aliases: [], type: "text" },
  { path: "premiumProcessing.companyPointOfContact.positionTitle", aliases: [], type: "text" },
  { path: "premiumProcessing.companyOrOrganization.ein", aliases: [], type: "text" },
  { path: "premiumProcessing.documents.relatedCaseReceiptNotice", aliases: [], type: "text" },
]);

module.exports = { I907_CANONICAL_FIELDS };
