const assert = require("node:assert/strict");
const test = require("node:test");
const DeadlineService = require("../services/DeadlineService");

test("DeadlineService returns upcoming deadlines and future recommendations", () => {
  const soon = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const caseData = {
    immigrationLifecycle: { deadlines: [{ type: "rfe_deadline", label: "RFE", dueDate: soon, status: "open", priority: "urgent" }] },
    visaExpirationDate: soon,
  };
  assert.equal(DeadlineService.upcoming(caseData, 30).length, 1);
  assert.equal(DeadlineService.futureRecommendations(caseData)[0].type, "renewal_recommended");
});
