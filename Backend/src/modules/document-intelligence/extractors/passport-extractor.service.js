const providerRegistry = require("../providers/document-intelligence-provider.registry");
const { normalizePassportExtractionDto } = require("../dto/passport-extraction.dto");
const { PASSPORT_FIELDS, PASSPORT_JSON_SCHEMA_EXAMPLE } = require("../schemas/passport-extraction.schema");
const { validatePassportExtraction } = require("../validators/passport.validator");
const { parseMrzFromText } = require("./mrz-parser.service");

// MRZ (machine-readable zone) field -> PASSPORT_FIELDS key. Deliberately
// covers only what the MRZ actually encodes (ICAO 9303 TD3) - placeOfBirth,
// issueDate and mrzData's own free-text counterpart have no MRZ source and
// are left to whatever the configured provider (Document AI / Gemini)
// extracted from the visible page text.
const MRZ_TO_PASSPORT_FIELD = {
  lastName: "lastName",
  firstName: "firstName",
  middleName: "middleName",
  passportNumber: "passportNumber",
  nationality: "nationality",
  dateOfBirth: "dateOfBirth",
  gender: "gender",
  expiryDate: "expiryDate",
  issuingCountry: "issuingCountry",
};

// MRZ is a deterministic, checksum-verified read of a fixed-format printed
// field - once a field's own checksum passes, there is no more accurate
// source available for it, so it overrides whatever the AI provider guessed
// from the visible (non-MRZ) page text. A checksum failure means the OCR
// text for that specific MRZ field is corrupted, not that the field is
// blank - it is left as null here and the AI provider's own value for that
// field (if any) is kept untouched rather than being cleared.
function applyMrzOverrides(normalized) {
  const mrz = parseMrzFromText(normalized.rawText);
  if (!mrz) return normalized;
  Object.entries(MRZ_TO_PASSPORT_FIELD).forEach(([mrzKey, fieldKey]) => {
    const value = mrz[mrzKey];
    if (value == null || !normalized.fields[fieldKey]) return;
    normalized.fields[fieldKey] = { value, confidence: 100, source: "mrz" };
  });
  if (mrz.mrzData && normalized.fields.mrzData) {
    normalized.fields.mrzData = { value: mrz.mrzData, confidence: 100, source: "mrz" };
  }
  normalized.entities.mrz = { checksums: mrz.checksums };
  return normalized;
}

function passportExtractionPrompt(document) {
  return [
    "You are extracting data from a passport biographic page for an immigration case management system.",
    "Return ONLY valid JSON. Do not include markdown, comments, explanations, or text outside JSON.",
    "If a field is not visible or uncertain, return null for value and a low confidence score.",
    "Each field must be an object with value and confidence.",
    `Required fields: ${PASSPORT_FIELDS.join(", ")}.`,
    "Extract MRZ data exactly as printed if available.",
    "Normalize dates to YYYY-MM-DD when possible, otherwise preserve the visible date text.",
    "Use this exact JSON shape:",
    JSON.stringify(PASSPORT_JSON_SCHEMA_EXAMPLE, null, 2),
    `Filename: ${document.originalName || document.originalFileName || document.fileName || ""}`,
  ].join("\n");
}

function applyValidation(normalized) {
  const validation = validatePassportExtraction(normalized.fields);
  Object.entries(validation.issuesByField).forEach(([fieldKey, issues]) => {
    if (!normalized.fields[fieldKey]) return;
    normalized.fields[fieldKey].validationIssues = issues;
    normalized.fields[fieldKey].validationStatus = "review_required";
    normalized.fields[fieldKey].confidence = Math.min(Number(normalized.fields[fieldKey].confidence) || 0, 79);
  });
  normalized.entities.validation = validation;
  if (!validation.valid) normalized.overallConfidence = Math.min(Number(normalized.overallConfidence) || 0, 79);
  return normalized;
}

async function extract({ document, buffer, geminiResponse }) {
  const response = geminiResponse || await providerRegistry.generateStructuredJson({
    prompt: passportExtractionPrompt(document),
    buffer,
    mimeType: document.mimeType || document.fileType,
  });
  return applyValidation(applyMrzOverrides(normalizePassportExtractionDto(response)));
}

module.exports = {
  extract,
  passportExtractionPrompt,
};
