// The generic party vocabulary for checklist questions: every question of a checklist is stored under petitioner.* or beneficiary.* - the two people every
// USCIS filing is about - and never under a path named after a form or a visa. See docs/GENERIC_PARTY_CANONICAL_MODEL.md.
//
//   petitioner   the sponsor: the EMPLOYER in an employer-sponsored case, the person filing in a family case
//   beneficiary  the person the filing is for: the EMPLOYEE in an employer case, the applicant in a family case
//
// A fact is stored once, under one name, so every form that asks for it reads the same path. Facts about the filing itself (the job offered, the LCA, a prior
// receipt number) belong to the petitioner who files it: petitioner.petition.* / petitioner.job.*. Existing names are reused wherever one is already in use
// (petitioner.name, petitioner.address.*, beneficiary.firstName ...); a new name is only added for a fact that had no generic path.
//
// Batch 1 covers: h1b_employer_checklist, h1b_employee_checklist, i907_premium_processing_profile, i130_ir1_petitioner_checklist.
// Batch 2 covers: l1a_employer_checklist, l1a_employee_checklist, tn_employer_checklist, tn_employee_checklist, i140_petitioner_checklist,
//   i140_beneficiary_checklist, i130_ir1_beneficiary_checklist, i864_ir1_petitioner_checklist.
// Batch 3 covers: e3_employer / e3_employee, p_employer / p_employee, o1_employer / o1_employee, o2_employer / o2_employee, k1_petitioner / k1_beneficiary,
//   k3_petitioner / k3_beneficiary (the K-1 questions again: the shared I-130 graph reads the same keys for K-1 and K-3).
// Sibling step: the 37 checklists that repeat a listed one (L-1B, L-1A extension, CR-1 / IR-2 ... F4 I-130 petitioner / beneficiary and I-864 sponsor) share its table.
// Batch 4 (partyChecklistPathsExtended.js): every other checklist except PERM (own canonical pipeline) and the documents-only E-2 checklist.
// Not listed on purpose: PERM (it has its own
// canonical pipeline - permCanonicalPaths, education.N.*, perm.*) is deliberately left alone.
// Document ("file") questions are not listed: documents are mapped by document type, not by canonical path.
const T = (path, type = "text") => ({ path, type });

const H1B_EMPLOYER = {
  employer_company_fullName: T("petitioner.name"),
  employer_company_fein: T("petitioner.ein"),
  employer_company_address_street: T("petitioner.address.line1"),
  employer_company_address_city: T("petitioner.address.city"),
  employer_company_address_state: T("petitioner.address.state"),
  employer_company_address_zipCode: T("petitioner.address.zip"),
  employer_company_address_country: T("petitioner.address.country"),
  employer_company_address_county: T("petitioner.address.county"),
  employer_company_daytimePhone: T("petitioner.phone", "phone"),
  employer_company_faxNumber: T("petitioner.fax", "phone"),
  employer_company_businessType: T("petitioner.businessType"),
  employer_company_yearEstablished: T("petitioner.yearEstablished"),
  employer_company_naicsCode: T("petitioner.naicsCode"),
  employer_company_website: T("petitioner.website"),
  employer_company_netIncome: T("petitioner.netAnnualIncome", "currency"),
  employer_company_grossAnnualIncome: T("petitioner.grossAnnualIncome", "currency"),
  employer_signingPerson_firstName: T("petitioner.signatory.firstName"),
  employer_signingPerson_lastName: T("petitioner.signatory.lastName"),
  employer_signingPerson_title: T("petitioner.signatory.title"),
  employer_signingPerson_email: T("petitioner.signatory.email", "email"),
  employer_signingPerson_mobilePhone: T("petitioner.signatory.phone", "phone"),
  employer_workforce_totalUsEmployees: T("petitioner.numberOfEmployees"),
  employer_workforce_h1bEmployees: T("petitioner.workforce.h1bEmployees"),
  employer_workforce_h1bL1Employees: T("petitioner.workforce.h1bL1Employees"),
  employer_workforce_isH1bDependentOrWillfulViolator: T("petitioner.workforce.isH1bDependentOrWillfulViolator", "boolean"),
  employer_workforce_isAcwiaFeeExempt: T("petitioner.workforce.isAcwiaFeeExempt", "boolean"),
  employer_position_jobTitle: T("petitioner.jobTitle"),
  employer_position_offeredSalary: T("petitioner.wage", "currency"),
  employer_position_employmentStartDate: T("petitioner.job.startDate", "date"),
  employer_position_socCode: T("petitioner.job.socCode"),
  employer_position_wageLevel: T("petitioner.job.wageLevel"),
  employer_jobDescription_duties: T("petitioner.job.duties"),
  employer_endClient_name: T("petitioner.job.endClientName"),
  employer_lca_firstLcaFiling: T("petitioner.lca.isFirstFiling", "boolean"),
  employer_lca_dolVerified: T("petitioner.lca.dolVerified", "boolean"),
  employer_workLocations: T("petitioner.job.workLocations", "array"),
};

const H1B_EMPLOYEE = {
  employee_personal_lastName: T("beneficiary.lastName"),
  employee_personal_firstName: T("beneficiary.firstName"),
  employee_personal_middleName: T("beneficiary.middleName"),
  employee_personal_otherNamesUsed: T("beneficiary.otherNames"),
  employee_personal_dateOfBirth: T("beneficiary.dateOfBirth", "date"),
  employee_personal_gender: T("beneficiary.gender"),
  employee_personal_countryOfBirth: T("beneficiary.countryOfBirth"),
  employee_personal_provinceStateOfBirth: T("beneficiary.provinceOfBirth"),
  employee_personal_countryOfCitizenship: T("beneficiary.countryOfCitizenship"),
  employee_personal_alienRegistrationNumber: T("beneficiary.alienRegistrationNumber"),
  employee_personal_socialSecurityNumber: T("beneficiary.ssn"),
  employee_personal_sevisNumber: T("beneficiary.sevisId"),
  employee_personal_latestPriorPetitionNumber: T("beneficiary.latestPriorPetitionNumber"),
  employee_personal_passportNumber: T("beneficiary.passport.number"),
  employee_personal_passportIssueDate: T("beneficiary.passport.issueDate", "date"),
  employee_personal_passportExpirationDate: T("beneficiary.passport.expirationDate", "date"),
  employee_personal_currentUsAddress_street: T("beneficiary.address"),
  employee_personal_currentUsAddress_apartment: T("beneficiary.apartment"),
  employee_personal_currentUsAddress_city: T("beneficiary.city"),
  employee_personal_currentUsAddress_state: T("beneficiary.state"),
  employee_personal_currentUsAddress_zipCode: T("beneficiary.zipCode"),
  employee_immigrationStatus_insideUnitedStates: T("beneficiary.insideUnitedStates", "boolean"),
  employee_immigrationStatus_currentVisaStatus: T("beneficiary.currentVisaStatus"),
  employee_immigrationStatus_currentStatusExpirationDate: T("beneficiary.currentVisaExpirationDate", "date"),
  employee_immigrationStatus_dateOfLastArrival: T("beneficiary.lastArrivalDate", "date"),
  employee_immigrationStatus_i94Number: T("beneficiary.i94Number"),
  employee_immigrationStatus_replaceI94: T("beneficiary.intendsToReplaceI94", "boolean"),
  employee_immigrationStatus_hasSsn: T("beneficiary.hasSsn", "boolean"),
  employee_immigrationStatus_hasDriverLicense: T("beneficiary.hasDriverLicense", "boolean"),
  employee_immigrationStatus_consulateForStamping: T("beneficiary.consularProcessing.consulateCityCountry"),
  employee_immigrationStatus_foreignResidentialAddress_street: T("beneficiary.foreignAddress.line1"),
  employee_immigrationStatus_foreignResidentialAddress_apartment: T("beneficiary.foreignAddress.line2"),
  employee_immigrationStatus_foreignResidentialAddress_city: T("beneficiary.foreignAddress.city"),
  employee_immigrationStatus_foreignResidentialAddress_stateProvince: T("beneficiary.foreignAddress.state"),
  employee_immigrationStatus_foreignResidentialAddress_country: T("beneficiary.foreignAddress.country"),
  employee_immigrationStatus_foreignResidentialAddress_zipPostalCode: T("beneficiary.foreignAddress.postalCode"),
  employee_immigrationHistory_hasValidPassport: T("beneficiary.petitionHasValidPassport", "boolean"),
  employee_immigrationHistory_inRemovalProceedings: T("beneficiary.anyPersonInRemovalProceedings", "boolean"),
  employee_immigrationHistory_employerFiledGreenCard: T("beneficiary.employerPreviouslyFiledImmigrantPetition", "boolean"),
  employee_immigrationHistory_heldH1bLastSevenYears: T("beneficiary.heldClassificationWithinSevenYears", "boolean"),
  employee_immigrationHistory_deniedH1bLastSevenYears: T("beneficiary.deniedClassificationWithinSevenYears", "boolean"),
  employee_immigrationHistory_h1bDenialExplanation: T("beneficiary.classificationDenialExplanation"),
  employee_immigrationHistory_hasH4Dependents: T("beneficiary.hasDependents", "boolean"),
  employee_immigrationHistory_numberOfDependents: T("beneficiary.dependentCount", "number"),
  employee_dependents: T("beneficiary.dependents", "array"),
  employee_previousHLStatusHistory: T("beneficiary.previousStatusHistory", "array"),
  employee_education_highestLevel: T("beneficiary.education.highestLevel"),
  employee_education_majorFieldOfStudy: T("beneficiary.education.majorFieldOfStudy"),
  employee_education_hasUsMastersOrHigher: T("beneficiary.education.hasUsMastersOrHigher", "boolean"),
  employee_education_usInstitutionName: T("beneficiary.education.usInstitutionName"),
  employee_education_degreeType: T("beneficiary.education.degreeType"),
  employee_education_degreeAwardDate: T("beneficiary.education.degreeAwardDate", "date"),
  employee_education_institutionAddress: T("beneficiary.education.institutionAddress"),
  employee_capRegistration_beneficiaryConfirmationNumber: T("beneficiary.capRegistration.confirmationNumber"),
  employee_capRegistration_passportNumber: T("beneficiary.capRegistration.passportNumber"),
  employee_capRegistration_passportCountry: T("beneficiary.capRegistration.passportCountry"),
  employee_capRegistration_passportExpirationDate: T("beneficiary.capRegistration.passportExpirationDate", "date"),
  // facts about the filing itself belong to the petitioner who files it
  employee_filingType: T("petitioner.petition.filingType"),
  employee_filingCapType: T("petitioner.petition.capType"),
};

// Form I-907. The live I-907 mapping already treats "the person filing" and the petitioner-or-applicant as the petitioner's authorised signatory, and the mailing
// address as the petitioner's address - so the checklist stores them there (one person, one set of facts: an answer given twice with different values is a data
// conflict for staff to resolve, exactly as for any other shared fact). The company's point of contact is often someone else (HR, an assistant), so it is its own
// group, petitioner.pointOfContact.*: the form boxes read it first and fall back to the signatory when no separate contact is answered (same result as today).
// The physical address is its own group too, because it can legitimately differ from the mailing address. Facts about the related petition belong to the petitioner who filed it (petitioner.petition.*).
const I907 = {
  i907_filer_last_name: T("petitioner.signatory.lastName"),
  i907_filer_first_name: T("petitioner.signatory.firstName"),
  i907_filer_alien_registration_number: T("petitioner.signatory.alienNumber"),
  i907_filer_uscis_online_account_number: T("petitioner.signatory.uscisOnlineAccountNumber"),
  i907_related_case_company_name: T("petitioner.name"),
  i907_company_ein: T("petitioner.ein"),
  i907_company_poc_last_name: T("petitioner.pointOfContact.lastName"),
  i907_company_poc_first_name: T("petitioner.pointOfContact.firstName"),
  i907_company_poc_position_title: T("petitioner.pointOfContact.title"),
  i907_petitioner_last_name: T("petitioner.signatory.lastName"),
  i907_petitioner_first_name: T("petitioner.signatory.firstName"),
  i907_mailing_address_street: T("petitioner.address.line1"),
  i907_mailing_address_unit: T("petitioner.address.line2"),
  i907_mailing_address_city: T("petitioner.address.city"),
  i907_mailing_address_state: T("petitioner.address.state"),
  i907_mailing_address_zip_code: T("petitioner.address.zip"),
  i907_mailing_address_province: T("petitioner.address.province"),
  i907_mailing_address_postal_code: T("petitioner.address.postalCode"),
  i907_mailing_address_country: T("petitioner.address.country"),
  i907_address_same_as_physical: T("petitioner.physicalAddressSameAsMailing", "boolean"),
  i907_physical_address_street: T("petitioner.physicalAddress.line1"),
  i907_physical_address_unit: T("petitioner.physicalAddress.line2"),
  i907_physical_address_city: T("petitioner.physicalAddress.city"),
  i907_physical_address_state: T("petitioner.physicalAddress.state"),
  i907_physical_address_zip_code: T("petitioner.physicalAddress.zip"),
  i907_physical_address_province: T("petitioner.physicalAddress.province"),
  i907_physical_address_postal_code: T("petitioner.physicalAddress.postalCode"),
  i907_physical_address_country: T("petitioner.physicalAddress.country"),
  i907_related_case_form_number: T("petitioner.petition.formNumber"),
  i907_related_case_receipt_number: T("petitioner.petition.receiptNumber"),
  i907_related_case_receipt_number_2: T("petitioner.petition.receiptNumber2"),
  i907_beneficiary_last_name: T("beneficiary.lastName"),
  i907_beneficiary_first_name: T("beneficiary.firstName"),
};

// Family petitioner (IR-1 / CR-1 / F-categories): the person filing is the petitioner, an individual.
const IR1_PETITIONER = {
  petitioner_lastName: T("petitioner.lastName"),
  petitioner_firstName: T("petitioner.firstName"),
  petitioner_middleName: T("petitioner.middleName"),
  petitioner_otherNamesUsed: T("petitioner.otherNames"),
  petitioner_dateOfBirth: T("petitioner.dateOfBirth", "date"),
  petitioner_gender: T("petitioner.gender"),
  petitioner_maritalStatus: T("petitioner.maritalStatus"),
  petitioner_ssn: T("petitioner.ssn"),
  petitioner_alienNumber: T("petitioner.aNumber"),
  petitioner_cityCountryOfBirth: T("petitioner.placeOfBirth"),
  petitioner_mailingAddress: T("petitioner.mailingAddress"),
  petitioner_physicalAddress: T("petitioner.physicalAddress"),
  petitioner_relationship: T("petitioner.relationshipToBeneficiary"),
  petitioner_currentSpouseName: T("petitioner.currentSpouse.fullName"),
  petitioner_currentMarriageDate: T("petitioner.currentSpouse.marriageDate", "date"),
  petitioner_currentMarriagePlace: T("petitioner.currentSpouse.marriagePlace"),
  petitioner_priorSpouses: T("petitioner.priorSpouses", "array"),
  petitioner_fatherFullName: T("petitioner.father.fullName"),
  petitioner_fatherDateOfBirth: T("petitioner.father.dateOfBirth", "date"),
  petitioner_fatherCountryOfBirth: T("petitioner.father.countryOfBirth"),
  petitioner_fatherResidence: T("petitioner.father.residence"),
  petitioner_motherFullName: T("petitioner.mother.fullName"),
  petitioner_motherDateOfBirth: T("petitioner.mother.dateOfBirth", "date"),
  petitioner_motherCountryOfBirth: T("petitioner.mother.countryOfBirth"),
  petitioner_motherResidence: T("petitioner.mother.residence"),
  petitioner_height: T("petitioner.height"),
  petitioner_weight: T("petitioner.weight"),
  petitioner_eyeColor: T("petitioner.eyeColor"),
  petitioner_hairColor: T("petitioner.hairColor"),
  petitioner_citizenshipBasis: T("petitioner.citizenshipBasis"),
  petitioner_naturalizationCertificateNumber: T("petitioner.citizenshipCertificateNumber"),
  petitioner_naturalizationDateAndPlace: T("petitioner.naturalizationDateAndPlace"),
  petitioner_isLawfulPermanentResident: T("petitioner.isLawfulPermanentResident", "boolean"),
  petitioner_lprGainedThroughMarriage: T("petitioner.lprGainedThroughMarriage", "boolean"),
  petitioner_employmentHistory: T("petitioner.employmentHistory", "array"),
  petitioner_addressHistory: T("petitioner.addressHistory", "array"),
  petitioner_sponsorsMaritalStatus: T("petitioner.sponsorMaritalStatus"),
  petitioner_numberOfDependentKids: T("petitioner.numberOfDependentChildren", "number"),
  petitioner_numberOfOtherDependents: T("petitioner.numberOfOtherDependents", "number"),
  petitioner_currentAnnualIncome: T("petitioner.income.currentAnnual", "currency"),
  petitioner_taxYear1Income: T("petitioner.income.taxYear1", "currency"),
  petitioner_taxYear2Income: T("petitioner.income.taxYear2", "currency"),
  petitioner_taxYear3Income: T("petitioner.income.taxYear3", "currency"),
  petitioner_savingsAndCheckingBalance: T("petitioner.assets.savingsAndChecking", "currency"),
  petitioner_realEstateNetCashValue: T("petitioner.assets.realEstateNetCashValue", "currency"),
  petitioner_stocksBondsNetCashValue: T("petitioner.assets.stocksBondsNetCashValue", "currency"),
  petitioner_priorPetitionFiled: T("petitioner.priorPetitionFiled", "boolean"),
  petitioner_priorPetitionDetails: T("petitioner.priorPetitionDetails"),
};

// ── Batch 2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A question key is shared between checklists on purpose (the signing person, the beneficiary's personal block ...): the SAME key always means the SAME fact, so it
// keeps the SAME path in every checklist (the table test asserts it). pick() reuses an earlier entry instead of restating it.
const pick = (source, keys) => Object.fromEntries(keys.map((key) => {
  if (!source[key]) throw new Error(`partyChecklistPaths: ${key} is not in the source table`);
  return [key, source[key]];
}));

const SIGNING_PERSON = pick(H1B_EMPLOYER, ["employer_signingPerson_firstName", "employer_signingPerson_lastName", "employer_signingPerson_title", "employer_signingPerson_email", "employer_signingPerson_mobilePhone"]);

// L-1A employer. The qualifying foreign company is a fact about the petitioner (petitioner.foreignCompany.*); what the BENEFICIARY did there (dates, duties) is the
// beneficiary's own (beneficiary.foreignEmployment.*).
const L1A_EMPLOYER = {
  employer_usCompany_name: T("petitioner.name"),
  employer_usCompany_address_street: T("petitioner.address.line1"),
  employer_usCompany_address_city: T("petitioner.address.city"),
  employer_usCompany_address_state: T("petitioner.address.state"),
  employer_usCompany_address_zipCode: T("petitioner.address.zip"),
  employer_usCompany_address_country: T("petitioner.address.country"),
  employer_usCompany_fein: T("petitioner.ein"),
  employer_usCompany_businessType: T("petitioner.businessType"),
  employer_usCompany_yearEstablished: T("petitioner.yearEstablished"),
  employer_usCompany_totalUsEmployees: T("petitioner.numberOfEmployees"),
  employer_usCompany_grossAnnualIncome: T("petitioner.grossAnnualIncome", "currency"),
  employer_usCompany_netAnnualIncome: T("petitioner.netAnnualIncome", "currency"),
  employer_usCompany_website: T("petitioner.website"),
  ...SIGNING_PERSON,
  employer_foreignCompany_name: T("petitioner.foreignCompany.name"),
  employer_foreignCompany_address_street: T("petitioner.foreignCompany.address.line1"),
  employer_foreignCompany_address_city: T("petitioner.foreignCompany.address.city"),
  employer_foreignCompany_address_stateProvince: T("petitioner.foreignCompany.address.state"),
  employer_foreignCompany_address_zipPostalCode: T("petitioner.foreignCompany.address.postalCode"),
  employer_foreignCompany_address_country: T("petitioner.foreignCompany.address.country"),
  employer_foreignCompany_relationshipType: T("petitioner.foreignCompany.relationshipType"),
  employer_foreignCompany_stockOwnershipPercentage: T("petitioner.foreignCompany.stockOwnershipPercentage"),
  employer_foreignCompany_website: T("petitioner.foreignCompany.website"),
  employer_foreignCompany_employmentStartDate: T("beneficiary.foreignEmployment.startDate", "date"),
  employer_foreignCompany_employmentEndDate: T("beneficiary.foreignEmployment.endDate", "date"),
  employer_foreignCompany_managerialDutiesBreakdown_managesOrgPercent: T("beneficiary.foreignEmployment.managerialDuties.managesOrganizationPercent", "number"),
  employer_foreignCompany_managerialDutiesBreakdown_supervisesStaffPercent: T("beneficiary.foreignEmployment.managerialDuties.supervisesStaffPercent", "number"),
  employer_foreignCompany_managerialDutiesBreakdown_hiringFiringAuthorityPercent: T("beneficiary.foreignEmployment.managerialDuties.hiringFiringAuthorityPercent", "number"),
  employer_foreignCompany_managerialDutiesBreakdown_discretionOverOperationsPercent: T("beneficiary.foreignEmployment.managerialDuties.discretionOverOperationsPercent", "number"),
  ...pick(H1B_EMPLOYER, ["employer_position_jobTitle", "employer_position_offeredSalary", "employer_endClient_name", "employer_workLocations"]),
  employer_position_salaryUnit: T("petitioner.wageUnit"),
  employer_position_dutiesDescription: T("petitioner.job.duties"),
};

// L-1A employee: the same personal / status block as the H-1B employee (shared keys keep their path) plus what is specific to this checklist.
const L1A_EMPLOYEE = {
  ...pick(H1B_EMPLOYEE, [
    "employee_personal_lastName", "employee_personal_firstName", "employee_personal_middleName", "employee_personal_otherNamesUsed", "employee_personal_dateOfBirth",
    "employee_personal_countryOfBirth", "employee_personal_provinceStateOfBirth", "employee_personal_countryOfCitizenship", "employee_personal_socialSecurityNumber",
    "employee_personal_alienRegistrationNumber", "employee_personal_latestPriorPetitionNumber", "employee_personal_sevisNumber",
    "employee_personal_currentUsAddress_street", "employee_personal_currentUsAddress_apartment", "employee_personal_currentUsAddress_city",
    "employee_personal_currentUsAddress_state", "employee_personal_currentUsAddress_zipCode",
    "employee_personal_passportNumber", "employee_personal_passportIssueDate", "employee_personal_passportExpirationDate",
    "employee_immigrationStatus_insideUnitedStates", "employee_immigrationStatus_dateOfLastArrival", "employee_immigrationStatus_i94Number",
    "employee_immigrationStatus_currentVisaStatus", "employee_immigrationStatus_currentStatusExpirationDate", "employee_immigrationStatus_consulateForStamping",
    "employee_immigrationStatus_foreignResidentialAddress_street", "employee_immigrationStatus_foreignResidentialAddress_apartment",
    "employee_immigrationStatus_foreignResidentialAddress_city", "employee_immigrationStatus_foreignResidentialAddress_country",
    "employee_previousHLStatusHistory",
  ]),
  employee_personal_eadNumber: T("beneficiary.eadNumber"),
  employee_personal_passportCountryOfIssuance: T("beneficiary.passport.country"),
  employee_immigrationStatus_foreignResidentialAddress_state: T("beneficiary.foreignAddress.state"),
  employee_immigrationStatus_foreignResidentialAddress_zipCode: T("beneficiary.foreignAddress.postalCode"),
  employee_otherInformation_hasValidPassport: T("beneficiary.petitionHasValidPassport", "boolean"),
  employee_otherInformation_replaceI94: T("beneficiary.intendsToReplaceI94", "boolean"),
  employee_otherInformation_hasDependents: T("beneficiary.hasDependents", "boolean"),
  employee_otherInformation_numberOfDependents: T("beneficiary.dependentCount", "number"),
  employee_otherInformation_inRemovalProceedings: T("beneficiary.anyPersonInRemovalProceedings", "boolean"),
  employee_otherInformation_employerFiledGreenCard: T("beneficiary.employerPreviouslyFiledImmigrantPetition", "boolean"),
  employee_otherInformation_heldL1ALastSevenYears: T("beneficiary.heldClassificationWithinSevenYears", "boolean"),
  employee_otherInformation_deniedL1ALastSevenYears: T("beneficiary.deniedClassificationWithinSevenYears", "boolean"),
  employee_otherInformation_l1aDenialExplanation: T("beneficiary.classificationDenialExplanation"),
};

// TN. Some answers are one free-text address (one line): they are kept whole under <party>.address.formatted and split into parts by PartyAliasService.
const TN_EMPLOYER = {
  employer_company_legalName: T("petitioner.name"),
  employer_company_address: T("petitioner.address.formatted"),
  ...pick(H1B_EMPLOYER, ["employer_company_fein", "employer_company_businessType", "employer_company_yearEstablished", "employer_company_grossAnnualIncome", "employer_company_website"]),
  employer_company_totalUsEmployees: T("petitioner.numberOfEmployees"),
  employer_company_netAnnualIncome: T("petitioner.netAnnualIncome", "currency"),
  ...SIGNING_PERSON,
  employer_position_jobTitle: H1B_EMPLOYER.employer_position_jobTitle,
  employer_position_salary: T("petitioner.wage", "currency"),
  employer_position_salaryFrequency: T("petitioner.wageUnit"),
  ...pick(H1B_EMPLOYER, ["employer_endClient_name", "employer_workLocations", "employer_jobDescription_duties"]),
};

const TN_EMPLOYEE = {
  ...pick(H1B_EMPLOYEE, [
    "employee_personal_lastName", "employee_personal_firstName", "employee_personal_middleName", "employee_personal_otherNamesUsed", "employee_personal_dateOfBirth",
    "employee_personal_countryOfBirth", "employee_personal_provinceStateOfBirth", "employee_personal_countryOfCitizenship", "employee_personal_latestPriorPetitionNumber",
    "employee_personal_sevisNumber", "employee_immigrationStatus_insideUnitedStates", "employee_immigrationStatus_dateOfLastArrival", "employee_immigrationStatus_i94Number",
    "employee_immigrationStatus_currentVisaStatus", "employee_immigrationHistory_hasValidPassport", "employee_immigrationHistory_inRemovalProceedings",
  ]),
  employee_personal_ssn: T("beneficiary.ssn"),
  employee_personal_aNumber: T("beneficiary.alienRegistrationNumber"),
  employee_personal_currentUsAddress: T("beneficiary.currentAddress.formatted"),
  employee_immigrationStatus_statusExpirationDate: T("beneficiary.currentVisaExpirationDate", "date"),
  employee_immigrationStatus_applyingFromOutsideUs: T("beneficiary.applyingFromOutsideUs", "boolean"),
  employee_immigrationStatus_consulateCity: T("beneficiary.consularProcessing.city"),
  employee_immigrationStatus_consulateCountry: T("beneficiary.consularProcessing.country"),
  employee_immigrationStatus_foreignAddress: T("beneficiary.foreignAddress.formatted"),
  employee_passport_number: T("beneficiary.passport.number"),
  employee_passport_issueDate: T("beneficiary.passport.issueDate", "date"),
  employee_passport_expirationDate: T("beneficiary.passport.expirationDate", "date"),
  employee_immigrationHistory_intendsToReplaceI94: T("beneficiary.intendsToReplaceI94", "boolean"),
  employee_immigrationHistory_hasDependents: T("beneficiary.hasDependents", "boolean"),
  employee_immigrationHistory_numberOfDependents: T("beneficiary.dependentCount", "number"),
  employee_immigrationHistory_employerFiledImmigrantPetition: T("beneficiary.employerPreviouslyFiledImmigrantPetition", "boolean"),
  employee_immigrationHistory_hadTnLastSevenYears: T("beneficiary.heldClassificationWithinSevenYears", "boolean"),
  employee_immigrationHistory_previousTnDenied: T("beneficiary.deniedClassificationWithinSevenYears", "boolean"),
  employee_immigrationHistory_previousTnDenialExplanation: T("beneficiary.classificationDenialExplanation"),
};

// I-140. The labor certification is a fact about the filing, so it sits under the petitioner who files it.
const I140_PETITIONER = {
  employer_company_legalName: T("petitioner.name"),
  employer_company_currentAddress: T("petitioner.address.formatted"),
  employer_company_ein: T("petitioner.ein"),
  employer_company_petitionerSsn: T("petitioner.ssn"),
  employer_company_uscisOnlineAccountNumber: T("petitioner.uscisOnlineAccountNumber"),
  employer_company_contactEmail: T("petitioner.email", "email"),
  employer_company_taxId: T("petitioner.taxId"),
  ...pick(H1B_EMPLOYER, ["employer_company_businessType", "employer_company_grossAnnualIncome", "employer_company_naicsCode"]),
  employer_company_dateEstablished: T("petitioner.dateEstablished", "date"),
  employer_company_employeeCount: T("petitioner.numberOfEmployees", "number"),
  employer_company_netAnnualIncome: T("petitioner.netAnnualIncome", "currency"),
  employer_laborCertification_dolCaseNumber: T("petitioner.laborCertification.caseNumber"),
  employer_laborCertification_dolFilingDate: T("petitioner.laborCertification.filingDate", "date"),
  employer_laborCertification_dolExpirationDate: T("petitioner.laborCertification.expirationDate", "date"),
  ...pick(H1B_EMPLOYER, ["employer_position_jobTitle", "employer_position_socCode"]),
  employer_position_beneficiaryWorkAddress: T("petitioner.job.workAddress"),
  employer_position_salary: T("petitioner.wage", "currency"),
  ...SIGNING_PERSON,
};

const I140_BENEFICIARY = {
  ...pick(H1B_EMPLOYEE, ["employee_personal_lastName", "employee_personal_firstName", "employee_personal_dateOfBirth", "employee_personal_countryOfBirth", "employee_immigrationStatus_i94Number"]),
  employee_personal_cityOfBirth: T("beneficiary.cityTownOfBirth"),
  employee_personal_stateOfBirth: T("beneficiary.provinceOfBirth"),
  employee_personal_currentAddress: T("beneficiary.currentAddress.formatted"),
  employee_personal_email: T("beneficiary.email", "email"),
  employee_personal_phonePrimary: T("beneficiary.primaryPhone", "phone"),
  employee_personal_phoneSecondary: T("beneficiary.secondaryPhone", "phone"),
  employee_personal_foreignAddress: T("beneficiary.foreignAddress.formatted"),
  employee_immigrationStatus_lastArrivalDate: T("beneficiary.lastArrivalDate", "date"),
  employee_immigrationStatus_statusExpiryDate: T("beneficiary.currentVisaExpirationDate", "date"),
  employee_immigrationStatus_ssn: T("beneficiary.ssn"),
  employee_immigrationStatus_alienNumber: T("beneficiary.alienRegistrationNumber"),
  employee_immigrationStatus_priorImmigrantPetitionFiled: T("beneficiary.priorImmigrantPetitionFiled", "boolean"),
  employee_immigrationStatus_priorImmigrantPetitionDetails: T("beneficiary.priorImmigrantPetitionDetails"),
  employee_otherInformation_hasDependents: T("beneficiary.hasDependents", "boolean"),
  employee_i140SpouseChildren: T("beneficiary.spouseAndChildren", "array"),
};

// Family beneficiary (IR-1 and the other I-130 categories): the applicant. Where the definition already stored a beneficiary.* path it keeps it (the table lists it
// anyway, so the form boxes that read the question are rewired to the same path).
const IR1_BENEFICIARY = {
  beneficiary_firstName: T("beneficiary.firstName"),
  beneficiary_middleName: T("beneficiary.middleName"),
  beneficiary_lastName: T("beneficiary.lastName"),
  beneficiary_physicalAddress: T("beneficiary.address"),
  beneficiary_dateOfBirth: T("beneficiary.dateOfBirth", "date"),
  beneficiary_cityStateCountryOfBirth: T("beneficiary.placeOfBirth"),
  beneficiary_ssn: T("beneficiary.ssn"),
  beneficiary_alienNumber: T("beneficiary.alienRegistrationNumber"),
  beneficiary_maritalStatus: T("beneficiary.maritalStatus"),
  beneficiary_currentSpouseName: T("beneficiary.currentSpouse.fullName"),
  beneficiary_currentMarriageDate: T("beneficiary.currentSpouse.marriageDate", "date"),
  beneficiary_currentMarriagePlace: T("beneficiary.currentSpouse.marriagePlace"),
  beneficiary_arrivalStatus: T("beneficiary.currentVisaStatus"),
  beneficiary_i94Number: T("beneficiary.i94Number"),
  beneficiary_lastDateOfArrival: T("beneficiary.lastArrivalDate", "date"),
  beneficiary_statusExpiresOn: T("beneficiary.i94ExpirationDate", "date"),
  beneficiary_currentEmployerName: T("beneficiary.currentEmployer.name"),
  beneficiary_currentEmployerAddress: T("beneficiary.currentEmployer.address"),
  beneficiary_employmentBeganDate: T("beneficiary.currentEmployer.startDate", "date"),
  beneficiary_underImmigrationProceedings: T("beneficiary.inImmigrationProceedings", "boolean"),
  beneficiary_priorSpouses: T("beneficiary.priorSpouses", "array"),
  beneficiary_familyMembers: T("beneficiary.familyMembers", "array"),
  beneficiary_usAddress: T("beneficiary.intendedUsAddress"),
  beneficiary_foreignAddress: T("beneficiary.foreignAddress.formatted"),
  beneficiary_lastSharedAddress: T("beneficiary.lastSharedAddress"),
  beneficiary_adjustmentOfficeCity: T("beneficiary.adjustmentOffice.city"),
  beneficiary_adjustmentOfficeState: T("beneficiary.adjustmentOffice.state"),
};

// Affidavit of Support (I-864) sponsor = the petitioner. These are the SAME facts the I-130 petitioner checklist asks, so they share its paths. A joint sponsor is a
// third person: it is kept under the petitioner who files (petitioner.jointSponsor.*), never as a third root.
const I864_PETITIONER = {
  petitioner_i864LastName: T("petitioner.lastName"),
  petitioner_i864FirstName: T("petitioner.firstName"),
  petitioner_i864MailingAddress: T("petitioner.mailingAddress"),
  petitioner_i864PhysicalAddress: T("petitioner.physicalAddress"),
  petitioner_i864DateOfBirth: T("petitioner.dateOfBirth", "date"),
  petitioner_i864CountryOfBirth: T("petitioner.countryOfBirth"),
  petitioner_i864Ssn: T("petitioner.ssn"),
  petitioner_i864AlienNumber: T("petitioner.aNumber"),
  petitioner_i864ImmigrationStatus: T("petitioner.immigrationStatus"),
  petitioner_i864MaritalStatus: T("petitioner.sponsorMaritalStatus"),
  petitioner_i864NumberOfDependentKids: T("petitioner.numberOfDependentChildren", "number"),
  petitioner_i864NumberOfOtherDependents: T("petitioner.numberOfOtherDependents", "number"),
  petitioner_i864OccupationTitle: T("petitioner.occupation"),
  petitioner_i864Employer1: T("petitioner.employer1"),
  petitioner_i864Employer2: T("petitioner.employer2"),
  petitioner_i864Employer3: T("petitioner.employer3"),
  petitioner_i864SelfEmployedTitle: T("petitioner.selfEmployedOccupation"),
  petitioner_i864CurrentIncome: T("petitioner.income.currentAnnual", "currency"),
  petitioner_i864TaxYear1Income: T("petitioner.income.taxYear1", "currency"),
  petitioner_i864TaxYear2Income: T("petitioner.income.taxYear2", "currency"),
  petitioner_i864TaxYear3Income: T("petitioner.income.taxYear3", "currency"),
  petitioner_i864SavingsAndCheckingBalance: T("petitioner.assets.savingsAndChecking", "currency"),
  petitioner_i864RealEstateNetCashValue: T("petitioner.assets.realEstateNetCashValue", "currency"),
  petitioner_i864StocksBondsNetCashValue: T("petitioner.assets.stocksBondsNetCashValue", "currency"),
  petitioner_i864HouseholdMemberFullName: T("petitioner.householdMember.fullName"),
  petitioner_i864HouseholdMemberRelation: T("petitioner.householdMember.relationship"),
  petitioner_i864HouseholdMemberIncome: T("petitioner.householdMember.income", "currency"),
  jointSponsor_willProvideSupport: T("petitioner.jointSponsor.willProvideSupport", "boolean"),
  jointSponsor_lastName: T("petitioner.jointSponsor.lastName"),
  jointSponsor_firstName: T("petitioner.jointSponsor.firstName"),
  jointSponsor_relationshipToPetitioner: T("petitioner.jointSponsor.relationshipToPetitioner"),
  jointSponsor_mailingAddress: T("petitioner.jointSponsor.mailingAddress"),
  jointSponsor_dateOfBirth: T("petitioner.jointSponsor.dateOfBirth", "date"),
  jointSponsor_ssn: T("petitioner.jointSponsor.ssn"),
  jointSponsor_immigrationStatus: T("petitioner.jointSponsor.immigrationStatus"),
  jointSponsor_currentIncome: T("petitioner.jointSponsor.income.currentAnnual", "currency"),
  jointSponsor_taxYear1Income: T("petitioner.jointSponsor.income.taxYear1", "currency"),
  jointSponsor_taxYear2Income: T("petitioner.jointSponsor.income.taxYear2", "currency"),
  jointSponsor_taxYear3Income: T("petitioner.jointSponsor.income.taxYear3", "currency"),
};

// ── Batch 3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// E-3, P, O-1, O-2 (employer + employee) and the K-1 fiance(e) petitioner / beneficiary. Most of an employer / employee checklist is the same block of facts the
// earlier batches already named, so those questions reuse the existing entry (same key = same fact = same path); only what is new is listed here.
const EARLIER = { ...H1B_EMPLOYER, ...H1B_EMPLOYEE, ...L1A_EMPLOYER, ...L1A_EMPLOYEE, ...TN_EMPLOYER, ...TN_EMPLOYEE, ...I140_PETITIONER, ...I140_BENEFICIARY };

// "was this classification ever granted / denied to the beneficiary in the last seven years" - one fact, however the visa is named
const HELD_DENIED = (held, denied, explanation) => ({
  [held]: T("beneficiary.heldClassificationWithinSevenYears", "boolean"),
  [denied]: T("beneficiary.deniedClassificationWithinSevenYears", "boolean"),
  [explanation]: T("beneficiary.classificationDenialExplanation"),
});
const E3_EXTRA = {
  employee_immigrationHistory_removalProceedingsExplanation: T("beneficiary.removalProceedingsExplanation"),
  ...HELD_DENIED("employee_immigrationHistory_heldE3LastSevenYears", "employee_immigrationHistory_deniedE3LastSevenYears", "employee_immigrationHistory_e3DenialExplanation"),
};
// the classification asked for (P-1, O-1A ...) and the event / engagement are facts about the filing, so they belong to the petitioner who files it
const PERFORMER_EMPLOYER = {
  employer_company_name: T("petitioner.name"),
  employer_position_natureOfEvent: T("petitioner.petition.natureOfEvent"),
};
const P_EMPLOYER_EXTRA = {
  ...PERFORMER_EMPLOYER,
  employer_pClassification: T("petitioner.petition.classification"),
  employer_position_jobLocation: T("petitioner.job.workAddress"),
};
const O1_EMPLOYER_EXTRA = {
  ...PERFORMER_EMPLOYER,
  employer_oClassification: T("petitioner.petition.classification"),
  employer_company_totalEmployees: T("petitioner.numberOfEmployees"),
};
const O2_EMPLOYER_EXTRA = { ...PERFORMER_EMPLOYER, employer_company_totalEmployees: T("petitioner.numberOfEmployees") };
const P_EMPLOYEE_EXTRA = HELD_DENIED("employee_otherInformation_heldPVisaLastSevenYears", "employee_otherInformation_deniedPVisaLastSevenYears", "employee_otherInformation_pVisaDenialExplanation");
const O2_EMPLOYEE_EXTRA = HELD_DENIED("employee_otherInformation_heldO1VisaLastSevenYears", "employee_otherInformation_deniedO1VisaLastSevenYears", "employee_otherInformation_o1VisaDenialExplanation");
const O1_EMPLOYEE_EXTRA = { ...O2_EMPLOYEE_EXTRA, o_1a_c8a_recommendation_letter_signers: T("beneficiary.recommendationLetterSigners", "array") };

const E3_EMPLOYER = {
  ...pick(EARLIER, [
    "employer_lca_firstLcaFiling", "employer_lca_dolVerified", "employer_company_fullName", "employer_company_fein", "employer_company_address_street",
    "employer_company_address_county", "employer_company_address_city", "employer_company_address_state", "employer_company_address_zipCode",
    "employer_company_daytimePhone", "employer_company_faxNumber", "employer_company_businessType", "employer_company_yearEstablished", "employer_company_naicsCode",
    "employer_signingPerson_firstName", "employer_signingPerson_lastName", "employer_signingPerson_title", "employer_signingPerson_email",
    "employer_signingPerson_mobilePhone", "employer_position_jobTitle", "employer_position_offeredSalary", "employer_endClient_name", "employer_workLocations",
    "employer_position_employmentStartDate", "employer_jobDescription_duties", "employer_workforce_totalUsEmployees", "employer_company_website",
    "employer_company_netIncome", "employer_company_grossAnnualIncome",
  ]),
};

const E3_EMPLOYEE = {
  ...pick(EARLIER, [
    "employee_personal_lastName", "employee_personal_firstName", "employee_personal_middleName", "employee_personal_otherNamesUsed", "employee_personal_dateOfBirth",
    "employee_personal_countryOfBirth", "employee_personal_provinceStateOfBirth", "employee_personal_countryOfCitizenship", "employee_personal_socialSecurityNumber",
    "employee_personal_alienRegistrationNumber", "employee_personal_latestPriorPetitionNumber", "employee_personal_sevisNumber",
    "employee_personal_currentUsAddress_street", "employee_personal_currentUsAddress_apartment", "employee_personal_currentUsAddress_city",
    "employee_personal_currentUsAddress_state", "employee_personal_currentUsAddress_zipCode", "employee_immigrationStatus_insideUnitedStates",
    "employee_immigrationStatus_dateOfLastArrival", "employee_immigrationStatus_i94Number", "employee_immigrationStatus_currentVisaStatus",
    "employee_immigrationStatus_currentStatusExpirationDate", "employee_personal_passportNumber", "employee_personal_passportIssueDate",
    "employee_personal_passportExpirationDate", "employee_immigrationHistory_hasValidPassport", "employee_immigrationStatus_replaceI94",
    "employee_immigrationHistory_hasDependents", "employee_immigrationHistory_numberOfDependents", "employee_immigrationHistory_inRemovalProceedings",
    "employee_immigrationHistory_employerFiledGreenCard",
  ]),
  ...E3_EXTRA,
};

const P_EMPLOYER = {
  ...pick(EARLIER, [
    "employer_company_address", "employer_company_fein", "employer_company_businessType", "employer_company_yearEstablished", "employer_company_totalUsEmployees",
    "employer_company_grossAnnualIncome", "employer_company_netAnnualIncome", "employer_signingPerson_firstName", "employer_signingPerson_lastName",
    "employer_signingPerson_title", "employer_signingPerson_email", "employer_signingPerson_mobilePhone", "employer_company_website", "employer_position_jobTitle",
    "employer_position_offeredSalary", "employer_position_salaryUnit", "employer_endClient_name", "employer_position_dutiesDescription",
  ]),
  ...P_EMPLOYER_EXTRA,
};

const P_EMPLOYEE = {
  ...pick(EARLIER, [
    "employee_personal_lastName", "employee_personal_firstName", "employee_personal_middleName", "employee_personal_otherNamesUsed", "employee_personal_dateOfBirth",
    "employee_personal_countryOfBirth", "employee_personal_provinceStateOfBirth", "employee_personal_countryOfCitizenship", "employee_personal_socialSecurityNumber",
    "employee_personal_alienRegistrationNumber", "employee_personal_latestPriorPetitionNumber", "employee_personal_sevisNumber", "employee_personal_eadNumber",
    "employee_personal_currentUsAddress_street", "employee_personal_currentUsAddress_apartment", "employee_personal_currentUsAddress_city",
    "employee_personal_currentUsAddress_state", "employee_personal_currentUsAddress_zipCode", "employee_immigrationStatus_insideUnitedStates",
    "employee_immigrationStatus_dateOfLastArrival", "employee_immigrationStatus_i94Number", "employee_immigrationStatus_currentVisaStatus",
    "employee_immigrationStatus_currentStatusExpirationDate", "employee_personal_passportNumber", "employee_personal_passportIssueDate",
    "employee_personal_passportExpirationDate", "employee_personal_passportCountryOfIssuance", "employee_immigrationStatus_consulateForStamping",
    "employee_immigrationStatus_foreignResidentialAddress_street", "employee_immigrationStatus_foreignResidentialAddress_apartment",
    "employee_immigrationStatus_foreignResidentialAddress_city", "employee_immigrationStatus_foreignResidentialAddress_state",
    "employee_immigrationStatus_foreignResidentialAddress_country", "employee_immigrationStatus_foreignResidentialAddress_zipCode",
    "employee_otherInformation_hasValidPassport", "employee_otherInformation_replaceI94", "employee_otherInformation_hasDependents",
    "employee_otherInformation_numberOfDependents", "employee_otherInformation_inRemovalProceedings", "employee_otherInformation_employerFiledGreenCard",
  ]),
  ...P_EMPLOYEE_EXTRA,
};

const O1_EMPLOYER = {
  ...pick(EARLIER, [
    "employer_company_address", "employer_company_fein", "employer_company_businessType", "employer_company_yearEstablished", "employer_company_grossAnnualIncome",
    "employer_company_netAnnualIncome", "employer_signingPerson_firstName", "employer_signingPerson_lastName", "employer_signingPerson_title",
    "employer_signingPerson_email", "employer_signingPerson_mobilePhone", "employer_company_website", "employer_position_jobTitle", "employer_position_offeredSalary",
    "employer_position_salaryUnit", "employer_endClient_name", "employer_workLocations", "employer_position_dutiesDescription",
  ]),
  ...O1_EMPLOYER_EXTRA,
};

const O1_EMPLOYEE = {
  ...pick(EARLIER, [
    "employee_personal_lastName", "employee_personal_firstName", "employee_personal_middleName", "employee_personal_otherNamesUsed", "employee_personal_dateOfBirth",
    "employee_personal_countryOfBirth", "employee_personal_provinceStateOfBirth", "employee_personal_countryOfCitizenship", "employee_personal_socialSecurityNumber",
    "employee_personal_alienRegistrationNumber", "employee_personal_latestPriorPetitionNumber", "employee_personal_sevisNumber", "employee_personal_eadNumber",
    "employee_personal_currentUsAddress_street", "employee_personal_currentUsAddress_apartment", "employee_personal_currentUsAddress_city",
    "employee_personal_currentUsAddress_state", "employee_personal_currentUsAddress_zipCode", "employee_immigrationStatus_insideUnitedStates",
    "employee_immigrationStatus_dateOfLastArrival", "employee_immigrationStatus_i94Number", "employee_immigrationStatus_currentVisaStatus",
    "employee_immigrationStatus_currentStatusExpirationDate", "employee_personal_passportNumber", "employee_personal_passportIssueDate",
    "employee_personal_passportExpirationDate", "employee_personal_passportCountryOfIssuance", "employee_immigrationStatus_consulateForStamping",
    "employee_immigrationStatus_foreignResidentialAddress_street", "employee_immigrationStatus_foreignResidentialAddress_apartment",
    "employee_immigrationStatus_foreignResidentialAddress_city", "employee_immigrationStatus_foreignResidentialAddress_state",
    "employee_immigrationStatus_foreignResidentialAddress_country", "employee_immigrationStatus_foreignResidentialAddress_zipCode",
    "employee_otherInformation_hasValidPassport", "employee_otherInformation_replaceI94", "employee_otherInformation_hasDependents",
    "employee_otherInformation_numberOfDependents", "employee_otherInformation_inRemovalProceedings", "employee_otherInformation_employerFiledGreenCard",
  ]),
  ...O1_EMPLOYEE_EXTRA,
};

const O2_EMPLOYER = {
  ...pick(EARLIER, [
    "employer_company_address", "employer_company_fein", "employer_company_businessType", "employer_company_yearEstablished", "employer_company_grossAnnualIncome",
    "employer_company_netAnnualIncome", "employer_signingPerson_firstName", "employer_signingPerson_lastName", "employer_signingPerson_title",
    "employer_signingPerson_email", "employer_signingPerson_mobilePhone", "employer_company_website", "employer_position_jobTitle", "employer_position_offeredSalary",
    "employer_position_salaryUnit", "employer_endClient_name", "employer_workLocations", "employer_position_dutiesDescription",
  ]),
  ...O2_EMPLOYER_EXTRA,
};

const O2_EMPLOYEE = {
  ...pick(EARLIER, [
    "employee_personal_lastName", "employee_personal_firstName", "employee_personal_middleName", "employee_personal_otherNamesUsed", "employee_personal_dateOfBirth",
    "employee_personal_countryOfBirth", "employee_personal_provinceStateOfBirth", "employee_personal_countryOfCitizenship", "employee_personal_socialSecurityNumber",
    "employee_personal_alienRegistrationNumber", "employee_personal_latestPriorPetitionNumber", "employee_personal_sevisNumber", "employee_personal_eadNumber",
    "employee_personal_currentUsAddress_street", "employee_personal_currentUsAddress_apartment", "employee_personal_currentUsAddress_city",
    "employee_personal_currentUsAddress_state", "employee_personal_currentUsAddress_zipCode", "employee_immigrationStatus_insideUnitedStates",
    "employee_immigrationStatus_dateOfLastArrival", "employee_immigrationStatus_i94Number", "employee_immigrationStatus_currentVisaStatus",
    "employee_immigrationStatus_currentStatusExpirationDate", "employee_personal_passportNumber", "employee_personal_passportIssueDate",
    "employee_personal_passportExpirationDate", "employee_personal_passportCountryOfIssuance", "employee_immigrationStatus_consulateForStamping",
    "employee_immigrationStatus_foreignResidentialAddress_street", "employee_immigrationStatus_foreignResidentialAddress_apartment",
    "employee_immigrationStatus_foreignResidentialAddress_city", "employee_immigrationStatus_foreignResidentialAddress_state",
    "employee_immigrationStatus_foreignResidentialAddress_country", "employee_immigrationStatus_foreignResidentialAddress_zipCode",
    "employee_otherInformation_hasValidPassport", "employee_otherInformation_replaceI94", "employee_otherInformation_hasDependents",
    "employee_otherInformation_numberOfDependents", "employee_otherInformation_inRemovalProceedings", "employee_otherInformation_employerFiledGreenCard",
  ]),
  ...O2_EMPLOYEE_EXTRA,
};

// K-1 fiance(e) petitioner: the person filing (an individual), so the same vocabulary as the IR-1 petitioner. The details of the earlier petition are the
// petitioner's own (petitioner.priorPetition.*).
const K1_PETITIONER = {
  petitioner_info_lastName: T("petitioner.lastName"),
  petitioner_info_firstName: T("petitioner.firstName"),
  petitioner_info_middleName: T("petitioner.middleName"),
  petitioner_info_gender: T("petitioner.gender"),
  petitioner_info_dateOfBirth: T("petitioner.dateOfBirth", "date"),
  petitioner_info_cityTownOfBirth: T("petitioner.cityTownOfBirth"),
  petitioner_info_stateProvinceOfBirth: T("petitioner.provinceOfBirth"),
  petitioner_info_countryOfBirth: T("petitioner.countryOfBirth"),
  petitioner_info_countryOfCitizenship: T("petitioner.countryOfCitizenship"),
  petitioner_info_fullMailingAddress: T("petitioner.mailingAddress"),
  petitioner_info_fullPhysicalAddress: T("petitioner.physicalAddress"),
  petitioner_info_ssn: T("petitioner.ssn"),
  petitioner_info_uscisOnlineAccountNumber: T("petitioner.uscisOnlineAccountNumber"),
  petitioner_info_aNumber: T("petitioner.aNumber"),
  petitioner_info_maritalStatus: T("petitioner.maritalStatus"),
  petitioner_residentialHistory: T("petitioner.addressHistory", "array"),
  petitioner_employmentHistory: T("petitioner.employmentHistory", "array"),
  petitioner_parents_fatherLastName: T("petitioner.father.lastName"),
  petitioner_parents_fatherFirstName: T("petitioner.father.firstName"),
  petitioner_parents_fatherMiddleName: T("petitioner.father.middleName"),
  petitioner_parents_fatherDateOfBirth: T("petitioner.father.dateOfBirth", "date"),
  petitioner_parents_fatherCountryOfBirth: T("petitioner.father.countryOfBirth"),
  petitioner_parents_fatherCityTownVillageOfResidence: T("petitioner.father.cityTownOfResidence"),
  petitioner_parents_fatherCountryOfResidence: T("petitioner.father.countryOfResidence"),
  petitioner_parents_motherLastName: T("petitioner.mother.lastName"),
  petitioner_parents_motherFirstName: T("petitioner.mother.firstName"),
  petitioner_parents_motherMiddleName: T("petitioner.mother.middleName"),
  petitioner_parents_motherDateOfBirth: T("petitioner.mother.dateOfBirth", "date"),
  petitioner_parents_motherCountryOfBirth: T("petitioner.mother.countryOfBirth"),
  petitioner_parents_motherCityTownVillageOfResidence: T("petitioner.mother.cityTownOfResidence"),
  petitioner_parents_motherCountryOfResidence: T("petitioner.mother.countryOfResidence"),
  petitioner_priorSpouses: T("petitioner.priorSpouses", "array"),
  petitioner_citizenship_throughType: T("petitioner.citizenshipBasis"),
  petitioner_citizenship_hasCertificate: T("petitioner.hasCitizenshipCertificate", "boolean"),
  petitioner_citizenship_certificateNumber: T("petitioner.citizenshipCertificateNumber"),
  petitioner_citizenship_certificatePlaceOfIssuance: T("petitioner.citizenshipCertificatePlaceOfIssuance"),
  petitioner_citizenship_certificateDateOfIssuance: T("petitioner.citizenshipCertificateDateOfIssuance", "date"),
  petitioner_i129f_filedBefore: T("petitioner.priorPetitionFiled", "boolean"),
  petitioner_i129f_aNumber: T("petitioner.priorPetition.beneficiaryANumber"),
  petitioner_i129f_lastName: T("petitioner.priorPetition.beneficiaryLastName"),
  petitioner_i129f_firstName: T("petitioner.priorPetition.beneficiaryFirstName"),
  petitioner_i129f_middleName: T("petitioner.priorPetition.beneficiaryMiddleName"),
  petitioner_i129f_dateOfFiling: T("petitioner.priorPetition.dateOfFiling", "date"),
  petitioner_i129f_uscisAction: T("petitioner.priorPetition.uscisAction"),
  petitioner_children_hasChildrenUnder18: T("petitioner.hasChildrenUnder18", "boolean"),
  petitioner_children_ages: T("petitioner.childrenAges"),
  petitioner_statesCountriesSince18: T("petitioner.placesLivedSince18", "array"),
};

// K-1 fiance(e) beneficiary: the applicant abroad, the same vocabulary as the IR-1 beneficiary.
const K1_BENEFICIARY = {
  beneficiary_info_lastName: T("beneficiary.lastName"),
  beneficiary_info_firstName: T("beneficiary.firstName"),
  beneficiary_info_middleName: T("beneficiary.middleName"),
  beneficiary_info_gender: T("beneficiary.gender"),
  beneficiary_info_dateOfBirth: T("beneficiary.dateOfBirth", "date"),
  beneficiary_info_cityTownOfBirth: T("beneficiary.cityTownOfBirth"),
  beneficiary_info_stateProvinceOfBirth: T("beneficiary.provinceOfBirth"),
  beneficiary_info_countryOfBirth: T("beneficiary.countryOfBirth"),
  beneficiary_info_countryOfCitizenship: T("beneficiary.countryOfCitizenship"),
  beneficiary_info_fullMailingAddress: T("beneficiary.mailingAddress"),
  beneficiary_info_fullPhysicalAddress: T("beneficiary.address"),
  beneficiary_info_ssn: T("beneficiary.ssn"),
  beneficiary_info_aNumber: T("beneficiary.alienRegistrationNumber"),
  beneficiary_info_maritalStatus: T("beneficiary.maritalStatus"),
  beneficiary_residentialHistory: T("beneficiary.addressHistory", "array"),
  beneficiary_employmentHistory: T("beneficiary.employmentHistory", "array"),
  beneficiary_parents_fatherLastName: T("beneficiary.father.lastName"),
  beneficiary_parents_fatherFirstName: T("beneficiary.father.firstName"),
  beneficiary_parents_fatherMiddleName: T("beneficiary.father.middleName"),
  beneficiary_parents_fatherDateOfBirth: T("beneficiary.father.dateOfBirth", "date"),
  beneficiary_parents_fatherCountryOfBirth: T("beneficiary.father.countryOfBirth"),
  beneficiary_parents_fatherCityTownVillageOfResidence: T("beneficiary.father.cityTownOfResidence"),
  beneficiary_parents_fatherCountryOfResidence: T("beneficiary.father.countryOfResidence"),
  beneficiary_parents_motherLastName: T("beneficiary.mother.lastName"),
  beneficiary_parents_motherFirstName: T("beneficiary.mother.firstName"),
  beneficiary_parents_motherMiddleName: T("beneficiary.mother.middleName"),
  beneficiary_parents_motherDateOfBirth: T("beneficiary.mother.dateOfBirth", "date"),
  beneficiary_parents_motherCountryOfBirth: T("beneficiary.mother.countryOfBirth"),
  beneficiary_parents_motherCityTownVillageOfResidence: T("beneficiary.mother.cityTownOfResidence"),
  beneficiary_parents_motherCountryOfResidence: T("beneficiary.mother.countryOfResidence"),
  beneficiary_priorSpouses: T("beneficiary.priorSpouses", "array"),
  beneficiary_usHistory_everBeenToUS: T("beneficiary.hasBeenToUnitedStates", "boolean"),
  beneficiary_usHistory_i94Number: T("beneficiary.i94Number"),
  beneficiary_usHistory_i94ExpiryDate: T("beneficiary.i94ExpirationDate", "date"),
  beneficiary_usHistory_dateOfLastArrival: T("beneficiary.lastArrivalDate", "date"),
  beneficiary_usHistory_dateStatusExpires: T("beneficiary.currentVisaExpirationDate", "date"),
  beneficiary_usHistory_visaOnWhichArrived: T("beneficiary.currentVisaStatus"),
  beneficiary_usHistory_passportNumber: T("beneficiary.passport.number"),
  beneficiary_usHistory_passportCountryOfIssuance: T("beneficiary.passport.country"),
  beneficiary_usHistory_passportExpirationDate: T("beneficiary.passport.expirationDate", "date"),
  beneficiary_children: T("beneficiary.children", "array"),
  beneficiary_intendedUsAddress: T("beneficiary.intendedUsAddress"),
  beneficiary_outsideUsAddress: T("beneficiary.foreignAddress.formatted"),
  beneficiary_consulateCityCountry: T("beneficiary.consularProcessing.consulateCityCountry"),
  beneficiary_biographical_height: T("beneficiary.height"),
  beneficiary_biographical_weight: T("beneficiary.weight"),
  beneficiary_biographical_eyeColor: T("beneficiary.eyeColor"),
  beneficiary_biographical_hairColor: T("beneficiary.hairColor"),
  beneficiary_marriageBroker_usedBroker: T("beneficiary.usedInternationalMarriageBroker", "boolean"),
  beneficiary_marriageBroker_brokerNameAddress: T("beneficiary.marriageBrokerNameAddress"),
  beneficiary_metWithinTwoYears: T("beneficiary.metPetitionerWithinTwoYears", "boolean"),
};

// ── Sibling checklists ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A checklist that is the same set of questions under another visa / category name (same question keys) shares the table of the checklist it repeats: L-1B and
// L-1A extension repeat L-1A; every family category (CR-1, IR-2 ... F4) repeats the IR-1 I-130 petitioner / beneficiary and I-864 sponsor checklists.
const FAMILY_CATEGORIES = ["cr1", "ir2", "cr2", "ir3", "ir4", "ir5", "f1", "f2a", "f2b", "f3", "f4"];
const SIBLINGS = {
  ...Object.fromEntries(["l1b", "l1aext"].flatMap((visa) => [[`${visa}_employer_checklist`, L1A_EMPLOYER], [`${visa}_employee_checklist`, L1A_EMPLOYEE]])),
  ...Object.fromEntries(FAMILY_CATEGORIES.flatMap((category) => [
    [`i130_${category}_petitioner_checklist`, IR1_PETITIONER],
    [`i130_${category}_beneficiary_checklist`, IR1_BENEFICIARY],
    [`i864_${category}_petitioner_checklist`, I864_PETITIONER],
  ])),
};

// ── Everything else ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The remaining checklists (single-person filings such as N-400 / N-600 / I-131 / I-90 / change of status / H-4, the family green card and NVC checklists, the
// business plans, E-2, EB-1, O-1, I-824 ...) are listed in partyChecklistPathsExtended.js (one row per question). In a single-person filing the person filing
// is the petitioner (petitioner.*); in a family green card / NVC checklist the applicant is the beneficiary (beneficiary.*). PERM is deliberately not included.
const { EXTENDED_ROWS } = require("./partyChecklistPathsExtended");
const EXTENDED = Object.fromEntries(Object.entries(EXTENDED_ROWS).map(([checklistKey, rows]) => [
  checklistKey,
  Object.freeze(Object.fromEntries(Object.entries(rows).map(([questionKey, [path, type]]) => [questionKey, T(path, type)]))),
]));

const CHECKLIST_PARTY_PATHS = Object.freeze({
  // batch 1
  h1b_employer_checklist: Object.freeze(H1B_EMPLOYER),
  h1b_employee_checklist: Object.freeze(H1B_EMPLOYEE),
  i907_premium_processing_profile: Object.freeze(I907),
  i130_ir1_petitioner_checklist: Object.freeze(IR1_PETITIONER),
  // batch 2
  l1a_employer_checklist: Object.freeze(L1A_EMPLOYER),
  l1a_employee_checklist: Object.freeze(L1A_EMPLOYEE),
  tn_employer_checklist: Object.freeze(TN_EMPLOYER),
  tn_employee_checklist: Object.freeze(TN_EMPLOYEE),
  i140_petitioner_checklist: Object.freeze(I140_PETITIONER),
  i140_beneficiary_checklist: Object.freeze(I140_BENEFICIARY),
  i130_ir1_beneficiary_checklist: Object.freeze(IR1_BENEFICIARY),
  i864_ir1_petitioner_checklist: Object.freeze(I864_PETITIONER),
  // batch 3
  e3_employer_checklist: Object.freeze(E3_EMPLOYER),
  e3_employee_checklist: Object.freeze(E3_EMPLOYEE),
  p_employer_checklist: Object.freeze(P_EMPLOYER),
  p_employee_checklist: Object.freeze(P_EMPLOYEE),
  o1_employer_checklist: Object.freeze(O1_EMPLOYER),
  o1_employee_checklist: Object.freeze(O1_EMPLOYEE),
  o2_employer_checklist: Object.freeze(O2_EMPLOYER),
  o2_employee_checklist: Object.freeze(O2_EMPLOYEE),
  k1_petitioner_checklist: Object.freeze(K1_PETITIONER),
  k1_beneficiary_checklist: Object.freeze(K1_BENEFICIARY),
  // the K-3 checklists ask exactly the K-1 questions (same keys), and the I-130 / I-129F graph reads those keys for both, so they share the K-1 tables
  k3_petitioner_checklist: Object.freeze(K1_PETITIONER),
  k3_beneficiary_checklist: Object.freeze(K1_BENEFICIARY),
  // the checklists that repeat a listed one (see SIBLINGS): 37 more checklists, no new mapping decisions
  ...Object.fromEntries(Object.entries(SIBLINGS).map(([checklistKey, table]) => [checklistKey, Object.freeze(table)])),
  // batch 4: every other checklist (except PERM)
  ...EXTENDED,
});

// questionKey -> { path, type } across the listed checklists (a question key is unique to its checklist family; used to rewire a form's raw edges)
const QUESTION_PATH_INDEX = (() => {
  const index = new Map();
  for (const [checklistKey, questions] of Object.entries(CHECKLIST_PARTY_PATHS)) {
    for (const [questionKey, spec] of Object.entries(questions)) index.set(questionKey, { ...spec, checklistKey });
  }
  return index;
})();

const GENERIC_ROOTS = /^(petitioner|beneficiary)\./;

// registry entries for the generic paths that had no entry yet (CanonicalFieldRegistryService adds only the ones it does not know)
const PARTY_CHECKLIST_FIELDS = Object.freeze(
  [...new Map([...QUESTION_PATH_INDEX.values()].map((spec) => [spec.path, { path: spec.path, aliases: [], type: spec.type === "array" ? "text" : spec.type }])).values()]
);

function pathFor(checklistKey, questionKey) {
  return CHECKLIST_PARTY_PATHS[checklistKey]?.[questionKey]?.path || null;
}

module.exports = { CHECKLIST_PARTY_PATHS, QUESTION_PATH_INDEX, PARTY_CHECKLIST_FIELDS, GENERIC_ROOTS, pathFor };
