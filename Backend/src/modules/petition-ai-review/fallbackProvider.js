// Backup AI for the petition scan (Petition AI Review): when Gemini refuses for billing (402), quota (429) or a rejected request, the same
// pages are reviewed as TEXT by another provider that has a key on the server (OpenAI, Anthropic, Azure OpenAI, private model), through the
// platform's existing ai-provider.registry. Those providers take text only, so the backup always runs in text mode.
// pickFallbackProvider() returns null when no other provider has a key - then the scan pauses instead (Phase 3) and resumes on its own.
const { AI_ERROR } = require("./constants");
const { PetitionAiError } = require("./petitionGemini");

/** First non-Gemini provider whose key variable is set (and endpoint, when it needs one). Null when none. */
function pickFallbackProvider({ definitions, env = process.env } = {}) {
  const list = definitions || safeRegistry()?.DEFAULTS || [];
  return list.find((item) => item.provider !== "gemini" && String(env[item.apiKeyEnv] || "").trim() && (item.provider === "anthropic" || item.provider === "openai" || item.endpoint)) || null;
}

function codeForStatus(status) {
  if (status === 402) return AI_ERROR.BILLING;
  if (status === 429) return AI_ERROR.QUOTA;
  if (status === 408 || status === 504) return AI_ERROR.TIMEOUT;
  if (status >= 500) return AI_ERROR.UPSTREAM;
  if (status >= 400) return AI_ERROR.BAD_REQUEST;
  return AI_ERROR.UPSTREAM;
}

/** createFallbackCaller({ provider, registry, maxOutputTokens }) -> same call() shape as the Gemini caller, text parts only. */
function createFallbackCaller({ provider, registry = safeRegistry(), maxOutputTokens = 8192 } = {}) {
  if (!provider || !registry?.generate) return null;
  async function call({ parts = [], systemInstruction = "" }) {
    const started = Date.now();
    const userPrompt = parts.map((part) => part?.text || "").filter(Boolean).join("\n\n");
    let response;
    try {
      response = await registry.generate({ providerKey: provider.key, systemPrompt: systemInstruction, userPrompt, temperature: 0, maxOutputTokens, responseFormat: "json" });
    } catch (error) {
      const code = error?.code === "AI_PROVIDER_UNAVAILABLE" || error?.code === "AI_CREDENTIAL_MISSING" ? AI_ERROR.NOT_CONFIGURED : codeForStatus(Number(error?.status) || 0);
      throw new PetitionAiError(code, `backup AI (${provider.displayName || provider.key}): ${error?.message || "failed"}`, { model: provider.model, latencyMs: Date.now() - started, httpStatus: error?.status });
    }
    const data = response?.data;
    // The registry turns a non-JSON answer into { answer }: that is not a findings list.
    if (!data || !Array.isArray(data.findings)) throw new PetitionAiError(AI_ERROR.BAD_OUTPUT, "backup AI returned no findings list", { model: response?.model || provider.model, latencyMs: Date.now() - started, partialText: JSON.stringify(data || {}).slice(0, 2000) });
    return { text: JSON.stringify(data), finishReason: "STOP", tokens: Number(response?.usage?.totalTokens) || 0, latencyMs: Date.now() - started, model: response?.model || provider.model, attempts: 1 };
  }
  return { model: provider.model, provider: provider.key, textOnly: true, call };
}

function safeRegistry() {
  try {
    return require("../ai/ai-provider.registry");
  } catch (_error) {
    return null;
  }
}

module.exports = { pickFallbackProvider, createFallbackCaller };
