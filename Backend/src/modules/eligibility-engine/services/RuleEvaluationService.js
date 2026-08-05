class RuleEvaluationService {
  static evaluateRule(rule, evidence = {}) {
    const matched = [];
    const missing = [];
    const weak = [];
    const reasons = [];

    Object.entries(rule.evidenceWeights || {}).forEach(([evidenceKey, weight]) => {
      const item = evidence[evidenceKey];
      if (item?.available) {
        matched.push({ evidenceKey, weight, strength: item.strength, sources: item.sources });
        reasons.push(`${evidenceKey.replace(/_/g, " ")} evidence detected`);
        if (item.strength !== "strong") weak.push({ evidenceKey, reason: "Evidence exists but may need stronger documentation" });
      } else {
        missing.push({ evidenceKey, weight, reason: "No supporting evidence found in canonical case data" });
      }
    });

    const requiredMissing = (rule.requiredEvidence || []).filter((key) => !evidence[key]?.available);
    const categoryCount = matched.length;
    const thresholdMet = !rule.thresholdEvidenceCount || categoryCount >= rule.thresholdEvidenceCount;
    return {
      category: rule.category,
      label: rule.label,
      matched,
      missing,
      weak,
      requiredMissing,
      thresholdMet,
      advisoryEligible: requiredMissing.length === 0 && thresholdMet,
      reasons,
      dynamicQuestions: rule.dynamicQuestions || [],
    };
  }

  static evaluate(rules = [], evidence = {}) {
    return rules.map((rule) => this.evaluateRule(rule, evidence));
  }
}

module.exports = RuleEvaluationService;
