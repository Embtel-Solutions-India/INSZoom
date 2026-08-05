const providerRegistry = require("../providers/document-intelligence-provider.registry");
const { normalizePassportExtractionDto } = require("../dto/passport-extraction.dto");
const { PASSPORT_FIELDS, PASSPORT_JSON_SCHEMA_EXAMPLE } = require("../schemas/passport-extraction.schema");
const { validatePassportExtraction } = require("../validators/passport.validator");

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
  return applyValidation(normalizePassportExtractionDto(response));
}

module.exports = {
  extract,
  passportExtractionPrompt,
};
