const providers = new Map();

function providerError(name) {
  const error = new Error(`Document intelligence provider "${name}" is not configured`);
  error.statusCode = 503;
  error.code = "DOCUMENT_PROVIDER_UNAVAILABLE";
  return error;
}

function register(name, provider) {
  if (!name || typeof provider?.generateStructuredJson !== "function") {
    throw new TypeError("Document intelligence providers must expose generateStructuredJson()");
  }
  providers.set(String(name).toLowerCase(), provider);
}

function resolve(name = process.env.DOCUMENT_INTELLIGENCE_PROVIDER || "gemini") {
  const normalized = String(name).toLowerCase();
  const provider = providers.get(normalized);
  if (!provider) throw providerError(normalized);
  return { name: normalized, provider };
}

async function generateStructuredJson(options = {}) {
  const resolved = resolve(options.provider);
  const result = await resolved.provider.generateStructuredJson(options);
  return { ...result, __provider: resolved.name };
}

// Gemini OCR has been removed as the document-intelligence provider (Gemini
// itself is untouched and still used by the general-purpose `ai` module —
// see modules/ai/ai-provider.registry.js — this registry is document-
// intelligence-specific). No provider is registered here right now, so
// resolve()/generateStructuredJson() correctly throw the existing
// DOCUMENT_PROVIDER_UNAVAILABLE (503) for every classify/extract call until
// a Google Document AI provider is registered here in a future phase.

module.exports = {
  generateStructuredJson,
  register,
  resolve,
};
