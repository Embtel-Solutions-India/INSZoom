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

test("the Friday review e-mail is due from 5:30 AM IST on Friday, and only then", () => {
  assert.equal(dueWeekKey(new Date("2026-11-06T00:00:00Z")), "2026-11-06"); // Friday 05:30 IST
  assert.equal(dueWeekKey(new Date("2026-11-05T23:59:00Z")), ""); // 05:29 IST
  assert.equal(dueWeekKey(new Date("2026-11-05T12:00:00Z")), ""); // Thursday
  assert.equal(dueWeekKey(new Date("2026-11-07T00:10:00Z")), ""); // Saturday IST
});
