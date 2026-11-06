# Case Managers page: team leads, completed cases, reviews, weekly review e-mail (2026-11-06)

All additive and fail-safe. Existing endpoints keep their shape; every new job / notification logs a failure instead of throwing.

## What changed

### 1. Team leads on the Case Managers page
- `GET /case-managers` lists case managers **and** team leads (`role` is on each row; the UI shows a grey "Team Lead" tag). The headline totals stay the case managers' own (a case counted for both its case manager and its team lead is never added twice); `stats.totalTeamLeads` is new.
- A team lead's cases = cases they lead (`assignedTeamLead`) or hold as case manager (`teamLeadMatch` in `caseManagerAccess.js`). A case manager's matching is exactly as before (`caseManagerMatch`).
- Details page, assigned cases, activities, payments, analytics and the analytics panel all work for a team lead (`asTeamLead` option of `buildPanel`). Admins / super admins also see team leads in the panel's per-person view; a team lead sees their team's case managers and themselves.
- The Performance (reviews) tab is hidden for team leads: reviews are for case managers.

### 2. Assigned cases table
- Loading spinner until the list arrives, then "No cases are assigned yet." if empty (it used to be blank while loading).
- Highlighted cell = the person's **name (bold), e-mail, and visa type (chip)**; the case number is a small secondary column.
- One row per person: an employer matter itself has no row (its employees each have one), a family case is one row, a single-party case is one row. An employee not invited yet shows the name / e-mail entered for them.
- The stage column shows the real GoHighLevel stage name (`pipelineStage`) when the case has one.

### 3. Completed / closed / on hold / active come from the GoHighLevel stage
One rule, read live from each case's `integrations.ghl.unifiedStageKey` (constants in `caseManagerAccess.js`):
- **Completed / Closed** = stage **Submitted (FedEx)**, **Receipt Tracking**, **Approved**, **Disapproved** or **Feedback** (`COMPLETED_STAGE_KEYS`); **RFE stays active**.
- **On Hold** = the On Hold stage (any stage key containing "hold").
- **Active** = a case manager is assigned and it is neither closed nor on hold.
- Used by: the Case Managers list ("Completed", completion rate, active), the details stats, the case manager analytics tab and the weekly "cases completed" figure, **and the Admin dashboard cards** (Active Cases, On Hold, Closed Cases come from `/analytics/dashboard`: new `onHoldCases`).
- "Avg Processing" on the details page is computed (average days from creation to last update of the person's completed cases) instead of a fixed 0.
- Not changed: Cases Tracked, Pending Payments, Total Revenue (already from the database), the analytics panel's own approved/denied outcome figures, and the status-based figures of other pages.
- Owner decision 2026-11-06: RFE cases are active; Feedback and Receipt Tracking cases are closed.

### 4. Reviews
- Everyone who may open the page (the case manager, admins, super admins, the team lead of the case manager's team) sees every review **separately**: "Admin · name 3/5", "Team Lead · name 4/5 + paragraph".
- A new "Overall performance" block at the top = the average of **all** reviews ever given (one decimal), recalculated from the stored reviews on every read, refreshed live (socket event `rating:updated` to the case manager) and every 30 seconds.
- Raters, one rating per rater per week (re-rating replaces), 1-5 stars and an optional paragraph: unchanged.
- When someone reviews / updates a review, the case manager gets an e-mail + in-app + browser notification ("You received feedback on your performance").

### 5. Weekly review e-mail (Saturday 5:30 AM IST)
- Every **Saturday from 5:30 AM IST**: **one** e-mail (plus the bell and browser notification) to each team lead, admin and super admin: "Review your case managers' week", with one Sign-in button. Blocked addresses are skipped by the e-mail service as always.
- **Strictly once per person per week:** the week has one record and each person is marked on it (atomically) *before* they are notified, so a backend restart, a second instance or a repeated tick never sends a second copy. If a send fails, that person's mark is taken back so the next 5-minute tick retries only them.
- (2026-11-06 fix) The first version relied on a unique index that was never created, so each backend restart re-sent the reminder (3 times that Friday). The index is now created by the job itself, the duplicate run records were merged, and the per-person mark makes a repeat impossible even without it.
- `WEEKLY_REVIEW_EMAILS=false` turns off the weekly reminder **and** the "you received a review" notification.

## Production
- Restart the backend (new job, new notification types, new e-mail templates).
- New env var (optional): `WEEKLY_REVIEW_EMAILS=false` switches off the weekly e-mail **and** the "you received a review" e-mail/notification. Default on.
- Rebuild and deploy **Admin**. Nothing else changes in Client, Landing or Attorney.
- No data migration.

## Files
Backend: `caseManagerAccess.js`, `case-manager.controller.js`, `case-manager-analytics.service.js`, `case-manager-rating.service.js`, `weekly-review-reminder.service.js` (new), `models/WeeklyReviewRun.js` (new), `templates/weekly-review-reminder.js` and `performance-review-received.js` (new), `email.service.js`, `emailTriggers.registry.js`, `notification.constants.js`, `notificationRules.js`, `server.js`, `tests/caseManagerPage.test.js` (new).
Admin: `CaseManagers.jsx`, `CaseManagerDetails.jsx`, `CaseManagerPerformance.jsx`.

## Not verified
Not clicked through in a browser; the Friday job was checked with its clock function only (it was not run against the database).
