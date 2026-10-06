const providerRegistry = require("../providers/document-intelligence-provider.registry");
const { normalizeDocumentType } = require("../schemas/document-intelligence.schema");
const { CLASSIFICATION_PROMPT_VERSION, documentClassificationPrompt } = require("./classification-prompt.templates");

async function classify({ document, buffer }) {
  const request = { prompt: documentClassificationPrompt(document), buffer, mimeType: document.mimeType || document.fileType };
  let result = await providerRegistry.generateStructuredJson(request);
  // Document AI only OCRs: with no document-type entity it reports "other". An LLM can tell a resume from a passport,
  // so ask it (never replaces a real classification, only the "could not tell" case).
  const fallbackProvider = providerRegistry.promptProviderName();
  if (normalizeDocumentType(result.documentType) === "other" && result.__provider !== fallbackProvider) {
    // Gemini answers "high demand" in bursts: retry a few times. If it still cannot answer, FAIL (so the upload reports it
    // and can be retried) rather than quietly leaving the file as "other" and extracting nothing.
    let llmError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const llm = await providerRegistry.generateStructuredJson({ ...request, provider: fallbackProvider });
        llmError = null;
        if (normalizeDocumentType(llm.documentType) !== "other") result = llm;
        break;
      } catch (error) {
        llmError = error;
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
    if (llmError) throw llmError;
  }
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
