const AIProviderConfig = require("../../models/AIProviderConfig");
const geminiService = require("../document-intelligence/services/gemini.service");

const DEFAULTS = [
  { key: "gemini", provider: "gemini", displayName: "Google Gemini", model: process.env.GEMINI_MODEL || "gemini-flash-latest", apiKeyEnv: "GEMINI_API_KEY", capabilities: { vision: true, structuredOutput: true, streaming: false } },
  { key: "openai", provider: "openai", displayName: "OpenAI", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", apiKeyEnv: "OPENAI_API_KEY", endpoint: "https://api.openai.com/v1", capabilities: { structuredOutput: true, streaming: true, embeddings: true } },
  { key: "anthropic", provider: "anthropic", displayName: "Anthropic", model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest", apiKeyEnv: "ANTHROPIC_API_KEY", endpoint: "https://api.anthropic.com", capabilities: { structuredOutput: true, streaming: true } },
  { key: "azure_openai", provider: "azure_openai", displayName: "Azure OpenAI", model: process.env.AZURE_OPENAI_DEPLOYMENT || "default", apiKeyEnv: "AZURE_OPENAI_API_KEY", endpoint: process.env.AZURE_OPENAI_ENDPOINT || "", apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-10-21", capabilities: { structuredOutput: true, streaming: true } },
  { key: "self_hosted", provider: "self_hosted", displayName: "Private Model", model: process.env.SELF_HOSTED_AI_MODEL || "default", apiKeyEnv: "SELF_HOSTED_AI_API_KEY", endpoint: process.env.SELF_HOSTED_AI_ENDPOINT || "", capabilities: { structuredOutput: true, streaming: true }, privacy: { providerRetention: "private_deployment" } },
];

function secret(config) {
  if (config.provider === "gemini") return process.env[config.apiKeyEnv] || process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return process.env[config.apiKeyEnv];
}

function defaultSecret(definition) {
  if (definition.provider === "gemini") return process.env[definition.apiKeyEnv] || process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return process.env[definition.apiKeyEnv];
}

function parseJson(value) {
  if (typeof value === "object" && value !== null) return value;
  const text = String(value || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end >= start) return JSON.parse(candidate.slice(start, end + 1));
  return { answer: candidate };
}

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 60000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || `AI provider request failed with status ${response.status}`);
      error.status = response.status;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureDefaults(user) {
  const existing = await AIProviderConfig.find({ key: { $in: DEFAULTS.map((item) => item.key) } }).select("key");
  const keys = new Set(existing.map((item) => item.key));
  const availableDefaultKey = DEFAULTS.find((item) => defaultSecret(item) && (item.provider === "gemini" || item.endpoint))?.key;
  const candidates = DEFAULTS.filter((item) => !keys.has(item.key)).map((item) => ({
    ...item,
    enabled: Boolean(defaultSecret(item) && (item.provider === "gemini" || item.endpoint)),
    isDefault: item.key === availableDefaultKey,
    createdBy: user?._id,
    updatedBy: user?._id,
  }));
  if (candidates.length) await AIProviderConfig.insertMany(candidates, { ordered: false }).catch(() => null);
}

async function resolve(providerKey, user) {
  await ensureDefaults(user);
  const query = providerKey ? { key: providerKey, enabled: true } : { enabled: true };
  const config = await AIProviderConfig.findOne(query).sort({ isDefault: -1, updatedAt: -1 }).lean();
  if (!config) throw Object.assign(new Error("No enabled AI provider is configured"), { status: 503, code: "AI_PROVIDER_UNAVAILABLE" });
  if (!secret(config)) throw Object.assign(new Error(`AI provider credential ${config.apiKeyEnv} is not configured`), { status: 503, code: "AI_CREDENTIAL_MISSING" });
  return config;
}

function cost(config, usage = {}) {
  const input = Number(usage.inputTokens || 0);
  const output = Number(usage.outputTokens || 0);
  return ((input / 1_000_000) * Number(config.pricing?.inputPerMillionTokens || 0))
    + ((output / 1_000_000) * Number(config.pricing?.outputPerMillionTokens || 0));
}

async function gemini(config, request) {
  const data = await geminiService.generateStructuredJson({
    prompt: `${request.systemPrompt}\n\n${request.userPrompt}`,
    model: config.model,
  });
  return { data, usage: {} };
}

async function openAiCompatible(config, request) {
  const base = String(config.endpoint || "").replace(/\/$/, "");
  if (!base) throw Object.assign(new Error(`Endpoint is required for ${config.provider}`), { status: 503 });
  const isAzure = config.provider === "azure_openai";
  const url = isAzure
    ? `${base}/openai/deployments/${encodeURIComponent(config.model)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion || "2024-10-21")}`
    : `${base}/chat/completions`;
  const payload = await requestJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(isAzure ? { "api-key": secret(config) } : { Authorization: `Bearer ${secret(config)}` }),
    },
    body: JSON.stringify({
      model: isAzure ? undefined : config.model,
      messages: [{ role: "system", content: request.systemPrompt }, { role: "user", content: request.userPrompt }],
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxOutputTokens || config.limits?.maxOutputTokens || 4096,
      response_format: request.responseFormat === "text" ? undefined : { type: "json_object" },
    }),
  }, config.limits?.timeoutMs);
  const content = payload.choices?.[0]?.message?.content || "";
  return {
    data: request.responseFormat === "text" ? { answer: content } : parseJson(content),
    usage: {
      inputTokens: payload.usage?.prompt_tokens || 0,
      outputTokens: payload.usage?.completion_tokens || 0,
      totalTokens: payload.usage?.total_tokens || 0,
    },
  };
}

async function anthropic(config, request) {
  const base = String(config.endpoint || "https://api.anthropic.com").replace(/\/$/, "");
  const payload = await requestJson(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": secret(config),
      "anthropic-version": config.apiVersion || "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxOutputTokens || config.limits?.maxOutputTokens || 4096,
    }),
  }, config.limits?.timeoutMs);
  const content = payload.content?.map((item) => item.text || "").join("") || "";
  return {
    data: request.responseFormat === "text" ? { answer: content } : parseJson(content),
    usage: {
      inputTokens: payload.usage?.input_tokens || 0,
      outputTokens: payload.usage?.output_tokens || 0,
      totalTokens: Number(payload.usage?.input_tokens || 0) + Number(payload.usage?.output_tokens || 0),
    },
  };
}

async function generate(request, user) {
  const config = await resolve(request.providerKey, user);
  const startedAt = Date.now();
  let response;
  if (config.provider === "gemini") response = await gemini(config, request);
  else if (config.provider === "anthropic") response = await anthropic(config, request);
  else response = await openAiCompatible(config, request);
  response.usage = {
    ...response.usage,
    estimatedCost: cost(config, response.usage),
    currency: config.pricing?.currency || "USD",
    latencyMs: Date.now() - startedAt,
  };
  return { ...response, providerKey: config.key, provider: config.provider, model: config.model, config };
}

module.exports = { DEFAULTS, ensureDefaults, generate, resolve };
