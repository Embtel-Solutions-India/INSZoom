// Builds the Phase H1 golden H-1B case: deterministic, fully-known values so
// AC2/AC3/AC4 assertions can check EXACT expected output rather than "is
// truthy". Used by both the authoring seed's own verification run and the
// acceptance test suite. Always creates fresh records and returns a
// `cleanup()` function - callers MUST call it (tests use try/finally).
const mongoose = require("mongoose");
const User = require("../../../models/User");
const Beneficiary = require("../../../models/Beneficiary");
const Company = require("../../../models/Company");
const Case = require("../../../models/Case");
const Questionnaire = require("../../../models/Questionnaire");
const Answer = require("../../../models/Answer");
const questionnaireService = require("../../questionnaires/questionnaire.service");

// Exported so tests can assert against the exact values without
// re-deriving them from this file's internals.
const GOLDEN = {
  beneficiary: {
    firstName: "Ada", middleName: "Kingsley", lastName: "Lovelace",
    dateOfBirth: "1990-03-15", countryOfBirth: "United Kingdom", countryOfCitizenship: "United Kingdom",
    passportNumber: "X1234567", alienRegistrationNumber: "987654321",
  },
  company: { name: "Acme Analytics Inc", ein: "12-3456789" },
  answers: {
    employer: {
      employer_company_fullName: "Acme Analytics Inc",
      employer_company_fein: "12-3456789",
      employer_company_address_street: "500 Market Street",
      employer_company_address_city: "San Francisco",
      employer_company_address_state: "CA",
      employer_company_address_zipCode: "94105",
      employer_company_address_country: "USA",
      employer_company_daytimePhone: "4155550100",
      employer_company_businessType: "Software Development",
      employer_company_yearEstablished: "2015",
      employer_company_naicsCode: "541511",
      employer_company_grossAnnualIncome: "8000000",
      employer_company_netIncome: "1200000",
      employer_signingPerson_firstName: "Grace",
      employer_signingPerson_lastName: "Hopper",
      employer_position_jobTitle: "Senior Software Engineer",
      employer_position_socCode: "15-1252",
      employer_position_wageLevel: "Level II",
      employer_position_offeredSalary: "135000",
      employer_position_employmentStartDate: "2026-10-01",
      employer_workforce_totalUsEmployees: "80",
      employer_workforce_isH1bDependentOrWillfulViolator: "No",
      employer_workforce_isAcwiaFeeExempt: "No",
      employer_jobDescription_duties: "Design and build distributed data pipelines; lead technical architecture reviews.",
    },
    employee: {
      employee_personal_firstName: "Ada",
      employee_personal_lastName: "Lovelace",
      employee_personal_middleName: "Kingsley",
      employee_personal_gender: "Female",
      employee_personal_dateOfBirth: "1990-03-15",
      employee_personal_countryOfBirth: "United Kingdom",
      employee_personal_countryOfCitizenship: "United Kingdom",
      employee_personal_socialSecurityNumber: "123456789",
      employee_personal_passportNumber: "X1234567",
      employee_personal_passportExpirationDate: "2028-11-20",
      employee_personal_sevisNumber: "N0012345678",
      employee_personal_latestPriorPetitionNumber: "None",
      employee_personal_currentUsAddress_street: "221B Baker Street",
      employee_personal_currentUsAddress_city: "New York",
      employee_personal_currentUsAddress_state: "NY",
      employee_personal_currentUsAddress_zipCode: "10001",
      employee_immigrationStatus_insideUnitedStates: "yes",
      employee_immigrationStatus_currentVisaStatus: "F-1",
      employee_immigrationStatus_dateOfLastArrival: "2022-08-15",
      employee_immigrationStatus_currentStatusExpirationDate: "2027-05-31",
      employee_immigrationStatus_i94Number: "11223344556",
      employee_education_highestLevel: "Master's degree",
      employee_education_majorFieldOfStudy: "Computer Science",
      employee_education_hasUsMastersOrHigher: "yes",
      employee_education_usInstitutionName: "Stanford University",
      employee_education_degreeAwardDate: "2013-06-15",
      employee_education_degreeType: "MS Computer Science",
      employee_education_institutionAddress: "450 Serra Mall, Stanford, CA 94305",
      employee_immigrationHistory_hasValidPassport: "yes",
      employee_immigrationHistory_hasH4Dependents: "no",
      employee_immigrationHistory_inRemovalProceedings: "no",
      employee_immigrationHistory_employerFiledGreenCard: "no",
      employee_immigrationHistory_heldH1bLastSevenYears: "no",
      employee_immigrationHistory_deniedH1bLastSevenYears: "no",
      employee_filingType: "New H1B",
      employee_filingCapType: "Regular CAP",
      // Cap-registration fields (Phase H6) - only meaningful for a New/cap
      // filing (this golden case's filingType, above), so every mapped
      // crosswalk edge sourcing from these has a real value to resolve.
      employee_capRegistration_beneficiaryConfirmationNumber: "H1B2026CAP0009876",
      employee_capRegistration_passportNumber: "X1234567",
      employee_capRegistration_passportCountry: "United Kingdom",
      employee_capRegistration_passportExpirationDate: "2028-11-20",
    },
  },
};

async function buildGoldenH1bCase() {
  const tag = `h1-golden-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = { users: [], beneficiaries: [], companies: [], cases: [] };

  const user = await User.create({ email: `${tag}@example.com`, password: "hashed-password-not-real", name: "Ada Lovelace", role: "client" });
  created.users.push(user._id);
  const beneficiary = await Beneficiary.create({ user: user._id, ...GOLDEN.beneficiary });
  created.beneficiaries.push(beneficiary._id);
  const company = await Company.create({ ...GOLDEN.company });
  created.companies.push(company._id);
  const caseDoc = await Case.create({
    caseNumber: `${tag}-A`, visaType: "H-1B", user: user._id, beneficiary: beneficiary._id, companyId: company._id, status: "active",
  });
  created.cases.push(caseDoc._id);

  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const employerQ = await Questionnaire.findOne({ key: "h1b_employer_checklist", latestVersion: true });
  const employeeQ = await Questionnaire.findOne({ key: "h1b_employee_checklist", latestVersion: true });
  const sysUser = { _id: user._id, role: "client" };

  await questionnaireService.saveAnswers({
    questionnaireId: employerQ._id,
    caseId: caseDoc._id,
    answers: Object.entries(GOLDEN.answers.employer).map(([questionKey, value]) => ({ questionKey, value })),
  }, sysUser, {}, "submitted");

  await questionnaireService.saveAnswers({
    questionnaireId: employeeQ._id,
    caseId: caseDoc._id,
    answers: Object.entries(GOLDEN.answers.employee).map(([questionKey, value]) => ({ questionKey, value })),
  }, sysUser, {}, "submitted");

  async function cleanup() {
    await Answer.deleteMany({ caseId: { $in: created.cases } });
    await Case.deleteMany({ _id: { $in: created.cases } });
    await Company.deleteMany({ _id: { $in: created.companies } });
    await Beneficiary.deleteMany({ _id: { $in: created.beneficiaries } });
    await User.deleteMany({ _id: { $in: created.users } });
  }

  return { user: sysUser, caseId: caseDoc._id, caseDoc, beneficiary, company, cleanup };
}

module.exports = { buildGoldenH1bCase, GOLDEN };
