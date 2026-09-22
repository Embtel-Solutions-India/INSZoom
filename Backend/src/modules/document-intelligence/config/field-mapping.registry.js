const FIELD_MAPPINGS = {
  passport: {
    firstName: {
      beneficiary: "firstName",
      questionnaire: ["employee_personal_firstName", "firstName", "personal.firstName"],
      case: "clientName",
    },
    middleName: {
      beneficiary: "middleName",
      questionnaire: ["employee_personal_middleName", "middleName", "personal.middleName"],
    },
    lastName: {
      beneficiary: "lastName",
      questionnaire: ["employee_personal_lastName", "lastName", "personal.lastName"],
      case: "clientName",
    },
    passportNumber: {
      beneficiary: "passportNumber",
      questionnaire: ["employee_personal_passportNumber", "passportNumber", "passport.number", "passportInfo.passportNumber"],
      case: "documentChecklist.passport.documentNumber",
    },
    nationality: {
      beneficiary: "nationality",
      questionnaire: ["employee_personal_countryOfCitizenship", "nationality", "personal.nationality"],
    },
    dateOfBirth: {
      beneficiary: "dateOfBirth",
      questionnaire: ["employee_personal_dateOfBirth", "dateOfBirth", "dob", "personal.dateOfBirth"],
    },
    gender: {
      beneficiary: "gender",
      questionnaire: ["employee_personal_gender", "gender", "personal.gender"],
    },
    issueDate: {
      beneficiary: "passportIssueDate",
      questionnaire: ["employee_personal_passportIssueDate", "passportIssueDate", "passport.issueDate"],
    },
    expiryDate: {
      beneficiary: "passportExpirationDate",
      questionnaire: ["employee_personal_passportExpirationDate", "passportExpirationDate", "passport.expiryDate", "passport.expirationDate"],
      case: "documentChecklist.passport.expiryDate",
    },
    expirationDate: {
      beneficiary: "passportExpirationDate",
      questionnaire: ["employee_personal_passportExpirationDate", "passportExpirationDate", "passport.expiryDate", "passport.expirationDate"],
      case: "documentChecklist.passport.expiryDate",
    },
  },
  resume: {
    // "education"/"employment" are arrays of degree/job entries extracted from
    // the resume - there's no single flat questionnaire question they can map
    // to as-is (a checklist asks for one degree's field of study, not "the
    // education array"). They still sync the full history to the Beneficiary
    // profile; the granular checklist questions are filled from the derived
    // scalar fields below (see deriveEducationScalarFields in
    // extraction-mapping.service.js), which project the most relevant degree
    // entry into the flat shape a checklist question actually expects.
    education: {
      beneficiary: "educationHistory",
    },
    employment: {
      beneficiary: "employmentHistory",
    },
    employmentHistory: {
      beneficiary: "employmentHistory",
    },
    // Derived from the primary (latest-completed) education entry. Candidate
    // keys cover both the flat generic questionnaires (h1b_questionnaire,
    // niw_questionnaire, ...) and the underscored paths the employer/employee
    // checklists use (see employmentChecklists.js's entry.path.replace(/\./g, "_")).
    educationDegreeType: {
      questionnaire: ["degreeType", "employee_education_degreeType"],
    },
    educationHighestLevel: {
      questionnaire: ["degreeLevel", "highestLevel", "employee_education_highestLevel"],
    },
    educationMajorFieldOfStudy: {
      questionnaire: ["fieldOfStudy", "degreeField", "employee_education_majorFieldOfStudy"],
    },
    educationInstitutionName: {
      questionnaire: ["university", "usInstitutionName", "employee_education_usInstitutionName"],
    },
    educationDegreeAwardDate: {
      questionnaire: ["degreeAwardDate", "employee_education_degreeAwardDate"],
    },
    publications: {
      questionnaire: ["publications", "publicationCount", "research.publications"],
    },
    awards: {
      questionnaire: ["awards", "hasAwards", "honors.awards"],
    },
    skills: {
      questionnaire: ["skills", "technicalSkills"],
    },
    memberships: {
      questionnaire: ["memberships", "professionalMemberships", "hasMemberships"],
    },
    professionalMemberships: {
      questionnaire: ["memberships", "professionalMemberships", "hasMemberships"],
    },
    patents: {
      questionnaire: ["patents", "hasPatents", "research.patents"],
    },
    researchExperience: {
      questionnaire: ["researchExperience", "research.experience"],
    },
  },
  lca: {
    firstName: { questionnaire: ["employee_personal_firstName"] },
    middleName: { questionnaire: ["employee_personal_middleName"] },
    lastName: { questionnaire: ["employee_personal_lastName"] },
    dateOfBirth: { questionnaire: ["employee_personal_dateOfBirth"] },
    gender: { questionnaire: ["employee_personal_gender"] },
    countryOfBirth: { questionnaire: ["employee_personal_countryOfBirth"] },
    countryOfCitizenship: { questionnaire: ["employee_personal_countryOfCitizenship"] },
    citizenship: { questionnaire: ["employee_personal_countryOfCitizenship"] },
    alienNumber: { questionnaire: ["employee_personal_alienRegistrationNumber"] },
    aNumber: { questionnaire: ["employee_personal_alienRegistrationNumber"] },
    alienRegistrationNumber: { questionnaire: ["employee_personal_alienRegistrationNumber"] },
    passportNumber: { questionnaire: ["employee_personal_passportNumber"] },
    passportExpiry: { questionnaire: ["employee_personal_passportExpirationDate"] },
    passportExpirationDate: { questionnaire: ["employee_personal_passportExpirationDate"] },
    employerLegalName: { questionnaire: ["employer_company_fullName"] },
    legalBusinessName: { questionnaire: ["employer_company_fullName"] },
    employerName: { questionnaire: ["employer_company_fullName"] },
    employerFein: { questionnaire: ["employer_company_fein"] },
    employerEin: { questionnaire: ["employer_company_fein"] },
    ein: { questionnaire: ["employer_company_fein"] },
    employerStreet: { questionnaire: ["employer_company_address_street"] },
    employerAddressStreet: { questionnaire: ["employer_company_address_street"] },
    employerCity: { questionnaire: ["employer_company_address_city"] },
    employerState: { questionnaire: ["employer_company_address_state"] },
    employerZip: { questionnaire: ["employer_company_address_zipCode"] },
    employerZipCode: { questionnaire: ["employer_company_address_zipCode"] },
    employerPhone: { questionnaire: ["employer_company_daytimePhone"] },
    employerDaytimePhone: { questionnaire: ["employer_company_daytimePhone"] },
    naicsCode: { questionnaire: ["employer_company_naicsCode"] },
    principalActivity: { questionnaire: ["employer_company_businessType"] },
    totalWorkers: { questionnaire: ["employer_workforce_totalUsEmployees"] },
    jobTitle: { questionnaire: ["employer_position_jobTitle"] },
    socCode: { questionnaire: ["employer_position_socCode"] },
    wageLevel: { questionnaire: ["employer_position_wageLevel"] },
    prevailingWageLevel: { questionnaire: ["employer_position_wageLevel"] },
    offeredSalary: { questionnaire: ["employer_position_offeredSalary"] },
    offeredWageRate: { questionnaire: ["employer_position_offeredSalary"] },
    actualWage: { questionnaire: ["employer_position_offeredSalary"] },
    employmentStartDate: { questionnaire: ["employer_position_employmentStartDate"] },
    employmentBeginDate: { questionnaire: ["employer_position_employmentStartDate"] },
    startDate: { questionnaire: ["employer_position_employmentStartDate"] },
  },
  // I-94. Two real candidate suffixes for the status-expiration question are
  // listed because different checklists use different ones for the same
  // concept (confirmed: pVisaChecklists/o1VisaChecklists use
  // "currentStatusExpirationDate", tnChecklists uses "statusExpirationDate").
  i94: {
    i94Number: { questionnaire: ["employee_immigrationStatus_i94Number"] },
    admissionDate: { questionnaire: ["employee_immigrationStatus_dateOfLastArrival"] },
    arrivalDate: { questionnaire: ["employee_immigrationStatus_dateOfLastArrival"] },
    classOfAdmission: { questionnaire: ["employee_immigrationStatus_currentVisaStatus"] },
    i94ExpirationDate: { questionnaire: ["employee_immigrationStatus_currentStatusExpirationDate", "employee_immigrationStatus_statusExpirationDate"] },
    authorizedUntil: { questionnaire: ["employee_immigrationStatus_currentStatusExpirationDate", "employee_immigrationStatus_statusExpirationDate"] },
    firstName: { questionnaire: ["employee_personal_firstName"] },
    lastName: { questionnaire: ["employee_personal_lastName"] },
  },
  // Approval notice / prior I-797s. Deliberately does NOT map validFrom/
  // validTo/noticeDate anywhere — there is no verified boolean/date
  // questionnaire field for an approval period, and guessing one risks
  // silently corrupting an unrelated question.
  approval_notice: {
    receiptNumber: { questionnaire: ["employee_personal_latestPriorPetitionNumber"] },
    firstName: { questionnaire: ["employee_personal_firstName"] },
    lastName: { questionnaire: ["employee_personal_lastName"] },
  },
  // Degree / academic certificates. Reuses the same verified
  // employee_education_* keys as resume's education* fields above.
  degree: {
    degree: { questionnaire: ["employee_education_degreeType"] },
    major: { questionnaire: ["employee_education_majorFieldOfStudy"] },
    fieldOfStudy: { questionnaire: ["employee_education_majorFieldOfStudy"] },
    university: { questionnaire: ["employee_education_usInstitutionName"] },
    graduationDate: { questionnaire: ["employee_education_degreeAwardDate"] },
  },
  // Credential evaluation report — same education keys, plus the
  // US-masters-or-higher gate question the checklist actually asks.
  credential_evaluation: {
    usEquivalentDegree: { questionnaire: ["employee_education_degreeType"] },
    fieldOfStudy: { questionnaire: ["employee_education_majorFieldOfStudy"] },
    hasUsMastersOrHigher: { questionnaire: ["employee_education_hasUsMastersOrHigher"] },
  },
  // Driver's license / state ID — the existing current-US-address questions.
  driver_license: {
    firstName: { questionnaire: ["employee_personal_firstName"] },
    lastName: { questionnaire: ["employee_personal_lastName"] },
    dateOfBirth: { questionnaire: ["employee_personal_dateOfBirth"] },
    street: { questionnaire: ["employee_personal_currentUsAddress_street"] },
    city: { questionnaire: ["employee_personal_currentUsAddress_city"] },
    state: { questionnaire: ["employee_personal_currentUsAddress_state"] },
    zipCode: { questionnaire: ["employee_personal_currentUsAddress_zipCode"] },
  },
  // Offer letter / employment verification letter — the CURRENT sponsoring
  // employer/position, so these reuse lca's employer_position_*/
  // employer_company_* targets directly (same real, verified keys).
  offer_letter: {
    employer: { questionnaire: ["employer_company_fullName"] },
    jobTitle: { questionnaire: ["employer_position_jobTitle"] },
    startDate: { questionnaire: ["employer_position_employmentStartDate"] },
    salary: { questionnaire: ["employer_position_offeredSalary"] },
  },
  employment_verification_letter: {
    employer: { questionnaire: ["employer_company_fullName"] },
    jobTitle: { questionnaire: ["employer_position_jobTitle"] },
    salary: { questionnaire: ["employer_position_offeredSalary"] },
  },
  // Prior/former employment — history only, never routed to the current
  // sponsoring position's employer_position_*/employer_company_* fields.
  // Mirrors resume's employment/education entries above (beneficiary-only,
  // no flat questionnaire target — there's no single "prior job title"
  // question a past-employer letter could safely overwrite).
  employment_letter: {
    employer: { beneficiary: "employmentHistory" },
    employeeName: { beneficiary: "fullName" },
  },
  experience_letter: {
    employer: { beneficiary: "employmentHistory" },
    employeeName: { beneficiary: "fullName" },
  },
  // Business documents. legalName only — registrationNumber is deliberately
  // never mapped to employer_company_fein (a state registration number is
  // not an EIN).
  business_license: {
    legalName: { questionnaire: ["employer_company_fullName"] },
  },
  business_registration: {
    legalName: { questionnaire: ["employer_company_fullName"] },
  },
  articles_of_incorporation: {
    legalName: { questionnaire: ["employer_company_fullName"] },
  },
  // Birth certificate — only the fields a birth certificate genuinely
  // supports being reused for (name + DOB), using the same verified
  // employee_personal_* keys as passport above. registrationNumber/
  // issuingAuthority/parentNames have no real questionnaire field to map to
  // and are intentionally left unmapped rather than invented.
  birth_certificate: {
    firstName: { questionnaire: ["employee_personal_firstName"] },
    lastName: { questionnaire: ["employee_personal_lastName"] },
    dateOfBirth: { questionnaire: ["employee_personal_dateOfBirth"] },
  },
  // Marriage certificate — only verified against the SB-1 checklist's own
  // spouse questions (sb1Checklist.js/sb1Checklist.test.js); no equivalent
  // was found in the other family-workflow checklists, so this may not
  // match every visa type's questionnaire yet. spouseOneName/spouseTwoName
  // (the extractor's own field names — each a full name, one per spouse)
  // are intentionally left unmapped: there is no clean 1:1 correspondence to
  // the split client_spouseFirstName/client_spouseLastName questions
  // without a name-splitting step this mapping table doesn't do, and
  // guessing which extracted name is "the spouse" risks writing the wrong
  // person's name into the wrong field. Only the unambiguous date maps.
  marriage_certificate: {
    marriageDate: { questionnaire: ["client_dateOfMarriage"] },
  },
};

// Resolves checklist-slot aliases (employee_i94_copy -> i94,
// academic_certificates -> degree, cv -> resume, ...) through the single
// real alias table (document-intelligence.schema.js's
// DOCUMENT_TYPE_ALIASES/normalizeDocumentType) instead of hand-rolling a
// second, smaller one here - keeps this file and the classifier/extraction
// pipeline from drifting out of sync on what an alias means.
const { normalizeDocumentType } = require("../schemas/document-intelligence.schema");

function mappingsFor(documentType) {
  const normalized = normalizeDocumentType(documentType);
  return {
    ...(FIELD_MAPPINGS[documentType] || {}),
    ...(FIELD_MAPPINGS[normalized] || {}),
  };
}

function mappingFor(documentType, fieldKey) {
  return mappingsFor(documentType)[fieldKey];
}

module.exports = {
  FIELD_MAPPINGS,
  mappingFor,
  mappingsFor,
};
