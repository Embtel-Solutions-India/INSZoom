// DB-free: the attorney's personal timeline - stored events merged with the dates the grant already carries.
// Run with: node --test src/modules/attorney/tests/attorneyTimeline.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { compose, record } = require("../attorneyTimeline.service");

const d = (iso) => new Date(iso);

test("a brand-new grant shows just 'assigned'", () => {
  const timeline = compose({ grant: { assignedAt: d("2026-10-01") }, events: [] });
  assert.deepEqual(timeline.map((e) => e.type), ["assigned"]);
});

test("assigned -> opened -> worked -> reviewed, newest first, from the grant dates alone (work done before events were recorded still shows)", () => {
  const grant = { assignedAt: d("2026-10-01"), engagedAt: d("2026-10-02"), reviewStatus: "reviewed", reviewedAt: d("2026-10-05") };
  const events = [{ _id: "e1", type: "feedback_sent", title: "You sent feedback", createdAt: d("2026-10-04") }];
  assert.deepEqual(compose({ grant, events }).map((e) => e.type), ["review_completed", "feedback_sent", "first_opened", "assigned"]);
});

test("a stored event replaces the derived one that would say the same thing (no double 'opened' / 'review completed')", () => {
  const grant = { assignedAt: d("2026-10-01"), engagedAt: d("2026-10-02"), reviewStatus: "reviewed", reviewedAt: d("2026-10-05") };
  const events = [
    { _id: "e1", type: "case_opened", title: "You opened the case", createdAt: d("2026-10-02") },
    { _id: "e2", type: "review_completed", title: "Review completed", createdAt: d("2026-10-05") },
  ];
  const types = compose({ grant, events }).map((e) => e.type);
  assert.deepEqual(types, ["review_completed", "case_opened", "assigned"]);
});

test("a reopened review is not shown as completed", () => {
  const grant = { assignedAt: d("2026-10-01"), reviewStatus: "in_review", reviewedAt: null };
  assert.equal(compose({ grant, events: [] }).some((e) => e.type === "review_completed"), false);
});

test("missing or invalid dates are dropped instead of breaking the list", () => {
  const timeline = compose({ grant: { assignedAt: "garbage" }, events: [{ _id: "e", type: "feedback_sent", title: "x", createdAt: null }] });
  assert.deepEqual(timeline, []);
});

test("record never throws, and skips a repeat inside the dedupe window", async () => {
  const created = [];
  const Model = { exists: async () => created.length > 0, create: async (row) => { created.push(row); return row; } };
  await record({ caseId: "c", attorneyId: "a", type: "case_opened", title: "t", dedupeMinutes: 30 }, { Model });
  await record({ caseId: "c", attorneyId: "a", type: "case_opened", title: "t", dedupeMinutes: 30 }, { Model });
  assert.equal(created.length, 1);
  assert.equal(await record({ caseId: "c", attorneyId: "a", type: "case_opened", title: "t" }, { Model: { create: async () => { throw new Error("db down"); } } }), null);
});
