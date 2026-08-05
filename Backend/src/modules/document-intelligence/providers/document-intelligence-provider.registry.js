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

register("gemini", require("../services/gemini.service"));

module.exports = {
  generateStructuredJson,
  register,
  resolve,
};
