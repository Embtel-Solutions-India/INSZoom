const providerRegistry = require("../providers/document-intelligence-provider.registry");
const { normalizeResumeExtractionDto } = require("../dto/resume-extraction.dto");
const { RESUME_FIELDS, RESUME_JSON_SCHEMA_EXAMPLE, DEGREE_TYPES } = require("../schemas/resume-extraction.schema");
const { validateResumeExtraction } = require("../validators/resume.validator");

function resumeExtractionPrompt(document) {
  return [
    "You are extracting structured career history from a resume/CV for an immigration case management system.",
    "Return ONLY valid JSON. Do not include markdown, comments, explanations, or text outside JSON.",
    "If a field is not visible or uncertain, return null (or an empty array) and a low confidence score.",
    "Each top-level field must be an object with value and confidence.",
    `Required fields: ${RESUME_FIELDS.join(", ")}.`,
    `education[].degreeType MUST be exactly one of these values (or null if it cannot be determined) - do not invent your own strings: ${DEGREE_TYPES.join(", ")}.`,
    "Every entry in education[] and employment[] must carry its own confidence (0-100).",
    "Do not fabricate an entry to fill the array - only include education/employment entries actually present in the document.",
    "Normalize dates to YYYY-MM-DD when possible, otherwise preserve the visible date text.",
    "Use this exact JSON shape:",
    JSON.stringify(RESUME_JSON_SCHEMA_EXAMPLE, null, 2),
    `Filename: ${document.originalName || document.originalFileName || document.fileName || ""}`,
  ].join("\n");
}

function applyValidation(normalized) {
  const validation = validateResumeExtraction(normalized.fields);
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
    prompt: resumeExtractionPrompt(document),
    buffer,
    mimeType: document.mimeType || document.fileType,
  });
  return applyValidation(normalizeResumeExtractionDto(response));
}

module.exports = {
  extract,
  resumeExtractionPrompt,
};
