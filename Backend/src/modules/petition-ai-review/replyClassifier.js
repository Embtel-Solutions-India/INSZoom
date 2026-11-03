// Classifies a raw Gemini reply (HTTP status + JSON body). Pure, no I/O. Shared by scripts/diagnoseGemini.js and the petition's own caller
// (petitionGemini.js), so the diagnosis and the real scan always agree on what went wrong.
const { AI_ERROR } = require("./constants");

/** Verdict for one reply: { code: OK | BILLING | QUOTA | HTTP_xxx | BLOCKED | EMPTY_RESPONSE | TRUNCATED, note } */
function classifyReply(httpStatus, payload) {
  // 402 = the Google AI Studio project has no prepaid credits left: every call is refused until billing is topped up (not temporary, never retried)
  if (httpStatus === 402) return { code: "BILLING", note: payload?.error?.message || "prepayment credits depleted - top up billing in Google AI Studio" };
  if (httpStatus === 429) return { code: "QUOTA", note: payload?.error?.message || "rate limit or quota exhausted" };
  if (httpStatus >= 400) return { code: `HTTP_${httpStatus}`, note: payload?.error?.message || "request failed" };
  const block = payload?.promptFeedback?.blockReason;
  if (block) return { code: "BLOCKED", note: `prompt blocked: ${block}` };
  const candidate = payload?.candidates?.[0];
  if (!candidate) return { code: "EMPTY_RESPONSE", note: "no candidate returned" };
  const text = replyText(payload);
  if (candidate.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason) && !text) return { code: "BLOCKED", note: `finishReason ${candidate.finishReason} with no text` };
  if (candidate.finishReason === "MAX_TOKENS") return { code: "TRUNCATED", note: "output cut off at the token limit" };
  if (!text) return { code: "EMPTY_RESPONSE", note: "candidate has no text" };
  return { code: "OK", note: "text returned" };
}

/** The answer text of the first candidate (thought parts left out). */
function replyText(payload) {
  return (payload?.candidates?.[0]?.content?.parts || []).filter((part) => !part.thought).map((part) => part.text || "").join("");
}

/** Maps a verdict to the scan's AI_ERROR vocabulary (null when the reply is usable). */
function toAiError(verdict, httpStatus) {
  if (verdict.code === "OK") return null;
  if (AI_ERROR[verdict.code]) return verdict.code;
  if (httpStatus === 408 || httpStatus === 504) return AI_ERROR.TIMEOUT;
  if (httpStatus >= 500) return AI_ERROR.UPSTREAM;
  return AI_ERROR.BAD_REQUEST; // 400 / 401 / 403 / 404: bad key, unknown model, rejected request
}

module.exports = { classifyReply, replyText, toAiError };
