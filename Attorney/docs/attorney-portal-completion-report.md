# Attorney Portal — Completion Report

Built 2026-09-17 against the real backend, the real MongoDB cluster, and a
real browser. Companion documents:
`attorney-portal/PHASE0_FINDINGS.md` (reconnaissance, and the corrections it
forced to the implementation prompt's assumptions) and
`attorney-portal/docs/attorney-portal-setup.md` (manual configuration).

## 1. What was built

### Backend (all in `Backend/src/`)

| Area | Files | Notes |
|---|---|---|
| Role | `modules/authorization/roleHierarchy.js` | `attorney` added to `CANONICAL_ROLES` + `ROLE_HIERARCHY` (rank 4, peer to client/employee — no authority over other accounts). |
| Permissions | `modules/authorization/permissions.registry.js` | New `feedback` resource; scoped `attorney` grant set (reads only, plus `feedback:*`); `feedback:*` also granted to admin/team_lead/case_manager. |
| Case access | `models/Case.js` | New `attorneyAccess[]` sub-array (`attorneyId, assignedBy, assignedAt, status, revokedAt`), deliberately distinct from the pre-existing `assignedAttorney` (forms/G-28 attorney-of-record). |
| Authorization | `modules/cases/case.service.js` | `hasActiveAttorneyAccess()` + an `attorney` branch in **both** `canAccessCase()` and `applyCaseRoleFilter()` — one definition of access shared by detail reads, list queries, and every reused controller. |
| Guard | `middleware/requireAttorneyAccess.js` | Per-case grant check for the attorney namespace; returns the same 403 for "not granted" and "doesn't exist" so case IDs can't be probed. |
| Feedback | `models/Feedback.js`, `modules/feedback/feedback.service.js`, `modules/feedback/feedback.controller.js` | New model (none existed — see findings §3). Threading via `parentFeedbackId`, per-user `readBy[]`, recipient resolution (attorney → assigned CM, staff → active attorneys, reply → original author). |
| Attorney API | `modules/attorney/attorney.routes.js`, `attorney.controller.js` | `GET /api/attorney/{dashboard,cases,cases/:caseId}` + the feedback endpoints. |
| Access grants | `modules/attorney/attorneyAccess.service.js` | Grant/revoke with audit-log + assignment email; re-granting a revoked attorney reuses the entry rather than stacking duplicates. |
| Staff endpoints | `modules/cases/case.routes.js` | `GET/PATCH /api/cases/:caseId/attorney-access` + the staff side of the feedback thread. |
| Email | `modules/email/templates/attorney-assignment.js` + registration in `email.service.js` | Sent on grant; a send failure logs and never rolls back the grant. |
| Notifications | `modules/notifications/notification.constants.js` | New `attorney_feedback` / `attorney_access_granted` types. In-app **and** push both go through the existing `createNotification()` — `push.service.js` is never called directly, per its own single-call-site contract. |
| Reused-route access | `modules/documents/document.routes.js`, `modules/questionnaires/questionnaire.routes.js`, `modules/users/user.service.js` | `attorney` added to two role allow-lists (found by a failing browser test, §4); team-lead `teamId` scoping skipped when listing attorneys. |

### Attorney Portal frontend (`attorney-portal/`, port 5174)

Standalone Vite/React app: `auth/` (login, SSO handler, role guard,
context), `layout/AppLayout`, `pages/Dashboard`, `pages/Cases/CaseListPage`,
`pages/Cases/CaseDetail/` (Overview, Documents, Forms, Questionnaire,
Feedback, Timeline tabs), `components/` (NotificationBell,
CaseStatusBadge), `hooks/usePushNotifications`, `services/api.js` +
`notificationService.js`, `public/firebase-messaging-sw.js`.

### INSZoom + Immiglance changes (minimal, additive)

- `INSZoom/frontend/src/components/AttorneyAccessPanel.jsx` — new
  self-contained card, dropped into `CRMCaseDetail.jsx` beside "Assigned
  Staff" (two-line diff there: one import, one element).
- `Immiglance/Frontend/src/components/AuthGate.jsx` — new `isAttorney`
  branch mirroring the existing `isStaff` redirect, handing the token to the
  portal's `/auth/sso`.
- `Immiglance/Frontend/src/Pages/Auth/Login.jsx` — the "coming soon"
  placeholder replaced with a real link to the portal.

## 2. Verification — what was actually observed

### Backend API suite: 31/31 (`node src/scripts/verifyAttorneyPortal.js`)

Runs against the live server, asserts on real response bodies **and** real
database state, then cleans up after itself. Highlights:

- 403 → (grant) → 200 → (revoke) → 403 transitions on the same case, proving
  the grant is what changes the outcome rather than a static rule.
- Ungranted case is 403 on **both** `/api/attorney/cases/:id` and the
  generic `/api/cases/:id` — i.e. `canAccessCase` itself is attorney-aware,
  not just the new middleware.
- A **different** attorney is denied a case granted to the first one, and it
  is absent from their list.
- `EmailLog` row written with `status=sent`; `AuditLog` row with
  `attorney_access_granted`; notification row with
  `link=/cases/:id/feedback`.
- Unread accounting: the author's own message does not count against them;
  the reply does; `mark-read` clears it.
- Revoked grants are retained with `status=revoked` + `revokedAt` rather
  than deleted.

### Browser suite: 5/5 (`INSZoom/frontend/e2e/attorney-portal.spec.js`)

Real Chromium, all three origins:

- **S7** a case manager signing in at the portal gets "this portal is for
  attorneys only" and never reaches the app shell.
- **S2** attorney signs in → dashboard with real counts → case list → case
  detail rendering real case data.
- **S3** navigating to an ungranted case shows an access-denied state, the
  API is confirmed to have returned 403, and no case data appears in the page.
- **S4/S5** attorney sends feedback in the browser → the staff endpoint
  returns the same message with `authorRole: attorney` → case manager
  replies → the attorney sees the reply after reload.
- **S8** Documents and USCIS Forms tabs load (empty-state for a fresh case,
  which is the correct real result).

### Regression

- Existing INSZoom settings e2e suite: 5/5 pass.
- `node --test` authorization tests: 5/5. Case module tests: 36/36.
- INSZoom and Immiglance both `vite build` clean.

## 3. Bugs found and fixed during verification

1. **Reused document/questionnaire routes rejected attorneys.** The browser
   test surfaced "User role attorney is not authorized to access this route"
   on the Documents tab: those routes gate on a role allow-list *in addition*
   to permissions, and `attorney` wasn't in it. Fixed by adding it to
   `allDocumentRoles` and `readerRoles` — after first confirming that both
   paths scope per-case through `canAccessCase`
   (`document.service.js:buildDocumentFilter`/`canAccessDocument`,
   `uscis-form.service.js:getAccessibleCase`), so widening the role gate does
   not widen data access.
2. **Attorney case list would have returned nothing.** `applyCaseRoleFilter`
   had no attorney branch, so attorneys fell through to the generic client
   filter. Fixed at the shared function rather than only in the new endpoint,
   so every list surface is consistent.
3. **Team leads would have seen an empty attorney dropdown** —
   `getAssignableUsers` scopes to `teamId` for team leads, and attorneys have
   none. Fixed narrowly (skip that scoping only when listing attorneys).
4. **Two test defects of my own**, both fixed: the two attorney fixtures
   collided on one key (so the cross-attorney isolation check silently
   skipped — the single most important isolation assertion), and the feedback
   test asserted on on-screen text that was present before the POST completed.
5. **Corrupted `Immiglance/Frontend/.env`** by appending without a trailing
   newline; repaired in the same pass.

## 4. Deviations from the prompt, and why

Each is evidenced in `PHASE0_FINDINGS.md`:

1. **Push is Firebase Cloud Messaging, not raw Web Push.** The prompt
   specified a generic `sw.js`, a `PushSubscription` model, VAPID via
   `pushManager.subscribe()`, and `/api/push/subscribe`. None of that exists
   here. The real system is FCM (`firebase-admin`, `DeviceToken`,
   `firebase-messaging-sw.js`, `getToken`/`onMessage`,
   `/api/notifications/register-device`). Building to the literal spec would
   have created a second, non-functional push system beside the working one.
2. **No `type: 'attorney_feedback'` branch was added to the service
   worker.** The existing `onBackgroundMessage` handler is already generic
   (title/body/`data.link`); the attorney-specific part is the `link` the
   backend sets. A branch would have been dead code.
3. **No `Feedback` model existed to extend** — it was built new, rather than
   overloading `Case.internalNotes` (a different feature).
4. **The Immiglance attorney redirect is new logic, not a bug fix.** No
   attorney role existed, so nothing was "landing attorneys in the client
   portal"; the Attorney login tab was a cosmetic placeholder.
5. **`/api/attorney/cases/:caseId/{documents,forms,questionnaire,timeline}`
   were not created.** §6.5 says reuse means calling the same service, not
   copying handlers — so the portal calls the existing staff endpoints
   directly, which are already correctly authorized for attorneys via
   `canAccessCase`. Adding a parallel namespace would have been eight
   duplicate route definitions with no behavioral difference.
6. **No compound index on `attorneyAccess`.** `Case.js` is already at
   MongoDB's hard 64-index-per-collection limit (found in the immediately
   preceding MongoDB investigation, `Backend/docs/
   MONGODB_STARTUP_LOAD_FINDINGS.md` §6) — a 65th index cannot be created.
   Queries are correct but unindexed on this field. See §6 below.

## 5. Not done / out of scope of what was verified

- **Push delivery was not observed end-to-end in a browser.** The code path
  is wired and shared with the two portals that already use it, but actually
  receiving an FCM push at `localhost:5174` needs the Firebase Console step
  in the setup doc. S4/S5 were verified through the in-app notification row
  (asserted in the DB, with the correct deep link) and the browser thread —
  not through an OS-level notification banner.
- **Document upload from the portal** (`POST .../documents/upload` in §6.5)
  — the attorney has `documents:create`, but no upload UI was built; the
  Documents tab is read + download only.
- **S6 (Immiglance → portal SSO redirect) was not run in a browser.** The
  code mirrors the existing, working `isStaff` redirect and the `/auth/sso`
  handler is covered by the portal's own login path, but the full
  cross-origin hop was not exercised end-to-end.
- **S10** (settings-platform interaction) was not specifically re-tested;
  attorney API calls traverse the same `authenticate` middleware as every
  other request, so settings-driven auth behavior applies unchanged.
- Everything in the prompt's §12 Out of Scope list.

## 6. Follow-ups

1. **Add the `attorneyAccess` compound index** once `Case.js`'s index count
   is brought under 64 (tracked in `Backend/docs/
   MONGODB_STARTUP_OPTIMIZATION.md` §9). Until then the attorney case-list
   query is unindexed on that field — fine at current data volume (58 cases),
   not fine at scale.
2. **Register a dedicated Firebase Web App** for the portal instead of
   reusing INSZoom's `appId` (setup doc, step 5).
3. **Attorney document upload UI**, if the `documents:create` grant is meant
   to be exercised from this portal.
4. **Deactivate/lock handling for attorneys** follows the existing global
   user-status machinery; no attorney-specific review was done.
