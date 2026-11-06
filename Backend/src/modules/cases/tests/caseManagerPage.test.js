// Case Managers page (2026-11-06): completed / closed = GoHighLevel stage Submitted (FedEx), Approved or Disapproved; team lead matching; Friday review clock. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isCompletedCase, completedCaseMatch, teamLeadMatch, caseManagerMatch, COMPLETED_STAGE_KEYS } = require("../caseManagerAccess");
const { dueWeekKey } = require("../weekly-review-reminder.service");

test("a case is completed / closed when its GoHighLevel stage is Submitted (FedEx), Approved or Disapproved, never by status alone", () => {
  assert.equal(isCompletedCase({ integrations: { ghl: { unifiedStageKey: "submitted_fedex" } } }), true);
  assert.equal(isCompletedCase({ integrations: { ghl: { unifiedStageKey: "status_approved" } } }), true);
  assert.equal(isCompletedCase({ integrations: { ghl: { unifiedStageKey: "status_disapproved" } } }), true);
  assert.equal(isCompletedCase({ integrations: { ghl: { unifiedStageKey: "receipt_tracking" } } }), true);
  assert.equal(isCompletedCase({ integrations: { ghl: { unifiedStageKey: "feedback" } } }), true);
  assert.equal(isCompletedCase({ integrations: { ghl: { unifiedStageKey: "rfe" } } }), false); // RFE is still active work
  assert.equal(isCompletedCase({ integrations: { ghl: { unifiedStageKey: "documents_review" } } }), false);
  assert.equal(isCompletedCase({ status: "completed" }), false);
  assert.deepEqual(completedCaseMatch(), { "integrations.ghl.unifiedStageKey": { $in: COMPLETED_STAGE_KEYS } });
});

test("a team lead's cases include the ones they lead; a case manager's match is unchanged", () => {
  assert.deepEqual(caseManagerMatch("x"), { $or: [{ assignedCaseManager: "x" }, { additionalCaseManagers: "x" }] });
  assert.ok(teamLeadMatch("x").$or.some((clause) => clause.assignedTeamLead === "x"));
});

test("the weekly review e-mail is due from 5:30 AM IST on Saturday, and only then", () => {
  assert.equal(dueWeekKey(new Date("2026-11-07T00:00:00Z")), "2026-11-07"); // Saturday 05:30 IST
  assert.equal(dueWeekKey(new Date("2026-11-06T23:59:00Z")), ""); // Saturday 05:29 IST
  assert.equal(dueWeekKey(new Date("2026-11-06T12:00:00Z")), ""); // Friday
  assert.equal(dueWeekKey(new Date("2026-11-08T00:10:00Z")), ""); // Sunday IST
  assert.equal(dueWeekKey(new Date("2026-11-07T18:00:00Z")), "2026-11-07"); // still Saturday evening IST? 23:30 IST: yes
  assert.equal(dueWeekKey(new Date("2026-11-07T19:00:00Z")), ""); // 00:30 IST Sunday
});

test("the details endpoint answers for a case manager and for a team lead, with live payment figures (regression: a missing variable once broke the page)", async (t) => {
  const User = require("../../../models/User");
  const Case = require("../../../models/Case");
  const Task = require("../../../models/Task");
  const caseService = require("../case.service");
  const finance = require("../../finance/caseFinance.service");
  const controller = require("../case-manager.controller");
  const filed = { _id: "c1", status: "active", integrations: { ghl: { unifiedStageKey: "submitted_fedex" } }, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-11") };
  const working = { _id: "c2", status: "active", integrations: { ghl: { unifiedStageKey: "docs_received" } }, createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-02") };
  const chain = (rows) => ({ sort() { return this; }, limit() { return this; }, then: (resolve) => resolve(rows) });
  t.mock.method(Case, "find", () => chain([filed, working]));
  t.mock.method(Task, "find", () => chain([]));
  t.mock.method(caseService, "populateCaseQuery", async (query) => query);
  t.mock.method(finance, "totals", async () => ({ total: 10100, uscisFees: 50, revenue: 90, outstanding: 10010, refunded: 0, count: 2 }));
  for (const role of ["case_manager", "team_lead"]) {
    t.mock.method(User, "findById", () => ({ select: async () => ({ _id: "u1", role, name: "Person" }) }));
    let body;
    let failure;
    await controller.getCaseManagerDetails({ params: { id: "u1" }, user: { _id: "a", role: "admin" } }, { status() { return this; }, json(value) { body = value; } }, (error) => { failure = error; });
    assert.equal(failure, undefined, `${role}: ${failure && failure.message}`);
    assert.equal(body.stats.completedCases, 1, "completed = GoHighLevel stage Submitted (FedEx) or later");
    assert.equal(body.stats.activeCases, 1);
    assert.equal(body.stats.totalRevenue, 10100, "US dollars, from the GoHighLevel figures");
    assert.equal(body.stats.collectedRevenue, 90);
    assert.equal(body.stats.uscisFees, 50);
    assert.equal(body.stats.avgProcessingTime, 10, "average days from creation to the last update of the completed cases");
  }
});

test("the weekly reminder reaches each person ONCE, however many times the job runs (restarts, repeated ticks)", async (t) => {
  const WeeklyReviewRun = require("../../../models/WeeklyReviewRun");
  const User = require("../../../models/User");
  const notificationService = require("../../notifications/notification.service");
  const reminder = require("../weekly-review-reminder.service");
  reminder._markGuardReady();
  // an in-memory stand-in for the week's single record: updateOne with { notified: { $ne: id } } + $addToSet / $pull, like MongoDB
  const week = { notified: new Set(), recipients: 0 };
  t.mock.method(WeeklyReviewRun, "updateOne", async (filter, update) => {
    if (update.$setOnInsert) return { modifiedCount: 0 };
    if (update.$addToSet) {
      const id = String(update.$addToSet.notified);
      if (week.notified.has(id)) return { modifiedCount: 0 };
      week.notified.add(id);
      return { modifiedCount: 1 };
    }
    if (update.$pull) { week.notified.delete(String(update.$pull.notified)); return { modifiedCount: 1 }; }
    return { modifiedCount: 0 };
  });
  t.mock.method(User, "find", () => ({ select: () => ({ lean: async () => [{ _id: "u1", email: "a@x.com", name: "A" }, { _id: "u2", email: "b@x.com", name: "B" }] }) }));
  const sent = [];
  t.mock.method(notificationService, "createNotification", async (payload) => { sent.push(String(payload.userId)); });
  const saturday = new Date("2026-11-07T01:00:00Z");
  for (let run = 0; run < 4; run += 1) await reminder.sendWeeklyReviewReminders(saturday);
  assert.deepEqual(sent.sort(), ["u1", "u2"], "two people, one notification each, after four runs");
  assert.equal((await reminder.sendWeeklyReviewReminders(new Date("2026-11-06T09:00:00Z"))).skipped, "not_due", "nothing on a Friday");

  // a failed send takes the mark back so that person is retried (and only that person)
  week.notified.clear(); sent.length = 0;
  let first = true;
  notificationService.createNotification.mock.mockImplementation(async (payload) => { if (first && payload.userId === "u1") { first = false; throw new Error("boom"); } sent.push(String(payload.userId)); });
  await reminder.sendWeeklyReviewReminders(saturday);
  await reminder.sendWeeklyReviewReminders(saturday);
  assert.deepEqual(sent.sort(), ["u1", "u2"]);
});
