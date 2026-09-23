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

// Both "gemini" and "google_document_ai" are registered against this
// registry — see document-intelligence.service.js's top-of-file
// registration block, the single shared dependency every classify/extract
// path (HTTP controller, async queue processor) goes through. Which one is
// actually active for a given deployment is controlled entirely by the
// DOCUMENT_INTELLIGENCE_PROVIDER env var resolve() reads above; if it's set
// to something neither of them registered under, resolve()/
// generateStructuredJson() still correctly throw DOCUMENT_PROVIDER_UNAVAILABLE
// (503) rather than silently picking one.

module.exports = {
  generateStructuredJson,
  register,
  resolve,
};
