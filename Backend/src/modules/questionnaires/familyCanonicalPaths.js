// question key -> canonical path for the family (petitioner + beneficiary)
// checklists whose answers feed the I-130. Single source of truth for BOTH
//   - familyChecklists.js (stamps Question.mapping.canonicalPath onto the
//     question definitions, so a fresh/re-seeded questionnaire carries it and
//     questionnaire.service's ensureDefaultVisaTemplates reconcile heals an
//     existing one), and
//   - seeds/canonicalPathFixes.seed.js (the one-off DB patch that predates
//     this; it re-exports these maps under their original names).
//
// Namespace rule for a two-party case (see canonical/config/familyPartyPaths.js):
// person.* / contact.* = the PETITIONER, beneficiary.* = the BENEFICIARY.
// Every petitioner_* key below therefore maps into person.*/contact.* and every
// beneficiary_* key into beneficiary.* - a beneficiary answer can never be
// stamped with a person.* path.

// K-1/K-3 style key (family-workflow/questionnaires/k1.js; k3.js reuses it).
// I-129F's mapping reads these answers directly (raw.questionnaireAnswers.*);
// the canonical paths serve I-130's shared graph fallback, I-134 and the
// person-based biographic autofill.
const K_PETITIONER_MAP = {
  petitioner_info_lastName: "person.lastName",
  petitioner_info_firstName: "person.firstName",
  petitioner_info_middleName: "person.middleName",
  petitioner_info_dateOfBirth: "person.dob",
  petitioner_info_gender: "person.gender",
  petitioner_info_maritalStatus: "person.maritalStatus",
  petitioner_info_ssn: "person.ssn",
  petitioner_info_aNumber: "person.alienNumber",
  petitioner_info_cityTownOfBirth: "person.cityTownOfBirth",
  petitioner_info_countryOfBirth: "person.countryOfBirth",
  petitioner_info_countryOfCitizenship: "person.citizenship",
  petitioner_info_uscisOnlineAccountNumber: "person.uscisOnlineAccountNumber",
  petitioner_citizenship_certificateNumber: "person.certificateNumber",
  petitioner_citizenship_certificateDateOfIssuance: "person.certificateDateOfIssuance",
  petitioner_citizenship_certificatePlaceOfIssuance: "person.certificatePlaceOfIssuance",
  petitioner_info_fullPhysicalAddress: "contact.address.line1",
  // fullMailingAddress intentionally left unmapped - a single combined
  // free-text answer cannot be split into canonical street/city/state/zip here
  // (the K-1/K-3 crosswalks split it per widget with AddressParser instead).
};

const K_BENEFICIARY_MAP = {
  beneficiary_info_lastName: "beneficiary.lastName",
  beneficiary_info_firstName: "beneficiary.firstName",
  beneficiary_info_middleName: "beneficiary.middleName",
  beneficiary_info_dateOfBirth: "beneficiary.dateOfBirth",
  beneficiary_info_gender: "beneficiary.gender",
  beneficiary_info_maritalStatus: "beneficiary.maritalStatus",
  beneficiary_info_aNumber: "beneficiary.alienRegistrationNumber",
  beneficiary_info_cityTownOfBirth: "beneficiary.cityTownOfBirth",
  beneficiary_info_countryOfBirth: "beneficiary.countryOfBirth",
  beneficiary_info_countryOfCitizenship: "beneficiary.countryOfCitizenship",
  beneficiary_info_fullPhysicalAddress: "beneficiary.address",
  // beneficiary_info_ssn intentionally left unmapped - no full-SSN canonical
  // field exists (policy: never fill a PDF SSN field from a masked/partial value).
};

// IR/CR/F style key (identical question-key set across all 12
// i130_<code>_petitioner/beneficiary_checklist questionnaires).
const IR_PETITIONER_MAP = {
  petitioner_lastName: "person.lastName",
  petitioner_firstName: "person.firstName",
  petitioner_middleName: "person.middleName",
  petitioner_dateOfBirth: "person.dob",
  petitioner_gender: "person.gender",
  petitioner_maritalStatus: "person.maritalStatus",
  petitioner_ssn: "person.ssn",
  petitioner_alienNumber: "person.alienNumber",
  petitioner_naturalizationCertificateNumber: "person.certificateNumber",
  petitioner_physicalAddress: "contact.address.line1",
  // cityCountryOfBirth/naturalizationDateAndPlace intentionally left unmapped -
  // each combines two distinct concepts into one free-text answer.
};

const IR_BENEFICIARY_MAP = {
  beneficiary_lastName: "beneficiary.lastName",
  beneficiary_firstName: "beneficiary.firstName",
  beneficiary_middleName: "beneficiary.middleName",
  beneficiary_dateOfBirth: "beneficiary.dateOfBirth",
  beneficiary_maritalStatus: "beneficiary.maritalStatus",
  beneficiary_alienNumber: "beneficiary.alienRegistrationNumber",
  beneficiary_physicalAddress: "beneficiary.address",
  beneficiary_arrivalStatus: "beneficiary.currentVisaStatus",
  beneficiary_i94Number: "beneficiary.i94Number",
  beneficiary_statusExpiresOn: "beneficiary.i94ExpirationDate",
};

// The canonical-path map for a family checklist definition, by its base key:
// "k1"/"k3" -> the K-style maps; "i130_<code>" -> the IR-style maps; the Green
// Card / I-864 / GC-NVC checklists carry none (unchanged).
function canonicalMapFor(definitionKey, party) {
  const key = String(definitionKey || "");
  if (key === "k1" || key === "k3") return party === "petitioner" ? K_PETITIONER_MAP : party === "beneficiary" ? K_BENEFICIARY_MAP : {};
  if (key.startsWith("i130_")) return party === "petitioner" ? IR_PETITIONER_MAP : party === "beneficiary" ? IR_BENEFICIARY_MAP : {};
  return {};
}

module.exports = { K_PETITIONER_MAP, K_BENEFICIARY_MAP, IR_PETITIONER_MAP, IR_BENEFICIARY_MAP, canonicalMapFor };
