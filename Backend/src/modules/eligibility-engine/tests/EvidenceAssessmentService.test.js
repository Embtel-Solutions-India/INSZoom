const assert = require("node:assert/strict");
const test = require("node:test");
const EvidenceAssessmentService = require("../services/EvidenceAssessmentService");

test("EvidenceAssessmentService identifies evidence from canonical data", () => {
  const evidence = EvidenceAssessmentService.assess({
    educationHistory: [{ degree: "PhD" }],
    ocr: { publications: ["Paper A", "Paper B", "Paper C"] },
    petitioner: { name: "Acme" },
  });
  assert.equal(evidence.advanced_degree.available, true);
  assert.equal(evidence.publications.strength, "strong");
  assert.equal(evidence.employer_sponsor.available, true);
});
