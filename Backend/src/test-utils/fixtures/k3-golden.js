// K-3 golden fixture. Reuses k1's fieldCatalog paths (k3.js reuses k1.js's
// fieldCatalog by reference), so question keys are byte-identical to
// k1-golden.js's - only the case visaType and target form differ.
const BASE = {
  caseNumber: "K3-2025-GOLDEN",
  visaType: "K-3",
  petitioner: {
    lastName: "Alvarez", firstName: "Marcus", middleName: "",
    dateOfBirth: "1982-02-19", gender: "Male",
    cityTownOfBirth: "Austin", countryOfBirth: "United States", countryOfCitizenship: "United States",
    maritalStatus: "married",
  },
  beneficiary: {
    lastName: "Alvarez", firstName: "Camila", middleName: "",
    dateOfBirth: "1989-06-05", gender: "Female",
    cityTownOfBirth: "Guadalajara", countryOfBirth: "Mexico", countryOfCitizenship: "Mexico",
    maritalStatus: "married",
  },
};

function petitionerAnswers(fixture = BASE) {
  return {
    petitioner_info_lastName: fixture.petitioner.lastName,
    petitioner_info_firstName: fixture.petitioner.firstName,
    petitioner_info_dateOfBirth: fixture.petitioner.dateOfBirth,
    petitioner_info_gender: fixture.petitioner.gender,
    petitioner_info_cityTownOfBirth: fixture.petitioner.cityTownOfBirth,
    petitioner_info_countryOfBirth: fixture.petitioner.countryOfBirth,
    petitioner_info_countryOfCitizenship: fixture.petitioner.countryOfCitizenship,
    petitioner_info_maritalStatus: fixture.petitioner.maritalStatus,
  };
}

function beneficiaryAnswers(fixture = BASE) {
  return {
    beneficiary_info_lastName: fixture.beneficiary.lastName,
    beneficiary_info_firstName: fixture.beneficiary.firstName,
    beneficiary_info_dateOfBirth: fixture.beneficiary.dateOfBirth,
    beneficiary_info_gender: fixture.beneficiary.gender,
    beneficiary_info_cityTownOfBirth: fixture.beneficiary.cityTownOfBirth,
    beneficiary_info_countryOfBirth: fixture.beneficiary.countryOfBirth,
    beneficiary_info_countryOfCitizenship: fixture.beneficiary.countryOfCitizenship,
    beneficiary_info_maritalStatus: fixture.beneficiary.maritalStatus,
  };
}

module.exports = { BASE, petitionerAnswers, beneficiaryAnswers };
