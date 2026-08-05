const assert = require("node:assert/strict");
const test = require("node:test");
const { score } = require("../scoring.service");
const { DEFAULT_SCORING_CONFIG } = require("../quiz.config");

const KEYS = ["awards", "memberships", "published_material", "judging", "original_contributions", "scholarly_articles", "critical_role", "high_remuneration"];

function answers(values) {
  return KEYS.map((key, i) => ({ key, value: values[i] }));
}

test("scoring: 4 criteria at filing strength (>=2) -> Tier A", () => {
  const result = score(answers([3, 3, 3, 3, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG);
  assert.equal(result.criteriaMetCount, 4);
  assert.equal(result.tier, "A");
  assert.equal(result.pathwayString, "O-1A now; EB-1A in parallel");
  assert.equal(result.routing, "direct_priority");
});

test("scoring: exactly 3 criteria met -> Tier B", () => {
  const result = score(answers([2, 2, 2, 0, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG);
  assert.equal(result.criteriaMetCount, 3);
  assert.equal(result.tier, "B");
  assert.equal(result.routing, "direct");
});

test("scoring: exactly 2 criteria met -> Tier C", () => {
  const result = score(answers([2, 2, 0, 0, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG);
  assert.equal(result.criteriaMetCount, 2);
  assert.equal(result.tier, "C");
  assert.equal(result.routing, "strategy_queue");
});

test("scoring: 0 or 1 criteria met -> Tier D", () => {
  const zero = score(answers([1, 1, 0, 0, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG);
  assert.equal(zero.criteriaMetCount, 0);
  assert.equal(zero.tier, "D");
  assert.equal(zero.routing, "nurture");

  const one = score(answers([2, 1, 1, 1, 1, 1, 1, 1]), DEFAULT_SCORING_CONFIG);
  assert.equal(one.criteriaMetCount, 1);
  assert.equal(one.tier, "D");
});

test("scoring: developable count is tracked independently of met count", () => {
  const result = score(answers([2, 1, 1, 0, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG);
  assert.equal(result.criteriaMetCount, 1);
  assert.equal(result.criteriaDevelopableCount, 2);
});

test("scoring: an out-of-range value (5) is a validation error, not a crash", () => {
  assert.throws(() => score(answers([5, 0, 0, 0, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG), /Invalid criteria answer value/);
});

test("scoring: a non-integer value (2.5) is a validation error", () => {
  assert.throws(() => score(answers([2.5, 0, 0, 0, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG), /Invalid criteria answer value/);
});

test("scoring: a negative value is a validation error", () => {
  assert.throws(() => score(answers([-1, 0, 0, 0, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG), /Invalid criteria answer value/);
});

test("scoring: unanswered (missing/null/empty) criteria default to 0, never throw", () => {
  const result = score([{ key: "awards", value: undefined }, { key: "memberships", value: null }, { key: "judging", value: "" }], DEFAULT_SCORING_CONFIG);
  assert.equal(result.criteriaMetCount, 0);
  assert.equal(result.evidenceStrength.every((e) => e.value === 0), true);
});

test("scoring: an empty answers array never throws and yields the lowest tier", () => {
  const result = score([], DEFAULT_SCORING_CONFIG);
  assert.equal(result.criteriaMetCount, 0);
  assert.equal(result.tier, "D");
});

test("scoring: changing thresholds in config changes tiers with zero code change", () => {
  const stricterConfig = { ...DEFAULT_SCORING_CONFIG, filingStrengthThreshold: 3 };
  // Same answers that gave Tier A at threshold 2 now score fewer "met" criteria at threshold 3.
  const result = score(answers([3, 3, 3, 3, 0, 0, 0, 0]), stricterConfig);
  assert.equal(result.criteriaMetCount, 4); // all four 3s still meet >=3
  assert.equal(result.tier, "A");

  const looserAnswers = answers([2, 2, 2, 2, 0, 0, 0, 0]);
  const atThreshold2 = score(looserAnswers, DEFAULT_SCORING_CONFIG);
  const atThreshold3 = score(looserAnswers, stricterConfig);
  assert.equal(atThreshold2.criteriaMetCount, 4);
  assert.equal(atThreshold2.tier, "A");
  assert.equal(atThreshold3.criteriaMetCount, 0, "value 2 no longer meets a threshold of 3");
  assert.equal(atThreshold3.tier, "D");
});

test("scoring: evidenceStrength carries per-criterion value + met/developable + label", () => {
  const result = score(answers([2, 1, 0, 0, 0, 0, 0, 0]), DEFAULT_SCORING_CONFIG);
  assert.deepEqual(result.evidenceStrength[0], { key: "awards", value: 2, met: true, developable: false, label: "Solid" });
  assert.deepEqual(result.evidenceStrength[1], { key: "memberships", value: 1, met: false, developable: true, label: "Developing" });
});

test("scoring: rejects a config with no tier rules rather than silently misclassifying", () => {
  assert.throws(() => score(answers([0, 0, 0, 0, 0, 0, 0, 0]), { ...DEFAULT_SCORING_CONFIG, tierRules: [] }), /at least one tier rule/);
});
