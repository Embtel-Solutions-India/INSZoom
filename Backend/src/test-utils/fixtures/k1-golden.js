// K-1 golden fixture, mirroring l1a-golden.js's shape. Keys derived the same
// way (fieldCatalog path with dots -> underscores) against k1.js's real
// fieldCatalog() paths - verified offline in i129f-k1-crosswalk-coverage.test.js.
const BASE = {
  caseNumber: "K1-2025-GOLDEN",
  visaType: "K-1",
  petitioner: {
    lastName: "Whitfield", firstName: "Daniel", middleName: "",
    dateOfBirth: "1985-04-12", gender: "Male",
    cityTownOfBirth: "Columbus", stateProvinceOfBirth: "OH", countryOfCitizenship: "United States",
    maritalStatus: "single",
  },
  beneficiary: {
    lastName: "Fontaine", firstName: "Elise", middleName: "",
    dateOfBirth: "1990-09-30", gender: "Female",
    cityTownOfBirth: "Lyon", countryOfBirth: "France", countryOfCitizenship: "France",
    maritalStatus: "single",
  },
};

function petitionerAnswers(fixture = BASE) {
  return {
    petitioner_info_lastName: fixture.petitioner.lastName,
    petitioner_info_firstName: fixture.petitioner.firstName,
    petitioner_info_dateOfBirth: fixture.petitioner.dateOfBirth,
    petitioner_info_gender: fixture.petitioner.gender,
    petitioner_info_cityTownOfBirth: fixture.petitioner.cityTownOfBirth,
    petitioner_info_stateProvinceOfBirth: fixture.petitioner.stateProvinceOfBirth,
    petitioner_info_countryOfBirth: "United States",
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
    beneficiary_metWithinTwoYears: "Yes",
  };
}

module.exports = { BASE, petitionerAnswers, beneficiaryAnswers };
