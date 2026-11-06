const test = require("node:test");
const assert = require("node:assert/strict");
const { workDateOf, promptsFor, cleanItems } = require("./everyday.service");

// IST = UTC + 5:30. 21:00 IST = 15:30 UTC.
const ist = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`);

test("the work day starts at 21:00 IST and runs to 21:00 IST next day", () => {
  assert.equal(workDateOf(ist("2026-11-07", "20:59")), "2026-11-06");
  assert.equal(workDateOf(ist("2026-11-07", "21:00")), "2026-11-07");
  assert.equal(workDateOf(ist("2026-11-08", "06:30")), "2026-11-07");
  assert.equal(workDateOf(ist("2026-11-08", "20:59")), "2026-11-07");
});

test("goals prompt 21:00-06:30, achievements prompt 06:30-21:00, each until written or crossed", () => {
  assert.deepEqual(promptsFor(null, ist("2026-11-07", "21:00")), { plan: true, report: false });
  assert.deepEqual(promptsFor(null, ist("2026-11-08", "06:29")), { plan: true, report: false });
  assert.deepEqual(promptsFor(null, ist("2026-11-08", "06:30")), { plan: false, report: true });
  assert.deepEqual(promptsFor(null, ist("2026-11-08", "20:59")), { plan: false, report: true });
  assert.deepEqual(promptsFor({ planItems: ["a"] }, ist("2026-11-07", "23:00")), { plan: false, report: false });
  assert.deepEqual(promptsFor({ planPromptDismissedAt: new Date() }, ist("2026-11-07", "23:00")), { plan: false, report: false });
  assert.deepEqual(promptsFor({ reportItems: ["a"] }, ist("2026-11-08", "08:00")), { plan: false, report: false });
  assert.deepEqual(promptsFor({ reportPromptDismissedAt: new Date() }, ist("2026-11-08", "08:00")), { plan: false, report: false });
});

test("cleanItems trims, strips numbering/bullets, drops blanks, bounds size", () => {
  assert.deepEqual(cleanItems(["  1. File I-129 ", "- call client", "", "   ", "\u2022 review"]), ["File I-129", "call client", "review"]);
  assert.deepEqual(cleanItems("1) one\n2) two\n\n"), ["one", "two"]);
  assert.equal(cleanItems(["x".repeat(900)])[0].length, 500);
  assert.throws(() => cleanItems(Array.from({ length: 51 }, (_, i) => `p${i}`)));
  assert.throws(() => cleanItems(42));
});

test("daysFor lists the work days of a period, newest first, never after today", () => {
  const { daysFor } = require("./everyday.service");
  const now = ist("2026-11-11", "12:00"); // work day 2026-11-10 (a Tuesday)
  assert.deepEqual(daysFor("today", now), ["2026-11-10"]);
  assert.deepEqual(daysFor("this_week", now), ["2026-11-10", "2026-11-09"]);
  assert.equal(daysFor("this_month", now).length, 10);
  assert.equal(daysFor("", now).length, 180);
});

test("who sees whose EOD: super admin all (but has none), admin all but super admin, team lead TLs + CMs, everyone else only self", () => {
  const { visibleRolesFor, INTERNAL_ROLES, READER_ROLES } = require("./everyday.service");
  assert.ok(!INTERNAL_ROLES.includes("super_admin"));
  assert.ok(READER_ROLES.includes("super_admin"));
  assert.deepEqual(visibleRolesFor({ role: "super_admin" }).roles, INTERNAL_ROLES);
  assert.ok(!visibleRolesFor({ role: "admin" }).roles.includes("super_admin"));
  assert.ok(visibleRolesFor({ role: "admin" }).roles.includes("admin"));
  assert.deepEqual(visibleRolesFor({ role: "team_lead" }).roles, ["team_lead", "case_manager"]);
  assert.equal(visibleRolesFor({ role: "case_manager" }).selfOnly, true);
  assert.equal(visibleRolesFor({ role: "finance" }).selfOnly, true);
});
