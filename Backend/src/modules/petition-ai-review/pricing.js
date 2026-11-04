// What a petition scan costs in US dollars (Petition AI Review, Phase 6). Gemini bills input tokens (the prompt and the PDF pages) at one
// rate and output tokens at another; thinking tokens are billed as output. Prices come from the environment so a price change needs no
// code change; the defaults are Google's published standard-tier rates for gemini-3.8-flash (checked 2026-11-04; the introductory rate is
// announced to double on 2027-01-01 - set the variables then).
//
//   PETITION_AI_PRICE_INPUT_PER_M    USD per 1 million input tokens  (default 0.75)
//   PETITION_AI_PRICE_OUTPUT_PER_M   USD per 1 million output + thinking tokens (default 3.75)
const DEFAULT_PRICING = Object.freeze({ inputPerMillion: 0.75, outputPerMillion: 3.75, source: "default (gemini-3.8-flash, checked 2026-11-04)" });

function price(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 1000 ? parsed : fallback;
}

function readPricing(env = process.env) {
  const custom = env.PETITION_AI_PRICE_INPUT_PER_M !== undefined || env.PETITION_AI_PRICE_OUTPUT_PER_M !== undefined;
  return Object.freeze({
    inputPerMillion: price(env.PETITION_AI_PRICE_INPUT_PER_M, DEFAULT_PRICING.inputPerMillion),
    outputPerMillion: price(env.PETITION_AI_PRICE_OUTPUT_PER_M, DEFAULT_PRICING.outputPerMillion),
    source: custom ? "environment" : DEFAULT_PRICING.source,
  });
}

const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

/** Estimated USD for { input, output, thinking } tokens, rounded to 1/10,000 of a cent. Never throws; bad numbers count as 0. */
function costOf(usage = {}, pricing = readPricing()) {
  const input = count(usage?.input);
  const billedOutput = count(usage?.output) + count(usage?.thinking);
  const usd = (input * pricing.inputPerMillion + billedOutput * pricing.outputPerMillion) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

module.exports = { readPricing, costOf, DEFAULT_PRICING };
