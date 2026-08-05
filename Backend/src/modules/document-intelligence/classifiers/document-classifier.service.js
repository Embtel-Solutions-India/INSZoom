const providerRegistry = require("../providers/document-intelligence-provider.registry");
const { normalizeDocumentType } = require("../schemas/document-intelligence.schema");
const { CLASSIFICATION_PROMPT_VERSION, documentClassificationPrompt } = require("./classification-prompt.templates");

async function classify({ document, buffer }) {
  const result = await providerRegistry.generateStructuredJson({
    prompt: documentClassificationPrompt(document),
    buffer,
    mimeType: document.mimeType || document.fileType,
  });
  return {
    documentType: normalizeDocumentType(result.documentType),
    confidence: Math.max(0, Math.min(100, Number(result.confidence) || 0)),
    reasoning: result.reasoning || "",
    rawResponse: result,
    promptVersion: CLASSIFICATION_PROMPT_VERSION,
    provider: result.__provider || process.env.DOCUMENT_INTELLIGENCE_PROVIDER || "gemini",
  };
}

async function classifyWithRetry({ document, buffer, maxAttempts = Number(process.env.DOCUMENT_CLASSIFICATION_MAX_ATTEMPTS || 3) }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const classification = await classify({ document, buffer });
      return { ...classification, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * attempt, 3000)));
    }
  }
  throw lastError;
}

module.exports = {
  classify,
  classifyWithRetry,
  documentClassificationPrompt,
};
