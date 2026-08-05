const assert = require("node:assert/strict");
const test = require("node:test");
const TimelineService = require("../services/TimelineService");

test("TimelineService appends immutable-style case events", () => {
  const caseData = { timeline: [], auditHistory: [] };
  const event = TimelineService.add(caseData, "comment", "Comment Added", "Client uploaded context", { _id: "u1" }, { internalOnly: false });
  assert.equal(caseData.timeline.length, 1);
  assert.equal(event.title, "Comment Added");
  assert.ok(event.createdAt);
});

test("TimelineService hides internal events for clients", () => {
  const caseData = {
    timeline: [
      { title: "Public", metadata: {} },
      { title: "Internal", metadata: { internalOnly: true } },
    ],
  };
  assert.equal(TimelineService.list(caseData, { role: "client" }).length, 1);
  assert.equal(TimelineService.list(caseData, { role: "attorney" }).length, 2);
});
