# Module Interconnectivity & Change Impact — Audit Track §15 / §16 / §0.8

**Date:** 2026-09-01
**Branch:** `refactor` (HEAD `c86c446`)
**Scope:** §15 Module interconnectivity map · §16 Change-impact matrix · §0.8 Stale/phantom implementation register
**Method:** READ-ONLY static analysis. Every claim below is backed by a file that was actually opened and read in this session; each is cited as `path:line`. Nothing was inferred from a prior report or a doc without re-verifying it against the code — where a prior artifact disagrees with the current branch, the disagreement is recorded explicitly in §17 (Drift & prior-audit corrections). No source file, database record, or running process was modified. Sensitive values are masked; none were encountered in code (secrets are read from `process.env` throughout).

**What was NOT done:** no runtime/HTTP verification, no database queries, no browser interaction. Claims about *behavior* are derived from code paths, and are labelled as such. Where behavior could only be settled by running something, that is stated instead of asserted.

**Concurrency caveat:** other audit workstreams were writing to this repo while this pass ran. All line citations were taken against the committed state of `c86c446`. One file, `Backend/src/modules/cases/case.controller.js`, acquired an **uncommitted working-tree change (+13/−6, inside `createCase` at ~line 1079) after this audit had read it** — line numbers cited for that file beyond ~1092 are therefore offset by +7 in the current working tree, and the change itself is addressed explicitly in §17.4. Nothing else cited here was modified during the pass.

---

## Contents

- [§15 — Module interconnectivity map](#15--module-interconnectivity-map) (34 modules)
- [§16 — Change impact matrix](#16--change-impact-matrix) (7 hypothetical changes)
- [§0.8 — Stale / phantom implementation register](#08--stale--phantom-implementation-register)
- [§17 — Drift against existing architecture artifacts & prior-audit corrections](#17--drift-against-existing-architecture-artifacts--prior-audit-corrections)
- [Appendix A — Module reality scorecard](#appendix-a--module-reality-scorecard)

---

## Reading the cards

- **INPUTS** — what enters the module (HTTP routes, function entry points, events).
- **WRITES / READS** — Mongo collections and in-document paths the module mutates / consults.
- **UPSTREAM** — what must run before it for it to be meaningful.
- **DOWNSTREAM** — what consumes its output.
- **UI CONSUMERS** — the *actual* React pages/components that call it. `NONE` means an exhaustive grep of both `BAIS/Frontend/src` and `INSZoom/frontend/src` found zero live call sites — this is a finding, not an omission.
- **FAILURE IMPACT** — what breaks for a user if this module fails.
- **CHANGE IMPACT** — blast radius of modifying its contract.

Blast-radius scale used throughout: **LOW** (contained in one module) · **MODERATE** (one subsystem, ≤5 files) · **HIGH** (cross-subsystem, both portals, or data-integrity risk) · **CRITICAL** (system-wide, or silently corrupts legal filing data).

---

# §15 — Module interconnectivity map

---

### MODULE: Authentication
**INPUTS:** `POST /api/auth/register`, `/login`, `/google-token`, `GET /auth/google`, `/auth/google/callback`, `POST /auth/logout`, `/logout-all`, `GET /auth/me`, `/auth/session-context`, `PUT /auth/updatedetails`, `/auth/updatepassword`, `POST /auth/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification`, `GET /auth/invite/:token`, `POST /auth/invite/:token/accept`, `/auth/resend-invite` — all declared in `Backend/src/modules/auth/auth.routes.js:12-88`. Mounted at `Backend/src/routes/index.js:3`.
**WRITES:** `users` (User.create, password hash via `Backend/src/models/User.js:170-172`), `authsessions`, `auditlogs` (via `Backend/src/middleware/auditAuth.js`, applied per-route at `auth.routes.js:46-88`), `emaillogs` (password-reset / invitation templates).
**READS:** `users` (`Backend/src/middleware/authenticate.js:24`), Redis user cache (`authenticate.js:20-26`, `Backend/src/config/redis.js`).
**UPSTREAM:** `config/env.js` (JWT secrets), `modules/auth/token.service.js`, `password.service.js`, Redis (optional — cache-aside, degrades to Mongo).
**DOWNSTREAM:** every authenticated route in the app. `authenticate` sets `req.user`, which RBAC (`authorizePermissions`/`authorizeRoles`), `caseService.canAccessCase`, audit logging, and notification targeting all read.
**UI CONSUMERS:** BAIS `src/context/AuthContext.jsx:69,123,130,140,150,160`, `Pages/Auth/Login.jsx:78`, `Register.jsx:206`, `AcceptInvite.jsx:33,48`, `ForgotPassword.jsx:52`, `ResetPassword.jsx:33`, `OAuthCallback.jsx:25,36`, `Pages/Admin/AdminLogin.jsx:51`, `components/AuthGate.jsx:47`, `Navbar.jsx:125,136`; INSZoom `src/contexts/AuthContext.jsx:56,70,105,135`, `pages/Login.jsx:32`, `layouts/Layout.jsx:76-79,193`.
**API CONSUMERS:** internal only — no other backend module calls auth's HTTP surface; they consume `req.user`.
**DB COLLECTIONS:** `users`, `authsessions`, `auditlogs`, `emaillogs`.
**EVENTS:** no domain events emitted. Side effects are the audit-log write (`auditAuth`) and, on invite acceptance, notification/email dispatch.
**DEPENDENCIES:** `jsonwebtoken`, `bcryptjs`, `google-auth-library` (`modules/auth/google-oauth.service.js`), Redis, `modules/email/email.service.js`.
**FAILURE IMPACT:** total outage of both portals. `authenticate.js:8-10` returns 401 for any request without a bearer token, and every non-public route mounts it.
**CHANGE IMPACT:** **CRITICAL.** The access-token payload shape is a hard contract between `token.service.js`, `authenticate.js:28` (`decoded.tokenVersion` compared against `user.tokenVersion`), and both frontends' client-side JWT decode (BAIS `services/api.js:13-28` decodes `exp` from segment 1 itself). Adding a claim is safe; renaming/removing `userId` or `tokenVersion` invalidates every issued token and both portals' pre-flight refresh logic simultaneously.

---

### MODULE: Session / refresh
**INPUTS:** `POST /api/auth/refresh` (`auth.routes.js:52`, **unauthenticated by design** — the refresh token is an httpOnly cookie), `POST /auth/logout` (`:53`), `POST /auth/logout-all` (`:54`). Service entry points: `createSession`, `findActiveSession`, `rotateSession`, `revokeSession`, `revokeAllSessions` (`Backend/src/modules/auth/session.service.js:57-63`).
**WRITES:** `authsessions` — `AuthSession.create` on login (`session.service.js:12`) and on every rotation (`:31`); `session.save()` to stamp `revokedAt`/`replacedBy` (`:39-41`); `updateMany` on logout-all (`:54`).
**READS:** `authsessions` by SHA-hashed refresh token (`session.service.js:22-27`, `.select("+refreshTokenHash")`).
**UPSTREAM:** `password.service.hashToken`, `config/env.refreshTokenTtlDays` (`session.service.js:5-9`).
**DOWNSTREAM:** `auth.service.js` refresh flow → new access token → every subsequent authenticated request.
**UI CONSUMERS:** BAIS `services/api.js:45-61` (single-flight `refreshPromise` at `:43`, pre-flight refresh at `:78-90`, reactive 401 retry at `:118-135`); INSZoom `services/api.js:30-38` (raw axios to avoid interceptor recursion) and `:122-135`, plus silent boot restore at `contexts/AuthContext.jsx:69-79`.
**API CONSUMERS:** none.
**DB COLLECTIONS:** `authsessions`.
**EVENTS:** BAIS dispatches a browser-level `bais:session-expired` event on unrecoverable refresh failure (`BAIS/Frontend/src/services/api.js:87,134`), consumed at `context/AuthContext.jsx:107-111`. No server-side event.
**DEPENDENCIES:** `cookie-parser` (`Backend/src/app.js:67`), CORS `credentials:true` (`app.js:41`).
**FAILURE IMPACT:** users are silently logged out mid-session. Both portals hard-redirect or clear state on a failed refresh (INSZoom `services/api.js:136-142` does `window.location.href = '/login'`).
**CHANGE IMPACT:** **HIGH.** `rotateSession` (`session.service.js:30-43`) performs an unguarded read → create-replacement → `save()` with Mongoose's default `__v` optimistic concurrency and **no application-level lock**. Two concurrent refreshes presenting the same refresh token both pass `findActiveSession`, both create a replacement session, and the second `save()` raises a `VersionError` — which `Backend/src/middleware/errorHandler.js:27-30` does **not** classify (its `DATABASE_UNAVAILABLE_ERROR_NAMES` set has 7 entries, none of them `VersionError`), so it falls through to the generic 500 at `errorHandler.js:47`. Both portals only auto-retry on `401 + code:"TOKEN_EXPIRED"`, so a 500 here is a hard logout. Any change to rotation semantics touches this race.

---

### MODULE: RBAC
**INPUTS:** `authorizeRoles(...roles)` (`Backend/src/middleware/authorizeRoles.js:3-14`) and `authorizePermissions(...perms)` (`Backend/src/middleware/authorizePermissions.js:3-11`), applied inline on ~350 routes. Backing data: `Backend/src/modules/authorization/permissions.registry.js:38-59` (`ROLE_PERMISSIONS`), `roleHierarchy.js:1-13` (`CANONICAL_ROLES`), `rbac.service.js:4-45`.
**WRITES:** nothing. Pure decision layer.
**READS:** `req.user.role`, `req.user.permissions` (`rbac.service.js:12-21`), `req.user.teamId` (`canModifyUser`, `:37-39`).
**UPSTREAM:** `authenticate` must have populated `req.user`.
**DOWNSTREAM:** every guarded route; plus a *second*, independent per-record layer — `caseService.canAccessCase` (`Backend/src/modules/cases/case.service.js:102-126`), `requireCaseFormAccess` (`Backend/src/modules/form-generation/middleware/requireCaseFormAccess.js:17-41`), `beneficiaryService.canAccessBeneficiary`, `notificationService.canAccessNotification`. **These two layers are not equivalent, and several routes have only the first** — see §0.8.
**UI CONSUMERS:** INSZoom `src/utils/permissions.js:123-142` drives sidebar visibility and `ProtectedRoute module=…` guards (`App.jsx:44-264`); BAIS `components/AuthGate.jsx:24,28,77,131-173` routes by role. Both are convenience-only; the server is the boundary.
**API CONSUMERS:** `GET /api/auth/session-context` (`auth.routes.js:60`) exposes the effective role/case context to the client.
**DB COLLECTIONS:** none directly (role lives on `users`).
**EVENTS:** none.
**DEPENDENCIES:** none external.
**FAILURE IMPACT:** a mis-evaluation is either a lockout (false 403) or a data breach (false allow). `hasPermission` supports `*`, `resource:*`, and exact matches (`rbac.service.js:12-21`), so a typo in a permission string silently denies.
**CHANGE IMPACT:** **CRITICAL.** `User.role`'s enum is derived from `CANONICAL_ROLES` (`Backend/src/models/User.js:4-6,14`) — 8 values. Adding a role requires edits in `roleHierarchy.js` (enum + `ROLE_HIERARCHY` rank), `permissions.registry.js` (`ROLE_PERMISSIONS` entry — omitting it makes *every* permission-gated route 403, as the in-code comment at `permissions.registry.js:51-55` records happened to `beneficiary`), plus both portals' sidebar/route maps. Removing a permission string silently 403s every route naming it.

---

### MODULE: Case
**INPUTS:** `Backend/src/modules/cases/case.routes.js` — 41 routes (`:14-141`), mounted at `routes/index.js:30`. Plus `/api/cases/:caseId/forms/*` from `form-mapping/routes/autoFillRoutes.js` (mounted `routes/index.js:31`) and `/api/cases/:caseId/{timeline,comments,tasks,requests,readiness,assignments}` from `case-collaboration/routes/collaborationRoutes.js:7-12` (mounted at `/` on `routes/index.js:29`, i.e. **before** `/cases`).
**WRITES:** `cases` (whole document, ~140 top-level paths incl. 8 large embedded arrays), `auditlogs`, `notifications`, `caseassignmentevents`, `documents` (checklist uploads).
**READS:** `cases`, and via populate `users`, `clients`, `beneficiaries`, `companies`, `caseforms`, `questionnaires`, `answers`, `documents`, `payments`, `tasks`, `notifications`.
**UPSTREAM:** Authentication → RBAC → `canAccessCase` (`case.service.js:102-126`, which itself defers to `case-participant.service.canAccessAnyParticipant` at `:110`).
**DOWNSTREAM:** essentially every other domain module. Direct requirers of `models/Case`: `case.service`, `case.controller`, `case-lifecycle-orchestrator`, `case-participant.service`, `CanonicalBuilderService.js:4`, `CanonicalSyncService.js:2`, `AutoFillService.js:2`, `CanonicalProfileService`, `EligibilityEngineService`, `workflow.service`, `document.service`, `dashboard.service`, `report.service`, `search.service`, `uscis-form.service`, `requireCaseFormAccess.js:2`.
**UI CONSUMERS:** INSZoom `pages/CRMCases.jsx:135`, `CRMCaseDetail.jsx:490,497,507,630,651,771,776,797,867`, `Dashboard.jsx:922,931,986,998,1010`, `Documents.jsx:419,428`, `USCISForms.jsx:107`, `QuestionnaireTemplates.jsx:113`, `TaskDetails.jsx:137`, `components/CreateCaseModal.jsx:126`; BAIS `hooks/useMyCaseProfile.js:9`, `useHasCase.js:26`, `Pages/Dashboard/Dashboard.jsx:766,770,782,803`, `Profile.jsx:67`, `Documents.jsx:121,553`, `Messages.jsx:414`, `PlanSelection.jsx:37,42`, `Offers.jsx:93`, `components/questionnaire/PrincipalCaseWorkspace.jsx:36,67`, `DataEntryModeModal.jsx:19`, `InvitePanel.jsx:25`, `Pages/Admin/AdminPortal.jsx:881,966`.
**DB COLLECTIONS:** `cases` (+ everything reachable by populate).
**EVENTS:** Socket.IO `case:created`, `case:assigned`, `case:activity`, `case:client_submitted` via `modules/realtime/realtime.gateway.js` (emitted at `case-lifecycle-orchestrator.service.js:399-400`). In-document `timeline[]`/`auditHistory[]`/`activityLog[]` append-only trails.
**DEPENDENCIES:** MongoDB; `config/visaCategories.js`, `config/packages.js`, `config/filingTypes.js`, `services/CaseNumberService.js`, `modules/cases/caseId.js`.
**FAILURE IMPACT:** total product outage — nothing in either portal works without a case.
**CHANGE IMPACT:** **CRITICAL.** See §16 for `caseRole` and `parentCase` specifically. Structural notes: (a) `caseSchema` declares **50** explicit compound/text indexes (`Backend/src/models/Case.js:1008-1054` and `:1057-1062`) plus **78** field-level `index: true` declarations (many on `participants.*` subpaths) and 2 unique constraints — the total is close enough to MongoDB's 64-index-per-collection ceiling that adding indexes must be treated as a capacity decision, not a free operation; (b) the `pre("validate")` hook at `:943-1006` back-fills `participants[]` from the legacy `employerUser`/`employeeUser`/`petitionerUser`/`beneficiaryUser` fields on **every save**, so any change to those fields silently changes participant membership and therefore `canAccessCase`.

---

### MODULE: Lead — **EXISTS, but split across two mounts**
**INPUTS:** *Write side* — `POST /api/leads/public` (`Backend/src/modules/leads/lead.routes.js:19`), `POST /api/leads` (`:36`, public quiz-shaped), `POST /api/leads/from-intake` (`:43`, authenticated client). *Read + lifecycle side, under a different prefix* — `GET /api/eligibility-quiz/leads`, `GET /leads/:id`, `POST /leads/:id/seen`, `PATCH /leads/:id/status`, `PATCH /leads/:id/assign`, `POST /leads/:id/notes`, `PATCH /leads/:id/confirm-consultation`, `PATCH /leads/:id/complete-consultation`, `PATCH /leads/:id/approve`, `PATCH /leads/:id/reject` (`Backend/src/modules/eligibility-quiz/quiz.routes.js:41-53`).
**WRITES:** `leads` (`Backend/src/models/Lead.js`), `appointments` + `strategycallqueueitems` (booking paths), `auditlogs` (`quiz.service.js:227,238,250,...`), `notifications`, `emaillogs`.
**READS:** `leads`, populated with `consultationId` → `appointments`, `assignedTo` → `users` (`quiz.service.js:174-182`).
**UPSTREAM:** eligibility-quiz scoring (`modules/eligibility-quiz/scoring.service.js`, `recommendation.service.js`) writes `scoreResult`; consultation booking writes `consultationId`.
**DOWNSTREAM:** `POST /api/cases` with `creationSource:"lead_conversion"` + `leadId` — `case.controller.js:820-836` validates the transition and `:1159-1163` flips the lead to `status:"converted"` and stamps `convertedCaseId`. `Case.leadId` (`models/Case.js:872`) and `Case.consultationId` (`:885`) are set at `case.controller.js:940-941`.
**UI CONSUMERS:** INSZoom `pages/Leads.jsx:88,122,132,143,167,168,169,173` (full lifecycle drawer) + `components/CreateCaseModal.jsx` launched from `Leads.jsx:335`; BAIS `Pages/Admin/AdminPortal.jsx:882,923,930,939,948` → `Pages/Admin/leads/LeadsInbox.jsx`; BAIS public capture at `components/ConsultationSection.jsx:23`, `Pages/Dashboard/Offers.jsx:130`, `Pages/Dashboard/Intake.jsx:660`.
**API CONSUMERS:** `consultation.service.js:5,164-220` and `consultation-routing/routing.service.js:2,78-136` both load and mutate `Lead` directly.
**DB COLLECTIONS:** `leads`, `appointments`, `strategycallqueueitems`, `auditlogs`, `notifications`, `emaillogs`.
**EVENTS:** Socket.IO `lead:created` / `lead:updated` (consumed BAIS `AdminPortal.jsx:913-914`); `notificationService.createForRoles(["super_admin","admin","team_lead"], {type:"lead_approved"...})` at `quiz.service.js:314-318`; emails `lead-approved` / `lead-rejected` / `consultation-confirmation` (`email.service.js:23-24,20`).
**DEPENDENCIES:** `modules/email`, `modules/notifications`, `modules/audit`, `modules/telemetry`.
**FAILURE IMPACT:** the marketing funnel stops; existing cases are unaffected (Lead is not on any case read path).
**CHANGE IMPACT:** **MODERATE.** The state machine is enforced in exactly one place (`quiz.service.js:260-330`) and its enum lives in `models/Lead.js:66-80`. Widening the enum is additive; narrowing it strands existing documents. The *freeform* `PATCH /leads/:id/status` (`quiz.routes.js:44`) bypasses the state machine entirely by design (comment at `quiz.routes.js:47-49`), so any new invariant added to the machine is not enforced on that path.
**⚠ Correction to a prior audit:** `docs/audits/FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md:10` states these endpoints "**Do not exist**… there is no automated lead-approval-to-case pipeline to test." That is **wrong for this branch** — the prior audit only inspected `lead.routes.js` and did not check `quiz.routes.js:41-53`. The full pipeline exists, is UI-wired in both portals, and terminates at `case.controller.js:1159-1163`.

---

### MODULE: Consultation — **EXISTS (public booking), no staff calendar UI**
**INPUTS:** `GET /api/consultation/config`, `/slots`, `POST /book`, `GET /booking/:token`, `POST /booking/:token/reschedule`, `/booking/:token/cancel` (all public + rate-limited, `Backend/src/modules/consultation/consultation.routes.js:15-20`); `GET/PUT /consultation/admin/availability` (`:22-23`, `super_admin`/`admin` + `consultation_routing:*`). Separate router: `GET /api/consultation-routing/options`, `POST /book`, `GET /queue`, `POST /queue/:id/claim` (`modules/consultation-routing/routing.routes.js:16-20`).
**WRITES:** `appointments`, `leads` (`consultation.service.js:193,216`, `routing.service.js:136`), `calendaravailabilities`, `strategycallqueueitems`, `auditlogs`, `emaillogs`, `telemetryevents`.
**READS:** `settings`, `users` (hosts), `calendaravailabilities`, `leads`, `entity-config`.
**UPSTREAM:** eligibility quiz produces the `leadId` the booking attaches to.
**DOWNSTREAM:** `Lead.consultationId` → `Case.consultationId` at `case.controller.js:941`; lead lifecycle `confirm-consultation`/`complete-consultation`.
**UI CONSUMERS:** BAIS `Pages/Consultation/BookConsultation.jsx:36,41,45,65` and `ManageBooking.jsx:20,26,31,35`; INSZoom has **no consultation page** — the only staff touchpoints are the two lead-lifecycle PATCHes in `pages/Leads.jsx:167-168`.
**API CONSUMERS:** `modules/leads/lead.service.js` (creation), `modules/appointments/appointment.service.js`.
**DB COLLECTIONS:** `appointments`, `leads`, `calendaravailabilities`, `strategycallqueueitems`, `settings`, `emaillogs`, `telemetryevents`, `auditlogs`.
**EVENTS:** `consultation-confirmation` / `-reschedule` / `-cancel` / `-host-notify` emails (`email.service.js:20-22`), realtime push, `.ics` generation (`modules/consultation/ics.service.js`).
**DEPENDENCIES:** `bookingToken.service.js` (opaque token in the URL path is the only auth for `/booking/:token/*`).
**FAILURE IMPACT:** prospects cannot book; no impact on existing cases.
**CHANGE IMPACT:** **MODERATE** — self-contained except for the `Lead.consultationId` and `Case.consultationId` links.
**Gap:** `GET /api/consultation-routing/queue` and `POST /queue/:id/claim` (`routing.routes.js:19-20`) have **zero UI consumers in either portal** — the strategy-call queue is server-only.

---

### MODULE: Case creation — **two divergent, both-live implementations**
**INPUTS:**
- **(A) Architecture-current:** `POST /api/cases` → `case.controller.createCase` (`case.routes.js:22-39`, roles `super_admin`/`admin`/`team_lead`). Creates the principal case + N child cases + `EmployerProfile` + one `EmployeeProfile` per child + stub client `User` (`mustSetPassword`), sets `caseStructure`/`caseRole`/`childIndex`/`childCaseCount`/`dataEntryMode`/`creationSource`/`employerProfileId`/`personProfileId` (`case.controller.js:802-1163`), then schedules orchestration off the response path via `setImmediate` (`:1189-1196`).
- **(B) Legacy:** `POST /api/cases/create-with-client` → `case.controller.createCaseWithClient` (`case.routes.js:40-57`, roles `staffRoles` = `super_admin`/`admin`/`team_lead`/**`case_manager`**, `case.routes.js:11`). Creates one flat `Case` + `Client` + invited `User` (`case.controller.js:2404-2609`).
- Other creators: `POST /api/single-party-filings/cases` (`single-party-filing.routes.js:16-26`), `POST /api/family-workflow/cases`, `POST /api/employment-workflow/cases`.
**WRITES:** `cases`, `users`, `clients`, `employerprofiles`, `employeeprofiles`, `counters` (via `CaseNumberService`), `auditlogs`, `notifications`, `emaillogs`, `caseforms` (indirectly, through orchestration).
**READS:** `leads` (`case.controller.js:835`), `users` (dedupe), `visaCategories` config (`config/visaCategories.js` → `getCaseStructure`).
**UPSTREAM:** Lead approval (optional), RBAC.
**DOWNSTREAM:** `CaseLifecycleOrchestrator.initializeCase` → `ensureBeneficiary` → `immigration-knowledge-engine.orchestrate` → `provisionRequiredForms` → `recalculate` → `notifyCaseCreated` (`case-lifecycle-orchestrator.service.js:284-310`).
**UI CONSUMERS:** path (A): INSZoom `components/CreateCaseModal.jsx:126`, reached from `pages/CRMCases.jsx:305` and `pages/Leads.jsx:335`. Path (B): **declared but never called** — `INSZoom/frontend/src/services/api.js:158` defines `createWithClient` and no component invokes it; BAIS removed its case-creation calls in Phase 2 (`BAIS/Frontend/src/Pages/Dashboard/FilingTypeSelection.jsx:60-62`).
**DB COLLECTIONS:** `cases`, `users`, `clients`, `employerprofiles`, `employeeprofiles`, `counters`, `caseforms`, `auditlogs`, `notifications`, `emaillogs`.
**EVENTS:** `case:created` (realtime, `case-lifecycle-orchestrator.service.js:399-400`), emails `case-created-client` + `case-created-team-lead` + `client-portal-invitation`.
**DEPENDENCIES:** `services/CaseNumberService.js`, `modules/cases/caseId.js`, `config/packages.js`, `config/visaCategories.js`, `modules/auth/clientInvite.service.js`.
**FAILURE IMPACT:** no new work can enter the system.
**CHANGE IMPACT:** **CRITICAL** — and the two paths are *not* interchangeable. Path (B) never sets `caseStructure`, `caseRole`, `childCaseCount`, `dataEntryMode`, `creationSource`, `employerProfileId`, or `personProfileId` (verified across `case.controller.js:2525-2577`), and numbers the case with the legacy `generateCaseNumber("INS")` (`:2470`) rather than `CaseNumberService`. Every case it produces has `caseRole: null`, which changes the behavior of `CanonicalBuilderService.loadSources` (`:201-217`), `AutoFillService.applyFormEditToProfile` (`:342-343`, returns `false`), and the child-case UI in `CRMCaseDetail.jsx`. It also grants `case_manager` a creation route that `POST /api/cases` deliberately denies them.

---

### MODULE: Case lifecycle
**INPUTS:** `CaseLifecycleOrchestrator` static methods — `recalculate` (`case-lifecycle-orchestrator.service.js:214`), `initializeCase` (`:284`), `provisionRequiredForms` (`:328`), `onAssignment` (`:404`), `generateForms` (`:425`), `generatePackage` (`:529`), `get` (`:554`). HTTP entry points: `GET /api/cases/:id/workflow`, `POST /:id/workflow/recalculate`, `POST /:id/workflow/generate-forms`, `POST /:id/workflow/generate-package`, `POST /:id/workflow/generate-word-package` (`case.routes.js:119-125`).
**WRITES:** `cases` — `status`, `stage`, `filingReadinessScore`, `workflow.*`, `journeyProgress.*`, `timeline[]`, `auditHistory[]`, `lastSyncedAt` (`:226-244`); `auditlogs`; `caseforms` (indirectly via `ensureAssignedForms` + `AutoFillService.generate`).
**READS:** `answers`, `documents`, `caseforms`, `tasks` (`metrics()` at `:97-103`), plus `cases.canonicalProfile` and `cases.questionnaireReferences`.
**UPSTREAM:** Case creation / assignment / questionnaire submission / document upload / autofill — each calls `recalculate` with a `reason`.
**DOWNSTREAM:** the 6 milestones in `MILESTONE_DEFINITIONS` (`:19-26`) drive `journeyProgress`, which BAIS renders as the client journey (`Pages/Dashboard/Dashboard.jsx:770`) and INSZoom renders on the case detail.
**UI CONSUMERS:** INSZoom `pages/CRMCaseDetail.jsx:630` (generate-forms), `:651` (generate-package); BAIS `Pages/Dashboard/Dashboard.jsx:770`, `Documents.jsx:553`.
**API CONSUMERS:** `case.controller.js` (create/assign), `AutoFillService.js:294`, `documents/document.workflow.service.js`, `questionnaire.service.js`.
**DB COLLECTIONS:** `cases`, `answers`, `documents`, `caseforms`, `tasks`, `auditlogs`.
**EVENTS:** timeline "milestone" events on first completion of each milestone (`:237-241`); `case:created` realtime.
**DEPENDENCIES:** `case.service`, `beneficiary.service`, `notification.service`, `realtime.gateway`, `uscis-form.service`, `AutoFillService`, `CanonicalProfileService`, `FilingPackageService`, `immigration-knowledge-engine.service`.
**FAILURE IMPACT:** progress %, stage, and status freeze; forms stop being provisioned for new cases. `provisionRequiredForms` deliberately swallows per-case errors (`:337-339`) so a broken template cannot block case creation — the failure is silent apart from a log line.
**CHANGE IMPACT:** **HIGH.** `recalculate` writes `caseData.status` from `deriveOperationalState` (`:204-212`) on almost every mutation in the app, so it is the de-facto owner of `Case.status`/`Case.stage`. Changing `metrics()`'s completion predicates (`:124-156`) silently re-scores every case in the system on its next touch. **Confirmed defect:** `generateForms` loops `CaseForm.find({caseId})` and calls `AutoFillService.generate(caseId, form.formCode, …)` (`:481-487`), but `AutoFillService.findCaseForm` resolves by `{caseId, formCode}` + `.sort({updatedAt:-1})` (`AutoFillService.js:198-201`) — with two CaseForms sharing a `formCode` on one case, the loop autofills the same document N times and never touches the sibling.

---

### MODULE: EmployerProfile
**INPUTS:** `GET /api/employer-profile/summary/me`, `GET /:principalCaseId`, `POST /:principalCaseId` (`Backend/src/modules/employer-profile/employer-profile.routes.js:11-13` — `authenticate` only, **no `authorizeRoles`/`authorizePermissions`**). Service entry: `upsertEmployerProfile(principalCaseId, fields, source, user, options)` (`employer-profile.service.js:83`).
**WRITES:** `employerprofiles` — per-field `canonicalData.*` documents carrying `{value, source, sourceId, sourceField, updatedAt, updatedBy, revision, profileOwner, caseScope, lastChangeId, locked, conflictPending, history[]}` (`Backend/src/models/EmployerProfile.js:8-58`). Also stamps progress flags on the principal `Case` (per `docs/forms/issues/ISSUE-002` follow-up).
**READS:** `employerprofiles` by `{principalCaseId}`; `cases` for authorization.
**UPSTREAM:** `Case.employerProfileId` set at creation (`case.controller.js`, path A only).
**DOWNSTREAM:** `CanonicalBuilderService.loadSources:225` (`EmployerProfile.findOne({principalCaseId})`) → `addProfileCandidates(…, EMPLOYER_PROFILE_TO_CANONICAL, "employer", …)` (`CanonicalBuilderService.js:403`) → merged canonical profile → `AutoFillService` → `CaseForm.fieldValues` → PDF. Also the reverse direction: `AutoFillService.applyFormEditToProfile` writes back with `source:"form_edit"` (`AutoFillService.js:353-364`).
**UI CONSUMERS:** **NONE.** `BAIS/Frontend/src/services/api.js:498-501` declares `employerProfileApi.get` / `.mySummary` / `.save`, and an exhaustive grep of `BAIS/Frontend/src` and `INSZoom/frontend/src` finds **zero call sites** for any of the three. The component built for it, `BAIS/Frontend/src/components/questionnaire/CanonicalProfileForm.jsx`, is never imported. INSZoom has no employer-profile API at all.
**API CONSUMERS:** `AutoFillService.js:12,353` is the **only** live writer.
**DB COLLECTIONS:** `employerprofiles`, `cases`.
**EVENTS:** none.
**DEPENDENCIES:** `Backend/src/utils/canonicalFieldWriter.js` (source-priority arbitration).
**FAILURE IMPACT:** company/petitioner data never reaches I-129/I-129F/I-130 → those PDFs render with blank employer sections.
**CHANGE IMPACT:** **HIGH**, and the module is currently **write-unreachable from any UI** — see §0.8. The pre-existing silent-data-loss defect documented in `docs/audits/FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md:36-61` (creation stamps `legalName`/`contact.email` with `source:"case_manager_edit"` even when empty, so a later `source:"questionnaire"` write is rejected into `conflictPending` while the API returns `success:true`) is **still present** — `models/EmployerProfile.js:31-41` still declares `conflictPending`, and `utils/canonicalFieldWriter.js` still gates on `STAFF_AUTHORITATIVE_SOURCES`.

---

### MODULE: EmployeeProfile
**INPUTS:** `GET /api/employee-profile/:caseId`, `POST /api/employee-profile/:caseId` (`Backend/src/modules/employee-profile/employee-profile.routes.js:8-9`, `authenticate` only). Service entry: `upsertEmployeeProfile(caseId, fields, source, user, options)` (`employee-profile.service.js:55`).
**WRITES:** `employeeprofiles` (one per **child** case, `models/EmployeeProfile.js:52-60`; `profileType` discriminates employee vs beneficiary), same provenance shape as EmployerProfile.
**READS:** `employeeprofiles` by `{caseId}`; `cases` (`caseRole`, `parentCase`) for authorization.
**UPSTREAM:** `Case.personProfileId` set at `case.controller.js:1146` (path A only).
**DOWNSTREAM:** `CanonicalBuilderService.loadSources:226` — note the guard `["employee","beneficiary"].includes(caseRecord.caseRole)`: a case with `caseRole: null` (i.e. any case from the legacy creation path) **never loads its EmployeeProfile**. Then `addProfileCandidates(…, EMPLOYEE_PROFILE_TO_CANONICAL, profileType, …)` (`:405`).
**UI CONSUMERS:** BAIS `Pages/Dashboard/Profile.jsx:71` (GET) and `:132` (POST, flattened dot-paths) — the *only* live profile UI in either portal, and only for `role: employee | beneficiary`.
**API CONSUMERS:** `AutoFillService.js:11,370` (`form_edit` write-back).
**DB COLLECTIONS:** `employeeprofiles`, `cases`.
**EVENTS:** none.
**DEPENDENCIES:** `utils/canonicalFieldWriter.js`.
**FAILURE IMPACT:** beneficiary identity data (name, DOB, passport, address) never reaches the USCIS forms.
**CHANGE IMPACT:** **HIGH.** The `{caseId}` uniqueness and the `caseRole` gate at `CanonicalBuilderService.js:226` mean this module's reachability is a direct function of `Case.caseRole` — see §16.

---

### MODULE: Beneficiary profile
**INPUTS:** `GET /api/beneficiaries/dashboard`, `/me`, `PUT /me`, `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `PUT /:id/status`, `DELETE /:id`, `POST /:id/notes`, `GET /:id/timeline`, `GET /:id/related` (`Backend/src/modules/beneficiaries/beneficiary.routes.js:19-41`).
**WRITES:** `beneficiaries` (`Backend/src/models/Beneficiary.js`), `auditlogs`.
**READS:** `beneficiaries`, `clients`, `cases`, `companies`.
**UPSTREAM:** `beneficiaryService.syncFromClient` called from `CaseLifecycleOrchestrator.ensureBeneficiary` (`case-lifecycle-orchestrator.service.js:249-264`) — this is how most Beneficiary documents are actually created.
**DOWNSTREAM:** `CanonicalBuilderService.loadSources:219` loads it and `addMappedObjectCandidates(candidates,"beneficiary",…)` (`:397`) maps 25 fields into canonical paths via `DATABASE_FIELD_MAP` (`:19-55`) at confidence 70. **Important:** because a Beneficiary is shared across all of a person's cases, `addMappedObjectCandidates` blocks every path listed in `CASE_SCOPED_CANONICAL_PATHS` for this prefix (`:238,241`, config in `modules/canonical/config/fieldScope.js`), so `immigration.currentStatus`, `immigration.currentVisaType`, `immigration.i94.*`, `immigration.sevis.id` are deliberately **not** read from it.
**UI CONSUMERS:** **NONE.** No component in `BAIS/Frontend/src` or `INSZoom/frontend/src` calls any `/beneficiaries` endpoint (verified by prefix extraction across both trees). Beneficiary data surfaces only as a populated sub-object on the Case payload (INSZoom `pages/CRMCaseDetail.jsx:1230-1237`).
**API CONSUMERS:** `case.service.js`, `case-lifecycle-orchestrator.service.js`, `CanonicalBuilderService.js`, `company.service.js`, `dashboard.service.js`, `document.service.js`, `employment-workflow.controller.js`, `family-workflow.controller.js`, `reminder-generation.service.js`, `report.service.js`, `search.service.js`, `uscis-form.service.js`.
**DB COLLECTIONS:** `beneficiaries`, `clients`, `cases`.
**EVENTS:** none.
**FAILURE IMPACT:** low direct UI impact (no UI); moderate data impact — the database-tier fallback for person fields in the canonical profile disappears.
**CHANGE IMPACT:** **MODERATE.** 12 backend files require the model, but the whole HTTP surface (12 routes) is dead weight. Renaming a `Beneficiary` field breaks `DATABASE_FIELD_MAP` (`CanonicalBuilderService.js:20-55`) silently — the map is a string table with no schema validation.

---

### MODULE: Question
**INPUTS:** `POST /api/questionnaires/:id/questions`, `/questions/bulk`, `PUT /:id/questions/:questionId`, `DELETE /:id/questions/:questionId`, `PUT /:id/reorder` (`Backend/src/modules/questionnaires/questionnaire.routes.js:48-52`). Also created in bulk by the checklist seeds (`modules/questionnaires/employmentChecklists.js`, `familyChecklists.js`, `singlePartyChecklists.js`, `modules/employment-workflow/questionnaires/{h1b,l1a,o1,p}.js`, `modules/family-workflow/questionnaires/{k1,k3}.js`).
**WRITES:** `questions` (`Backend/src/models/Question.js`). Unique index `{questionnaire, key}` (`:251`).
**READS:** `questions`, `questionlibraryitems`.
**UPSTREAM:** `Questionnaire` must exist (`question.questionnaire` is `required`, `:53`).
**DOWNSTREAM:** three consumers of `question.mapping.canonicalPath` (`:170`):
1. `CanonicalBuilderService.addQuestionnaireCandidates:262` — `answer.question?.mapping?.canonicalPath || QUESTION_KEY_MAP[answer.questionKey]`; a question with neither is silently dropped from canonical.
2. `immigration-knowledge-engine.service.js:242-243` — required-question canonical paths become `Case.knowledgePlan.requiredCanonicalFields`.
3. `question-library.service.js:198-207` — library key identity is derived from `canonicalPath`.
Plus `questionnaire.service.js:273` (`inferMasterDataPath`) and `:655-656` (library import).
**UI CONSUMERS:** INSZoom `pages/QuestionnaireTemplates.jsx:206,209,225` (question CRUD), `:124` (`GET /questionnaires/:id/uscis-mappings`); BAIS renders questions read-only via `hooks/useCaseQuestionnaire.js:41` and `components/questionnaire/QuestionInput.jsx`.
**DB COLLECTIONS:** `questions`, `questionnaires`, `questionlibraryitems`.
**EVENTS:** none.
**DEPENDENCIES:** none external.
**FAILURE IMPACT:** questionnaires render empty; canonical profile loses its questionnaire tier.
**CHANGE IMPACT:** **HIGH** for `mapping.canonicalPath` (see §16). Note the `pre("validate")` hook (`:190-249`) performs bidirectional aliasing between `showIf` ↔ `conditionalLogic` and `uscisMappings[]` ↔ `mapping.{uscisFormNumber,uscisFieldPath}` on every save — a change to either representation is silently rewritten into the other.

---

### MODULE: Answer
**INPUTS:** `POST /api/questionnaires/:id/answers`, `/answers/files`, `/autosave`, `/submit` (`questionnaire.routes.js:40,41,56,57`); `GET /:id/answers`, `/progress`, `/validation` (`:39,42,43`); `POST /responses/:responseId/review` (`:27`).
**WRITES:** `answers` — unique on `{responseId, questionKey}` (`Backend/src/models/Answer.js:121`); plus `cases.questionnaireData.*`, `cases.questionnaireReferences[].status`, and `cases.participants[].progress` / `participants[].canonicalProfile.profile` (atomic `$set` with array filters, `questionnaire.service.js:1048-1051`).
**READS:** `answers`, `questions`, `questionnaires`, `cases`.
**UPSTREAM:** Question definitions; `Case.questionnaireReferences[]` assignment.
**DOWNSTREAM:** `CanonicalBuilderService.loadSources:222` — `Answer.find({caseId: {$in: familyCaseIds}}).populate({path:"question", select:"mapping questionnaire"})`. Confidence tiering by status: `approved` 95 / `submitted` 85 / else 75 (`CanonicalBuilderService.js:269`). Also `CaseLifecycleOrchestrator.metrics:98` reads answer status for the questionnaire milestone.
**UI CONSUMERS:** BAIS `hooks/useQuestionnaireAnswers.js:179,223,258`, `hooks/useCaseQuestionnaire.js:70`, `Pages/Dashboard/Documents.jsx:774,782`, `components/questionnaire/CaseRoleChecklist.jsx:62,113`; INSZoom reads them via `hooks/useCaseQuestionnaire.js:29` (called 3× at `pages/CRMCaseDetail.jsx:346-348` for employer/employee/business_plan) rendered by `QuestionnaireAnswersPanel` (`:1660,1667,1674`). INSZoom does **not** write answers.
**DB COLLECTIONS:** `answers`, `cases`, `questions`, `documents` (file answers).
**EVENTS:** `CanonicalSyncService.syncCase` / `syncParticipant` invoked from `questionnaire.service.js:11`; `case:client_submitted` realtime.
**DEPENDENCIES:** `modules/uploads/upload.middleware.js` for file answers.
**FAILURE IMPACT:** clients cannot submit data; canonical profile loses its highest-confidence non-staff tier.
**CHANGE IMPACT:** **HIGH.** `Answer.caseId` scoping is load-bearing: `CanonicalBuilderService.js:215-217` deliberately widens the query to the whole case family (`[principal, ...childCases]` for a principal, `[parentCase, self]` for a child) precisely because a combined petition's answers live on two Case documents. Any change to `caseId` semantics, or to the `{responseId, questionKey}` uniqueness, re-partitions that set.

---

### MODULE: Questionnaire service
**INPUTS:** 47 routes on `/api/questionnaires` (`questionnaire.routes.js:12-58`). Service exports 47 functions (`questionnaire.service.js:2500-2547`), 2,547 lines.
**WRITES:** `questionnaires`, `questions`, `answers`, `questionlibraryitems`, `cases` (`questionnaireReferences[]`, `questionnaireData.*`, `participants[].progress`, `documentChecklist[]`), `documents`, `auditlogs`, `notifications`.
**READS:** all of the above plus `Backend/src/config/filingTypes.js` and the static checklist modules.
**UPSTREAM:** case creation → `immigration-knowledge-engine.orchestrate` → `intelligent-questionnaire.service` → `ensureDefaultVisaTemplates`.
**DOWNSTREAM:** `CanonicalSyncService` (`questionnaire.service.js:11`), `checklist-rule-engine.service.js`, `CaseLifecycleOrchestrator.metrics`.
**UI CONSUMERS:** BAIS `hooks/useCaseQuestionnaire.js:41`, `useCaseChecklists.js:22`, `useQuestionnaireAnswers.js`, `Pages/Dashboard/Documents.jsx:156,220-222`, `components/questionnaire/{CaseRoleChecklist,PrincipalCaseWorkspace,EmployeeSelfServiceView}.jsx`; INSZoom `pages/QuestionnaireTemplates.jsx:101-283` (template design), `pages/CRMCaseDetail.jsx:346-348,356` (read-only answers).
**DB COLLECTIONS:** `questionnaires`, `questions`, `answers`, `questionlibraryitems`, `cases`, `documents`, `notifications`, `auditlogs`.
**EVENTS:** questionnaire lifecycle notifications (`notificationRules.js` types `questionnaire_assigned`, `_reminder`, `_approved`, `_rejected`, `_corrections_requested`).
**DEPENDENCIES:** AI generation path (`generateQuestionnaireFromPrompt`, `POST /questionnaires/ai-generate`) depends on `modules/ai`.
**FAILURE IMPACT:** clients cannot see or answer anything; the whole intake half of the product stops.
**CHANGE IMPACT:** **CRITICAL.** This is the widest single service in the backend by write surface — it mutates 8 collections and three separate progress representations on `Case` (`questionnaireData.progress`, `questionnaireReferences[].status`, `participants[].progress`). The `nextReferenceStatus` write path uses an atomic `updateOne` (no document validators) — the in-code note at `models/Case.js:337-345` records that this previously wrote an enum-invalid `"completed"` value that only surfaced on the next full `.save()`.

---

### MODULE: CanonicalBuilderService
**INPUTS:** `CanonicalBuilderService.build(caseId)` (`Backend/src/modules/canonical/services/CanonicalBuilderService.js:394`), called by `CanonicalProfileService.rebuild`.
**WRITES:** nothing directly — returns `{profile, fieldMetadata, sources, conflicts, sourceFingerprint}`. `CanonicalProfileService` persists it to `cases.canonicalProfile.*` and appends `cases.canonicalHistory[]`.
**READS (8 parallel loads, `:218-227`):** `cases` (self), `beneficiaries`, `companies`, `users`, `answers` (family-scoped, `:222`), `documents` (`:223`), `documentextractions` (`:224`), `employerprofiles` (`:225`), `employeeprofiles` (`:226`).
**UPSTREAM:** everything that produces data — questionnaire answers, OCR extractions, staff profile edits, form edits.
**DOWNSTREAM:** `CanonicalMergeService.merge` (`:416`) → `Case.canonicalProfile.profile` → `CanonicalDataService.build` → `FormMappingService.mapTemplate` → `AutoFillService.mergeMappedFields` → `CaseForm.fieldValues` → `PDFFieldMapper` → the rendered USCIS PDF. This is the **single data spine** of the product.
**UI CONSUMERS:** **NONE directly.** `/api/canonical/*` (11 routes, `modules/canonical/routes/canonicalRoutes.js:8-18`) has zero call sites in either portal. Canonical state reaches the UI only embedded in the USCIS form workspace payload (`interactive-form-review.service.js` → INSZoom `components/uscis/USCISFormRenderer.jsx:1386-1388,1554,1619`).
**API CONSUMERS:** `CanonicalProfileService.rebuild/validate`, reached from `CanonicalSyncService.syncCase:33`, `CaseLifecycleOrchestrator.generateForms:462`, `AutoFillService.overrideField:411`.
**DB COLLECTIONS:** 8 (above) + `cases` for the write-back.
**EVENTS:** `canonicalProfileEvents` (`CanonicalProfileService.js:39`).
**DEPENDENCIES:** `MappingResolver`, `CanonicalMergeService`, `CanonicalTransformationService`, `config/profileCanonicalMap.js`, `config/fieldScope.js`.
**FAILURE IMPACT:** every USCIS form autofills blank. This is the highest-consequence non-auth module in the system.
**CHANGE IMPACT:** **CRITICAL.** Three hardcoded string tables define the entire ingestion surface and none is schema-validated: `DATABASE_FIELD_MAP` (72 entries, `:19-77`), `QUESTION_KEY_MAP` (29 entries, `:79-109`), `OCR_FIELD_MAP` (32 entries, `:111-142`). A renamed source field or canonical path silently drops the value — no error, no warning, just a `missingFields` entry downstream. The `caseRole`-dependent branches at `:201-217` and `:400-408` mean a change to `Case.caseRole` re-partitions which answers and which profile the builder can even see.

---

### MODULE: CanonicalSyncService
**INPUTS:** `syncParticipant(caseId, participantId, profilePatch, user, req, reason)` (`Backend/src/modules/canonical/services/CanonicalSyncService.js:6`), `syncCase(caseId, user, req, reason)` (`:31`), `syncFromDocument(document, …)` (`:40`), `syncFromExtraction(extraction, …)` (`:46`). 53 lines total.
**WRITES:** `cases.participants[].canonicalProfile` (`:12-27`, followed by `markModified("participants")` + full-document `save()`); indirectly `cases.canonicalProfile` via `CanonicalProfileService.rebuild` (`:33`).
**READS:** `cases` (`Case.findById(caseId)` at `:8` — a **full document load**, no projection).
**UPSTREAM:** three callers only — `questionnaire.service.js:11`, `documents/document.workflow.service.js:3`, `document-intelligence/services/document-intelligence.service.js:13`.
**DOWNSTREAM:** `CanonicalProfileService.rebuild` and `immigration-knowledge-engine.refreshAfterCanonicalSync` (`:34-36`, wrapped in `.catch(() => null)` — failures are silent).
**UI CONSUMERS:** none (invoked as a side effect of answer saves, document uploads, and OCR completion).
**API CONSUMERS:** the three services above.
**DB COLLECTIONS:** `cases`.
**EVENTS:** none of its own.
**DEPENDENCIES:** `CanonicalProfileService`, `case-participant.service`.
**FAILURE IMPACT:** canonical data goes stale; forms autofill from an old snapshot. Because the knowledge-engine refresh is `.catch(() => null)`'d (`:36`), a failure there is invisible.
**CHANGE IMPACT:** **HIGH**, with a **structural disconnect worth recording**: `syncParticipant` writes participant-scoped canonical data to `cases.participants[].canonicalProfile.profile`, but `CanonicalBuilderService` **never reads that path** — its 8 sources (`:218-227`) do not include participant canonical profiles. Participant-scoped canonical data is consumed only by `document-intelligence/services/extraction-mapping.service.js:73-74` and `questionnaire.service.js:2064`. So there are two parallel canonical stores, and only the case-level one reaches PDF generation.

---

### MODULE: AutoFillService
**INPUTS:** `/api/cases/:caseId/forms/:formType/{autofill,preview,validation,regenerate,refresh,repopulate-fields,reset-auto-filled,rollback/:versionNumber}` and `PATCH .../fields/:fieldId/{override,review}` (`Backend/src/modules/form-mapping/routes/autoFillRoutes.js:8-17`). Static entry points: `generate` (`AutoFillService.js:203`), `overrideField` (`:385`), `repopulateFields` (`:530`), `resetAutoFilledFields` (`:539`), `reviewField` (`:587`), `rollback` (`:617`).
**WRITES:** `caseforms` — `filledData`, `fieldValues`, `sourceAttribution`, `manualOverrides`, `fieldReviews`, `completion`, `autoFillReport`, `validationErrors`, `syncState`, `versionNumber`, `versions[]` (full snapshot pushed on every regenerate, `:244-246`), `auditHistory[]`; `auditlogs` (`:31-41`); `employerprofiles`/`employeeprofiles` via `applyFormEditToProfile` (`:353,370`); `cases.canonicalProfile` via `CanonicalProfileService.applyStaffEdit` (`:411`).
**READS:** `caseforms`, `uscisformtemplates` (`:207,214`), `uscismappingversions` (`:210`), the canonical profile via `CanonicalDataService.build` (`:216`), `cases` (`:342,409`), and the reverse index (`ReverseIndexService.buildFormReverseIndex`, `:330,490`).
**UPSTREAM:** canonical profile must be built; a `USCISFormTemplate` with a mapping graph must exist.
**DOWNSTREAM:** `CaseForm.fieldValues` → `PDFFieldMapper` → `PDFRenderer` → the PDF; `CaseLifecycleOrchestrator.recalculate` (`:294`).
**UI CONSUMERS:** **NONE.** All 10 `autoFillRoutes` endpoints have zero call sites in either portal (verified by prefix extraction and targeted grep across both trees). The service is reached only internally: `CaseLifecycleOrchestrator.generateForms:487` and `InteractiveFormReviewService.saveField` (`interactive-form-review.service.js:413`).
**API CONSUMERS:** the two above.
**DB COLLECTIONS:** `caseforms`, `uscisformtemplates`, `uscismappingversions`, `cases`, `employerprofiles`, `employeeprofiles`, `auditlogs`.
**EVENTS:** audit actions `AUTO_FILL_STARTED`, `FORM_GENERATED`/`FORM_REGENERATED`, `FIELDS_UPDATED`, `AUTO_FILL_COMPLETED`, `FIELD_OVERRIDDEN`, `CONFLICT_DETECTED`, `AUTO_FILLED_FIELDS_RESET`, `FORM_ROLLED_BACK`.
**DEPENDENCIES:** `FormMappingService`, `MappingResolver`, `ReverseIndexService`, `SyncStateService`, `ValidationService`, `CanonicalDataService`, `CanonicalProfileService`, `profileCanonicalMap`.
**FAILURE IMPACT:** forms stay empty; staff must hand-key every field.
**CHANGE IMPACT:** **CRITICAL.** Two structural hazards: (a) `findCaseForm` (`:198-201`) resolves a form by `{caseId, formCode}` only, ignoring `participantId`, while `CaseForm`'s uniqueness is `{caseId, formTemplateId, participantId}` (`models/CaseForm.js:241`) — the two disagree about identity; (b) `overrideField` writes canonical **first** (`:406-419`) then the CaseForm, and on a canonical version change re-runs a full `generate(…, {regenerate:true})` (`:492`) which pushes another full `versions[]` snapshot — so a single field edit can cost one whole extra copy of `filledData`+`fieldValues`+`sourceAttribution` in the document.
**Security note:** none of the 10 routes performs a per-case authorization check. `autoFillRoutes.js:6` applies `authenticate`; each route adds only `authorizePermissions("forms:read"|"forms:update")`. `AutoFillService.js` never imports `case.service` and never calls `canAccessCase`. See §0.8-S2.

---

### MODULE: USCISFormTemplate
**INPUTS:** `/api/uscis-forms` CRUD + registry + lifecycle (`Backend/src/modules/uscis-forms/uscis-form.routes.js:7-17,53-60`); `/api/uscis/forms/*` import pipeline (`modules/uscis-form-import/routes/uscisFormImportRoutes.js:23-38`); `/api/uscis/*` lifecycle/scanner (`modules/uscis-lifecycle/routes/uscisLifecycleRoutes.js`). Seeds: `modules/uscis-form-import/seeds/{i129,i129f,i130,i134,i539,i539a,i907}.seed.js` (npm scripts `seed:i129`… and `seed:uscis-forms`, `Backend/package.json:20-27`).
**WRITES:** `uscisformtemplates`, `uscismappingversions`, `uscisformsyncruns`.
**READS:** `uscisformtemplates` (TTL-cached, projected list at `uscis-form.service.js` `activeTemplatesCached`), object storage for the PDF asset (`artifacts.form.storageKey`, `models/USCISFormTemplate.js:26-38`).
**UPSTREAM:** the USCIS scanner job (`modules/uscis-lifecycle/jobs/USCISMonitoringJob.js`, `Backend/src/jobs/USCISScanner.js`) and manual import/upload.
**DOWNSTREAM:** `CaseForm.formTemplateId` + `formVersionLock` (`models/CaseForm.js:8-27`); `FormMappingService.loadTemplate`; `PDFRenderer.loadTemplatePdf` (`PDFRenderer.js:43-56`); `ensureAssignedForms` template selection (`uscis-form.service.js:468-486`).
**UI CONSUMERS:** INSZoom `pages/USCISForms.jsx:84,96,138,149,159,169,179,199,210,231,258,280,301,313,323`; `components/uscis/USCISFormRenderer.jsx:673` (`GET /uscis-forms/:templateId/pdf` as a blob, rendered by react-pdf).
**API CONSUMERS:** `AutoFillService`, `uscis-form.service`, `interactive-form-review.service`, `PDFRenderer`, `PDFFieldMapper`, `PDFValidationService`, `PDFFidelityService`.
**DB COLLECTIONS:** `uscisformtemplates`, `uscismappingversions`, `uscisformsyncruns`, `caseforms`.
**EVENTS:** sync-run records; `Case.timeline` "USCIS Form Assigned" (`uscis-form.service.js:557`).
**DEPENDENCIES:** `pdf-lib` (via `PDFRenderer`), `qpdf` (via `utils/normalizePdf.js` — a **hard external binary dependency**; `PDFRenderer.js:42` documents that a missing qpdf surfaces as `QPDF_NOT_FOUND`), object storage.
**FAILURE IMPACT:** no forms can be assigned, filled, or rendered.
**CHANGE IMPACT:** **HIGH** — mostly for payload-size reasons. A single template document embeds `formFields[]` (~1,000 entries with coordinates, widgets, mappings), `sections[]`, `mappingGraph`, `pdfFieldMappings[]`, and `mappingAuditHistory[]`; the model's own comments record documents approaching MongoDB's 16 MB ceiling. `uscis-form.controller.js:173-181` documents a **live 500** caused by an unprojected `.populate("formTemplateId")` across ~100 rows exceeding V8's max string length. Any new populate of this model without a tight `.select()` is a production incident.

---

### MODULE: CaseForm
**INPUTS:** created by `ensureAssignedForms` (`uscis-form.service.js:514`) and `AutoFillService.generate` (`AutoFillService.js:223`) — **these are the only two construction sites in the entire backend**. Mutated through `/api/uscis-forms/case/:caseId/:formId/*` (36 routes, `uscis-form.routes.js:19-52`), `/api/forms/:caseFormId/*` (`formGenerationRoutes.js:11-19`), and `/api/cases/:caseId/forms/:formType/*` (`autoFillRoutes.js:8-17`).
**WRITES:** `caseforms`.
**READS:** `caseforms`, `uscisformtemplates` (populate).
**UPSTREAM:** `Case` + `USCISFormTemplate` + canonical profile.
**DOWNSTREAM:** `PDFFieldMapper.mapFields(caseForm, template)` → `PDFRenderer.render` → `documents` (generated PDF) → `FilingPackageService` → petition package.
**UI CONSUMERS:** INSZoom `components/uscis/USCISFormRenderer.jsx` (the full editing workspace, `:544,673,735,965,971,983,992,1002,1015,1028,1037,1047,1058,1063,1073,1091,1114,1139,1281,1643,1657`), `pages/CRMCaseDetail.jsx:606,2275`, `pages/USCISForms.jsx:121`. BAIS has **no** CaseForm UI at all.
**API CONSUMERS:** `AutoFillService`, `uscis-form.service`, `interactive-form-review.service`, `PDFGenerationService`, `PDFValidationService`, `PDFFidelityService`, `FilingPackageService`, `CaseLifecycleOrchestrator.metrics`, `requireCaseFormAccess`.
**DB COLLECTIONS:** `caseforms`, `uscisformtemplates`, `documents`, `auditlogs`, `tasks`.
**EVENTS:** per-field `fieldHistory[]`, per-document `auditHistory[]`, `comments[]`; `AuditLog` rows via `AutoFillService.audit`.
**DEPENDENCIES:** MongoDB.
**FAILURE IMPACT:** no USCIS form can be opened, edited, generated, or filed — the deliverable of the product.
**CHANGE IMPACT:** **CRITICAL.** Growth hazard: `versions[]` (`models/CaseForm.js:47-61`) is uncapped and each entry embeds a complete copy of `filledData`, `fieldValues`, `sourceAttribution`, `validationErrors`, and `completion`. Every regenerate — including the implicit one inside `overrideField` (`AutoFillService.js:492`) — appends one. Index coverage is adequate (16 declared, `:240-256`, including both `{caseId, updatedAt:-1}` and bare `{updatedAt:-1}` for the two list-sort shapes).

---

### MODULE: PDF rendering
**INPUTS:** `PDFRenderer.render({caseForm, template, watermark, flatten})` (`Backend/src/modules/form-generation/services/PDFRenderer.js:93`) and `renderFiling({caseForm, template})` (`:159`).
**WRITES:** nothing directly; on a field-count mismatch it re-normalizes the template PDF and **caches the normalized bytes back to the same storage key** (`:50-52`) — a write side effect inside a render path.
**READS:** the template PDF from object storage (`:20`) or local disk (`:27-28`); `caseForm.fieldValues`/`filledData` via `PDFFieldMapper.mapFields` (`:115`).
**UPSTREAM:** `AutoFillService` must have populated `fieldValues`; the template must expose real AcroForm fields.
**DOWNSTREAM:** `PDFGenerationService.createGeneratedDocument` → `documents` collection → `CaseForm.generatedPdfDocument` / `generatedPdfVersions[]` → `FilingPackageService.assemble`.
**UI CONSUMERS:** indirectly — INSZoom `USCISFormRenderer.jsx:1063` (`POST /forms/:caseFormId/generate`), `:1073` (preview), `:1091` (download), `:1114` (draft), `:1139` (filing copy).
**API CONSUMERS:** `PDFGenerationService`, `FormGenerationController.draftPdf:77` and `.filingPdf:116`, `PDFFidelityService`.
**DB COLLECTIONS:** `caseforms`, `uscisformtemplates`, `documents`.
**EVENTS:** `renderReport` (mapped/unmapped/failed field counts) persisted on the generated document.
**DEPENDENCIES:** **`pdf-lib`** (lazily required, `:9-17`; missing → hard 501) and **`qpdf`** via `utils/normalizePdf.js` (`:49`). USCIS PDFs are hybrid XFA+AcroForm and parse "successfully" with zero fields unless normalized — `:43-56` documents this explicitly.
**FAILURE IMPACT:** no filing artifact. Two guards prevent silent corruption: a 0-field-after-normalization check that throws `TEMPLATE_PDF_NO_FIELDS` 422 (`:106-114`, added after two 883-byte blank "generated" forms were found), and `PDFFidelityService.verify` on the filing copy (`:162-169`, throws `PDF_FIDELITY_FAILURE`).
**CHANGE IMPACT:** **HIGH.** `setFormField` (`:58-91`) dispatches on `field.constructor.name` string matching (`CheckBox`, `RadioGroup`, `Dropdown`, `OptionList`) — a `pdf-lib` major-version bump that renames those classes silently degrades every non-text field to `setText`. The non-flattened path sets `NeedAppearances = true` (`:133`), which is what makes filled values visible in Acrobat/Chrome.

---

### MODULE: PDF editing (interactive form workspace)
**INPUTS:** `GET /api/uscis-forms/case/:caseId/:formId/workspace` plus 20 mutation routes (`uscis-form.routes.js:28-52`). Service: `InteractiveFormReviewService` (`Backend/src/modules/uscis-forms/interactive-form-review.service.js`, 842 lines, 32 static methods at `:76-815`).
**WRITES:** `caseforms` (`fieldValues`, `fieldHistory[]`, `fieldReviews`, `sectionReviews`, `reviewState`, `comments[]`, `status`), `tasks`, `auditlogs`, and — via `AutoFillService.overrideField` — `cases.canonicalProfile` and `employer/employeeprofiles`.
**READS:** `caseforms` + populated `uscisformtemplates` (excluding `-definition`), `cases`, canonical state, `documents` (source attribution).
**UPSTREAM:** a `CaseForm` must exist and be editable (`assertEditable`, `:179`).
**DOWNSTREAM:** `AutoFillService.overrideField` (`:413`) → canonical write-back → sibling-field fan-out → profile write-back.
**UI CONSUMERS:** INSZoom `components/uscis/USCISFormRenderer.jsx` — this is the sole consumer, and it is a **true AcroForm editor**: `react-pdf` renders `<Page renderAnnotationLayer renderForms>` (`:468-477`), values are injected into pdfjs's `annotationStorage` via `utils/PDFFieldChangeAdapter.js:120-131`, and each change is persisted with `PATCH .../workspace/field` on a 3-step backoff `[500,1000,2000]` (`:732-756`), guarded by a `beforeunload` dirty check (`:588-597`).
**API CONSUMERS:** none.
**DB COLLECTIONS:** `caseforms`, `uscisformtemplates`, `cases`, `documents`, `tasks`, `auditlogs`, `employerprofiles`, `employeeprofiles`.
**EVENTS:** `FIELD_EDITED`, `FIELD_APPROVED`/`REJECTED`, `CONFLICT_DETECTED`, form decision/lock audit entries; team notifications via `notifyCaseTeam` (`:186`).
**DEPENDENCIES:** `AutoFillService`, `MappingResolver`, `SyncStateService`, `CanonicalProfileService`.
**FAILURE IMPACT:** staff cannot correct a form before filing — the last human checkpoint before a government submission.
**CHANGE IMPACT:** **CRITICAL.** Two confirmed hazards: (a) the post-override reload at `:414` (`CaseForm.findById(caseFormId).populate(...)`) has **no `.maxTimeMS()`**, unlike the read one hop earlier — this is the specific gap that turns a dead pooled connection into a user-visible "save failed"; (b) `saveField` addresses the form by `caseFormId` but delegates to `AutoFillService.overrideField(caseId, caseForm.formCode, …)`, which re-resolves by `{caseId, formCode}` (`AutoFillService.js:200`) — if a case ever holds two CaseForms with the same `formCode`, the edit lands on whichever was updated most recently, not the one the user has open.

---

### MODULE: PDF download
**INPUTS:** `GET /api/forms/:caseFormId/preview` (`FormGenerationController.js:26`), `/download` (`:37`), `/draft-pdf` (`:72`), `/filing-pdf` (`:105`); `GET /api/uscis-forms/:id/pdf` (raw template, `uscis-form.routes.js:53`); `GET /api/documents/:id/download` and `/preview` (`document.routes.js:71-72`); `GET /api/petition/packages/:packageId/download?format=` .
**WRITES:** `/download` writes an audit row `PDF_DOWNLOADED` (`FormGenerationController.js:40`). **`/filing-pdf` — a GET — creates a `Document` record** (`:121`, `PDFGenerationService.createGeneratedDocument`) and an audit row. `/draft-pdf` is genuinely read-only (`:69`).
**READS:** `caseforms`, `uscisformtemplates`, `documents`, object storage.
**UPSTREAM:** for `/preview` and `/download`, a generated PDF must already exist; INSZoom pre-fires `POST /forms/:id/generate` before both (`USCISFormRenderer.jsx:1072,1090`).
**DOWNSTREAM:** the browser. Filing copy is gated to `["approved","ready_for_pdf","locked","generated"]` (`FormGenerationController.js:103,108-113`).
**UI CONSUMERS:** INSZoom `USCISFormRenderer.jsx:1073` (preview → `window.open`), `:1091` (download → anchor), `:1114` (draft), `:1139` (filing copy); `pages/petition/PetitionViewer.jsx:67`; `pages/CRMCaseDetail.jsx:154,166-177` and `pages/Documents.jsx:75,100` (document preview via `<iframe>` + blob URL); `pages/petition/PdfDocumentPages.jsx:41` (react-pdf page stack). BAIS: **download-only, no viewer** — `Pages/Dashboard/Payments.jsx:362` (receipt) and `Pages/Dashboard/Messages.jsx:172-183` (attachments); `package.json` contains no PDF library.
**API CONSUMERS:** `FilingPackageService.readItemBuffer` reads the same stored artifacts.
**DB COLLECTIONS:** `caseforms`, `documents`, `auditlogs`.
**EVENTS:** `PDF_DOWNLOADED`, `PDF_FILING_COPY_DOWNLOADED`.
**DEPENDENCIES:** `storage.service.readBuffer`, `pdf-lib`, `WatermarkService`.
**FAILURE IMPACT:** the case cannot be filed.
**CHANGE IMPACT:** **MODERATE.** All four form routes are correctly gated by `requireCaseFormAccess` (`formGenerationRoutes.js:14-17`). The `filing-pdf`-writes-on-GET behavior (`FormGenerationController.js:121`) is the same class of problem `docs/forms/issues/ISSUE-003` was opened for; that issue's fix covered `/workspace` only.

---

### MODULE: OCR (document intelligence)
**INPUTS:** 27 routes on `/api/document-intelligence` (`Backend/src/modules/document-intelligence/document-intelligence.routes.js:21-51`), notably `POST /upload`, `POST /autofill`, `POST /case/:caseId/autofill`, `POST /documents/:documentId/{classify,extract}`, and the review surface `/analyses/*`, `/review-queue`, `/:id/{approve,reject,field,classification,reprocess}`.
**WRITES:** `documentextractions`, `documentanalyses`, `documentprocessingjobs`, `documents` (`intelligenceStatus`, `ocr.*`), `cases.questionnaireData.masterDataPrefill[]`, `cases.participants[].canonicalProfile`.
**READS:** `documents` + the stored file, `uscisformtemplates` (for field matching), `config/field-mapping.registry.js`, `config/autofill-document-types.js`.
**UPSTREAM:** a `Document` must be uploaded and stored.
**DOWNSTREAM:** `CanonicalBuilderService.addOcrCandidates` (`:279-301`) maps extraction fields through `OCR_FIELD_MAP` (`:111-142`) into canonical candidates; `CanonicalSyncService.syncFromExtraction` (`:46-49`) triggers the rebuild.
**UI CONSUMERS:** **BAIS only.** `components/questionnaire/QuestionInput.jsx:29` (`AutofillButton` → `POST /document-intelligence/case/:caseId/autofill`), `Pages/Dashboard/DocumentReview.jsx:27,28,29,92` (the review queue). **INSZoom calls zero document-intelligence endpoints** — staff have no OCR review surface in the admin portal despite `reviewerRoles` being `super_admin`/`admin`/`team_lead`/`case_manager` server-side.
**API CONSUMERS:** `document.service`, `document.workflow.service`, `extraction-mapping.service`, `case-workbook.service`.
**DB COLLECTIONS:** `documentextractions`, `documentanalyses`, `documentprocessingjobs`, `documents`, `cases`.
**EVENTS:** job queue lifecycle (`queues/document-intelligence.queue.js` — an **in-process array + `setImmediate` drain** at `:7-46`, not BullMQ, despite `bullmq` being a declared dependency in `Backend/package.json`).
**DEPENDENCIES:** `@google-cloud/documentai` via `providers/google-document-ai.provider.js`, registered at `services/document-intelligence.service.js:38-41`. **Provider resolution defaults to the string `"gemini"`** (`providers/document-intelligence-provider.registry.js:17`) which is **not registered** — OCR works only because `Backend/.env:18` sets `DOCUMENT_INTELLIGENCE_PROVIDER=google_document_ai`. Any deployment omitting that variable gets `503 DOCUMENT_PROVIDER_UNAVAILABLE` on every classify/extract.
**FAILURE IMPACT:** clients must type everything by hand; the OCR confidence tier disappears from canonical.
**CHANGE IMPACT:** **HIGH.** `OCR_FIELD_MAP` (`CanonicalBuilderService.js:111-142`) is the sole bridge from extraction to canonical, and `CanonicalMergeService`'s source priority is what decides whether an unverified OCR value outranks a client's submitted-but-unapproved answer.

---

### MODULE: Documents
**INPUTS:** 33 routes on `/api/documents` (`Backend/src/modules/documents/document.routes.js:14-78`), including chunked resumable upload sessions (`:26-40`), bulk upload/download (`:23-24`), evidence linking (`:68-69`), review (`:77`), versions (`:64-67`).
**WRITES:** `documents`, `documentuploadsessions`, `cases.documentChecklist[].uploadedFiles`, `cases.participants[].documentIds`, `auditlogs`, object storage.
**READS:** `documents`, `cases`, `beneficiaries`, `clients`, storage.
**UPSTREAM:** authentication; for case-scoped documents, `canAccessCase`.
**DOWNSTREAM:** OCR queue (`documentIntelligenceQueue.enqueue`), `CanonicalBuilderService.loadSources:223`, `CaseLifecycleOrchestrator.metrics:99-102` (documents milestone + filing-package detection by `tags:"filing-package"`), `evidence.service`, `FilingPackageService`, `PetitionAssemblyService`.
**UI CONSUMERS:** BAIS `hooks/useDocumentChecklist.js:32,56,72`, `Pages/Dashboard/Documents.jsx:462,649`, `Dashboard.jsx:849`, `components/checklist/DocumentUploadControl.jsx`; INSZoom `pages/Documents.jsx:257,460,504`, `pages/CRMCaseDetail.jsx:154,168,268,561,808`, `pages/petition/PdfDocumentPages.jsx:41`.
**API CONSUMERS:** OCR, canonical, petition, form-generation, lifecycle.
**DB COLLECTIONS:** `documents`, `documentuploadsessions`, `documentextractions`, `cases`, `auditlogs`.
**EVENTS:** `document.workflow.service` triggers `CanonicalSyncService.syncFromDocument`; upload-progress socket events.
**DEPENDENCIES:** `modules/uploads/storage.service.js`, `modules/uploads/file-security.service.js` (magic-byte detection via the `file-type` package + a malware scan), `multer` limits.
**FAILURE IMPACT:** evidence cannot be collected; the documents milestone can never complete, blocking `caseManagerReviewComplete` (`case-lifecycle-orchestrator.service.js:161`).
**CHANGE IMPACT:** **HIGH.** `DELETE /documents/:id` (`document.routes.js:78`) carries **no** `authorizeRoles`/`authorizePermissions` — authorization is entirely a controller-level ownership check. That is a deliberate, verified pattern, but it means route-level analysis of this module is misleading.

---

### MODULE: Notifications
**INPUTS:** 27 routes on `/api/notifications` (`Backend/src/modules/notifications/notification.routes.js:11-102`). Service surface: 16 exports (`notification.service.js:519-536`), chiefly `createNotification`, `createForRoles`, `createFromEvent`.
**WRITES:** `notifications`, `notificationpreferences`, `notificationtemplates`, `devicetokens`, `emaillogs` (delegated).
**READS:** `notifications`, `users` (role fan-out), `notificationpreferences`.
**UPSTREAM:** ~32 call sites across case, questionnaire, document, payment, lead, and form modules.
**DOWNSTREAM:** in-app bell, FCM push (`push.service.js`, `firebase-admin`), email (`emailTemplate`/`emailTo`/`emailData` passed through `createNotification`, e.g. `case-lifecycle-orchestrator.service.js:363-365`).
**UI CONSUMERS:** BAIS `components/NotificationBell.jsx:46,55,68,122,129`, `services/notificationService.js:67,120`; INSZoom `contexts/NotificationContext.jsx:49,64,94,106`, `layouts/Layout.jsx:120-124,250,269,281`.
**API CONSUMERS:** every domain module that notifies.
**DB COLLECTIONS:** `notifications`, `notificationpreferences`, `notificationtemplates`, `devicetokens`, `emaillogs`.
**EVENTS:** Socket.IO. The two portals listen on **different event names** — BAIS on `new_notification` (`components/NotificationBell.jsx:68`), INSZoom on `notification:new` (`contexts/NotificationContext.jsx:158`). `createNotification` dual-emits both to the target user (`notification.service.js:245-246`), so direct notifications reach both. **But `createForRoles` emits only `notification:new`** (`:251`) — so every role-fanout notification (e.g. `lead_approved`, `quiz.service.js:314-318`) is invisible in real time to BAIS clients and only appears on the next bell fetch.
**DEPENDENCIES:** `firebase-admin` (`config/firebase-admin.js`), `modules/email`, `modules/realtime`.
**FAILURE IMPACT:** silent — users simply stop being told things. Nearly every call site is `.catch(() => null)`'d (e.g. `case-lifecycle-orchestrator.service.js:366,385`), so a notification failure never surfaces.
**CHANGE IMPACT:** **MODERATE.** `notificationRules.js` supplies `{priority, channels}` defaults per `type` and is fallback-only (its own header comment records that all 32+ existing call sites pass explicit values). Adding a type without a rule entry is safe; renaming one silently drops it to defaults.

---

### MODULE: Email
**INPUTS:** `emailService.sendTemplateEmail(templateKey, {to, cc, data, caseId, userId, triggeredBy, source, attachments})` — the single public entry point (`Backend/src/modules/email/email.service.js:106,117-120`).
**WRITES:** `emaillogs` — one row per attempt, created **before** dispatch and updated to `sent`/`failed`/`skipped` (`:77,84-87,92-96,98-100`).
**READS:** the 16-entry `TEMPLATES` registry (`:8-25`), each backed by a file in `modules/email/templates/` (all 16 files verified present).
**UPSTREAM:** any module needing to email; `modules/email/providers/index.js` → `nodemailer.provider.js`.
**DOWNSTREAM:** SMTP.
**UI CONSUMERS:** none (server-side only).
**API CONSUMERS:** `case-lifecycle-orchestrator` (via notification `emailTemplate`), `case.controller`, `quiz.service.js:302,309`, `consultation.service`, `auth` invite/reset flows, `client-intake`.
**DB COLLECTIONS:** `emaillogs`.
**EVENTS:** none.
**DEPENDENCIES:** `nodemailer`, SMTP env config.
**FAILURE IMPACT:** **degraded, never fatal by design** — an unconfigured provider records `status:"skipped"` rather than throwing (`:82-88`), so callers need no try/catch. Consequence: an entirely unconfigured mail setup is invisible except in `emaillogs`.
**CHANGE IMPACT:** **LOW–MODERATE.** `sendTemplateEmail` throws on an unknown key (`:107`), so removing a template is a hard failure at its call sites; adding one is additive. The architectural rule ("no inline HTML in a controller or service", `:4-7`) is currently honored.

---

### MODULE: Assignments
**INPUTS:** `PUT /api/cases/:id/assign-case-manager` (`case.routes.js:72-82`), `PUT /:id/assign-team-lead` (`:83`), `PUT /:id/ownership` (`:84`), `GET /:id/assignment-history` (`:102`), `POST /:id/...` bulk (`case.routes.js:20`); and the collaboration route `POST /api/cases/:caseId/assignments` (`collaborationRoutes.js:12` → `CollaborationController.assign` → `AssignmentService.assign`).
**WRITES:** `cases` — `assignedCaseManager`, `primaryOwner`, `secondaryOwner`, `assignedTeamLead`, `assignedAgentUser`, `assignmentHistory[]`, `status` (`case.service.js:457-479`); `caseassignmentevents`; `notifications`; `auditlogs`. Cascades to child cases via `case.controller.js:298` (`{parentCase, assignmentOverridden: {$ne:true}}`).
**READS:** `users` (`GET /users/assignable`, `/users/case-managers`), `cases`.
**UPSTREAM:** RBAC (`cases:assign`).
**DOWNSTREAM:** `CaseLifecycleOrchestrator.onAssignment` (`:404-423`) → safety-net form provisioning + `recalculate`; `assigned` metric (`:158`) feeds the `case_assigned` milestone.
**UI CONSUMERS:** INSZoom `pages/CRMCaseDetail.jsx:764-793` (assign modal), `pages/CRMCases.jsx:62-72` (pending-assignment queue), `components/CreateCaseModal.jsx:88`, `pages/TaskDetails.jsx:136`, `pages/Teams.jsx:225,244,253,263`. BAIS: none.
**API CONSUMERS:** `AssignmentService`, `NotificationOrchestrator`, `TimelineService`.
**DB COLLECTIONS:** `cases`, `caseassignmentevents`, `users`, `notifications`, `auditlogs`.
**EVENTS:** `case:assigned` realtime (INSZoom `CRMCases.jsx:104`); `CASE_REASSIGNED` audit.
**DEPENDENCIES:** `case.service.assignUser`, `roleHierarchy`.
**FAILURE IMPACT:** cases sit unassigned; `generateForms` hard-blocks with 409 unless the actor is `super_admin`/`admin` (`case-lifecycle-orchestrator.service.js:438`).
**CHANGE IMPACT:** **MODERATE**, with a **confirmed dead branch**: `AssignmentService.fieldFor` (`modules/case-collaboration/services/AssignmentService.js:6-15`) maps `finance → "assignedFinance"` and `documentation_specialist → "assignedDocumentationSpecialist"`. Neither field exists on `caseSchema` (verified — `models/Case.js` contains only `assignedAgentUser` at `:536`), so `caseData[field] = payload.userId` at `:22` is silently discarded by Mongoose strict mode. The same two phantom fields are read at `modules/ai/ai-orchestration.service.js:263`, `modules/reports/report.service.js:391-392`, and `modules/workflows/workflow.service.js:327`, where they always evaluate to `undefined`.

---

### MODULE: Dashboard
**INPUTS:** `/api/dashboard/*` — 14 routes (`Backend/src/modules/dashboard/dashboard.routes.js:13-46`, incl. saved dashboards and scheduled reports); `/api/analytics/*` — 12 routes (`modules/dashboard/analytics.routes.js:10-21`), both served by `dashboard.controller.js`; plus `/api/cases/dashboard/{stats,team-lead,needs-attention,recent-activity}` (`case.routes.js:16-19`).
**WRITES:** `dashboards` (saved layouts), `scheduledreports`.
**READS:** `cases`, `users`, `documents`, `payments`, `answers`, `beneficiaries`, `tasks`, `appointments`, `messages` (aggregations in `dashboard.service.js`, 447 lines).
**UPSTREAM:** all domain data.
**DOWNSTREAM:** UI only.
**UI CONSUMERS:** INSZoom `pages/Dashboard.jsx:922,931,940,965,986,998,1010`, `pages/Analytics.jsx:71-76`, `pages/PaymentsOverview.jsx:79,88`, `components/CaseManagerAnalyticsPanel.jsx:67`; BAIS `Pages/Dashboard/Dashboard.jsx` uses `/cases/my` + `/cases/:id/workflow`, not this module. **The `/api/dashboard/*` router itself has zero UI consumers** — INSZoom exclusively uses `/api/analytics/*` and `/api/cases/dashboard/*`. Verified by API-prefix extraction across both frontends.
**API CONSUMERS:** none.
**DB COLLECTIONS:** `dashboards`, `scheduledreports`, and read-only across ~9 domain collections.
**EVENTS:** none.
**DEPENDENCIES:** MongoDB aggregation.
**FAILURE IMPACT:** staff lose visibility; no data-integrity consequence.
**CHANGE IMPACT:** **LOW–MODERATE.** Read-only over other modules' shapes, so it is a *victim* of schema changes rather than a source of them. The duplicated mount (`routes/index.js:11-12` mounts `dashboard.routes` at `/dashboard` and `analytics.routes` at `/analytics`, both backed by the same controller) means a controller change affects two URL surfaces, only one of which is used.

---

### MODULE: Documents page (UI)
**INPUTS:** BAIS route `/dashboard/documents` and `/dashboard/documents/:caseId` (`BAIS/Frontend/src/App.jsx:87,92`); INSZoom route `/documents` and `/documents/:caseId` (`INSZoom/frontend/src/App.jsx:111-126`, guard module `documents`).
**WRITES (via API):** BAIS — `POST /documents/upload` or the 3-step chunked session (`services/api.js:253-310`), `DELETE /documents/:docId` (`:312`), `POST /questionnaires/:id/answers` and `/answers/files`, `POST /employment-workflow/:caseId/submit`, `POST /family-workflow/:caseId/submit`, `POST /client-intake/me/submit`. INSZoom — `POST /documents` (multipart, `pages/Documents.jsx:257`), `PUT /documents/:id/review` (`:504`).
**READS:** BAIS — `GET /cases/my`, `/employment-workflow/me`, `/questionnaires/case/:caseId?targetRole=` (up to 3 parallel roles, `Pages/Dashboard/Documents.jsx:220-222`), `/questionnaires/case/:caseId/checklists` (`:156`), `/documents/me`. INSZoom — `GET /cases`, `GET /documents?caseId=&limit=200` (`pages/Documents.jsx:419,428,460`).
**UPSTREAM:** questionnaire assignment + document checklist generation.
**DOWNSTREAM:** OCR queue; canonical rebuild; lifecycle recalculation.
**UI CONSUMERS:** itself. BAIS composes `components/checklist/*`, `components/questionnaire/{CaseRoleChecklist,PrincipalCaseWorkspace,EmployeeSelfServiceView,QuestionInput}.jsx`.
**API CONSUMERS:** n/a.
**DB COLLECTIONS:** (transitively) `documents`, `answers`, `cases`, `documentuploadsessions`.
**EVENTS:** upload progress via a dedicated `XMLHttpRequest` path (`BAIS/Frontend/src/services/api.js:531-569`).
**DEPENDENCIES:** `@tanstack/react-query` (BAIS), native file input.
**FAILURE IMPACT:** this is the client portal's primary work surface — it is where a client answers the questionnaire *and* uploads evidence.
**CHANGE IMPACT:** **HIGH** for BAIS. It is the only consumer of `useCaseQuestionnaire` / `useQuestionnaireAnswers` / `useDocumentChecklist` and of the three workflow submit endpoints. **Confirmed defect:** BAIS's XHR upload path (`services/api.js:531-569`) reads the access token once (`:536-537`) and **bypasses the 401→refresh→retry interceptor entirely**, so an upload started during a token rotation window fails outright.

---

### MODULE: Forms page (UI)
**INPUTS:** INSZoom `/uscis-forms` (`App.jsx:143-150`, guard module `cases`) and the `?tab=forms` tab of `/crm-cases/:id` (`pages/CRMCaseDetail.jsx:473-484,2272-2297`).
**WRITES (via API):** template admin — `POST/PUT/DELETE /uscis-forms`, `PUT /:id/approve`, `/:id/archive`, `POST /definitions/{validate,import}`, `POST /uscis/forms/{upload,import,scan}`, `POST /uscis/forms/:templateId/:action` (`pages/USCISForms.jsx:138-323`); case forms — the 20 workspace mutations from `USCISFormRenderer.jsx`; `POST /cases/:id/workflow/generate-forms` (`CRMCaseDetail.jsx:630`).
**READS:** `GET /uscis-forms`, `/uscis/forms`, `/uscis-forms/case[/:caseId]`, `/uscis-forms/:templateId/pdf`, `/uscis-forms/case/:caseId/:formId/workspace`.
**UPSTREAM:** template seeding/import; case-form provisioning; canonical build.
**DOWNSTREAM:** the generated PDF and the petition package.
**UI CONSUMERS:** itself; `FormRendererErrorBoundary` wraps the renderer (`CRMCaseDetail.jsx:50-82,2272`).
**API CONSUMERS:** n/a.
**DB COLLECTIONS:** (transitively) `uscisformtemplates`, `caseforms`, `documents`, `cases`.
**EVENTS:** none.
**DEPENDENCIES:** `react-pdf` 10 + `pdfjs-dist`; the worker must be pinned to react-pdf's nested pdfjs build because the project's top-level `pdfjs-dist` is a different major (`USCISFormRenderer.jsx:45-60`, `pages/petition/PdfDocumentPages.jsx:6-21`).
**FAILURE IMPACT:** staff cannot prepare a filing.
**CHANGE IMPACT:** **HIGH.** `USCISFormRenderer.jsx` is a single ~1,700-line component that owns the entire form-editing contract (workspace payload shape, field-name normalization in `utils/PDFFieldChangeAdapter.js`, conflict resolution, history rollback, all four download variants). **Confirmed dead UI:** `pages/USCISForms.jsx:1108-1150`'s "View Form" modal renders a raw JSON dump of `selectedCaseForm.filledData` — no PDF, no link into the real workspace.

---

### MODULE: Audit logs
**INPUTS:** `GET /api/audit/{,:id,summary,export,user/:userId,entity/:entityType/:entityId}` (`Backend/src/modules/audit/audit.routes.js:9-14`), mounted **twice** — at `/audit` and `/audit-logs` (`routes/index.js:16,18`). Write path: `auditService.recordAuditEvent(...)` and direct `AuditLog.create(...)` calls (48 files, per the prior audit; verified representative sites at `AutoFillService.js:31`, `quiz.service.js:227`, `middleware/auditAuth.js`).
**WRITES:** `auditlogs`.
**READS:** `auditlogs`, `users`.
**UPSTREAM:** every mutating operation in the app.
**DOWNSTREAM:** compliance reporting.
**UI CONSUMERS:** **NONE.** No component in either portal calls any `/audit` endpoint (verified by grep of both `services/api.js` files and both `src` trees). The nearest substitutes are `/cases/dashboard/recent-activity` (INSZoom `Dashboard.jsx:931`), `/case-managers/:id/activities` (`CaseManagerDetails.jsx:175`), the embedded `Case.internalNotes` (`CRMCaseDetail.jsx:2578`), and the embedded per-field `CaseForm.fieldHistory` (`USCISFormRenderer.jsx:1638`).
**API CONSUMERS:** ~48 backend modules write; nothing reads programmatically.
**DB COLLECTIONS:** `auditlogs`.
**EVENTS:** none.
**DEPENDENCIES:** none.
**FAILURE IMPACT:** compliance/forensic gap. Writes are almost universally `.catch(() => null)`'d (e.g. `AutoFillService.js:41`), so a failing audit sink is silent.
**CHANGE IMPACT:** **MODERATE.** Immutability is enforced two ways: a `pre("save")` hook rejecting any non-new save with 409 "Audit logs are immutable" (`Backend/src/models/AuditLog.js:36-43`), and the absence of any delete call site. **However** — `auditLogSchema.index({createdAt: 1}, {expireAfterSeconds: 60*60*24*365*2})` (`:32`) means **MongoDB itself deletes every audit row after 2 years**. `docs/audits/COMPREHENSIVE_AUDIT_V3_REPORT.md:66` states "the trail is append-only by construction" — true, but it is *not* permanent, and that TTL is a compliance-retention decision that the audit report does not mention.

---

### MODULE: Payments
**INPUTS:** 24 routes on `/api/payments` (`Backend/src/modules/payments/payment.routes.js:21-83`) plus `POST /api/payments/webhook/stripe` mounted **before** the JSON body parser with `express.raw` so the HMAC signature can be verified (`Backend/src/app.js:64`). Sibling read-only router `/api/billing` (6 routes, `modules/billing/billing.routes.js:10-15`).
**WRITES:** `payments`, `paymentledgerentries`, `paymentrequests`, `cases.plan.*`, `cases.addons[]`, `auditlogs`, `notifications`.
**READS:** `payments`, `paymentledgerentries`, `paymentrequests`, `cases`, `users`, `companies`.
**UPSTREAM:** Stripe (`modules/payments/payment.gateway.js:1-10`, `maxNetworkRetries` + 30 s timeout; `configurationStatus` at `:12-23`; `requireStripe` throws `503 STRIPE_NOT_CONFIGURED` at `:25-31`).
**DOWNSTREAM:** `Case.plan.paymentStatus`, `Case.addons[].status`, revenue analytics.
**UI CONSUMERS:** BAIS `Pages/Dashboard/Payments.jsx:80,95,96,163,362`, `PaymentSuccess.jsx:51,64,73`, `Dashboard.jsx:803,858`; INSZoom `pages/PaymentsOverview.jsx:67,79,88`, `pages/CRMCaseDetail.jsx:575,839`, `pages/CaseManagerDetails.jsx:190`.
**API CONSUMERS:** `case.controller.js` (addon purchase), `dashboard.service`, `report.service`.
**DB COLLECTIONS:** `payments`, `paymentledgerentries`, `paymentrequests`, `cases`, `auditlogs`, `notifications`.
**EVENTS:** Stripe webhooks; Socket.IO `payment:updated` (BAIS `Payments.jsx:123`, `PaymentSuccess.jsx:78`; INSZoom `CRMCaseDetail.jsx:591`, `PaymentsOverview.jsx:44`).
**DEPENDENCIES:** `stripe` (lazily required at `payment.gateway.js:3`).
**FAILURE IMPACT:** clients cannot pay; the plan/addon gate on premium services stalls.
**CHANGE IMPACT:** **HIGH.** The webhook is the only unauthenticated write path in the app and is signature-verified. **Note:** `billing.controller.getLedger` (`modules/billing/billing.controller.js:39-48`) and `getRequests` (`:50-60`) build their filter from query params **only** — unlike `payment.service.buildPaymentFilter`, they apply no user/case scoping, so any `financeRoles` holder reads the entire ledger. Also, INSZoom's `PaymentsOverview` period filter is inert: `period` is in the effect deps (`pages/PaymentsOverview.jsx:31,55`) but is never sent (`:64-67,79,88`).

---

### MODULE: Storage
**INPUTS:** `checksum`, `decrypt`, `deleteObject`, `encrypt`, `generateDocumentKey`, `readBuffer`, `storeBuffer`, `storeImmutableBuffer` (`Backend/src/modules/uploads/storage.service.js:336-345`).
**WRITES:** S3 (`@aws-sdk/client-s3`) or the local filesystem, selected by `env.storage.provider` (`:6`).
**READS:** the same.
**UPSTREAM:** `upload.middleware.js` (multer, size limits) and `file-security.service.js` (magic-byte type detection + malware scan) run before anything reaches storage.
**DOWNSTREAM:** `document.service`, `PDFRenderer.loadTemplateBuffer:20` and its normalized-bytes write-back (`:51`), `FilingPackageService.readItemBuffer`, `PDFGenerationService`, `PetitionWordPackageService`, `USCISFormImporterService`.
**UI CONSUMERS:** indirectly, through every download/preview endpoint.
**API CONSUMERS:** the services above.
**DB COLLECTIONS:** none (keys are stored on `documents.storageKey`, `uscisformtemplates.artifacts.form.storageKey`, `caseforms.filledPdfPath`).
**EVENTS:** none.
**DEPENDENCIES:** `@aws-sdk/client-s3`; optional AES-256-GCM envelope encryption keyed by `STORAGE_ENCRYPTION_KEY` (`:22-33`), detected on read by an 8-byte `ICRMENC1` header (`:9,36`).
**FAILURE IMPACT:** no document upload, no PDF render (templates live in storage), no filing package.
**CHANGE IMPACT:** **HIGH.** The encryption format is self-describing, so **enabling** `STORAGE_ENCRYPTION_KEY` is backward-compatible (unencrypted objects lack the header and pass through, `:36`), but **rotating or losing** the key makes every previously-encrypted object permanently unreadable — `decrypt` throws `STORAGE_ENCRYPTION_KEY_MISSING` (`:38-42`) with no key-id/versioning scheme in the header to support rotation.

---

### MODULE: API routes (composition root)
**INPUTS:** `Backend/src/app.js` builds the stack: `helmet` → `compression` → `requestContext` → `perfMiddleware` → `cors` (`:39-45`, explicit origins + credentials + a 7-header allowlist) → global `rateLimit` 300/15 min (`:47-52`) → `morgan` (`:60-63`, with a `:safe-url` token that strips query strings) → the raw-body Stripe webhook (`:64`) → `express.json({limit:"10mb"})` (`:65`) → `cookieParser` → `sanitizeRequest` → `/api/health` (`:70`) → `app.use("/api", routes)` (`:74`) → 404 → `errorHandler`.
**WRITES:** none.
**READS:** none.
**UPSTREAM:** `server.js`.
**DOWNSTREAM:** 64 router mounts (`Backend/src/routes/index.js:3-66`).
**UI CONSUMERS:** both portals' single axios/fetch client.
**API CONSUMERS:** n/a.
**DB COLLECTIONS:** none.
**EVENTS:** none.
**DEPENDENCIES:** express 4, helmet, cors, morgan, compression, express-rate-limit, cookie-parser.
**FAILURE IMPACT:** total outage.
**CHANGE IMPACT:** **CRITICAL — mount order is semantically load-bearing.** Three ordering facts confirmed in this branch:
1. `routes/index.js:29` mounts `collaborationRoutes` at `/` **before** `case.routes` at `:30`. `GET /api/cases/:caseId/timeline` therefore resolves to `CollaborationController.timeline`, and `case.controller.getTimeline` (wired at `case.routes.js:118`) is unreachable dead code.
2. `routes/index.js:26-27` mounts `formGenerationRoutes` then `uscis-form.routes`, both at `/forms`. This is the ISSUE-001 fix and it is correctly in place. It has one inverse casualty: `POST /api/forms/definitions/validate` (`uscis-form.routes.js:15`) is shadowed by `POST /:caseFormId/validate` (`formGenerationRoutes.js:12`), which will try to cast `"definitions"` to a `CaseForm` ObjectId. INSZoom calls the un-shadowed `/uscis-forms/definitions/validate` (`pages/USCISForms.jsx:199`), so this is latent, not live.
3. `routes/index.js:16,18` mounts the same audit router at both `/audit` and `/audit-logs`.
The mounted set also includes **13 routers with zero UI consumers in either portal**: `/audit`, `/audit-logs`, `/beneficiaries`, `/canonical`, `/dashboard`, `/search`, `/calendar`, `/workflows`, `/billing`, `/consultation-routing` (staff half), `/data-rights`, `/form-mappings`, `/petition-intelligence`.

---

# §16 — Change impact matrix

Each entry traces the concrete files, routes, and tests that a change would touch, then assigns a blast radius.

---

## 16.1 — `Case.caseRole` changes

**What `caseRole` is:** `enum ["single","principal","employee","beneficiary"], default: null` (`Backend/src/models/Case.js:823-828`), indexed at `:1058`.

**Backend files that branch on it (9, non-test):**

| File:line | Behavior gated |
|---|---|
| `Backend/src/models/Case.js:823-828,1058` | schema enum + index |
| `Backend/src/modules/canonical/services/CanonicalBuilderService.js:201-203` | picks `principalCaseId` — `parentCase` for `employee`/`beneficiary`, else self |
| `…/CanonicalBuilderService.js:215-217` | picks `familyCaseIds` — the whole family for a `principal`, else `[parent, self]`. **Determines which `Answer` rows exist at all** for the canonical build |
| `…/CanonicalBuilderService.js:226` | `EmployeeProfile.findOne({caseId})` **only** when `caseRole ∈ {employee, beneficiary}` |
| `…/CanonicalBuilderService.js:400-408` | which profile map (`EMPLOYER_*` vs `EMPLOYEE_*`) is applied, and the `caseScope` stamped on every candidate |
| `…/CanonicalBuilderService.js:476` | `merged.profile.case.caseRole` — read by `CanonicalSectionValidators`' DocumentsValidator to decide which role's documents are required |
| `Backend/src/modules/form-mapping/services/AutoFillService.js:342-343` | `applyFormEditToProfile` returns `false` for `!caseRole` or `"single"` — no write-back to any profile |
| `…/AutoFillService.js:351` | `principalCaseId` resolution for the employer write-back |
| `…/AutoFillService.js:368` | employee write-back requires `caseRole ∈ {employee, beneficiary}` |
| `Backend/src/modules/employer-profile/employer-profile.service.js`, `employee-profile.service.js` | authorization + principal resolution |
| `Backend/src/modules/cases/case.service.js:596` | child-case list projection; `case.service.js:160-162` filters queues by `caseRole` |
| `Backend/src/modules/cases/case.controller.js:135,971,1105-1146` | sets it at creation |
| `Backend/src/modules/cases/immigration-knowledge-engine.service.js` | plan generation |
| `Backend/src/modules/document-requirements/document-requirement.resolver.js` | per-role requirement resolution |
| `Backend/src/modules/auth/auth.controller.js` (`/session-context`) | echoes `User.caseRole` to the client |

**Frontend files:** BAIS `src/services/api.js`, `Pages/Dashboard/Documents.jsx`, `components/questionnaire/EmployeeSelfServiceView.jsx`, `components/questionnaire/PrincipalCaseWorkspace.jsx`; INSZoom `pages/CRMCases.jsx`, `pages/CRMCaseDetail.jsx`.

**Routes affected:** all of `/api/cases/*`, `/api/employer-profile/*`, `/api/employee-profile/*`, `/api/canonical/cases/:caseId/*`, `/api/cases/:caseId/forms/:formType/*`, `/api/uscis-forms/case/*`.

**Tests that would need updating:** `Backend/src/modules/authorization/tests/phase10-restricted-portal-rbac.test.js`, `modules/cases/tests/case-participant.service.test.js`, `case-reassignment.test.js`, `case-lifecycle-form-provisioning.test.js`, `modules/canonical/tests/phase11.profileCanonicalMap.test.js`, `modules/form-mapping/tests/AutoFillService.overrideField.reverseSync.test.js`, `modules/h1b-e2e/tests/{h1b,k1,k3,l1a}-golden-path.test.js`.

**BLAST RADIUS: CRITICAL.**
Justification: `caseRole` is not a label — it is the **partition key for the canonical data pipeline**. It decides (a) which `Answer` documents are visible to `CanonicalBuilderService` (`:215-217`), (b) whether an `EmployeeProfile` is loaded at all (`:226`), (c) which profile→canonical map is applied (`:403-408`), and (d) whether a staff form edit propagates back to a profile (`AutoFillService.js:342`). A wrong or absent value does not raise an error anywhere — it silently produces a canonical profile missing half its sources, which then silently produces a blank USCIS form. **This failure mode is already live in production data**: every case created through `POST /api/cases/create-with-client` has `caseRole: null` (`case.controller.js:2525-2577` sets none of the Phase-2 fields), so those cases can never load an `EmployeeProfile` and never write a form edit back to a profile. Narrowing the enum would also strand those documents on their next `.save()`.

---

## 16.2 — `Case.parentCase` changes

**What it is:** `{type: ObjectId, ref: "Case", index: true}` (`Backend/src/models/Case.js:425`), with the inverse `childCases: [ObjectId]` at `:426` and a compound index at `:1029`. Distinct from `linkedCases[]` (`:427`, typed relationships) and `principalCaseRef` (`:436`, an optional informational pointer for single-party filings).

**Backend consumers (non-test):** `models/Case.js:425-426,1029`; `CanonicalBuilderService.js:202,217,401,407`; `AutoFillService.js:342,351`; `case.controller.js:298` (assignment cascade filter `{parentCase, assignmentOverridden: {$ne:true}}`), `:1105-1150` (child creation), `:1443,:1497` (override flag); `case.service.js:158-159` (`parentCase`/`parentCaseId` query filters), `:596-598` (child listing, sorted by `childIndex`); `employer-profile.service.js` and `employee-profile.service.js` (principal resolution); `services/CaseNumberService.js` (child suffix).

**Frontend:** INSZoom `pages/CRMCaseDetail.jsx` (child-cases table, driven by `GET /cases/:id/related`); BAIS `components/questionnaire/PrincipalCaseWorkspace.jsx:36,67`.

**Routes affected:** `GET /api/cases/:id/related`, `PATCH /api/cases/:principalId/data-entry-mode`, `POST /api/cases/:principalId/invite-employee`, `PATCH /api/cases/:caseId/remove-employee`, `GET /api/employer-profile/:principalCaseId`, all canonical + autofill routes for child cases.

**Tests:** `case-reassignment.test.js`, `case-participant.service.test.js`, `phase10-restricted-portal-rbac.test.js`, the four golden-path e2e tests, `scripts/e2eFixtures.js`.

**BLAST RADIUS: HIGH.**
Justification: `parentCase` is how a child case reaches its employer's data. Break it and `CanonicalBuilderService.js:202` resolves `principalCaseId` to `undefined`, so `EmployerProfile.findOne({principalCaseId: undefined})` (`:225`) returns null and **every I-129 petitioner field on every child case goes blank** — with no error. It is also the assignment-cascade key (`case.controller.js:298`): a broken link means child cases silently stop inheriting the principal's case manager, which in turn blocks `generateForms` (`case-lifecycle-orchestrator.service.js:438` requires `assignedCaseManager`). It is **HIGH not CRITICAL** only because `parentCase` and `childCases` are maintained as a redundant pair, so one-directional corruption is partially recoverable. Note there is **no referential-integrity enforcement**: nothing validates that `parentCase` points at an existing case, that the parent's `childCases` contains this case, or that `childCaseCount` matches `childCases.length`.

---

## 16.3 — `Question.canonicalPath` changes

**What it is:** `mapping.canonicalPath` (`Backend/src/models/Question.js:170`), alongside `mapping.masterDataPath` (`:169`) and `mapping.uscis*` (`:171-174`). Mirrored on `QuestionLibraryItem.canonicalPath`.

**Every consumer (5 read sites, non-test):**

| File:line | Use |
|---|---|
| `Backend/src/modules/canonical/services/CanonicalBuilderService.js:262` | `answer.question?.mapping?.canonicalPath \|\| QUESTION_KEY_MAP[answer.questionKey]` — **if both are absent the answer is silently dropped from the canonical profile** (`:263` `if (!targetPath) return;`) |
| `Backend/src/modules/cases/immigration-knowledge-engine.service.js:242-243` | required questions' canonical paths become `Case.knowledgePlan.requiredCanonicalFields` |
| `Backend/src/modules/questionnaires/question-library.service.js:151-152,198-207,410-413` | library **key identity** is derived from `canonicalPath`; a missing one adds `canonical_path_requires_review` |
| `Backend/src/modules/questionnaires/questionnaire.service.js:273` | `inferMasterDataPath` prefers it |
| `Backend/src/modules/questionnaires/questionnaire.service.js:655-656` | library import populates both `masterDataPath` and `canonicalPath` |

**Producers:** `modules/questionnaires/employmentChecklists.js:190-193,237` (`canonicalPathForEntry` → `EMPLOYEE_CANONICAL_PATHS`), `modules/employment-workflow/questionnaires/h1b.js`, the crosswalk configs `modules/form-mapping/config/{i129-h1b,i129f-k1}-crosswalk.js`, and the admin questionnaire builder (INSZoom `pages/QuestionnaireTemplates.jsx:206,209`).

**Downstream chain:** `Answer` → `CanonicalBuilderService.addQuestionnaireCandidates` → `CanonicalMergeService` → `Case.canonicalProfile.profile` → `CanonicalDataService` → `FormMappingService.mapTemplate` (`FormMappingService.js:77` also reads `field.mapping.canonicalPath` on the *template* side) → `AutoFillService` → `CaseForm.fieldValues` → `PDFFieldMapper` → the PDF.

**Tests:** `modules/canonical/tests/CanonicalBuilderService.test.js`, `modules/questionnaires/tests/{employmentChecklists,question-library,questionnaire-engine,questionnaire-concurrency}.test.js`, `modules/form-mapping/tests/*`, `modules/h1b-e2e/tests/l1a-golden-path.test.js`.

**BLAST RADIUS: HIGH.**
Justification: this is a **silent-failure string contract**. There is no validation that a `canonicalPath` corresponds to a real path in the canonical schema, and no validation that a canonical path a form mapping expects is produced by some question. Change one string and the only observable effect is that a PDF field stops being filled — no exception, no log, and `AutoFillService.mergeMappedFields` records it merely as `missingFields` (`AutoFillService.js:143`). Additionally, `question-library.service.js:151-152` derives the **library item key** from `canonicalPath`, so changing it on a library-backed question re-identifies the item and can orphan every questionnaire that imported it. It is HIGH rather than CRITICAL because the impact is per-field, not system-wide, and because `QUESTION_KEY_MAP` (`CanonicalBuilderService.js:79-109`) provides a fallback for 29 well-known question keys.

---

## 16.4 — `CaseForm.fieldValues` shape changes

**What it is:** `{type: Mixed, default: {}}` (`Backend/src/models/CaseForm.js:35`) — a **flat map keyed by the raw AcroForm field id**, documented (but not enforced) by the static `FIELD_VALUES_SCHEMA_REFERENCE` at `:235-238,263`. The keys are literally strings like `form1[0].#subform[2].Line8a_StreetNumberName[0]`, containing dots, brackets and `#` — a fact that is load-bearing.

**Backend consumers (non-test):**

| File:line | Use |
|---|---|
| `Backend/src/modules/form-mapping/services/AutoFillService.js:134,154,248,262,435-437,549,558,565,628` | writes it on generate/override/reset/rollback |
| `…/AutoFillService.js:424-434` | **explicit comment**: `.set("prefix.<fieldId>")` cannot be used because Mongoose splits on `.`; a whole-object bracket-assign + `set("fieldValues", obj)` is the only safe write |
| `Backend/src/modules/form-mapping/services/FormMappingService.js` | produces `mapped.fieldValues` |
| `Backend/src/modules/form-mapping/services/SyncStateService.js` | per-field sync/conflict state keyed by the same ids |
| `Backend/src/modules/uscis-forms/interactive-form-review.service.js:409` | reads `caseForm.fieldValues \|\| caseForm.filledData` for the previous value |
| `Backend/src/modules/uscis-forms/uscis-form.service.js:962,972` | comparison baseline |
| `Backend/src/modules/form-generation/services/PDFFieldMapper.js` | maps it onto AcroForm fields |
| `…/PDFGenerationService.js:213` | snapshots it into `comparisonBaseline` |
| `…/PDFValidationService.js`, `…/PDFFidelityService.js` | validate the rendered PDF against it |
| `Backend/src/models/CaseForm.js:54` | a **full copy per entry** in `versions[]` |

**Frontend consumers:** INSZoom `components/uscis/USCISFormRenderer.jsx` (injects values into pdfjs `annotationStorage`) and `utils/PDFFieldChangeAdapter.js:120-131` (`prePopulateFields`, `convert`, `extractFieldName`) — the field-id string format is a **wire contract between the backend and pdfjs's annotation storage**. Also `pages/USCISForms.jsx:1108-1150` dumps `filledData` as raw JSON.

**Routes affected:** every route in `autoFillRoutes.js`, the 20 workspace mutation routes, and all four PDF download routes.

**Tests:** `AutoFillService.test.js`, `AutoFillService.overrideField.{reverseSync,k1k3-fanout}.test.js`, `phase3.fanout-invariant.test.js`, `phase4.semantic-transforms.integration.test.js`, `PDFFidelityService.test.js`, `PDFFieldMapper.test.js`, `interactive-form-review.*.test.js`, `dynamic-form-engine.schema.test.js`, `phase0.invariants.test.js`, `case-lifecycle-form-provisioning.test.js`, `phase0/goldenHarness.js`, plus `INSZoom/frontend/src/components/uscis/USCISFormRenderer.test.jsx`.

**BLAST RADIUS: CRITICAL.**
Justification: this is the persisted representation of a legal filing, it is `Mixed` (so Mongoose enforces nothing), and it is simultaneously (a) a Mongo document key set containing dots and brackets, (b) a pdfjs annotation-storage key set in the browser, and (c) the join key for four *parallel* per-field maps that must stay aligned — `sourceAttribution`, `manualOverrides`, `fieldReviews`, and `fieldValueProvenance`. Any nesting/normalization of the keys breaks all of them at once and would require a data migration of every existing `CaseForm` **and** every `versions[]` snapshot inside it. `Backend/src/models/CaseForm.js:196-204` explicitly records that the Phase-2 authors declined to type this field for exactly that reason.

---

## 16.5 — USCIS template / edition changes

**What changes:** a new `USCISFormTemplate` document (new `editionDate`/`version`), or a mapping-graph revision (`USCISMappingVersion`).

**Version-pinning machinery:** `CaseForm.formVersionLock` (`Backend/src/models/CaseForm.js:12-27`) captures `{formType, editionDate, version, mappingVersion, mappingVersionId, validationVersion, renderingVersion, formTemplateId, lockedAt, lockedBy, overrideReason, migratedFrom/At/By}` at provisioning time (`uscis-form.service.js:527-539`), and `AutoFillService.generate:206-212` **re-loads the locked mapping version** for an existing CaseForm rather than the template's current one. `Case.uscisFormReferences[]` (`models/Case.js:604`, shape at `:149-164`) carries a parallel copy of version/editionDate/mappingVersion.

**Files touched by an edition change:** `models/USCISFormTemplate.js`, `models/USCISMappingVersion.js`, `models/CaseForm.js`; `modules/uscis-form-import/{services/*,seeds/*,controllers,routes}`; `modules/uscis-lifecycle/services/{USCISScannerService,FormComparisonService,FieldDiffService,MigrationSuggestionService,VersionManagementService,FormImportService}.js`; `modules/uscis-forms/uscis-form.service.js` (`latestTemplatesByAssignmentRules:468-486`, `ensureAssignedForms:488`, `latestTemplateSort`); `modules/form-mapping/services/{FormMappingService,MappingGraphService,MappingResolver,ReverseIndexService}.js`; `modules/form-mapping/config/i129-h1b-crosswalk.js` + the two sibling crosswalks; `modules/form-mapping/seeds/*.seed.js`; `modules/form-generation/services/{PDFRenderer,PDFFieldMapper,PDFFidelityService,PDFValidationService}.js`; `modules/cases/immigration-knowledge-engine.service.js`; `modules/questionnaires/question-library.service.js` (edition-aware library sync).

**Frontend:** INSZoom `pages/USCISForms.jsx` (registry, compare, activate/retire, import/upload), `components/uscis/USCISFormRenderer.jsx` (loads the template PDF by `templateId`), `components/uscis/USCISNativeFormPOC.jsx`.

**Tests:** `uscis-form-import/tests/{h0-i129-seed,phase1.scan-lockin,PDFFieldScannerService,FieldLabelEnrichmentService,normalizePdfIntegration}.test.js`; `uscis-lifecycle/tests/{FormComparisonService,FieldDiffService,MigrationSuggestionService,USCISScannerService}.test.js`; `form-mapping/tests/{h1-i129-mapping,i129-l1a-crosswalk-coverage,i129f-k1-crosswalk-coverage,i130-k3-crosswalk-coverage,i130-k3-golden-case}.test.js`; `uscis-forms/tests/{dangling-template-guard,uscis-form-rendering-pipeline.integration,h6-conditional-forms}.test.js`; `form-generation/tests/*`; all four `h1b-e2e` golden paths.

**BLAST RADIUS: HIGH (contained by design), CRITICAL if the lock is bypassed.**
Justification: the architecture is genuinely built for this — `formVersionLock` plus `AutoFillService.generate:206-212`'s locked-mapping reload means an in-flight case keeps filling against the edition it was provisioned with, and `latestTemplatesByAssignmentRules` (`uscis-form.service.js:468-486`) only selects the newest template for *newly* provisioned forms. The residual risk is concentrated in three places: (1) `PDFRenderer.loadTemplatePdf` (`:43-56`) fetches the PDF asset by `template.pdfStorageKey` **at render time**, so replacing the bytes behind an existing key retro-actively changes what an already-locked CaseForm renders — and if the new asset is hybrid XFA, the render either self-normalizes (writing back to the same key, `:51`) or throws `TEMPLATE_PDF_NO_FIELDS` (`:106-114`); (2) the three crosswalk configs are hand-maintained edition-specific field-name tables with no automated drift check against the live template; (3) a `USCISFormTemplate` document is already near MongoDB's 16 MB ceiling, so a field-count increase in a new edition is a capacity event.

---

## 16.6 — Authentication / session changes

**Files in the blast path:** `Backend/src/middleware/authenticate.js` (all 40 lines), `optionalAuthenticate.js`, `middleware/auditAuth.js`; `modules/auth/{auth.controller,auth.service,token.service,session.service,password.service,passwordReset.service,emailVerification.service,clientInvite.service,employeeInvite.service,google-oauth.service}.js`; `models/{User,AuthSession}.js`; `config/{env,redis}.js` (the user cache at `authenticate.js:20-26`, invalidated on `isActive`/`tokenVersion`/profile change); `app.js:39-45,67` (CORS credentials + cookie-parser).

**Every guarded route** — `authenticate` is applied to roughly 337 of ~350 routes; the deliberate exceptions are `POST /auth/{login,register,refresh,forgot-password,reset-password,verify-email}`, `GET /auth/invite/:token`, `POST /auth/invite/:token/accept`, `GET /auth/google[/callback]`, `POST /api/payments/webhook/stripe` (`app.js:64`), `GET /api/health` (`app.js:70`), and the six public funnel endpoints (`leads/lead.routes.js:19,36`, `quiz.routes.js:32-35`, `consultation.routes.js:15-20`, `consultation-routing/routing.routes.js:16-17`, `telemetry.routes.js`, `entityConfig.routes.js` `/public`, `compliance.routes.js` `/disclaimer*`).

**Frontend:** BAIS `services/api.js:1-172` (token store, pre-flight refresh, 401 replay), `context/AuthContext.jsx`, `components/AuthGate.jsx`, `context/SocketContext.jsx:36`, `Pages/Auth/*`, `Pages/Admin/AdminLogin.jsx`; INSZoom `services/api.js:13-145`, `contexts/AuthContext.jsx`, `contexts/SocketContext.jsx:37-52`, `components/ProtectedRoute.jsx`, `pages/Login.jsx`, `layouts/Layout.jsx`.

**Tests:** `modules/auth/auth.security.test.js`, `modules/auth/tests/employeeInvite.test.js`, `utils/logger.security.test.js`, `modules/authorization/tests/phase10-restricted-portal-rbac.test.js`, `routes/tests/{phase0,phase1}-regression.test.js`, `modules/tasks/task.authorization.test.js`, `modules/dashboard/payment-analytics-access.test.js`.

**BLAST RADIUS: CRITICAL.**
Justification: three separate hard contracts change together. (1) The **token payload** — `authenticate.js:28` compares `decoded.tokenVersion` to `user.tokenVersion`, and both frontends decode `exp` client-side (BAIS `services/api.js:13-28`) to decide whether to pre-refresh. (2) The **refresh cookie** — httpOnly, requires `credentials:"include"` on the client and `cors({credentials:true})` + `cookie-parser` on the server; a `SameSite`/domain change silently logs out every cross-origin user (the two portals are served from different origins). (3) The **error contract** — both portals auto-retry *only* on `401` with `code:"TOKEN_EXPIRED"` (BAIS `services/api.js:118-132`, INSZoom `services/api.js:122-135`); any change that turns an expired-token response into a different status or code converts a transparent refresh into a hard logout. And the existing `rotateSession` race (`session.service.js:30-43` + `errorHandler.js:27-30`, §15 "Session/refresh") means the *current* implementation already produces an unclassified 500 under concurrency, so any change here must fix or preserve that path deliberately.

---

## 16.7 — Questionnaire seed changes

**What the seeds are:** `Backend/src/modules/questionnaires/employmentChecklists.js` (739 lines), `familyChecklists.js` (160), `singlePartyChecklists.js` (87); plus the workflow questionnaire definitions `modules/employment-workflow/questionnaires/{h1b.js (602), l1a.js (695), o1.js (464), p.js (283), shared.js, registry.js}` and `modules/family-workflow/questionnaires/{k1.js (314), k3.js (60), registry.js}`.

**Consumers:** `questionnaire.service.ensureDefaultVisaTemplates` (invoked by `GET /api/questionnaires/defaults`, `questionnaire.routes.js:19`, and `POST /defaults/seed`, `:20`), `intelligent-questionnaire.service.js`, `checklist-rule-engine.service.js`, `employment-workflow.controller.js`, `family-workflow.controller.js`, `single-party-filing.controller.js`, `config/filingTypes.js`, `question-library.service.js`.

**Downstream chain:** seed → `Questionnaire` + `Question` documents (unique on `{questionnaire, key}`, `models/Question.js:251`) → `Case.questionnaireReferences[]` assignment → client answers (`Answer`, unique on `{responseId, questionKey}`) → `CanonicalBuilderService.addQuestionnaireCandidates` via `question.mapping.canonicalPath` → canonical profile → autofill → PDF. Also: `Case.documentChecklist[]` is derived from the checklists (`documentRequirements` + conditional file questions, `models/Case.js:140-144`), and `CaseLifecycleOrchestrator.metrics:122-137` computes questionnaire completeness from `Case.questionnaireReferences[].status` across **every active reference**.

**Tests:** `modules/questionnaires/tests/{employmentChecklists,questionnaire-engine,questionnaire-concurrency,question-library,document-progress-split}.test.js`; `modules/family-workflow/tests/family-workflow.test.js`; `modules/single-party-filings/tests/single-party-filing.test.js`; `modules/cases/tests/checklist-dedup.test.js`; the four `h1b-e2e` golden paths; `scripts/dedupeGeneratedQuestionnaires.js` and `scripts/backfillFamilyChecklistReferences.js` exist precisely because prior seed changes produced duplicates and missing references.

**BLAST RADIUS: HIGH.**
Justification: seeds are not idempotent in the naive sense — they create `Question` documents keyed by `{questionnaire, key}`, so **renaming a question `key` orphans every existing `Answer`** (which is keyed by `{responseId, questionKey}` and stores no reference back to the renamed question beyond `question` ObjectId). Removing or renaming a *required* question changes `CaseLifecycleOrchestrator`'s completeness rollup (`:130-137`), which changes `Case.status`/`stage` on the next `recalculate` for **every in-flight case of that visa type**. Adding a question with a `canonicalPath` that no form mapping consumes is inert; adding one *without* a `canonicalPath` means the answer never reaches canonical (`CanonicalBuilderService.js:262-263`). Two mitigations exist: `Case.questionnaireReferences[].active` is a soft-remove flag (`models/Case.js:191`) rather than a delete, and versioned questionnaires (`POST /questionnaires/:id/version`) let a new seed coexist with in-flight responses — but neither is automatic, and the two backfill scripts in `src/scripts/` are the historical evidence that seed changes have gone wrong before.

---

## 16.8 — Summary matrix

| # | Change | Backend files | Frontend files | Routes | Test files | Blast radius |
|---|---|---|---|---|---|---|
| 1 | `Case.caseRole` | 14 | 6 | ~60 | 8 | **CRITICAL** |
| 2 | `Case.parentCase` | 9 | 3 | ~15 | 6 | **HIGH** |
| 3 | `Question.canonicalPath` | 10 | 2 | ~10 | 9 | **HIGH** |
| 4 | `CaseForm.fieldValues` shape | 11 | 3 | ~35 | 13 | **CRITICAL** |
| 5 | USCIS template / edition | ~28 | 3 | ~45 | 20+ | **HIGH** (CRITICAL if `formVersionLock` bypassed) |
| 6 | Authentication / session | ~15 | 12 | ~350 | 7 | **CRITICAL** |
| 7 | Questionnaire seeds | ~14 | 8 | ~50 | 9 | **HIGH** |

---

# §0.8 — Stale / phantom implementation register

Method for this section: a full `require()`-graph reachability pass from `Backend/src/server.js` (445 of 628 backend files reachable), a runtime mount of the entire router tree (752 routes mounted with zero missing-handler throws), a write-site census across all 67 model files, and an exhaustive API-prefix extraction across both frontend `src` trees.

## 0.8-A — Routes that exist but are unreachable (shadowed or unmounted)

| # | Route | Shadowed/blocked by | Evidence | Effect |
|---|---|---|---|---|
| A1 | `GET /api/cases/:id/timeline` → `case.controller.getTimeline` | `collaborationRoutes` mounted at `/` on `routes/index.js:29`, **before** `/cases` at `:30` | `case.routes.js:118` vs `case-collaboration/routes/collaborationRoutes.js:7` | `case.controller.getTimeline` is dead code; requests reach `CollaborationController.timeline` |
| A2 | `GET /api/uscis/forms` → `USCISLifecycleController.listForms` | `/uscis/forms` mounted at `routes/index.js:24` **before** `/uscis` at `:25` | `uscis-lifecycle/routes/uscisLifecycleRoutes.js:9` vs `uscis-form-import/routes/uscisFormImportRoutes.js:23` | dead handler |
| A3 | `POST /api/uscis/forms/import` → `USCISLifecycleController.importForm` | same | `uscisLifecycleRoutes.js:12` vs `uscisFormImportRoutes.js:34` | dead handler |
| A4 | `POST /api/uscis/forms/:version/activate` | same | `uscisLifecycleRoutes.js:15` vs `uscisFormImportRoutes.js:36` | dead handler |
| A5 | `POST /api/uscis/forms/:version/retire` | same | `uscisLifecycleRoutes.js:16` vs `uscisFormImportRoutes.js:37` | dead handler |
| A6 | `POST /api/forms/definitions/validate` → `uscis-form.controller.validateDefinition` | `formGenerationRoutes` mounted first on `/forms` (`routes/index.js:26-27`); `POST /:caseFormId/validate` matches with `caseFormId="definitions"` | `formGenerationRoutes.js:12` vs `uscis-form.routes.js:15` | `requireCaseFormAccess` CastError instead of the intended handler. **Latent, not live** — INSZoom calls `/uscis-forms/definitions/validate` (`pages/USCISForms.jsx:199`), the un-shadowed prefix |
| A7 | The **entire** `modules/sync/sync.routes.js` — 11 implemented endpoints | never mounted; it is the only route file in the backend absent from `routes/index.js` | `Backend/src/modules/sync/sync.routes.js` (82 lines) | dead. Note this is fortunate: `GET /clients`, `GET /cases`, `GET /cases/:caseId/full` (`sync.routes.js:9,18,27`) do unbounded `.find({})` with `authenticate` only and **no ownership check whatsoever**. Mounting it as-is would be a full-database IDOR |

**No route in the backend is wired to a missing handler** — all 638 `controller.handler` references across the 57 route files resolve to real exports, confirmed both statically and by a live router mount.

## 0.8-B — Controllers that are stubs, or never reached

| # | Item | Evidence | Note |
|---|---|---|---|
| B1 | `POST /api/auth/google-token` always fails | `Backend/src/modules/auth/auth.controller.js:112-121` — validates `idToken`, then unconditionally throws `503 GOOGLE_AUTH_NOT_CONFIGURED`. Touches no model, no service | Deliberate (documented at `:102-110` — Firebase Auth removed). BAIS declares `authApi.googleToken` (`services/api.js:184`) and **never calls it**; the live Google path is the OAuth redirect at `AuthContext.jsx:160`. So the endpoint is a phantom on both sides |
| B2 | `client.controller.saveProfile` | defined `modules/clients/client.controller.js:78`, exported `:145`, **no route file references it** | fully implemented, unreachable |
| B3 | `user.controller.getAttorneys` | defined `modules/users/user.controller.js:59`, exported `:144`, never routed | unreachable — and `attorney` is not a valid `User.role` (see D3) |
| B4 | `family-workflow.controller` exports `isFamilyCapable`, `canAccessFamilyCase`, `ensureFamilyChecklistReferences` (`:284-286`); `task.controller` exports `taskScope`, `canAccessTask` (`:191-192`) | exported for external use, referenced by nothing outside their own file | dead exports |
| B5 | `sync.routes.js:69-72` — four handlers returning canned `{success:true, message:"…accepted by shared backend"}` with no model/service touch | `Backend/src/modules/sync/sync.routes.js:69` | moot (router unmounted) |

**Cleared as false positives:** `quiz.controller.getVisas`, `entityConfig.controller.getStatusVocabulary`, `telemetry.controller.trackEvent`, `uscis-form.controller.validateDefinition`, `document-intelligence.controller.evidenceCategories` — each delegates to a real synchronous service/config call. No controller in the backend returns a hardcoded `[]`/`{}`/`null`.

## 0.8-C — Live APIs returning placeholder data

| # | Item | Evidence |
|---|---|---|
| C1 | **Message translation is fake.** `translateMessage` returns `` `[${targetLanguage}] ${message.messageBody}` `` — the untranslated body with a language-code prefix — tagged `provider: "placeholder"` | `Backend/src/modules/messages/message.service.js:736-744`, `:741`; served live via `message.routes.js:39` → `message.controller.js:231` |
| C2 | **Reply suggestions are three hardcoded English strings** with two regex reorderings, tagged `provider: "internal-rule-based"` | `message.service.js:719-734`, `:721`; served via `message.controller.js:280` |
| C3 | **Single-party filing checklists are scaffolds.** The file's own header: *"SCAFFOLD NOTICE: every checklist below is a temporary placeholder (a handful of fields), not real content"*; content is e.g. `"Placeholder: Copy of Passport (scaffold)"` | `Backend/src/modules/questionnaires/singlePartyChecklists.js:9-16`, `:65`. Feeds `SINGLE_PARTY_FILING_DEFINITIONS` into live `questionnaire.service.js:20` |
| C4 | **Four production email templates ship placeholder bodies.** e.g. `case-created-client` sends exactly two lines and carries the comment *"Body content is a placeholder — actual copy will be supplied later"* | `modules/email/templates/case-created-client.js:2-3,8-13`; same at `case-created-team-lead.js:2`, `case-assigned-case-manager.js:2`, `family-beneficiary-invitation.js:5` |
| C5 | `ensureCaseForCompletedClient` is an intentional no-op that `console.warn`s and returns `null`, still called from the live intake path | `modules/clients/client.service.js:179-189`, called at `:297` |
| C6 | `applyExtractionMappings` is a no-op for every caller that does not pass `options.matches` — which, per its own comment, is every pre-existing call site | `modules/document-intelligence/services/extraction-mapping.service.js:8,18-20` |
| C7 | Push notifications degrade silently to `"Push notifications are temporarily unavailable"` whenever `firebase-admin` is unconfigured | `modules/notifications/push.service.js:10` |
| C8 | `documentRequirements.js` L-1B keys use non-canonical `documentType` slugs that "will never match uploaded docs", left as placeholders | `modules/canonical/config/documentRequirements.js:13-15` |
| C9 | **INSZoom's Expert Letters tab is entirely inert.** `fetchLetters` unconditionally `setLetters([])`; `handleCreateLetter` only closes the modal | `INSZoom/frontend/src/pages/CRMCaseDetail.jsx:662-665`, `:860-863`; tab at `:1566-1576`, body `:2490-2541`, modal `:2838-2862` |
| C10 | **BAIS Dashboard fabricates a case when the user has none** — renders `caseId:"Pending"`, `visaCategory:"Not Selected"`, `assignedAgent:"BAIS Team"`, `agentEmail:"info@…"`, `uscisNumber:"Pending Assignment"` as if real case data | `BAIS/Frontend/src/Pages/Dashboard/Dashboard.jsx:894-904`, rendered at `:502` |
| C11 | **INSZoom's "View Form" modal renders a raw JSON dump** of `selectedCaseForm.filledData` — no PDF, no link to the real workspace | `INSZoom/frontend/src/pages/USCISForms.jsx:1108-1150` |
| C12 | **INSZoom's Payments period filter is inert** — `period` is in the effect deps but is never sent in any request | `INSZoom/frontend/src/pages/PaymentsOverview.jsx:20,31,55` vs `:64-67,79,88` |
| C13 | **INSZoom's "Calculate Performance" button** fires `api.post('/leaderboard/calculate')` un-awaited, with no error handling and no refetch — the table never reflects the result | `INSZoom/frontend/src/pages/Leaderboard.jsx:116` |

## 0.8-D — Model fields declared but never written or read

Verified by grepping the entire `Backend/src` tree excluding `*/tests/*` and `*.test.js`.

| # | Field | Declared | Non-test usage |
|---|---|---|---|
| D1 | `CaseForm.participantId`, `CaseForm.participantRole` | `models/CaseForm.js:6-7` (both indexed; `participantId` is part of the unique index at `:241`) | **ZERO.** Neither of the two `CaseForm` construction sites (`uscis-form.service.js:514`, `AutoFillService.js:223`) sets them, and nothing reads them. Per-participant form provisioning is a phantom capability; the unique index `{caseId, formTemplateId, participantId}` degenerates to `{caseId, formTemplateId}` |
| D2 | `CaseForm.fieldValueProvenance` (a real `Map` with a typed sub-schema) | `models/CaseForm.js:205-225` — added in Phase 2 explicitly "for AutoFillService's sync engine" | **ZERO** non-test reads or writes anywhere in the backend |
| D3 | `Case.participants[].uscisFormIds`, `letterIds`, `ocrResultIds`, `evidenceIds`, `checklistItemIds`, `notificationIds` | `models/Case.js:385-395` | **ZERO** outside the model file (only `documentIds` at `:385` is live, written at `document.service.js:293-294`) |
| D4 | `Case.employerCompanyProfile` (`Mixed`, `default: {}`) | `models/Case.js:422` | **ZERO** outside the model file |
| D5 | `Case.participants[].canonicalProfileId` | `models/Case.js:383` | copied by `case-participant.service.js:107,129` and read into `Document.canonicalProfileId` at `document.service.js:258`, but **nothing in the backend ever populates it** with a real profile id — `EmployeeProfile._id` goes to `Case.personProfileId` instead (`case.controller.js:1146`) |
| D6 | `Case.assignedFinance`, `Case.assignedDocumentationSpecialist` | **never declared on `caseSchema` at all** | Written at `case-collaboration/services/AssignmentService.js:9-10,22` (silently dropped by Mongoose strict mode) and read at `ai/ai-orchestration.service.js:263`, `reports/report.service.js:391-392`, `workflows/workflow.service.js:327` (always `undefined`) |

**No model in the backend is entirely unwritten.** All 67 model files have at least one non-test write site in a file reachable from `server.js`. (`Counter` looks unwritten externally but writes through its own static at `models/Counter.js:28`, called from `services/CaseNumberService.js:22`.) Models whose writes are almost entirely confined to tests, as a weak signal only: `Payment` (1 of 11 write sites outside tests, `payments/payment.service.js:340`), `CaseAssignmentEvent` (1 of 5, `cases/case.controller.js:254`).

## 0.8-E — Services the frontend never calls

Determined by extracting every API path prefix from both `src` trees and differencing against the 64 mounts in `routes/index.js:3-66`.

**Router mounts with ZERO call sites in either portal (13):**

| Mount | `routes/index.js` | Routes | Note |
|---|---|---|---|
| `/audit` and `/audit-logs` | `:16`, `:18` | 6 (× 2 prefixes) | no audit-log UI exists anywhere |
| `/beneficiaries` | `:7` | 12 | Beneficiary data reaches the UI only as a populated sub-object on Case |
| `/canonical` | `:22` | 11 | the canonical profile is surfaced *only* inside the USCIS workspace payload |
| `/dashboard` | `:11` | 14 | INSZoom uses `/analytics/*` and `/cases/dashboard/*` instead — same controller, different mount |
| `/form-mappings` | `:32` | mapping-graph admin | no UI |
| `/search` | `:19` | search | no UI |
| `/calendar` | `:54` | calendar | no UI (INSZoom's `/tasks/calendar` is a SPA route, not this API) |
| `/workflows` | `:57` | workflow engine | no UI |
| `/billing` | `:56` | 6 | INSZoom uses `/payments` + `/analytics` instead |
| `/data-rights` | `:65` | GDPR/DSAR | no UI |
| `/petition-intelligence` | `:47` | — | no UI |
| `/consultation-routing` (staff half) | `:61` | `/queue`, `/queue/:id/claim` | the public half is used by BAIS |

**Individually unreachable service surfaces:**

| # | Item | Evidence |
|---|---|---|
| E1 | **All 10 `autoFillRoutes` endpoints** (`/api/cases/:caseId/forms/:formType/{autofill,preview,validation,regenerate,refresh,repopulate-fields,reset-auto-filled,rollback/:versionNumber}` + the two `fields/:fieldId/*` PATCHes) | `form-mapping/routes/autoFillRoutes.js:8-17`; zero call sites in either portal. `AutoFillService` is reached only internally, from `case-lifecycle-orchestrator.service.js:487` and `interactive-form-review.service.js:413` |
| E2 | **`POST /api/employer-profile/:principalCaseId` and `GET /:principalCaseId` and `GET /summary/me`** | `employer-profile.routes.js:11-13`. BAIS declares `employerProfileApi.get/mySummary/save` at `BAIS/Frontend/src/services/api.js:498-501` and **calls none of them**; the component built for it, `BAIS/Frontend/src/components/questionnaire/CanonicalProfileForm.jsx`, is never imported; INSZoom has no employer-profile API at all. The **only** live writer of `EmployerProfile` canonical data is `AutoFillService.applyFormEditToProfile` (`AutoFillService.js:353`) — i.e. a staff member editing a USCIS form field |
| E3 | **INSZoom calls zero `/document-intelligence` endpoints** — staff have no OCR review surface, despite `reviewerRoles` = `super_admin`/`admin`/`team_lead`/`case_manager` being granted server-side (`document-intelligence.routes.js:22-29`) | grep of `INSZoom/frontend/src` for `document-intelligence`: no matches |
| E4 | 40+ declared-but-never-called wrappers in `INSZoom/frontend/src/services/api.js` — incl. `casesApi.createWithClient:158`, `update:159`, `archive:160`, `dashboardStats:149`, `uscisFormsApi.{createCaseForm:237,render:238,saveDraft:240,autoSave:241,saveSection:242,review:243,workspaceValidation:261,workspaceHistory:262,workspaceSources:263,workspaceComparison:264,searchWorkspaceFields:265}`, `formGenerationApi.regeneratePdf:270`, `eligibilityApi.{gaps:319,recommendations:320,recalculate:321,override:322}` | makes `api.js` a misleading guide to what the app actually does |
| E5 | ~30 declared-but-never-called wrappers in `BAIS/Frontend/src/services/api.js` — incl. the entire `employerProfileApi`, `casesApi.create:441`, all 9 checklist/questionnaire-reference wrappers `:448-472`, `documentsApi.download:313`, `documentIntelligenceApi.casePrefillSummary:333` | `services/api.js:365-371` even admits one is "for a future caller" |

## 0.8-F — Orphan backend modules (never `require()`d)

15 files are unreachable from `server.js` after excluding tests, seeds, and CLI scripts:

| # | File | Note |
|---|---|---|
| F1 | `Backend/src/modules/sync/sync.routes.js` | 11 live endpoints, never mounted (see A7) |
| F2 | `Backend/src/jobs/USCISScanner.js` | the entire `src/jobs/` directory contains only this file and **nothing requires it**. `server.js:14,186` registers `modules/uscis-lifecycle/jobs/USCISMonitoringJob` instead — and, unlike the seven jobs at `server.js:47-120`, that one is **not** wrapped in `withJobLock`, so it can double-run across processes |
| F3 | `Backend/src/modules/audit/audit.middleware.js` | a complete `res.on("finish")` audit-trail middleware (`auditAction`, `:3`, exported `:23`). **No route applies it.** The only `auditAction` grep hits elsewhere are an unrelated options key in `PetitionWordPackageService.js:174,298` |
| F4 | `Backend/src/modules/compliance/copyLint.middleware.js` | the prohibited-copy write guard (`guardFields`, `:9`, exported `:44`) that blocks 422 + audits. **No write route uses it** — the copy-lint enforcement layer is entirely inert |
| F5 | `Backend/src/modules/form-generation/jobs/PDFGenerationJob.js` | BullMQ-shaped processor (`processCaseFormPdfJob`, `:3`), never registered with any queue. Consistent with the fact that `bullmq` is a declared dependency but has **zero** `require("bullmq")` sites in `Backend/src` — the document-intelligence queue is an in-process array (`document-intelligence.queue.js:7-46`) |
| F6 | `Backend/src/utils/visaDisplay.js` | `resolveDisplayVisa` (`:16`), never imported |
| F7 | `Backend/src/modules/uscis-form-import/scripts/relabelTemplate.js` | CLI script with no `package.json` entry and no requirer |
| F8–F13 | Six barrel `index.js` files — `case-collaboration/`, `eligibility-engine/`, `form-generation/`, `form-mapping/`, `immigration-lifecycle/`, `uscis-lifecycle/` | each re-exports 6–8 services; every consumer imports the concrete path directly, so all six are dead weight |
| F14–F15 | `form-mapping/seeds/i129f-k1-mapping.seed.js`, `i130-k3-mapping.seed.js` | legitimate npm-script entry points, but unlike their I-129 sibling they are not exercised by any test |

**No dead service modules.** Every `*service*.js` under `Backend/src` has at least one non-test requirer.

## 0.8-G — Security gaps found while tracing interconnectivity

These are outside the literal §15/§16 brief but were found by following the module graph, and are recorded because they are the highest-severity items this track surfaced.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| **G1** | **CRITICAL** | **`GET /api/uscis-forms/case` (and its alias `GET /api/forms/case`) returns EVERY `CaseForm` in the database**, unscoped, including `filledData`/`fieldValues` — i.e. every case's SSNs, alien numbers, passport numbers and salary data. The handler builds `const query = {}` and only narrows it if `req.query.caseId` is supplied. The sole gate is `authorizePermissions("forms:read")`, which `permissions.registry.js:49,50,56,57` grants to **`client`, `employee`, `employer`, and `beneficiary`**. Any logged-in client can dump the whole collection. INSZoom actually calls it unfiltered on first load of the Case Forms tab | `uscis-form.controller.js:169-188` (`:171-172`); route `uscis-form.routes.js:18`; caller `INSZoom/frontend/src/pages/USCISForms.jsx:117-121` |
| **G2** | **HIGH** | **No per-case authorization on any of the 10 auto-fill routes.** `autoFillRoutes.js:6` applies `authenticate`; each route adds only `authorizePermissions("forms:read"\|"forms:update")`. `AutoFillService.js` never imports `case.service` and never calls `canAccessCase` — a grep of `modules/form-mapping/` for `canAccessCase`/`requireCaseFormAccess` returns zero hits. Any `forms:update` holder can autofill, override, reset or roll back **any** case's forms by substituting `:caseId` | `autoFillRoutes.js:8-17`; `AutoFillService.js` (whole file) |
| **G3** | **HIGH** | **`POST /api/forms/packages/generate` has no `requireCaseFormAccess`** — unlike all nine sibling routes at `:11-19`. `FilingPackageService.assemble` takes `caseId` from the request body and returns every generated USCIS PDF plus every approved evidence document for that case | `formGenerationRoutes.js:10` vs `:11-19`; `FilingPackageService.js:36-60` |
| **G4** | **HIGH** | **No per-case authorization anywhere in the eligibility engine.** All six routes gate on `cases:read`/`cases:update` only, and a grep of `modules/eligibility-engine/` for `canAccessCase` returns zero hits | `eligibility-engine/routes/eligibilityRoutes.js:9-14` |
| G5 | MODERATE | `billing.controller.getLedger` (`:39-48`) and `getRequests` (`:50-60`) build their filter from query params only, with no user/case scoping — unlike `payment.service.buildPaymentFilter`, which the sibling `/payments` routes use | `modules/billing/billing.controller.js:39-60` |
| G6 | MODERATE | `GET /api/forms/:caseFormId/filing-pdf` — a GET — **creates a `Document` record** and an audit row. Same class of hidden-write-on-GET that `docs/forms/issues/ISSUE-003` was opened for; that fix covered `/workspace` only | `FormGenerationController.js:105-132`, `:121` |
| G7 | LOW | `eligibilityRoutes.js:14` gates the override route on `authorizeRoles("super_admin","admin","attorney")` — `attorney` is not a member of `CANONICAL_ROLES` (`roleHierarchy.js:1-13`) and therefore cannot exist as a `User.role` value | |

## 0.8-H — Roles referenced in code that cannot exist

`User.role`'s enum is `CANONICAL_ROLES` — exactly 8 values: `super_admin, admin, team_lead, case_manager, employer, employee, client, beneficiary` (`Backend/src/modules/authorization/roleHierarchy.js:1-13`, applied at `models/User.js:4-6,14`). The following roles are branched on across the backend but **can never appear on a real user**, so every branch guarding them is dead:

- **`paralegal`** — 17 non-test sites, incl. `collaborationRoutes.js:9-10` (`authorizeRoles(...,"paralegal")` on `POST /cases/:caseId/tasks` and `/requests`), `case-participant.service.js:4`, `document.service.js:19,223`, `message.service.js:15`, `notification.service.js:12`, `questionnaire.service.js:24`, `user.service.js:13`, `immigration-lifecycle/routes/lifecycleRoutes.js:7`. Note that even if such a user existed, `authorizePermissions` would still 403 them — `ROLE_PERMISSIONS` has no `paralegal` key (`permissions.registry.js:38-59`), and `rbac.service.hasPermission:18-21` falls back to `[]`.
- **`attorney`** — `ai-context.service.js:61`, `ai-prompt.service.js:14`, `client-intake.service.js:13`, `company.service.js:16`, `notification.service.js:12`, `report.service.js:18`, `intelligent-questionnaire.service.js:258`, `lifecycleRoutes.js:7`, `eligibilityRoutes.js:14`.
- **`reviewer`**, **`finance`**, **`hr`**, **`sales_manager`**, **`professor`** — `user.service.js:13` (`ASSIGNABLE_ROLES` includes `paralegal`, `finance`, `hr`, `reviewer` — a `User.create` with any of them raises a Mongoose `ValidationError`), `report.service.js:18`, `company.service.js:16`, `notification.service.js:12`, `document.service.js:223`.

## 0.8-I — Completion-report claims the current branch does not match

| # | Claim | Source | Current branch |
|---|---|---|---|
| I1 | "`POST /api/cases` … `authorizeRoles("super_admin","admin","team_lead","case_manager")` inserted before `authorizePermissions("cases:create")`" | `docs/phases/PHASE_2_COMPLETION_REPORT.md` §1 table | **Partially stale.** The guard is `authorizeRoles("super_admin","admin","team_lead")` — `case_manager` is **not** included (`case.routes.js:22-26`). Presumably tightened by a later phase; the report was not updated |
| I2 | "`POST /cases/create-with-client` untouched — confirmed" | `docs/phases/PHASE_2_COMPLETION_REPORT.md` §2 | **True, and that is the problem.** It is still live at `case.routes.js:40-57` with `staffRoles` (which *does* include `case_manager`, `case.routes.js:11`), giving `case_manager` a case-creation route that `POST /api/cases` denies them; and it creates cases in the pre-Phase-2 shape (see I3) |
| I3 | Phase 2 added `caseStructure`/`caseRole`/`childIndex`/`childCaseCount`/`creationSource`/`leadId`/`consultationId`/`employerProfileId`/`personProfileId`/`dataEntryMode`/`assignmentOverridden` to `Case` | `docs/phases/PHASE_2_COMPLETION_REPORT.md` §2 | Fields exist (`models/Case.js:809-937`), but `createCaseWithClient` (`case.controller.js:2404-2609`) sets **none** of them, so a second live creation path still produces pre-Phase-2 documents |
| I4 | Phase 2 added `CaseForm.fieldValueProvenance` "for AutoFillService's sync engine once it starts consuming `USCISMappingVersion`'s `profileOwner`/`allowsOccurrenceOverride` edge classification" | `models/CaseForm.js:196-204`; `docs/phases/PHASE_2_COMPLETION_REPORT.md` §2 | The field exists (`:205-225`) and has **zero** non-test readers or writers. `profileOwner`/`allowsOccurrenceOverride` *are* consumed, but by `FormMappingService`/`MappingResolver`/`canonicalFieldWriter`, never through this Map |
| I5 | `docs/forms/issues/ISSUE-001` — "`Backend/src/routes/index.js` now mounts `formGenerationRoutes` before `uscis-form.routes` for `/forms`" | `docs/forms/issues/ISSUE-001-draft-pdf-route-shadowing.md` "Delivered" | **Verified correct** (`routes/index.js:26-27`). Recorded here only because it is one of the few claims that survived re-verification unchanged — with the one inverse casualty at A6 |
| I6 | `docs/forms/issues/ISSUE-003` — "GET endpoints must not mutate state" | `ISSUE-003-get-open-hidden-writes.md` | Fix confirmed for `/workspace` (`readOnlyOpen` option exists). **Two GET paths still write:** `GET /forms/:caseFormId/filing-pdf` creates a `Document` (`FormGenerationController.js:121`), and `GET /uscis-forms/case/:caseId/:formId/render` passes no options to `renderCaseForm` (`uscis-form.controller.js` `renderCaseForm`), so it takes the writing branch |
| I7 | Docs reference 12 backend files that do not exist | `docs/forms/H0_I-129_template_seed_prompt.md`, `docs/forms/PHASE1_RUN_JOURNAL.md`, `docs/forms/issues/P1-000-dictionary-premise-retracted.md` | `Backend/src/config/{firebase,index}.js`, `models/{USCISAcroFieldDictionary,index}.js`, `modules/auth/firebase.service.js`, `modules/form-generation/tests/phase0.golden.test.js`, `.../tests/golden/k3/snapshot.js`, `modules/form-mapping/config/{i129-l1,i129-o1}-crosswalk.js`, `modules/uscis-form-import/services/{AcroFieldDictionaryExtractor,PdfNormalizerService}.js` + its test, `scripts/phase1BackfillAcroFieldDictionary.js`. The AcroFieldDictionary set is explicitly retracted in `P1-000`; the Firebase set is genuinely stale |

All 34 `package.json` script targets resolve to files that exist on disk.

---

# §17 — Drift against existing architecture artifacts & prior-audit corrections

The brief asked whether `docs/architecture/FULL-SYSTEM-DEPENDENCY-GRAPH.mmd`, `dependency-graph.json`, and `MODULE-CARDS.md` are accurate and current. They were generated in a **2026-08-13/14 session** (`dependency-graph.json` `meta.generatedBy`), i.e. before the Phase 9–13 / F1–F4 refactor landed. Every claim below was re-checked against the current branch.

## 17.1 — Structural counts are stale

| Artifact claim | Current branch | Verdict |
|---|---|---|
| "`routes/index.js` — 29 mounts, 350 routes" (`FULL-SYSTEM-DEPENDENCY-GRAPH.mmd`, `COVERAGE.md` "Router mounts 29/29") | **58** `router.use` mounts (`routes/index.js:3-66`); **620** declared route handlers across 48 route files (752 including nested mounts, per a runtime mount of the whole tree) | **STALE — roughly half the surface is unrepresented.** `COVERAGE.md`'s "100% — every mount read" is no longer true |
| "64 models" (`COVERAGE.md`; `COMPREHENSIVE_AUDIT_V3_REPORT.md:31`) | **67** model files in `Backend/src/models/` | STALE |
| "`cases` — 127 declared indexes … positions 65-128 (all of the explicit compound + text indexes at `Case.js:851-897`) silently fail to create" (`dependency-graph.json` E032; `MODULE-CARDS.md` "Case (model)"; `FULL-SYSTEM-DEPENDENCY-GRAPH.mmd` `DB_CASE` node, classed **P0**) | `Case.js` now declares **50** explicit `caseSchema.index()` calls at **`:1008-1054` and `:1057-1062`**, plus 78 field-level `index: true` and 2 `unique: true` | **STALE in its specifics** — the cited line range (`851-897`) does not exist in the current file and the "127" figure is not reproducible from it. The *concern* is still legitimate: many of the 78 field-level declarations are on `participants.*` subpaths, so the collection is plausibly still near MongoDB's 64-index ceiling. **This needs a live `db.cases.getIndexes()` to settle — it cannot be resolved statically, and this audit does not claim to have settled it.** The P0 classification in the Mermaid graph should not be trusted as-is |
| `MODULE-CARDS.md` "CaseForm — the field-save reload query (`interactive-form-review.service.js:396`)" | the same query is now at **`interactive-form-review.service.js:414`** | line drift only; **the finding itself is still valid** — that `CaseForm.findById(caseFormId)` still has no `.maxTimeMS()` |
| `dependency-graph.json` E004 "`case.routes.js:99` getTimeline is dead code" | the route is now at **`case.routes.js:118`** | line drift only; **finding still valid** |

## 17.2 — Nodes and edges that no longer exist

| Artifact item | Status |
|---|---|
| Node `BE:firebase.service` → `Backend/src/modules/auth/firebase.service.js`; edge **E082** (`auth.service → EXT:FirebaseAdmin`) | **REMOVED FROM THE CODEBASE.** `modules/auth/` contains 12 files and none is `firebase.service.js`. `app.js:31-33` records that Firebase Auth was removed; `auth.controller.js:102-121` now returns a hard 503 for `POST /auth/google-token`. `config/firebase-admin.js` survives, but only for FCM push |
| Node `EXT:MongoDBAtlas` — "cluster0.eqpju6f.mongodb.net (shared/free-tier)"; edges **E022**, **E023** ("ROOT CAUSE of live Cases 503: dead pooled connections on shared/free-tier Atlas") | **CONTRADICTED by the later audit in this same folder.** `docs/audits/COMPREHENSIVE_AUDIT_V3_REPORT.md:22` states the connection string scheme is `mongodb://` with no `+srv` and "**this deployment is not MongoDB Atlas**". The `.mmd`'s `MONGO` subgraph title is therefore wrong, and the free-tier root-cause attribution in E023 does not apply to the current environment |
| Edge **E070** — "`gemini.service.js` — **only registered provider**" for document intelligence | **STALE.** The only provider registered today is `google_document_ai` (`document-intelligence.service.js:38-41`). `gemini.service.js` still exists but is now consumed by the *general-purpose* AI module (`modules/ai/ai-provider.registry.js:2`), not by document intelligence. Related current finding: the registry's **default provider name is still the string `"gemini"`** (`providers/document-intelligence-provider.registry.js:17`), which is not registered — OCR works only because `Backend/.env:18` sets `DOCUMENT_INTELLIGENCE_PROVIDER=google_document_ai`. The registry file's own comment at `:31-37` ("No provider is registered here right now") is also stale |
| `dependency-graph.json` `meta.coverageNote` points at `docs/architecture/ROUTE-TABLE.md` for the full route list | **That file does not exist** in `docs/architecture/` |

## 17.3 — Prior findings re-verified as STILL PRESENT

| Prior finding | Re-verified at |
|---|---|
| E008 — `modules/sync/sync.routes.js` never mounted; "would be a P0 IDOR if ever mounted" | still unmounted; still `Case.find({})`/`Client.find({})` with `authenticate` only (`sync.routes.js:9,18,27`) |
| E015/E016 — `rotateSession` unguarded find→create→save; `VersionError` unclassified by `errorHandler` | `session.service.js:30-43`; `errorHandler.js:11-30` still lists exactly 7 driver error names + code 50, with no branch for `VersionError`, `CastError`, `ValidationError`, or duplicate-key 11000 |
| E050 — no `canAccessCase` anywhere in the eligibility engine | `eligibility-engine/routes/eligibilityRoutes.js:9-14`; grep of the module for `canAccessCase` → 0 hits |
| E051 — `POST /forms/packages/generate` missing `requireCaseFormAccess` | `formGenerationRoutes.js:10` still lacks it while `:11-19` all have it |
| E052 — auto-fill routes have no per-case authorization | `autoFillRoutes.js:8-17`; `AutoFillService.js` still never imports `case.service` |
| E053 — `CaseForm.versions[]` uncapped, full-payload snapshot per entry | `models/CaseForm.js:47-61`; pushed at `AutoFillService.js:245,547,625` |
| E074 — INSZoom has no OCR review surface | still zero `/document-intelligence` call sites in `INSZoom/frontend/src` |
| `MODULE-CARDS.md` — `USCISFormTemplate` payload-size hazard | `uscis-form.controller.js:173-181` documents a live 500 from an unprojected populate of this model |
| `MODULE-CARDS.md` — 14 `ref:"Team"` declarations pointing at a model that is never registered | `models/User.js:29` `teamId: {ref: "Team"}`; there is no `Backend/src/models/Team.js` among the 67 model files. Latent `MissingSchemaError` if any of those paths is ever `.populate()`d |

## 17.4 — Corrections to `docs/audits/FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md`

| Claim | Correction |
|---|---|
| `:10` — "`POST /leads/:id/consultation`, `PATCH /leads/:id/confirm-consultation`, `PATCH /leads/:id/approve` — **Do not exist.** … there is no automated lead-approval-to-case pipeline to test." | **WRONG for this branch.** `PATCH /api/eligibility-quiz/leads/:id/confirm-consultation`, `/complete-consultation`, `/approve`, `/reject` all exist (`modules/eligibility-quiz/quiz.routes.js:50-53`), are backed by a real state machine (`quiz.service.js:260-335`), send emails and role-fanout notifications (`:302-318`), and are fully wired in **both** portals (INSZoom `pages/Leads.jsx:167-173` via `services/api.js:310-313`; BAIS `Pages/Admin/AdminPortal.jsx:923-948`). The conversion terminus exists too: `POST /api/cases` with `creationSource:"lead_conversion"` flips the lead to `converted` and stamps `convertedCaseId` (`case.controller.js:1159-1163`). The prior audit inspected only `lead.routes.js` and did not check the `/eligibility-quiz` mount. **The pipeline is real; the prior report's Part 1 was skipped on a false premise.** |
| `:36-61` — EmployerProfile `legalName`/`contact.email` silently discarded into `conflictPending` | **Present in the committed branch (`c86c446`); an uncommitted working-tree fix appeared during this audit.** `git diff Backend/src/modules/cases/case.controller.js` (unstaged at the time of writing, authored by a concurrent workstream, not by this audit) now builds `canonicalData` conditionally and only stamps `source:"case_manager_edit"` when a real value was supplied — exactly the origin-side fix the prior report recommended at `:63-65`. The downstream machinery is unchanged: `models/EmployerProfile.js:31-41` still declares `conflictPending` and `utils/canonicalFieldWriter.js` still arbitrates on `STAFF_AUTHORITATIVE_SOURCES`, so **already-created profiles carrying a null `case_manager_edit` stamp are not repaired by this fix** — they need a data migration. **Newly material context either way:** the endpoint the report says the employer would use — `POST /api/employer-profile/:id` — has **zero UI callers in either portal** (§0.8-E2), so an employer cannot submit that data at all today; the only live writer is a staff form-edit via `AutoFillService.applyFormEditToProfile` |

## 17.5 — Corrections to `docs/audits/COMPREHENSIVE_AUDIT_V3_REPORT.md`

| Claim | Correction |
|---|---|
| `:66` — "No `AuditLog.delete`/`.remove`/`.findOneAndDelete` call exists anywhere … the trail is append-only by construction, correct for legal software." | Accurate as far as it goes, and immutability is additionally enforced by a `pre("save")` hook (`models/AuditLog.js:36-43`). **But it omits that MongoDB deletes the rows itself**: `auditLogSchema.index({createdAt: 1}, {expireAfterSeconds: 60*60*24*365*2})` (`models/AuditLog.js:32`) is a 2-year TTL. Append-only ≠ permanent, and a 2-year retention window is a compliance decision the report does not surface |
| `:31` — "64 models" | 67 model files |
| `:34-37` — "No route was found that is unintentionally missing authentication." | Consistent with what I found for *authentication*. It does not address **authorization**: this track found four routes/route-groups that authenticate correctly but perform no per-case ownership check (§0.8-G1 through G4), including one — `GET /api/uscis-forms/case` — that returns every `CaseForm` in the database to any holder of `forms:read`, a permission granted to `client`, `employee`, `employer`, and `beneficiary` |
| `:69` — "0 `TODO`/`FIXME`/`HACK` markers in any non-test production file." | Reproducible for those three literal tokens. It does **not** mean there are no placeholders: §0.8-C lists 8 backend placeholder implementations that self-document as such using other wording ("placeholder", "SCAFFOLD NOTICE", "intentionally a no-op", "temporarily unavailable") |
| `:90` — "7 available templates ≠ 7 certified end-to-end workflows. Only H-1B → I-129 has a proven … `CaseForm` on record" | Consistent with the code: `modules/form-mapping/config/` contains exactly three crosswalks (`i129-h1b`, `i129f-k1`, `i130-k3`), and docs reference two more (`i129-l1`, `i129-o1`) that **do not exist on disk** (§0.8-I7) |

---

# Appendix A — Module reality scorecard

**34 modules requested. 34 correspond to real, mounted code. 0 are absent.** The distinction that matters is not existence but **reachability**: 8 of them have no live UI consumer, so they are real code that no user can currently invoke.

| # | Module | Real code? | UI-reachable? | Highest concern |
|---|---|---|---|---|
| 1 | Authentication | ✅ | ✅ both portals | Google-token endpoint is a guaranteed 503 (`auth.controller.js:114`) |
| 2 | Session / refresh | ✅ | ✅ both portals | unguarded rotation race → unclassified 500 |
| 3 | RBAC | ✅ | ✅ (menu gating) | 7 roles branched on that cannot exist |
| 4 | Case | ✅ | ✅ both portals | index-count ceiling; legacy/current split |
| 5 | Lead | ✅ | ✅ both portals | split across `/leads` + `/eligibility-quiz/leads`; `team_lead` holds `leads:read` but is blocked by `authorizeRoles` |
| 6 | Consultation | ✅ | ✅ BAIS public only | no staff calendar UI; `/consultation-routing/queue` unreachable |
| 7 | Case creation | ✅ | ✅ INSZoom (path A only) | **two divergent live implementations** |
| 8 | Case lifecycle | ✅ | ✅ both portals | duplicate-`formCode` autofill loop bug |
| 9 | EmployerProfile | ✅ | ❌ **no UI caller** | write path unreachable; silent-conflict defect persists |
| 10 | EmployeeProfile | ✅ | ✅ BAIS Profile.jsx | gated on `caseRole` |
| 11 | Beneficiary profile | ✅ | ❌ **no UI caller** | 12 dead HTTP routes |
| 12 | Question | ✅ | ✅ INSZoom builder | `canonicalPath` is an unvalidated string contract |
| 13 | Answer | ✅ | ✅ BAIS writes, INSZoom reads | family-scoped `caseId` query is load-bearing |
| 14 | Questionnaire service | ✅ | ✅ both portals | widest write surface in the backend |
| 15 | CanonicalBuilderService | ✅ | ❌ (no `/canonical` UI) | 3 unvalidated string maps define the whole pipeline |
| 16 | CanonicalSyncService | ✅ | ❌ (side-effect only) | writes a participant store that autofill never reads |
| 17 | AutoFillService | ✅ | ❌ **all 10 routes unreachable** | no per-case authorization (G2) |
| 18 | USCISFormTemplate | ✅ | ✅ INSZoom | ~16 MB documents; qpdf hard dependency |
| 19 | CaseForm | ✅ | ✅ INSZoom | uncapped `versions[]`; unfiltered list IDOR (G1) |
| 20 | PDF rendering | ✅ | ✅ (indirect) | `pdf-lib` class-name dispatch; qpdf |
| 21 | PDF editing | ✅ | ✅ INSZoom | missing `maxTimeMS` on the save reload; formCode-vs-id identity mismatch |
| 22 | PDF download | ✅ | ✅ INSZoom | GET that writes a Document |
| 23 | OCR | ✅ | ✅ **BAIS only** | staff have no review surface; default provider name unregistered |
| 24 | Documents | ✅ | ✅ both portals | BAIS XHR upload bypasses token refresh |
| 25 | Notifications | ✅ | ✅ both portals | role-fanout emits only `notification:new`; BAIS listens for `new_notification` |
| 26 | Email | ✅ | n/a (server) | 4 production templates ship placeholder bodies |
| 27 | Assignments | ✅ | ✅ INSZoom | 2 phantom `Case` fields silently dropped |
| 28 | Dashboard | ✅ | ⚠️ `/analytics` only | the `/dashboard` mount itself has no caller |
| 29 | Documents page (UI) | ✅ | ✅ | primary client work surface |
| 30 | Forms page (UI) | ✅ | ✅ | one ~1,700-line component owns the whole contract |
| 31 | Audit logs | ✅ | ❌ **no UI caller** | 2-year TTL silently expires the trail |
| 32 | Payments | ✅ | ✅ both portals | billing ledger routes unscoped |
| 33 | Storage | ✅ | ✅ (indirect) | no key-rotation scheme for envelope encryption |
| 34 | API routes | ✅ | ✅ | mount order is semantically load-bearing; 6 dead routes |

**Top blast-radius findings, ranked:**

1. **G1 — `GET /api/uscis-forms/case` returns every `CaseForm` in the database** to any holder of `forms:read`, which includes every client, employee, employer and beneficiary account (`uscis-form.controller.js:169-188`). CRITICAL.
2. **Two divergent live case-creation paths** — `create-with-client` produces `caseRole: null` cases that the Phase-2/9/13 canonical pipeline structurally cannot serve, and grants `case_manager` a route `POST /api/cases` denies them (`case.controller.js:2404-2609`, `case.routes.js:40-57`). CRITICAL.
3. **`CaseForm.fieldValues` is an untyped `Mixed` map whose keys are simultaneously Mongo keys, pdfjs annotation-storage keys, and the join key for four parallel per-field maps** (`models/CaseForm.js:35,196-238`). CRITICAL to change.
4. **`Case.caseRole` silently partitions the canonical data pipeline** with no error on a wrong/absent value (`CanonicalBuilderService.js:201-226`). CRITICAL.
5. **G2/G3/G4 — three route groups authenticate but never authorize per case** (auto-fill, filing-package assembly, eligibility). HIGH.
6. **The EmployerProfile write path has no UI at all**, so the documented silent-data-loss defect is currently moot only because employers cannot reach the endpoint (§0.8-E2). HIGH.



