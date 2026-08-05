const assert = require("node:assert/strict");
const test = require("node:test");
const Case = require("../../../models/Case");
const CaseLifecycleOrchestrator = require("../case-lifecycle-orchestrator.service");
const { templateAppliesToCase } = require("../../uscis-forms/uscis-form.service");

test("case lifecycle calculates the enterprise milestone progression", () => {
  // updated: attorney_review milestone removed from scope (attorney collaboration
  // descoped) — case_manager_review now absorbs its weight (25) and the journey
  // goes straight from case manager review to filed.
  const steps = [
    [{}, 5, "case_assigned"],
    [{ assigned: true }, 15, "questionnaire_completed"],
    [{ assigned: true, questionnaireComplete: true }, 40, "documents_completed"],
    [{ assigned: true, questionnaireComplete: true, documentsComplete: true }, 65, "case_manager_review"],
    [{ assigned: true, questionnaireComplete: true, documentsComplete: true, caseManagerReviewComplete: true }, 90, "filed"],
    [{ assigned: true, questionnaireComplete: true, documentsComplete: true, caseManagerReviewComplete: true, filed: true }, 100, "filed"],
  ];

  steps.forEach(([metrics, expectedPercent, expectedMilestone]) => {
    const progress = CaseLifecycleOrchestrator.calculateProgress(metrics);
    assert.equal(progress.percent, expectedPercent);
    assert.equal(progress.currentMilestone, expectedMilestone);
  });
});

test("case lifecycle derives operational statuses without skipping review", () => {
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({}), { status: "pending_assignment", stage: "intake" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ assigned: true }), { status: "assigned", stage: "intake" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ questionnaireComplete: true }), { status: "document_collection", stage: "evidence" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ caseManagerReviewComplete: true }), { status: "under_review", stage: "legal_review" });
  // updated: attorney_review stage removed from scope; forms-generated now maps
  // straight to form_preparation for both status and stage.
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ formsGenerated: true }), { status: "form_preparation", stage: "form_preparation" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ pdfGenerated: true }), { status: "ready_to_file", stage: "filing" });
  assert.deepEqual(CaseLifecycleOrchestrator.deriveOperationalState({ filed: true }), { status: "filed", stage: "processing" });
});

test("form assignment is resolved from registry metadata", () => {
  assert.equal(templateAppliesToCase({
    formCode: "I-129",
    status: "active",
    assignmentRules: { visaTypes: ["H-1B"], required: true },
  }, { visaType: "H1B" }), true);
  assert.equal(templateAppliesToCase({
    formCode: "I-140",
    status: "active",
    assignmentRules: { visaTypes: ["EB-2 NIW"], required: true },
  }, { visaType: "H1B" }), false);
});

test("Case stores shared lifecycle progress and specialist ownership", () => {
  // updated: per-specialist-role ownership fields (assignedAttorney,
  // assignedProfessor, assignedFinance, assignedDocumentationSpecialist) were
  // consolidated away — attorney/professor collaboration is descoped, and
  // remaining non-case-manager assignees route through assignedAgentUser.
  assert.ok(Case.schema.path("journeyProgress.percent"));
  assert.ok(Case.schema.path("journeyProgress.milestones"));
  assert.ok(Case.schema.path("assignedCaseManager"));
  assert.ok(Case.schema.path("assignedTeamLead"));
  assert.ok(Case.schema.path("assignedAgentUser"));
  assert.ok(Case.schema.path("petitioner"));
  assert.ok(Case.schema.path("employer"));
  assert.ok(Case.schema.path("organization"));
  assert.ok(Case.schema.path("paymentReferences"));
  assert.ok(Case.schema.statics.lifecycleStages.some((stage) => stage.key === "ready_for_filing"));
});
