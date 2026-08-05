const AuditLog = require("../../../models/AuditLog");
const Case = require("../../../models/Case");
const CanonicalDataService = require("../../form-mapping/services/CanonicalDataService");
const { DISCLAIMER, eligibilityRules } = require("../config/eligibilityRules");
const EvidenceAssessmentService = require("./EvidenceAssessmentService");
const GapAnalysisService = require("./GapAnalysisService");
const RecommendationService = require("./RecommendationService");
const RuleEvaluationService = require("./RuleEvaluationService");
const ScoringService = require("./ScoringService");

class EligibilityEngineService {
  static userId(user) {
    return user?._id || user?.id || user;
  }

  static async audit(action, caseId, user, req, changes = {}) {
    await AuditLog.create({
      userId: this.userId(user),
      userRole: user?.role,
      action,
      entityType: "Case",
      entityId: String(caseId),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} eligibility advisory analysis`,
    }).catch(() => null);
  }

  static buildEvaluation(canonicalData, selectedCategories) {
    const rules = selectedCategories?.length ? eligibilityRules.filter((rule) => selectedCategories.includes(rule.category)) : eligibilityRules;
    const evidence = EvidenceAssessmentService.assess(canonicalData);
    const evaluatedRules = RuleEvaluationService.evaluate(rules, evidence);
    const results = evaluatedRules.map((evaluation) => {
      const rule = rules.find((item) => item.category === evaluation.category);
      const score = ScoringService.score(rule, evaluation);
      const gaps = GapAnalysisService.analyze(rule, evaluation);
      return {
        category: rule.category,
        label: rule.label,
        description: rule.description,
        evaluation,
        score,
        gaps,
      };
    });
    return {
      disclaimer: DISCLAIMER,
      advisoryOnly: true,
      attorneyReviewRequired: true,
      evaluatedAt: new Date(),
      evidence,
      results,
      recommendations: RecommendationService.generate(results),
    };
  }

  static async evaluate(caseId, user, req, options = {}) {
    const canonicalData = await CanonicalDataService.build(caseId);
    const evaluation = this.buildEvaluation(canonicalData, options.categories);
    const caseRecord = await Case.findById(caseId);
    if (!caseRecord) {
      const error = new Error("Case not found");
      error.status = 404;
      throw error;
    }
    caseRecord.eligibility = {
      ...(caseRecord.eligibility || {}),
      latestEvaluation: evaluation,
      recommendationHistory: [
        ...((caseRecord.eligibility && caseRecord.eligibility.recommendationHistory) || []),
        { evaluatedAt: evaluation.evaluatedAt, recommendations: evaluation.recommendations, evaluatedBy: this.userId(user) },
      ].slice(-25),
      lastEvaluatedAt: evaluation.evaluatedAt,
      lastEvaluatedBy: this.userId(user),
    };
    caseRecord.assessmentMatchPercentage = evaluation.recommendations[0]?.eligibilityScore || 0;
    await caseRecord.save();
    await this.audit("ELIGIBILITY_EVALUATED", caseId, user, req, { topRecommendation: evaluation.recommendations[0]?.category, categories: evaluation.results.map((item) => item.category) });
    return evaluation;
  }

  static async latest(caseId) {
    const caseRecord = await Case.findById(caseId).select("eligibility assessmentMatchPercentage");
    return caseRecord?.eligibility?.latestEvaluation || null;
  }

  static async gaps(caseId) {
    const latest = await this.latest(caseId);
    return latest ? latest.results.map((item) => item.gaps) : [];
  }

  static async recommendations(caseId) {
    const latest = await this.latest(caseId);
    return latest?.recommendations || [];
  }

  static async override(caseId, payload, user, req) {
    const caseRecord = await Case.findById(caseId);
    if (!caseRecord) throw Object.assign(new Error("Case not found"), { status: 404 });
    caseRecord.eligibility = {
      ...(caseRecord.eligibility || {}),
      attorneyOverrides: [
        ...((caseRecord.eligibility && caseRecord.eligibility.attorneyOverrides) || []),
        { ...payload, overriddenBy: this.userId(user), overriddenAt: new Date() },
      ],
    };
    await caseRecord.save();
    await this.audit("ELIGIBILITY_ATTORNEY_OVERRIDE", caseId, user, req, payload);
    return caseRecord.eligibility;
  }
}

module.exports = EligibilityEngineService;
