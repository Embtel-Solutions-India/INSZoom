const assert = require("node:assert/strict");
const test = require("node:test");
const RuleEvaluationService = require("../services/RuleEvaluationService");

test("RuleEvaluationService reports missing required evidence", () => {
  const [result] = RuleEvaluationService.evaluate([
    {
      category: "EB-2 NIW",
      requiredEvidence: ["advanced_degree", "national_importance"],
      evidenceWeights: { advanced_degree: 50, national_importance: 50 },
    },
  ], {
    advanced_degree: { available: true, strength: "strong", sources: ["educationHistory"] },
    national_importance: { available: false, strength: "missing", sources: [] },
  });
  assert.equal(result.advisoryEligible, false);
  assert.deepEqual(result.requiredMissing, ["national_importance"]);
});
