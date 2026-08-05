const PASSPORT_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "passportNumber",
  "nationality",
  "dateOfBirth",
  "gender",
  "issueDate",
  "expiryDate",
  "placeOfBirth",
  "issuingCountry",
  "mrzData",
];

const PASSPORT_JSON_SCHEMA_EXAMPLE = {
  fields: {
    firstName: { value: "string|null", confidence: "number 0-100" },
    middleName: { value: "string|null", confidence: "number 0-100" },
    lastName: { value: "string|null", confidence: "number 0-100" },
    passportNumber: { value: "string|null", confidence: "number 0-100" },
    nationality: { value: "string|null", confidence: "number 0-100" },
    dateOfBirth: { value: "YYYY-MM-DD|string|null", confidence: "number 0-100" },
    gender: { value: "string|null", confidence: "number 0-100" },
    issueDate: { value: "YYYY-MM-DD|string|null", confidence: "number 0-100" },
    expiryDate: { value: "YYYY-MM-DD|string|null", confidence: "number 0-100" },
    placeOfBirth: { value: "string|null", confidence: "number 0-100" },
    issuingCountry: { value: "string|null", confidence: "number 0-100" },
    mrzData: { value: "string|null", confidence: "number 0-100" },
  },
  rawText: "string",
  overallConfidence: "number 0-100",
};

module.exports = {
  PASSPORT_FIELDS,
  PASSPORT_JSON_SCHEMA_EXAMPLE,
};
