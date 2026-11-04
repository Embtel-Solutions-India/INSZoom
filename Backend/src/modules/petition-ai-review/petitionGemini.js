// The petition scan's own Gemini caller (Petition AI Review). Independent of document-intelligence/gemini.service.js, which is not touched.
// What it fixes compared with that shared caller (see docs/PETITION_AI_REVIEW_PLAN.md, "root causes"):
//   - an output budget (maxOutputTokens), a small thinking budget and a response schema, so the JSON is not cut off by thinking tokens
//   - every reply's finishReason / blockReason / token use is read and mapped to a precise code (EMPTY_RESPONSE, BLOCKED, TRUNCATED ...)
//   - 402 billing and 429 quota are never hammered: they end the call at once
//   - 5xx / network / timeout: bounded backoff retries
//   - if Google rejects the request settings themselves (HTTP 400, e.g. a model that does not accept the thinking or schema setting),
//     the same call is re-sent once without them, and the caller keeps using the plain settings from then on
// The key travels in a header (never in the URL), so it cannot appear in an error message or a log line.
const { AI_ERROR } = require("./constants");
const { classifyReply, replyText, toAiError } = require("./replyClassifier");

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRYABLE = new Set([AI_ERROR.UPSTREAM, AI_ERROR.TIMEOUT]);
const THINKING_BUDGET = 1024;

class PetitionAiError extends Error {
  constructor(code, note, details = {}) {
    super(note || code);
    this.name = "PetitionAiError";
    this.code = code;
    this.note = note || code;
    Object.assign(this, details); // httpStatus, finishReason, usage, latencyMs, partialText, model
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Token use of one reply, split the way Google prices it: input (prompt, including the PDF pages), output (the answer) and thinking
// (billed as output). Missing numbers count as 0.
function usageOf(payload) {
  const meta = payload?.usageMetadata || {};
  return { input: Number(meta.promptTokenCount) || 0, output: Number(meta.candidatesTokenCount) || 0, thinking: Number(meta.thoughtsTokenCount) || 0 };
}
const addUsage = (a = {}, b = {}) => ({ input: (a.input || 0) + (b.input || 0), output: (a.output || 0) + (b.output || 0), thinking: (a.thinking || 0) + (b.thinking || 0) });

function generationConfig(config, { responseSchema, lean }) {
  const settings = { temperature: 0, responseMimeType: "application/json", maxOutputTokens: config.maxOutputTokens };
  if (!lean) {
    settings.thinkingConfig = { thinkingBudget: THINKING_BUDGET };
    if (responseSchema) settings.responseSchema = responseSchema;
  }
  return settings;
}

/**
 * createGeminiCaller({ config, apiKey, fetchImpl, sleep, retries, backoffMs }) -> { model, call({ parts, systemInstruction, responseSchema }) }
 * call() resolves { text, finishReason, tokens, latencyMs, model, attempts } or rejects with a PetitionAiError (code = AI_ERROR.*).
 */
function createGeminiCaller({ config, apiKey, fetchImpl = globalThis.fetch, sleep = defaultSleep, retries = 2, backoffMs = 2000 } = {}) {
  const model = config.model;
  let lean = false; // switched on for good after Google rejected the full settings once

  async function once({ parts, systemInstruction, responseSchema }) {
    const started = Date.now();
    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: generationConfig(config, { responseSchema, lean }),
    };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    let response;
    try {
      response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new PetitionAiError(timedOut ? AI_ERROR.TIMEOUT : AI_ERROR.UPSTREAM, timedOut ? `no answer within ${Math.round(config.timeoutMs / 1000)} s` : `network error: ${error?.message || error}`, { latencyMs: Date.now() - started, model });
    }
    const payload = await response.json().catch(() => ({}));
    const latencyMs = Date.now() - started;
    const verdict = classifyReply(response.status, payload);
    const details = {
      httpStatus: response.status,
      finishReason: payload?.candidates?.[0]?.finishReason || null,
      tokens: Number(payload?.usageMetadata?.totalTokenCount) || 0,
      usage: usageOf(payload),
      modelVersion: payload?.modelVersion || null, // the exact model Google used behind the alias (e.g. gemini-flash-latest)
      latencyMs,
      model,
    };
    const code = toAiError(verdict, response.status);
    if (code) throw new PetitionAiError(code, verdict.note, { ...details, partialText: replyText(payload) });
    return { text: replyText(payload), ...details };
  }

  async function call(request) {
    if (!apiKey) throw new PetitionAiError(AI_ERROR.NOT_CONFIGURED, "no AI key is configured on the server", { model });
    let attempts = 0;
    let usedTokens = 0;
    let usedUsage = { input: 0, output: 0, thinking: 0 }; // refused / failed attempts can still bill tokens: they are counted too
    for (;;) {
      attempts += 1;
      try {
        const result = await once(request);
        return { ...result, tokens: result.tokens + usedTokens, usage: addUsage(result.usage, usedUsage), attempts };
      } catch (error) {
        if (!(error instanceof PetitionAiError)) throw error;
        usedTokens += error.tokens || 0;
        usedUsage = addUsage(usedUsage, error.usage);
        error.tokens = usedTokens;
        error.usage = usedUsage;
        error.attempts = attempts;
        // Settings rejected: plain settings once, then keep them (a bad key is also a 400, so this costs at most one extra refused call).
        if (error.code === AI_ERROR.BAD_REQUEST && error.httpStatus === 400 && !lean) {
          lean = true;
          continue;
        }
        if (RETRYABLE.has(error.code) && attempts <= retries) {
          await sleep(backoffMs * 2 ** (attempts - 1));
          continue;
        }
        throw error;
      }
    }
  }

  return { model, call, get lean() { return lean; } };
}

module.exports = { createGeminiCaller, PetitionAiError, THINKING_BUDGET, usageOf, addUsage };
