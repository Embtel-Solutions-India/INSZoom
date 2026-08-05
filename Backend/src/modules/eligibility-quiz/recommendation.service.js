const copyLintService = require("../compliance/copyLint.service");
const { DEFAULT_ALTERNATIVE_PATHWAYS } = require("./quiz.config");

const NEXT_STEP_BY_ROUTING = {
  direct_priority: "Book a consultation now — your evidence supports filing today.",
  direct: "Book a consultation to review your evidence and filing timeline.",
  strategy_queue: "Schedule a strategy call — our team will map out a 6–12 month evidence plan.",
  nurture: "Explore alternative pathways below and schedule a strategy call when you're ready.",
};

// Tier D (and any tier, defensively) always carries a non-empty list of
// alternative pathways — the PRD's hard rule that a quiz result never reads
// as an outright rejection. Config may override via
// scoringConfig.alternativePathways; otherwise falls back to the standard
// EB-2 NIW / L-1A / E-2 set.
function resolveAlternativePathways(scoreResult, scoringConfig) {
  const configured = scoringConfig?.alternativePathways;
  if (Array.isArray(configured) && configured.length) return configured;
  return DEFAULT_ALTERNATIVE_PATHWAYS;
}

// Builds the client-facing recommendation. Runs the assembled copy through
// Phase 0's copy-lint as defense-in-depth (the primary enforcement point is
// the admin config write in quizAdmin.service — a prohibited pathwayString
// should never reach here at all) — a hit is reported via `lintResult`
// rather than thrown, so a bad admin-authored string can never break the
// public quiz submit flow itself.
async function build(scoreResult, scoringConfig) {
  const { tier, pathwayString, routing } = scoreResult;
  const alternativePathways = resolveAlternativePathways(scoreResult, scoringConfig);
  const nextStep = NEXT_STEP_BY_ROUTING[routing] || NEXT_STEP_BY_ROUTING.nurture;

  const combinedText = [pathwayString, nextStep, ...alternativePathways].join(" \n");
  const lintResult = await copyLintService.scan(combinedText);

  return {
    tier,
    pathwayString,
    alternativePathways,
    nextStep,
    routing,
    lintResult,
  };
}

module.exports = { build, resolveAlternativePathways, NEXT_STEP_BY_ROUTING };
