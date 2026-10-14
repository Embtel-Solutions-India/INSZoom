// Canonical paths the H-4 change-of-status checklist writes to that have no earlier equivalent (same mechanism as o1aCanonicalPaths.js). Scalar identity / status /
// passport answers reuse the existing shared paths. ".documents." paths name WHERE an uploaded file belongs; the file itself lives in the Document model.
const text = (path) => ({ path, aliases: [], type: "text" });
const H4_CANONICAL_FIELDS = Object.freeze([
  text("beneficiary.usMailingAddress"),
  text("beneficiary.usPhysicalAddress"),
  text("beneficiary.foreignAddress.streetAddress"),
  text("beneficiary.foreignAddress.city"),
  text("beneficiary.foreignAddress.state"),
  text("beneficiary.foreignAddress.postalCode"),
  text("beneficiary.foreignAddress.province"),
  text("beneficiary.foreignAddress.country"),
  text("application.applicationType"),
  text("application.requestedStatusRecord"),
  text("application.requestedStatus"),
  text("application.requestedStatusEffectiveDate"),
  text("application.changeOfStatusExplanation"),
  text("beneficiary.documents.passportAndI94"),
  text("beneficiary.documents.ssnCard"),
  text("beneficiary.documents.eadCard"),
  text("beneficiary.documents.usDriverLicenseOrStateId"),
  text("beneficiary.documents.allApprovalNotices"),
  text("beneficiary.documents.relationshipToH1BPrincipal"),
  text("principalH1B.documents.passportPaystubsAndLatestApprovalNotice"),
]);
module.exports = { H4_CANONICAL_FIELDS };
