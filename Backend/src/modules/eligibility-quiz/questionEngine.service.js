const QuizDefinition = require("../../models/QuizDefinition");
const ScoringConfig = require("../../models/ScoringConfig");
const {
  DEFAULT_VISA_PATHWAY,
  VISA_PATHWAYS,
  DEFAULT_PROFILE_QUESTIONS,
  DEFAULT_CRITERIA_QUESTIONS,
  DEFAULT_TIER_RULES,
  DEFAULT_ALTERNATIVE_PATHWAYS,
  DEFAULT_SCORING_CONFIG,
  VISA_QUIZ_CONTENT,
} = require("./quiz.config");

// Each visaPathway gets its own criteriaQuestions/tierRules/alternativePathways
// from VISA_QUIZ_CONTENT (see quiz.config.js) — falling back to the original
// generic extraordinary-ability set only for a visaPathway key that isn't in
// the catalog at all (shouldn't happen via the public quiz, which only ever
// sends keys listed in VISA_PATHWAYS).
function fallbackDefinition(visaPathway) {
  const content = VISA_QUIZ_CONTENT[visaPathway];
  return {
    visaPathway,
    version: 0, // 0 signals "code fallback, not a real DB version" to callers/tests
    isActive: true,
    profileQuestions: DEFAULT_PROFILE_QUESTIONS,
    criteriaQuestions: content?.criteriaQuestions || DEFAULT_CRITERIA_QUESTIONS,
  };
}

function fallbackScoringConfig(visaPathway) {
  const content = VISA_QUIZ_CONTENT[visaPathway];
  return {
    ...DEFAULT_SCORING_CONFIG,
    visaPathway,
    version: 0,
    tierRules: content?.tierRules || DEFAULT_TIER_RULES,
    alternativePathways: content?.alternativePathways || DEFAULT_ALTERNATIVE_PATHWAYS,
  };
}

// DB preferred, quiz.config.js fallback — the public quiz must never be in
// a state with no questions, even on a brand-new database with no seed run.
async function resolveDefinition(visaPathway = DEFAULT_VISA_PATHWAY) {
  const active = await QuizDefinition.findOne({ visaPathway, isActive: true }).sort({ version: -1 }).lean();
  return active || fallbackDefinition(visaPathway);
}

async function resolveScoringConfig(visaPathway = DEFAULT_VISA_PATHWAY) {
  const active = await ScoringConfig.findOne({ visaPathway, isActive: true }).sort({ version: -1 }).lean();
  return active || fallbackScoringConfig(visaPathway);
}

function listVisaPathways() {
  return VISA_PATHWAYS;
}

function scaleLabelsByKey(definition) {
  const map = {};
  (definition.criteriaQuestions || []).forEach((q) => { map[q.key] = q.scaleLabels; });
  return map;
}

module.exports = { resolveDefinition, resolveScoringConfig, listVisaPathways, scaleLabelsByKey, fallbackDefinition, fallbackScoringConfig };
