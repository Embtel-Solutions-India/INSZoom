class GapAnalysisService {
  static analyze(rule, evaluation) {
    return {
      category: rule.category,
      missingEvidence: evaluation.missing.map((item) => ({
        evidenceKey: item.evidenceKey,
        priority: (rule.requiredEvidence || []).includes(item.evidenceKey) ? "critical" : item.weight >= 15 ? "high" : "medium",
        reason: item.reason,
      })),
      weakEvidence: evaluation.weak.map((item) => ({
        evidenceKey: item.evidenceKey,
        priority: "medium",
        reason: item.reason,
      })),
      recommendedQuestions: evaluation.dynamicQuestions,
      suggestedDocumentRequests: evaluation.missing.map((item) => item.evidenceKey.replace(/_/g, " ")),
    };
  }
}

module.exports = GapAnalysisService;
