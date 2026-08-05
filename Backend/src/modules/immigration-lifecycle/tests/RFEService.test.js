const assert = require("node:assert/strict");
const test = require("node:test");
const RFEService = require("../services/RFEService");

test("RFEService computes response package progress", () => {
  assert.equal(RFEService.progress({ requestedEvidence: ["passport", "letter"], supportingDocuments: ["passport"] }), 50);
  assert.equal(RFEService.progress({ requestedEvidence: ["passport"], supportingDocuments: ["passport", "letter"] }), 100);
});
