// Phase H7 golden H-1B cap fixture - a plain JS object, no DB calls, reused
// across every test in the golden-path suite (and by variant builders below
// for the premium/attorney/dependents conditional scenarios). Deliberately
// mirrors the flat employer_*/employee_* question-key shape h1b.js's own
// fieldCatalog() and the existing i129-h1b-golden-case.js fixture already
// use, so it flows through the real questionnaireService.saveAnswers ->
// AutoFillService.generate pipeline unchanged.
const BASE = {
  caseNumber: "H1B-2025-GOLDEN",
  visaType: "H-1B",
  petitioner: {
    legalName: "Sairi Inc. dba Mango Bliss Dessert Bar",
    fein: "93-2840886",
    address: { street: "3196 Willow Creek Rd", city: "Prescott", state: "AZ", zipCode: "86301", country: "USA" },
  },
  beneficiary: {
    firstName: "Apratim",
    lastName: "De",
    dateOfBirth: "1987-07-28",
    countryOfBirth: "India",
    countryOfCitizenship: "India",
    passportNumber: "X3010683",
    passportIssueDate: "2024-02-13",
    passportExpirationDate: "2034-02-12",
    foreignAddress: { stateProvince: "West Bengal", country: "India" },
  },
  position: {
    title: "Marketing Analyst",
    socCode: "13-1161.00",
    lcaCaseNumber: "I-200-25107-874249",
    offeredSalary: "63000",
    wageLevel: "Level III",
    startDate: "2025-10-01",
    endDate: "2028-09-30",
    worksite: { street: "3196 Willow Creek Rd", city: "Prescott", state: "AZ", zipCode: "86301" },
  },
  education: {
    highestLevel: "Master's degree",
    majorFieldOfStudy: "Marketing & HR",
    usInstitutionName: "EIILM University",
    degreeAwardDate: "2011-06-01",
    degreeType: "MBA (US-equivalent BBA Marketing)",
  },
  capRegistration: {
    beneficiaryConfirmationNumber: "2026-b278-f8d0-aef9",
    filingCapType: "Regular CAP",
    passportNumber: "X3010683",
    passportCountry: "India",
    passportExpirationDate: "2034-02-12",
  },
  employer: {
    businessType: "Food/Restaurant",
    yearEstablished: "2023",
    totalUsEmployees: "18",
    isAcwiaFeeExempt: "Yes",
    isH1bDependentOrWillfulViolator: "No",
    grossAnnualIncome: "500000",
  },
};

function employerAnswers(fixture = BASE) {
  return {
    employer_company_fullName: fixture.petitioner.legalName,
    employer_company_fein: fixture.petitioner.fein,
    employer_company_address_street: fixture.petitioner.address.street,
    employer_company_address_city: fixture.petitioner.address.city,
    employer_company_address_state: fixture.petitioner.address.state,
    employer_company_address_zipCode: fixture.petitioner.address.zipCode,
    employer_company_address_country: fixture.petitioner.address.country,
    employer_company_businessType: fixture.employer.businessType,
    employer_company_yearEstablished: fixture.employer.yearEstablished,
    employer_company_grossAnnualIncome: fixture.employer.grossAnnualIncome,
    employer_signingPerson_firstName: "Sairi",
    employer_signingPerson_lastName: "Owner",
    employer_signingPerson_title: "President",
    employer_signingPerson_email: "owner@mangoblissdessertbar.com",
    employer_position_jobTitle: fixture.position.title,
    employer_position_socCode: fixture.position.socCode,
    employer_position_wageLevel: fixture.position.wageLevel,
    employer_position_offeredSalary: fixture.position.offeredSalary,
    employer_position_employmentStartDate: fixture.position.startDate,
    employer_workforce_totalUsEmployees: fixture.employer.totalUsEmployees,
    employer_workforce_isH1bDependentOrWillfulViolator: fixture.employer.isH1bDependentOrWillfulViolator,
    employer_workforce_isAcwiaFeeExempt: fixture.employer.isAcwiaFeeExempt,
    employer_jobDescription_duties: "Analyze marketing performance, plan promotional campaigns, and manage social media presence for the restaurant brand.",
  };
}

function employeeAnswers(fixture = BASE, overrides = {}) {
  return {
    employee_filingType: "New H1B",
    employee_filingCapType: fixture.capRegistration.filingCapType,
    employee_personal_firstName: fixture.beneficiary.firstName,
    employee_personal_lastName: fixture.beneficiary.lastName,
    employee_personal_gender: "Male",
    employee_personal_dateOfBirth: fixture.beneficiary.dateOfBirth,
    employee_personal_countryOfBirth: fixture.beneficiary.countryOfBirth,
    employee_personal_countryOfCitizenship: fixture.beneficiary.countryOfCitizenship,
    employee_personal_passportNumber: fixture.beneficiary.passportNumber,
    employee_personal_passportIssueDate: fixture.beneficiary.passportIssueDate,
    employee_personal_passportExpirationDate: fixture.beneficiary.passportExpirationDate,
    employee_immigrationStatus_insideUnitedStates: "no",
    employee_immigrationStatus_foreignResidentialAddress_stateProvince: fixture.beneficiary.foreignAddress.stateProvince,
    employee_immigrationStatus_foreignResidentialAddress_country: fixture.beneficiary.foreignAddress.country,
    employee_education_highestLevel: fixture.education.highestLevel,
    employee_education_majorFieldOfStudy: fixture.education.majorFieldOfStudy,
    employee_education_hasUsMastersOrHigher: "yes",
    employee_education_usInstitutionName: fixture.education.usInstitutionName,
    employee_education_degreeAwardDate: fixture.education.degreeAwardDate,
    employee_education_degreeType: fixture.education.degreeType,
    employee_immigrationHistory_hasValidPassport: "yes",
    employee_immigrationHistory_hasH4Dependents: "no",
    employee_capRegistration_beneficiaryConfirmationNumber: fixture.capRegistration.beneficiaryConfirmationNumber,
    employee_capRegistration_passportNumber: fixture.capRegistration.passportNumber,
    employee_capRegistration_passportCountry: fixture.capRegistration.passportCountry,
    employee_capRegistration_passportExpirationDate: fixture.capRegistration.passportExpirationDate,
    ...overrides,
  };
}

// Variant: an active premium-processing addon (T4).
function withPremiumAddon() {
  return { key: "premium_processing_i907", service: "Premium Processing", status: "paid", governmentFeeCents: 260000 };
}

// Variant: H-4 dependents present (T5-equivalent dependents scenario).
function dependentEmployeeAnswers(fixture = BASE) {
  return employeeAnswers(fixture, {
    employee_immigrationHistory_hasH4Dependents: "yes",
    employee_dependents: [
      { name: "Priya De", relationship: "Spouse" },
      { name: "Aarav De", relationship: "Child" },
    ],
  });
}

module.exports = { BASE, employerAnswers, employeeAnswers, withPremiumAddon, dependentEmployeeAnswers };
