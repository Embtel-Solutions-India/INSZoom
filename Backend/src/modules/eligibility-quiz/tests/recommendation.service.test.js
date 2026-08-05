const assert = require("node:assert/strict");
const test = require("node:test");
const recommendationService = require("../recommendation.service");
const copyLintService = require("../../compliance/copyLint.service");
const { DEFAULT_SCORING_CONFIG } = require("../quiz.config");

// copyLintService.scan() resolves the prohibited-term list from the DB
// (Settings) via entity-config — not available in this no-DB test run.
// Stubbing it to delegate to the real, pure `lint()` against a known term
// list (node:test's built-in mock, auto-restored per test) exercises the
// actual matching logic without needing Mongo, while still proving the
// copy-lint integration point genuinely runs.
function stubScan(t, terms) {
  t.mock.method(copyLintService, "scan", async (text) => copyLintService.lint(text, terms));
}

test("recommendation: every tier returns a non-empty alternativePathways list", async (t) => {
  stubScan(t, []);
  for (const tier of ["A", "B", "C", "D"]) {
    const scoreResult = { tier, pathwayString: `pathway for ${tier}`, routing: "nurture" };
    const rec = await recommendationService.build(scoreResult, DEFAULT_SCORING_CONFIG);
    assert.ok(Array.isArray(rec.alternativePathways) && rec.alternativePathways.length > 0, `tier ${tier} must have alternatives`);
  }
});

test("recommendation: Tier D specifically lists EB-2 NIW, L-1A, and E-2", async (t) => {
  stubScan(t, []);
  const scoreResult = { tier: "D", pathwayString: "EB-2 NIW / L-1A / E-2 pathway review", routing: "nurture" };
  const rec = await recommendationService.build(scoreResult, DEFAULT_SCORING_CONFIG);
  assert.ok(rec.alternativePathways.includes("EB-2 NIW"));
  assert.ok(rec.alternativePathways.includes("L-1A"));
  assert.ok(rec.alternativePathways.includes("E-2"));
});

test("recommendation: nextStep copy matches the routing outcome, never implies rejection", async (t) => {
  stubScan(t, []);
  const direct = await recommendationService.build({ tier: "A", pathwayString: "x", routing: "direct_priority" }, DEFAULT_SCORING_CONFIG);
  assert.match(direct.nextStep, /book a consultation/i);

  const nurture = await recommendationService.build({ tier: "D", pathwayString: "x", routing: "nurture" }, DEFAULT_SCORING_CONFIG);
  assert.doesNotMatch(nurture.nextStep, /ineligible|reject|denied/i);
  assert.match(nurture.nextStep, /explore alternative pathways/i);
});

test("recommendation: copy-lint integration is genuinely exercised — a prohibited term in the pathway string is flagged", async (t) => {
  stubScan(t, ["guaranteed"]);
  const scoreResult = { tier: "A", pathwayString: "This is a guaranteed pathway to a visa", routing: "direct_priority" };
  const rec = await recommendationService.build(scoreResult, DEFAULT_SCORING_CONFIG);
  assert.equal(rec.lintResult.clean, false);
  assert.equal(rec.lintResult.severity, "block");
});

test("recommendation: clean copy passes lint with zero violations", async (t) => {
  stubScan(t, ["guaranteed"]);
  const scoreResult = { tier: "B", pathwayString: "O-1A with targeted evidence development", routing: "direct" };
  const rec = await recommendationService.build(scoreResult, DEFAULT_SCORING_CONFIG);
  assert.equal(rec.lintResult.clean, true);
});

test("recommendation: a lint hit never throws — it's reported, not enforced, at this layer", async (t) => {
  stubScan(t, ["guaranteed"]);
  await assert.doesNotReject(recommendationService.build({ tier: "A", pathwayString: "guaranteed results", routing: "direct_priority" }, DEFAULT_SCORING_CONFIG));
});
