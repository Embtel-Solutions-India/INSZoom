// Canonical paths the O-1B checklists write to that have no earlier equivalent. Same extension mechanism as eb1cCanonicalPaths.js: any
// question.mapping.canonicalPath is promoted into Case.canonicalProfile verbatim, so a path only has to be REGISTERED here.
// Scalar identity / company / address answers deliberately reuse the EXISTING shared paths (person.*, contact.*, immigration.*, company.*,
// employment.*) so every form mapping keeps working; PartyAliasService then exposes them as beneficiary.* / petitioner.*.
// A ".documents." / "o1bEvidence" path names WHERE an uploaded file belongs; the file itself lives in the Document model and is never copied
// into the canonical profile or into a scalar PDF field.
const text = (path) => ({ path, aliases: [], type: "text" });

const O1B_CANONICAL_FIELDS = Object.freeze([
  text("petitioner.company.documents.articlesOfIncorporation"),
  text("petitioner.company.documents.businessLicense"),
  text("petitioner.company.documents.blankLetterheadWordFile"),
  text("employment.workLocations"),
  text("beneficiary.otherNames"),
  text("beneficiary.consularProcessing.consulateCityCountry"),
  text("beneficiary.immigration.petitionHasValidPassport"),
  text("beneficiary.immigration.intendToReplaceI94"),
  text("beneficiary.dependents"),
  text("beneficiary.immigration.anyPersonInRemovalProceedings"),
  text("beneficiary.immigration.petitionerPreviouslyFiledImmigrantPetition"),
  text("beneficiary.immigration.o1VisaIssuedInPastSevenYears"),
  text("beneficiary.immigration.o1VisaDeniedInPastSevenYears"),
  text("beneficiary.immigration.o1VisaDenialExplanation"),
  text("beneficiary.immigration.priorI797Notices"),
  text("beneficiary.documents.i94"),
  text("beneficiary.documents.passport"),
  text("beneficiary.documents.resumeCv"),
  text("beneficiary.documents.signedSsnCopy"),
  text("beneficiary.documents.usDriversLicenseOrStateId"),
  text("beneficiary.documents.academicCertificatesAndTranscripts"),
  text("beneficiary.documents.trainingDiplomaCertificates"),
  text("beneficiary.documents.awardsAppraisalsAchievementsCertifications"),
  text("beneficiary.documents.previousWorkExperienceLetters"),
  text("beneficiary.o1bEvidence.criterion1LeadOrStarringParticipation"),
  text("beneficiary.o1bEvidence.criterion2NationalInternationalRecognition"),
  text("beneficiary.o1bEvidence.criterion3DistinguishedOrganizationRole"),
  text("beneficiary.o1bEvidence.criterion4CommercialOrCriticalSuccess"),
  text("beneficiary.o1bEvidence.criterion5SignificantRecognition"),
  text("beneficiary.o1bEvidence.criterion6HighSalaryOrRemuneration"),
]);

module.exports = { O1B_CANONICAL_FIELDS };
