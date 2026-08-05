const assert = require("node:assert/strict");
const test = require("node:test");
const Case = require("../../../models/Case");
const Questionnaire = require("../../../models/Questionnaire");
const router = require("../case.routes");
const ImmigrationKnowledgeEngineService = require("../immigration-knowledge-engine.service");
const { hasAssignmentScope, templateAppliesToCase } = require("../../uscis-forms/uscis-form.service");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("knowledge engine matches questionnaire metadata without visa-specific code", () => {
  const questionnaire = {
    visaTypes: ["H-1B"],
    assignmentRules: {
      caseTypes: ["employment"],
      applicantTypes: ["employee"],
      required: true,
    },
  };
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(questionnaire, {
    visaType: "H1B",
    caseType: "employment",
    applicantType: "employee",
  }), true);
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(questionnaire, {
    visaType: "O-1A",
    caseType: "employment",
    applicantType: "employee",
  }), false);
});

test("an L-1A checklist never matches an H-1B case, and vice versa", () => {
  const l1aEmployerChecklist = { key: "l1a_employer_checklist", visaType: "L1A", visaTypes: ["L1A"], checklistRole: "employer" };
  const h1bEmployerChecklist = { key: "h1b_employer_checklist", visaType: "H1B", visaTypes: ["H1B"], checklistRole: "employer" };
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(l1aEmployerChecklist, { visaType: "L-1A" }), true);
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(l1aEmployerChecklist, { visaType: "H-1B" }), false);
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(h1bEmployerChecklist, { visaType: "H-1B" }), true);
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(h1bEmployerChecklist, { visaType: "L-1A" }), false);
});

test("a questionnaire with no visa scope at all never leaks onto every case (fail-closed, not fail-open)", () => {
  // Only caseTypes is set — no visaType/visaTypes/assignmentRules.visaTypes
  // anywhere, and appliesToAllVisas is not set either. Before the fix,
  // questionnaireApplies() fell back to ruleMatches([undefined], visaType),
  // and a case with no visaType would trivially match "" === "" — this
  // guards the fix (explicit no-scope means "does not apply", never "matches
  // every visa").
  const unscoped = { key: "some_custom_checklist", assignmentRules: { caseTypes: ["employment"] } };
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(unscoped, { visaType: "L-1A", caseType: "employment" }), false);
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(unscoped, { visaType: "", caseType: "employment" }), false);
});

test("appliesToAllVisas is the only way a visa-agnostic questionnaire can still apply", () => {
  const globalIntake = { key: "generic_intake", appliesToAllVisas: true, assignmentRules: { caseTypes: ["employment"] } };
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(globalIntake, { visaType: "L-1A", caseType: "employment" }), true);
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(globalIntake, { visaType: "H-1B", caseType: "employment" }), true);
});

test("L-1A Business Plan checklist only applies to a New Office petition", () => {
  const businessPlanChecklist = {
    key: "l1a_business_plan_checklist",
    visaType: "L1A",
    visaTypes: ["L1A"],
    checklistRole: "business_plan",
    assignmentRules: { requiresNewOfficePetition: true },
  };
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(businessPlanChecklist, { visaType: "L-1A", assessmentAnswers: { newOfficePetition: "yes" } }), true);
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(businessPlanChecklist, { visaType: "L-1A", assessmentAnswers: { newOfficePetition: "no" } }), false);
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(businessPlanChecklist, { visaType: "L-1A", assessmentAnswers: {} }), false);
  // Still visa-scoped even when the New Office answer is yes — an H-1B case
  // (which has no business plan checklist at all) never matches it.
  assert.equal(ImmigrationKnowledgeEngineService.questionnaireApplies(businessPlanChecklist, { visaType: "H-1B", assessmentAnswers: { newOfficePetition: "yes" } }), false);
});

test("unscoped form templates are never assigned to every case", () => {
  assert.equal(hasAssignmentScope({ assignmentRules: {} }), false);
  assert.equal(templateAppliesToCase({ assignmentRules: {} }, { visaType: "H-1B" }), false);
  assert.equal(templateAppliesToCase({
    visaTypes: ["H-1B"],
    assignmentRules: { required: true },
  }, { visaType: "H1B" }), true);
});

test("questionnaire evidence and upload questions produce a deduplicated checklist", () => {
  const questionnaire = { _id: "questionnaire-1", key: "employment_intake", documentRequirements: ["Passport"], evidenceRequirements: [], requiredCanonicalFields: [] };
  const requirements = ImmigrationKnowledgeEngineService.requirementsFromQuestionnaires([questionnaire], [{
    questionnaire: "questionnaire-1",
    key: "passportUpload",
    label: "Passport",
    type: "file",
    required: true,
    fileConstraints: { requireDocumentCategory: "Passport" },
  }, {
    questionnaire: "questionnaire-1",
    key: "degreeUpload",
    label: "Degree and transcripts",
    type: "file",
    required: true,
    evidenceCategory: "Education",
  }]);
  assert.equal(requirements.documents.filter((item) => item.documentType === "Passport").length, 1);
  assert.ok(requirements.documents.some((item) => item.documentType === "Education"));
  assert.ok(requirements.evidence.some((item) => item.documentType === "Education"));
});

test("knowledge orchestration state is embedded in the existing Case model", () => {
  assert.ok(Case.schema.path("knowledgePlan.status"));
  assert.ok(Case.schema.path("knowledgePlan.formAssignments"));
  assert.ok(Case.schema.path("knowledgePlan.documentRequirements"));
  assert.ok(Questionnaire.schema.path("assignmentRules.visaTypes"));
  assert.ok(Questionnaire.schema.path("documentRequirements"));
});

test("case knowledge plan APIs are registered", () => {
  const registered = routes();
  assert.ok(registered.includes("GET /:id/knowledge-plan"));
  assert.ok(registered.includes("POST /:id/knowledge-plan/refresh"));
});
