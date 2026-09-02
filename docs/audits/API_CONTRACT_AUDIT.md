# API Contract Audit (§17)

**Scope:** `Backend/src` — every route mounted through `Backend/src/routes/index.js`.
**Method:** static analysis only. No HTTP request was made to the running backend. One
in-process Express router simulation (route-path strings only, no application code, no DB)
was used to verify mount-order resolution — see `NEGATIVE_WORKFLOW_MATRIX.md` §T3.
**Date:** 2026-09-01 · **Branch:** `refactor` @ `c86c446`
**Line-number baseline:** the **working tree** as read, not the commit. `case.controller.js` had
one uncommitted hunk at `:1079-1096` (`+7` lines) at the time of analysis, so every
`case.controller.js` citation after line 1096 here is offset `+7` from `c86c446`. All other
files cited were clean.

---

## 0. Headline numbers

| Metric | Count |
|---|---|
| Route files found | 57 (`Backend/src/modules/**/*.routes.js` + `**/routes/*.js`) |
| `router.<verb>(...)` declarations total | **707** |
| Declarations that are **unreachable** (router never mounted) | **11** (`Backend/src/modules/sync/sync.routes.js` — see §4.1) |
| Reachable declarations | **696** |
| Distinct reachable `METHOD + path` endpoints | **746** (the 50 declarations in `uscis-forms/uscis-form.routes.js` are mounted at **two** prefixes — `/api/uscis-forms` and `/api/forms` — `routes/index.js:23,27`) |
| **Unauthenticated endpoints** | **33** (31 in the router + 2 registered directly in `app.js`) |
| Endpoints authenticated but with **no** role / permission / ownership gate at any layer | **0 at the route layer that are also unguarded in the service layer** — see §3.2 for the 14 route-layer-bare endpoints and which of them are service-enforced |
| **IDOR-prone endpoints** (role/permission-gated, resource is case- or user-scoped, **no per-resource ownership check anywhere**) | **43** |
| Endpoints shadowed by an earlier mount / param route | **6** (see `NEGATIVE_WORKFLOW_MATRIX.md` §T3) |

---

## 1. Authorization primitives

| Primitive | File:line | Behaviour |
|---|---|---|
| `authenticate` | `Backend/src/middleware/authenticate.js:5-40` | Requires `Authorization: Bearer`. 401 on missing header (`:9`), 401 on inactive user / `tokenVersion` mismatch (`:29`), 401 `TOKEN_EXPIRED` (`:36`), 401 catch-all (`:38`). **Never 500s.** |
| `optionalAuthenticate` | `Backend/src/middleware/optionalAuthenticate.js:10-34` | Populates `req.user` if a valid token is present, otherwise silently anonymous. Used by `POST /api/eligibility-quiz/submit`. |
| `softAuthenticate` (local) | `Backend/src/modules/compliance/compliance.routes.js:15-28` | Duplicate of `optionalAuthenticate`, inlined in the compliance module. |
| `authorizeRoles(...roles)` | `Backend/src/middleware/authorizeRoles.js:3-13` | 403 if `hasRole` fails. **Role check only — never resource-scoped.** |
| `authorizePermissions(...perms)` | `Backend/src/middleware/authorizePermissions.js:3-11` | 403 if any permission missing. **Role-derived; never resource-scoped.** |
| `hasRole` / `hasPermission` | `Backend/src/modules/authorization/rbac.service.js:4-22` | Permission resolution: direct `user.permissions` → `*` → `resource:*` → `ROLE_PERMISSIONS[role]`. |
| Permission registry | `Backend/src/modules/authorization/permissions.registry.js:1-65` | `PERMISSIONS` (:1-36), `ROLE_PERMISSIONS` (:38-59). |
| Role hierarchy | `Backend/src/modules/authorization/roleHierarchy.js:1-48` | `user` normalises to `client` (`:29-31`). |
| `validate` | `Backend/src/middleware/validate.js:3-13` | 400 `{success:false,message:"Validation failed",errors:[...]}` from `express-validator`. |
| `sanitizeRequest` | `Backend/src/middleware/sanitizeRequest.js:14-19` | Global (`app.js:68`). Strips `__proto__`/`constructor`/`prototype`, any key starting with `$`, any key containing `.` — from body, query **and params**. NoSQL-injection and prototype-pollution guard. |
| Global rate limit | `Backend/src/app.js:47-52` | 300 req / 15 min / IP, app-wide. |
| **Case scope** `canAccessCase(user, caseData)` | `Backend/src/modules/cases/case.service.js:102-127` | The single real per-case authorization primitive. `case_manager` → `assignedCaseManager` or `primaryOwner` only (`:116`); `team_lead` → same `teamId` (`:117`); `employee`/`beneficiary` → `canAccessRestrictedChildCase` (`:71-84`). |
| `getAccessibleCaseOrThrow` | `Backend/src/modules/cases/case.service.js:522-535` | 404 then 403. |
| `getAuthorizedCase` (case module) | `Backend/src/modules/cases/case.controller.js:383-392` | `getCaseOr404` + `canAccessCase`. |
| `getCaseOr404` (case module) | `Backend/src/modules/cases/case.controller.js:374-381` | **404 only — no authorization.** Every controller that calls this without a following `canAccessCase` is IDOR-prone. |
| `requireCaseFormAccess` | `Backend/src/modules/form-generation/middleware/requireCaseFormAccess.js:17-41` | `caseFormId` → `caseId` → `canAccessCase`. |
| `getAccessibleCase` (forms) | `Backend/src/modules/uscis-forms/uscis-form.service.js:260-282` | Case-scoped, with `maxTimeMS` + secondary fallback. |
| `InteractiveFormReviewService.load` | `Backend/src/modules/uscis-forms/interactive-form-review.service.js:139-151` | `canAccessCase` at `:151`; documented at `:133-138` as the sole gate for 13 of 14 write call sites. |

### Role → permission summary (`permissions.registry.js:38-59`)

| Role | Notable grants relevant to IDOR |
|---|---|
| `super_admin` | `*` |
| `admin` | every `resource:*` except none |
| `team_lead` | `cases:*`, `forms:read/create/update/approve`, `documents:*` |
| `case_manager` | `cases:read/create/update` (**no** `cases:delete`), `forms:read/create/update/approve`, `documents:*`, `questionnaires:*` |
| `client` | `cases:create/read/update`, `forms:read`, `documents:create/read/delete`, `questionnaires:read/update/submit` |
| `employee` | `cases:read`, `forms:read`, `documents:create/read/delete` |
| `beneficiary` | identical to `employee` (`:56`) |
| `employer` | `cases:create/read/update`, `forms:read`, `companies:read/update` |

> **Critical consequence:** `forms:read` is held by `client`, `employee`, `employer` and
> `beneficiary`. Every endpoint whose *only* gate is `authorizePermissions("forms:read")`
> is readable by any logged-in portal user, for **any** resource id.

---

## 2. Full route inventory

Legend — **Auth**: `Y` = `authenticate`, `opt` = `optionalAuthenticate`/`softAuthenticate`, `N` = none.
**Scope**: `case` = real per-case ownership check reached; `self` = owner-scoped query;
`role` = role/permission only; `—` = none.
Flags: 🔴 unauthenticated · 🟡 authenticated with no route-layer role/permission gate ·
🟠 **IDOR-prone** (role-gated, resource is case/user-scoped, no per-resource check anywhere).

### 2.1 `/api/auth` — `modules/auth/auth.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller | Flag |
|---|---|---|---|---|---|---|---|
| POST `/register` | N | — | — | — | `:14` email/password/name/accountType + `validate` | `ctrl.register` | 🔴 |
| POST `/staff/register` | Y | SA, A | — | role | `:24` + `validate` | `ctrl.registerStaff` | |
| POST `/login` | N | — | — | — | `:33-45` + `validate` | `ctrl.login` | 🔴 |
| POST `/google-token` | N | — | — | — | `:47` `idToken` + `validate` | `ctrl.googleToken` | 🔴 |
| GET `/google` | N | — | — | — | none | `ctrl.googleOAuthStart` | 🔴 |
| GET `/google/callback` | N | — | — | — | none | `ctrl.googleOAuthCallback` | 🔴 |
| POST `/refresh` | N | — | — | — | none (refresh cookie) | `ctrl.refresh` | 🔴 |
| POST `/logout` | Y | any | — | self | none | `ctrl.logout` | |
| POST `/logout-all` | Y | any | — | self | none | `ctrl.logoutAll` | |
| GET `/me` | Y | any | — | self | none | `ctrl.me` | |
| GET `/session-context` | Y | any | — | self | none | `ctrl.getSessionContext` | |
| PUT `/change-password` | Y | any | — | self | `:64` + `validate` | `ctrl.changePassword` | |
| PUT `/updatedetails` | Y | any | — | self | **none** | `ctrl.updateDetails` | |
| PUT `/updatepassword` | Y | any | — | self | `:71` + `validate` | `ctrl.changePassword` | |
| POST `/forgot-password` | N | — | — | — | `emailRule` + `validate` | `ctrl.forgotPassword` | 🔴 |
| POST `/reset-password` | N | — | — | token | `:73` + `validate` | `ctrl.resetPassword` | 🔴 |
| POST `/verify-email` | N | — | — | token | `:74` + `validate` | `ctrl.verifyEmail` | 🔴 |
| POST `/resend-verification` | Y | any | — | self | none | `ctrl.resendVerification` | |
| GET `/invite/:token` | N | — | — | token | none | `ctrl.getInviteDetails` | 🔴 |
| POST `/invite/:token/accept` | N | — | — | token | `:80` + `validate` | `ctrl.acceptInvite` | 🔴 |
| POST `/resend-invite` | N | — | — | — | `emailRule` + `validate` | `ctrl.resendInvite` | 🔴 |

### 2.2 `/api/admin` — `modules/admin/admin.routes.js`
Router-level gate: `authenticate, authorizeRoles("admin","super_admin")` at `:6`.

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller |
|---|---|---|---|---|---|---|
| GET `/overview` | Y | A, SA | — | role | none | `ctrl.getOverview` |
| GET `/users` | Y | A, SA | — | role | none | `ctrl.getAllUsers` |
| GET `/users/:userId` | Y | A, SA | — | role | none | `ctrl.getUserDetail` |
| PUT `/users/:userId/toggle-status` | Y | A, SA | — | role | none | `ctrl.toggleUserStatus` |
| GET `/documents` | Y | A, SA | — | role | none | `ctrl.getDocumentOverview` |
| DELETE `/demo-data` | Y | SA (`:13`) | — | role | none | `ctrl.purgeDemoData` |

### 2.3 `/api/clients` — `modules/clients/client.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller |
|---|---|---|---|---|---|---|
| GET `/dashboard` | Y | STAFF+C | `clients:read` | role | — | `ctrl.getDashboard` |
| GET `/me` | Y | STAFF+C | `clients:read` | self | — | `ctrl.getMyProfile` |
| PUT `/me` | Y | STAFF+C | `clients:update` | self | — | `ctrl.saveMyProfile` |
| GET `/` | Y | STAFF+C | `clients:read` | role | `query(status)` + `validate` | `ctrl.getClients` |
| POST `/` | Y | STAFF | `clients:create` | role | `clientRules` + `validate` | `ctrl.createClient` |
| GET `/:id` | Y | STAFF+C | `clients:read` | role | none | `ctrl.getClient` |
| PUT `/:id` | Y | STAFF+C | `clients:update` | role | `clientRules` + `validate` | `ctrl.updateClient` |
| PUT `/:id/status` | Y | STAFF | `clients:update` | role | none | `ctrl.updateStatus` |
| DELETE `/:id` | Y | SA, A | `clients:delete` | role | none | `ctrl.deleteClient` |
| POST `/:id/notes` | Y | STAFF | `clients:update` | role | `body(note)` + `validate` | `ctrl.addNote` |
| GET `/:id/timeline` | Y | STAFF+C | `clients:read` | role | none | `ctrl.getTimeline` |
| GET `/:id/related` | Y | STAFF+C | `clients:read` | role | none | `ctrl.getRelated` |

> `client` is in `readRoles` (`:10`) and holds `clients:read`/`clients:update`, so
> **GET/PUT `/api/clients/:id` are reachable by any client account for any client id**
> unless `client.service` re-scopes. See §3.3.

### 2.4 `/api/client-intake` — `modules/client-intake/client-intake.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller |
|---|---|---|---|---|---|---|
| GET `/me` | Y | STAFF, C, U | `clients:read` | **case** (`client-intake.service.js:235-237` → `getAccessibleCaseOrThrow`) | — | `ctrl.getMyIntake` |
| PUT `/me` | Y | STAFF, C, U | `clients:update` | **case** | `body(caseId).isMongoId()` + `validate` | `ctrl.saveMyIntake` |
| POST `/me/submit` | Y | C, U | `clients:update` | **case** | `body(caseId)` + `validate` | `ctrl.submitMyIntake` |
| GET `/cases/:caseId` | Y | STAFF | `clients:read` | **case** (`:468`) | none | `ctrl.getCaseIntake` |

### 2.5 `/api/beneficiaries` — `modules/beneficiaries/beneficiary.routes.js`
Same shape as `/api/clients`: `readRoles = STAFF + client` (`:11`).

| Method + path | Auth | Roles | Perms | Scope | Controller |
|---|---|---|---|---|---|
| GET `/dashboard` | Y | STAFF+C | `beneficiaries:read` | role | `ctrl.getDashboard` |
| GET `/me` · PUT `/me` | Y | STAFF+C | `beneficiaries:read/update` | self | `ctrl.getMyBeneficiary` / `saveMyBeneficiary` |
| GET `/` | Y | STAFF+C | `beneficiaries:read` | role | `ctrl.getBeneficiaries` |
| POST `/` | Y | SA, A, CM | `beneficiaries:create` | role | `ctrl.createBeneficiary` |
| GET `/:id` · PUT `/:id` | Y | STAFF+C | `beneficiaries:read/update` | role | `ctrl.getBeneficiary` / `updateBeneficiary` |
| PUT `/:id/status` | Y | SA, A, CM | `beneficiaries:update` | role | `ctrl.updateStatus` |
| DELETE `/:id` | Y | SA, A | `beneficiaries:delete` | role | `ctrl.deleteBeneficiary` |
| POST `/:id/notes` | Y | STAFF | `beneficiaries:update` | role | `ctrl.addNote` |
| GET `/:id/timeline` · `/:id/related` | Y | STAFF+C | `beneficiaries:read` | role | `ctrl.getTimeline` / `getRelated` |

Validation: `beneficiaryRules` (`:13-17`) + `validate` on `/me` PUT, `/` GET/POST, `/:id` PUT.

### 2.6 `/api/companies` — `modules/companies/company.routes.js`
`readRoles = STAFF` (`:9`) — no portal roles. All 10 routes: `authenticate` + `authorizeRoles` + `authorizePermissions("companies:*")`, `companyRules` + `validate` on writes. Scope: **role only**.

`GET /dashboard`, `GET /`, `POST /`(SA,A), `GET /:id`, `PUT /:id`(SA,A), `DELETE /:id`(SA,A), `PUT /:id/status`(SA,A), `POST /:id/notes`(SA,A), `GET /:id/dashboard`, `GET /:id/related`.

### 2.7 `/api/users` — `modules/users/user.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller | Flag |
|---|---|---|---|---|---|---|---|
| GET `/` | Y | SA, A | `users:read` | role | `query(isActive)` + `validate` | `ctrl.getUsers` | |
| GET `/dashboard` | Y | SA, A | `users:read` | role | — | `ctrl.getDashboard` | |
| GET `/assignable` | Y | STAFF | `users:read` | role | — | `ctrl.getAssignableUsers` | |
| GET `/case-managers` | Y | STAFF | `users:read` | role | — | `ctrl.getCaseManagers` | |
| GET `/presence` | Y | **any** (`:47`) | — | — | — | `ctrl.getPresence` | 🟡 |
| GET `/:id/activity` | Y | STAFF | `users:read` | role | — | `ctrl.getUserActivity` | 🟠 |
| GET `/:id/performance` | Y | STAFF | `users:read` | role | — | `ctrl.getUserPerformance` | 🟠 |
| GET `/:id` | Y | **none** (`:50`) | `users:read` | role | — | `ctrl.getUser` | 🟠 |
| POST `/` | Y | SA, A | `users:create` | role | `createRules` + `validate` | `ctrl.createUser` | |
| PUT `/:id` | Y | SA, A | `users:update` | role | `updateRules` + `validate` | `ctrl.updateUser` | |
| PUT `/:id/status` | Y | SA, A | `users:update` | role | — | `ctrl.updateStatus` | |
| DELETE `/:id` | Y | SA, A | `users:delete` | role | — | `ctrl.deleteUser` | |

> `GET /:id` has no `authorizeRoles`; only `users:read`, which `case_manager` and `team_lead`
> hold — any case manager can read **any** user record including other staff. Portal roles
> lack `users:read`, so they get 403.

### 2.8 `/api/team-members` — `modules/team-management/team-management.routes.js`
Router-level `authenticate` (`:6`) + `authorizeRoles("super_admin","admin","team_lead")` (`:7`). No `express-validator` anywhere.
`GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` → `ctrl.list/create/update/remove`. Scope: role.

### 2.9 `/api/dashboard` — `modules/dashboard/dashboard.routes.js`
18 routes, all `authenticate` + `authorizeRoles` + `authorizePermissions`. Scope: **role** (aggregates are filtered inside `dashboard.controller` by `req.user`).
Notable: `GET /:dashboardType(client|admin|executive)` (`:15`) uses a regex param — no shadowing risk.
`GET /analytics/revenue` and `/analytics/users` are correctly narrowed to manager/admin roles (`:24-25`).
Validation: `body("name")` + `validate` on `POST /saved` (`:39`) and `POST /scheduled-reports` (`:51`); none elsewhere.

### 2.10 `/api/analytics` — `modules/dashboard/analytics.routes.js`
12 GETs, all `authenticate` + `authorizeRoles` + `authorizePermissions("analytics:read"|"dashboard:read")`. `client` is in `analyticsRoles` (`:7`) but lacks `analytics:read` → 403 in practice. Scope: role. No input validation (query params unvalidated).

### 2.11 `/api/reports` — `modules/reports/report.routes.js`
17 routes, all `authenticate` + role + permission gated. Scope: role. **No `express-validator` on any route** — `GET /export/:reportType` (`:21`) and `POST /run` (`:20`) take unvalidated input.

### 2.12 `/api/referrals` — `modules/referrals/referral.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller | Flag |
|---|---|---|---|---|---|---|---|
| GET `/me` | Y | any | — | self | none | `ctrl.getMyReferral` | 🟡 |
| GET `/validate/:code` | Y | any | — | — | none | `ctrl.validateCode` | 🟡 |

### 2.13 `/api/leads` — `modules/leads/lead.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller | Flag |
|---|---|---|---|---|---|---|---|
| POST `/public` | N | — | — | — | `leadRules` (`:8-17`), checked inside `lead.controller.js:15` via `validationFailed` | `ctrl.createPublicLead` | 🔴 |
| POST `/` | N | — | — | — | `ctrl.createLeadRules` (`lead.controller.js:33-45`) + in-controller check; scoped limiter 60/min (`:26-31`) | `ctrl.createLeadFromQuiz` | 🔴 |
| POST `/from-intake` | Y | C, EM, E, B | — | self | `ctrl.fromIntakeRules` (`:78-82`) | `ctrl.createLeadFromIntake` | |

> Note: `POST /public` and `POST /` do **not** use the shared `validate` middleware; the rules
> are enforced by `validationFailed(req,res)` inside the controllers
> (`lead.controller.js:15`, and the equivalent in `createLeadFromQuiz`). Verified — not a bypass.

### 2.14 `/api/audit` **and** `/api/audit-logs` — `modules/audit/audit.routes.js`
Mounted twice (`routes/index.js:16,18`). All 6 routes: `authenticate` + `authorizeRoles("super_admin","admin","team_lead")` + `authorizePermissions("audit:read"|"audit:export")`. Scope: role. No validation.
`GET /summary`, `/export`, `/user/:userId`, `/entity/:entityType/:entityId`, `/:id`, `/`. Ordering is correct (`/:id` at `:13` after the literal paths).

### 2.15 `/api/ai` — `modules/ai/ai.routes.js`
Router-level `authenticate` (`:13`).

| Method + path | Roles | Perms | Scope | Validation | Controller |
|---|---|---|---|---|---|
| POST `/cases/:caseId/copilot` | STAFF+C+U | `ai:create` | **case** (`ai-context.service.js:19` → `getAccessibleCaseOrThrow`) | `:18-19` + `validate` | `controller.copilot` |
| POST `/cases/:caseId/review` | STAFF | `ai:review` | **case** | none | `controller.caseReview` |
| POST `/cases/:caseId/task-suggestions` | STAFF | `ai:create` | **case** | none | `controller.taskSuggestions` |
| POST `/search` | STAFF+C+U | `ai:read` | **case** (`ai-orchestration.service.js:229`) | `:29` + `validate` | `controller.semanticSearch` |
| GET `/jobs` | STAFF+C+U | `ai:read` | role | none | `controller.listJobs` |
| PUT `/jobs/:id/review` | STAFF | `ai:review` | role | `:38` + `validate` | `controller.reviewJob` |
| POST `/jobs/:id/apply-tasks` | STAFF | `ai:review` | role | `:46` + `validate` | `controller.applyTasks` |
| GET `/providers` · PUT `/providers/:key` | SA, A | `ai:update` | role | `:56-57` + `validate` | `controller.providers` / `updateProvider` |
| GET `/prompts` · POST `/prompts` · PUT `/prompts/:id` | SA, A | `ai:update` | role | `:66-70` + `validate` on POST | `controller.prompts` / `createPrompt` / `updatePrompt` |
| GET `/usage` | SA, A | `ai:update` | role | none | `controller.usage` |

### 2.16 `/api/search` — `modules/search/search.routes.js`
All 10 routes: `authenticate` + `authorizePermissions("search:*")` only — **no `authorizeRoles`** (🟡 at route layer). `client` holds `search:*` so all are client-reachable.
Ownership **is** enforced in the service: `search.service.js:547-548,551-552,555-556` scope `SavedSearch` by `owner: user._id` (with `visibility` org/team for `runSaved`). `globalSearch` filters by `req.user`. **Not IDOR.**
No input validation on any route.

### 2.17 `/api/settings` — `modules/settings/settings.routes.js`
`GET /` and `PUT /`: `authenticate` + `authorizeRoles("super_admin","admin")` + `authorizePermissions("settings:read"|"update")`. Scope: role. No validation.

### 2.18 `/api/tasks` — `modules/tasks/task.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller | Flag |
|---|---|---|---|---|---|---|---|
| GET `/stats/dashboard` | Y | **none** | `tasks:read` | self | — | `ctrl.stats` | 🟡 |
| GET `/calendar` | Y | STAFF | `tasks:read` | role | — | `ctrl.calendar` | |
| GET `/my-tasks` | Y | **none** | `tasks:read` | self | — | `ctrl.myTasks` | 🟡 |
| GET `/team-tasks` | Y | SA, A, TL | `tasks:read` | role | — | `ctrl.teamTasks` | |
| PUT `/bulk-status` | Y | SA, A, TL | `tasks:update` | role | — | `ctrl.bulkStatus` | |
| GET `/` | Y | STAFF | `tasks:read` | role | — | `ctrl.list` | |
| GET `/:id` | Y | **none** | `tasks:read` | **self** (`task.controller.js:28` `canAccessTask`, applied at `:159`) | `param(id).isMongoId()` | `ctrl.get` | |
| POST `/` | Y | STAFF | `tasks:create` | role (`:55,:59` self/team constraints) | — | `ctrl.create` | |
| PUT `/:id` | Y | STAFF | `tasks:update` | **self** (`:159`) | `param(id)` | `ctrl.update` | |
| DELETE `/:id` | Y | SA, A | `tasks:delete` | role | `param(id)` | `ctrl.remove` | |
| POST `/:id/comments` | Y | **none** | `tasks:update` | **self** | `param(id)` | `ctrl.addComment` | |

Only route file in the codebase that validates a path param (`:10`).

### 2.19 `/api/canonical` — `modules/canonical/routes/canonicalRoutes.js`
Router-level `authenticate` (`:6`). **No `authorizeRoles` and no `authorizePermissions` on any route** (🟡 at route layer) — but every one of the 11 routes funnels into
`CanonicalProfileService.get` / `rebuild` / `resolveConflict` / `validate` / `history`, each of which calls `canAccessCase` (`CanonicalProfileService.js:121, 129, 170, 211, 308, 359`).
**Scope: case (service-enforced). Not IDOR.** Validation: `validateCaseId` / `validateConflictResolution` (`canonical/validators/canonicalValidators.js`).

Routes: `GET /cases/:caseId/profile`, `POST .../rebuild`, `POST .../validate`, `POST .../conflicts/resolve`, `GET .../history`, `GET .../validation`, `GET .../validation/summary`, `GET .../conflicts`, `GET .../readiness`, `GET .../sources`, `GET .../missing-fields`.

### 2.20 `/api/uscis-forms` **and** `/api/forms` — `modules/uscis-forms/uscis-form.routes.js`
Mounted twice (`routes/index.js:23` and `:27`). 50 declarations → 100 reachable endpoints.

| Group | Roles | Perms | Scope |
|---|---|---|---|
| `GET /`, `GET /registry*`, `GET /:id`, `GET /:id/pdf` | none | `forms:read` | role (global templates) |
| `POST /`, `PUT /:id`, `DELETE /:id` | SA | `forms:create/update/delete` | role |
| `PUT /:id/approve|activate|archive|rollback` | SA, A | `forms:approve/update` | role |
| `GET /sync/history`, `POST /sync`, `POST /check-updates`, `POST /definitions/validate|import` | SA, A | `forms:check_updates`/`forms:create` | role |
| `GET /case`, `GET|POST /case/:caseId`, and **all 30 `/case/:caseId/:formId/**` routes** | none | `forms:read`/`forms:update`/`forms:approve`/`tasks:create` | **case** — `uscis-form.service.js:260` `getAccessibleCase` (call sites `:855, 947, 959, 1001, 1103, 1154, 1184`) and `interactive-form-review.service.js:151` |

**Scope: case-enforced for every case-scoped route.** No `express-validator` on any of the 50.

### 2.21 `/api/uscis/forms` — `modules/uscis-form-import/routes/uscisFormImportRoutes.js`
Router-level `authenticate` (`:21`). Reads gated by `forms:read` **only** (no `authorizeRoles`) → readable by `client`/`employee`/`employer`/`beneficiary`. Resource is a **global form template**, not case data → not an IDOR of case data, but an over-broad read grant.
Writes (`POST /import`, `/upload`, `/:id/activate`, `/:id/retire`, `DELETE /:id/draft`) require SA/A + `forms:create|update|delete`.
Validation: `normalizeImportBody` + `validateSystemImport` on `POST /import` (`:34`); `normalizeImportBody` only on `/upload` (`:35`); multer 50 MB / PDF-only filter (`:9-19`).

### 2.22 `/api/uscis` — `modules/uscis-lifecycle/routes/uscisLifecycleRoutes.js`
Router-level `authenticate` (`:7`). 8 routes. **4 of them are unreachable** — shadowed by the `/uscis/forms` mount above. See `NEGATIVE_WORKFLOW_MATRIX.md` §T3.

| Method + path | Roles | Perms | Reachable? |
|---|---|---|---|
| GET `/forms` | none | `forms:read` | ❌ shadowed |
| GET `/forms/:formType/versions` | none | `forms:read` | ✅ |
| GET `/forms/:formType/compare/:version` | none | `forms:read` | ✅ |
| POST `/forms/import` | SA, A | `forms:create` | ❌ shadowed |
| POST `/forms/scan` | SA, A | `forms:update` | ✅ |
| POST `/forms/:version/approve` | SA, A | `forms:update` | ✅ |
| POST `/forms/:version/activate` | SA, A | `forms:update` | ❌ shadowed |
| POST `/forms/:version/retire` | SA, A | `forms:update` | ❌ shadowed |

### 2.23 `/api/forms` (form-generation) — `modules/form-generation/routes/formGenerationRoutes.js`
Router-level `authenticate` (`:8`).

| Method + path | Roles | Perms | Scope | Controller | Flag |
|---|---|---|---|---|---|
| POST `/packages/generate` | STAFF | `forms:update` | **role only — no `requireCaseFormAccess`** | `controller.generatePackage` | 🟠 |
| GET `/:caseFormId/validation` | STAFF | `forms:read` | **case** (`requireCaseFormAccess`) | `controller.validate` | |
| POST `/:caseFormId/validate` | STAFF | `forms:read` | **case** | `controller.validate` | |
| POST `/:caseFormId/generate` | STAFF | `forms:update` | **case** | `controller.generate` | |
| GET `/:caseFormId/preview` | **none** | `forms:read` | **case** | `controller.preview` | |
| GET `/:caseFormId/download` | **none** | `forms:read` | **case** | `controller.download` | |
| GET `/:caseFormId/draft-pdf` | **none** | `forms:read` | **case** | `controller.draftPdf` | |
| GET `/:caseFormId/filing-pdf` | **none** | `forms:read` | **case** | `controller.filingPdf` | |
| POST `/:caseFormId/approve` | SA, A, TL | `forms:approve` | **case** | `controller.approve` | |
| POST `/:caseFormId/regenerate` | STAFF | `forms:update` | **case** | `controller.regenerate` | |

No `express-validator` anywhere in this file.

### 2.24 `/api/leaderboard` — `modules/leaderboard/leaderboard.routes.js`
`GET /` and `POST /calculate`: `authenticate` + `authorizeRoles("super_admin","admin","team_lead")`. **No permission gate, no validation.** Scope: role.

### 2.25 `/` (case-collaboration) — `modules/case-collaboration/routes/collaborationRoutes.js`
Mounted at the **API root** (`routes/index.js:29`), so its paths are `/api/cases/:caseId/...`.
All 6 routes carry `authenticate` + `authorizePermissions` (+ `authorizeRoles` on writes).
Scope: **case** — `CollaborationService.js:17` `canAccessCase`.

`GET /cases/:caseId/timeline` (`cases:read`), `POST .../comments` (`messages:create`), `POST .../tasks` (STAFF+paralegal, `tasks:create`), `POST .../requests` (`documents:create`), `GET .../readiness` (`cases:read`), `POST .../assignments` (STAFF, `cases:assign`).

> `GET /api/cases/:caseId/timeline` **shadows** `case.routes.js:118`. See §T3.
> Note `"paralegal"` (`:9,:10`) is **not** a canonical role (`roleHierarchy.js:1-13`) and has no
> `ROLE_PERMISSIONS` entry — a dead role name in the allow-list.

### 2.26 `/api/cases` — `modules/cases/case.routes.js` (52 declarations)

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller | Flag |
|---|---|---|---|---|---|---|---|
| GET `/my` | Y | any | — | self | — | `getMyCase` | 🟡 |
| GET `/config` | Y | none | `cases:read` | — | — | `getCaseConfig` | |
| GET `/dashboard/stats` | Y | none | `cases:read` | self-filtered | — | `getDashboardStats` | |
| GET `/dashboard/team-lead` | Y | SA,A,TL | `cases:read` | role | — | `getTeamLeadDashboard` | |
| GET `/dashboard/needs-attention` | Y | SA,A,TL | `cases:read` | role | — | `getNeedsAttention` | |
| GET `/dashboard/recent-activity` | Y | SA,A,TL | `cases:read` | role | — | `getRecentActivity` | |
| POST `/bulk` | Y | STAFF | `cases:update` | **case, per id** (`case.service.js:657`) | — | `bulkActions` | ⚠ role-escalation, see §T4.8 |
| GET `/` | Y | none | `cases:read` | **filtered** (`applyCaseRoleFilter` `case.service.js:128-142`) | — | `getCases` | |
| POST `/` | Y | SA,A,TL | `cases:create` | n/a | `:27-36` + `validate` | `createCase` | |
| POST `/create-with-client` | Y | STAFF | `cases:create` | n/a | `:45-54` + `validate` | `createCaseWithClient` | |
| GET `/:id/addons` | Y | none | `cases:read` | **case** (`:474` `getAuthorizedCase`) | — | `getAvailableAddons` | |
| POST `/:id/addons/:addonKey/purchase` | Y | none | `payments:create` | **case** (`:492`) | — | `purchaseAddon` | |
| GET `/:id` | Y | none | `cases:read` | **case** (`:660`) | — | `getCase` | |
| PUT `/:id` | Y | STAFF | `cases:update` | **case** (`:1242`) | — | `updateCase` | |
| DELETE `/:id` | Y | SA, A | `cases:delete` | **role only** (`:2379-2387`, no `canAccessCase`) | — | `archiveCase` | |
| PUT `/:id/stage` | Y | STAFF | `cases:update` | **case** (`:1353`) | — | `updateCaseStage` | |
| POST `/:id/notes` | Y | STAFF | — | **case** (`:1384`) | `body(note)` + `validate` | `addInternalNote` | |
| POST `/:id/external-notes` | Y | any | — | **case** (`:1402`) | `body(note)` + `validate` | `addExternalNote` | |
| PUT `/:id/assign-case-manager` | Y | SA,A,TL | `cases:assign` | **case** (`:1420` `canAssignCase`) | `:77-79` + `validate` | `assignCaseManager` | |
| PUT `/:id/assign-team-lead` | Y | SA,A,TL | `cases:assign` | **case** (`:1490`) | — | `assignTeamLead` | |
| PUT `/:id/ownership` | Y | SA,A,TL | `cases:assign` | **case** (`:1526`) | — | `transferOwnership` | |
| POST `/:id/reassign` | Y | SA,A,TL | `cases:assign` | **case** (`:1420`) | `:93-94` + `validate` | `assignCaseManager` | |
| GET `/:id/assignment-history` | Y | STAFF | `cases:read` | **case** (`:1562`) | — | `getAssignmentHistory` | |
| PATCH `/:principalId/data-entry-mode` | Y | any | — | **case** (`:1602-1617`) | — | `setDataEntryMode` | 🟡 |
| POST `/:principalId/invite-employee` | Y | any | — | **case** (`:1668`) | — | `inviteEmployee` | 🟡 |
| PATCH `/:caseId/remove-employee` | Y | any | — | **case** (`:1813`) | — | `removeEmployee` | 🟡 |
| PUT `/:id/assign-beneficiary` | Y | STAFF | `cases:assign` | **case** (`:1948`) | `body(beneficiaryId)` + `validate` | `assignBeneficiary` | |
| PUT `/:id/assign-company` | Y | STAFF | `cases:assign` | **case** (`:1965`) | `body(companyId)` + `validate` | `assignCompany` | |
| PUT `/:id/assign-client` | Y | STAFF | `cases:assign` | **case** (`:1982`) | `body(clientId)` + `validate` | `assignClient` | |
| POST `/:id/linked-cases` | Y | STAFF | `cases:update` | **case** (`:1999`) | `body(linkedCaseId)` + `validate` | `linkCase` | |
| GET `/:id/related` | Y | none | `cases:read` | **case** (`:2009`) | — | `getRelated` | |
| GET `/:id/timeline` | Y | none | `cases:read` | **case** (`:2034`) | — | `getTimeline` | **shadowed** |
| GET `/:id/workflow` | Y | none | `cases:read` | **case** (`case-lifecycle-orchestrator.service.js:221`) | — | `getCaseWorkflow` | |
| GET `/:id/knowledge-plan` | Y | none | `cases:read` | **case** (`:1899`) | — | `getKnowledgePlan` | |
| POST `/:id/workflow/recalculate` | Y | STAFF | `cases:update` | **case** (`orchestrator:221`) | — | `recalculateCaseWorkflow` | |
| POST `/:id/knowledge-plan/refresh` | Y | STAFF | `cases:update` | **case** (`immigration-knowledge-engine.service.js:496`) | — | `refreshKnowledgePlan` | |
| POST `/:id/workflow/generate-forms` | Y | STAFF | `forms:update` | **case** (`orchestrator:437`) | — | `generateCaseForms` | |
| POST `/:id/workflow/generate-package` | Y | SA,A,CM | `forms:update` | **case** (`orchestrator:532`) | — | `generateCasePackage` | |
| POST `/:id/workflow/generate-word-package` | Y | SA,A,CM | `forms:update` | **case** (`PetitionWordPackageService.js:182`) | — | `generateCaseWordPackage` | |
| PUT `/:id/reopen` | Y | STAFF | `cases:update` | **NONE** (`:2390-2399`) | — | `reopenCase` | 🟠 |
| POST `/:id/document-references` | Y | STAFF | — | **case** (`:2185`) | `body(documentId)` + `validate` | `addDocumentReference` | |
| POST `/:id/uscis-form-references` | Y | STAFF | — | **NONE** (`:2197-2211`) | `body(refId)` + `validate` | `addUSCISFormReference` | 🟠 |
| POST `/:id/questionnaire-references` | Y | STAFF | — | **case** (`:2217`) | — | `addQuestionnaireReference` | |
| POST `/:id/send-questionnaire` | Y | STAFF | — | **case** (`:2058`) | — | `sendQuestionnaire` | |
| POST `/:id/submit-questionnaire` | Y | any | — | **case** (`:2093`) | — | `submitQuestionnaire` | 🟡 |
| POST `/:id/approve-questionnaire` | Y | STAFF | — | **NONE** (`:2115-2137`) | — | `approveQuestionnaire` | 🟠 |
| POST `/:id/request-documents` | Y | STAFF | — | **case** (`:2143`) | — | `requestDocuments` | |
| POST `/:id/checklist/:idx/upload` | Y | any | — | **case** (`:2242`) | multer (`:365-372`) | `uploadChecklistFile` | 🟡 |
| PUT `/:id/checklist/:idx` | Y | STAFF | — | **NONE** (`:2282-2302`) | — | `updateChecklistItem` | 🟠 |
| POST `/:id/checklist/generate` | Y | STAFF | — | **NONE** (`:2304-2320`) | — | `generateCaseChecklist` | 🟠 |
| PUT `/:id/plan` | Y | any | — | **case** (`:2329`) | — | `updatePlan` | 🟡 |
| PUT `/:id/assessment` | Y | any | — | **case** (`:2363`) | — | `saveAssessment` | 🟡 |

### 2.27 `/api/cases` (auto-fill) — `modules/form-mapping/routes/autoFillRoutes.js`
Router-level `authenticate` (`:6`). **No `authorizeRoles` on any route.**
`grep -rn "canAccessCase\|403" Backend/src/modules/form-mapping/` returns **zero matches** —
neither `AutoFillController` nor any service under `form-mapping/` performs a case-access check.

| Method + path | Perms | Scope | Controller | Flag |
|---|---|---|---|---|
| POST `/:caseId/forms/:formType/autofill` | `forms:update` | **NONE** | `controller.autofill` | 🟠 |
| GET `/:caseId/forms/:formType/preview` | `forms:read` | **NONE** | `controller.preview` | 🟠 |
| GET `/:caseId/forms/:formType/validation` | `forms:read` | **NONE** | `controller.validation` | 🟠 |
| POST `/:caseId/forms/:formType/regenerate` | `forms:update` | **NONE** | `controller.regenerate` | 🟠 |
| POST `/:caseId/forms/:formType/refresh` | `forms:update` | **NONE** | `controller.refresh` | 🟠 |
| POST `/:caseId/forms/:formType/repopulate-fields` | `forms:update` | **NONE** | `controller.repopulateFields` | 🟠 |
| POST `/:caseId/forms/:formType/reset-auto-filled` | `forms:update` | **NONE** | `controller.resetAutoFilledFields` | 🟠 |
| POST `/:caseId/forms/:formType/rollback/:versionNumber` | `forms:update` | **NONE** | `controller.rollback` | 🟠 |
| PATCH `/:caseId/forms/:formType/fields/:fieldId/override` | `forms:update` | **NONE** | `controller.overrideField` | 🟠 |
| PATCH `/:caseId/forms/:formType/fields/:fieldId/review` | `forms:update` | **NONE** | `controller.reviewField` | 🟠 |

> `forms:read` is held by `client`/`employee`/`employer`/`beneficiary`, so
> **`GET /api/cases/<any caseId>/forms/<formType>/preview` returns another case's
> auto-filled USCIS field values to any logged-in portal user.**

### 2.28 `/api/form-mappings` — `modules/form-mapping/routes/mappingGraphRoutes.js`
Router-level `authenticate` (`:6`). 9 routes, `authorizePermissions("forms:read"|"forms:update")` only, **no `authorizeRoles`**. Resource is a global `USCISFormTemplate`/mapping version, not case data.
`forms:read` reads are open to all portal roles (over-broad but not case-PII). `forms:update` writes require `case_manager`+.
`POST /templates/:templateId/generate|validate|activate`, `GET /templates/:templateId/preview|search|versions`, `GET /templates/:templateId/compare/:otherTemplateId`, `PUT /templates/:templateId/mappings/:targetFieldId`, `DELETE /templates/:templateId/mappings/:mappingId`. No validation.

### 2.29 `/api/case-managers` — `modules/cases/case-manager.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Controller | Flag |
|---|---|---|---|---|---|---|
| GET `/` | Y | STAFF | `users:read` | role | `getCaseManagers` | |
| GET `/analytics-panel` | Y | STAFF | `cases:read` | role | `getCaseManagerAnalyticsPanel` | |
| GET `/:id` | Y | STAFF | `users:read` | role | `getCaseManagerDetails` | 🟠 |
| GET `/:id/cases` | Y | STAFF | `cases:read` | role | `getCaseManagerCases` | 🟠 |
| GET `/:id/activities` | Y | STAFF | `cases:read` | role | `getCaseManagerActivities` | 🟠 |
| GET `/:id/payments` | Y | STAFF | `cases:read` | role | `getCaseManagerPayments` | 🟠 |
| GET `/:id/analytics` | Y | STAFF | `cases:read` | role | `getCaseManagerAnalytics` | 🟠 |

> `case_manager` is in `staffRoles` (`:7`), so **any case manager can enumerate any other case
> manager's full case list, activity log, payments and performance analytics** by id.

### 2.30 `/api/employment-workflow` — `modules/employment-workflow/employment-workflow.routes.js`
14 routes. Ownership enforced by `canAccessEmployerCase` inside `employment-workflow.controller.js`.

| Method + path | Roles | Perms | Scope | Validation |
|---|---|---|---|---|
| GET `/me` | EM, E, C | — | self | — |
| PUT `/company` | EM, C | `companies:update` | case | — |
| POST `/cases` | STAFF | `cases:create` | n/a | `:21-22` + `validate` |
| POST `/:id/invite-employee` | EM, C, A, SA, TL, CM | — | case | `:30-32` + `validate` |
| GET `/:id/participants` | EM, E, C, A, SA, TL, CM | — | case | — |
| POST `/:id/participants/employees` | EM, C, A, SA, TL, CM | `cases:update` | case | `:42-43` + `validate` |
| POST `/:id/participants/:participantId/decline` | EM, E, C | — | case | — |
| DELETE `/:id/participants/:participantId` | EM, C, A, SA, TL, CM | `cases:update` | case | — |
| POST `/:id/participants/:participantId/replace` | EM, C, A, SA, TL, CM | `cases:update` | case | `body(email)` + `validate` |
| POST `/:id/resend-employee-invite` | EM, C, A, SA, TL, CM | — | case | — |
| PUT `/:id/job` | EM, C | `cases:update` | case | — |
| PUT `/:id/employee-questionnaire` | EM, E, C | `questionnaires:update` | case | — |
| POST `/:id/submit` | EM, E, C | — | case | — |
| POST `/:id/requests` | STAFF | `cases:update` | case | — |

### 2.31 `/api/employer-profile` — `modules/employer-profile/employer-profile.routes.js`
`authenticate` only at route layer (🟡); service-enforced.

| Method + path | Scope | Enforcement | Flag |
|---|---|---|---|
| GET `/summary/me` | self | `employer-profile.service.js:69-71` — restricted roles only, own child case | |
| GET `/:principalCaseId` | **case** | `canRead` (`:49-55`) — `employee`/`beneficiary` **denied**, staff allowed, otherwise `user.caseIds` must contain the id | |
| POST `/:principalCaseId` | **case** | `canWrite` (`:57-60`) — staff allowed, otherwise `user.caseIds` must contain the id. **Missing the `RESTRICTED_PORTAL_ROLES` denial that `canRead` has** | ⚠ asymmetry |

### 2.32 `/api/employee-profile` — `modules/employee-profile/employee-profile.routes.js`
`authenticate` only at route layer (🟡); service-enforced by `canAccess` (`employee-profile.service.js:34-45`), which checks `caseIds` membership **and** `caseRole === user.role` **and** `parentCase === user.principalCaseId`.
`GET /:caseId` (`:44` call), `POST /:caseId` (`:60` call). Field-path validation via `validateFieldPaths` (`:63`). **Correctly scoped.**

### 2.33 `/api/family-workflow` — `modules/family-workflow/family-workflow.routes.js`
| Method + path | Roles | Scope | Validation |
|---|---|---|---|
| GET `/me` | C, B | self | — |
| POST `/cases` | STAFF | n/a | `:18-19` + `validate` |
| POST `/:id/invite-beneficiary` | C, A, SA, TL, CM | case (`family-workflow.controller.js` `canAccessCase`) | `:27-29` + `validate` |
| POST `/:id/submit` | C, B | case | — |

### 2.34 `/api/single-party-filings` — `modules/single-party-filings/single-party-filing.routes.js`
`GET /types` — `authenticate` only (🟡). `POST /cases` — STAFF + `cases:create`, `:20-23` + `validate`.

### 2.35 `/api/documents` — `modules/documents/document.routes.js` (34 routes)
Ownership enforced by `documentService.canAccessDocument` (`document.service.js:59-76`), which delegates to `canAccessCase` for case-linked documents (`:71-73`). `DELETE /:id` (`:78`, `authenticate` only 🟡) is enforced in-controller at `document.controller.js:303-323` (owner/uploader + `canModifyDocument`). **All document routes are resource-scoped.**
Validation: `body(originalName|mimeType|expectedSize|caseId)` + `validate` on `POST /uploads/sessions` (`:30-34`); `body(documentType|category)` + `validate` on `POST /upload` (`:47-49`) and `POST /` (`:58-60`). Uploads via `modules/uploads/upload.middleware`.

### 2.36 `/api/document-intelligence` — `modules/document-intelligence/document-intelligence.routes.js` (27 routes)
All `authenticate` + `authorizeRoles` + (mostly) `authorizePermissions("document_intelligence:*")`.
Ownership: `canAccessExtraction` (`services/document-intelligence.service.js:156`) and `canAccessAnalysis` (`:162`), and `canAccessCase` for the `/case/:caseId/*` prefill routes (`controllers/document-intelligence.controller.js`).
Note `GET /case/:caseId/prefill-summary` (`:50`) and `POST /case/:caseId/masterdata-field/:prefillId/:action` (`:51`) carry **no `authorizePermissions`** — role gate + in-controller `canAccessCase` only. No `express-validator` on any route.

### 2.37 `/api/petition-intelligence` — `modules/petition-intelligence/petition-intelligence.routes.js`
`GET /cases/:caseId` and `POST /cases/:caseId/generate`: STAFF + `ai:read`/`ai:create`; scope **case** (`petition-intelligence.service.js` `canAccessCase`). `POST` validated at `:18-20` + `validate`.

### 2.38 `/api/petition` — `modules/petition/petition.routes.js` 🟠 **module-wide IDOR**
Router-level `authenticate` (`:13`). `grep -rn "canAccessCase" Backend/src/modules/petition/` returns exactly **one** hit: `services/PetitionAssemblyService.js:231`, reached only by `assemble`.

| Method + path | Roles | Perms | Scope | Controller | Flag |
|---|---|---|---|---|---|
| POST `/cases/:caseId/assemble` | STAFF | `forms:update` | **case** (`:231`) | `assemble` (`petition.controller.js:11`) | |
| GET `/cases/:caseId/packages` | **none** | `forms:read` | **NONE** — raw `PetitionPackage.find({caseId})` (`petition.controller.js:20-27`) | `listPackages` | 🟠 |
| GET `/packages/:id` | **none** | `forms:read` | **NONE** — raw `findById` (`:29-37`) | `getPackage` | 🟠 |
| GET `/packages/:id/validation` | **none** | `forms:read` | **NONE** | `getValidation` (`:39`) | 🟠 |
| GET `/packages/:id/preview` | **none** | `forms:read` | **NONE** | `preview` (`:59`) | 🟠 |
| GET `/packages/:id/download` | **none** | `forms:read` | **NONE** | `download` (`:74`) | 🟠 |
| PATCH `/packages/:id/letters/:sectionKey` | STAFF | `forms:update` | **NONE** | `saveLetter` (`:90`) | 🟠 |
| PATCH `/packages/:id/exhibits/order` | STAFF | `forms:update` | **NONE** | `reorderExhibits` (`:99`) | 🟠 |
| POST `/packages/:id/finalize` | SA, A, TL | `forms:approve` | **NONE** | `finalize` (`:108`) | 🟠 |
| POST `/packages/:id/unlock` | SA, A, TL | `forms:approve` | **NONE** | `unlock` (`:117`) | 🟠 |
| POST `/packages/:id/filing` | STAFF | `forms:update` | **NONE** | `recordFiling` (`:126`) | 🟠 |
| POST `/packages/:id/receipt` | STAFF | `forms:update` | **NONE** | `recordReceipt` (`:135`) | 🟠 |
| GET `/definitions` · GET/PUT `/definitions/:key` | SA, A | `forms:read/update` | role (global) | `listDefinitions`/`getDefinition`/`upsertDefinition` | |

> **`GET /api/petition/packages/:id/download` is gated only by `forms:read`, which `client`,
> `employee`, `employer` and `beneficiary` all hold.** The assembled petition package
> (support letters, exhibits, filing data) of any case is downloadable by any logged-in
> portal user who can guess or enumerate a package id.

### 2.39 `/api/eligibility` — `modules/eligibility-engine/routes/eligibilityRoutes.js` 🟠 **module-wide IDOR**
Router-level `authenticate` (`:7`). `grep -rn "canAccessCase\|403" Backend/src/modules/eligibility-engine/` returns **zero matches**.

| Method + path | Roles | Perms | Scope | Controller | Flag |
|---|---|---|---|---|---|
| POST `/evaluate` | none | `cases:read` | **NONE** (`EligibilityController.js:19`) | `controller.evaluate` | 🟠 |
| GET `/:caseId/results` | none | `cases:read` | **NONE** | `controller.results` | 🟠 |
| GET `/:caseId/gaps` | none | `cases:read` | **NONE** | `controller.gaps` | 🟠 |
| GET `/:caseId/recommendations` | none | `cases:read` | **NONE** | `controller.recommendations` | 🟠 |
| POST `/:caseId/recalculate` | none | `cases:update` | **NONE** | `controller.recalculate` | 🟠 |
| POST `/:caseId/override` | SA, A, `attorney`* | `cases:update` | **NONE** (`:61`) | `controller.override` | 🟠 |

\* `"attorney"` is not a canonical role (`roleHierarchy.js:1-13`) — dead entry.
`cases:read` is held by **every** role including `client`, `employee`, `beneficiary`.

### 2.40 `/api/lifecycle` — `modules/immigration-lifecycle/routes/lifecycleRoutes.js`
12 routes, all `authenticate` + `authorizePermissions("cases:read"|"cases:update")`, writes also `authorizeRoles`. Scope: **case** — `controllers/LifecycleController.js` calls `canAccessCase`.
Note the role lists (`:7-8`) include the non-canonical `"attorney"` and `"paralegal"`.
No `express-validator` anywhere.

### 2.41 `/api/notifications` — `modules/notifications/notification.routes.js` (26 routes)
All `authenticate` + `authorizePermissions("notifications:*")`; admin-only routes also `authorizeRoles("super_admin","admin")`.
Per-resource scope: `findNotification(req.params.id, req.user)` (`notification.controller.js:100` and siblings) scopes by recipient. **Not IDOR.**
Validation + `validate`: `PUT /mark-many-read` (`:20`), `POST /register-device` (`:31`), `DELETE /unregister-device` (`:39`), `POST /events` (`:51`), `POST /templates` (`:64-67`), `POST /` (`:79-80`), `POST /roles` (`:89-91`).

### 2.42 `/api/messages` — `modules/messages/message.routes.js` (20 routes)
All `authenticate` + `authorizePermissions("messages:*")`; most also `authorizeRoles(...messageRoles)` (`:10` — note `beneficiary` is **absent** from `messageRoles`, so beneficiaries 403 on messaging).
Scope: `canAccessConversation` (`message.service.js:91`) / `canAccessMessage` (`:107`), both delegating to `canAccessCase`. **Not IDOR.**
Route order: `GET /case/:caseId` (`:12`), `/unread-count`, `/search`, `/analytics/summary`, `/templates`, `/conversations/:id` all precede the catch-all `GET /:threadId` (`:41`) — correct.
Validation: `body(message|messageBody)` + `validate` on `POST /` (`:29-31`). `POST /:threadId` (`:42-49`) has **none**.

### 2.43 `/api/appointments` — `modules/appointments/appointment.routes.js`

| Method + path | Auth | Roles | Perms | Scope | Validation | Controller | Flag |
|---|---|---|---|---|---|---|---|
| POST `/public` | **N** | — | — | — | `publicRules` (`:11-15`), checked in `appointment.controller.js:31` | `createPublicAppointment` | 🔴 |
| POST `/` | **N** | — | — | — | `publicRules`, checked at `:31` | `createPublicAppointment` | 🔴 |
| GET `/my` | Y | none | `appointments:read` | self | — | `getMyAppointments` | |
| GET `/calendar` · `/availability` · `/dashboard` | Y | STAFF+C+U | `appointments:read` | role | — | | |
| POST `/reminders/send-due` | Y | SA, A | — | role | — | `sendDueReminders` | |
| POST `/sync/:provider` | Y | STAFF | `calendar:sync` | role | — | `syncCalendar` | |
| POST `/schedule` | Y | STAFF+C+U | `appointments:create` | self | `createRules` (`:17-21`), checked at `:41` | `createAppointment` | |
| GET `/` | Y | STAFF+C+U | `appointments:read` | filtered (`buildAppointmentFilter`) | — | `getAppointments` | |
| GET `/:id` · PUT `/:id/reschedule` · `/:id/cancel` | Y | STAFF+C+U | `appointments:read/update` | **self** (`appointment.service.js:48` `canAccessAppointment`) | | | |
| PUT `/:id` · `/:id/status` | Y | STAFF | `appointments:update` | self | `createRules` / `body(status)` | | |
| DELETE `/:id` | Y | SA, A | `appointments:delete` | role | — | `cancelAppointment` | |

> **`POST /api/appointments` (the bare collection route) is unauthenticated.** Any anonymous
> caller can create an appointment record. `POST /public` is the intended public route;
> `:24` duplicates it on the collection path.

### 2.44 `/api/calendar` — `modules/calendar/calendar.routes.js` (14 routes)
All `authenticate` + `authorizeRoles` + `authorizePermissions("calendar:*")`. Scope: role, except `PUT /availability/me` (`:28`, self) and `PUT /availability/:userId` (`:29`, manager roles → 🟠 any manager can overwrite any user's availability).
Validation + `validate`: `POST /events` (`:19-21`), `POST /resources` (`:37`), `PUT /integrations` (`:49`).

### 2.45 `/api/payments` — `modules/payments/payment.routes.js` (24 routes)
Scope: `canAccessPayment` (`payment.service.js:44`) → `canAccessCase`. **Not IDOR.**
Scoped limiter `checkoutLimiter` 10/min (`:13-19`) on `create-partial-checkout-session` and `confirm-checkout-session`.
Validation + `validate`: `:27-30`, `:39`, `:58-60`, `:72-74`.
`POST /api/payments/webhook/stripe` is registered **outside** this router in `app.js:64` with `express.raw` and **no authentication** (Stripe signature verification inside `paymentController.handleStripeWebhook`) 🔴.

### 2.46 `/api/billing` — `modules/billing/billing.routes.js`
6 GETs, `authenticate` + `authorizeRoles(SA,A,TL | SA,A)` + `authorizePermissions("billing:*")`. Scope: role. No validation.

### 2.47 `/api/workflows` — `modules/workflows/workflow.routes.js` (22 routes)
All `authenticate` + `authorizeRoles` + `authorizePermissions("workflows:*")`. Scope: role, except `POST /cases/:caseId/start` (`:27`) which is STAFF + `workflows:create` — **no case-access check at the route layer** 🟠 (verify `workflow.controller.startCaseWorkflow`). No validation anywhere.

### 2.48 `/api/questionnaires` — `modules/questionnaires/questionnaire.routes.js` (45 routes)
All `authenticate` + `authorizeRoles` + `authorizePermissions("questionnaires:*")`.
Scope: `canAccessResponse` (`questionnaire.service.js:81-90`) and `canAccessCase` at `:727, 1117, 1996, 2255, 2318-2322, 2372`. Definition-level routes (`/:id/*` on a questionnaire template) are role-gated only, which is correct — templates are global.
Route order is correct: `/library`, `/question-library*`, `/defaults*`, `/case/:caseId*`, `/responses/:responseId*` all precede `GET /:id` (`:29`).
**No `express-validator` on any of the 45 routes.**

### 2.49 `/api/eligibility-quiz/admin` — `modules/eligibility-quiz/admin/quizAdmin.routes.js`
Router-level `authenticate, authorizeRoles("super_admin","admin"), authorizePermissions("eligibility_quiz:admin")` (`:7`). 8 routes, scope role, no validation.

### 2.50 `/api/eligibility-quiz` — `modules/eligibility-quiz/quiz.routes.js`

| Method + path | Auth | Roles | Perms | Validation | Controller | Flag |
|---|---|---|---|---|---|---|
| GET `/definition` | **N** | — | — | limiter 60/min (`:13-18`) | `ctrl.getDefinition` | 🔴 |
| GET `/visas` | **N** | — | — | limiter | `ctrl.getVisas` | 🔴 |
| POST `/submit` | **opt** | — | — | `submitRules` (`:20-27`) + `validate` + limiter | `ctrl.submit` | 🔴 |
| GET `/leads` · `/leads/:id` · POST `/leads/:id/seen` | Y | SA, A | `leads:read` | — | | |
| PATCH `/leads/:id/status` · `/assign` · POST `/leads/:id/notes` | Y | SA, A | `leads:update` | — | | |
| PATCH `/leads/:id/confirm-consultation` · `/complete-consultation` · `/approve` · `/reject` | Y | SA, A | `leads:update` | — | state-machine transitions (`quiz.service.js:263-315`) | |

### 2.51 `/api/consultation-routing` — `modules/consultation-routing/routing.routes.js`
`GET /options` 🔴, `POST /book` 🔴 (both `publicLimiter` 60/min, `:8-13`, **no validation**).
`GET /queue`, `POST /queue/:id/claim`: `authenticate` + STAFF + `consultation_routing:read|update`.

### 2.52 `/api/consultation` — `modules/consultation/consultation.routes.js`
`GET /config` 🔴, `GET /slots` 🔴, `POST /book` 🔴, `GET /booking/:token` 🔴, `POST /booking/:token/reschedule` 🔴, `POST /booking/:token/cancel` 🔴 — all `publicLimiter` only, **no validation**. Booking mutations are gated by an opaque `:token` (capability URL).
`GET|PUT /admin/availability`: `authenticate` + SA/A + `consultation_routing:read|update`.

### 2.53 `/api/compliance` — `modules/compliance/compliance.routes.js`
`GET /disclaimer` 🔴 (no auth, no limiter). `POST /disclaimer/accept` 🔴 (`softAuthenticate` `:15-28`, no limiter, no validation).
`POST /lint`: `authenticate` + STAFF + `compliance:lint`.

### 2.54 `/api/entity-config` — `modules/entity-config/entityConfig.routes.js`
`GET /public` 🔴 (no auth, no limiter). `GET /status-vocabulary` — `authenticate` only 🟡.
`GET /` · `PATCH /` — SA/A + `entity_config:read|update`. No validation.

### 2.55 `/api/data-rights` — `modules/data-rights/dataRights.routes.js`
Router-level `authenticate` (`:7`).
`POST /requests` (C, A, SA + `data_rights:create`), `GET /requests` (SA, A + `data_rights:read`), `POST /requests/:id/approve|reject` (SA, A).
`GET /requests/:id/export` (`:15`) — **`authenticate` only** 🟡; ownership enforced in `dataRights.service.getExportArtifact` per the comment at `:13-14`. No validation.

### 2.56 `/api/telemetry` — `modules/telemetry/telemetry.routes.js`
`POST /track` 🔴 (`trackLimiter` 60/min, `:11-16`, no validation).
`GET /summary`: `authenticate` + SA/A/CM + `telemetry:read`.

---

## 3. Flagged routes

### 3.1 Unauthenticated endpoints (33)

| # | Endpoint | File:line | Rate limit | Notes |
|---|---|---|---|---|
| 1-12 | `POST /api/auth/register`, `/login`, `/google-token`, `GET /auth/google`, `/auth/google/callback`, `POST /auth/refresh`, `/forgot-password`, `/reset-password`, `/verify-email`, `GET /auth/invite/:token`, `POST /auth/invite/:token/accept`, `/resend-invite` | `auth.routes.js:12,46,47,50,51,52,72,73,74,77,78,88` | global 300/15m only | **No per-route limiter on `/login`, `/forgot-password`, `/reset-password` or `/resend-invite`** — the global 300/15m is the only brute-force brake |
| 13 | `POST /api/leads/public` | `lead.routes.js:19` | global only | |
| 14 | `POST /api/leads` | `lead.routes.js:36` | 60/min | |
| 15 | `POST /api/appointments/public` | `appointment.routes.js:23` | global only | |
| 16 | **`POST /api/appointments`** | `appointment.routes.js:24` | global only | Unauthenticated write on the collection route |
| 17-19 | `GET /api/eligibility-quiz/definition`, `/visas`, `POST /submit` | `quiz.routes.js:29,30,35` | 60/min | `/submit` uses `optionalAuthenticate` |
| 20-21 | `GET /api/consultation-routing/options`, `POST /book` | `routing.routes.js:15,16` | 60/min | no input validation |
| 22-27 | `GET /api/consultation/config`, `/slots`, `POST /book`, `GET /booking/:token`, `POST /booking/:token/reschedule`, `/cancel` | `consultation.routes.js:15-20` | 60/min | token-capability URLs; no validation |
| 28-29 | `GET /api/compliance/disclaimer`, `POST /disclaimer/accept` | `compliance.routes.js:30,31` | global only | |
| 30 | `GET /api/entity-config/public` | `entityConfig.routes.js:10` | global only | |
| 31 | `POST /api/telemetry/track` | `telemetry.routes.js:18` | 60/min | |
| 32 | `GET /api/health` | `app.js:70` | global only | |
| 33 | `POST /api/payments/webhook/stripe` | `app.js:64` | global only | Stripe signature verified in controller |

### 3.2 Authenticated with no route-layer role/permission gate (14)

| Endpoint | File:line | Real enforcement | Verdict |
|---|---|---|---|
| `GET /api/users/presence` | `user.routes.js:47` | none (deliberate, per comment `:43-46`) | Acceptable — boolean + timestamp |
| `GET /api/referrals/me`, `GET /api/referrals/validate/:code` | `referral.routes.js:5,6` | self-scoped in controller | Acceptable |
| `GET /api/cases/my` | `case.routes.js:14` | self-scoped | Acceptable |
| `PATCH /api/cases/:principalId/data-entry-mode`, `POST /:principalId/invite-employee`, `PATCH /:caseId/remove-employee`, `POST /:id/external-notes`, `POST /:id/submit-questionnaire`, `POST /:id/checklist/:idx/upload`, `PUT /:id/plan`, `PUT /:id/assessment` | `case.routes.js:110,111,112,71,132,136,140,141` | `canAccessCase` in-controller (`:1602,1668,1813,1402,2093,2242,2329,2363`) | Acceptable — case-scoped |
| `GET|POST /api/employer-profile/:principalCaseId`, `GET|POST /api/employee-profile/:caseId` | `employer-profile.routes.js:12,13`, `employee-profile.routes.js:8,9` | `canRead`/`canWrite`/`canAccess` in service | Acceptable |
| `GET /api/entity-config/status-vocabulary` | `entityConfig.routes.js:14` | none | Acceptable — static vocabulary |
| `GET /api/data-rights/requests/:id/export` | `dataRights.routes.js:15` | `getExportArtifact` service check | Acceptable |
| `GET /api/single-party-filings/types` | `single-party-filing.routes.js:14` | none | Acceptable — static config |
| All of `/api/canonical/*` (11) | `canonicalRoutes.js:8-18` | `canAccessCase` in `CanonicalProfileService` | Acceptable |
| All of `/api/search/*` (10) | `search.routes.js:6-15` | owner-scoped queries | Acceptable |

**Net: 0 endpoints are authenticated-but-completely-ungated.**

### 3.3 IDOR-prone endpoints (43) — role-gated, resource is case/user-scoped, **no per-resource check anywhere**

| # | Endpoint | File:line (route) | File:line (missing check) | Who can exploit |
|---|---|---|---|---|
| 1 | `POST /api/eligibility/evaluate` | `eligibilityRoutes.js:9` | `EligibilityController.js:19` (no check) | any role (`cases:read`) |
| 2 | `GET /api/eligibility/:caseId/results` | `eligibilityRoutes.js:10` | module has zero `canAccessCase` | any role |
| 3 | `GET /api/eligibility/:caseId/gaps` | `:11` | same | any role |
| 4 | `GET /api/eligibility/:caseId/recommendations` | `:12` | same | any role |
| 5 | `POST /api/eligibility/:caseId/recalculate` | `:13` | same | `cases:update` = client, employer, CM+ |
| 6 | `POST /api/eligibility/:caseId/override` | `:14` | same | SA, A |
| 7-16 | all 10 `/api/cases/:caseId/forms/:formType/*` auto-fill routes | `autoFillRoutes.js:8-17` | `form-mapping/` has zero `canAccessCase` | `forms:read` = every portal role; `forms:update` = CM+ |
| 17 | `GET /api/petition/cases/:caseId/packages` | `petition.routes.js:16` | `petition.controller.js:20-27` | every portal role |
| 18 | `GET /api/petition/packages/:id` | `:18` | `petition.controller.js:29-37` | every portal role |
| 19 | `GET /api/petition/packages/:id/validation` | `:19` | `petition.controller.js:39` | every portal role |
| 20 | `GET /api/petition/packages/:id/preview` | `:20` | `:59` | every portal role |
| 21 | `GET /api/petition/packages/:id/download` | `:21` | `:74` | every portal role |
| 22 | `PATCH /api/petition/packages/:id/letters/:sectionKey` | `:22` | `:90` | any CM+ |
| 23 | `PATCH /api/petition/packages/:id/exhibits/order` | `:23` | `:99` | any CM+ |
| 24 | `POST /api/petition/packages/:id/finalize` | `:24` | `:108` | any TL+ |
| 25 | `POST /api/petition/packages/:id/unlock` | `:25` | `:117` | any TL+ |
| 26 | `POST /api/petition/packages/:id/filing` | `:26` | `:126` | any CM+ |
| 27 | `POST /api/petition/packages/:id/receipt` | `:27` | `:135` | any CM+ |
| 28 | `POST /api/cases/:id/approve-questionnaire` | `case.routes.js:133` | `case.controller.js:2115-2137` (`getCaseOr404` only) | any CM+ |
| 29 | `POST /api/cases/:id/uscis-form-references` | `case.routes.js:129` | `case.controller.js:2197-2211` | any CM+ |
| 30 | `PUT /api/cases/:id/checklist/:idx` | `case.routes.js:137` | `case.controller.js:2282-2302` | any CM+ |
| 31 | `POST /api/cases/:id/checklist/generate` | `case.routes.js:138` | `case.controller.js:2304-2320` | any CM+ |
| 32 | `PUT /api/cases/:id/reopen` | `case.routes.js:126` | `case.controller.js:2390-2399` | any CM+ |
| 33-37 | `GET /api/case-managers/:id`, `/:id/cases`, `/:id/activities`, `/:id/payments`, `/:id/analytics` | `case-manager.routes.js:11-15` | no self/team check | any CM |
| 38-39 | `GET /api/users/:id/activity`, `/:id/performance` | `user.routes.js:48,49` | no self/team check | any CM |
| 40 | `GET /api/users/:id` | `user.routes.js:50` | no role gate at all | any CM |
| 41 | `PUT /api/calendar/availability/:userId` | `calendar.routes.js:29` | manager roles, arbitrary `userId` | any CM |
| 42 | `POST /api/forms/packages/generate` | `formGenerationRoutes.js:10` | no `requireCaseFormAccess` | any CM+ |
| 43 | `POST /api/workflows/cases/:caseId/start` | `workflow.routes.js:27` | `workflow.controller.js:154-164` does a bare `Case.findById`; `grep -rn "canAccessCase" modules/workflows/` → **zero matches** | any CM+ |
| ⚠ | `POST /api/employer-profile/:principalCaseId` | `employer-profile.routes.js:13` | `canWrite` (`service:57-60`) omits the `RESTRICTED_PORTAL_ROLES` denial `canRead` has | employee/beneficiary, if principal id lands in `caseIds` |

> **43 distinct case-/user-scoped IDOR-prone endpoints**, plus one authorization asymmetry.
>
> **Explicitly cleared after inspection:** `POST /api/cases/bulk` is *not* IDOR-prone —
> `case.service.js:657` applies `canAccessCase` per id inside the loop and returns
> `{success:false, message:"Not authorized"}` for each case the caller cannot reach.
> (It is, however, a **role**-escalation path — see `NEGATIVE_WORKFLOW_MATRIX.md` §T4.8.)

### 3.4 Route-layer validation coverage

| Module | `express-validator` present? |
|---|---|
| auth, cases (create paths), leads, appointments (public/schedule), calendar, payments, notifications, documents (upload/session), ai, petition-intelligence, employment-workflow, family-workflow, single-party-filings, eligibility-quiz, clients, beneficiaries, companies, users, dashboard, tasks (param only) | ✅ partial |
| **reports, workflows, questionnaires (45 routes), uscis-forms (50 routes), form-generation, form-mapping (19 routes), petition (15 routes), eligibility-engine, immigration-lifecycle, search, settings, billing, audit, team-management, leaderboard, consultation, consultation-routing, compliance, entity-config, data-rights, telemetry, document-intelligence (27 routes)** | ❌ **none** |

`sanitizeRequest` (`app.js:68`) is the only universal input guard; it strips injection-shaped
keys but performs **no type or shape validation**.

---

## 4. Structural findings

### 4.1 Dead router: `modules/sync/sync.routes.js`
`grep -rn "sync.routes\|sync/sync" Backend/src` returns no `require` outside the file itself,
and `routes/index.js` never mounts `/sync`. The router is **unreachable**.

This is fortunate: had it been mounted, it would have been the single worst IDOR in the
codebase — every route is `authenticate` only, with **no role, permission or ownership check
of any kind**:

- `sync.routes.js:9-16` `GET /clients` → `Client.find({})` limit 500 — **every client record**
- `sync.routes.js:18-25` `GET /cases` → `Case.find({})` limit 500 — **every case**
- `sync.routes.js:27-40` `GET /cases/:caseId/full` → case + documents + messages + payments for **any** case
- `sync.routes.js:60-67` `PUT /cases/:caseId/status` → `findByIdAndUpdate` on **any** case, status taken raw from `req.body.status`
- `sync.routes.js:73-80` `GET /pull/case/:id` → **any** case

**Recommendation:** delete the file, or if it is intended for a future integration, gate it
behind `authorizeRoles("super_admin")` + an `x-internal-api-key` check before ever mounting it.

### 4.2 Non-canonical role names in allow-lists
`"paralegal"` (`collaborationRoutes.js:9,10`; `lifecycleRoutes.js:7`) and `"attorney"`
(`lifecycleRoutes.js:7,8`; `eligibilityRoutes.js:14`) are not in `CANONICAL_ROLES`
(`roleHierarchy.js:1-13`) and have no `ROLE_PERMISSIONS` entry. They are inert today, but a
future `User.roles` addition would silently grant access without a permission entry.

---

# TASK 2 — Error contract (§17)

## 5. Central error handler

`Backend/src/middleware/errorHandler.js`, registered last in `app.js:76` (after the 404
fallback at `:75`).

### 5.1 Status derivation

| Condition | Status | File:line |
|---|---|---|
| Mongo connectivity/timeout error (`MongoNetworkError`, `MongoServerSelectionError`, `MongoTimeoutError`, `MongoPoolClosedError`, …) or `code 50 / MaxTimeMSExpired`, **and** the error carries no `status`/`statusCode` | **503** `DATABASE_UNAVAILABLE` | `errorHandler.js:11-30, 33-50` |
| `error.status \|\| error.statusCode` | that value | `:51` |
| otherwise | **500** `INTERNAL_SERVER_ERROR` | `:51, :61` |
| No route matched | **404** `{"success":false,"message":"Route not found"}` | `app.js:75` |

### 5.2 Response envelope (`:54-64`)

```
{ success:false, message, requestId,
  code?, errorCode?, details?, issues?, validation?, stack? }
```

### 5.3 🔴 **Stack-trace and internal-message exposure — the prior "0 exposures" finding no longer holds**

Two env-gated branches control leakage:

```
errorHandler.js:53   const exposeMessage = status < 500 || process.env.EXPOSE_INTERNAL_ERRORS === "true";
errorHandler.js:56   message: exposeMessage ? error.message : "Internal server error",
errorHandler.js:66   if (process.env.NODE_ENV === "development" && error.stack) {
errorHandler.js:67     payload.stack = error.stack;
errorHandler.js:68   }
```

The **committed `Backend/.env` sets both switches to the leaking value**:

```
Backend/.env:1    NODE_ENV=development
Backend/.env:43   EXPOSE_INTERNAL_ERRORS=true
```

(`Backend/.env.example:4` correctly ships `EXPOSE_INTERNAL_ERRORS=false`.)

Therefore, **as this application is currently configured**:

- **Every** error response — including every 500 — carries the full
  `error.stack` (absolute filesystem paths, module layout, line numbers, library internals).
- **Every** 500 carries the raw `error.message` (Mongoose cast errors, driver messages,
  third-party SDK text) instead of `"Internal server error"`.

`docs/audits/COMPREHENSIVE_AUDIT_V3_REPORT.md`'s "0 stack-trace exposures" is **true of the
production code path only** (`NODE_ENV=production` + `EXPOSE_INTERNAL_ERRORS` unset), and
**false of the repository's checked-in runtime configuration**. This is a live finding, not a
theoretical one — the running dev/staging instance leaks stacks on every error.

**Remediation:** set `NODE_ENV=production` (or `EXPOSE_INTERNAL_ERRORS=false` plus a
non-development `NODE_ENV`) in any deployed environment; better, change `errorHandler.js:66`
to require an explicit opt-in flag rather than keying off `NODE_ENV`, so a mis-set `NODE_ENV`
cannot silently re-enable stack output.

No other file writes a stack into a response — `grep -rn "\.stack" Backend/src` yields only
`errorHandler.js:66-67`, `utils/logger.js:28` (redacted, log-only), and
`scripts/migrateCaseParticipants.js:88` (CLI stdout, not HTTP).

### 5.4 Handlers that bypass the central error handler

Six modules install a local `handle`/`respond` shim that answers directly instead of calling
`next(error)`. Each emits `error.message` verbatim at **any** status, including 500 —
independent of `EXPOSE_INTERNAL_ERRORS`:

| File:line | Shape |
|---|---|
| `modules/canonical/controllers/CanonicalController.js:11` | `message: error.message \|\| "Canonical profile request failed"` |
| `modules/case-collaboration/controllers/CollaborationController.js:8` | `error.status \|\| error.statusCode \|\| 500` + `error.message` |
| `modules/eligibility-engine/controllers/EligibilityController.js:12` | `error.status \|\| 500` + `error.message` |
| `modules/form-generation/controllers/FormGenerationController.js:5` | `error.status \|\| 500` + `error.message` + `validationResults` |
| `modules/form-mapping/controllers/AutoFillController.js:5` | `error.status \|\| 500` + `error.message` |
| `modules/immigration-lifecycle/controllers/LifecycleController.js:18` | `error.status \|\| error.statusCode \|\| 500` + `error.message` |

Consequences: (a) internal error text on 500 regardless of configuration; (b) these responses
carry **no `requestId`**, breaking log correlation; (c) they never reach the 503
`DATABASE_UNAVAILABLE` translation at `errorHandler.js:33-50`, so a Mongo outage in any of
these six modules surfaces as an opaque 500.

### 5.5 Does any auth failure path produce a 500 instead of 401/403? — **No**

- `authenticate.js:34-39` wraps the whole body in `try/catch` and returns 401 on **every**
  throw (expired token `:36`, anything else `:38`). A Redis failure inside `getCachedUser`
  (`:20`) is also swallowed into a 401 — semantically wrong (infrastructure failure reported
  as bad credentials) but **not** a 500.
- `authorizeRoles.js:5-9` uses `req.user?.role`; `hasRole(undefined, …)` returns `false`
  (`rbac.service.js:5`) → clean 403, never a TypeError.
- `authorizePermissions.js:5-8` — `hasPermission(undefined, …)` returns `false`
  (`rbac.service.js:11`) → clean 403.
- Every service-layer authorization failure attaches `status`/`statusCode` 403 before
  throwing (e.g. `case.service.js:530`, `employee-profile.service.js` `forbiddenError`,
  `CanonicalProfileService.js:121`), so `errorHandler.js:51` reads 403, not 500.

**Verdict: no authentication or authorization failure path yields a 500.**

### 5.6 Semantic use of 400 / 404 / 409 / 422

| Code | Used semantically? | Evidence |
|---|---|---|
| **400** | ✅ | `validate.js:6` (`"Validation failed"` + `errors[]`); `case.controller.js:812` `VALIDATION_ERROR`; `:819` `INVALID_CREATION_SOURCE`; `:826` `LEAD_REQUIRED`; `:847` `UNKNOWN_VISA_TYPE`; `employee-profile.service.js` `badRequestError` for unknown field paths |
| **401** | ✅ | `authenticate.js:9,29,36,38` only — never used for authorization |
| **403** | ✅ | `authorizeRoles.js:6`, `authorizePermissions.js:7`, `case.service.js:530`, `case.controller.js:387,472,490,1242,…`, `requireCaseFormAccess.js:35` |
| **404** | ✅ | `case.controller.js:377`; `case.service.js:525`; `requireCaseFormAccess.js:26`; `app.js:75` route fallback; `search.controller.js:101,111,121` |
| **409** | ✅ | `case.controller.js:840` `LEAD_ALREADY_CONVERTED`; `:855` `EMAIL_OWNED_BY_NON_CLIENT`; `:860` `CLIENT_ALREADY_HAS_CASE`; `quiz.service.js:31-34` `CASE_EXISTS`; `case-lifecycle-orchestrator.service.js:438` "Assign a primary case manager before generating forms"; `interactive-form-review.service.js:169` missing template |
| **422** | ✅ (narrowly) | `case-lifecycle-orchestrator.service.js:473` `CANONICAL_NEEDS_REVIEW` — the **only** 422 in the codebase. Field-level validation uses 400 rather than 422 throughout; internally consistent |
| **503** | ✅ | `errorHandler.js:43-49` `DATABASE_UNAVAILABLE` |

**Verdict: 400/403/404/409 are used semantically and consistently. 422 is used exactly once,
for a genuine semantic-validation failure. There is no code-abuse (no 200-with-error-body,
no 500-for-validation).** The one systematic gap is §5.4 — six modules that answer outside
the central handler and therefore skip `requestId`, the 503 translation, and the
`exposeMessage` guard.

---

## 6. Priority remediation list

| P | Finding | Location |
|---|---|---|
| **P0** | Stack traces + raw 500 messages leaked to clients in the checked-in configuration | `Backend/.env:1,43` ↔ `errorHandler.js:53,66-67` |
| **P0** | `/api/petition/packages/:id/{,validation,preview,download}` readable by every portal role for any case | `petition.routes.js:18-21`, `petition.controller.js:20-88` |
| **P0** | `/api/cases/:caseId/forms/:formType/*` (10 routes) — no case-access check anywhere | `autoFillRoutes.js:8-17` |
| **P0** | `/api/eligibility/*` (6 routes) — no case-access check anywhere | `eligibilityRoutes.js:9-14` |
| **P1** | 5 case routes call `getCaseOr404` without `canAccessCase` | `case.controller.js:2115, 2197, 2282, 2304, 2390` |
| **P1** | 4 USCIS-lifecycle endpoints unreachable due to mount order | `routes/index.js:24-25` |
| **P1** | `/api/case-managers/:id/*` — any CM can read any other CM's book of business | `case-manager.routes.js:11-15` |
| **P1** | `POST /api/appointments` unauthenticated | `appointment.routes.js:24` |
| **P2** | Six modules bypass the central error handler (no `requestId`, no 503 translation) | §5.4 |
| **P2** | `canWrite` missing the restricted-role denial `canRead` has | `employer-profile.service.js:57-60` |
| **P2** | Delete or gate the unmounted `sync` router before it is ever wired up | `modules/sync/sync.routes.js` |
| **P2** | No per-route rate limiter on `/api/auth/login`, `/forgot-password`, `/reset-password`, `/resend-invite` | `auth.routes.js:46,72,73,88` |
| **P3** | 22 modules with zero route-layer input validation | §3.4 |
| **P3** | Dead role names `paralegal` / `attorney` in allow-lists | §4.2 |
