const assert = require("node:assert/strict");
const test = require("node:test");
const EligibilityEngineService = require("../services/EligibilityEngineService");

test("EligibilityEngineService produces advisory recommendations and gaps", () => {
  const result = EligibilityEngineService.buildEvaluation({
    educationHistory: [{ degree: "MS" }],
    employmentHistory: [{ jobTitle: "Research Scientist" }],
    petitioner: { name: "Acme" },
    ocr: { publications: ["A", "B", "C"], awards: ["Award"] },
    questionnaire: { nationalImportance: "Research impacts public health" },
  }, ["EB-2 NIW", "H-1B"]);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.attorneyReviewRequired, true);
  assert.ok(result.recommendations.length >= 1);
  assert.ok(result.recommendations[0].disclaimer.includes("not legal advice"));
});
