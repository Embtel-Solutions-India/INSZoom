#!/usr/bin/env node
// Petition AI Review - Phase 0: answers "why is Gemini not producing output?" without guessing.
//
//   node scripts/diagnoseGemini.js            offline: prints the configuration only (no network call, nothing spent)
//   node scripts/diagnoseGemini.js --live     ONE tiny text-only call (a few tokens) and prints what Gemini really answered:
//                                             HTTP status, finishReason, blockReason, token use, whether any text came back
//
// The API key is never printed (only whether one exists). Without --live this script cannot reach the network.
const path = require("path");

require(path.join(__dirname, "..", "src", "config", "env"));

const live = process.argv.includes("--live");
const keyName = ["PETITION_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_API_KEY"].find((name) => process.env[name]);
const model = process.env.PETITION_AI_MODEL || process.env.GEMINI_MODEL || "gemini-flash-latest";

function describeConfig() {
  return {
    keyPresent: Boolean(keyName),
    keySource: keyName || null, // the variable NAME only
    model,
    timeoutMs: Number(process.env.PETITION_AI_TIMEOUT_MS || process.env.GEMINI_TIMEOUT_MS || 90000),
    mode: live ? "live (one tiny call)" : "offline (no network call)",
  };
}

// Classifies a Gemini reply the way the Petition AI Review caller does, so the diagnosis and the real scan agree.
function classifyReply(httpStatus, payload) {
  // 402 = the Google AI Studio project has no prepaid credits left: every call is refused until billing is topped up (not temporary, never retried)
  if (httpStatus === 402) return { code: "BILLING", note: payload?.error?.message || "prepayment credits depleted - top up billing in Google AI Studio" };
  if (httpStatus === 429) return { code: "QUOTA", note: payload?.error?.message || "rate limit or quota exhausted" };
  if (httpStatus >= 400) return { code: `HTTP_${httpStatus}`, note: payload?.error?.message || "request failed" };
  const block = payload?.promptFeedback?.blockReason;
  if (block) return { code: "BLOCKED", note: `prompt blocked: ${block}` };
  const candidate = payload?.candidates?.[0];
  if (!candidate) return { code: "EMPTY_RESPONSE", note: "no candidate returned" };
  const text = (candidate.content?.parts || []).map((part) => part.text || "").join("");
  if (candidate.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason) && !text) return { code: "BLOCKED", note: `finishReason ${candidate.finishReason} with no text` };
  if (candidate.finishReason === "MAX_TOKENS") return { code: "TRUNCATED", note: "output cut off at the token limit" };
  if (!text) return { code: "EMPTY_RESPONSE", note: "candidate has no text" };
  return { code: "OK", note: "text returned" };
}

async function main() {
  const config = describeConfig();
  console.log("Gemini diagnosis");
  console.log(JSON.stringify(config, null, 2));
  if (!config.keyPresent) {
    console.log("Result: no API key is configured. Set GEMINI_API_KEY (or PETITION_AI_API_KEY) on the server.");
    return;
  }
  if (!live) {
    console.log("Offline run: nothing was sent. Re-run with --live to make ONE tiny call and see the real answer.");
    return;
  }
  const started = Date.now();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env[keyName]}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: 'Reply with exactly this JSON and nothing else: {"ok":true}' }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 64 },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  }).catch((error) => ({ networkError: error }));
  if (response.networkError) {
    console.log(`Result: network error after ${Date.now() - started} ms: ${response.networkError.message}`);
    return;
  }
  const payload = await response.json().catch(() => ({}));
  const verdict = classifyReply(response.status, payload);
  console.log(JSON.stringify({
    httpStatus: response.status,
    latencyMs: Date.now() - started,
    verdict,
    finishReason: payload?.candidates?.[0]?.finishReason || null,
    blockReason: payload?.promptFeedback?.blockReason || null,
    usage: payload?.usageMetadata || null,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.log(`Diagnosis failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { classifyReply, describeConfig };
