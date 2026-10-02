const test = require("node:test");
const assert = require("node:assert/strict");
const { periodStart, CLOSED_STATUSES, NOT_OPEN_STATUSES, BOARDS, PERIODS } = require("../leaderboard.service");

// Wednesday 2026-10-14 15:30 local time
const NOW = new Date(2026, 9, 14, 15, 30, 0);

test("today starts at midnight, so 'today' is a real window (it used to be zero-length)", () => {
  const start = periodStart("today", NOW);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getDate(), 14);
  assert.ok(start < NOW);
});

test("this_week starts on Monday, this_month on the 1st, all_time has no start", () => {
  const week = periodStart("this_week", NOW);
  assert.equal(week.getDay(), 1);
  assert.equal(week.getDate(), 12);
  assert.equal(periodStart("this_month", NOW).getDate(), 1);
  assert.equal(periodStart("all_time", NOW), null);
});

test("a Sunday belongs to the week that started the previous Monday", () => {
  const sunday = new Date(2026, 9, 18, 10, 0, 0);
  assert.equal(periodStart("this_week", sunday).getDate(), 12);
});

test("closed and open statuses never overlap, and match the dashboard's closed set", () => {
  assert.ok(["closed", "approved"].every((status) => CLOSED_STATUSES.includes(status)));
  assert.ok(CLOSED_STATUSES.every((status) => NOT_OPEN_STATUSES.includes(status)));
  assert.ok(!NOT_OPEN_STATUSES.includes("active"));
  assert.ok(!NOT_OPEN_STATUSES.includes("form_preparation"));
});

test("the four boards and four periods are exposed", () => {
  assert.deepEqual(BOARDS, ["case_managers", "team_leads", "attorneys", "clients"]);
  assert.deepEqual(PERIODS, ["today", "this_week", "this_month", "all_time"]);
});
