# UI Functional Completeness Audit (§25) + Session/Refresh/Routing (§27, frontend) + Error Handling (§26, frontend)

**Scope:** read-only static analysis of `BAIS/Frontend` (client portal) and `INSZoom/frontend` (staff portal).
**Method:** every page and interactive control traced from its handler to the API call it actually makes; every endpoint cross-checked against `Backend/src/routes/index.js` and the module route files. No servers were started, no database was touched, no source file was modified.
**Date:** 2026-09-01. **Branch:** `refactor` @ `c86c446`.

> A control that renders is not proof it works. Every row below is traced to a concrete handler and, where one exists, a concrete endpoint.

---

## 1. Summary

### 1.1 Inventory totals

| | BAIS (client portal) | INSZoom (staff portal) | Total |
|---|---|---|---|
| Declared routes | 29 | 30 | 59 |
| Page components inventoried | 33 | 33 | 66 |
| Support components inventoried (controls-bearing) | 22 | 12 | 34 |
| Interactive controls inventoried | ~215 | ~285 | ~500 |
| Controls that make a real API call | ~78 | ~135 | ~213 |
| Controls that are navigation-only / local-state-only (by design) | ~128 | ~145 | ~273 |
| **Dead / fake / false-success controls** | **9** | **10** | **19** |
| Orphaned (unreachable) pages/routes | 4 | 0 | 4 |
| Calls to non-existent backend endpoints | 0 | 0 | 0 |
| Calls resolved to the **wrong** backend module (route collision) | 0 | 4 | 4 |

### 1.2 Headline findings

| # | Severity | Finding |
|---|---|---|
| D-01 | **Critical** | BAIS: hard refresh (F5) of any authenticated page leaves `AuthContext.user = null` forever. `verifySession()` short-circuits when there is no *in-memory* access token and never consults the `bais_has_session` marker or the refresh cookie. Navbar shows "Login / Sign Up" for a logged-in user; websockets never connect; `useHasCase()` reports `hasCase:false`. |
| D-02 | **Critical** | BAIS: `logout()` clears the session locally *before* calling `POST /auth/logout`, so the request goes out with no `Authorization` header, `authenticate` rejects it 401, and the `.catch(()=>{})` swallows it. **The server-side refresh session is never revoked and the refresh cookie is never cleared.** |
| D-03 | **High** | INSZoom: the entire **Expert Letters** tab on `CRMCaseDetail` is fake — `fetchLetters` hardcodes `[]`, `handleCreateLetter` only closes the modal. No backend resource exists. |
| D-04 | **High** | ISSUE-007 (auth refresh session-rotation race) is **still fully present**. None of the three proposed fixes were applied. |
| D-46 | **High** | INSZoom: a **backend route-mount collision** (`/uscis/forms` registered before `/uscis` in `routes/index.js:24-25`) silently misroutes 4 of the USCIS Lifecycle tab's endpoints to the form-*import* module. "Pending Reviews" is permanently 0, and "Activate"/"Retire" run a different service than "Approve"/"Compare" beside them. |
| D-05 | **High** | INSZoom: `TaskDetails` "Delete" button has no `onClick` at all, despite `DELETE /tasks/:id` existing. |
| D-06 | **High** | BAIS: `AdminLogin` grants an app-wide session on a successful login even when the role check then fails — the screen says "not authorized" while the user is actually logged in. |
| D-07 | **High** | BAIS: `Intake` "Save & close" persists nothing. All quiz answers are silently discarded. |
| D-08 | **High** | BAIS: `AdminPortal` loads via `Promise.all` of 6 endpoints with a `console.error`-only catch — one failure blanks all six sections into indistinguishable "no data" empty states. |
| D-09 | **High** | INSZoom: `CaseManagerDetails` has no error state at all; the Analytics tab shows "Loading case manager analytics…" **forever** on failure. |
| D-10 | **High** | INSZoom: `QuestionnaireTemplates` — 8 mutating handlers with no `try/catch` and no error UI anywhere on the page. |
| D-11 | **High** | BAIS: `ManageBooking` cancel is a false success — the view flips synchronously without awaiting the mutation, and neither cancel nor reschedule has any error path. |
| D-16 – D-18 | **Medium** | 4 orphaned BAIS pages: `/dashboard/document-review` (structurally unreachable — its only nav links render for staff roles, whom `AuthGate` redirects off-origin), `/dashboard/plan` and `/dashboard/filing-type` (zero inbound links anywhere), and `Notifications.jsx` (never imported or routed). |
| D-19 | **Medium** | Neither app has a `path="*"` catch-all. An unknown URL renders a blank page. |
| D-47 | **High** | INSZoom: `PaymentsOverview` has no user-facing error state at all — a failed load renders a zeroed, authoritative-looking financial ledger. |

---

## 2. TASK 1 — Route & page inventory

### 2.1 BAIS client portal (`BAIS/Frontend/src/App.jsx`)

Guards in use:
- **`AuthGate`** (`src/components/AuthGate.jsx`) — the sole routing authority. Calls `GET /auth/session-context` once on mount, then routes by role / `mustSetPassword` / employee-account / `hasCase` / `isLegacyNoCaseAccount`.
- **`BlockIfHasCase`** (`src/components/eligibility/BlockIfHasCase.jsx`) — calls `GET /auth/session-context`; **fails open** on error (renders `<Outlet/>`, `BlockIfHasCase.jsx:59`).
- **`ProtectedRoute`** (`src/components/ProtectedRoute.jsx`) — **defined but no longer referenced by the route tree** (App.jsx:67-76 documents this). Dead file.

| Path | Component | Guard | Roles that can reach it | Fetches on mount |
|---|---|---|---|---|
| `/` | `Dashboard/Home.jsx` | none | public | `useHasCase()` → `GET /cases/my` (only if logged in) |
| `/about` | `Dashboard/About.jsx` | none | public | none (all content hardcoded) |
| `/how-it-works` | `Dashboard/HowItWorks.jsx` | none | public | `useHasCase()` via `StartAssessmentButton` |
| `/offers` | `Dashboard/Offers.jsx` | none | public | `GET /referrals/me` (**unconditional — 401s for anonymous**), `GET /cases/my`, `GET /clients/me` |
| `/eligibility` | `Eligibility/EligibilityIntro.jsx` | `BlockIfHasCase` | public, blocked if has case | `GET /eligibility-quiz/visas`, `POST /telemetry/track` |
| `/eligibility/quiz` | `Eligibility/EligibilityQuiz.jsx` | `BlockIfHasCase` | public, blocked if has case | `GET /eligibility-quiz/definition` |
| `/eligibility/results/:leadId?` | `Eligibility/EligibilityResults.jsx` | none | public | **none** — reads `location.state` only; a refresh permanently loses results |
| `/consultation/book/:leadId?` | `Consultation/BookConsultation.jsx` | none | public | `GET /consultation/config`, `GET /consultation/slots` |
| `/consultation/booking/:token` | `Consultation/ManageBooking.jsx` | none | token bearer | `GET /consultation/booking/:token` |
| `/dashboard` | `Dashboard/Dashboard.jsx` | `AuthGate` | client, user, employer, employee, beneficiary | `GET /clients/me`, `/cases/my`, `/cases/:id/workflow`, `/cases/:id/addons`, `/documents/me`, `/messages/unread-count`, `/payments/summary` |
| `/dashboard/profile` | `Dashboard/Profile.jsx` | `AuthGate` | all client-portal roles | employee: `GET /cases/my` + `/employee-profile/:caseId`; else `GET /client-intake/me` |
| `/dashboard/messages` | `Dashboard/Messages.jsx` | `AuthGate` | non-employee client roles (employee bounced to `/dashboard`) | `GET /messages`, `GET /messages/case/:caseId`, `GET /messages/:threadId` |
| `/dashboard/plan` | `Dashboard/PlanSelection.jsx` | `AuthGate` | non-employee | `GET /client-intake/me`, `GET /cases/my` — **ORPHANED: zero inbound links** |
| `/dashboard/filing-type` | `Dashboard/FilingTypeSelection.jsx` | `AuthGate` | non-employee | `GET /single-party-filings/types` — **ORPHANED: zero inbound links** |
| `/dashboard/payments` | `Dashboard/Payments.jsx` | `AuthGate` | non-employee | `GET /payments/summary` (+15s poll, visibility, socket) |
| `/dashboard/payments/success` | `Dashboard/PaymentSuccess.jsx` | `AuthGate` | non-employee | `POST /payments/confirm-checkout-session`, `GET /payments/summary` (3s poll ≤60s) |
| `/dashboard/payments/cancel` | `Dashboard/PaymentCancel.jsx` | `AuthGate` | non-employee | none |
| `/dashboard/documents` | `Dashboard/Documents.jsx` | `AuthGate` | all client-portal roles incl. employee | `GET /cases/my`, `/client-intake/me`, `/employment-workflow/me`, `/questionnaires/case/:id/checklists`, `/documents/me`, `/questionnaires/case/:id` (×N roles) |
| `/dashboard/documents/:caseId` | `Dashboard/Documents.jsx` | `AuthGate` | employer (sponsored case), employee (own) | same |
| `/dashboard/document-review` | `Dashboard/DocumentReview.jsx` | `AuthGate` | **NOBODY — see D-11** | `GET /document-intelligence/review-queue` |
| `/onboarding/intake` | `Dashboard/Intake.jsx` | `AuthGate` (standalone, no navbar) | client with no case, not legacy | `useHasCase()` |
| `/dashboard/intake` | → `Navigate` to `/onboarding/intake` | none | — | — |
| `/legacy-holding` | `Auth/LegacyHolding.jsx` | **none (public)** | anyone | none (fully static, zero controls) |
| `/login` | `Auth/Login.jsx` | none | public | none |
| `/signup` | `Auth/Register.jsx` | none | public | none |
| `/accept-invite` | `Auth/AcceptInvite.jsx` | none | invite-token bearer | `GET /auth/invite/:token` |
| `/forgot-password` | `Auth/ForgotPassword.jsx` | none | public | none |
| `/reset-password` | `Auth/ResetPassword.jsx` | none | reset-token bearer | **none — token is never validated before showing the form** |
| `/auth/callback` | `Auth/OAuthCallback.jsx` | none | OAuth return | none (parses query params) |
| `/admin` | `Admin/AdminLogin.jsx` | none | public form; role checked after login | none |
| `/admin/portal` | `Admin/AdminPortal.jsx` | **none** | any URL visitor (data calls 403 for non-admins) | `Promise.all` of `GET /admin/overview`, `/admin/users`, `/appointments`, `/admin/documents`, `/cases?limit=100`, `/eligibility-quiz/leads?limit=200` |
| *(no `path="*"`)* | — | — | — | **unknown URL → blank page** |

**Unrouted page component:** `Pages/Dashboard/Notifications.jsx` — never imported anywhere in the app (verified by grep across `--include=*.jsx`). Dead code.

### 2.2 INSZoom staff portal (`INSZoom/frontend/src/App.jsx`)

Guard: **`ProtectedRoute`** (`src/components/ProtectedRoute.jsx`) with a `module` prop resolved through `utils/permissions.js → canAccessModule(user, module)`. Role hierarchy: `super_admin > admin > team_lead > case_manager`. Client-portal roles (`client`, `user`) are force-logged-out (`ProtectedRoute.jsx:9-11`).

| Path | Component | Guard module | Roles that can reach it | Fetches on mount |
|---|---|---|---|---|
| `/login` | `Login.jsx` | none | public | none |
| `/` | → `Navigate` `/dashboard` | — | — | — |
| `/dashboard` | `Dashboard.jsx` | `dashboard` | all 4 staff roles | role-scoped: `GET /analytics/dashboard`, `/analytics/revenue`, `/case-managers`, `/cases/dashboard/stats`, `/cases/dashboard/team-lead`, `/cases/dashboard/needs-attention`, `/cases/dashboard/recent-activity` |
| `/leads` | `Leads.jsx` | `leads` | super_admin, admin | `GET /eligibility-quiz/leads?limit=200` |
| `/crm-cases` | `CRMCases.jsx` | `cases` | all 4 | `GET /cases/dashboard/team-lead` (sa/a/tl), `GET /cases` |
| `/crm-cases/:id` | `CRMCaseDetail.jsx` | `cases` | all 4 | `GET /cases/:id`, `/client-intake/cases/:id`, `/cases/:id/related`, `/cases/:id/addons`, `/users/assignable` (+ per-tab, see §3.2) |
| `/messages`, `/messages/:caseId`, `/messages/user/:userId` | `Messaging.jsx` | `messaging` | all 4 | see §3.2 |
| `/companies` | `Companies.jsx` | `companies` | super_admin, admin | `GET /companies?limit=200` |
| `/documents`, `/documents/:caseId` | `Documents.jsx` | `documents` | all 4 | `GET /cases?limit=50`, `GET /documents?caseId=` |
| `/leaderboard` | `Leaderboard.jsx` | `reports` | all 4 (sidebar link only sa/a/tl) | see §3.2 |
| `/analytics` | `Analytics.jsx` | `reports` | all 4 (sidebar link only sa/a/tl) | see §3.2 |
| `/uscis-forms` | `USCISForms.jsx` | `cases` | all 4 | see §3.2 — **no sidebar entry; URL-only** |
| `/case-managers` | `CaseManagers.jsx` | `case-managers` | sa, a, tl (sidebar link only sa/a) | `GET /case-managers` |
| `/case-managers/:id` | `CaseManagerDetails.jsx` | `case-managers` | sa, a, tl | `GET /case-managers/:id` + per-tab |
| `/eod-reports` | `EODReports.jsx` | `reports` | all 4 | see §3.2 |
| `/payments` | `PaymentsOverview.jsx` | `payments` | sa, a, tl | see §3.2 |
| `/users/*`, `/staff-profile/:userId` | → `Navigate` `/dashboard` | none | — | — |
| `/settings` | `Settings.jsx` | `settings` | sa, a | `GET /settings`; AI tab: `GET /ai/providers`, `/ai/prompts`, `/ai/usage` |
| `/questionnaires` | `QuestionnaireTemplates.jsx` | `questionnaires` | all 4 | `GET /questionnaires/defaults`, `GET /questionnaires?isTemplate=true`, `GET /cases?limit=100` |
| `/tasks` | `TaskDashboard.jsx` | `dashboard` | all 4 | `GET /tasks/stats/dashboard`, `GET /tasks?limit=5` |
| `/tasks/my-tasks` | `MyTasks.jsx` | `dashboard` | all 4 | `GET /tasks/my-tasks` |
| `/tasks/all` | `MyTasks mode="all"` | `dashboard` | all 4 | `GET /tasks` |
| `/tasks/team-tasks` | `TeamTasks.jsx` | `dashboard` | all 4 (**backend restricts to sa/a/tl → 403 for case_manager**) | `GET /tasks/team-tasks` |
| `/tasks/calendar` | `TaskCalendar.jsx` | `dashboard` | all 4 | `GET /tasks/calendar` |
| `/tasks/create`, `/tasks/:id` | `TaskDetails.jsx` | `dashboard` | all 4 | `GET /tasks/:id`; create mode: `GET /users/assignable`, `GET /cases?limit=200` |
| `/teams` | `Teams.jsx` | `teams` + `requiredRoles=[sa,a,tl]` | sa, a, tl | `GET /team-members` |
| *(no `path="*"`)* | — | — | — | **unknown path renders the Layout chrome with an empty outlet** |

**Role-gating inconsistencies found (frontend only; the backend gate is authoritative):**
- `permissions.js:76` allows `team_lead` on the `case-managers` module, but `getSidebarMenuItems` (`permissions.js:132`) only shows the link to `super_admin`/`admin`. A team lead can reach `/case-managers` only by typing the URL.
- `/analytics` and `/leaderboard` are guarded by `module="reports"` = all four staff roles, but the sidebar hides them from `case_manager`. Reachable by URL.
- `/uscis-forms` has no sidebar entry at all.
- `/tasks/team-tasks` is guarded client-side by `module="dashboard"` (all four roles) while `task.routes.js:15` restricts `GET /tasks/team-tasks` to `super_admin`/`admin`/`team_lead`. A `case_manager` reaching this page gets a generic "Failed to load team tasks" banner instead of an access-denied message.
- The `notifications` and `clients` entries in `canAccessModule`'s map are never referenced by any route.
- **Orphaned components:** `INSZoom/frontend/src/poc/PocHarness.jsx` and `poc/pocMain.jsx` are not imported by the app (separate POC entry point).

---

## 3. TASK 2 — Control inventory (§25)

Legend for the "API" column: `METHOD /path` = a real, verified backend route; `NONE (nav)` = navigation only; `NONE (local)` = local state only, by design; **`DEAD`** = defect.

### 3.1 BAIS client portal

#### `/login` — `Pages/Auth/Login.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| "Continue with Google" | 170-184 | `GET /auth/google` (full-page redirect) | `googleLoading`; disabled while loading | page navigates away |
| Email / Case-ID tab toggle | 199-216 | NONE (local) | — | — |
| Password show/hide | `PasswordField.jsx:47-58` | NONE (local) | — | — |
| "Forgot password?" | 264-268 | NONE (nav) | — | — |
| "Sign In" submit | 301-310 → `handleLogin` 59-99 | `POST /auth/login` | `loading`; disabled; "Signing in…"; mapped friendly errors 83-97 | navigation driven by a `user`-watching effect (54-57) |
| "Resend invitation email" | 280-283 → `handleResendInvite` 101-109 | `POST /auth/resend-invite` | `resendingInvite` — **no `catch`; failures are silent** | `resendSent` flag |

**Error handling:** a network/timeout failure falls through every `msg.includes(...)` branch to the generic *"Unable to log in. Please check your credentials and try again."* (Login.jsx:96) — a backend outage is reported to the user as a **credentials problem**.

#### `/signup` — `Pages/Auth/Register.jsx`

| Control | Line | API | States |
|---|---|---|---|
| "Continue with Google" | 363-374 | `GET /auth/google` | `googleLoading`, disabled |
| Referral code field | 337-346 | NONE (local; prefilled from `?ref=`) | — |
| "Create Account" submit | 377-383 → 195-229 | `POST /auth/register` | `loading`, disabled, "Creating account…"; friendly errors 212-227; success → 1.6s delay → `/dashboard/intake` |
| "Resend invitation email" | 397-399 → 231-239 | `POST /auth/resend-invite` | **no `catch`; silent failure** |
| "Already have an account? Sign in" | 417-422 | NONE (nav) | — |

#### `/accept-invite` — `Pages/Auth/AcceptInvite.jsx`

| Control | Line | API | States |
|---|---|---|---|
| "Go to Login" (invalid state) | 82-85 | NONE (nav) | — |
| "Activate Account" submit | 117-121 → 41-54 | `POST /auth/invite/:token/accept` | `submitting`, disabled, "Activating…"; `err.message` shown; success → `/dashboard` |

Mount fetch `GET /auth/invite/:token` uses `.catch(() => setStatus("invalid"))` (AcceptInvite.jsx:38) — a 404, a 500 and a network timeout all render the identical "Invalid or expired link" copy with no retry.

#### `/forgot-password`, `/reset-password`

| Page | Control | Line | API | States |
|---|---|---|---|---|
| ForgotPassword | "Send Reset Link" | 95-99 → 45-59 | `POST /auth/forgot-password` | `submitting`, disabled; neutral success screen (deliberate anti-enumeration) |
| ForgotPassword | "Back to Login" ×2 | 101-106, 114-117 | NONE (nav) | — |
| ResetPassword | "Reset Password" | 105-109 → 26-44 | `POST /auth/reset-password` | `submitting`, disabled; "invalid or expired" flips to a dedicated state (36-38) |
| ResetPassword | "Request a New Link" / "Go to Login" | 68-71, 81-84 | NONE (nav) | — |

Both are clean. Note `ResetPassword` never validates the token before rendering the form.

#### `/auth/callback` — `Pages/Auth/OAuthCallback.jsx`
No interactive controls. Parses `accessToken`/`userId`/`role` from the query string, calls `tokenStore.set()` + `setUserFromOAuth()` (36-37), then redirects staff roles to INSZoom and clients to `/dashboard`. **The access token is stored with no shape/expiry validation** — a malformed token surfaces only as a 401 on the next call.

#### `/legacy-holding` — `Pages/Auth/LegacyHolding.jsx`
Fully static. Zero controls, zero fetches.

#### `/` — `Pages/Dashboard/Home.jsx`

| Control | Line | API | Notes |
|---|---|---|---|
| "Continue My Case" | 338-346 | NONE (nav) | shown when `hasCase` |
| `StartAssessmentButton` | 348-350 | NONE (nav) | renders `null` while loading or when `hasCase` |
| "Get Started Free" | 352-364 | NONE (local scroll / nav) | — |
| "Sign In to Portal" | 365-373 | NONE (nav) | — |
| StepShowcase CTAs ×3 | 421-422, 439-440, 457-458 | NONE (nav/scroll) | — |
| FAQ accordion | 184-207 | NONE (local) | — |
| "Learn More About Our Services" | 593-600 | NONE (nav) | — |
| "Book Free Consultation" / "Call Us Now" | 719-732 | NONE (scroll / `tel:`) | — |
| `ConsultationSection` "Request Appointment" | `ConsultationSection.jsx:110-115` | `POST /leads/public` | `loading`, disabled, "Submitting…", inline error; success screen |
| **"Privacy Policy" / "Terms of Service" / "Disclaimer"** | 292-294 | **DEAD** — bare `<span className="cursor-pointer">`, no `onClick`, no `href` | — |
| Footer quick links | 238-250 | NONE (nav) | — |

#### `/about` — `Pages/Dashboard/About.jsx`

| Control | Line | API |
|---|---|---|
| "Get Started" | 259-267 | NONE (nav) |
| "Change of Status" / "Book Free Consultation" anchors | 268-273, 404-409 | NONE (scroll) |
| "Call Now" | 410-415 | NONE (`tel:`) |
| `ConsultationSection` | 524 | `POST /leads/public` |
| **"Privacy Policy" / "Terms of Service" / "Disclaimer"** | 176-179 | **DEAD** — same non-clickable spans |
| Footer links | 136-146 | NONE (nav) |

Also: `const [expanded, setExpanded] = useState(null)` at About.jsx:188 is declared and never read — leftover from a removed accordion. The "Google Reviews" section (484-521) renders hardcoded `REVIEWS` data, not a live feed.

#### `/how-it-works` — `Pages/Dashboard/HowItWorks.jsx`
`StartAssessmentButton` ×2 (207, 325) — nav only. "Call Us" (326-331) — `tel:`. `ConsultationSection` (337) — `POST /leads/public`. No dead controls.

#### `/offers` — `Pages/Dashboard/Offers.jsx`

| Control | Line | API | States |
|---|---|---|---|
| OfferCard "Get Started" ×3 | 167-179 | NONE (nav) | — |
| "Copy Referral Link" | 226-228 → 110-117 | NONE (clipboard) | **empty catch at 116 — clipboard failure gives zero feedback** |
| "Share on WhatsApp" | 229-231 | NONE (external) | — |
| "Claim Your Discount" | 246-252 | NONE (nav) | — |
| FAQ toggles | 323-350 | NONE (local) | — |
| "Contact Us" submit | 306-311 → 126-147 | `POST /leads/public` | `loading`, disabled, "Sending…"; **success and error both via blocking `alert()`** (140, 143) |

`handleContactRequest` sets `window.location.href = mailtoUrl` (139) and then immediately calls `alert()` (140) on the same tick — the alert typically blocks the mailto navigation.

#### `/dashboard` — `Pages/Dashboard/Dashboard.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Dismiss notice (X) | 914 | NONE (local) | — | — |
| "Retry" (case-load error) | 923 | `GET /cases/my` + `/cases/:id/workflow` | no spinner while retrying | refetch |
| "My Profile" | 975 | NONE (nav) | — | — |
| Visa info icon → `InfoPopup` | 949 | NONE (local) | — | — |
| InfoPopup "select visa" | 966 | NONE (nav) | — | — |
| Quick action "Complete Profile" | 547 | NONE (nav) | — | — |
| Quick action "Upload Documents" | 548 | NONE (nav) | — | — |
| Quick action "View Case Status" | 549, 576 | NONE (local `scrollIntoView`) | — | — |
| Quick action "Contact Agent" | 550 | NONE (`mailto:`) | — | — |
| "View Payment Details" | 401 | NONE (nav) | — | — |
| Email / Call agent | 528, 533 | NONE (`mailto:`/`tel:`) | — | — |
| Messages KPI card | 1084 | NONE (nav) | — | — |
| **"Add Upgrade" (Premium Processing / I-907)** | 206 → `handlePurchaseAddon` 798-814 | `POST /cases/:id/addons/:addonKey/purchase` | disabled while `purchasing`/ineligible; "Starting checkout…"; inline `addonError` | redirects to Stripe; falls back to `loadCase()` |

**Error handling:** `loadCase()` failure shows a retryable red banner (920-930) — a good, deliberate pattern. But `GET /clients/me` (819), `/documents/me` (849), `/messages/unread-count` (854) and `/payments/summary` (858) all use `.catch(() => {})`, so a partial outage renders plausible-looking zeroed KPIs ("0 documents", "$0.00 paid") with no error indicator.

#### `/dashboard/profile` — `Pages/Dashboard/Profile.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Name / phone / address fields | 218-247 | NONE (buffered) | — | — |
| Visa category / type selects | 253-273 | NONE (buffered) | — | — |
| "Save changes" | 279-286 → 126 | employee: `POST /employee-profile/:caseId`; else `PUT /client-intake/me` | `disabled={saving \|\| !dirty}`, "Saving…" | sets `dirty=false`, no refetch |
| "Change Password" | 334-341 → 166 | `PUT /auth/change-password` | `disabled={passwordSaving}`, "Changing…", client-side validation, red error styling | clears fields on success |

**Defect:** the save status `<p>` (Profile.jsx:278) uses identical neutral styling (`text-xs text-slate-400`) for "Saved" and for error text — a failed save is not visually distinguishable from a successful one. Both mount loaders swallow errors (`.catch(() => setLoading(false))` at 87 and 118), so a load failure renders a blank form indistinguishable from "no data yet".

#### `/dashboard/documents` — `Pages/Dashboard/Documents.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| "Save progress" ×2 | 772-779, 1000-1007 | `commitAll()` → `POST /questionnaires/:id/answers` per role | disabled while submitted/saving/uploading; "Saving…"; `submitError` | server-persisted |
| "Submit case" ×2 | 780-787, 1008-1015 | `POST /family-workflow/:id/submit` \| `POST /employment-workflow/:id/submit` \| `POST /client-intake/me/submit` | disabled while missing-required/submitting/uploading; "Submitted"/"Submitting…" | refetches case, or navigates to `/dashboard` |
| Section-nav rail / mobile `<select>` | 842-874, 814-823 | NONE (local scroll) | — | — |
| Role tabs | 793-806 | NONE (local) | — | — |
| Document upload (per checklist item) | 643-650 | `POST /documents/upload` or chunked session endpoints | disabled when locked; progress bar | optimistic `files[docId]` |
| Document remove | 649 | `DELETE /documents/:docId` | — | local `files` update |
| Question input `onChange` | 675 | `POST /questionnaires/:id/answers` (batched) | per-row `savingKey` | server-persisted |
| Question file input | 676 | `POST /questionnaires/:id/answers/files` | "Uploading files…" | server-persisted |
| Autofill button | 633 | `POST /document-intelligence/case/:caseId/autofill` | `disabled={!activeCaseId}`, "Reading your {type}…" | `handleAutofillResult` |
| `PrefillBadge` accept/reject | 678-682 | `POST /questionnaires/:id/answers` | disabled when locked | server-persisted |
| "Try again" (documents) | 904-906 | `GET /documents/me` | — | refetch |
| "Try again" (questionnaire) | 920-926 | `GET /questionnaires/case/:id` | — | refetch |
| Handoff modal "I'll fill it myself" | 963 → 268-279 | `PUT /employment-workflow/:id/employee-questionnaire` | **no `try/catch`, and the modal fires-and-forgets without awaiting** | refetches case + checklists |
| Handoff modal "Add employee" (invite) | 964 → 284-297 | `POST /employment-workflow/:id/invite-employee` | properly awaited; `sending`, "Sending…", inline error | refetches |
| "Resend invite" | 947-953 → 299 | `POST /employment-workflow/:id/resend-employee-invite` | `disabled={resendingInvite}`, "Resending…" | message only |

This page has the best load-error discipline in the app: `documentsLoadError` / `questionnaireError` are explicitly kept distinct from "loading" and "empty" (see the comment at 349-354). The `beforeunload`/`popstate` unsaved-changes guard (575-592) does not cover in-app link navigation (documented at 568-574).

#### `/dashboard/document-review` — `Pages/Dashboard/DocumentReview.jsx` *(unreachable — see D-11)*

| Control | Line | API | States |
|---|---|---|---|
| Field value input | 48-53 | NONE (buffered) | `disabled={busy}` |
| "Save Edit" | 54 | `PUT /document-intelligence/:id/field` | `disabled={busy}` |
| "Approve" | 55 | `POST /document-intelligence/:id/approve` | `disabled={busy}` |
| "Reject" | 56 | `POST /document-intelligence/:id/reject` | `disabled={busy}` |

`FieldRow.act()` (24-34) has **no `try/catch`** — only a `finally { setBusy(false) }`. A 403/500 on any of the three write buttons fails completely silently: the row is unchanged, `onDone()` never fires, and no message appears.

#### `/dashboard/payments` — `Pages/Dashboard/Payments.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Plan selector (full / 2 / 4 installments) | 274-288 | NONE (local) | — | — |
| "Pay $X with Stripe" | 320-327 → 154 | `POST /payments/create-partial-checkout-session` | `disabled={!canPay}`, "Redirecting to Stripe…"; `payingRef` double-submit guard (155, 174) | redirects to Stripe |
| "Download receipt" | 360-366 | `GET /payments/:id/receipt/:transactionId/download` | **no loading/disabled state** | browser download |

`handlePay` reports errors via a blocking **`alert()`** (Payments.jsx:154-177) rather than the page's own `errorMessage` banner used everywhere else on the same screen.

#### `/dashboard/payments/success`, `/cancel`

| Page | Control | Line | API |
|---|---|---|---|
| PaymentSuccess | "View Updated Payments" | 104-109 | NONE (nav) |
| PaymentCancel | "Try Again" | 13-18 | NONE (nav) |

`PaymentSuccess` polls `GET /payments/summary` every 3s for 60s then stops (PaymentSuccess.jsx:70) — but the on-screen copy keeps saying "This page will update automatically…" after polling has stopped. Misleading terminal state.

#### `/dashboard/plan` — `Pages/Dashboard/PlanSelection.jsx` *(orphaned)*

| Control | Line | API | States |
|---|---|---|---|
| Plan cards (Basic/Standard/Premium) | 71-104 | NONE (local) | — |
| `ApplicantTypeSelector` | 67 | `PUT /auth/updatedetails` (see below) | — |
| "Continue with {Plan}" | 114-118 → 30 | `PUT /clients/me`, then `GET /cases/my`, then `PUT /cases/:id/plan` | `disabled={!selected \|\| saving}`, "Saving…" |

**Defect:** `handleConfirm`'s catch (PlanSelection.jsx:50-53) is `console.error(error); setSaving(false);` — no error state, nothing rendered. A failed plan save looks exactly like the button doing nothing.

#### `/dashboard/filing-type` — `Pages/Dashboard/FilingTypeSelection.jsx` *(orphaned)*

| Control | Line | API |
|---|---|---|
| Current-status `<select>` | 95-103 | NONE (local) |
| Desired-status `<select>` | 107-115 | NONE (local) |
| "Start This Filing" | 118-127 → `startFiling` 59-63 | NONE (nav) — **the `payload` argument is accepted and never used** |
| Filing option cards | 136-140 | NONE (nav) — same `startFiling` |

`startFiling(payload)` unconditionally does `navigate("/consultation/book")`, discarding `fromStatus`/`toStatus`/`filingTypeKey`. This is documented as an intentional Phase-2 architecture change, but the page still presents two dropdowns and per-category cards whose values are transmitted nowhere. Classed as a **fidelity gap**, not a bug.

The load-failure branch (72) replaces the whole page with red text — no retry, no navigation, a dead end.

#### `/dashboard/messages` — `Pages/Dashboard/Messages.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Thread list item | 242-262 | NONE (triggers `loadMessages`) | spinner 769-772 | loads messages |
| Refresh (thread list) | 749 | `GET /messages` | — | refetch |
| Refresh (conversation) | 866 | `GET /messages/:threadId` | — | refetch |
| Back (mobile) | 740, 835 | NONE (local) | — | — |
| Attach file / file input | 958-969 | NONE (local) | — | — |
| Remove pending attachment | 928 | NONE (local) | — | — |
| Internal-note toggle (admin) | 913 | NONE (local) | — | — |
| Textarea typing | 943-956 | `POST /messages/conversations/:id/typing` (debounced) | `.catch(()=>{})` — acceptable for a fire-and-forget signal | — |
| **Send** | 962-966 → 707 → 632 | `POST /messages/:threadId` (multipart) | optimistic bubble, upload progress, disabled when empty; on failure marks `__failed` + sets `sendError` | reconciles optimistic message |
| Failed bubble "Tap to retry" | 312, 324-327 | re-`dispatchMessage` | — | re-sends |
| Cancel in-flight upload | 304-307 | `AbortController.abort()` | — | removes optimistic message |
| Attachment chip / thumbnail | 188, 219 | `GET /messages/:messageId/attachments/:attachmentId` | idle/loading/ready/error shown inline | blob cache |
| Lightbox download / close | 206, 209 | same / NONE | — | — |
| Drag-and-drop zone | 792-818 | NONE (local) | — | — |

`dispatchMessage` (632-705) is the strongest error-handling implementation in either app. Conversely `loadThreads` (401-409) and `loadMessages` (431-452) both carry explicitly-commented **silent** catches: a backend outage on this page presents as an indefinitely empty inbox with no indication anything is wrong.

#### `/onboarding/intake` — `Pages/Dashboard/Intake.jsx`

| Control | Line | API | States |
|---|---|---|---|
| **"Save & close"** | 705-707 | **DEAD/FAKE — `navigate("/dashboard")` only.** No API call, no localStorage, no session storage (verified: zero `saveIntake`/`localStorage`/`sessionStorage` references in the file). All answers are discarded. | — |
| Selection cards (per step) | 745-767 → `selectAnswer` 621 | NONE (local) | — |
| "← Back" | 773-780 | NONE (local) | disabled on first step |
| Final-step completion | 762-765 → `submitIntakeLead` 656-677 | `POST /leads/from-intake` | full-screen "Saving your answers…"; `submitError` banner; validates response shape | navigates to `/consultation/book?leadId=…` |

#### `/eligibility*` and `/consultation*`

| Page | Control | Line | API | States |
|---|---|---|---|---|
| EligibilityIntro | category / visa pickers | 118, 159 | NONE (local) | — |
| EligibilityIntro | "Next" / "Start assessment" | 130-141, 166-177 | NONE (nav) | disabled until a selection is made |
| EligibilityIntro | "← Back to categories" | 147-153 | NONE (local) | — |
| EligibilityQuiz | field inputs | 127-153 | NONE (local) | — |
| EligibilityQuiz | "Show/Hide live snapshot" | 136-142 | NONE (local) | — |
| EligibilityQuiz | "Back" | 173-180 | NONE (local) | disabled on step 0 |
| EligibilityQuiz | "Continue" / "Get my results" | 181-189 → 92-111 | `POST /eligibility-quiz/submit` | disabled while `isPending`, "Submitting…", `isError` banner |
| EligibilityResults | "Retake the assessment" | 28-34 | NONE (nav) | — |
| EligibilityResults | "Book your free consultation" | 84-94 | NONE (nav) | — |
| BookConsultation | calendar date / time slot | 105, 108 | NONE (local) | — |
| BookConsultation | "← Choose a different time" | 118-120 | NONE (local) | — |
| BookConsultation | contact fields | 137-149 | NONE (local) | — |
| BookConsultation | "Confirm booking" | 153-161 → 63-74 | `POST /consultation/book` | disabled until valid + while pending, "Confirming…"; **409 specially handled** (46-52): clears slot, amber banner, auto-refetches slots |
| ManageBooking | "Reschedule" / "Cancel" | 75-80 | NONE (local) | hidden if already cancelled |
| ManageBooking | "Confirm new time" | 100-108 | `POST /consultation/booking/:token/reschedule` | disabled until slot + while pending, "Saving…"; **no `onError`, no error UI at all** |
| ManageBooking | **"Cancel consultation"** | 121-128 | `POST /consultation/booking/:token/cancel` | **FALSE SUCCESS** — `setMode("view")` runs synchronously right after `mutate()`, never awaiting the result; no `onError` anywhere |
| ManageBooking | "Keep booking" / "← Back" | 118-120, 88 | NONE (local) | — |

`BookConsultation`'s slots query has no error branch — `slotsData?.slots || []` collapses a failed fetch into "no available dates", indistinguishable from a genuinely empty calendar. `EligibilityResults` reads only `location.state`, so any refresh permanently loses the results and forces a full retake.

#### Shared chrome — `layout/MainLayout.jsx`, `components/Navbar.jsx`, `components/NotificationBell.jsx`

`MainLayout` is a pure `<Navbar/><Outlet/>` shell (1-13) with no controls.

| Control | File:line | API | States |
|---|---|---|---|
| Logo / nav links / dropdown items | Navbar 154-182, 235-248, 309-318 | NONE (nav) | — |
| Profile dropdown toggle / mobile hamburger | Navbar 193-211, 292-299 | NONE (local) | — |
| "Sign Out" (desktop + mobile) | Navbar 253-262, 339-348 → `handleLogout` 135-139 | `POST /auth/logout` — **see D-02: sent without an auth header, always 401s** | — |
| Bell toggle | NotificationBell 144-154 | NONE (local) | unread badge |
| "Mark all read" | NotificationBell 160-164 → 127-132 | `PUT /notifications/mark-all-read` | **bare `catch {}` at 131 — silent** |
| "Enable" push | NotificationBell 170-176 → 43-51 | `POST /notifications/register-device` | `disabled={enablingPush}`, "Enabling…"; **`try/finally` with no `catch`** → unhandled rejection, no message |
| Notification item click | NotificationBell 189-200 → 124 | `PUT /notifications/:id/read`, then `navigate(link)` | **bare `catch {}` — silent** |

Navbar's `GET /auth/session-context` (121-133) swallows failures into `setSessionHasCase(false)` (129-131), which **hides the Dashboard / Messages / Payments links** for a client who does have a case, with no retry and no indicator. `NotificationBell`'s initial `load()` (53-58) has a `catch { /* fail silently */ }`, so a failed fetch renders the same "No notifications yet" empty state as a genuinely empty inbox.

#### Checklist & questionnaire components

| Component | Control | Line | API | Notes |
|---|---|---|---|---|
| `DocumentChecklist.jsx` | upload dropzone | 251-286 | delegated `onUpload` | progress bar + pause/resume; upload errors **are** surfaced (280-282) |
| `DocumentChecklist.jsx` | pause/resume | 274-276 | NONE (local flag) | actual pause semantics live in the caller's loop |
| `DocumentChecklist.jsx` | file remove (trash) | 163-169 → 227 | delegated `onRemove` | **`try { await onRemove() } catch {}` — removal failures are silent** |
| `DocumentUploadControl.jsx` | dropzone / browse | 51-72 | delegated `onUpload` | errors surfaced via `role="alert"` (74) — good |
| `DocumentUploadControl.jsx` | "Remove" per file | 90-99 | delegated `onRemove` | `removingId` disables that row, "Removing…", errors surfaced (44) — good |
| `ChecklistItemRow.jsx` | — | — | none | pure presentational |
| `EmployeeHandoffModal.jsx` | "Invite the employee" | 54-63 | NONE (local step) | — |
| `EmployeeHandoffModal.jsx` | **"I'll fill it myself"** | 64-71 | `PUT /employment-workflow/:id/employee-questionnaire` | **FALSE SUCCESS** — `onChooseFillMyself(); onClose();` — the write is not awaited and failures are invisible |
| `EmployeeHandoffModal.jsx` | "Add employee" (send invite) | 106-113 | `POST /employment-workflow/:id/invite-employee` | properly awaited, `sending`, "Sending…", inline error — good |
| `EmployeeHandoffModal.jsx` | "Done" / "← Back" | 122-124, 103-105 | NONE (local) | — |
| `CaseIntakeExtras.jsx` | dynamic case-info + I-907 fields | 225-301 | debounced autosave → `PUT /client-intake/me` | **`.catch(() => null)` at 195 — a failed autosave of I-907 premium-processing filing data is indistinguishable from a successful one; no "Saved" confirmation either** |
| `PrincipalCaseWorkspace.jsx` | employee tabs | 96-109 | NONE (local) | — |
| `PrincipalCaseWorkspace.jsx` | "Remove this employee" | 115-121 → 70 | `PATCH /cases/:caseId/remove-employee` | `window.confirm` gate; no in-flight disable; errors via `alert()` | refetches children |
| `InvitePanel.jsx` | "Send Invite" | 72-79 → 18-36 | `POST /cases/:principalId/invite-employee` | `disabled={sending}`, "Sending…", client + server errors surfaced (83) — good |
| `DataEntryModeModal.jsx` | "I will fill it in myself" / "Invite each employee" | 43-67 | `PATCH /cases/:principalId/data-entry-mode` | both disabled while loading, inline error (70-74) — good |
| `EmployeeSelfServiceView.jsx` | — | — | delegates to `CaseRoleChecklist` | thin wrapper |
| `CanonicalProfileForm.jsx` | field inputs / "Save" | 62-101, 134-141 | delegated `onSave` | `disabled={saving}`, "Saving…", both error and success surfaced incl. conflict count (50-54) — good. **Note: this component is orphaned — never imported.** |
| `CaseRoleChecklist.jsx` | "Save progress" | 60-67 | `POST /questionnaires/:id/answers` (batched) | `disabled={!dirty \|\| saving}`; `saveState` drives visible text; `commitAll` re-throws and the `onClick` doesn't catch → console noise, but the user does see the error text |
| `CaseRoleChecklist.jsx` | question inputs | 91-124 | NONE (local until Save) — **by design**, see `useQuestionnaireAnswers.js:22-33` | — |
| `QuestionInput.jsx` | file question | 244-252 | `POST /questionnaires/:id/answers/files` (immediate) | "Uploading files…"; `saveFiles` re-throws uncaught, but `statusMessage` is set first |
| `QuestionInput.jsx` | Autofill button | 19-51 | `POST /document-intelligence/case/:caseId/autofill` | `disabled` while uploading, "Reading your {type}…", errors surfaced |
| `QuestionInput.jsx` | repeatable group add/remove | 113-123 | NONE (local, batched) | — |
| `ApplicantTypeSelector.jsx` | option buttons | 43-52 | NONE (local) | — |
| `ApplicantTypeSelector.jsx` | "Confirm" | 55-57 → 25-35 | `PUT /auth/updatedetails` | `disabled={saving}`, "Saving…", "Saved." toast; **`try/finally` with no `catch`** — a failed save is silent (the button merely reappears) |
| `StartAssessmentButton.jsx` | "Start Free Assessment" | 33-44 | NONE (nav) | renders `null` while loading or when `hasCase`; **does not consume `isError`**, so a transient `/cases/my` failure shows the CTA to an existing client |
| `NotificationPreferencesCard.jsx` | channel checkboxes | 55-65 | `PUT /notifications/preferences/me` | `disabled={saving===channel}`; **failures swallowed at 39-40 — the checkbox just doesn't move**. A failed *load* (22) makes the whole card `return null` (46). **Note: this component is orphaned — never imported.** |
| `BlockIfHasCase.jsx` | — | — | `GET /auth/session-context` | no controls; **fails open** by design (59) |
| `ConsultationSection.jsx` | "Request Appointment" | 110-115 → 20-40 | `POST /leads/public` | `disabled={loading}`, "Submitting…", server errors shown (109); success sets `window.location.href = mailtoUrl` (32) |
| `ConsultationSection.jsx` | "Submit another request" | 51-54 | NONE (local) | — |

#### `/admin` and `/admin/portal`

| Page | Control | Line | API | States |
|---|---|---|---|---|
| AdminLogin | password show/hide | 125-128 | NONE (local) | — |
| AdminLogin | "Access Admin Portal" | 133-139 → 45-64 | `POST /auth/login` | `loading`, disabled, "Authenticating…"; **on role-check failure the session is left authenticated — see D-06** |
| AdminPortal | sidebar section buttons ×6 | 1007-1036 | NONE (local) | — |
| AdminPortal | "Refresh" | 1101-1105 | re-runs all 6 GETs | **no loading state or disable** — overlapping batches possible |
| AdminPortal | mobile menu toggle | 1084-1087 | NONE (local) | — |
| AdminPortal | "Sign Out" | 1051-1055 → 973-976 | `POST /auth/logout` (see D-02) | navigates regardless of outcome |
| AdminPortal | Cases: search / category / status filters, row expand | 268-330, 351 | NONE (client-side over already-fetched data) | — |
| AdminPortal | "Advance Stage" per-stage buttons | 408-421 | `PUT /cases/:id` | **no in-flight disable** (only `disabled={i === stage}`); errors via `alert()` (969) | response-based local patch, no refetch |
| AdminPortal | "Advance to {next stage}" | 432-438 | `PUT /cases/:id` | same | same |
| AdminPortal | stage note input | 426-431 | NONE (submitted with the buttons above) | — |
| AdminPortal | Users / Documents / Appointments search + filters | 561-598, 637-658, 726-777 | NONE (client-side) | — |
| AdminPortal | "Mark Contacted" / "Mark Done" | 824-837 → 955-962 | `PUT /appointments/:id/status` | **no in-flight disable**; errors via `alert()` | response-based local patch |
| LeadsInbox | search / tier / status / pathway / sort | 66-71, 122-147 | NONE (client-side) | — |
| LeadsInbox | row click → drawer | 175 → `handleMarkLeadSeen` 921-926 | `POST /eligibility-quiz/leads/:id/seen` | **empty `catch`, silent by design** | local patch |
| LeadsInbox | pagination Prev/Next | 213-220 | NONE (local) | — |
| LeadsInbox | drawer close (X) | 266-268 | NONE (local) | — |
| LeadsInbox | status `<select>` | 317-321 → 928-935 | `PATCH /eligibility-quiz/leads/:id/status` | no in-flight disable; `alert()` on error | local patch |
| LeadsInbox | "Assigned to" `<select>` | 323-329 → 937-944 | `PATCH /eligibility-quiz/leads/:id/assign` | no in-flight disable; `alert()` | local patch |
| LeadsInbox | "Mark contacted" / "Mark converted" / "Close" | 335-346 | `PATCH /eligibility-quiz/leads/:id/status` | no in-flight disable; `alert()` | local patch |
| LeadsInbox | note "Add" / Enter | 400-408 → 946-953 | `POST /eligibility-quiz/leads/:id/notes` | no in-flight disable; `alert()` | local patch |
| LeadsInbox | `mailto:` / `tel:` links | 274-281 | NONE | — |

Live socket events `lead:created` / `lead:updated` (AdminPortal 902-919) patch `leads` directly, bypassing REST.

### 3.2 INSZoom staff portal

#### `/login` — `pages/Login.jsx`

| Control | Line | API | States |
|---|---|---|---|
| Password show/hide | 135-143 | NONE (local) | — |
| Login submit | 110 → 44-47 | `POST /auth/login` | `loading` disables the button, "Signing in…"; `result.message` in a red banner (104-108); client-portal roles get a specific rejection message (`AuthContext.jsx:107-112`) |

#### `/dashboard` — `pages/Dashboard.jsx`

| Control | Line | API |
|---|---|---|
| Pipeline-by-stage row | 170-187, 505-522 | NONE (nav → `/crm-cases`) |
| Needs-attention item | 259-282, 594-617 | NONE (nav) |
| Recent-activity item | 301-318, 636-653 | NONE (nav) |
| Team-workload card ×2 | 341-365, 734-758 | NONE (nav → `/case-managers/:id`) |
| Quick actions (Cases / Analytics / Leaderboard) | 393-404 | NONE (nav) |
| New-cases queue "Assign →" | 705-712 | NONE (nav → `/crm-cases/:id?assign=case_manager`) |
| **"Retry"** | 1093-1098 → 1025-1039 | re-runs all role-scoped fetches with `{force:true}` | sets `loading=true` |

`fetchNeedsAttention`, `fetchRecentActivity`, `fetchRevenueData` and `fetchTeamWorkload` (920-982) all silently reset to `[]` on failure — the widgets read as "nothing to show". `fetchDashboardStats` falls back to an all-zero `defaultStats` object (945-957), so a failed load shows zeroed KPIs alongside the error banner.

#### `/leads` — `pages/Leads.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Search / tier / status filters | 208-231 | NONE (client-side) | — | — |
| Row click (open lead) | 261-263 → 116-128 | `POST /eligibility-quiz/leads/:id/seen` | **`console.error` only — silent** | optimistic replace |
| Status `<select>` (drawer) | 419-426 → 130-137 | `PATCH /eligibility-quiz/leads/:id/status` | **`console.error` only — silent** | optimistic replace |
| "Confirm Consultation" | 441-449 → 167 | `PATCH …/confirm-consultation` | `actioning` disables; `actionError` banner (437-439) | optimistic replace |
| "Mark Completed" | 452-458 → 168 | `PATCH …/complete-consultation` | same | optimistic replace |
| "Reject" ×2 | 459-465, 477-483 → 170-174 | `PATCH …/reject` (reason via `window.prompt`) | same | optimistic replace |
| "Approve" | 470-476 → 169 | `PATCH …/approve` | same | optimistic replace |
| "Create Case" | 486-493 → 176-180 | opens `CreateCaseModal` → `POST /cases` | handled in modal | `fetchLeads()` on success |
| Note "Add" / Enter | 557-570 → 139-149 | `POST /eligibility-quiz/leads/:id/notes` | **no disabled state, `console.error` only — silent** | optimistic replace |
| Drawer close (X) | 379-381 | NONE (local) | — | — |
| `mailto:` / `tel:` | 387-394 | NONE | — | — |

#### `/crm-cases` — `pages/CRMCases.jsx`

| Control | Line | API | States |
|---|---|---|---|
| "New Case" (role-gated) | 285-293 | `POST /cases` via `CreateCaseModal` | modal handles errors; `handleCaseCreated` refetches (177-184) |
| **"Refresh Cases"** | 294-300 → 171-175 | NONE — `window.location.reload()` (documented as intentional) | — |
| Pending-assignment row / "Assign Case Manager" | 329-347 | NONE (nav) | — |
| Search (300ms debounce) | 359-366 | `GET /cases?search=` | `AbortController` cancels stale requests (123-149); `error.userMessage` banner + "Try Again" |
| Stage / status filters | 369-400 | `GET /cases?stage=&status=` | same |
| "Try Again" | 413-415 → 186-189 | re-run `fetchCases` | — |
| Row "View" (desktop + mobile) | 478-483, 585-590 | NONE (nav) | — |
| Row assign icon | 469-476, 576-583 | NONE (nav) | — |
| Pagination Prev / Next / page numbers | 605-639 | `GET /cases?page=` | disabled at bounds |

`fetchPendingQueue` (62-76) fails silently (`console.error` only), hiding the panel.

#### `/crm-cases/:id` — `pages/CRMCaseDetail.jsx` *(the largest surface in either app)*

**Per-tab fetches:** overview → `GET /questionnaires/case/:id?targetRole=…` ×3 + `GET /questionnaires/case/:id/checklists`; documents → `GET /documents?caseId=`; payments → `GET /payments?caseId=` (+120s poll, focus, socket); forms → `GET /uscis-forms/case/:caseId`; strategy → `GET /eligibility/:caseId/results`; tracking → `GET /lifecycle/cases/:caseId/tracking`; petition → lazy `PetitionTab`; **letters → no call at all (`setLetters([])`, 662-665)**.

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| "Back to Cases" | 1320-1326 | NONE (nav) | — | — |
| Copy Case ID | 1341-1352 | NONE (clipboard) | **no `try/catch` around `await navigator.clipboard.writeText`** | — |
| "Assign Staff" / "Edit Staff" | 1358-1371 | NONE (opens modal) | — | — |
| "Assign Case Manager" (amber banner) | 1389-1399 | NONE (opens modal) | — | — |
| "View matter →" / child-case "View →" | 1416-1421, 1470-1477 | NONE (nav) | — | — |
| Tab buttons ×9 | 1489-1588 | NONE (local; triggers lazy fetch) | — | — |
| **"Update Stage"** | 1600-1605 → modal "Update" 2761-2763 → 795-804 | `PUT /cases/:id/stage` | modal "Update" disabled until a stage is chosen; **no in-flight disable → double-click possible**; **`console.error` only on failure — the modal stays open with no message** | `fetchCaseDetail()` on success |
| Add-ons panel | 1020-1149 | NONE (read-only) | — | — |
| "Send Request" (Information Requests) | 1151-1203 → 533-555 | `POST /employment-workflow/:caseId/requests` | `sendingInfoRequest` disables, "Sending…", inline error (1205-1207) | merges response into `caseData` |
| Questionnaire panels ×3 | 1660-1680 | GET (per tab) | **`useCaseQuestionnaire`'s `error` is captured but never rendered** — a 403/500 makes the whole panel vanish, identical to "no questionnaire assigned" | — |
| "Open Tracking" | 1843-1845 | NONE (local tab switch) | — | — |
| "Send Message" / "Upload Document" (Quick Actions) | 1872-1893 | NONE (nav) | — | — |
| "Evaluate" / "Recalculate" (Strategy) | 1909-1912 → 681-693 | `POST /eligibility/evaluate` | `tabLoading.strategy` disables; **`console.error` only — silent failure** | sets `eligibility`, refetches case |
| Tracking fields (status, filing, RFE, notes) | 1979-2133 | NONE (buffered) | — | — |
| "Save Changes" (Tracking) ×2 | 1984-1988, 2135-2137 → 736-749 | `PUT /lifecycle/cases/:caseId/tracking` | `savingTracking` disables both, "Saving…", error banner (1991-1995) — **correctly surfaced**; but the button is shown to roles the backend rejects | refetches case + tracking |
| "Upload Document" toggle | 2189-2196 | NONE (local) | — | — |
| Upload panel "Choose Files" / "Upload Document" | 302-329 → 256-279 | `POST /documents` (multipart) | `uploading` disables, "Uploading…", inline error (275, 324) | `fetchDocuments(true)` |
| Document filename / "View" icon | 2222-2246 | `GET /documents/:id/preview` (blob) | viewer spinner + error state (207-217) | — |
| **Review `<select>` (Approve / Reject / Needs Revision)** | 2247-2256 → 806-813 | `PUT /documents/:id/review` | **no per-row spinner or disable; `console.error` only. The `<select>` resets to its "Review…" placeholder either way, and `fetchDocuments(true)` sits after the `await` inside the `try`, so it never runs on failure — a failed review is visually identical to a no-op.** | refetch only on success |
| "Refresh" (Forms) | 2291 | `GET /uscis-forms/case/:caseId` | on failure sets `formsError`, keeps prior data, explicit retry UI (2312-2330) — good | refetch |
| "Generate USCIS Forms" / "Refresh Auto Fill" | 2292-2294 → 626-645 | `POST /cases/:id/workflow/generate-forms` | `tabLoading.forms` disables, "Generating…"; `formActionMessage` shown, **but success/error styling is decided by fragile string matching on the message prefix (2303)** | `fetchCaseForms(true)` |
| "Generate Filing Package" | 2296-2298 → 647-660 | `POST /cases/:id/workflow/generate-package` | `tabLoading.forms` disables; error surfaced | refetches case + forms |
| "Retry" (forms load failure) ×2 | 2315, 2329 | same GET | — | refetch |
| "Open Form" per row | 2368-2370 | renders lazy `USCISFormRenderer` inside `FormRendererErrorBoundary` (50-82) | render crashes are caught with a "Back to forms" escape — good | — |
| "Record Payment" | 2400-2411 | NONE (opens modal; pre-generates `manual_${crypto.randomUUID()}` idempotency token) | — | — |
| Record-Payment modal submit | 2775-2833 → 815-858 | `POST /payments/:paymentId/payment` | `recordingPayment` disables all fields + submit, "Recording…"; client-side validation (817-835) and server errors share one red box (2821) — good | refetches payments + case |
| Record-Payment "Cancel" | 2823-2828 | NONE (local) | — | — |
| **"Create Letter"** (Expert Letters) | 2494-2502 → modal "Create" 2860-2862 → `handleCreateLetter` 860-863 | **DEAD/FAKE — the handler is `setShowCreateLetterModal(false); setLetterType('')`. No API call. No `letters` backend resource exists (only `PATCH /petition/packages/:id/letters/:sectionKey`, a different feature).** The modal closes as if it succeeded and the list stays empty forever. | nothing |
| Create-Letter "Cancel" / letter-type `<select>` | 2857-2859, 2846-2854 | NONE (local) | — | — |
| "Add Note" | 2566-2572 → 865-877 | `POST /cases/:id/notes` | disabled only while the textarea is empty — **no in-flight disable → double-post possible**; **`console.error` only, no message** | `fetchCaseDetail()` on success |
| "Internal note" checkbox | 2556-2564 | NONE (local) | — | — |
| Staff-details modal "Edit" | 2626-2637 | NONE (opens modal) | — | — |
| **Assign Staff modal submit** | 2654-2733 → 764-793 | `PUT /cases/:id/assign-case-manager` \| `PUT /cases/:id/assign-team-lead` | `assigning` disables, "Assigning…", `assignError` banner (2648-2653) — good | refetches; shows an `InfoModal` with the cascade count |
| Assign modal "Cancel" | 2716-2727 | NONE (local) | — | — |

#### `/companies` — `pages/Companies.jsx`

| Control | Line | API | States |
|---|---|---|---|
| Search (300ms debounce) | 58-64 | `GET /companies?search=` | `loading` only meaningfully covers the first load; `error` banner + Retry (73-77) |
| "Retry" | 76 | same GET | — |

This page is **read-only**: no create / edit / delete / status-toggle controls exist despite the backend exposing `POST /companies`, `PUT /:id`, `PUT /:id/status`, `DELETE /:id`, `POST /:id/notes`. Not a broken control, but a capability gap worth recording.

#### `/documents` — `pages/Documents.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Case list item | 555-590 | NONE (updates URL, triggers `loadDocuments`) | — | — |
| Case search | 530-539 | `GET /cases?search=` | `casesLoading` spinner; **`console.error` only on failure — silent** | refetch |
| Document search / status / category filters | 680-710 | NONE (client-side) | — | — |
| "Refresh" | 635-642 | `GET /documents?caseId=` | `docsLoading` spinner; **`console.error` only — silent** | refetch |
| "Open Case" | 643-649 | NONE (nav) | — | — |
| "Upload" toggle | 650-658 | NONE (local) | — | — |
| Upload "Choose Files" / drop zone | 306-321 | NONE (opens picker) | — | — |
| "Upload N files" | 368-378 | `POST /documents` per file | `uploading` disables, per-file progress counter, inline error (363-365) | `loadDocuments` + closes panel |
| Row "View" | 766-773 | `GET /documents/:id/preview` (blob) | modal spinner + "Download instead" fallback (175-183) | — |
| **Row "Approve"** | 776-785 → 505-510 | `PUT /documents/:id/review` | **no disable/spinner; `console.error` only; optimistic local patch applied regardless — FALSE SUCCESS on failure** | optimistic, never re-verified |
| **Row "Revise"** | 786-795 → 505-510 | same | same | same |
| Viewer "Download" | 151-156 → 91-110 | `GET /documents/:id/preview` | **`// silently fail` catch (107-109)** | — |
| Viewer zoom in/out | 134-150 | NONE (local) | — | — |

#### `pages/TaskDashboard.jsx`, `MyTasks.jsx`, `TeamTasks.jsx`, `TaskCalendar.jsx`

| Page | Control | Line | API |
|---|---|---|---|
| TaskDashboard | "Create Task" | 148-154 | NONE (nav) |
| TaskDashboard | 4 tiles (My / Team / Calendar / All) | 237-273 | NONE (nav) |
| TaskDashboard | "View All" | 281-286 | NONE (nav) |
| TaskDashboard | recent-task row | 290-293 | NONE (nav) |
| MyTasks | back arrow / "Create Task" / row click | 147-172, 260-263 | NONE (nav) |
| MyTasks | search / status / priority / category / "Clear Filters" | 186-243 | NONE (client-side) |
| TeamTasks | back / "Create Task" / row click | 153-172, 274-277 | NONE (nav) |
| TeamTasks | search / member / status / priority / category / "Clear Filters" | 186-258 | NONE (client-side; member options derived from loaded tasks) |
| TeamTasks | performance summary tiles | 345-366 | NONE (derived counts) |
| TaskCalendar | back / "Create Task" / task chip / row | 163-183, 288-342 | NONE (nav) |
| TaskCalendar | prev/next month, "Today" | 197-217 | `GET /tasks/calendar` (re-fetch) |
| TaskCalendar | status / priority filters | 222-242 | `GET /tasks/calendar` |
| TaskCalendar | day-cell click / "Close" | 262-276, 326-331 | NONE (local) |

`fetchRecentTasks` (TaskDashboard 80-82) swallows errors — the "Recent Tasks" section simply never appears. Every filter or month change in `TaskCalendar` re-shows the **full-page** spinner (150-156) rather than an inline one.

#### `/tasks/:id` and `/tasks/create` — `pages/TaskDetails.jsx`

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Back arrow | 331-336 | NONE (`navigate(-1)`) | — | — |
| "Edit" | 347-355 | NONE (local) | — | — |
| **"Delete"** | 356-361 | **DEAD — the `<button>` has no `onClick` attribute at all**, despite `DELETE /tasks/:id` existing (`task.routes.js:21`) and the button carrying the matching `super_admin`/`admin` gate | — | nothing |
| Related-case / assigned-employee selects | 384-410 | NONE (local) | — | — |
| Title / description / department / category / documentation fields | 414-590 | NONE (local) | — | — |
| "Save Changes" / "Create Task" | 592-599 → 194-230 | `POST /tasks` \| `PUT /tasks/:id` | `submitting` disables, "Saving…", `error.response?.data?.message` surfaced (226) | create → navigate; edit → `fetchTask()` |
| "Cancel" | 600-605 | NONE (local/nav) | — | — |
| "View Case" | 685-690 | NONE (nav) | — | — |
| Comment input + "Send" | 718-735 → 232-246 | `POST /tasks/:id/comments` | `submitting` disables, "Sending…", generic error (242) | refetches task |
| "Mark Complete" / "Start Progress" / "Pause" / "Cancel Task" | 746-783 → 248-256 | `PUT /tasks/:id` `{status}` | `submitting` disables all four, generic error (255) | refetches |

Also: `MoreVertical` is imported (16) and never rendered — a planned actions menu that was never built.

#### `/teams` — `pages/Teams.jsx` *(reference-quality error handling)*

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Search / role filter | 308-325 | NONE (client-side) | — | — |
| **"Add Member"** | 299-301 → 215-220 | NONE (opens modal) — **not role-gated in the UI** unlike the row-level icons | — | — |
| Add-modal "Create Member" | 486-490 → 221-229 | `POST /team-members` | `submitting` disables both buttons, spinner + "Creating…", `e.response?.data?.message` surfaced | `fetchMembers()` + toast |
| Edit icon (row, role-gated) | 371-374, 427-430 → 232-236 | NONE (opens modal) | — | — |
| Edit-modal "Save Changes" | 522-526 → 237-248 | `PATCH /team-members/:id` | `submitting` disables, "Saving…", error surfaced | `fetchMembers()` + toast |
| Toggle-active icon (role-gated) | 376-380, 432-436 → 251-257 | `PATCH /team-members/:id` `{isActive}` | **no in-flight disable**; toast on failure | `fetchMembers()` |
| Delete/Remove icon (role-gated) | 382-386, 438-442 | NONE (opens confirm modal) | — | — |
| Delete-confirm "Deactivate" | 541-545 → 260-267 | `DELETE /team-members/:id` | `submitting` disables both, "Deactivating…", toast on failure | `fetchMembers()` + toast |
| Password show/hide | 117-129 | NONE (local) | — | — |

#### `/case-managers` and `/case-managers/:id`

| Page | Control | Line | API | States |
|---|---|---|---|---|
| CaseManagers | **"Export CSV"** | 163-169 → 80-103 | NONE (client-side CSV from `caseManagers` state) — **only exports the current page of ≤10 rows, not the filtered result set the label implies** | no feedback; file downloads silently |
| CaseManagers | search (300ms debounce) | 229-235 | `GET /case-managers?search=` | first-load skeleton only (`hasLoadedOnce`) |
| CaseManagers | "Filters" toggle / status filter | 238-262 | `GET /case-managers?status=` | — |
| CaseManagers | column-header sort ×5 | 275-305 | `GET /case-managers?sortBy=&sortOrder=` | — |
| CaseManagers | row click / chevron | 313, 359-367 | NONE (nav) | — |
| CaseManagers | pagination Prev/Next | 379-417 | `GET /case-managers?page=` | disabled at bounds |
| CaseManagerDetails | back arrow ×2 | 273-293 | NONE (nav) | — |
| CaseManagerDetails | tab buttons ×5 | 444-461 | triggers the corresponding per-tab GET | — |
| CaseManagerDetails | cases search / status filter | 504-522 | `GET /case-managers/:id/cases` | — |
| CaseManagerDetails | activities date-range filter | 607-616 | `GET /case-managers/:id/activities` | — |
| CaseManagerDetails | payments status filter | 686-696 | `GET /case-managers/:id/payments` | — |
| CaseManagerDetails | pagination Prev/Next ×3 | 583-596, 641-654, 748-761 | corresponding GETs | disabled at bounds |

`CaseManagers`'s `fetchCaseManagers` catch (72-73) is `console.error` only — a 500/403 renders the exact "No case managers found" empty state (426-432). `CaseManagerDetails` has **no `error` state anywhere**: all five fetches (145, 163, 178, 194, 203) `console.error` only, and the Analytics tab is permanently stuck on `EmptyChart label="Loading case manager analytics..."` (772) after a failure. `Download` and `ChevronRight` are imported (42, 48) and never rendered.

#### `/settings` — `pages/Settings.jsx`

| Tab | Control | Line | API | States |
|---|---|---|---|---|
| General | app name, timezone, language, date format, 6 notification checkboxes | 152-293 | NONE (local until Save) | — |
| General | **"Save General Settings"** | 294-314 → 62-76 | `PUT /settings` `{general}` | `saving` disables, "Saving…"; success/error via `InfoModal`; refetches |
| Team | fields + "Save Team Settings" | 319-372 | `PUT /settings` `{team}` | same |
| AI | **provider "Enabled" checkbox** | 388-391 | `PUT /ai/providers/:key` (fires immediately) | **no `try/catch`, no disable, no feedback → unhandled rejection on failure** |
| AI | model / endpoint / RPM inputs, "Allow sensitive fields" | 395-400 | NONE (local until Save Provider) | — |
| AI | **"Save Provider"** | 401-411 | `PUT /ai/providers/:key` | **no `try/catch`, no loading state, no error surfaced** |
| AI | prompt versions / usage panels | 418-419 | NONE (read-only) | — |
| Integration | client-portal URL | — | NONE (`readOnly`) | — |
| Integration | sync mode / interval | 424-470 | NONE (local until Save) | — |
| Integration | "Test Connection" | 472-479 → 94-105 | `GET /api/health` (`app.js:70`) | `testingConnection` disables + spins; inline result banner (481-492) |
| Integration | "Save Integration Settings" | 495-507 | `PUT /settings` `{integration}` | same as General |
| Security | JWT expiry | — | NONE (`readOnly`) | — |
| Security | max login attempts / session timeout | 512-556 | NONE (local until Save) | — |
| Security | "Save Security Settings" | 557-569 | `PUT /settings` `{security}` | same as General |
| Security | "Purge Demo Data" | 581-588 → 79-92 | `DELETE /admin/demo-data` `{confirm:'DELETE_DEMO_DATA'}` | `window.confirm` gate; `purging` disables, "Purging…"; success lists deleted counts; error surfaced |
| Branding | company name / logo / address / phone / primary colour | 594-667 | NONE (local until Save) | — |
| Branding | "Save Branding Settings" | 668-683 | `PUT /settings` `{branding}` | same as General |

**Verdict on "does every settings toggle actually PUT?":** yes for General / Team / Integration / Security / Branding — every field is local-until-Save by design and every Save button reaches `PUT /settings` with matching backend permissions. The **only** unsafe writes are the two AI-provider controls (388-391 and 401-411), which write immediately but have no error path at all.

`fetchSettings` (58-60) is `console.error` only, so a 403/500 leaves every field optional-chained to a default — a silent failure disguised as defaults. The AI-tab `Promise.all` catch (45-51) writes *"Unable to load AI configuration"* into `testConnectionResult`, which is the Integration tab's connection-test banner and is never cleared between tabs — a cross-tab message bleed.

#### `/questionnaires` — `pages/QuestionnaireTemplates.jsx`

| Control | Line | API | States |
|---|---|---|---|
| "Refresh" | 294-297 | `GET /questionnaires/defaults` + `GET /questionnaires` | no per-button spinner |
| Template list item | 324-339 | `GET /questionnaires/:id` + `GET /questionnaires/:id/uscis-mappings` | selection highlight |
| "+" (new template) | 306-317 | NONE (local reset) | — |
| Title / key / visa type / status / description | 369-377 | NONE (local) | — |
| **"Save"** | 349-352 → 150-184 | `PUT /questionnaires/:id` \| `POST /questionnaires` | `disabled={saving \|\| !title.trim()}`; **no `catch`** |
| **"Duplicate"** | 353-356 → 250-258 | `POST /questionnaires/:id/clone` | **no `catch`** |
| **"Version"** | 357-360 → 260-265 | `POST /questionnaires/:id/version` | **no `catch`** |
| **"Delete" (archive)** | 361-364 → 267-273 | `DELETE /questionnaires/:id` | **no confirm dialog, no `catch`** |
| "Add" (section) | 385-386 → 186-198 | NONE (local; persisted on the next template Save) | — |
| Question form fields | 404-435 | NONE (local) | — |
| **"Add Question" / "Update Question"** | 436-438 → 200-218 | `POST /questionnaires/:id/questions` \| `PUT /questionnaires/:id/questions/:qid` | `disabled={saving \|\| !templateId \|\| !label.trim()}`; **no `catch`** |
| "Edit" (question row) | 472 → 237-248 | NONE (local) | — |
| **"Remove" (question row)** | 473 → 220-235 | `DELETE /questionnaires/:id/questions/:qid` | `window.confirm` gate; `try/finally` with **no `catch`** |
| **"Assign Questionnaire"** | 488-495 → 275-279 | `POST /questionnaires/:id/assign` | **no `catch`** |
| **"Load Progress"** | 496-500 → 281-285 | `GET /questionnaires/:id/progress?caseId=` | **no `catch`** |

The page has **no error state and no error banner of any kind**. The `message` state (300) is only ever set on success. Any 400/403/409/422/500 on any of the eight mutating actions above becomes an unhandled rejection and looks to the user exactly like a no-op click.

#### `components/CreateCaseModal.jsx`, `CaseCreatedSuccessModal.jsx`, `QuestionnaireAnswersPanel.jsx`, `layouts/Layout.jsx`, `contexts/*`, `ErrorBoundary.jsx`

| Component | Control | Line | API | States |
|---|---|---|---|---|
| CreateCaseModal | close (X) / "Cancel" | 144-150, 288-290 | NONE | — |
| CreateCaseModal | "Create Case" submit | 291-293 → 97-137 | `POST /cases` | `submitting` disables, "Creating…", `err.response?.data?.message` in a red banner (154-158) |
| CreateCaseModal | assign-CM select, visa/package/employer fields | 224-235 + | NONE (submitted with the form) | — |
| CaseCreatedSuccessModal | "OK, Thanks" / Escape | 40-47, 12-14 | NONE | — |
| QuestionnaireAnswersPanel | — | — | none (read-only renderer) | early-returns `null` when `!questionnaire` — the reason a failed fetch is invisible upstream |
| Layout | sidebar nav items | 165-187 | NONE (nav) | — |
| Layout | Logout | 192-198 → 76-79 | `POST /auth/logout` (via `AuthContext`, correctly ordered — see §4) | — |
| Layout | global search | 220-231 → 68-72 | NONE (nav → `/crm-cases?q=`) | — |
| Layout | "Refresh" header button | 237-243 | NONE (`window.location.reload()`) | — |
| Layout | notification bell | 246-260 | `GET /notifications` via context | — |
| Layout | "Mark all read" | 267-274 | `PUT /notifications/mark-all-read` | `console.error` only in the context (NotificationContext 100, 110) |
| Layout | notification item click | 301-333 → 120-124 | `PUT /notifications/:id/read`, then navigate | same |
| Layout | "Enable" push | 277-287 → 52-60 | `POST /notifications/register-device` | `enablingPush` disables, "Enabling…"; **failures swallowed by the `finally`, no message** |
| NotificationContext | 30s / 60s pollers | 126-149 | `GET /notifications/unread-count`, `GET /messages/unread-count` | `logFetchError` is `console.warn` only (36-42); **no error is ever exposed through the context value** |
| NotificationContext | `fetchNotifications` | 49 | `GET /notifications` | **defined and exported but never invoked in this file** — the provider never proactively loads the list, only the count |
| SocketContext | — | 29-70 | Socket.IO | `connect_error` only toggles `connected`; after 5 exhausted reconnection attempts it stays `false` forever with **no user-facing "offline" state** |
| ErrorBoundary | "Reload page" | 38-40 → 18-21 | NONE (`window.location.reload()`) | catches **render-phase** errors only; renders `error.message` verbatim in a `<pre>` (35-37) — a minor information-disclosure surface |

#### `/analytics` — `pages/Analytics.jsx`

Mount fetches (`Promise.all` in `fetchAllData` 63-96, re-run on `[startDate,endDate]`): `GET /analytics`, `/analytics/dashboard`, `/analytics/revenue`, `/analytics/payments`, `/analytics/processing-time`, `/analytics/rfe-trends` (71-76) — all six exist (`analytics.routes.js:10-15`).

| Control | Line | API | States |
|---|---|---|---|
| Start / end date inputs | 150-163 | re-runs all six GETs | first-load skeleton only (`hasLoadedOnce`) |
| Overview / Revenue / Team / RFE&AI tabs | 540-583 | NONE (local) | — |

One `try/catch` wraps the whole `Promise.all` (64-95): any single failure produces one generic *"Failed to load analytics data"* banner (90) with no retry button and no per-chart attribution. On a *background* refresh failure the previously-loaded charts stay stale with no indicator on them.

#### `/leaderboard` — `pages/Leaderboard.jsx`

Mount fetch: `GET /leaderboard?role=&period=` (22) — `leaderboard.routes.js:6`.

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Role `<select>` | 80-86 | refetch | **has exactly one option (`case_manager`)** — a dropdown that can never change anything | — |
| Period `<select>` | 90-98 | refetch | — | refetch |
| "Refresh" | 100-105 | `GET /leaderboard` | no busy state | refetch |
| **"Calculate Performance"** | 115-121 | `POST /leaderboard/calculate` (`leaderboard.routes.js:7`) | **`onClick={() => api.post(...)}` — the promise is never awaited, never caught. No loading state, no disable, no success feedback, no error feedback.** | **no refetch** — even on success the table keeps showing stale scores until the user clicks Refresh or changes a filter |

`fetchLeaderboard`'s catch (24-26) is `console.error` only — a 403/500/outage renders "No data available for this period", identical to a genuinely empty result.

#### `/eod-reports` — `pages/EODReports.jsx`

Mount fetch: `GET /reports/eod?period=&role=` (52) — `report.routes.js:27`.

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Period / role filters | 149-175 | refetch | — | refetch |
| "Create My Report" | 131-137 | NONE (opens modal) | — | — |
| Create-report submit | 275-343 → 65-87 | `POST /reports/eod` (`report.routes.js:28`) | `submitting` disables, "Creating…", `error` banner (182-186) | closes modal + `fetchReports()` |
| "View" / "Review" (row) | 241-253 | NONE (opens modal) | — | — |
| **"Mark as Reviewed"** | 421-427 → 89-99 | `PUT /reports/eod/:id/review` (`report.routes.js:30`) | **no in-flight disable at all** — the page-level `submitting` flag exists but is never set by this handler; error surfaced (97) | closes modal + `fetchReports()` |
| "Close" (detail modal) | 430-438 | NONE (local) | — | — |

#### `/payments` — `pages/PaymentsOverview.jsx`

Mount fetches: `GET /payments?paymentStatus=` (67); if `canViewAnalytics`, `GET /analytics/payments` (79) and `GET /analytics/revenue` (88). Live refresh via a `payment:updated` socket subscription, a 120s interval and a `visibilitychange` listener (33-55).

| Control | Line | API | States |
|---|---|---|---|
| Search input | 239-246 | NONE (client-side filter, 98-107) | — |
| Status filter | 249-259 | `GET /payments` | first-load `loading` only |
| Period select | 262-270 | `GET /analytics/payments`, `/analytics/revenue` | — |
| "View Details" (row) | 326-333 | NONE (opens modal from already-fetched data) | — |
| "Close" (modal) | 358-360, 419 | NONE (local) | — |
| "Open Case Payments" | 420-428 | NONE (nav) | — |

**All three fetch functions (61-96) are `console.error`-only. There is no user-facing error state anywhere on this page** — a 401/500/outage leaves the stat cards at zero and the table at "No payments found", indistinguishable from a genuinely empty ledger.

#### `/messages` — `pages/Messaging.jsx`

Mount fetches: `GET /messages` (501), `GET /users/assignable?includeCaseClients=true` (515). Plus: reconnect resync (546-549), a 15s safety-net poll (554-561), `GET /messages/case/:caseId` → `GET /messages/:conversationId?limit=30` on opening a case thread (569-619), `GET /users/presence?ids=` (884-886), and `PUT /messages/:id/read` per unread message on thread open (944).

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Filter chips (All / Unread / Internal) | 1126-1138 | NONE (local) | — | — |
| Conversations / Contacts tabs | 1166-1195 | NONE (local) | — | — |
| New-chat search | 1199-1206 | NONE (local) | — | — |
| Conversation / contact row | 1234-1286, 1310-1345 | `GET /messages/case/:id` for case threads | error surfaced (611); **403/404 silently drops the case from the list (598-610)** with no explanation to the user | — |
| Attach-file button + hidden input | 1554-1568 | NONE (local) | — | — |
| Drag-and-drop zone | 1359-1385 | NONE (local) | — | — |
| Internal-note checkbox | 1541-1552 | NONE (local) | — | — |
| Remove pending attachment | 1507-1513 | NONE (local) | — | — |
| **Send** (button / Enter) | 1569-1576 → 1078-1091 → 963-1071 | `POST /messages` (multipart or JSON) | optimistic bubble (992), disabled when empty, `sendError` shown (1067, 1492-1497), failed bubble becomes a retry affordance | optimistic + reconciled (1037-1056); socket live-append with de-dupe |
| Retry failed message | 365-371 → 1099-1102 | re-`dispatchMessage` | — | same |
| Cancel in-flight upload | 341-348 → 1073-1076 | `AbortController.abort()` | — | removes the pending bubble |
| Attachment click (image → lightbox, file → download) | 162-173 → 103 | `GET /messages/:messageId/attachments/:attachmentId` (blob) | per-attachment `loading`/`ready`/`error` with inline text (187, 228) | blob cache |
| Lightbox download / close | 203-208 | cached blob | — | — |
| Typing indicator | 1521-1524 → 854-874 | `POST /messages/conversations/:id/typing` | `.catch(()=>{})` ×3 — acceptable for a fire-and-forget signal | — |
| Scroll-to-top → load older | 776-798 | `GET /messages/:conversationId?limit=30&before=` | `loadingOlder` spinner (1456-1460); `console.error` only on failure (793) | prepends |
| "Retry" (full-page error) | 1152-1154 | `fetchMessages()` | — | refetch |
| Back arrow (mobile) | 1402-1408 | NONE (local) | — | — |

This is the second-strongest error-handling implementation in either app after BAIS `Messages.jsx` — a full-page error state with Retry, plus optimistic-send reconciliation and per-attachment states.

#### `/uscis-forms` — `pages/USCISForms.jsx`

Mount fetches by tab: Templates → `GET /uscis-forms` (84); Lifecycle → `GET /uscis/forms` (96) **— see D-46**; Forms → `GET /cases` (107) + `GET /uscis-forms/case[/:filterCaseId]` (121).

| Control | Line | API | States | Persists |
|---|---|---|---|---|
| Tabs (Templates / Case Forms / Lifecycle) | 382-415 | per-tab refetch | page-level `loading` blocks the whole page (358-364) | — |
| "Check for Updates" (super_admin) | 509-514 → 136-145 | `POST /uscis/forms/scan` (falls through correctly to the lifecycle scanner) | **no busy indicator**; `setError` on failure | refetches |
| "Import PDF" / "Import Definition" / "Add Template" | 515-538 | NONE (open modals) | — | — |
| "Import From URL" | 808 → 252-275 | `POST /uscis/forms/import` (**resolves to the import module, not the lifecycle module — see D-46**) | **no per-button busy state**; inline result banner (786-805) | refetches |
| "Upload PDF" | 809 → 220-250 | `POST /uscis/forms/upload` (multipart) | no busy state; inline banner | refetches |
| "Validate" (definition) | 850 → 195-204 | `POST /uscis-forms/definitions/validate` | no busy state; inline banner | — |
| "Import Definition" | 851 → 206-218 | `POST /uscis-forms/definitions/import` | no busy state; inline banner | closes modal, refetches |
| Add-Template submit | 946 → 277-296 | `POST /uscis-forms` | no busy state; `setError` | closes modal, refetches |
| Edit-Template submit | 1042 → 298-308 | `PUT /uscis-forms/:id` | no busy state; `setError` | closes modal, refetches |
| "Approve" (pending_review) | 573-579 → 167-175 | `PUT /uscis-forms/:id/approve` | no busy state; `InfoModal` on success. **UI gates this to super_admin only; the backend also permits admin** — the UI is stricter than the backend | refetches |
| "Archive" | 584-589 → 177-184 | `PUT /uscis-forms/:id/archive` | no busy state | refetches |
| Edit (pencil) icon | 591-609 | NONE (opens modal) | — | — |
| Delete (trash) icon | 610-615 → 310-318 | `DELETE /uscis-forms/:id` | `confirm()` gate; no busy state | refetches |
| "Fill Form" / submit | 656-662, 1098 → 320-332 | `POST /uscis-forms/case/:caseId` | no busy state; `setError` | closes modal, refetches |
| "View" (case-form row) | 697-706 | NONE (renders `filledData` JSON from the already-fetched row) | — | — |
| Lifecycle "Compare" | 463 → 157-165 | `GET /uscis/forms/:formCode/compare/:id` (3 segments → falls through correctly to lifecycle) | no busy state | — |
| Lifecycle "Approve" | 465 → 147-155 | `POST /uscis/forms/:id/approve` (falls through correctly to lifecycle) | no busy state | refetches |
| **Lifecycle "Activate"** | 468 → 147-155 | `POST /uscis/forms/:id/activate` — **captured by the import module, not the lifecycle module (D-46)** | no busy state | refetches |
| **Lifecycle "Retire"** | 471 → 147-155 | `POST /uscis/forms/:id/retire` — **captured by the import module (D-46)** | no busy state | refetches |
| Case-form filter dropdown | 643-654 | refetch | — | refetch |
| `InfoModal` close | 1157-1163 | NONE | — | — |

Every handler on this page writes into a single page-level `error` string (23) rendered once at the top (374-378), so concurrent errors overwrite each other. **None of the mutation buttons (create / update / delete / approve / archive / fill / scan / import) has an in-flight disable**, so every one of them is double-clickable.

#### `components/uscis/USCISFormRenderer.jsx`

Mount: `GET /uscis-forms/case/:caseId/:formId/workspace` (544); template background PDF `GET /uscis-forms/:templateId/pdf` (673, non-fatal — warning banner if it fails, 679).

| Control | Line | API | States |
|---|---|---|---|
| Back arrow | 1222 → 1167-1170 | auto-saves then closes | — |
| Save-failed badge (click to retry) | 1238-1246 | `savePendingChanges` | "Retrying save…" |
| Undo / Redo | 1252-1253 | `PATCH …/workspace/field` | disabled when the stack is empty or `!canEdit` |
| "Save & Download Fillable PDF" | 1254-1263 → 1109-1128 | `GET /forms/:caseFormId/draft-pdf` (blob) | `busy==='download-draft'` |
| "Download filing copy" | 1264-1275 → 1134-1153 | `GET /forms/:caseFormId/filing-pdf` (blob) | `busy` gated, status gated |
| "Refresh" | 1276 → 1056-1059 | `POST …/workspace/refresh` | spinning icon |
| "Approve Form" | 1277 → 990-997 | `POST …/workspace/decision` | via `action()` |
| "Generate PDF" | 1278 → 1061-1064 | `POST /forms/:caseFormId/generate` | `busy==='generate-pdf'` |
| "Preview PDF" | 1279 → 1066-1082 | `GET /forms/:caseFormId/preview` (blob) | `busy==='preview-pdf'` |
| "Download PDF" | 1280 → 1084-1105 | `GET /forms/:caseFormId/download` (blob) | `busy==='download-pdf'` |
| "Lock" / "Unlock" | 1281-1282 | `POST …/workspace/lock` | via `action()` |
| Left-panel toggle / page-jump / zoom / "next problem" (F8) | 1302, 1334, 1407-1417, 1375 | NONE (local; page-jump auto-saves first) | — |
| Field overlay inline edit | 341-350 → 917-925 | `PATCH …/workspace/field` | `saveState` badge; **3-attempt exponential backoff** (74, 732-756) before surfacing an error |
| Native PDF AcroForm field | 766-796 | `PATCH …/workspace/field` | per-field `fieldSaveStatus` outline classes |
| "Approve Section" / "Needs Revision" | 1518-1519 → 979-988 | `POST …/workspace/section/review` | via `action()` |
| "Use canonical value" (merge conflict) | 1563 → 1044-1054 | `POST …/workspace/conflict` | via `action()` |
| "Use canonical value" / "Keep my edit" (field conflict) | 1581-1582 → 1034-1042 | `POST …/workspace/field/resolve-conflict` | both disabled while `busy===conflict:<field>` |
| "Verify" / "Needs Review" (field) | 1588-1589 → 968-977 | `POST …/workspace/field/review` | via `action()` |
| "Reset Auto Fill" | 1590 → 1025-1029 | `POST …/workspace/reset` | via `action()` |
| "Create Task" | 1591 → 1012-1023 | `POST …/workspace/tasks` | via `action()` |
| "Restore previous value" (history) | 1643 | `POST …/workspace/history/:historyId/rollback` | via `action()` |
| "Mark resolved" (comment) | 1657 | `PATCH …/workspace/comments/:commentId/resolve` | via `action()` |
| "Add internal comment" | 1661 → 999-1010 | `POST …/workspace/comments` | disabled when empty |
| "Request Changes" / "Reject" | 1670-1671 | `POST …/workspace/decision` | via `action()` |
| Ctrl+S / Ctrl+Z / Ctrl+Y / F8 | 1182-1203 | same handlers | — |
| `<input onChange={() => {}}>` | 495 | **DEAD no-op handler** (vestigial) | — |

This is the **best-engineered surface in either app**: every action funnels through `action()` (sets `busy`, catches, sets `errorMessage`), field autosave has explicit retry-with-backoff, and a `beforeunload` guard warns on unsaved changes (588-597).

#### Petition suite — `pages/petition/*`

`PetitionTab.jsx` is a URL-syncing shell (21-24), no API calls. `PetitionCanvas.jsx`, `PetitionOutline.jsx`, `ExhibitSheet.jsx`, `FormSheet.jsx`, `PdfDocumentPages.jsx` are rendering/orchestration only and delegate all writes upward.

| Component | Control | Line | API | States | Persists |
|---|---|---|---|---|---|
| PetitionVersionList | "Assemble Petition" / "Assemble New Version" | 71-76 → 42-54 | `POST /petition/cases/:caseId/assemble` | `assembling` disables + spinner; `assembleError` banner (84-88) | reloads list, opens the new package |
| PetitionVersionList | row click / "Open" | 110, 122-124 | NONE (nav — sets the `pkg` query param) | — | — |
| PetitionViewer | "PDF" / "Word" download | 120-125 → 63-79 | `GET /petition/packages/:id/download?format=` (blob) | `downloading` disables both, spinner | browser download |
| PetitionViewer | "Finalize" / "Unlock" / "Record Filing" | 126-139 | NONE (open modals) | — | — |
| PetitionViewer | Close (X) | 141-143 | NONE (nav, clears `?pkg=`) | — | — |
| PetitionViewer | Conflict banner "Reload" / "Dismiss" | 151-152 | `GET /petition/packages/:id` / NONE | — | refetch |
| PetitionOutline | section link | 15-26 → 53-56 | NONE (local scroll) | — | — |
| PetitionOutline | **exhibit drag-reorder** | 58-66 → `usePetitionPackage.js:69-89` | `PATCH /petition/packages/:id/exhibits/order` | optimistic (71-79); reverts on failure (85) and **re-throws — but `handleDragEnd` never awaits or catches it**, so a non-409 failure is an unhandled rejection with no banner | reverts locally |
| LetterSheet | rich-text editing (Tiptap `onUpdate`) | 36-39 | `PATCH /petition/packages/:id/letters/:sectionKey` (800ms debounce) | per-section `saveStates`; a `readyRef` guard (24-30) correctly suppresses the initial-mount normalization transaction | optimistic, then persisted |
| LetterSheet | save-state indicator | 96 | — | shows *"Not saved — retry"* but **"retry" is plain text, not a control** — the only way to retry is to type again | — |
| RichTextToolbar | Bold / Italic / Underline / H1-H3 / lists / align / clear / undo / redo | 42-55 | NONE directly — all `editor.chain()…run()` | **Verified NOT fake:** every toolbar command mutates the Tiptap document, which fires the same `onUpdate` → debounced `PATCH …/letters/:sectionKey` path as typed text, so formatting genuinely persists | persisted via the letter autosave |
| LetterSheet | cover-letter "Index of Exhibits" table | 72-93 | NONE — derived and read-only by design (75) | — | — |
| ValidationPanel | issue row | 14-23 | NONE (local scroll) | — | — |
| FinalizeModal | confirm | 13-22 → 81-87 | `POST /petition/packages/:id/finalize` | `submitting` disables both, "Finalizing…", inline error | replaces `pkg`, refreshes validation, `onChanged` |
| UnlockModal | confirm | 11-20 → 89-94 | `POST /petition/packages/:id/unlock` | `submitting`; `disabled` until a reason is typed (42); inline error | replaces `pkg`, `onChanged` |
| FilingForm | "Record Filing" | 97-99 → 96-100 | `POST /petition/packages/:id/filing` | `submitting`, inline error | replaces `pkg`, `onChanged` |
| FilingForm | "Save Receipt" | 101-103 → 102-106 | `POST /petition/packages/:id/receipt` | `submitting`; disabled until a receipt number is typed | replaces `pkg`, `onChanged` |
| FilingForm | "Close" | 95 | NONE | — | — |
| FormSheet | "Edit on Forms tab" | 31-33 | NONE (`<a href>`; the sheet is read-only by design, 7) | — | — |

`PetitionViewer`'s download failure message is a static *"That output has not been assembled yet."* (75) regardless of whether the cause was a 404, a 500 or a network failure. The `GET /petition/definitions/:key` fetch (48) fails silently to `null`, so the package quietly falls back to default section naming/ordering with no indication.

---

## 4. TASK 3 — Session / refresh / routing (§27, frontend half)

### 4.1 BAIS — token model

`BAIS/Frontend/src/services/api.js`:
- The access token lives **only in a module-scoped variable** (`let accessToken = null`, api.js:41) — it does not survive a page load.
- `localStorage` holds only a non-sensitive marker, `bais_has_session = "1"` (api.js:7, 29-33).
- The refresh token is an httpOnly cookie set by the backend; JS never sees it.
- `request()` (api.js:71-148) performs a **just-in-time refresh**: if there is no in-memory token but `tokenStore.hasSession()` is true, it calls `refreshAccessToken()` first (api.js:78-90). Concurrent callers share a single `refreshPromise` (api.js:43, 81-84, 121-123), so same-tab refresh is correctly single-flighted.
- A 25s `AbortSignal.timeout` bounds every request (api.js:69, 99) — this is why no BAIS page can hang forever at the fetch layer.

### 4.2 BAIS — **hard refresh (F5) is broken** (D-01, Critical)

`AuthContext.verifySession()` (`context/AuthContext.jsx:58-87`) begins:

```js
const access = tokenStore.getAccess();
if (!access) {
  setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
  return;
}
```

After any hard refresh the in-memory `accessToken` is `null`, so this branch fires **unconditionally**. It never checks `tokenStore.hasSession()`, never calls `/auth/me`, and therefore never reaches the refresh path inside `request()`. The mount effect (AuthContext.jsx:100-104) runs `verifySession()` exactly once and nothing re-runs it — the only other caller is `ProtectedRoute`'s manual Retry button, and `ProtectedRoute` is no longer in the route tree.

Net effect after every F5 of an authenticated page:
- `authStatus` is permanently `"unauthenticated"` and `user` is permanently `null`.
- **`Navbar` renders the logged-out "Login / Sign Up" pair** (`Navbar.jsx:188`, `269-289`) for a user with a perfectly valid session. The nav links `Dashboard` / `Messages` / `Payments` also disappear, because `Navbar`'s `sessionContext()` effect is gated on `if (!user) return` (`Navbar.jsx:124`).
- **`SocketProvider` never connects** — its effect early-returns on `if (!user?._id)` (`context/SocketContext.jsx:24`). Live messages, typing indicators and notification pushes are silently dead after any refresh.
- **`useHasCase()` returns `{hasCase:false}`** (`hooks/useHasCase.js:38`, `enabled: Boolean(userId)`), so `BlockIfHasCase` lets an existing client retake the eligibility quiz.
- The page body itself still renders, because `AuthGate` has its own independent `authApi.sessionContext()` call (`AuthGate.jsx:47`) which goes through `request()` and *does* trigger the refresh. So the user sees a working dashboard framed by a logged-out navbar — the worst kind of half-broken.

The irony is that the code comment at `AuthContext.jsx:44-56` describes exactly this symptom ("Navbar renders purely off `user` … showed Login/Sign Up indefinitely for an actually-valid session") and fixes only the slow-backend variant, not the missing-token-after-refresh variant.

**Initialization race:** there is no *transient* flash — the unauthenticated state is not a flash, it is permanent for the life of the page. `authStatus` never returns to `loading`, so no spinner is shown either.

**Fix shape:** in `verifySession`, replace the early return with `if (!access && !tokenStore.hasSession()) { setAuthStatus(UNAUTHENTICATED); return; }`, letting `authApi.me()` drive the refresh.

### 4.3 BAIS — logout does not revoke the server session (D-02, Critical)

```js
const logout = useCallback(async () => {
  await unregisterCurrentDevice().catch(() => {});
  clearSession();                      // AuthContext.jsx:149
  await authApi.logout().catch(() => {}); // AuthContext.jsx:150
}, [clearSession]);
```

`clearSession()` (AuthContext.jsx:34-38) calls `tokenStore.clear()`, which nulls the in-memory access token **and removes `bais_has_session`** (api.js:34-38). The subsequent `authApi.logout()` therefore enters `request()` with `token === null` and `hasSession() === false` (api.js:78-79), so it attaches **no `Authorization` header**.

`POST /api/auth/logout` is declared as `router.post("/logout", authenticate, …)` (`Backend/src/modules/auth/auth.routes.js:53`). The `authenticate` middleware rejects the unauthenticated request with a 401, so the controller body never runs — meaning `sessionService.revokeSession(incomingRefreshToken)` and `clearRefreshCookie(res)` (`auth.controller.js:254-256`) are both skipped. The `.catch(() => {})` swallows the 401 entirely.

**Consequences:** the `AuthSession` row stays `revokedAt: null` and the httpOnly refresh cookie stays in the browser for the full `refreshTokenTtlDays`. Any subsequent `POST /auth/refresh` — from another tab, from a bookmark, or from the app itself once `bais_has_session` is re-set — mints a fresh valid session for a user who believes they signed out. On a shared machine this is a real account-takeover vector.

INSZoom does **not** have this bug: `contexts/AuthContext.jsx:131-143` sends the logout with an explicit `Authorization` header and only calls `clearSession()` in the `finally`.

### 4.4 BAIS — direct-URL navigation to a protected route

`AuthGate` (`components/AuthGate.jsx`) fetches `GET /auth/session-context` once on mount (`[]` deps, line 69) and renders a spinner meanwhile (81-87). Outcomes:
- **401** → `<Navigate to="/login" state={{from: location}} />` (103). Note that nothing ever consumes `state.from`, so the post-login destination is not restored.
- **Non-401 error** → a static "We're having trouble connecting / please refresh the page" screen (90-99) with **no retry button** — the user must refresh manually.
- **Staff role** → `window.location.href = INSZOOM_URL` from an effect (76-78), with the loading spinner shown meanwhile.
- **Unknown role** → "Access unavailable" (106-115).
- **`mustSetPassword`** → redirect to `/accept-invite` (131-136).
- **Employee/beneficiary** → confined to `/dashboard`, `/dashboard/documents`, `/dashboard/profile` (28-32, 146-151).
- **Client with a case** → renders; bounced out of `/onboarding/intake` only.
- **Client, no case, legacy** → `/legacy-holding`.
- **Client, no case, not legacy** → `/onboarding/intake`.

Because `AuthGate` is a layout-route element, one instance stays mounted across all its child routes, so `session-context` is fetched once per *entry into a route group*, not per navigation. There are two separate `AuthGate` declarations (App.jsx:77 and App.jsx:99), so moving between `/dashboard*` and `/onboarding/intake` does remount and refetch — which is what keeps the post-intake `hasCase` transition correct.

Duplicate call: `Navbar` independently fetches `GET /auth/session-context` (`Navbar.jsx:125`) on every `user` change, so an authenticated page load issues this endpoint twice.

### 4.5 BAIS — token expiry / 401 handling

`request()` (api.js:118-135): on a 401 whose body carries `code === "TOKEN_EXPIRED"`, it refreshes once and replays the request with `retry=false`. Any other 401, or a failed refresh, clears the token store and dispatches `window.dispatchEvent(new Event("bais:session-expired"))`. `AuthContext` listens for that event and calls `clearSession()` (AuthContext.jsx:107-111). This part is correct.

`tokenStore.getAccess()` (api.js:13-28) additionally decodes the JWT payload and treats an `exp` in the past as "no token", so an expired token is never sent.

### 4.6 INSZoom — token model and hard refresh

`INSZoom/frontend/src/services/api.js`: the access token is also memory-only (`let accessToken = null`, line 13); `localStorage` holds only `loginTime` and legacy keys that are proactively removed on load (15-16). Timeout is 120s (line 9).

`contexts/AuthContext.jsx:36-101` handles refresh **correctly**, unlike BAIS:
- On mount `token` is `null`, so the `else` branch runs `POST /auth/refresh` with `_skipAuthRedirect: true` (line 70) — the flag prevents the response interceptor's hard `window.location.href = '/login'` (api.js:119-121) from firing during bootstrap.
- On success it `setToken(...)` and **returns without setting `loading = false`** (72-76), so the effect re-runs with a token and fetches `/auth/me`. `ProtectedRoute` shows "Loading…" throughout (`ProtectedRoute.jsx:16-22`), so **there is no flash of the login state**.
- On refresh failure it `clearSession()` and `setLoading(false)` → `<Navigate to="/login" replace />`.

An `authVersionRef` guard (21, 25-27, 38-39) correctly discards results from a stale auth check after a login/logout, so a slow in-flight `/auth/me` cannot clobber a newer session.

**Defect (High):** the `/auth/me` catch is a blanket `clearSession(authVersion)` (AuthContext.jsx:65-67) with **no distinction between a real 401 and a 5xx / network failure**. A transient backend blip during bootstrap therefore force-logs-out a user with a perfectly valid session and bounces them to `/login`. BAIS explicitly engineered around this exact failure mode (its four-state `AUTH_STATUS` machine with a distinct `ERROR` state, AuthContext.jsx:7-18); INSZoom did not.

### 4.7 INSZoom — session timer, direct-URL navigation, logout

- A client-side 7-day `SESSION_DURATION` check runs on mount and on a 60s interval (`AuthContext.jsx:23, 44-52, 87-95`). Because `refreshAccessToken()` rewrites `loginTime` on every silent refresh (`api.js:36`), an active user's 7-day clock is reset indefinitely; the real bound is the server-side refresh-token TTL. This is a soft/cosmetic control, not a security boundary.
- `logout()` in the 60s interval closure (line 92) is not in the effect's dependency array (line 101), but the closure captures the current-render `const`, so it resolves correctly at fire time.
- Direct-URL navigation: `ProtectedRoute` renders "Loading…" until auth resolves (16-22), then `<Navigate to="/login" replace />` if unauthenticated, or `<Navigate to="/dashboard" replace />` on a role/permission/module failure. There is an explicit guard against redirecting the `dashboard` module to itself (49) to avoid an infinite loop. There is **no "from" preservation**, so a deep link is lost across login.
- Logout is correctly ordered (131-143) and clears the session in a `finally`.

### 4.8 Verification of ISSUE-007 — **STILL PRESENT** (D-04)

`docs/forms/issues/ISSUE-007-auth-refresh-session-rotation-race.md` proposed three fixes. All three are **unimplemented in the current code**:

| Proposed fix | Current state | Evidence |
|---|---|---|
| 1. Make `rotateSession` atomic (single conditional `findOneAndUpdate`) | **Not done.** Still `AuthSession.create(replacement)` → then load-then-save on the original document. | `Backend/src/modules/auth/session.service.js:30-42` — verbatim `session.revokedAt = new Date(); session.replacedBy = replacement._id; await session.save();` |
| 2. Return the existing replacement on losing the race instead of a 500 | **Not done.** `refresh()` calls `rotateSession` unguarded, with no idempotent-reuse branch. | `Backend/src/modules/auth/auth.service.js:326-346` |
| 3. Add a `VersionError` branch to `errorHandler.js` | **Not done.** `isDatabaseUnavailableError` still checks only the 7 Mongo driver names plus code 50; `VersionError` is not among them and falls through to `status = error.status \|\| error.statusCode \|\| 500`. | `Backend/src/middleware/errorHandler.js:12-30, 51`. A repo-wide grep finds `VersionError` only in comments and tests — never in any handler. |

The orphaned-session side effect described in the issue also still applies: the losing caller's `AuthSession.create(replacement)` has already committed before the failing `save()`.

**Frontend exposure and mitigation:**
- Both frontends single-flight their refresh through a module-scoped `refreshPromise` (BAIS `api.js:43, 81-84, 121-123`; INSZoom `api.js:12, 126-128`), which removes the *same-tab* concurrent-refresh trigger. This is real mitigation, and it is why the bug is intermittent rather than constant.
- It does **not** cover the cross-tab case: two tabs of the same portal (or one BAIS tab and one INSZoom tab, if the refresh cookie is scoped to a shared parent domain) each hold their own module scope and their own `refreshPromise`, and both send the same still-valid refresh cookie. That is exactly the race the issue describes.
- **When the race is lost, the user is logged out.** BAIS's `refreshAccessToken` treats any non-`res.ok` — the 500 included — as terminal: `tokenStore.clear(); throw new Error("Session expired")` (api.js:53-56), which propagates to `bais:session-expired` and wipes the session (api.js:86-88, 128-130). INSZoom's is the same shape: the axios rejection is caught at `api.js:133`, `clearStoredSession()` runs, and line 139-141 hard-navigates to `/login`. So the observable symptom of ISSUE-007 is **random forced logouts with a full page navigation**, which is materially worse than a retryable error.

**Recommendation:** fix (1) server-side as the issue specifies; do not add a client-side retry on 500 (the issue explicitly argues against it, and a blind retry would race a third caller).

---

## 5. TASK 4 — Error handling (§26, frontend half)

### 5.1 What the shared transport layer guarantees

| Condition | BAIS (`services/api.js`) | INSZoom (`services/api.js`) |
|---|---|---|
| Backend unreachable | `TypeError` → `"Unable to reach the server. Check your connection and try again."`, `error.isNetworkError` (108-115) | axios network error; no `error.response`, so any handler reading only `error.response?.data?.message` gets `undefined` |
| Timeout | `AbortSignal.timeout(25 000)` → `"The server took too long to respond."`, `error.isTimeout` (69, 99-107) | `timeout: 120_000` → `error.userMessage` set on `ECONNABORTED` (9, 114-116) |
| 401 `TOKEN_EXPIRED` | silent refresh + single replay (118-132) | silent refresh + single replay (122-135) |
| 401 other | clear + `bais:session-expired` event (133-134) | clear + hard `window.location.href = '/login'` (136-141) |
| 4xx/5xx | `error.status`, `error.code`, `error.message` from the JSON body (137-143) | `error.response.data`; Blob error bodies from `responseType:'blob'` are re-hydrated to JSON (100-108, 117) — a genuinely good fix |

Because BAIS bounds every request at 25s and INSZoom at 120s, **no page in either app can hang forever at the fetch layer**. Every "infinite spinner" finding below is a *state-machine* bug, not a transport hang.

Critically, `error.userMessage` is only read by `CRMCases.jsx:151` in the entire INSZoom app. Every other INSZoom handler reads `error.response?.data?.message`, which is `undefined` for a network failure or a timeout — so those failures fall back to a generic string at best, and to nothing at all in the many `console.error`-only handlers.

### 5.2 Status-code differentiation

Across both apps, **exactly two** places branch on a specific HTTP status:
- `BookConsultation.jsx:46-52` — special-cases 409 (slot taken) with an amber banner and an automatic slot refetch. This is the single best error-handling instance in either codebase.
- `ResetPassword.jsx:36-38` — string-matches "invalid or expired" to flip into a dedicated state.

Everywhere else, 400 / 403 / 404 / 409 / 422 / 500 / timeout / offline collapse into one generic sentence per feature — or into nothing. `Leads.jsx:151-153` even carries a comment acknowledging that 409 lead-status conflicts are a real case, without handling them distinctly.

### 5.3 Failures that produce a blank screen, an infinite loading state, or a false success

| Symptom | Location | Detail |
|---|---|---|
| **Permanent fake "Loading…"** | `CaseManagerDetails.jsx:203-204, 772` | The Analytics tab renders `EmptyChart label="Loading case manager analytics..."` whenever `analytics` is null. The fetch's catch is `console.error` only and never sets `analytics`, so on any failure the tab claims to be loading forever. |
| **Blank page** | `App.jsx` (both apps) | No `path="*"` route in either app. An unknown URL renders nothing in BAIS, and the Layout chrome with an empty outlet in INSZoom. |
| **Whole component vanishes** | `NotificationPreferencesCard.jsx:20-23, 46` | Failed preferences load → `preferences` stays `null` → `return null`. Indistinguishable from "feature not applicable". |
| **Whole panel vanishes** | `CRMCaseDetail.jsx:1660-1680` + `QuestionnaireAnswersPanel.jsx` | `useCaseQuestionnaire`'s `error` is captured and never rendered; the panel early-returns `null`. A 403/500 looks like "no questionnaire assigned". |
| **Entire admin dashboard blanks** | `AdminPortal.jsx:874-894` | `Promise.all` of 6 endpoints, `console.error`-only catch, no `loading` state. One failure leaves all six sections at their initial `[]`/`null` and every section renders its "nothing here yet" empty state. |
| **False success (cancel)** | `ManageBooking.jsx:121-128` | `cancelMutation.mutate(reason); setMode("view");` — the mode flips synchronously, before the mutation resolves, and there is no `onError` anywhere on the page. |
| **False success (reschedule)** | `ManageBooking.jsx:100-108` | `rescheduleMutation` has no `onError` and no `isError` rendering. A 409/400/500 is entirely invisible. |
| **False success (handoff)** | `EmployeeHandoffModal.jsx:64-71` | `onChooseFillMyself(); onClose();` — a real `PUT` fired without `await` and without a failure path; the modal closes as if it worked. |
| **False success (document review)** | `Documents.jsx:505-510` (INSZoom) | Approve/Revise optimistically patch local state and only `console.error` on failure, so a rejected `PUT /documents/:id/review` shows the new status as if it saved. |
| **Indistinguishable no-op (document review)** | `CRMCaseDetail.jsx:806-813` | The review `<select>` resets to its placeholder whether the `PUT` succeeded or threw; `fetchDocuments(true)` sits after the `await` inside the `try`, so it never runs on failure. |
| **Silent stage update failure** | `CRMCaseDetail.jsx:795-804` | `console.error` only; the modal stays open with no message and no in-flight disable, inviting a duplicate `PUT`. |
| **False-empty (notifications)** | `NotificationBell.jsx:53-58`; `Notifications.jsx:24-27` | A failed load renders the same "No notifications yet" as a genuinely empty inbox. |
| **False-empty (messages)** | `Messages.jsx:401-409, 431-452` | Explicitly commented "silently fail" catches on the two primary fetches. A backend outage presents as an empty inbox. |
| **False-empty (case managers)** | `CaseManagers.jsx:72-73` | `console.error` only → "No case managers found". |
| **False-empty (consultation slots)** | `BookConsultation.jsx` | `slotsData?.slots || []` — a failed slots fetch renders "no available dates". |
| **False-empty (child cases)** | `PrincipalCaseWorkspace.jsx:33-52` | `console.error` only → "No employees on this case yet." |
| **False-empty (recent tasks)** | `TaskDashboard.jsx:80-82` | Section is gated on `recentTasks.length > 0`, so a failure hides it entirely. |
| **False-empty (payments ledger)** | `PaymentsOverview.jsx:61-96` | All three fetches are `console.error` only — zeroed stat cards plus "No payments found", with financial data presented as authoritative. |
| **False-empty (leaderboard)** | `Leaderboard.jsx:24-26` | `console.error` only → "No data available for this period". |
| **Permanently wrong counter** | `USCISForms.jsx:420-423` (via D-46) | The Lifecycle tab's "Pending Reviews" card always shows 0, because the shadowing handler's `dashboard` object has no `pendingReviews` key. |
| **Formatting-only-looking control that is actually persisted** *(verified NOT a defect)* | `RichTextToolbar.jsx:42-55` | Every toolbar command mutates the Tiptap document, which fires the same `onUpdate` → debounced `PATCH …/letters/:sectionKey` as typed text. Recorded here because it was the obvious fake-control candidate and was cleared. |
| **Plausible-but-wrong KPIs** | `Dashboard.jsx:819-861` (BAIS); `Dashboard.jsx:920-982` (INSZoom) | `.catch(() => {})` / silent `[]` resets on the supporting fetches → "0 documents", "$0.00 paid", empty pipeline, with no error indicator. |
| **Silent settings load failure** | `Settings.jsx:58-60` | `settings` stays `null`, every field optional-chains to a default. Looks like a fresh install. |
| **Mislabelled terminal state** | `PaymentSuccess.jsx:70` | Polling stops after 60s while the copy still says "This page will update automatically…". |
| **Network failure reported as bad credentials** | `Login.jsx:96` | A timeout or offline error falls through every `msg.includes(...)` branch to "Please check your credentials". |
| **CSV under-export** | `CaseManagers.jsx:80-103` | "Export CSV" exports only the current ≤10-row page, silently. |
| **Cross-tab message bleed** | `Settings.jsx:45-51` | An AI-tab load failure writes into `testConnectionResult`, the Integration tab's connection-test banner, which is never cleared between tabs. |

### 5.4 Handlers with no `catch` at all (unhandled promise rejections, zero user feedback)

| Location | Operation |
|---|---|
| `Login.jsx:101-109`, `Register.jsx:231-239` | `POST /auth/resend-invite` |
| `DocumentReview.jsx:24-34` | `PUT /document-intelligence/:id/field`, `POST …/approve`, `POST …/reject` |
| `Documents.jsx:268-279` (BAIS) | `PUT /employment-workflow/:id/employee-questionnaire` |
| `Notifications.jsx:29-37` (BAIS, orphaned page) | `PUT /notifications/:id/read`, `PUT /notifications/mark-all-read` |
| `NotificationBell.jsx:43-51` | `POST /notifications/register-device` |
| `ApplicantTypeSelector.jsx:25-35` | `PUT /auth/updatedetails` |
| `CRMCaseDetail.jsx:1341-1352` | `navigator.clipboard.writeText` |
| `Settings.jsx:388-391, 401-411` | `PUT /ai/providers/:key` ×2 |
| `QuestionnaireTemplates.jsx` — `saveTemplate` (150-184), `duplicateTemplate` (250-258), `versionTemplate` (260-265), `archiveTemplate` (267-273), `saveQuestion` (200-218), `removeQuestion` (220-235), `assignTemplate` (275-279), `loadProgress` (281-285) | 8 mutating operations, no error mechanism on the page at all |
| `Leaderboard.jsx:115-121` | `POST /leaderboard/calculate` — inline `onClick={() => api.post(...)}`, never awaited |
| `PetitionOutline.jsx:58-66` | `PATCH /petition/packages/:id/exhibits/order` — `usePetitionPackage.js:85` re-throws into a caller that neither awaits nor catches |

### 5.5 Write controls with no in-flight disable (double-submit risk)

`AdminPortal.jsx` "Advance Stage" (408-421) and "Advance to next stage" (432-438), "Mark Contacted"/"Mark Done" (824-837), "Refresh" (1101-1105); `LeadsInbox.jsx` status select (317-321), assign select (323-329), quick-action buttons (335-346), note "Add" (400-408); `Notifications.jsx` (BAIS) "Mark read"/"Mark all read" (63-68, 113-118); `Payments.jsx` "Download receipt" (360-366); `CRMCaseDetail.jsx` "Update Stage" (2761-2763), review `<select>` (2247-2256), "Add Note" (2566-2572); `Documents.jsx` (INSZoom) Approve/Revise (776-795); `Teams.jsx` toggle-active (376-380); `Settings.jsx` AI provider checkbox (388-391); `PrincipalCaseWorkspace.jsx` "Remove this employee" (115-121); **every** mutation button on `USCISForms.jsx` (create, update, delete, approve, archive, fill, scan, and all four import actions — 136-332); `EODReports.jsx` "Mark as Reviewed" (421-427); `Leaderboard.jsx` "Refresh" (100-105) and "Calculate Performance" (115-121).

### 5.6 Blocking `alert()` / `confirm()` / `prompt()` used as the error or confirmation surface

`Payments.jsx:154-177` (BAIS), `Offers.jsx:140,143`, `AdminPortal.jsx:960,969` and every `LeadsInbox` write handler (933, 942, 951), `PrincipalCaseWorkspace.jsx:70`, `Leads.jsx:170-174` (`window.prompt` for a rejection reason), `Settings.jsx:79-92` (`window.confirm` — appropriate here), `QuestionnaireTemplates.jsx:220-235` (`window.confirm` for question removal, but **no confirm at all on template archive**, 267-273).

---

## 6. Defects Found — ranked by severity

### Critical

| ID | Defect | Location | Impact |
|---|---|---|---|
| **D-01** | Hard refresh permanently drops the client session from `AuthContext`. `verifySession()` early-returns on a missing in-memory token without consulting `tokenStore.hasSession()` or attempting a refresh. | `BAIS/Frontend/src/context/AuthContext.jsx:58-63`, `100-104`; `services/api.js:41` | After every F5: navbar shows "Login / Sign Up" to a logged-in user; websockets never connect (`SocketContext.jsx:24`); `useHasCase()` reports false; `BlockIfHasCase` lets an existing client retake the quiz. Page content still renders because `AuthGate` refreshes independently — a half-broken, high-visibility state. |
| **D-02** | Logout never revokes the server-side session. `clearSession()` runs before `authApi.logout()`, stripping the token and the session marker, so the request goes out unauthenticated and `authenticate` 401s it; the error is swallowed. | `BAIS/Frontend/src/context/AuthContext.jsx:147-151`; `services/api.js:34-38, 78-79`; `Backend/src/modules/auth/auth.routes.js:53`; `auth.controller.js:252-259` | The `AuthSession` row stays active and the httpOnly refresh cookie is never cleared. A "signed-out" browser can mint a fresh session for the full refresh-token TTL. Account-takeover risk on shared machines. INSZoom does this correctly (`contexts/AuthContext.jsx:131-143`) — copy that ordering. |

### High

| ID | Defect | Location | Impact |
|---|---|---|---|
| **D-03** | The entire **Expert Letters** tab is fake. `fetchLetters` hardcodes `setLetters([])`; `handleCreateLetter` only closes the modal. No `letters` resource exists in the backend. | `INSZoom/frontend/src/pages/CRMCaseDetail.jsx:662-665, 860-863, 2494-2502, 2846-2862` | Staff believe they created a document that was never created and never will appear. |
| **D-04** | **ISSUE-007 is still fully present.** All three proposed fixes are unimplemented. | `Backend/src/modules/auth/session.service.js:30-42`; `auth.service.js:326-346`; `middleware/errorHandler.js:12-30, 51` | Concurrent refresh (cross-tab, or BAIS+INSZoom on a shared cookie domain) throws a Mongoose `VersionError` → an undifferentiated 500. Both frontends treat a failed refresh as terminal, so the user is **hard-logged-out and navigated to `/login`** (BAIS `api.js:53-56, 128-130`; INSZoom `api.js:133, 139-141`). A valid orphan `AuthSession` is created on every occurrence. Same-tab single-flight (`refreshPromise`) is the only reason this is intermittent. |
| **D-05** | `TaskDetails` "Delete" button has no `onClick` attribute at all. | `INSZoom/frontend/src/pages/TaskDetails.jsx:356-361` | Task deletion is impossible from the UI despite `DELETE /tasks/:id` existing (`task.routes.js:21`) and the button carrying the correct role gate. |
| **D-06** | `AdminLogin` leaves a full app-wide session established when the post-login role check fails — it sets a local `error` and returns without calling `logout()`. | `BAIS/Frontend/src/Pages/Admin/AdminLogin.jsx:45-64`; `context/AuthContext.jsx:129-135` | The screen says "You are not authorized"; the user is nevertheless authenticated everywhere else in the app. A false-failure that grants access. |
| **D-07** | `Intake` "Save & close" persists nothing — no API call, no `localStorage`, no `sessionStorage`. | `BAIS/Frontend/src/Pages/Dashboard/Intake.jsx:705-707` (verified: zero `saveIntake`/`localStorage` references in the file) | A partially-completed intake questionnaire is silently discarded; the user restarts from question 1. Label/behaviour mismatch. |
| **D-08** | `AdminPortal` loads via `Promise.all` of 6 endpoints with a `console.error`-only catch and no `loading` state. | `BAIS/Frontend/src/Pages/Admin/AdminPortal.jsx:874-894` | One failing endpoint blanks all six sections into "No users / No cases / No leads" empty states, indistinguishable from an empty system. No retry affordance beyond a Refresh button with no feedback. |
| **D-09** | `CaseManagerDetails` has no error state at all; all five fetches `console.error` only, and the Analytics tab claims "Loading case manager analytics…" forever after a failure. | `INSZoom/frontend/src/pages/CaseManagerDetails.jsx:145-146, 163-164, 178-179, 194-195, 203-204, 772` | A permanent fake loading state, plus a 500 rendering as "case manager not found". |
| **D-10** | `QuestionnaireTemplates` has 8 mutating handlers with no `try/catch` and no error mechanism on the page. | `INSZoom/frontend/src/pages/QuestionnaireTemplates.jsx:150-184, 200-218, 220-235, 250-258, 260-265, 267-273, 275-279, 281-285` | Save / Duplicate / Version / Archive / Add Question / Remove Question / Assign / Load Progress all look like no-ops on failure. `archiveTemplate` also has no confirmation dialog. |
| **D-11** | `ManageBooking` cancel and reschedule are false successes: cancel flips the view synchronously without awaiting the mutation, and neither mutation has an `onError` or any error rendering. | `BAIS/Frontend/src/Pages/Consultation/ManageBooking.jsx:100-108, 121-128` | A user can believe a consultation was cancelled or moved when the server rejected it. |
| **D-12** | `DocumentReview`'s three write buttons have no `try/catch`. | `BAIS/Frontend/src/Pages/Dashboard/DocumentReview.jsx:24-34` | Approve / Reject / Save Edit fail completely silently. (Mitigated only by the page being unreachable — see D-13.) |
| **D-13** | INSZoom document review is a false success. `Documents.jsx` optimistically patches local state and only `console.error`s; `CRMCaseDetail.jsx`'s `<select>` resets to its placeholder either way and skips the refetch on failure. | `INSZoom/frontend/src/pages/Documents.jsx:505-510, 776-795`; `pages/CRMCaseDetail.jsx:806-813, 2247-2256` | A rejected `PUT /documents/:id/review` displays as an approved document until the next full reload. |
| **D-14** | Both AI-provider write controls in Settings have no `try/catch`, no disable, no feedback. | `INSZoom/frontend/src/pages/Settings.jsx:388-391, 401-411` | A failed `PUT /ai/providers/:key` is invisible; the checkbox may not even revert. Every other settings section is correct. |
| **D-15** | INSZoom force-logs-out on any `/auth/me` failure during bootstrap — the catch is a blanket `clearSession()` with no 401-vs-5xx distinction. | `INSZoom/frontend/src/contexts/AuthContext.jsx:65-67` | A transient backend blip evicts a valid session. BAIS solved this with a four-state machine (`AuthContext.jsx:7-18`); INSZoom should adopt the same shape. |
| **D-46** | **Backend route-mount collision silently misroutes the USCIS Lifecycle tab.** `router.use("/uscis/forms", uscisFormImportRoutes)` is registered **before** `router.use("/uscis", uscisLifecycleRoutes)`, so Express resolves overlapping paths to the import module and the lifecycle module never sees them. | `Backend/src/routes/index.js:24-25`; `modules/uscis-form-import/routes/uscisFormImportRoutes.js:23, 34, 36, 37`; `modules/uscis-lifecycle/routes/uscisLifecycleRoutes.js:9, 12, 15, 16`; caller `INSZoom/frontend/src/pages/USCISForms.jsx:96, 147-155` | **Four endpoints are shadowed:** `GET /uscis/forms` → import `get("/")` instead of lifecycle `listForms`; `POST /uscis/forms/import` → import `post("/import")`; `POST /uscis/forms/:id/activate` → import `post("/:id/activate")`; `POST /uscis/forms/:id/retire` → import `post("/:id/retire")`. Four others fall through correctly because the import router has no matching pattern: `.../scan`, `.../:id/approve`, `.../:formType/versions`, `.../:formType/compare/:version`. Concrete user-visible consequence: the import service's `list()` builds a `dashboard` object with no `pendingReviews` key (`USCISFormImporterService.js:456-465`) whereas the lifecycle service does (`VersionManagementService.js:41`), so the **Lifecycle tab's "Pending Reviews" card is permanently 0** (`USCISForms.jsx:420,423`). Worse, "Activate" and "Retire" run a different module's service (different audit action and impact-analysis behaviour) than the "Approve" and "Compare" buttons sitting next to them on the same tab. Fix by mounting `/uscis` before `/uscis/forms`, or by giving the two routers non-overlapping prefixes. |
| **D-47** | `PaymentsOverview` has **no user-facing error state at all** — all three fetches are `console.error` only. | `INSZoom/frontend/src/pages/PaymentsOverview.jsx:61-96` | A 401/500/outage renders zeroed stat cards and "No payments found", indistinguishable from an empty ledger. Financial data presented as authoritative when it failed to load. |
| **D-48** | `Leaderboard` "Calculate Performance" is fire-and-forget: `onClick={() => api.post(...)}` with no `await`, no `catch`, no loading state, no success feedback and **no refetch of the table afterwards**. | `INSZoom/frontend/src/pages/Leaderboard.jsx:115-121` | The button appears to do nothing whether it succeeded or failed; even a successful recalculation leaves stale scores on screen. `fetchLeaderboard`'s catch (24-26) is also `console.error` only, so a load failure renders "No data available for this period". |

### Medium

| ID | Defect | Location | Impact |
|---|---|---|---|
| **D-16** | `/dashboard/document-review` is structurally unreachable. Its only nav links render for staff roles (`Navbar.jsx:241, 336`), but `AuthGate` redirects every staff role off-origin to INSZoom (`AuthGate.jsx:75-78`) and shows "Access unavailable" for any non-client-portal role (106-115). | `BAIS/Frontend/src/App.jsx:93`; `Navbar.jsx:241-244, 336-338`; `AuthGate.jsx:26-28, 75-78, 106-115` | An entire document-intelligence review workflow is dead code. |
| **D-17** | `/dashboard/plan` and `/dashboard/filing-type` have zero inbound links anywhere in the app. | `BAIS/Frontend/src/App.jsx:81-82` (verified by exhaustive grep) | Two functional pages, including the plan-selection + payment entry point, are URL-only. |
| **D-18** | `Pages/Dashboard/Notifications.jsx` is never imported and never routed. | `BAIS/Frontend/src/Pages/Dashboard/Notifications.jsx` | Dead page. Its two write handlers also have no `try/catch` (29-37). |
| **D-19** | Neither app declares a `path="*"` catch-all. | `BAIS/Frontend/src/App.jsx`; `INSZoom/frontend/src/App.jsx` | A typo or a stale link renders a blank page (BAIS) or empty chrome (INSZoom). |
| **D-20** | `PlanSelection`'s save failure is `console.error` only — no error state, nothing rendered. | `BAIS/Frontend/src/Pages/Dashboard/PlanSelection.jsx:50-53` | A failed plan save looks exactly like the Continue button doing nothing. |
| **D-21** | `CaseIntakeExtras` autosaves I-907 premium-processing filing data with `.catch(() => null)` and no success confirmation. | `BAIS/Frontend/src/components/checklist/CaseIntakeExtras.jsx:189-198` | Filing-critical data can silently fail to save; the only signal is the "Saving…" label disappearing, which it also does on success. |
| **D-22** | `EmployeeHandoffModal`'s "I'll fill it myself" fires a real `PUT` without `await` and closes the modal regardless. | `BAIS/Frontend/src/components/checklist/EmployeeHandoffModal.jsx:64-71`; `Pages/Dashboard/Documents.jsx:268-279` | A failed handoff assignment reads as success. |
| **D-23** | `Navbar` silently hides the Dashboard / Messages / Payments links when `GET /auth/session-context` fails. | `BAIS/Frontend/src/components/Navbar.jsx:75-87, 121-133` | A transient failure makes a client's own case navigation disappear with no retry and no explanation. |
| **D-24** | `CaseManagers` "Export CSV" exports only the current ≤10-row page. | `INSZoom/frontend/src/pages/CaseManagers.jsx:80-103, 163-169` | Silent, unlabelled under-export of a reporting artefact. |
| **D-25** | `Login` reports network and timeout failures as a credentials problem. | `BAIS/Frontend/src/Pages/Auth/Login.jsx:83-97` | Users retype correct passwords during an outage. |
| **D-26** | `Profile`'s save status line styles success and error identically. | `BAIS/Frontend/src/Pages/Dashboard/Profile.jsx:278` | A failed save reads as "Saved". |
| **D-27** | `PaymentSuccess` stops polling after 60s while still claiming the page updates automatically. | `BAIS/Frontend/src/Pages/Dashboard/PaymentSuccess.jsx:70` | A slow settlement leaves a permanently misleading message. |
| **D-28** | `NotificationPreferencesCard` and `CanonicalProfileForm` are orphaned components (never imported). | `BAIS/Frontend/src/components/NotificationPreferencesCard.jsx`, `components/questionnaire/CanonicalProfileForm.jsx` | Notification preferences are unreachable from the UI despite `GET`/`PUT /notifications/preferences/me` existing. |
| **D-29** | `ProtectedRoute.jsx` (BAIS) is dead — defined but removed from the route tree; `poc/PocHarness.jsx` and `poc/pocMain.jsx` (INSZoom) are unreferenced. | `BAIS/Frontend/src/components/ProtectedRoute.jsx`; `INSZoom/frontend/src/poc/*` | Dead code that still reads as live routing infrastructure (its Retry button is the only manual `verifySession()` trigger, and it can never be pressed). |
| **D-49** | Petition exhibit drag-reorder re-throws its failure into a caller that never awaits or catches it. | `INSZoom/frontend/src/pages/petition/PetitionOutline.jsx:58-66`; `hooks/usePetitionPackage.js:69-89` | On a non-409 reorder failure the UI silently reverts with no error banner and produces an unhandled promise rejection. Only 409s surface, via the generic conflict banner. |
| **D-50** | Every mutation button on `USCISForms.jsx` (create / update / delete / approve / archive / fill / scan / import ×4) lacks an in-flight disable, and all errors share one page-level `error` string that concurrent failures overwrite. | `INSZoom/frontend/src/pages/USCISForms.jsx:23, 374-378, and all handlers 136-332` | Every write on the page is double-clickable, including template deletion and version approval. |
| **D-51** | `EODReports` "Mark as Reviewed" has no in-flight disable — the page's `submitting` flag is never set by this handler. | `INSZoom/frontend/src/pages/EODReports.jsx:89-99, 421-427` | The modal stays open with a clickable button and no feedback during the request; duplicate reviews are possible. |
| **D-52** | `Analytics` wraps all six dashboard fetches in one `Promise.all` with a single generic error banner and no retry button. | `INSZoom/frontend/src/pages/Analytics.jsx:63-96` | One failing endpoint blanks the whole page; a failed *background* refresh leaves stale charts with no indicator on them. |

### Low

| ID | Defect | Location |
|---|---|---|
| **D-30** | Dead footer "links": Privacy Policy / Terms of Service / Disclaimer are non-clickable `<span>`s styled with `cursor-pointer`. | `Home.jsx:292-294`, `About.jsx:176-179` |
| **D-31** | `Offers` calls the authenticated `GET /referrals/me` unconditionally, so anonymous visitors always 401; the catch conflates that with a real outage. | `Offers.jsx:99-103` |
| **D-32** | `FilingTypeSelection`'s `startFiling(payload)` accepts and discards `fromStatus`/`toStatus`/`filingTypeKey`. Documented as intentional, but the UI still implies the selection matters. | `FilingTypeSelection.jsx:59-63` |
| **D-33** | `EligibilityResults` reads only `location.state`; any refresh permanently loses the results and forces a full retake. | `EligibilityResults.jsx:17-38` |
| **D-34** | `StartAssessmentButton` ignores `useHasCase().isError`, so a transient `/cases/my` failure shows the "start the quiz" CTA to an existing client — the inverse of the guard's purpose. | `StartAssessmentButton.jsx:27`; `hooks/useHasCase.js:38` |
| **D-35** | `OAuthCallback` stores the access token with no shape or expiry validation. | `OAuthCallback.jsx:36` |
| **D-36** | `ResetPassword` never validates the token before rendering the form; failure surfaces only on submit. | `ResetPassword.jsx:18` |
| **D-37** | `AuthGate` passes `state={{from: location}}` on its login redirect, but nothing ever consumes it — the intended destination is lost. Same in INSZoom, which passes nothing. | `AuthGate.jsx:103`; `INSZoom ProtectedRoute.jsx:26` |
| **D-38** | Role-gating drift in INSZoom: `case-managers` allows `team_lead` in `canAccessModule` but not in the sidebar; `analytics`/`leaderboard`/`uscis-forms` are reachable by URL for roles the sidebar hides them from; `/tasks/team-tasks` is client-gated to all four staff roles while the backend restricts it to three. | `INSZoom/frontend/src/utils/permissions.js:76, 132, 137, 139, 142`; `App.jsx:217-232`; `Backend/.../task.routes.js:15` |
| **D-39** | `AdminPortal` at `/admin/portal` has no client-side route guard at all; it relies entirely on the backend 403ing its data calls, which then blanks the page via D-08. | `BAIS/Frontend/src/App.jsx:132` |
| **D-40** | `Teams`'s "Add Member" button is not role-gated in the UI, unlike the row-level Edit/Toggle/Delete icons. | `INSZoom/frontend/src/pages/Teams.jsx:299-301` |
| **D-41** | `SocketContext` (INSZoom) exposes no permanent-disconnect state; after 5 exhausted reconnection attempts, "Live" indicators read "Connecting…" forever. | `INSZoom/frontend/src/contexts/SocketContext.jsx:29-70`; consumer at `CaseManagerAnalyticsPanel.jsx:144` |
| **D-42** | `ErrorBoundary` renders `error.message` verbatim in a `<pre>` — a minor information-disclosure surface. | `INSZoom/frontend/src/components/ErrorBoundary.jsx:35-37` |
| **D-43** | `NotificationContext.fetchNotifications` is defined and exported but never invoked inside the provider; only the unread *count* is proactively loaded. | `INSZoom/frontend/src/contexts/NotificationContext.jsx:49, 126-149` |
| **D-44** | Vestigial dead code: `About.jsx:188` unused `expanded` state; `TaskDetails.jsx:16` unused `MoreVertical` import; `CaseManagerDetails.jsx:42,48` unused `Download`/`ChevronRight` imports; `USCISFormRenderer.jsx:495` `onChange={() => {}}`. | as listed |
| **D-45** | `Companies.jsx` is read-only despite the backend exposing full company CRUD (`POST`, `PUT /:id`, `PUT /:id/status`, `DELETE /:id`, `POST /:id/notes`). Capability gap, not a broken control. | `INSZoom/frontend/src/pages/Companies.jsx` |
| **D-53** | `Leaderboard`'s Role `<select>` has exactly one option (`case_manager`) — a filter that can never filter. | `INSZoom/frontend/src/pages/Leaderboard.jsx:80-86` |
| **D-54** | `LetterSheet`'s save-state shows "Not saved — retry" as plain text, not a control. The only way to retry a failed letter autosave is to type again to re-trigger the 800ms debounce. | `INSZoom/frontend/src/pages/petition/LetterSheet.jsx:96` |
| **D-55** | `PetitionViewer`'s download failure always says "That output has not been assembled yet." regardless of whether it was a 404, a 500 or a network failure. Its `GET /petition/definitions/:key` fetch also fails silently to `null`, quietly falling back to default section naming/ordering. | `INSZoom/frontend/src/pages/petition/PetitionViewer.jsx:48, 63-79` |
| **D-56** | `USCISForms` gates the "Approve" button to `super_admin` only while the backend permits `admin` too — the UI is stricter than the backend, so admins cannot approve a pending template. | `INSZoom/frontend/src/pages/USCISForms.jsx:573-579`; `Backend/.../uscis-form.routes.js:716` |
| **D-57** | `Messaging` silently drops a case conversation from the list on a 403/404 with no explanation to the user. | `INSZoom/frontend/src/pages/Messaging.jsx:598-610` |

---

## 7. Endpoint contract cross-check

Every endpoint invoked from either frontend was resolved through its API wrapper (`BAIS/Frontend/src/services/api.js`, `INSZoom/frontend/src/services/api.js`) and matched against `Backend/src/routes/index.js` mount prefixes plus the corresponding module route file.

**Result: zero calls to non-existent backend endpoints in either app.** With one exception (D-46, below), every defect in this report is a frontend behaviour defect — a dead handler, a missing error path, a false success, or an unreachable route — not a frontend↔backend contract mismatch.

**The one contract-level defect is a routing collision, not a missing route (D-46).** `Backend/src/routes/index.js:24-25` registers `/uscis/forms` (the form-*import* module) before `/uscis` (the *lifecycle* module). Express matches mounted routers in registration order, so four paths that the frontend intends for the lifecycle module are captured by the import module instead — both handlers exist, so nothing 404s and nothing throws; the calls simply land in the wrong service:

| Frontend call | Resolves to | Intended (never reached) |
|---|---|---|
| `GET /uscis/forms` (`USCISForms.jsx:96`) | `uscisFormImportRoutes.js:23` → `controller.list` | `uscisLifecycleRoutes.js:9` → `listForms` |
| `POST /uscis/forms/import` (`USCISForms.jsx:252-275`) | `uscisFormImportRoutes.js:34` | `uscisLifecycleRoutes.js:12` |
| `POST /uscis/forms/:id/activate` (`USCISForms.jsx:147-155`) | `uscisFormImportRoutes.js:36` | `uscisLifecycleRoutes.js:15` |
| `POST /uscis/forms/:id/retire` (`USCISForms.jsx:147-155`) | `uscisFormImportRoutes.js:37` | `uscisLifecycleRoutes.js:16` |

Four sibling calls fall through correctly, because the import router declares no matching pattern for them: `POST …/forms/scan`, `POST …/forms/:id/approve`, `GET …/forms/:formType/versions`, `GET …/forms/:formType/compare/:version`. The result is a single UI tab whose buttons are split across two different backend modules with no visible seam.

Two near-misses worth recording as verified-OK:
- `PUT /auth/change-password` (`Profile.jsx`) is real (`auth.routes.js:61-68`), despite the module also exposing `/auth/updatepassword`.
- `GET /api/health` (`Settings.jsx` "Test Connection") is defined directly in `Backend/src/app.js:70`, not under the module router — it does not appear in the module route dump but does exist.

The one *missing* backend capability is the INSZoom Expert Letters feature (D-03): there is no `letters` resource anywhere. The only letters route in the backend is `PATCH /petition/packages/:id/letters/:sectionKey` (`petition.routes.js:22`), which belongs to the separate petition-package feature and is not what the Expert Letters tab is modelling.

---

## 8. Reference implementations worth copying

Three places in this codebase already do it right and should be the pattern for the fixes above:

| Pattern | Where |
|---|---|
| Distinguishing loading / error / empty, with a working Retry | `INSZoom/frontend/src/components/CaseManagerAnalyticsPanel.jsx:69-120`; `BAIS/Frontend/src/Pages/Dashboard/Documents.jsx:349-354, 904-926` |
| Consistent `e.response?.data?.message` surfacing with submitting/disabled states on every mutation | `INSZoom/frontend/src/pages/Teams.jsx` (whole file) |
| Optimistic send with reconciliation, a `__failed` marker and a click-to-retry affordance | `BAIS/Frontend/src/Pages/Dashboard/Messages.jsx:632-705` |
| Status-code-specific recovery (409 → clear the stale selection and refetch) | `BAIS/Frontend/src/Pages/Consultation/BookConsultation.jsx:46-52` |
| An auth state machine that keeps "backend unreachable" distinct from "logged out" | `BAIS/Frontend/src/context/AuthContext.jsx:7-18` (adopt in INSZoom — see D-15) |
| Correct logout ordering (call the API while still authenticated, clear in `finally`) | `INSZoom/frontend/src/contexts/AuthContext.jsx:131-143` (adopt in BAIS — see D-02) |
| A single `action()` wrapper that sets `busy`, catches, and sets `errorMessage` for *every* mutation on the page, plus field autosave with 3-attempt exponential backoff and a `beforeunload` guard | `INSZoom/frontend/src/components/uscis/USCISFormRenderer.jsx:74, 588-597, 732-756` — the most thoroughly error-handled surface in either app |
