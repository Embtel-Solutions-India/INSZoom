const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const { evaluateConditionGroup } = require("../condition-evaluator");
const CanonicalFieldRegistryService = require("../../form-mapping/services/CanonicalFieldRegistryService");

// Phase 2 H-1B coverage audit regression tests. These are DB-free, following
// this repo's established convention (EMPLOYMENT_CHECKLIST_DEFINITIONS is a
// pure, deterministic computation over h1b.js's static exports — no Mongoose
// needed to test its shape). The DB-backed provisioning behavior itself
// (ensureDefaultVisaTemplates against a real Questionnaire/Question
// collection: additive, idempotent, non-destructive, draft-only) was verified
// live against the running dev backend — see the Phase 2 report.

const employer = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "h1b_employer_checklist");
const employee = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((def) => def.key === "h1b_employee_checklist");

function byKey(definition, key) {
  return definition.questions.find((question) => question.key === key);
}

test("h1b_employer_checklist and h1b_employee_checklist have no duplicate question keys", () => {
  for (const definition of [employer, employee]) {
    const keys = definition.questions.map((question) => question.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${definition.key} has duplicate question keys: ${duplicates.join(", ")}`);
  }
});

test("neither H-1B checklist definition sets a published status (stays in draft for legal review, per Goal 5)", () => {
  for (const definition of [employer, employee]) {
    assert.notEqual(definition.status, "published");
  }
});

test("coverage gap fix: certified LCA / ETA-9035 is a required employer document", () => {
  const doc = byKey(employer, "certified_lca_eta9035");
  assert.ok(doc, "certified_lca_eta9035 question is missing");
  assert.equal(doc.type, "file");
  assert.equal(doc.required, true);
});

test("coverage gap fix: SOC code and prevailing wage level are required employer fields (H-1B Data Collection Supplement)", () => {
  const soc = byKey(employer, "employer_position_socCode");
  const wageLevel = byKey(employer, "employer_position_wageLevel");
  assert.ok(soc?.required);
  assert.ok(wageLevel?.required);
  assert.equal(wageLevel.type, "select");
  assert.deepEqual(wageLevel.options.map((o) => o.value), ["Level I", "Level II", "Level III", "Level IV"]);
});

test("coverage gap fix: H-1B-dependent/willful-violator and ACWIA fee exemption questions are required employer fields (H-1B Data Collection Supplement Section A)", () => {
  const dependentOrViolator = byKey(employer, "employer_workforce_isH1bDependentOrWillfulViolator");
  const acwiaExempt = byKey(employer, "employer_workforce_isAcwiaFeeExempt");
  assert.ok(dependentOrViolator?.required);
  assert.equal(dependentOrViolator.type, "radio");
  assert.ok(acwiaExempt?.required);
  assert.equal(acwiaExempt.type, "radio");
});

test("coverage gap fix: beneficiary gender is a required employee field (I-129 Part 3) with a resolvable canonical path", () => {
  const gender = byKey(employee, "employee_personal_gender");
  assert.ok(gender?.required);
  assert.equal(gender.type, "select");
  assert.deepEqual(gender.options.map((o) => o.value), ["Male", "Female"]);
  assert.equal(gender.mapping?.canonicalPath, "person.gender");
});

test("every employee question's mapping.canonicalPath (including the newly added gender field) resolves in CanonicalFieldRegistryService", () => {
  const registryPaths = new Set(CanonicalFieldRegistryService.list().map((field) => field.path));
  const mappedQuestions = employee.questions.filter((question) => question.mapping?.canonicalPath);
  assert.ok(mappedQuestions.length > 0, "expected at least one employee question with a canonical mapping");
  mappedQuestions.forEach((question) => {
    assert.ok(
      registryPaths.has(question.mapping.canonicalPath),
      `question "${question.key}" maps to unregistered canonical path "${question.mapping.canonicalPath}"`
    );
  });
});

test("conditional logic: cap selection notice is required only for a New H1B filing", () => {
  const question = byKey(employee, "cap_selection_notice");
  assert.equal(evaluateConditionGroup(question.conditionalLogic, { employee_filingType: { value: "New H1B" } }), true);
  assert.equal(evaluateConditionGroup(question.conditionalLogic, { employee_filingType: { value: "H1B Extension" } }), false);
  assert.equal(evaluateConditionGroup(question.conditionalLogic, {}), false);
});

test("conditional logic: F-1/OPT/STEM-OPT documents are required for any of the three current visa statuses, not others", () => {
  const question = byKey(employee, "f1_opt_stem_documents");
  ["F-1", "OPT", "STEM OPT"].forEach((status) => {
    assert.equal(
      evaluateConditionGroup(question.conditionalLogic, { employee_immigrationStatus_currentVisaStatus: { value: status } }),
      true,
      `expected visible for currentVisaStatus=${status}`
    );
  });
  assert.equal(evaluateConditionGroup(question.conditionalLogic, { employee_immigrationStatus_currentVisaStatus: { value: "H-1B" } }), false);
});

test("conditional logic: H-4 dependent documents are required only when the employee reports H-4 dependents", () => {
  const dependentDocs = employee.questions.filter((question) => question.key.startsWith("dependent_"));
  assert.ok(dependentDocs.length > 0, "expected at least one dependent document question");
  dependentDocs.forEach((question) => {
    assert.equal(evaluateConditionGroup(question.conditionalLogic, { employee_immigrationHistory_hasH4Dependents: { value: "yes" } }), true);
    assert.equal(evaluateConditionGroup(question.conditionalLogic, { employee_immigrationHistory_hasH4Dependents: { value: "no" } }), false);
  });
});

test("conditional logic: FEIN proof document is required only on first-time LCA filing without DOL verification", () => {
  const question = byKey(employer, "irs_fein_assignment_letter");
  assert.equal(evaluateConditionGroup(question.conditionalLogic, { employer_lca_firstLcaFiling: { value: "yes" }, employer_lca_dolVerified: { value: "no" } }), true);
  assert.equal(evaluateConditionGroup(question.conditionalLogic, { employer_lca_firstLcaFiling: { value: "yes" }, employer_lca_dolVerified: { value: "yes" } }), false);
  assert.equal(evaluateConditionGroup(question.conditionalLogic, { employer_lca_firstLcaFiling: { value: "no" }, employer_lca_dolVerified: { value: "no" } }), false);
});
