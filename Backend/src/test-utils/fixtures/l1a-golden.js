// L-1A golden fixture, mirroring h1b-golden.js's shape and convention. Key
// names are derived the same way employmentChecklists.js derives them for
// any visa type (fieldCatalog path with dots replaced by underscores - see
// employmentChecklists.js's fieldQuestionsFromCatalog), but against l1a.js's
// OWN fieldCatalog() paths, which differ from h1b.js's for the employer/US
// company identity fields ("employer.usCompany.*"/"employer.foreignCompany.*"
// vs h1b.js's "employer.company.*" - see the KNOWN GAP note in
// i129-h1b-crosswalk.js's Part 1 section).
const BASE = {
  caseNumber: "L1A-2025-GOLDEN",
  visaType: "L-1A",
  usCompany: {
    name: "Meridian Analytics Inc",
    ein: "84-1234567",
  },
  foreignCompany: {
    name: "Meridian Analytics Private Limited",
    address: { street: "12 MG Road", city: "Bengaluru", stateProvince: "Karnataka", zipPostalCode: "560001", country: "India" },
    employmentStartDate: "2022-06-01",
    employmentEndDate: "2026-05-31",
    relationshipType: "Subsidiary",
  },
  beneficiary: {
    firstName: "Priya", lastName: "Nair", dateOfBirth: "1988-11-02",
    countryOfBirth: "India", countryOfCitizenship: "India",
    passportNumber: "N9988776",
    currentUsAddress: { street: "45 Harbor View Dr", city: "San Jose", state: "CA", zipCode: "95110" },
  },
  position: { title: "Director of Engineering", offeredSalary: "175000" },
};

function employerAnswers(fixture = BASE) {
  return {
    employer_usCompany_name: fixture.usCompany.name,
    employer_foreignCompany_name: fixture.foreignCompany.name,
    employer_foreignCompany_address_street: fixture.foreignCompany.address.street,
    employer_foreignCompany_address_city: fixture.foreignCompany.address.city,
    employer_foreignCompany_address_stateProvince: fixture.foreignCompany.address.stateProvince,
    employer_foreignCompany_address_zipPostalCode: fixture.foreignCompany.address.zipPostalCode,
    employer_foreignCompany_address_country: fixture.foreignCompany.address.country,
    employer_foreignCompany_employmentStartDate: fixture.foreignCompany.employmentStartDate,
    employer_foreignCompany_employmentEndDate: fixture.foreignCompany.employmentEndDate,
    employer_foreignCompany_relationshipType: fixture.foreignCompany.relationshipType,
    employer_position_jobTitle: fixture.position.title,
    employer_position_offeredSalary: fixture.position.offeredSalary,
  };
}

function employeeAnswers(fixture = BASE) {
  return {
    employee_personal_firstName: fixture.beneficiary.firstName,
    employee_personal_lastName: fixture.beneficiary.lastName,
    employee_personal_dateOfBirth: fixture.beneficiary.dateOfBirth,
    employee_personal_countryOfBirth: fixture.beneficiary.countryOfBirth,
    employee_personal_countryOfCitizenship: fixture.beneficiary.countryOfCitizenship,
    employee_personal_passportNumber: fixture.beneficiary.passportNumber,
    employee_personal_currentUsAddress_street: fixture.beneficiary.currentUsAddress.street,
    employee_personal_currentUsAddress_city: fixture.beneficiary.currentUsAddress.city,
    employee_personal_currentUsAddress_state: fixture.beneficiary.currentUsAddress.state,
    employee_personal_currentUsAddress_zipCode: fixture.beneficiary.currentUsAddress.zipCode,
    employee_immigrationStatus_insideUnitedStates: "yes",
    employee_otherInformation_hasDependents: "no",
    employee_otherInformation_heldL1ALastSevenYears: "no",
    employee_otherInformation_deniedL1ALastSevenYears: "no",
  };
}

module.exports = { BASE, employerAnswers, employeeAnswers };
