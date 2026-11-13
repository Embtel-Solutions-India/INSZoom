// Cases submitted per month + Active / On Hold trend: pure, DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { submittedAt, submittedByMonth, monthlyFlow } = require("../caseTrends.service");

const NOW = new Date("2026-11-12T10:00:00Z");
const d = (iso) => new Date(iso);
const row = (extra) => ({ createdAt: d("2026-01-01"), assigned: true, currentKey: "case_onboarded", events: [], ...extra });

test("a case is dated by the FIRST time it was sent to a completed stage (even if it has moved on or back since)", () => {
  const moved = row({ currentKey: "status_approved", events: [{ key: "submitted_fedex", at: d("2026-09-10") }, { key: "receipt_tracking", at: d("2026-10-02") }, { key: "status_approved", at: d("2026-11-01") }] });
  assert.equal(submittedAt(moved), d("2026-09-10").getTime());
  assert.equal(submittedAt(row({ currentKey: "docs_checklist" })), null, "never submitted -> not counted");
  const movedBack = row({ currentKey: "docs_checklist", events: [{ key: "submitted_fedex", at: d("2026-09-10") }, { key: "docs_checklist", at: d("2026-09-20") }] });
  assert.equal(submittedAt(movedBack), d("2026-09-10").getTime(), "sent to Submitted in Sep: still counted in Sep");
  const legacy = row({ currentKey: "submitted_fedex", fallbackAt: d("2026-08-20") });
  assert.equal(submittedAt(legacy), d("2026-08-20").getTime(), "no history: falls back to the last sync time");
});

test("monthly bars: last 12 months, zero months included, each submitted case counted once", () => {
  const rows = [
    row({ currentKey: "submitted_fedex", events: [{ key: "submitted_fedex", at: d("2026-10-05") }] }),
    row({ currentKey: "status_approved", events: [{ key: "submitted_fedex", at: d("2026-10-20") }, { key: "status_approved", at: d("2026-11-02") }] }),
    row({ currentKey: "submitted_fedex", events: [{ key: "submitted_fedex", at: d("2026-03-03") }] }),
    row({ currentKey: "submitted_fedex", events: [{ key: "submitted_fedex", at: d("2024-03-03") }] }),
    row({ currentKey: "on_hold" }),
    row({ currentKey: "case_onboarded" }),
  ];
  const bars = submittedByMonth(rows, NOW);
  assert.equal(bars.length, 12);
  assert.deepEqual([bars[0].month, bars[11].month], ["2025-12", "2026-11"]);
  const byMonth = Object.fromEntries(bars.map((bar) => [bar.month, bar.count]));
  assert.equal(byMonth["2026-10"], 2);
  assert.equal(byMonth["2026-03"], 1);
  assert.equal(byMonth["2026-11"], 0);
  assert.equal(bars.reduce((sum, bar) => sum + bar.count, 0), 3, "older than 12 months and non-submitted cases are not in the bars");
  assert.equal(bars[0].label, "Dec");
});

test("monthly flow: counts only what happened IN the month (not cumulative); a case created and put on hold in one month counts in both", () => {
  const rows = [
    // created Oct, on hold Oct, back to a white stage Nov, closed Nov
    row({ id: "a", createdAt: d("2026-10-02"), currentKey: "submitted_fedex", events: [{ key: "on_hold", at: d("2026-10-20") }, { key: "docs_checklist", at: d("2026-11-03") }, { key: "submitted_fedex", at: d("2026-11-08") }] }),
    // created Sep, no moves, still white
    row({ id: "b", createdAt: d("2026-09-15"), currentKey: "case_onboarded" }),
    // created Nov, moved through PWD (coloured, not active) to Submitted in Nov
    row({ id: "c", createdAt: d("2026-11-01"), currentKey: "submitted_fedex", events: [{ key: "pwd_under_process", at: d("2026-11-04") }, { key: "submitted_fedex", at: d("2026-11-09") }] }),
    // legacy: no history, on hold now, last sync in Aug
    row({ id: "d", createdAt: d("2026-06-01"), currentKey: "on_hold", fallbackAt: d("2026-08-12") }),
  ];
  const flow = Object.fromEntries(monthlyFlow(rows, NOW).map((m) => [m.month, m]));
  assert.equal(Object.keys(flow).length, 12);
  assert.deepEqual([flow["2026-09"].active, flow["2026-09"].onHold], [1, 0], "b was created and active in Sep; nothing carried over");
  assert.deepEqual([flow["2026-10"].active, flow["2026-10"].onHold], [1, 1], "a: created active AND held in Oct");
  assert.deepEqual([flow["2026-11"].active, flow["2026-11"].onHold], [2, 0], "a back to white + c created");
  assert.deepEqual([flow["2026-08"].onHold, flow["2026-06"].active], [1, 0], "a legacy on-hold case is dated by its last sync and not counted active (coloured now, no history)");
  assert.equal(flow["2026-12"], undefined);
});
