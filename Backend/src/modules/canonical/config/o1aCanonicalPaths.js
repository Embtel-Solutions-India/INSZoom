// Canonical paths the O-1A checklists write to that have no earlier equivalent (same mechanism as o1bCanonicalPaths.js). Scalar identity / company
// answers reuse the existing shared paths; PartyAliasService exposes them as beneficiary.* / petitioner.* for every form. ".documents." / "o1aEvidence"
// paths name WHERE an uploaded file belongs - the file itself lives in the Document model and is never copied into the profile or a PDF field.
const text = (path) => ({ path, aliases: [], type: "text" });
const O1A_CANONICAL_FIELDS = Object.freeze([
  text("petitioner.company.address"),
  text("petitioner.company.documents.blankWordLetterhead"),
  text("beneficiary.currentUSAddress"),
  text("beneficiary.foreignAddress"),
  text("beneficiary.latestPriorPetitionNumber"),
  text("beneficiary.eadNumber"),
  text("beneficiary.petitionHasValidPassport"),
  text("beneficiary.intendsToReplaceI94"),
  text("beneficiary.hasDependents"),
  text("beneficiary.dependentCount"),
  text("beneficiary.anyPersonInRemovalProceedings"),
  text("beneficiary.employerPreviouslyFiledImmigrantPetition"),
  text("beneficiary.hasPreviousO1VisaWithinSevenYears"),
  text("beneficiary.hasO1VisaDenialWithinSevenYears"),
  text("beneficiary.o1VisaDenialExplanation"),
  text("beneficiary.documents.updatedResume"),
  text("beneficiary.documents.signedSSN"),
  text("beneficiary.documents.usGovernmentId"),
  text("beneficiary.documents.educationalCredentialEvaluation"),
  text("beneficiary.documents.trainingAndDiplomaCertificates"),
  text("beneficiary.documents.priorI797NoticesAndApprovals"),
  text("beneficiary.o1aEvidence.criterion1Awards"),
  text("beneficiary.o1aEvidence.criterion2Memberships"),
  text("beneficiary.o1aEvidence.criterion3PublishedMaterialAboutBeneficiary"),
  text("beneficiary.o1aEvidence.criterion4Judging"),
  text("beneficiary.o1aEvidence.criterion5OriginalContributions"),
  text("beneficiary.o1aEvidence.criterion6ScholarlyAuthorship"),
  text("beneficiary.o1aEvidence.criterion7ExhibitionsAndShowcases"),
  text("beneficiary.o1aEvidence.criterion8LeadingOrCriticalRole"),
  text("beneficiary.o1aEvidence.criterion9HighSalaryOrRemuneration"),
  text("beneficiary.o1aEvidence.criterion10CommercialSuccesses"),
]);
module.exports = { O1A_CANONICAL_FIELDS };
