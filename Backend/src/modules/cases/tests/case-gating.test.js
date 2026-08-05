const assert = require("node:assert/strict");
const test = require("node:test");
const { GATED_STAGES, evaluateStageGate } = require("../case-gating.config");

const COMPLETE_METRICS = { questionnaireComplete: true, documentsComplete: true };
const INCOMPLETE_QUESTIONNAIRE = { questionnaireComplete: false, documentsComplete: true };
const INCOMPLETE_DOCUMENTS = { questionnaireComplete: true, documentsComplete: false };

test("D2 policy: advancing a gated stage with an incomplete required checklist is blocked with a clear error", () => {
  const result = evaluateStageGate("legal_review", INCOMPLETE_QUESTIONNAIRE);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /legal_review/);
  assert.match(result.reason, /questionnaire/);
});

test("D2 policy: a gated stage transition succeeds once the required checklist(s) are complete", () => {
  const result = evaluateStageGate("legal_review", COMPLETE_METRICS);
  assert.equal(result.blocked, false);
  assert.equal(result.warning, null);
});

test("D2 policy: every filing stage is hard-gated, not just case-manager review", () => {
  for (const stage of ["ready_for_filing", "filed"]) {
    const result = evaluateStageGate(stage, INCOMPLETE_DOCUMENTS);
    assert.equal(result.blocked, true, `${stage} should be blocked when documents are incomplete`);
    assert.match(result.reason, /required documents/);
  }
});

test("D2 policy: earlier (non-gated) stages are soft-warn only, never blocked", () => {
  for (const stage of ["intake", "documents_pending", "evidence", "form_preparation"]) {
    assert.equal(GATED_STAGES[stage], undefined, `${stage} must not be in the gated stage set`);
    const result = evaluateStageGate(stage, INCOMPLETE_QUESTIONNAIRE);
    assert.equal(result.blocked, false, `${stage} must never block`);
    assert.ok(result.warning, `${stage} should still surface a warning when incomplete`);
  }
});

test("D2 policy: no warning is surfaced for any stage once checklists are complete", () => {
  for (const stage of ["intake", "legal_review", "ready_for_filing", "filed", "processing"]) {
    const result = evaluateStageGate(stage, COMPLETE_METRICS);
    assert.equal(result.blocked, false);
    assert.equal(result.warning, null);
  }
});
