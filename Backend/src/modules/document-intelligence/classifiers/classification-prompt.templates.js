const { DOCUMENT_TYPES } = require("../schemas/document-intelligence.schema");

const CLASSIFICATION_PROMPT_VERSION = "classification.v1";

function documentClassificationPrompt(document) {
  return [
    "You are an immigration document classification engine.",
    "Classify the uploaded document before extraction.",
    "Return ONLY valid JSON. Do not return markdown, prose, comments, or text outside JSON.",
    `Supported documentType values: ${DOCUMENT_TYPES.join(", ")}.`,
    "Use recommendation_letter for recommendation/support letters.",
    "Use visa for visa stamps, i94 for I-94 records, salary for salary/pay evidence, press for media articles.",
    "If uncertain, choose other and explain why.",
    "Return this exact JSON shape:",
    "{",
    '  "documentType": "passport",',
    '  "confidence": 0,',
    '  "reasoning": "short explanation"',
    "}",
    `Filename: ${document.originalName || document.originalFileName || document.fileName || ""}`,
    `Existing documentType hint: ${document.documentType || ""}`,
    `Category hint: ${document.category || ""}`,
  ].join("\n");
}

module.exports = {
  CLASSIFICATION_PROMPT_VERSION,
  documentClassificationPrompt,
};
