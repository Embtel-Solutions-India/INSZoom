// PURE tier/scoring engine — no DB, no IO, deterministic. Callers (quiz.service,
// the admin config preview, and every test) pass in the already-resolved
// scoringConfig; this file never fetches one itself, so it can be unit
// tested (and reasoned about) with zero setup.

function validationError(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function normalizeAnswerValue(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return 0; // unanswered = 0
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw validationError(`Invalid criteria answer value "${rawValue}" — must be an integer 0–3`);
  }
  return value;
}

function matchTier(criteriaMetCount, tierRules = []) {
  return tierRules.find((rule) => {
    if (criteriaMetCount < rule.minCriteriaMet) return false;
    if (rule.maxCriteriaMet === null || rule.maxCriteriaMet === undefined) return true;
    return criteriaMetCount <= rule.maxCriteriaMet;
  });
}

// criteriaAnswers: [{ key, value }] — raw quiz answers, 0–3 (or missing = unanswered).
// scoringConfig: { filingStrengthThreshold, developableThreshold, tierRules, criterionWeights? }
// scaleLabelsByKey (optional): { [key]: string[] } — from the QuizDefinition, used to label
// evidenceStrength for display; falls back to a generic label if not supplied.
function score(criteriaAnswers = [], scoringConfig, { scaleLabelsByKey = {}, scoringConfigVersion, quizDefinitionVersion } = {}) {
  if (!scoringConfig || !Array.isArray(scoringConfig.tierRules) || !scoringConfig.tierRules.length) {
    throw validationError("A scoring config with at least one tier rule is required");
  }
  const filingStrengthThreshold = Number.isFinite(scoringConfig.filingStrengthThreshold) ? scoringConfig.filingStrengthThreshold : 2;
  const developableThreshold = Number.isFinite(scoringConfig.developableThreshold) ? scoringConfig.developableThreshold : 1;

  let criteriaMetCount = 0;
  let criteriaDevelopableCount = 0;
  const evidenceStrength = criteriaAnswers.map(({ key, value: rawValue }) => {
    const value = normalizeAnswerValue(rawValue);
    const met = value >= filingStrengthThreshold;
    const developable = value === developableThreshold;
    if (met) criteriaMetCount += 1;
    if (developable) criteriaDevelopableCount += 1;
    const labels = scaleLabelsByKey[key] || ["None", "Developing", "Solid", "Strong"];
    return { key, value, met, developable, label: labels[value] || String(value) };
  });

  const matchedRule = matchTier(criteriaMetCount, scoringConfig.tierRules);
  if (!matchedRule) {
    throw validationError(`No tier rule matched criteriaMetCount=${criteriaMetCount} — check tierRules coverage`);
  }

  return {
    criteriaMetCount,
    criteriaDevelopableCount,
    tier: matchedRule.tier,
    pathwayString: matchedRule.pathwayString,
    routing: matchedRule.routing,
    evidenceStrength,
    scoringConfigVersion: scoringConfigVersion ?? scoringConfig.version,
    quizDefinitionVersion,
  };
}

module.exports = { score, normalizeAnswerValue, matchTier };
