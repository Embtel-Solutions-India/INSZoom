const assert = require("node:assert/strict");
const test = require("node:test");

test("case readiness signal math remains bounded", () => {
  const totalSignals = 6;
  const positiveSignals = [true, true, false, true, false, true].filter(Boolean).length;
  const completionPercent = Math.round((positiveSignals / totalSignals) * 100);
  const caseHealthScore = Math.max(0, completionPercent - Math.min(30, 2 * 5 + 1 * 5));
  assert.equal(completionPercent, 67);
  assert.equal(caseHealthScore, 52);
});
