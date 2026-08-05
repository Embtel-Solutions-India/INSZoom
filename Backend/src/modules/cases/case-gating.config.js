// D2 (Phase 2 decision): hard-block only the transition into case-manager
// review and any filing stage when a case's required checklist(s) are
// incomplete; every earlier transition is soft-warn only. A single config
// object so the gated stage set / thresholds are trivial to change later —
// no logic changes needed to add/remove a gated stage.
//
// Stage keys are CASE_LIFECYCLE_STAGES keys (case.constants.js). "legal_review"
// is the case-manager-review stage (see CaseLifecycleOrchestrator.deriveOperationalState:
// caseManagerReviewComplete -> stage "legal_review"); "ready_for_filing" and
// "filed" are the filing stages.
//
// requireQuestionnaire/requireDocuments each reuse CaseLifecycleOrchestrator.metrics()'s
// existing questionnaireComplete/documentsComplete booleans — no new completeness math.
const GATED_STAGES = {
  legal_review: { requireQuestionnaire: true, requireDocuments: true },
  ready_for_filing: { requireQuestionnaire: true, requireDocuments: true },
  filed: { requireQuestionnaire: true, requireDocuments: true },
};

// Evaluates the policy for a target stage against already-computed metrics
// (CaseLifecycleOrchestrator.metrics(caseData)). Returns:
//   { blocked: false, warning: null }                 - not gated, checklists complete
//   { blocked: false, warning: "..." }                 - not gated, checklists incomplete (soft-warn)
//   { blocked: true, reason: "..." }                   - gated stage, checklists incomplete (hard-block)
function evaluateStageGate(targetStage, metrics) {
  const incompleteReasons = [];
  if (!metrics.questionnaireComplete) incompleteReasons.push("questionnaire");
  if (!metrics.documentsComplete) incompleteReasons.push("required documents");
  const isIncomplete = incompleteReasons.length > 0;
  const gate = GATED_STAGES[targetStage];

  if (!isIncomplete) return { blocked: false, warning: null };
  if (gate) {
    return {
      blocked: true,
      reason: `Cannot move to "${targetStage}" — required checklist(s) incomplete: ${incompleteReasons.join(", ")}.`,
    };
  }
  return {
    blocked: false,
    warning: `Moving to "${targetStage}" with incomplete required checklist(s): ${incompleteReasons.join(", ")}.`,
  };
}

module.exports = { GATED_STAGES, evaluateStageGate };
