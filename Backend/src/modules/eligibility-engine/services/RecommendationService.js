const { DISCLAIMER } = require("../config/eligibilityRules");

class RecommendationService {
  static rank(items = []) {
    return [...items].sort((left, right) => {
      if (right.score.score !== left.score.score) return right.score.score - left.score.score;
      return right.score.dataCompleteness - left.score.dataCompleteness;
    });
  }

  static generate(results = []) {
    return this.rank(results).map((item, index) => ({
      rank: index + 1,
      category: item.category,
      label: item.label,
      eligibilityScore: item.score.score,
      confidence: item.score.confidence,
      caseReadiness: item.score.dataCompleteness,
      attorneyReviewRequired: true,
      advisoryOnly: true,
      disclaimer: DISCLAIMER,
      why: item.evaluation.reasons.slice(0, 6),
      riskIndicators: {
        missingEvidenceRisk: item.score.missingEvidenceRisk,
        weakDocumentationRisk: item.score.weakDocumentationRisk,
      },
      missingEvidence: item.gaps.missingEvidence,
    }));
  }
}

module.exports = RecommendationService;
