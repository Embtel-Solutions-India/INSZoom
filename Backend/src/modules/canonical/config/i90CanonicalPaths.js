// Canonical paths the Form I-90 (Green Card renewal / replacement / correction / update) checklist writes to that the shared registry
// (CanonicalFieldRegistryService.BASE_FIELDS) did not know yet. Same extension mechanism as permCanonicalPaths.js: ANY
// question.mapping.canonicalPath is promoted into Case.canonicalProfile verbatim by CanonicalBuilderService.addQuestionnaireCandidates,
// so a path only has to be REGISTERED (so checklist health, the mapping-graph editor and the autofill matcher recognise it).
//
// Rules followed here:
//   - the I-90 applicant is the person FILING the form (a self-filing green-card holder, not a petitioned-for beneficiary), so the
//     applicant lives in the filer namespaces the registry already defines: person.* (identity / biographic), contact.* (addresses,
//     phone, email) and immigration.* (admission / card facts). beneficiary.* is the petitioned-for-person namespace and is NOT used;
//   - nothing below duplicates an existing concept: name, A-Number, SSN, USCIS Online Account Number, date / city / country of birth,
//     mailing address, phone and email are already registered (person.firstName, person.alienNumber, person.ssn, ... contact.address.*)
//     and are reused by greenCardRenewalChecklist.js directly;
//   - no path is named after a form or one of its PDF fields (nothing like i90.* or formI90.*): USCIS field identifiers live only in
//     the mapping layer (form-mapping/config/i90-crosswalk.js);
//   - the physical address is its own object (contact.physicalAddress.*) so it never overwrites the mailing address (contact.address.*);
//   - path names are chosen around CanonicalTransformationService.normalizeByPath, which normalises a value by what its PATH looks like
//     (a path ending in "name" is Title-Cased, one containing "date" is ISO-formatted, "state"/"province" is upper-cased, "has*" becomes a
//     boolean, ...). The yes / no flags below deliberately avoid those shapes so they stay the plain strings "yes" / "no".

const I90_CANONICAL_FIELDS = Object.freeze([
  // ── Person: name as printed on the current card (only when the legal name changed since the card was issued) ─────────────────────
  { path: "person.nameChangedSinceCardIssuance", aliases: ["name legally changed since the issuance of your card"], type: "text" },
  { path: "person.nameOnCard.lastName", aliases: ["name on card family name", "name exactly as printed on your card"], type: "text" },
  { path: "person.nameOnCard.firstName", aliases: ["name on card given name"], type: "text" },
  { path: "person.nameOnCard.middleName", aliases: ["name on card middle name"], type: "text" },
  { path: "person.nameOnCard.middleNameProvided", aliases: [], type: "text" },

  // ── Person: "do you have one?" flags. They gate the optional answers of the checklist and let the form mapping print a value only
  // while its gate still says yes (a client who changes a gate answer later must not leave a stale value on the form). Values: yes / no.
  { path: "person.middleNameProvided", aliases: [], type: "text" },
  { path: "person.ssnProvided", aliases: [], type: "text" },
  { path: "person.uscisAccountProvided", aliases: [], type: "text" },

  // ── Person: parents (the I-90 asks for the given name only) ─────────────────────────────────────────────────────────────────────
  { path: "person.mother.firstName", aliases: ["mother given name", "mother's first name"], type: "text" },
  { path: "person.father.firstName", aliases: ["father given name", "father's first name"], type: "text" },

  // ── Person: biographic information ──────────────────────────────────────────────────────────────────────────────────────────────
  { path: "person.ethnicity", aliases: ["ethnicity", "hispanic or latino"], type: "text" },
  { path: "person.race", aliases: ["race"], type: "array" },
  { path: "person.height.feet", aliases: ["height feet"], type: "number" },
  { path: "person.height.inches", aliases: ["height inches"], type: "number" },
  { path: "person.weightPounds", aliases: ["weight pounds", "weight in pounds"], type: "number" },
  { path: "person.eyeColor", aliases: ["eye color", "eye colour"], type: "text" },
  { path: "person.hairColor", aliases: ["hair color", "hair colour"], type: "text" },

  // ── Contact: address extras (the mailing address itself is contact.address.*) ───────────────────────────────────────────────────
  { path: "contact.address.unitType", aliases: ["mailing address unit type", "apartment suite or floor type"], type: "text" },
  { path: "contact.address.postalCode", aliases: ["mailing address postal code non us"], type: "text" },
  { path: "contact.physicalAddressDifferent", aliases: ["physical address different from mailing address"], type: "text" },
  { path: "contact.physicalAddress.line1", aliases: ["physical address street number and name"], type: "text" },
  { path: "contact.physicalAddress.unitType", aliases: ["physical address unit type"], type: "text" },
  { path: "contact.physicalAddress.line2", aliases: ["physical address apartment suite or floor number"], type: "text" },
  { path: "contact.physicalAddress.city", aliases: ["physical address city or town"], type: "text" },
  { path: "contact.physicalAddress.state", aliases: ["physical address state"], type: "text" },
  { path: "contact.physicalAddress.zip", aliases: ["physical address zip code"], type: "text" },
  { path: "contact.physicalAddress.province", aliases: ["physical address province"], type: "text" },
  { path: "contact.physicalAddress.postalCode", aliases: ["physical address postal code"], type: "text" },
  { path: "contact.physicalAddress.country", aliases: ["physical address country"], type: "text" },

  // ── Immigration: how and when permanent residence was obtained ──────────────────────────────────────────────────────────────────
  { path: "immigration.residentStatusType", aliases: ["permanent resident status type", "lawful permanent resident commuter conditional"], type: "text" },
  { path: "immigration.classOfAdmission", aliases: ["class of admission"], type: "text" },
  { path: "immigration.dateOfAdmission", aliases: ["date of admission", "date of admission or adjustment"], type: "date" },
  { path: "immigration.greenCardPath", aliases: ["entered with immigrant visa or adjusted status"], type: "text" },
  { path: "immigration.greenCardApplicationLocation", aliases: ["location where you applied for an immigrant visa or adjustment of status"], type: "text" },
  { path: "immigration.cardIssuanceLocation", aliases: ["location where your immigrant visa was issued or uscis office where adjustment was granted"], type: "text" },
  { path: "immigration.destinationAtAdmission", aliases: ["destination in the united states at time of admission"], type: "text" },
  { path: "immigration.portOfEntry.city", aliases: ["port of entry city or town"], type: "text" },
  { path: "immigration.portOfEntry.state", aliases: ["port of entry state"], type: "text" },
  { path: "immigration.removalProceedings", aliases: ["exclusion deportation or removal proceedings"], type: "text" },
  { path: "immigration.removalProceedingsExplanation", aliases: ["removal proceedings explanation"], type: "text" },
  { path: "immigration.abandonmentDetermination", aliases: ["filed form i-407 or determined to have abandoned status"], type: "text" },
  { path: "immigration.abandonmentExplanation", aliases: ["abandonment of status explanation"], type: "text" },

  // ── Immigration: the green card itself and why it is being renewed / replaced / corrected / updated ─────────────────────────────
  { path: "immigration.greenCard.applicationReason", aliases: ["reason for replacing the green card", "renewal replacement correction or update"], type: "text" },
  { path: "immigration.greenCard.expirationDate", aliases: ["green card expiration date", "permanent resident card expiration"], type: "date" },
  { path: "immigration.greenCard.replacementCircumstance", aliases: ["lost stolen destroyed mutilated or never received"], type: "text" },
  { path: "immigration.greenCard.incidentDate", aliases: ["date the card was lost stolen or destroyed"], type: "date" },
  { path: "immigration.greenCard.incidentDescription", aliases: ["what happened to the card"], type: "text" },
  { path: "immigration.greenCard.cardAvailableToSubmit", aliases: ["damaged card available to submit"], type: "text" },
  { path: "immigration.greenCard.correctionCause", aliases: ["cause of the incorrect information on the card"], type: "text" },
  { path: "immigration.greenCard.corrections", aliases: ["incorrect information on the card"], type: "array" },
  { path: "immigration.greenCard.biographicChange.type", aliases: ["what biographic information changed"], type: "text" },
  { path: "immigration.greenCard.biographicChange.previousValue", aliases: ["previous value of the changed information"], type: "text" },
  { path: "immigration.greenCard.biographicChange.newValue", aliases: ["new value of the changed information"], type: "text" },
  { path: "immigration.greenCard.biographicChange.effectiveDate", aliases: ["effective date of the legal change"], type: "date" },
  { path: "immigration.greenCard.biographicChange.legalDocument", aliases: ["legal document supporting the change"], type: "text" },
  { path: "immigration.greenCard.previousCardAvailable", aliases: ["has previous permanent resident card"], type: "text" },
  { path: "person.stateIdentificationAvailable", aliases: ["has driver license or state identification card"], type: "text" },
  { path: "immigration.greenCard.otherReason", aliases: ["other reason permitted by the form"], type: "text" },
  { path: "immigration.commuterPortOfEntry.city", aliases: [], type: "text" },
  { path: "immigration.commuterPortOfEntry.state", aliases: [], type: "text" },

  // ── Accessibility: Part 4 of the form (accommodations for disabilities and/or impairments) ──────────────────────────────────────
  { path: "person.accommodation.requested", aliases: ["requesting an accommodation because of a disability"], type: "text" },
  { path: "person.accommodation.types", aliases: ["accommodation types"], type: "array" },
  { path: "person.accommodation.deafDetails", aliases: ["deaf or hard of hearing accommodation"], type: "text" },
  { path: "person.accommodation.blindDetails", aliases: ["blind or low vision accommodation"], type: "text" },
  { path: "person.accommodation.otherDetails", aliases: ["other disability or impairment and accommodation requested"], type: "text" },
]);

module.exports = { I90_CANONICAL_FIELDS };
