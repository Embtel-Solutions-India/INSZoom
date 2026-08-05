const { confidenceBand } = require("../schemas/document-intelligence.schema");

const LABELS = {
  firstName: "First Name",
  middleName: "Middle Name",
  lastName: "Last Name",
  passportNumber: "Passport Number",
  nationality: "Nationality",
  dateOfBirth: "Date Of Birth",
  gender: "Gender",
  issueDate: "Issue Date",
  expiryDate: "Expiry Date",
  expirationDate: "Expiration Date",
  mrzData: "MRZ Data",
  visaType: "Visa Type",
  controlNumber: "Control Number",
  issuingCountry: "Issuing Country",
  admissionDate: "Admission Date",
  classOfAdmission: "Class Of Admission",
  i94Number: "I-94 Number",
  university: "University",
  degree: "Degree",
  major: "Major",
  graduationDate: "Graduation Date",
  title: "Title",
  authors: "Authors",
  journal: "Journal",
  publicationDate: "Publication Date",
  doi: "DOI",
  citationCount: "Citation Count",
  awardName: "Award Name",
  issuer: "Issuer",
  patentNumber: "Patent Number",
  patentTitle: "Patent Title",
  inventors: "Inventors",
};

function normalizeFieldValue(field) {
  if (field && typeof field === "object" && Object.prototype.hasOwnProperty.call(field, "value")) return field.value;
  return field;
}

function normalizeFieldConfidence(field) {
  if (field && typeof field === "object" && Object.prototype.hasOwnProperty.call(field, "confidence")) {
    return Math.max(0, Math.min(100, Number(field.confidence) || 0));
  }
  return 70;
}

function toFieldExtractions(fields = {}, documentId, evidenceCategory) {
  return Object.entries(fields)
    .filter(([, field]) => normalizeFieldValue(field) !== undefined && normalizeFieldValue(field) !== null && normalizeFieldValue(field) !== "")
    .map(([key, field]) => {
      const confidence = normalizeFieldConfidence(field);
      const band = confidenceBand(confidence);
      return {
        key,
        label: LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()),
        value: normalizeFieldValue(field),
        confidence,
        reviewStatus: band,
        sourceDocument: documentId,
        extractionTimestamp: new Date(),
        evidenceCategory,
        validationStatus: Array.isArray(field.validationIssues) && field.validationIssues.length ? "review_required" : "valid",
        validationIssues: field.validationIssues || [],
      };
    });
}

function aggregateConfidence(fields = [], fallback = 0) {
  if (!fields.length) return Number(fallback) || 0;
  return Math.round(fields.reduce((sum, field) => sum + (Number(field.confidence) || 0), 0) / fields.length);
}

module.exports = {
  aggregateConfidence,
  confidenceBand,
  toFieldExtractions,
};
