// DB-free: the week-over-week maths is a pure function over case grants.
// Run with: node --test src/modules/attorney/tests/attorneyTrends.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeTrends } = require("../attorneyTrends.service");

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-30T12:00:00Z");
const ago = (days) => new Date(now.getTime() - days * DAY);
const ME = "a1";

const grant = (extra) => ({ attorneyId: ME, status: "active", ...extra });

test("assigned counts grants active on each day, revoked ones only until revokedAt", () => {
  const cases = [
    { attorneyAccess: [grant({ assignedAt: ago(30) })] },
    { attorneyAccess: [grant({ assignedAt: ago(3) })] },
    { attorneyAccess: [grant({ assignedAt: ago(20), status: "revoked", revokedAt: ago(5) })] },
    { attorneyAccess: [{ attorneyId: "someone-else", status: "active", assignedAt: ago(30) }] },
  ];
  const { assigned } = computeTrends({ cases, userId: ME, now });
  assert.equal(assigned.previous, 2); // 7 days ago: the old case + the (not yet revoked) one
  assert.equal(assigned.current, 2); // now: old case + the one added 3 days ago
  assert.equal(assigned.series.length, 8);
});

test("active counts cases started by that day and not yet reviewed", () => {
  const cases = [
    { attorneyAccess: [grant({ assignedAt: ago(30) })] }, // never touched: never active
    { attorneyAccess: [grant({ assignedAt: ago(30), engagedAt: ago(10) })] }, // active the whole week
    { attorneyAccess: [grant({ assignedAt: ago(30), engagedAt: ago(2) })] }, // became active 2 days ago
    { attorneyAccess: [grant({ assignedAt: ago(30), engagedAt: ago(10), reviewStatus: "reviewed", reviewedAt: ago(3) })] }, // active, then reviewed
  ];
  const { active } = computeTrends({ cases, userId: ME, now });
  assert.equal(active.previous, 2); // the second and the (not yet reviewed) fourth
  assert.equal(active.current, 2); // the second and third; the fourth is reviewed now
});

test("reviewed % only counts cases reviewed by that day", () => {
  const cases = [
    { attorneyAccess: [grant({ assignedAt: ago(30), reviewStatus: "reviewed", reviewedAt: ago(2) })] },
    { attorneyAccess: [grant({ assignedAt: ago(30) })] },
  ];
  const { reviewedPct } = computeTrends({ cases, userId: ME, now });
  assert.equal(reviewedPct.previous, 0);
  assert.equal(reviewedPct.current, 50);
});

test("no data gives flat zero series, never NaN", () => {
  const t = computeTrends({ cases: [], userId: ME, now });
  for (const key of ["assigned", "active", "reviewedPct"]) assert.deepEqual(t[key].series, Array(8).fill(0));
});
