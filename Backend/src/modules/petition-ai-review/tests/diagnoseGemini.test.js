// Phase 0 (DB-free): the diagnostic script classifies Gemini replies correctly and refuses to touch the network without --live.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { classifyReply } = require("../../../../scripts/diagnoseGemini");

const text = (value, finishReason = "STOP") => ({ candidates: [{ finishReason, content: { parts: [{ text: value }] } }], usageMetadata: { totalTokenCount: 5 } });

test("a normal answer is OK", () => assert.equal(classifyReply(200, text('{"ok":true}')).code, "OK"));
test("no candidate at all is EMPTY_RESPONSE", () => assert.equal(classifyReply(200, { candidates: [] }).code, "EMPTY_RESPONSE"));
test("a candidate without text is EMPTY_RESPONSE", () => assert.equal(classifyReply(200, text("")).code, "EMPTY_RESPONSE"));
test("a blocked prompt is BLOCKED and names the reason", () => {
  const verdict = classifyReply(200, { promptFeedback: { blockReason: "SAFETY" } });
  assert.equal(verdict.code, "BLOCKED");
  assert.match(verdict.note, /SAFETY/);
});
test("a safety finish with no text is BLOCKED", () => assert.equal(classifyReply(200, text("", "SAFETY")).code, "BLOCKED"));
test("MAX_TOKENS with partial text is TRUNCATED", () => assert.equal(classifyReply(200, text('{"findings":[{"page":', "MAX_TOKENS")).code, "TRUNCATED"));
test("HTTP 402 (prepaid credits depleted - the live result on 2026-11-03) is BILLING", () => {
  const verdict = classifyReply(402, { error: { message: "Your prepayment credits are depleted." } });
  assert.equal(verdict.code, "BILLING");
  assert.match(verdict.note, /credits are depleted/);
});
test("HTTP 429 is QUOTA, other errors keep their status", () => {
  assert.equal(classifyReply(429, { error: { message: "You exceeded your current quota" } }).code, "QUOTA");
  assert.equal(classifyReply(503, { error: { message: "overloaded" } }).code, "HTTP_503");
});

test("without --live the script makes no network call and never prints the key", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "..", "..", "..", "scripts", "diagnoseGemini.js")], {
    encoding: "utf8",
    env: { ...process.env, GEMINI_API_KEY: "SECRET-KEY-VALUE-123", PETITION_AI_API_KEY: "" },
    timeout: 20000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /offline/i);
  assert.match(result.stdout, /Re-run with --live/);
  assert.ok(!result.stdout.includes("SECRET-KEY-VALUE-123"));
  assert.ok(!result.stderr.includes("SECRET-KEY-VALUE-123"));
});
