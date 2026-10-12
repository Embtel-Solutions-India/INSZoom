// Canonical paths the SB-1 (Returning Resident) questionnaire writes to that the shared registry (CanonicalFieldRegistryService.BASE_FIELDS)
// did not know yet. Same extension mechanism as permCanonicalPaths.js / i90CanonicalPaths.js: ANY question.mapping.canonicalPath is promoted
// into Case.canonicalProfile verbatim, so a path only has to be REGISTERED. The questionnaire is internal client intake, NOT a form source:
// nothing here is read by any government-form mapping, and no SB-1 questionnaire field is mapped to a PDF.
//
// Reused (already registered, so not listed): person.firstName / middleName / lastName / dob / cityTownOfBirth / countryOfBirth /
// maritalStatus / alienNumber, contact.address.* / contact.phone, family.spouse.firstName / lastName. The proposed person.dateOfBirth,
// person.currentAddress, person.birthPlace.country and immigration.aNumber therefore map onto person.dob, contact.address.*,
// person.countryOfBirth and person.alienNumber (the same facts).

const SB1_CANONICAL_FIELDS = Object.freeze([
  { path: "person.otherNames", aliases: [], type: "array" },
  { path: "person.birthPlace.stateProvince", aliases: [], type: "text" },
  { path: "immigration.reentryPermitHeld", aliases: [], type: "text" },
  { path: "family.spouse.middleName", aliases: [], type: "text" },
  { path: "family.spouse.address.line1", aliases: [], type: "text" },
  { path: "family.spouse.address.line2", aliases: [], type: "text" },
  { path: "family.spouse.address.city", aliases: [], type: "text" },
  { path: "family.spouse.address.state", aliases: [], type: "text" },
  { path: "family.spouse.address.zip", aliases: [], type: "text" },
  { path: "family.spouse.address.country", aliases: [], type: "text" },
  { path: "family.spouse.birthPlace.city", aliases: [], type: "text" },
  { path: "family.spouse.birthPlace.stateProvince", aliases: [], type: "text" },
  { path: "family.spouse.birthPlace.country", aliases: [], type: "text" },
  { path: "family.spouse.dateOfBirth", aliases: [], type: "date" },
  { path: "family.spouse.usResidenceStatus", aliases: [], type: "text" },
  { path: "family.spouse.marriageDate", aliases: [], type: "date" },
  { path: "familyMembersInUS", aliases: [], type: "array" },
  { path: "immigration.previousImmigrationCategory", aliases: [], type: "text" },
  { path: "immigration.previousImmigrantVisa.issueDate", aliases: [], type: "date" },
  { path: "immigration.previousImmigrantVisa.placeOfIssue", aliases: [], type: "text" },
  { path: "immigration.adjustmentOfStatus.completed", aliases: [], type: "text" },
  { path: "immigration.adjustmentOfStatus.date", aliases: [], type: "date" },
  { path: "immigration.adjustmentOfStatus.place", aliases: [], type: "text" },
  { path: "immigration.permanentResidentHistory.initialEntry.date", aliases: [], type: "date" },
  { path: "immigration.permanentResidentHistory.initialEntry.portOfEntry", aliases: [], type: "text" },
  { path: "immigration.permanentResidentHistory.lastEntry.date", aliases: [], type: "date" },
  { path: "immigration.permanentResidentHistory.lastEntry.portOfEntry", aliases: [], type: "text" },
  { path: "immigration.permanentResidentHistory.mostRecentDeparture.date", aliases: [], type: "date" },
  { path: "immigration.permanentResidentHistory.mostRecentDeparture.destination", aliases: [], type: "text" },
  { path: "immigration.permanentResidentHistory.mostRecentDeparture.reason", aliases: [], type: "text" },
  { path: "immigration.returningResident.continuingUSTiesAndRetentionEfforts", aliases: [], type: "text" },
  { path: "immigration.returningResident.reasonsForDelayedReturn", aliases: [], type: "text" },
  { path: "immigration.residenceAbroadPeriods", aliases: [], type: "array" },
  { path: "immigration.returningResident.employmentOutsideUS.sinceMostRecentDeparture", aliases: [], type: "text" },
  { path: "immigration.returningResident.employmentOutsideUS.records", aliases: [], type: "array" },
]);

module.exports = { SB1_CANONICAL_FIELDS };
