# Multiple Case Managers per Case - Completion Report

## What changed

A case keeps `assignedCaseManager` as the **primary** case manager (the only one a client ever sees) and gains
`additionalCaseManagers: [User]`. Every case manager in `[primary, ...additional]` has identical access to the case,
receives the same notifications, and is counted in reports.

Single source of truth for "who is a case manager of this case": `Backend/src/modules/cases/caseManagerAccess.js`.

## Backend

New files
- `modules/cases/caseManagerAccess.js` - helpers (`allCaseManagerIds`, `isCaseManagerOfCase`, `caseManagerMatch`, ...).
- `modules/cases/case-managers.service.js` - add / remove / promote / child-cascade data operations.
- `modules/cases/case-managers.controller.js` - HTTP, email/notification, messaging sync and realtime.
- `modules/cases/tests/case-managers.test.js` - 11 DB-free tests.

New endpoints (admin, super admin, team lead only; `cases:assign` permission)
- `POST /cases/:id/case-managers` `{ caseManagerId }` - adds; only `case_manager`-role active users; duplicates and the primary rejected.
  Emails the new case manager ("you have been assigned") through the existing `notifyAssignee` path.
- `DELETE /cases/:id/case-managers/:userId` - removes an additional case manager (the primary is changed through the existing assign flow).
- Both write timeline, audit log, assignment history, cascade to non-overridden child cases, and push a `case:team_updated` socket event.

Access / lists (primary OR additional): `canAccessCase`, case list filter, "cases of case manager X" filter, client and
beneficiary lists, intake edit permission, dashboards, search, user performance, EOD reports.

Fan-out to every case manager (was primary only): client-submission, intake-submission, family/employment submissions,
event notifications (`resolveCaseBoundUsers`), payments, attorney feedback, SLA breach, date reminders, lifecycle
notifications, PDF/form review notifications, checklist-change broadcast, email audience, live `case:updated` pushes.

Messaging: all case managers join the case conversation (`messageRouting`, `message.service`). The primary stays the
conversation owner.

Reports (counted for every case manager on a case): team-lead workload, case-manager analytics/revenue, ratings,
leaderboard.

Limited `.select()` lists that feed `canAccessCase` now include `additionalCaseManagers` (messages, feedback, form
readiness/mapping controllers, notifications, payments, SLA, checklist broadcast, document populate) - otherwise an
additional case manager would have been silently denied.

Client privacy: `serializeCaseForUser` strips `additionalCaseManagers` for client/user/employee/beneficiary roles.

Deleting a user who is an additional case manager on a case is blocked, same as the primary.

## Admin UI

`CRMCaseDetail.jsx` Edit Staff popup now lists team lead, primary case manager, additional case managers and attorneys.
Admins/team leads get an **Add Case Manager** dropdown (active case managers not already on the case) and a **Remove**
button per additional case manager. The case page refreshes quietly on `case:updated` / `case:team_updated`; the case list
refreshes on `case:unassigned` / `case:team_updated`.

## Not changed on purpose
- Workflow-engine / task auto-assignment, AI suggestions, appointment owner, RFE owner: still follow the primary.
- Passport-expiry reminders (Beneficiary-record level) and the Save-progress email (`progress-saved`): primary only.
- Existing cases: field starts empty; behaviour identical until someone is added.

## Verification
- `node --test src/modules/cases/tests/case-managers.test.js` - 11/11 pass (DB-free).
- 85 existing test files in the touched modules re-run: 658 of 659 pass. The one failure is
  `questionnaires/tests/o1b-e2e.test.js` ("O-1B: createCase -> ..."), which is NOT DB-free: it connects to the real database
  inside the test body and creates/deletes its own `ZZ-TMP-O1B-*` records. It was run by mistake (the DB-free filter missed
  its lazy `config/database` require). It cleaned up after itself (verified: no `ZZ-TMP`/`e2e-audit.invalid` cases or users
  remain). Whether the failure is related to this change is NOT yet determined - the failure detail was not captured.
- Admin `npm run build` passes.
- No deliberate live case was created. If a live check is wanted: ONE test case only, deleted afterwards.

---

# Information requests: "Received" instead of "Open"

Admin's "Request information" panel (`InformationRequestPanel.jsx`).

- A request the client has answered now reads **Received** (stored as `submitted`; only the label changed) and is green.
- Free-text requests ("Current U.S. Address", "Copy of Educational Credential Evaluation Report") are matched to the questions on the
  recipient's own checklist (`information-requests/request-fulfilment.js`). If every item the request names has an answer or an uploaded
  file there, the request becomes Received (`fulfilledBy: "checklist"`) and drops off the client's "Requested by your case manager" list.
  An item that cannot be matched keeps the request open. If the answer is later removed, the request reopens.
- Runs after every answer save on a case that has such requests (not awaited) and when the panel lists requests. Pushes
  `case:checklists_changed` / `case:updated` to the client and every case manager, so both portals update live.
- Admin shows "Already provided in the client's checklist: <question>" with the answer/files, openable.
- Role mapping: petitioner = employer, beneficiary = employee.
- Files uploaded on a request row, or on the matching checklist question, already create Document records, so they appear in Uploaded Documents.
