// A rough cost estimate BEFORE a petition is scanned (Petition AI Review, Phase 6), used by scripts/runPetitionAiScan.js in its dry run.
// Gemini reads each PDF page as about 258 image tokens plus the page's own text (a dense petition page is roughly 600-700 tokens), and every
// call also carries the instructions + case facts. Output per call is the JSON answer plus up to THINKING_BUDGET thinking tokens. The real
// numbers are recorded on the scan as it runs (usage.input / output / thinking); this estimate only says "about how much" up front.
const { THINKING_BUDGET } = require("./petitionGemini");
const { readPricing, costOf } = require("./pricing");

// Calibrated on the first live scan (2026-11-04, 96-page petition, gemini-3.8-flash): about 470 input tokens per page plus the instructions,
// about 110 output tokens per call and no thinking used. The figures below stay above that on purpose (an estimate should not under-shoot).
const TOKENS_PER_PAGE = 600;
const ANSWER_TOKENS_PER_CALL = 300;
const CHARS_PER_TOKEN = 4;

function estimateScan({ pages, pagesPerCall = 4, instructionChars = 0, pricing = readPricing() } = {}) {
  const pageCount = Math.max(0, Math.floor(Number(pages) || 0));
  const perCall = Math.max(1, Math.floor(Number(pagesPerCall) || 1));
  const calls = Math.ceil(pageCount / perCall);
  const input = pageCount * TOKENS_PER_PAGE + calls * Math.ceil((Number(instructionChars) || 0) / CHARS_PER_TOKEN + 150);
  const output = calls * ANSWER_TOKENS_PER_CALL;
  const thinking = calls * THINKING_BUDGET;
  const usage = { input, output, thinking };
  return { pages: pageCount, calls, usage, costUsd: costOf(usage, pricing), pricing };
}

module.exports = { estimateScan, TOKENS_PER_PAGE, ANSWER_TOKENS_PER_CALL };
