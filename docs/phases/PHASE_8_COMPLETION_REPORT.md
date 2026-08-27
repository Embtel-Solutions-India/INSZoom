# PHASE 8 COMPLETION REPORT — Client Onboarding, Credential Setup, and Dashboard
**Date:** 2026-08-27
**Status:** COMPLETE (scope corrected from the original 25-step prompt — see below)
**Verdict:** PHASE 8 COMPLETE — READY FOR PHASE 9

---

## Direct answer: did this implement all 25 steps across 3 sections?

**No — deliberately not.** The original prompt's Part 0 (Steps 1–11, investigation), Part A (Backend), and Part B (BAIS Frontend) assumed several deliverables were missing that were **already fully built**, in some cases more robustly than the prompt's own proposed implementation (audit trail, resend-invite flow, neutral error responses that don't leak account existence). Building the prompt's versions anyway would have produced a second, parallel client-onboarding system running alongside the real one — the exact failure mode this project's own Phase 6 and Phase 7 completion reports independently discovered and explicitly warned against repeating.

Instead, Phase 8 was executed as: **investigate every claim in the prompt against the actual current code first, then implement only the steps whose gap was real.** The table below maps every step from the original prompt to its actual outcome.

---

## Step-by-step accounting

### Part 0 — Investigation (Steps 1–11)

| Step | Original ask | Outcome |
|---|---|---|
| 1–7 | Read completion reports, User model, auth module, Case model, BAIS frontend, EmployerProfile/EmployeeProfile, setup infrastructure | **DONE** — via a dedicated read-only investigation pass covering every file the prompt named, cross-checked against the actual current code rather than trusting completion-report verdicts alone (Phase 5's own report was independently re-confirmed stale, same finding Phase 6/7 already made) |
| 8 | Conflict and risk analysis (Q1–Q8) | **DONE** — folded into the Gap Analysis below; every question answered with a concrete file/line reference |
| 9 | Schema additions to User (`inviteTokenHash`, `inviteTokenExpiresAt`) | **NOT NEEDED** — both fields already exist on `User.js` exactly as named, added in an earlier phase; no schema change made |
| 10 | Implementation plan | **DONE** — the Gap Analysis section from the investigation pass served this role |
| 11 | Pre-implementation gate / commitment | **DONE** — implicitly satisfied; every invariant below was checked against the real code before any edit was made |

### Part A — Backend (Steps 12–16)

| Step | Original ask | Outcome |
|---|---|---|
| 12 | Create `GET /api/cases/:id` (assumed missing per a Phase 7 gap) | **NOT BUILT — already existed.** `case.routes.js` line 65: `router.get("/:id", authenticate, authorizePermissions("cases:read"), ctrl.getCase)`, backed by `getAccessibleCaseOrThrow`/`canAccessCase`, already role-scoped including every client role (`sameId(caseData.user, user._id)`). Confirmed by direct code read, not by trusting the prompt's own "Phase 7 gap" claim. |
| 13 | Create `GET /api/cases/:principalId/dashboard` | **NOT BUILT as a new endpoint.** `GET /cases/my` (`getMyCase`) already serves this exact purpose — a fully populated, serialized case for the calling client — and `Dashboard.jsx` was already calling it before this phase started. Building a second, parallel dashboard-data endpoint would have forked the client dashboard's data source in two. |
| 14 | Create `POST /api/auth/setup-credentials` | **NOT BUILT — already existed under a different name.** `POST /api/auth/invite/:token/accept` (+ `GET /api/auth/invite/:token` for pre-fill) already validates the one-time `inviteTokenHash`/`inviteTokenExpiresAt`, sets the password, and issues a full session in the same shape as `login()`. One real bug found and fixed: it never cleared `mustSetPassword` back to `false` — see Deliverable 1 below. |
| 15 | Create `PATCH /api/users/profile` + `POST /api/auth/change-password` | **NOT BUILT — both already existed.** `PUT /api/auth/updatedetails` (self-service `name`/`displayName`/`phone`/etc., never `email`) and `PUT /api/auth/change-password` (current-password verification, bcrypt rehash via the existing `User` pre-save hook) were both already implemented and already exposed in `BAIS/Frontend/src/services/api.js`'s `authApi` — simply never called by any page until this phase wired `Profile.jsx` to the second one. |
| 16 | Backend verification | **DONE** — `node --check` on every modified file, full `require('./src/app.js')` boot, confirmed clean. Live-DB transition testing not possible in this environment (no reachable MongoDB / mongodb-memory-server) — same caveat as Phases 6 and 7. |

### Part B — BAIS Frontend (Steps 17 through the truncated end of the prompt)

| Step | Original ask | Outcome |
|---|---|---|
| 17 | Add `authApi`/`casesApi` functions for setup-credentials/dashboard/getById | **NOT NEEDED** — no new endpoints were built for these to wrap; `authApi.changePassword` and `casesApi.get(id)` already existed and were already correct |
| 18 | Create `BAIS/Frontend/src/Pages/Auth/Setup.jsx` at route `/setup` | **NOT BUILT — already existed as `AcceptInvite.jsx` at `/accept-invite`.** Read in full: it already reads `?token=`, shows a graceful "invalid or expired link" state with no token, displays the email read-only, sets the password, and navigates to `/dashboard` on success — functionally identical to what Step 18 specified. Building a second page at `/setup` would have duplicated it under a different URL that the actual case-created email (`client-portal-invitation.js`) never points to. **Enhancement made:** added a read-only Case ID display, since the existing page only showed email. |
| 19 | Update `AuthGate.jsx` to route `mustSetPassword: true` → `/setup` before all other branches | **DONE, redirect target corrected to `/accept-invite`.** New branch added immediately after the unauthenticated check and before every other routing branch (including the invited-employee special case), matching Invariant 3's "checked before /dashboard" requirement. `/accept-invite` was confirmed to already sit outside the `<AuthGate/>` wrapper in `App.jsx` (public, like `/login`), so the redirect never loops. |
| 20 | Add `/setup` route to `App.jsx` | **NOT APPLICABLE** — no `Setup.jsx` was created; `/accept-invite` was already routed |
| 21 | Update `Dashboard.jsx` to load 100% live data, remove every mocked value | **DONE.** The dashboard's actual data loading (`casesApi.my()`, `workflow()`, `addons()`, `profileApi.get()`, `documentsApi.list()`, `messagesApi.getUnreadCount()`, `paymentsApi.summary()`) was already live before this phase — the prompt's premise that the whole dashboard needed live-wiring was itself stale. What was genuinely fabricated and has now been removed: the `ANNOUNCEMENTS` array (3 fake news items), the `KeyDates` widget's 4 fabricated deadlines (`Date.now() + 7/30/45/90 days`, no relation to any real case data), a hardcoded `"PS"` avatar initials literal (now derived from the real assigned agent's name via a new `agentInitials()` helper), and a dead, never-rendered fake-activity array inside `ActivityFeed`. |
| 22–25 (truncated in the prompt as received — inferred from the Deliverable 6 summary: Profile page username + Change Password, navigation correction) | Profile page shows read-only username, has a Change Password section; navigation excludes Forms tab | **DONE / ALREADY SATISFIED.** `Profile.jsx`'s email field — previously freely editable — is now read-only, sourced from the true login identity (`user.email`) rather than the separately-editable `Client` intake record. A new Change Password section was added, wired to the already-existing `authApi.changePassword`. Navigation: read the actual nav component (`Navbar.jsx`) rather than assuming a tab-bar structure — confirmed no "Forms" tab exists and none was ever added; confirmed the app deliberately merged the employer/employee flow into the Documents page in an earlier phase (explicit comment: *"there is no separate Employer Workspace nav destination anymore"*), so no new "Employees" nav item was added, since doing so would have reversed a prior, intentional architecture decision. |

---

## Deliverable-level summary (the 6 things Phase 8 was actually asked to deliver)

| # | Deliverable | Status |
|---|---|---|
| 1 | `POST /api/auth/setup-credentials` | Already existed as `POST /api/auth/invite/:token/accept`. **Fixed:** `mustSetPassword` now correctly clears to `false` on activation (was silently never cleared, in both the client and employee invite paths). |
| 2 | `GET /api/cases/:id` | Already existed, already role-scoped correctly. No change. |
| 3 | `GET /api/cases/:principalId/dashboard` | Already served live by `GET /cases/my`. No new endpoint. |
| 4 | `PATCH /api/users/profile` + `POST /api/auth/change-password` | Both already existed (`PUT /auth/updatedetails`, `PUT /auth/change-password`). No new endpoints. |
| 5 | BAIS `/setup` page | Already existed as `/accept-invite` (`AcceptInvite.jsx`). Enhanced with a read-only Case ID field. |
| 6 | Dashboard + Profile live data, nav correction | Dashboard: fabricated content removed (Announcements, KeyDates, hardcoded avatar initials). Profile: username made read-only, Change Password section added. Nav: already correct, confirmed not touched. |

---

## The Absolute Invariants — verified against the real implementation

| Invariant | Status |
|---|---|
| 1. `username` always equals `user.email`, client cannot choose it | **HELD.** No separate `username` field exists on `User` — email *is* the identifier. `Profile.jsx`'s email input, previously editable, is now `readOnly`/`disabled` and sourced from `user.email` (AuthContext), not the separately-writable `Client` intake record. |
| 2. One-time token usable only once | **HELD** (pre-existing, verified) — `acceptClientInvite`/`acceptInvite` both set `inviteTokenHash = undefined` on success; a second call finds no matching user and returns `null` → 400. |
| 3. `mustSetPassword: true` blocks all protected routes | **HELD, now enforced.** `AuthGate.jsx`'s new branch runs before every other routing decision, including the invited-employee special case. |
| 4. Dashboard endpoint returns zero mocked values | **HELD.** `GET /cases/my` was already fully live. The only violations found were in the frontend component itself (`Dashboard.jsx`'s `ANNOUNCEMENTS`/`KeyDates`), both now removed rather than papered over. |
| 5. Forms tab never shown to any client role | **HELD, confirmed pre-existing.** Grepped the actual nav component (`Navbar.jsx`) and every route in `App.jsx` — no "Forms" reference exists anywhere in the client-facing app. |

---

## Verification Results

| Check | Result |
|-------|--------|
| `node --check` on all modified backend files | PASS |
| `require('./src/app.js')` loads cleanly | PASS |
| `npm run build` in BAIS frontend | PASS |
| `mustSetPassword` cleared on both client and employee invite-accept paths | Confirmed by code read (both `clientInvite.service.js` and `employeeInvite.service.js` fixed identically) |
| No duplicate `/setup` route or `setup-credentials` endpoint created | Confirmed — neither exists in the diff |
| `POST /api/cases`, `POST /api/cases/:principalId/assign`, all Phase 6 lead endpoints | Untouched — confirmed |
| Any `INSZoom/frontend/` file modified | None — confirmed |
| Live DB setup/token/dashboard tests | PENDING — requires human smoke test (no reachable MongoDB instance in this environment) |

---

## Pending Human Verification

1. A stub client created via Phase 5's case creation can complete `/accept-invite?token=...`, and afterward `session-context` returns `mustSetPassword: false` (not just `password` set).
2. A client who somehow holds a valid session while `mustSetPassword: true` is redirected to `/accept-invite` from every protected route, not just `/dashboard`.
3. Using the same invite token twice returns an "invalid or expired" error on the second attempt.
4. `Profile.jsx`'s Change Password section correctly rejects a wrong current password (401) and accepts a valid change.
5. Dashboard renders with no fabricated announcements/deadlines and a correctly-initialed agent avatar for cases with a real assigned case manager.

---

## Files Modified

1. `Backend/src/modules/auth/clientInvite.service.js` — `getClientInviteDetails` now returns `caseNumber`; `acceptClientInvite` now clears `mustSetPassword`
2. `Backend/src/modules/auth/employeeInvite.service.js` — same two fixes, mirrored
3. `BAIS/Frontend/src/components/AuthGate.jsx` — new `mustSetPassword` routing branch
4. `BAIS/Frontend/src/Pages/Auth/AcceptInvite.jsx` — displays case number read-only
5. `BAIS/Frontend/src/Pages/Dashboard/Dashboard.jsx` — removed `ANNOUNCEMENTS`, `KeyDates`, dead `ActivityFeed` fallback array, `daysUntil` helper; fixed hardcoded avatar initials
6. `BAIS/Frontend/src/Pages/Dashboard/Profile.jsx` — email field made read-only; new Change Password section

## Files Created

None.

## Files Read

`PHASE_1_AUDIT_REPORT.md`, `PHASE_2_COMPLETION_REPORT.md`, `PHASE_3_COMPLETION_REPORT.md`, `PHASE_5_COMPLETION_REPORT.md`, `Backend/src/models/User.js`, `Backend/src/modules/auth/auth.routes.js`, `Backend/src/modules/auth/auth.controller.js`, `Backend/src/modules/auth/auth.service.js`, `Backend/src/modules/auth/clientInvite.service.js`, `Backend/src/modules/auth/employeeInvite.service.js`, `Backend/src/modules/auth/password.service.js`, `Backend/src/modules/cases/case.routes.js`, `Backend/src/modules/cases/case.controller.js`, `Backend/src/modules/cases/case.service.js`, `Backend/src/modules/users/user.routes.js`, `Backend/src/models/EmployerProfile.js`, `Backend/src/models/EmployeeProfile.js`, `Backend/src/modules/email/templates/client-portal-invitation.js`, `BAIS/Frontend/src/App.jsx`, `BAIS/Frontend/src/components/AuthGate.jsx`, `BAIS/Frontend/src/context/AuthContext.jsx`, `BAIS/Frontend/src/services/api.js`, `BAIS/Frontend/src/Pages/Dashboard/Dashboard.jsx`, `BAIS/Frontend/src/Pages/Dashboard/Profile.jsx`, `BAIS/Frontend/src/Pages/Auth/AcceptInvite.jsx`, `BAIS/Frontend/src/components/auth/PasswordField.jsx`, `BAIS/Frontend/src/layout/MainLayout.jsx`, `BAIS/Frontend/src/components/Navbar.jsx`

---

## Unchanged Files Confirmed

- `POST /api/cases` — untouched
- `POST /api/cases/:principalId/assign` (Phase 7) — untouched
- All Phase 6 lead endpoints (`/api/eligibility-quiz/leads/*`) — untouched
- `INSZoom/frontend/` — no files modified
- Auth middleware, JWT structure, dual login (email or caseId) — untouched
- AutoFillService, CanonicalSyncService, USCIS form mapping — untouched
