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
};

function mappingsFor(documentType) {
  return {
    ...(FIELD_MAPPINGS[documentType] || {}),
    ...(documentType === "cv" ? FIELD_MAPPINGS.resume : {}),
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
