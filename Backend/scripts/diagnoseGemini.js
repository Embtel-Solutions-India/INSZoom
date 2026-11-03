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

// Same rules as the real scan (src/modules/petition-ai-review/replyClassifier.js), so the diagnosis and the scan agree.
const { classifyReply } = require(path.join(__dirname, "..", "src", "modules", "petition-ai-review", "replyClassifier"));

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
