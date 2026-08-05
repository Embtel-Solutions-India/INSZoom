const assert = require("node:assert/strict");
const test = require("node:test");
const SubmissionTrackingService = require("../services/SubmissionTrackingService");

test("SubmissionTrackingService identifies USCIS service centers from receipt prefixes", () => {
  assert.equal(SubmissionTrackingService.serviceCenter("WAC2612345678"), "California Service Center");
  assert.equal(SubmissionTrackingService.serviceCenter("IOE0912345678"), "USCIS Electronic Immigration System");
  assert.equal(SubmissionTrackingService.serviceCenter("ZZZ000"), "Unknown");
});
