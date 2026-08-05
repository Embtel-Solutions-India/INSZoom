class ScoringService {
  static score(rule, evaluation) {
    const totalWeight = Object.values(rule.evidenceWeights || {}).reduce((sum, weight) => sum + Number(weight || 0), 0) || 1;
    const earned = evaluation.matched.reduce((sum, item) => {
      const strengthMultiplier = item.strength === "strong" ? 1 : 0.7;
      return sum + Number(item.weight || 0) * strengthMultiplier;
    }, 0);
    const requiredPenalty = evaluation.requiredMissing.length * 12;
    const thresholdPenalty = evaluation.thresholdMet ? 0 : 15;
    const score = Math.max(0, Math.min(100, Math.round((earned / totalWeight) * 100 - requiredPenalty - thresholdPenalty)));
    const dataCompleteness = Math.round((evaluation.matched.length / Math.max(Object.keys(rule.evidenceWeights || {}).length, 1)) * 100);
    return {
      score,
      confidence: Math.round((score * 0.65) + (dataCompleteness * 0.35)),
      dataCompleteness,
      missingEvidenceRisk: evaluation.missing.length > 3 ? "high" : evaluation.missing.length > 1 ? "medium" : "low",
      weakDocumentationRisk: evaluation.weak.length > 2 ? "high" : evaluation.weak.length ? "medium" : "low",
      attorneyReviewRequired: true,
    };
  }
}

module.exports = ScoringService;
