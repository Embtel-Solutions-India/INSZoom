const assert = require("node:assert/strict");
const test = require("node:test");
const ImmigrationTimelineService = require("../services/ImmigrationTimelineService");

test("ImmigrationTimelineService appends journey and case timeline events", () => {
  const caseData = { timeline: [], auditHistory: [] };
  const event = ImmigrationTimelineService.add(caseData, "filing", "H1B Filed", { submissionMethod: "mail" }, { _id: "u1" });
  assert.equal(event.type, "filing");
  assert.equal(caseData.immigrationLifecycle.journeyEvents.length, 1);
  assert.equal(caseData.timeline[0].type, "immigration_filing");
});
