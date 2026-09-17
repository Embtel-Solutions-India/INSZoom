# Repository Architecture Investigation — Immiglance Landing/ClientPortal Split

**Status: INVESTIGATION AND PLANNING ONLY. No code, config, or routing was changed to produce this report.**
Every file referenced below was read-only (`Read`/`Grep`/`Glob`/safe `cat`); the only artifact this investigation produced is this document.

Date: 2026-09-18. Branch at time of investigation: `refactor`.

---

## 1. Executive summary

`Immiglance/Frontend` is currently **one Vite/React app that does the job of two apps**: a public marketing/acquisition site (home page, eligibility quiz, consultation booking, all four auth flows) and an authenticated client case-management portal (dashboard, documents, messages, payments, intake questionnaire). They already have separate layouts (`MainLayout` vs `PortalLayout`) and a single, well-factored routing gate (`AuthGate.jsx`) that cleanly decides who goes where — the seams to split along are already visible in the code, which is good news for a low-risk migration.

Three findings materially change the plan the user should expect, versus a naive reading of the original prompt:

1. **`Home.jsx` lives in `Pages/Dashboard/` but is the public marketing homepage**, rendered at `/` outside any auth guard. It is not the authenticated dashboard (that's `Dashboard.jsx`, a different file, rendered at `/dashboard`). This is the single most confusing naming artifact in the codebase and must be resolved explicitly during any split — see §4.
2. **There is a second, legacy, fully self-contained admin surface embedded inside Immiglance itself**: `Pages/Admin/AdminLogin.jsx` + `AdminPortal.jsx` + `Pages/Admin/leads/LeadsInbox.jsx`, live-routed at `/admin` and `/admin/portal`. This directly contradicts `AGENTS.md`'s "Never implement admin-only functionality here" rule for Immiglance and duplicates what the real `Admin/frontend` app (formerly INSZoom) already does. It is dead weight that should be deleted, not migrated — see §4, §17.
3. **The CI/CD pipeline (`.github/workflows/inszoom-cicd.yml`) only builds and deploys Immiglance and Admin.** The Attorney app has no deployment step at all, and the Backend's production `CLIENT_URLS` allowlist has no production Attorney origin either (only `localhost:5174`). Splitting Immiglance into two deployable apps means going from "2 of 3 frontends deployed" to "3 of 4 frontends deployed" — the pipeline needs proportionally more work than the application code does. This is the single biggest blocker to "4 independently-deployable frontends," bigger than any code-level import risk. See §14, §19.

**Top-line recommendation** (detailed in §15): keep the shallow, already-established top-level layout (`Immiglance/`, `Admin/`, `Attorney/`, `Backend/`) and split Immiglance **in place** into `Immiglance/Landing/` and `Immiglance/ClientPortal/` as sibling folders under `Immiglance/`, each with its own `package.json`/`vite.config.js`/`.env`. Do **not** rename or move `Admin/frontend/` or `Attorney/` — there is no concrete reason to, and doing so would only add churn and re-break the SSO URLs/CI paths that already work. `Admin/frontend`'s nested `frontend/` subfolder is otherwise-unjustified (no sibling `Admin/backend/` exists — the shared `Backend/` already serves it) but is deeply wired into the CI/CD workflow, `.env` files, and everyone's muscle memory; recommendation is to leave it as-is (see §15 for the full reasoning).

The single largest technical risk found is not import-graph tangling (the code is already cleanly layered) — it is **environment/URL drift between local dev and the CI/CD pipeline for the staff-redirect mechanism**: `Immiglance/Frontend/src/utils/portalRedirect.js` and `Pages/Auth/OAuthCallback.jsx` read `VITE_ADMIN_URL`, but the only CI/CD workflow in the repo still injects `VITE_INSZOOM_URL` into the Immiglance build (see §13, §19). If that secret was never renamed on the GitHub side, every production build silently ships `VITE_ADMIN_URL` undefined, and `portalRedirect.js`'s own defensive `console.error` (written for exactly this scenario) is the only thing that would ever surface it. This is unrelated to the Landing/ClientPortal split itself, but a split will touch this exact file, so it must be verified before or during migration, not after.

---

## 2. Current repository structure (as read from disk)

```
ImmigrationCRM/
├── AGENTS.md                          # 4-app architecture doc (Immiglance, Admin, Attorney, Backend)
├── ImmigrationCRM.code-workspace      # single-folder VS Code workspace, no multi-root config
├── package.json                       # root — NOT a workspace root; just one stray dep (@adobe/pdfservices-node-sdk)
├── package-lock.json
├── f2-chain-report.json               # stray audit artifact, unrelated to this task
├── .github/
│   └── workflows/
│       └── inszoom-cicd.yml           # ONLY CI/CD workflow in the repo — see §14
├── .agents/, .claude/, .runtime-logs/, .VSCodeCounter/   # tooling/session scaffolding, not app code
├── Backend/                           # shared Express/Mongo API — port 7000
│   ├── package.json  ("immigration-crm-backend")
│   ├── .env / .env.example
│   ├── src/{config,jobs,middleware,models,modules,routes,scripts,seeds,services,test-utils,utils}
│   ├── docs/, scripts/, uploads/, dev-assets/
│   └── scratch-verify-*.js            # stray one-off scripts at Backend root
├── Immiglance/
│   ├── package.json                   # thin wrapper, name "immiglance-client-portal", just delegates npm scripts into Frontend/
│   └── Frontend/                      # THE app under investigation — see §4
│       ├── package.json  (name: "ussv-frontend" — legacy, pre-rename name, never updated)
│       ├── vite.config.js
│       ├── .env / .env.example
│       ├── index.html, eslint.config.js
│       └── src/{Pages,components,layout,context,hooks,services,utils,config,assets}
├── Admin/
│   ├── .gitignore
│   └── frontend/                      # the real internal-CRM app (formerly INSZoom)
│       ├── package.json  (name: "inszoom-crm-frontend" — legacy, pre-rename name, never updated)
│       ├── scripts/{dev.mjs,build.mjs,vite-options.mjs,optimize-images.mjs}  # custom Vite runner, not a vite.config.js
│       ├── .env / .env.example
│       ├── e2e/, test-results/, playwright.config.js, vitest.config.js
│       └── src/{assets,components,contexts,hooks,layouts,pages,poc,services,test,utils}
├── Attorney/
│   ├── package.json  (name: "attorney")
│   ├── vite.config.js
│   ├── .env / .env.development
│   ├── PHASE0_FINDINGS.md, docs/
│   └── src/{auth,components,context,hooks,layout,pages,services}
└── docs/
    ├── BACKEND_PERFORMANCE_ROOT_CAUSE_AUDIT.md, COMPREHENSIVE_AUDIT_REPORT.md,
    │   IMMIGLANCE_RETHEME_COMPLETION_REPORT.md, SETTINGS_ENGINE_COMPLETION_REPORT.md
    ├── architecture/  (MODULE-CARDS.md, COVERAGE.md, CANONICAL_WORKFLOW.md, dependency-graph.json, *.mmd)
    ├── archive/, audits/, development/, forms/, phases/, security/
```

Corrections to the pre-investigation context notes: the earlier note referenced a `docs/RENAME_COMPLETION_REPORT.md` — **it does not exist anywhere in `docs/`** (confirmed by directory listing and a repo-wide filename search). Whatever rename work happened, its completion report either was never written to that path or was never committed. This matters because the rename is visibly **incomplete** at the config layer: both `Immiglance/Frontend/package.json` (`ussv-frontend`) and `Admin/frontend/package.json` (`inszoom-crm-frontend`) still carry pre-rename names, and the CI/CD workflow file is still named/labeled `inszoom-cicd.yml` / "INSZoom CI/CD" throughout, including a PM2 process name `inszoom-backend` and an S3 key prefix `inszoom-deploy/`. None of this is client-facing (it's package names, a CI file, and infra identifiers), but it is exactly the kind of "Settings DB data too, not just code" residue the user has flagged before in a different context — worth a cleanup pass independent of this migration.

---

## 3. Every independently-runnable frontend application

| Application | Folder | Framework | package.json | Vite config | Entry point | Dev/build scripts | Intended subdomain |
|---|---|---|---|---|---|---|---|
| Immiglance (Landing + ClientPortal, currently fused) | `Immiglance/Frontend/` | React 19 + React Router 7 + Vite 8 (rolldown-vite, React Compiler babel preset) | Yes — name `ussv-frontend` (legacy) | `vite.config.js`: no explicit port (defaults 5173), no `base`, no `resolve.alias`; proxies `/api` and `/socket.io` (ws) to `localhost:7000`; Tailwind v4 via `@tailwindcss/vite` plugin | `src/main.jsx` → `src/App.jsx` | `dev`/`build`/`preview`/`lint`/`test` (vitest) via plain `vite` CLI | `client.bayareaimmigrationservices.com` (current prod; not `*.immiglance.com` — see note below) |
| Admin (internal CRM, formerly INSZoom) | `Admin/frontend/` | React 18 + React Router 6 + Vite 5 | Yes — name `inszoom-crm-frontend` (legacy) | No `vite.config.js` file at all — config is programmatic via `scripts/vite-options.mjs`, invoked by custom `scripts/dev.mjs`/`scripts/build.mjs` (`configFile: false`); port **3002**; same `/api` + `/socket.io` proxy | `src/main.jsx` (implied) → `src/App.jsx` | `dev` → `node scripts/dev.mjs`; `build` → `node scripts/build.mjs`; also `test`, `test:e2e` (Playwright), `lint` | `admin.bayareaimmigrationservices.com` (current prod) |
| Attorney Portal | `Attorney/` | React 18 + React Router 6 + Vite 5 | Yes — name `attorney` | `vite.config.js`: port **5174**; same `/api` + `/socket.io` proxy; no `base`/aliases | `src/main.jsx` (implied) → `src/App.jsx` | `dev`/`build`/`preview`/`lint` via plain `vite` CLI | No production origin configured anywhere in the repo yet (Backend `CLIENT_URLS` only lists `localhost:5174` for it) — see §13/§14 |
| Backend | `Backend/` | Express + Mongoose (Node) | Yes — name `immigration-crm-backend` | N/A (not a Vite app) | `src/server.js` | `dev` (nodemon, port from `PORT` env, defaults 7000), `start`, plus ~25 seed/migration/verify scripts | `api.bayareaimmigrationservices.com` implied by `VITE_API_URL`/`CLIENT_URL` values but not independently confirmed (no reverse-proxy/Nginx config exists in-repo to check against) |

No root-level workspace tooling exists: no `pnpm-workspace.yaml`, no `turbo.json`, no `nx.json`, and the root `package.json` is not an npm/yarn workspaces manifest (no `workspaces` field) — it's an unrelated single dependency (`@adobe/pdfservices-node-sdk`) that looks like leftover scratch work, not infrastructure. Each app manages its own `node_modules` and lockfile independently today. This confirms the pre-investigation assumption that no monorepo tooling exists.

**Domain note (flagged per instructions, not resolved):** production URLs actually in use in the repo are `client.bayareaimmigrationservices.com` and `admin.bayareaimmigrationservices.com` (from `Immiglance/Frontend/.env`'s `VITE_ADMIN_URL` and Backend's `.env` `CLIENT_URL`/`CLIENT_URLS`). The user's own prompt used `immiglance.com`/`client.immiglance.com` as an illustrative pattern. This report treats `bayareaimmigrationservices.com` as the real current domain and does not assume `immiglance.com` will ever become authoritative — that is a business/DNS decision outside this repo's visibility.

---

## 4. Is Immiglance currently one or two applications?

Functionally: **two applications sharing one Vite project, one `AuthContext`, one `api.js`, and one router.** The split points already exist in the code (`MainLayout` vs `PortalLayout`, `AuthGate` as the sole gate). Full classification of `Immiglance/Frontend/src` follows.

### Pages/

| Path | Classification | Justification |
|---|---|---|
| `Pages/Dashboard/Home.jsx` | **LANDING** (misfiled) | Renders at `/` under `MainLayout`, **outside** `AuthGate` (see `App.jsx:43-45`). Public marketing copy (categories, how-it-works, FAQ, contact form), reads `useAuth()`/`useHasCase()` only to swap one CTA link. This is the actual public homepage despite sitting in a folder named `Dashboard`. |
| `Pages/Dashboard/Dashboard.jsx` | **CLIENT PORTAL** | Renders at `/dashboard` under `AuthGate` + `PortalLayout`. The real authenticated case-overview screen (stage tracker, plan/payment status). Distinct file from `Home.jsx` above — confirmed by reading both. |
| `Pages/Dashboard/Profile.jsx`, `Documents.jsx`, `DocumentReview.jsx`, `Messages.jsx`, `Payments.jsx`, `PaymentSuccess.jsx`, `PaymentCancel.jsx`, `PlanSelection.jsx`, `FilingTypeSelection.jsx`, `QuickBooks.jsx`, `FedEx.jsx`, `Intake.jsx` | **CLIENT PORTAL** | All routed under `AuthGate` (`/dashboard/*` or `/onboarding/intake`); all import `casesApi`/`documentsApi`/`messagesApi`/`paymentsApi`/case-scoped hooks. |
| `Pages/Auth/Login.jsx`, `Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `AcceptInvite.jsx`, `OAuthCallback.jsx` | **LANDING / AUTHENTICATION** (its own sub-bucket — see §12) | All routed outside `AuthGate`, reachable by an anonymous visitor; no `PortalLayout`. |
| `Pages/Auth/LegacyHolding.jsx` | **SHARED (edge case)** | Public route (`/legacy-holding`, outside `AuthGate`) but only ever reached *from* `AuthGate` for an authenticated legacy account with no case. Content-wise trivial (static message); belongs logically with auth/session-state handling rather than either bucket cleanly — see §12. |
| `Pages/Eligibility/EligibilityQuiz.jsx`, `eligibilityCategories.js` | **LANDING** | Routed standalone (`/eligibility/quiz`, wrapped only by `BlockIfHasCase`, no `PortalLayout`/`AuthGate`); pure acquisition-funnel content (`leadsApi`, `eligibilityQuizApi`, `telemetryApi`). |
| `Pages/Consultation/BookConsultation.jsx`, `ManageBooking.jsx` | **LANDING** | Public, unguarded routes reachable pre-signup (`consultationApi` only); `ManageBooking` is reached via an emailed token link, independent of login state entirely. |
| `Pages/Admin/AdminLogin.jsx`, `AdminPortal.jsx`, `Pages/Admin/leads/LeadsInbox.jsx` | **UNKNOWN / DEAD-WEIGHT DUPLICATE** | Live-routed at `/admin` and `/admin/portal` (App.jsx:132-134), fully functional (own overview/cases/users/documents/appointments/leads sections, own `adminApi`/`casesApi`/`leadsApi`/`appointmentsApi` calls). This is a **second, legacy internal-admin UI** duplicating what `Admin/frontend` (the real, actively-developed Admin app) already does, built directly into the client-facing app. It directly violates `AGENTS.md`'s explicit rule ("Never implement admin-only functionality here") for Immiglance. Not a Landing or ClientPortal concern at all — recommend deletion, not migration (see §17). |

### components/

| Path | Classification | Justification |
|---|---|---|
| `AuthGate.jsx` | **AUTH (shared infra)** | The single routing authority described in its own header comment; reads `AuthContext`, decides Landing-vs-ClientPortal-vs-staff-bounce. |
| `ProtectedRoute.jsx` (incl. exported `BlockEmployeeRoute`) | **DEAD CODE** | `App.jsx`'s own comment states AuthGate "supersedes" this; grep confirms it is not imported by `App.jsx`. Kept as a file but unused. |
| `Navbar.jsx`, `BrandMark.jsx` | **LANDING** (BrandMark also reused elsewhere) | `Navbar` only renders inside `MainLayout`, which today only wraps `/`. `BrandMark` is imported by `Navbar`, `Login.jsx`, and `PortalLayout` inlines its own separate SVG mark rather than reusing `BrandMark` (inconsistency noted for §7). |
| `PageLoader.jsx` | **SHARED (trivial)** | Root `Suspense` fallback in `App.jsx`; used regardless of which route resolves. |
| `NotificationBell.jsx`, `NotificationPreferencesCard.jsx` | **LANDING-attached, but portal-relevant data** | `NotificationBell` is imported only by `Navbar.jsx` and the legacy `AdminPortal.jsx` — **not** by `PortalLayout`, meaning today's authenticated-user notification bell only ever appears on the public "/" page header, never inside `/dashboard/*`. This is a pre-existing UX gap, not something the split creates, but it means "notifications" doesn't cleanly slot into either bucket without a product decision first. |
| `ThemeToggle.jsx` | **GENUINELY SHARED** | Imported by `Navbar` (Landing), `PortalLayout` (ClientPortal), and `Login.jsx` (Landing). Real cross-cutting UI. |
| `ProtectedRoute.jsx`, `eligibility/BlockIfHasCase.jsx` | **LANDING (route guard)** | Gates `/eligibility/quiz` for the Landing funnel; has no `AuthGate` dependency of its own. |
| `eligibility/*` (`ChoiceStep`, `ContactStep`, `DisclaimerBanner`, `EligibilityShell`, `QuizProgress`) | **LANDING** | Only imported by `EligibilityQuiz.jsx`/`BookConsultation.jsx`/`ManageBooking.jsx`. |
| `consultation/*` (`ConfirmedScreen`, `MeetingSummary`, `MonthCalendar`, `TimeSlotList`) | **LANDING** | Only imported by `BookConsultation.jsx`/`ManageBooking.jsx`. |
| `checklist/*` (`CaseIntakeExtras`, `ChecklistItemRow`, `DocumentUploadControl`, `EmployeeHandoffModal`, `StatusLegend`) | **CLIENT PORTAL** | Only imported by `Documents.jsx`/`Intake.jsx`. |
| `questionnaire/*` (`CanonicalProfileForm`, `CaseRoleChecklist`, `DataEntryModeModal`, `EmployeeSelfServiceView`, `InvitePanel`, `PrincipalCaseWorkspace`, `QuestionInput`, `canonicalFieldGroups.js`) | **CLIENT PORTAL** | Only imported by `Intake.jsx`/`Documents.jsx`. |
| `auth/PasswordField.jsx` (+ its test) | **LANDING (auth sub-bucket)** | Used by `Login`, `Register`, `ResetPassword`, `AcceptInvite` — all Landing/auth pages, never a `/dashboard/*` page. |
| `ApplicantTypeSelector.jsx` | **CLIENT PORTAL** | Used only by `PlanSelection.jsx`. |
| `StartAssessmentButton.jsx` | **LANDING** | Used by `Home.jsx`, `Navbar.jsx`; depends on `useHasCase` (a portal-data read, see below) purely to decide whether to render itself. |
| `BenefitCard.jsx`, `InfoPopup.jsx`, `StepCard.jsx` | **UNKNOWN — DEAD CODE** | Repo-wide grep found zero importers of any of these three. Confirmed unused; irrelevant to either bucket. |

### layout/, context/, hooks/, services/, utils/, config/

| Path | Classification | Justification |
|---|---|---|
| `layout/MainLayout.jsx` | **LANDING** | Wraps only `/` today; also contains the staff/attorney "already logged in, bounce to own portal" effect (shared logic, see §12). |
| `layout/PortalLayout.jsx` | **CLIENT PORTAL** | Sidebar + top bar shell for all `/dashboard/*` routes; own inline SVG icon set (not `BrandMark`). |
| `context/AuthContext.jsx` | **SHARED (must be shared or bootstrapped in both)** | Single source of truth for `user`/`sessionContext`/`authStatus`; both Landing (Login/Register/OAuthCallback/Navbar) and ClientPortal (AuthGate/PortalLayout/every Dashboard page) read it directly. |
| `context/SocketContext.jsx` | **CLIENT PORTAL** (present, unused by Landing) | Provides `useSocket()`, consumed today only by `AdminPortal.jsx` (the dead-weight admin surface) and would be consumed by real-time portal features (messages/notifications) if wired up; Landing pages don't use it. |
| `context/ThemeContext.jsx` | **SHARED** | Powers `ThemeToggle`, used on both sides. |
| `hooks/useHasCase.js` | **SHARED, but portal-data-shaped** | Purely a Landing-funnel gating hook by *purpose* (used by `Home.jsx`, `StartAssessmentButton`, `BlockIfHasCase`, `Navbar`), but it calls `casesApi.my()` — a ClientPortal-domain API. This is the single most-coupled piece of shared logic in the app: Landing needs to know "does this visitor already have a case," which is inherently portal state. |
| `hooks/useCaseChecklists.js`, `useCaseDocumentChecklist.js`, `useDocumentChecklist.js`, `useQuestionnaireAnswers.js`, `useMyCaseProfile.js` | **CLIENT PORTAL** | All imported exclusively by `Documents.jsx`, `Dashboard.jsx`, `Messages.jsx`, `PlanSelection.jsx`, `PortalLayout.jsx`, and questionnaire components — verified by grep, zero Landing-page importers. |
| `services/api.js` | **SHARED (monolithic — see §7)** | One 680-line file exporting every API namespace (`authApi`, `leadsApi`, `eligibilityQuizApi`, `consultationApi`, `entityConfigApi`, `complianceApi`, `telemetryApi` = Landing; `casesApi`, `documentsApi`, `messagesApi`, `paymentsApi`, `questionnairesApi`, `employer/employeeProfileApi`, `adminApi` = ClientPortal/legacy-admin), plus the shared `tokenStore`/`request()`/refresh logic every namespace depends on. |
| `services/notificationService.js` | **CLIENT PORTAL-leaning** | FCM device registration, invoked from `AuthContext` on every login regardless of role — technically fires for Landing-side logins too, but its purpose (push notifications about case activity) is a portal concept. |
| `utils/auth.js` (`isEmployeeAccount`), `utils/featureFlags.js`, `utils/portalRedirect.js`, `utils/postLoginDest.js` (dead) | **SHARED (auth infra)** | Used by both `AuthGate` (portal) and `MainLayout`/`Login`/`Navbar` (Landing). |
| `utils/eligibilitySession.js`, `utils/localDateKey.js` | **LANDING** | Only used by quiz/consultation flow. |
| `utils/caseStatusLabel.js`, `utils/checklistStatus.jsx`, `utils/dedupeChecklistSections.js`, `utils/questionnaireEngine.js`, `utils/visaDisplay.js` | **CLIENT PORTAL** | Only used by Dashboard/Documents/Intake/PortalLayout. |
| `utils/iconComponents.jsx` | **SHARED** | Icon set imported by both `Home.jsx` (Landing) and `AdminLogin.jsx`/`AdminPortal.jsx` (legacy admin) and portal-side files. |
| `config/planConfig.js`, `pricingCatalog.js`, `visaEligibility.js`, `visaTypeCanonical.js` | **CLIENT PORTAL** | Only imported by `Dashboard.jsx`/`PlanSelection.jsx`/`Payments.jsx`/`Profile.jsx`. |
| `config/visaConfig.js` | Imports `visaEligibility.js` internally; same bucket. |
| `assets/` (images, video) | **MOSTLY LANDING** | `assets/images/client-portal/*` (despite the folder name "client-portal") are marketing-page illustration images (how-it-works graphics), not actual in-app portal screenshots — folder name is another naming red herring, same pattern as `Home.jsx`. `assets/admin-login-liberty.{png,webp}` is used by `Register.jsx` (Landing) as a background image, named for the old admin-login page it was presumably first designed for. |

**Bottom line for §4:** the app is cleanly two apps in intent, muddied by (a) two confusingly-named folders/files (`Pages/Dashboard/Home.jsx`, `assets/images/client-portal/`), (b) one genuinely monolithic shared file (`services/api.js`), and (c) one significant piece of dead-weight scope creep (the embedded legacy `/admin` surface) that belongs in neither bucket and should be removed rather than migrated.

---

## 5. What should move to Landing

| File/component | Current path | Landing? | Dependencies | Safe to move? | Reason |
|---|---|---|---|---|---|
| Home (public marketing page) | `Pages/Dashboard/Home.jsx` | Yes | `AuthContext`, `useHasCase`, `StartAssessmentButton`, `leadsApi`, `iconComponents` | Yes, but **rename the file/folder** during the move (`Pages/Marketing/Home.jsx` or similar) — leaving it as `Dashboard/Home.jsx` inside a `Landing` app would be actively misleading | Confirmed by reading the file: renders at `/`, no auth guard, pure marketing content |
| Login | `Pages/Auth/Login.jsx` | Yes | `AuthContext`, `authApi`, `PasswordField`, `ThemeToggle`, `BrandMark` | Yes | Unauthenticated entry point for all three role tabs (client/attorney/team) — see §12 for why this must live in Landing even though it authenticates staff/attorney accounts too |
| Register | `Pages/Auth/Register.jsx` | Yes | `AuthContext`, `authApi`, `PasswordField`, `assets/admin-login-liberty.*` | Yes | Public signup; also contains its own local `STAFF_ROLES`/`ADMIN_URL` constants (duplicated from `portalRedirect.js` — flag for cleanup, not blocking) |
| Forgot/Reset Password | `Pages/Auth/ForgotPassword.jsx`, `ResetPassword.jsx` | Yes | `authApi`, `PasswordField` | Yes | Public, token-based, no session required |
| Accept Invite | `Pages/Auth/AcceptInvite.jsx` | Yes | `AuthContext`, `authApi`, `PasswordField` | Yes | Public route explicitly kept outside `AuthGate` in `App.jsx` so a `mustSetPassword` redirect never loops |
| OAuth Callback | `Pages/Auth/OAuthCallback.jsx` | Yes | `AuthContext` (`setUserFromOAuth`), `tokenStore` | Yes, **but** verify the backend's `GOOGLE_OAUTH_REDIRECT_URI` and post-auth landing URL still point at wherever Landing ends up serving `/auth/callback` | The backend redirects the browser here after a full-page OAuth round trip — this is a hard-coded URL dependency, not just an import |
| Legacy Holding | `Pages/Auth/LegacyHolding.jsx` | Yes (own auth sub-bucket) | none | Yes | Static; only reachable via an `AuthGate` redirect for a specific legacy-account edge case — content lives in Landing, but the *decision* to route here is ClientPortal-side logic (see §12) |
| Eligibility Quiz | `Pages/Eligibility/EligibilityQuiz.jsx`, `eligibilityCategories.js`, `components/eligibility/*` | Yes | `eligibilityQuizApi`, `telemetryApi`, `eligibilitySession.js` | Yes | Fully self-contained public funnel |
| Book/Manage Consultation | `Pages/Consultation/BookConsultation.jsx`, `ManageBooking.jsx`, `components/consultation/*` | Yes | `consultationApi`, `localDateKey.js` | Yes | Public, token/query-param driven, no auth |
| Navbar, BrandMark | `components/Navbar.jsx`, `components/BrandMark.jsx` | Yes | `AuthContext`, `isEmployeeAccount`, `NotificationBell`, `ThemeToggle` | Yes | Renders only inside `MainLayout` |
| MainLayout | `layout/MainLayout.jsx` | Yes | `AuthContext`, `tokenStore`, `portalRedirect.js` | Yes, **with the staff/attorney bounce effect kept intact** | This is where an already-authenticated staff/attorney session gets redirected off the marketing site — critical to preserve exactly, see §12 |
| StartAssessmentButton | `components/StartAssessmentButton.jsx` | Yes | `useHasCase` (cross-boundary — see §7) | Conditionally — depends on how `useHasCase`/`casesApi.my()` is resolved post-split | The component itself is Landing UI, but its one piece of logic needs portal-side case data |
| AdminLogin / AdminPortal / LeadsInbox | `Pages/Admin/*` | **No — delete, do not migrate** | `AuthContext`, `adminApi`, `casesApi`, `leadsApi`, `appointmentsApi`, `useSocket` | N/A | Legacy duplicate of the real `Admin/frontend` app; recommend removal as a separate cleanup, not part of the Landing/ClientPortal split (see §4, §17) |

---

## 6. What should move to ClientPortal

| File/component | Current path | ClientPortal? | Dependencies | Safe to move? | Reason |
|---|---|---|---|---|---|
| Dashboard (case overview) | `Pages/Dashboard/Dashboard.jsx` | Yes | `AuthContext`, `isEmployeeAccount`, `casesApi`, `useMyCase`/`useMyProfile`, `planConfig.js`, `caseStatusLabel.js` | Yes | Confirmed distinct from `Home.jsx`; renders at `/dashboard` under `AuthGate` |
| Profile | `Pages/Dashboard/Profile.jsx` | Yes | `visaConfig.js`, portal hooks | Yes | — |
| Documents / DocumentReview | `Pages/Dashboard/Documents.jsx`, `DocumentReview.jsx`, `components/checklist/*` | Yes | `useCaseChecklists`/`useCaseDocumentChecklist`/`useDocumentChecklist`/`useQuestionnaireAnswers`, `documentsApi`, `PrefillBadge` | Yes | Heaviest cluster of case-scoped hooks — all portal-only |
| Messages | `Pages/Dashboard/Messages.jsx` | Yes | `messagesApi`, `useMyCase` | Yes | — |
| Payments / PaymentSuccess / PaymentCancel | `Pages/Dashboard/Payments.jsx`, `PaymentSuccess.jsx`, `PaymentCancel.jsx` | Yes | `paymentsApi`, `pricingCatalog.js`, Stripe redirect URLs | Yes, **but** Stripe's configured success/cancel redirect URLs are effectively hard-coded to whatever origin serves these routes today — must be updated at the Stripe/Backend config layer, not just moved in the repo | `paymentsApi.createPartialCheckoutSession` presumably passes an absolute return URL server-side; verify against `Backend/src/modules/payments` before cutover |
| Plan/Filing Type Selection | `PlanSelection.jsx`, `FilingTypeSelection.jsx` | Yes | `planConfig.js`, `pricingCatalog.js`, `ApplicantTypeSelector` | Yes | — |
| QuickBooks, FedEx | `QuickBooks.jsx`, `FedEx.jsx` | Yes | portal APIs | Yes | — |
| Intake / Questionnaire | `Pages/Dashboard/Intake.jsx`, `components/questionnaire/*` | Yes | `questionnairesApi`, `employmentWorkflowApi`, `familyWorkflowApi`, `employerProfileApi`/`employeeProfileApi`, `documentIntelligenceApi` | Yes | Routed under `AuthGate` at `/onboarding/intake`, standalone (no `PortalLayout`) — note this route has **no sidebar chrome today**, so it doesn't strictly need `PortalLayout` to move with it, just `AuthGate` |
| PortalLayout | `layout/PortalLayout.jsx` | Yes | `AuthContext`, `isEmployeeAccount`, `useMyCase`/`useMyProfile`, `visaDisplay.js`, `caseStatusLabel.js`, `ThemeToggle` | Yes | — |
| AuthGate | `components/AuthGate.jsx` | Yes (but see §12) | `AuthContext`, `isEmployeeAccount`, `tokenStore`, `portalRedirect.js` | Yes, with caveat | This is ClientPortal's own gate today, but under a split it also has to gate `/onboarding/intake`, `/dashboard/*`, and `/accept-invite`'s `mustSetPassword` branch — needs to keep working even though `/accept-invite` itself lives in Landing (cross-app route awareness, see §11/§19) |
| config/{planConfig, pricingCatalog, visaEligibility, visaTypeCanonical, visaConfig}.js | `config/*.js` | Yes | — | Yes | Confirmed zero Landing-page importers |
| hooks/{useCaseChecklists, useCaseDocumentChecklist, useDocumentChecklist, useQuestionnaireAnswers, useMyCaseProfile}.js | `hooks/*.js` | Yes | `casesApi`, `questionnairesApi` | Yes | — |
| SocketContext | `context/SocketContext.jsx` | Yes | `AuthContext`, `tokenStore` | Yes | Currently only consumed by the legacy `AdminPortal.jsx` (being deleted) — this is a portal-shaped capability with no live portal consumer today; keep it in ClientPortal for whenever messages/notifications go real-time there |

---

## 7. Shared code analysis

For each shared item: recommended option (A = duplicate into both, B = extract to a shared package, C = keep in one app + cross-import risk, D = not actually shared) with justification from actual import evidence.

| Shared item | Evidence | Recommendation | Reasoning |
|---|---|---|---|
| `services/api.js` (`tokenStore`, `request()`, refresh logic, + every `*Api` namespace) | 680 lines, one file, every page in the app imports from it | **Split the file along the Landing/ClientPortal seam, keep the low-level transport (`tokenStore`, `request()`, `API_BASE_URL`) as one small shared module (Option B), and split the domain namespaces (Option D — not actually shared per namespace).** | `authApi` genuinely needs to exist in both (Landing logs in; ClientPortal's `AuthGate`/`AuthContext` needs `me`/`sessionContext`/`logout`). Every other namespace (`leadsApi`, `eligibilityQuizApi`, `consultationApi`, `entityConfigApi`, `complianceApi`, `telemetryApi` vs. `casesApi`, `documentsApi`, `messagesApi`, `paymentsApi`, `questionnairesApi`, `employer/employeeProfileApi`) has exactly one real consumer side today — verified by the per-page dependency notes in §5/§6. Duplicating the entire 680-line file into both apps (Option A) would work short-term but guarantees drift the first time someone edits an endpoint in only one copy — explicitly against `AGENTS.md`'s "never duplicate APIs" principle. |
| `context/AuthContext.jsx` | Read by `AuthGate`, `MainLayout`, `Navbar`, `Login`, every portal page | **Option A now, reconsider B only if a third internal consumer appears** | This is the piece Admin/Attorney already solved a lighter version of via SSO + `/auth/me` bootstrap (see §12) — the pattern to copy is "each app keeps its own small AuthContext, backend is the shared source of truth," not a shared React package. A shared npm/workspace package for one context file is disproportionate at this codebase's current size (see workspace question below). |
| `utils/portalRedirect.js`, `utils/auth.js` (`isEmployeeAccount`), `utils/featureFlags.js` | Used by both `AuthGate` (portal) and `MainLayout`/`Navbar`/`Login` (Landing) | **Option A (duplicate, small files) — or B if a shared package is adopted for other reasons** | These are each under 50 lines; duplication cost is trivial compared to the coordination cost of a shared package for three files. |
| `context/ThemeContext.jsx`, `components/ThemeToggle.jsx` | Used by both `Navbar` and `PortalLayout` | **Option A** | Same reasoning — small, stable, low change-frequency. |
| `utils/iconComponents.jsx` | Used by `Home.jsx` (Landing) and portal/legacy-admin pages | **Option A** | Icon-only, no logic; trivial to duplicate or hand-split by actual usage. |
| `components/BrandMark.jsx` / favicon.svg pattern | Already duplicated three times today (Immiglance, Admin, Attorney each have their own `BrandMark.jsx` and `public/favicon.svg`, confirmed by direct file listing) | **Option A — continue the existing pattern, this is not a new problem** | The repo already chose "duplicate the brand mark per app" over a shared design-system package for three apps; a fourth copy for the ClientPortal split is consistent, not a regression. If Immiglance ever gets a real component library, this would be the first thing to extract — but that is a much larger, unrelated project. |
| `hooks/useHasCase.js` | Called by Landing (`Home.jsx`, `StartAssessmentButton`, `BlockIfHasCase`, `Navbar`) but hits a ClientPortal API (`casesApi.my()`) | **Option C — keep the hook in Landing, accept the cross-boundary API call over HTTP (not a source import)** | This is not actually a *code*-sharing problem — Landing already talks to the Backend over HTTP for everything; `useHasCase` calling `GET /cases/my` from the Landing app after a split is no different in kind from it calling `POST /leads/public`. The dependency is on the **Backend API contract**, not on ClientPortal's source code. No source-level sharing is needed here at all. |
| `Pages/Auth/LegacyHolding.jsx` | Content lives in Landing; the *decision* to redirect here is made by `AuthGate` in the (post-split) ClientPortal app | **Option C** | Cross-app `<Navigate>` to another origin's `/legacy-holding` route — same mechanism as the existing staff/attorney SSO bounce, just without a token (nothing sensitive to hand over). See §12. |
| Test files (`App.test.jsx`, `Documents.test.jsx`, `PasswordField.test.jsx`, `useQuestionnaireAnswers.test.js`, `questionnaireEngine.autofill.test.js`) | Colocated with the code they test | **Option D** | Move with whichever app owns the file under test; not a cross-cutting concern. |

**Is a shared package/workspace warranted?** No — not at this codebase's current size and coupling. The evidence:
- No workspace tooling exists today (confirmed in §9) across 4 apps that already share a Backend and an auth/SSO pattern; the team has already solved cross-app sharing at the **API contract** level (Backend) and the **URL/token-handoff** level (SSO), not via shared frontend source.
- The genuinely shared frontend surface after a split is small: `tokenStore`/`request()`/`authApi` (~150 lines), a handful of utils under 50 lines each, and one component (`BrandMark`) the team has already chosen to triplicate rather than share.
- Introducing a shared package (npm workspace or otherwise) for that surface adds a build/versioning/publish step to every one of the ~10-15 files involved, for a codebase where the existing pattern (small, independently-deployable apps that talk to a shared Backend and duplicate small bits of client code) already works and is what Admin/Attorney already do successfully.
- If Landing and ClientPortal later diverge less than expected, or a *third* app needs the same auth utilities, that's the signal to revisit — not now.

---

## 8. Import/dependency analysis

Traced via `grep` for `from "\.\./"`-style relative imports and cross-app path fragments across all four frontends' `src/`.

**Cross-app source imports: none found.** Specifically checked and confirmed:
- No file under `Admin/frontend/src` or `Attorney/src` imports anything from `Immiglance/Frontend/src` (or vice versa) via a relative path. The handful of files matching a plain-text grep for the string "Immiglance" in `Admin/frontend/src` and `Attorney/src` are **comments and brand-name strings** ("Landing point for the Immiglance redirect...", `<title>`/copy text), not imports.
- No `Immiglance/Frontend/src` file imports from `Admin/frontend/src` or `Attorney/src`.
- Every `../../../`-style deep-relative import found (all in `Attorney/src/pages/Cases/CaseDetail/*.jsx`) resolves within `Attorney/src` itself (`services/api`, `components/CaseStatusBadge`, `components/MessageThread`) — not a cross-app leak.

**Cross-app coupling that *does* exist — all at the URL/HTTP level, never source-level:**
- `Immiglance/Frontend/src/utils/portalRedirect.js` and `.../Pages/Auth/OAuthCallback.jsx` hard-code `VITE_ADMIN_URL`/`VITE_ATTORNEY_PORTAL_URL` and navigate the browser there with a bearer token in the query string.
- `Admin/frontend/src/pages/SSOHandler.jsx` and `Attorney/src/auth/SSOHandler.jsx` are the receiving ends — each calls its own `AuthContext.loginWithToken(token)`, which (per the code comment) verifies the token against the Backend's `/auth/me` before trusting it. No frontend ever imports another frontend's code to do this.
- All four frontends independently call the same Backend origin (`VITE_API_URL`), which is the actual shared surface.

**Dependency map (as built, not the prompt's illustrative one):**

```
                         ┌─────────────────────────┐
                         │        Backend           │  (single Express/Mongo API, :7000)
                         │  every *Api namespace,    │
                         │  /auth/me, /auth/sso-verify│
                         └───────────┬───────────────┘
              HTTP only ┌────────────┼────────────┐ HTTP only
                        │            │            │
        ┌───────────────▼───┐ ┌──────▼──────┐ ┌───▼─────────────┐
        │ Immiglance/Frontend│ │Admin/frontend│ │    Attorney      │
        │ (Landing+ClientPortal,│ │ (staff CRM)  │ │ (external counsel)│
        │  fused today)      │ │              │ │                  │
        └───────┬────────────┘ └──────┬───────┘ └────────┬─────────┘
                 │  cross-origin nav + token-in-URL, both directions
                 │  (portalRedirect.js → /auth/sso?token=...)
                 └───────────────────────┴──────────────────────────┘
```

Within Immiglance itself, the only "import" boundary today is the one described in §4/§7 — a single-app internal boundary between two route trees sharing `AuthContext`/`api.js`, not a real cross-app dependency.

---

## 9. package.json audit

| App | `name` field | Notable deps | Notable devDeps | Scripts | Dev port | Workspace tooling |
|---|---|---|---|---|---|---|
| Immiglance/Frontend | `ussv-frontend` (legacy, unrenamed) | React 19, react-router-dom 7, @tanstack/react-query 5, framer-motion, socket.io-client, @stripe/stripe-js, firebase, tailwindcss v4 | vite 8 (rolldown-vite), @vitejs/plugin-react 6, babel-plugin-react-compiler, vitest 4 | dev/build/preview/lint/test | 5173 (default, unset) | none |
| Admin/frontend | `inszoom-crm-frontend` (legacy, unrenamed) | React 18, react-router-dom 6, axios, recharts, @dnd-kit/*, @tiptap/*, pdfjs-dist, react-pdf, firebase, socket.io-client | vite 5, @vitejs/plugin-react 4, tailwindcss v3, @playwright/test, vitest 2 | dev (custom script)/build (custom script)/lint/test/test:e2e | 3002 (hard-coded in `scripts/vite-options.mjs`) | none |
| Attorney | `attorney` | React 18, react-router-dom 6, axios, firebase, lucide-react | vite 5, @vitejs/plugin-react 4, tailwindcss v3 | dev/build/preview/lint | 5174 (hard-coded in `vite.config.js`) | none |
| Backend | `immigration-crm-backend` | express, mongoose (implied by `src/models`), etc. (not itemized here — out of scope for a frontend split) | nodemon | dev/start/check/test + ~25 seed/migrate/verify scripts | 7000 (via `PORT` env, default) | none |
| Root | *(no name field)* | `@adobe/pdfservices-node-sdk` only | — | none | n/a | **Not a workspace** — no `workspaces` field, confirmed |

**Confirmed: no workspace/monorepo tooling anywhere in the repo** — no `pnpm-workspace.yaml`, `turbo.json`, or `nx.json` at any level (checked root and each app root).

**Splitting Immiglance into two apps: does it need a brand-new `package.json`?** No — the cleanest path is to **copy Immiglance/Frontend's current `package.json` verbatim into both new app folders**, then prune dependencies each side doesn't use (e.g. ClientPortal likely keeps `@stripe/stripe-js`, `socket.io-client`; Landing likely drops both once its own build no longer touches payments/realtime code — verify via actual bundle usage before pruning, don't guess). Both new apps should also **fix the legacy `name` field** while they're being created (e.g. `immiglance-landing`, `immiglance-client-portal` — note `Immiglance/package.json` at the parent level already uses the name `immiglance-client-portal` for its npm-script wrapper, so that exact string is already "spoken for" and whichever new app takes it should coordinate with that wrapper file, or the wrapper should be updated/retired in the same change).

---

## 10. Vite config audit

| App | Dev port | `base` | Aliases | Proxy | build.outDir | Plugins | SPA fallback |
|---|---|---|---|---|---|---|---|
| Immiglance/Frontend | unset (5173 default) | unset (`/` default) | none | `/api` → `localhost:7000`, `/socket.io` (ws) → `localhost:7000` | unset (`dist` default) | `@vitejs/plugin-react`, `@tailwindcss/vite`, `@rolldown/plugin-babel` w/ React Compiler preset | Not configured in `vite.config.js` — relies on whatever the production static host does (unknown from repo alone, see §14) |
| Admin/frontend | 3002 (explicit) | unset | none | `/api`, `/socket.io` (ws) — identical shape | unset | `@vitejs/plugin-react` only | Same — no in-repo SPA fallback config; `configFile: false` means this is the *entire* config, nothing inherited from a `vite.config.js` |
| Attorney | 5174 (explicit) | unset | none | `/api`, `/socket.io` (ws) — identical shape | unset | `@vitejs/plugin-react` only | Same |

**What would need to differ between a future Landing and ClientPortal config:** each needs its **own explicit `server.port`** (today Immiglance relies on Vite's 5173 default, which is fine for one app but two new apps must not collide — pick two explicit ports, e.g. 5173 for Landing and a new one, say 5175, for ClientPortal, avoiding 5174 which Attorney already owns). Both should keep the identical `/api` + `/socket.io` proxy block (copy verbatim). Neither currently sets `base` or `build.outDir` — if the eventual static-hosting/CI setup serves each app from its own subdomain root (matching the `client.`/`admin.` pattern already in prod), `base: '/'` (the default) remains correct for both; only revisit `base` if either app is ever served from a sub-path instead of a subdomain.

---

## 11. Routing audit

**Immiglance/Frontend `App.jsx`** — every route as actually written (not as previously assumed):

| Route | Wrapper | Classification |
|---|---|---|
| `/` | `MainLayout` (no `AuthGate`) | LANDING |
| `/eligibility` | redirect → `/eligibility/quiz` | LANDING |
| `/dashboard`, `/dashboard/profile`, `/dashboard/messages`, `/dashboard/plan`, `/dashboard/filing-type`, `/dashboard/payments`, `/dashboard/payments/success`, `/dashboard/payments/cancel`, `/dashboard/quickbooks`, `/dashboard/fedex`, `/dashboard/documents`, `/dashboard/documents/:caseId`, `/dashboard/document-review` | `AuthGate` + `PortalLayout` | CLIENT PORTAL |
| `/onboarding/intake` | `AuthGate` (no `PortalLayout`) | CLIENT PORTAL |
| `/dashboard/intake` | redirect → `/onboarding/intake` | CLIENT PORTAL (legacy alias) |
| `/legacy-holding` | none (deliberately public) | LANDING content, ClientPortal-driven redirect target |
| `/eligibility/quiz` | `BlockIfHasCase` (no `MainLayout`, no navbar) | LANDING |
| `/consultation/book/:leadId?`, `/consultation/booking/:token` | none | LANDING |
| `/login`, `/signup`, `/accept-invite`, `/forgot-password`, `/reset-password`, `/auth/callback` | none (no navbar) | LANDING/AUTH |
| `/admin`, `/admin/portal` | none | **Neither — legacy dead-weight, recommend deletion (§4, §17)** |

Correction to pre-investigation notes: `MainLayout` (and therefore the public navbar) wraps **only `/`** today, not the eligibility quiz or consultation booking as previously assumed — both of those are deliberately standalone, full-screen flows without the marketing navbar (confirmed by reading `App.jsx`'s own comments at lines 47-64 and 104-120).

**Admin/frontend `App.jsx`:** `/login`, `/auth/sso` public; everything else (`/dashboard`, `/leads`, `/crm-cases[/:id]`, `/messages[/:caseId|/user/:userId]`, `/companies`, `/leaderboard`, `/analytics`, `/uscis-forms`, `/case-managers[/:id]`, and more not fully enumerated here) sits under a `Layout` + per-route `ProtectedRoute module="..."` permission gate. All ADMIN.

**Attorney `App.jsx`:** `/login`, `/auth/sso` public; everything else (`/dashboard`, `/cases`, `/messages[/:caseId]`, `/tasks`, `/cases/:caseId/{overview,documents,forms,petition,tracking,feedback,timeline}`) sits under `RequireAttorney` + `AppLayout`. All ATTORNEY.

**Routes that would break or need a redirect shim if Immiglance splits:**
- `/dashboard/intake` → currently a same-app `<Navigate>` to `/onboarding/intake`. Post-split, `/onboarding/intake` lives in ClientPortal while a client might still have `/dashboard/intake` bookmarked from a Landing-origin link somewhere — this specific redirect must be preserved (moved into ClientPortal's own router, since both source and target are ClientPortal-side).
- `/eligibility` → `/eligibility/quiz` redirect stays entirely within Landing — no cross-app concern.
- Any bookmark to `/dashboard/*` hitting the **Landing** origin post-split (e.g. an old email link, a saved bookmark from before the split) will 404 unless Landing keeps a catch-all redirect to ClientPortal's origin for `/dashboard/*` and `/onboarding/*` paths. This needs an explicit redirect shim — see §19.
- `/admin`, `/admin/portal` → moot if deleted per §4/§17; if *not* deleted before the split, someone must decide which new app inherits this dead code (recommend: delete instead of deciding).

---

## 12. Authentication file placement

| File | Current app | Current role | Recommendation if Immiglance splits |
|---|---|---|---|
| `Backend`'s auth module (`/auth/login`, `/auth/register`, `/auth/me`, `/auth/session-context`, `/auth/refresh`, `/auth/logout`, `/auth/google*`, `/auth/invite/*`, `/auth/forgot-password`, `/auth/reset-password`) | Backend | Single source of truth for credentials, tokens, and role/session-context resolution | **No change.** Both Landing and ClientPortal call the same Backend origin; this is the actual "shared auth" layer the whole 4-app system already depends on. |
| `context/AuthContext.jsx` | Immiglance/Frontend (shared internally) | Holds `user`/`sessionContext`/`authStatus`, exposes `login`/`signup`/`logout`/`acceptInvite`/`loginWithGoogle`/`setUserFromOAuth` | **Landing owns the "real" login/signup/OAuth/invite flows** (the ones that call `POST /auth/login` etc. directly). **ClientPortal needs its own, smaller `AuthContext`** that, like Admin's and Attorney's already do, silently bootstraps a session from the shared refresh-token cookie / an SSO token in the URL, then calls `GET /auth/me` + `GET /auth/session-context` to hydrate — mirroring the exact pattern already proven by Admin/Attorney's `SSOHandler.jsx` + `loginWithToken()`. This is architecture guidance only — not something this investigation implements. |
| `components/AuthGate.jsx` | Immiglance/Frontend | Sole routing authority for protected client routes; also currently fires the staff/attorney cross-app bounce | **Moves to ClientPortal** (it protects `/dashboard/*`/`/onboarding/intake`, both ClientPortal routes). The staff/attorney bounce logic it contains today is really Landing's concern too (see `MainLayout` row below) — after a split, ClientPortal's `AuthGate` still needs it for the case where a staff/attorney session somehow lands directly on a ClientPortal URL (e.g. a stale bookmark), exactly as `MainLayout` needs it for a stale bookmark to `/`. |
| `layout/MainLayout.jsx`'s bounce effect | Immiglance/Frontend | Redirects an already-authenticated staff/attorney session away from the public marketing site | **Stays in Landing.** This is Landing's own copy of the same defensive check `AuthGate` does — both are needed independently after a split since they're different apps now, not just different route trees. |
| `Pages/Auth/Login.jsx` (all three role tabs) | Immiglance/Frontend | Single login form; role decides destination post-login via `AuthGate`, never the tab clicked | **Moves to Landing entirely**, including the attorney/team-member tabs. This is the one piece of architecture guidance most worth calling out explicitly: **Login must live in Landing (the always-public, never-behind-a-gate app)**, even though it authenticates staff and attorney accounts that then get bounced elsewhere — because Login itself must be reachable by a completely anonymous visitor, which by definition means it cannot live in an app that assumes a session might already exist. ClientPortal, Admin, and Attorney all then rely on the token-handoff/cookie-bootstrap pattern to *receive* an authenticated session rather than *originate* one — Admin and Attorney already do this today via their own tiny `/login` pages (kept as a fallback / direct-role entry) plus `/auth/sso`; ClientPortal should adopt the identical shape. |
| `services/api.js`'s `tokenStore`/`request()`/`authApi` | Immiglance/Frontend | In-memory access token + `hasSession()` localStorage marker + httpOnly refresh cookie; the transport every other namespace rides on | **Duplicate the transport into both** (Option B-lite per §7) — both apps need `tokenStore`/`request()`; only Landing needs the full `authApi.login`/`register`/`forgotPassword`/`resetPassword`/`acceptInvite` surface, ClientPortal only needs `authApi.me`/`sessionContext`/`logout`/`changePassword`. |
| `Pages/Auth/OAuthCallback.jsx` | Immiglance/Frontend | Lands a backend-mediated Google OAuth round trip, calls `setUserFromOAuth`, navigates to `/dashboard` | **Stays in Landing** (it's the receiving end of a flow that starts from Landing's own `loginWithGoogle()`), but its `navigate("/dashboard")` now points at a **different app's origin** post-split — this must become a cross-origin `window.location.href` to ClientPortal (ideally reusing the exact SSO-token-handoff mechanism `portalRedirect.js` already uses for staff/attorney, rather than inventing a second mechanism) rather than a same-app React Router `navigate()`. This is a concrete, named breaking point — see §19. |
| `utils/portalRedirect.js` (`STAFF_ROLES`, `redirectToOwnPortal`) | Immiglance/Frontend | The one place `ADMIN_URL`/`ATTORNEY_PORTAL_URL` and the token-handoff mechanism are defined, shared by `AuthGate` and `MainLayout` | **Duplicate into both Landing and ClientPortal** (each needs to bounce a staff/attorney session that lands on it), **and extend it with a third destination**: ClientPortal's own URL, for Landing to hand a freshly-authenticated *client* session to, replacing today's same-app `navigate("/dashboard")`. |
| `Pages/Auth/AcceptInvite.jsx` + `AuthGate`'s `mustSetPassword` branch | Immiglance/Frontend (split across two files today) | `AuthGate` redirects to `/accept-invite` for any session with `mustSetPassword: true`, before any other routing decision | **`AcceptInvite.jsx` moves to Landing; the `mustSetPassword` check in `AuthGate` stays in ClientPortal** — meaning post-split, ClientPortal's `AuthGate` must redirect **cross-origin** to Landing's `/accept-invite` instead of a same-app `<Navigate>`, exactly the same shape as the `LegacyHolding`/staff-bounce cases above. This is a second concrete, named breaking point. |
| Admin's `SSOHandler.jsx` + `AuthContext.loginWithToken` | Admin/frontend | Receiving end of Immiglance's staff bounce | **No change** — already correct pattern to copy. |
| Attorney's `SSOHandler.jsx` + `AuthContext.loginWithToken` (`Attorney/src/auth/AuthContext.jsx`) | Attorney | Receiving end of Immiglance's attorney bounce | **No change** — already correct pattern to copy. |

**Summary of the guidance (explicitly architecture-only, not implemented here):** Landing is the only app that originates a session (login/signup/OAuth/invite-accept/password-reset); every other app (ClientPortal, Admin, Attorney) only ever *receives* one, either via the existing SSO-token-in-URL handoff or a silent cookie-based `/auth/me` bootstrap on load. This is not a new pattern to invent — it's the exact pattern Admin and Attorney already validated in production-shaped code; ClientPortal just needs to become the third app that uses it instead of being the one place login logic and protected routes coexist.

---

## 13. Environment configuration audit

**Every `.env*` file found, and every var name (no values reproduced beyond what's already non-sensitive/public-facing) — grouped by app:**

**Immiglance/Frontend** (`.env`, `.env.example`):
`VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_API_URL`, `VITE_FIREBASE_VAPID_KEY`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_ATTORNEY_PORTAL_URL`, `VITE_ADMIN_URL`.

⚠️ **Local `.env` inconsistency found:** `VITE_ADMIN_URL` in the checked-in local `.env` is set to the **production** value (`https://admin.bayareaimmigrationservices.com`), while `VITE_ATTORNEY_PORTAL_URL` in the same file is `http://localhost:5174`. A developer running Immiglance locally today gets staff-role SSO redirects sent to the live production Admin app instead of their local Admin dev server, while attorney-role redirects correctly go local. This predates and is unrelated to any Landing/ClientPortal split, but both new apps will inherit this file verbatim unless someone fixes it during the split — worth doing at the same time.

**Admin/frontend** (`.env`, `.env.example`): `VITE_API_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY`. (No `VITE_ADMIN_URL`/`VITE_ATTORNEY_PORTAL_URL` needed here — Admin never redirects *to* another portal today.)

**Attorney** (`.env`, `.env.development`): `VITE_API_URL`, `VITE_ATTORNEY_PORTAL_URL` (points at itself — used somewhere as a self-referential base, not investigated further as out of scope), plus the identical Firebase var set.

**Backend** (`.env`, `.env.example` — identical key sets in both): `MONGODB_URI`, `PORT`, `NODE_ENV`, `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES`, `REFRESH_TOKEN_TTL_DAYS`, `BCRYPT_ROUNDS`, `CLIENT_URL`, `CLIENT_URLS`, `ATTORNEY_PORTAL_URL`, `DEBUG_ERRORS`, `EXPOSE_INTERNAL_ERRORS`, `EMAIL_FROM`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI`, Firebase Admin SDK vars (`FIREBASE_*`), Google service-account/Document AI/Gemini vars, AWS S3 vars, Adobe PDF Services vars, `STORAGE_PROVIDER`/`STORAGE_ENCRYPTION_KEY`/`UPLOAD_DIR`/`MAX_FILE_SIZE`, `QPDF_PATH`, `USCIS_ONDEMAND_AUTOACTIVATE`.

Confirmed via `Backend/src/config/env.js`: CORS/allowed-origins resolve from `CLIENT_URLS` (preferred) → `ALLOWED_ORIGINS` → `CLIENT_URL` → a localhost default. Production `Backend/.env`'s `CLIENT_URLS` currently lists: `https://client.bayareaimmigrationservices.com, https://admin.bayareaimmigrationservices.com, http://localhost:3002, http://localhost:5173, http://localhost:5174` — **note there is no production Attorney origin in this list**, only its localhost dev port. `ATTORNEY_PORTAL_URL` (a separate, single-value var used for a different purpose per the file's own comment) is likewise still `http://localhost:5174` in the checked-in `.env`.

**What a Landing/ClientPortal split needs, env-var-wise (new vars, not yet present anywhere):**
- Landing needs `VITE_CLIENT_PORTAL_URL` (or similarly named) — today it has no reason to know ClientPortal's URL because they're the same app; post-split, Login/OAuthCallback/AcceptInvite-redirect-target logic all need it to hand a freshly-authenticated client off to ClientPortal, exactly as `portalRedirect.js` already does for Admin/Attorney.
- ClientPortal needs `VITE_LANDING_URL` — for the reverse direction: logout redirect, the `mustSetPassword`/legacy-holding cross-origin redirects identified in §12, and any `/dashboard/*` bookmark caught by a redirect shim (§19).
- Both new apps keep `VITE_ADMIN_URL`/`VITE_ATTORNEY_PORTAL_URL` (for the staff/attorney bounce, which both Landing's `MainLayout`-equivalent and ClientPortal's `AuthGate` need independently per §12).
- Backend's `CLIENT_URLS` needs a new entry for whichever origin ends up serving Landing (today's Immiglance origin can likely keep serving Landing, meaning ClientPortal is the *new* origin needing a `CLIENT_URLS` entry) — plus, independent of this split, a real production Attorney origin is currently missing entirely.

---

## 14. Deployment audit

**Only one CI/CD artifact exists in the repo:** `.github/workflows/inszoom-cicd.yml`. Findings, read directly from the file:

- Triggers on push to `main` only.
- Builds **Immiglance/Frontend** and **Admin/frontend** (`npm ci --include=optional` + `npm run build` in each), tars each `dist/`, uploads both to one S3 bucket (`inszoom-bucket`, key prefix `inszoom-deploy/`), generates presigned URLs, then uses AWS SSM `send-command` to SSH-less-remote-exec into one EC2 instance, which: downloads both tarballs, extracts Immiglance's into `/home/ubuntu/INSZoom/Immiglance/Frontend/dist`, `git pull`s the Backend repo in place, extracts Admin's into `/home/ubuntu/INSZoom/Admin/frontend/dist`, `npm ci --omit=dev`s the Backend, and restarts a PM2 process named `inszoom-backend`.
- **The Attorney app is completely absent from this workflow** — no build step, no artifact, no deploy target. Nothing in the repo builds or serves it in production today; it is dev-only as far as CI/CD is concerned. This matches the Backend `CLIENT_URLS` finding in §13 (no production Attorney origin allowlisted either) — both pieces of evidence agree the Attorney portal was added to the codebase without a production deployment path yet.
- ⚠️ **Env var name mismatch, potential live bug:** the workflow's "Build Immiglance Frontend" step injects `VITE_INSZOOM_URL: ${{ secrets.BAIS_VITE_INSZOOM_URL }}` into the build environment. But the actual frontend code (`portalRedirect.js`, `OAuthCallback.jsx`, `Register.jsx`) all read `import.meta.env.VITE_ADMIN_URL`, not `VITE_INSZOOM_URL`. Unless a GitHub Actions secret named `BAIS_VITE_ADMIN_URL` was *also* added and this workflow file simply wasn't updated to also pass it, every production build of Immiglance ships with `VITE_ADMIN_URL` undefined, which `portalRedirect.js`'s own code comment says will cause `console.error` and a broken staff-login redirect to a dead `localhost:3002` for real visitors. **This repo alone cannot confirm which secrets exist on the GitHub side** — this is flagged as a "verify before/independent of this migration" item, not a confirmed-live incident, per the instruction to say so explicitly rather than guess. It is unrelated to the Landing/ClientPortal split itself but the split will touch this exact file and env var, so it should be checked at the same time.
- No Dockerfile, docker-compose, or Nginx config exists anywhere in the repo (confirmed by search) — the actual static-file-serving/reverse-proxy layer in front of these three EC2-hosted `dist/` folders is **not visible from this repository** and cannot be audited here. This is stated explicitly rather than guessed, per instructions.

**Could the current deployment setup support 4 independently-deployable frontends?** Not without changes, and the changes needed are almost entirely in the pipeline, not the application code:
1. Add a third (Attorney) and, post-split, fourth (ClientPortal) build+package+upload+extract block to the workflow, following the exact pattern the existing two already use.
2. Add production origins for Attorney (and post-split, ClientPortal) to Backend's `CLIENT_URLS`.
3. Resolve the `VITE_INSZOOM_URL`/`VITE_ADMIN_URL` naming mismatch above before or during the same change, since it's in the exact file being edited anyway.
4. Decide/confirm the reverse-proxy/static-hosting layer's routing (unknown from repo alone) can serve a 4th distinct subdomain — this cannot be verified here.

---

## 15. Recommended VS Code architecture

**Nested `Immiglance/Landing/` + `Immiglance/ClientPortal/` vs. flat `apps/landing`, `apps/client-portal`, `apps/admin`, `apps/attorney`?**

**Recommendation: nested, under the existing `Immiglance/` folder.** Reasoning, grounded in what was actually found rather than a general monorepo-hygiene preference:

- A flat `apps/*` layout would require moving **all four** apps (`Admin/frontend` → `apps/admin`, `Attorney` → `apps/attorney`, plus the two new Immiglance halves) to be internally consistent — otherwise you'd end up with a `apps/landing`, `apps/client-portal` next to an un-migrated `Admin/` and `Attorney/` at the old top level, which is a worse, half-migrated state than what exists today.
- Moving `Admin/frontend` and `Attorney` has a real, itemized cost with no offsetting benefit found anywhere in this investigation: it would break the CI/CD workflow's hard-coded paths (`Admin/frontend`, working-directory steps), every developer's local muscle memory, VS Code's saved terminal/task paths, and — per the user's own instruction to default to "leave it alone unless there's a concrete reason" — no concrete reason was found. The user's own prompt anticipated exactly this answer ("default answer should be leave them alone").
- Nesting under `Immiglance/` costs nothing extra: `Immiglance/` already exists purely as a thin wrapper (`Immiglance/package.json` just delegates `npm run dev` etc. into `Frontend/`) — it can delegate into `Landing/` and `ClientPortal/` instead with a two-line change to that one wrapper file, and every other app's path stays byte-for-byte identical, meaning **zero** changes needed to `.github/workflows/inszoom-cicd.yml`'s Admin-related steps or Backend's CORS config for Admin/Attorney.

**Should `Admin/frontend` and `Attorney` be renamed/moved?** **No**, for both:
- **`Attorney`**: no nested subfolder exists or is needed; it's already a clean, flat, single-purpose app folder. No change recommended.
- **`Admin/frontend`**: the nested `frontend/` subfolder is, on the evidence, **not justified by a sibling `Admin/backend/`** — no such folder exists; the shared `Backend/` at the repo root already serves Admin, exactly as it serves every other app. In isolation, `Admin/frontend/` is one level deeper than it needs to be (`Admin/` directly containing the app would be more consistent with `Attorney/`). **However**, per the user's explicit, stated preference to minimize unnecessary churn, and because this nesting is now load-bearing in three independent places — the CI/CD workflow's `working-directory: Admin/frontend` steps and remote EC2 paths, every `.env`/cache-dependency-path reference, and (per `AGENTS.md`'s own note) the deliberate choice made when INSZoom was renamed to Admin — the recommendation is **leave it as-is**. The nesting is vestigial relative to a from-scratch design, but it is not costing anything actively broken, and "flattening it to match Attorney" would be pure churn for a cosmetic consistency win, which is explicitly the kind of change the user asked this investigation to avoid recommending without a concrete reason.

---

## 16. Before → After folder tree

**Before (actual, as discovered):**
```
Immiglance/
├── package.json                # wrapper, delegates into Frontend/
└── Frontend/                   # ONE app = Landing + ClientPortal fused
    ├── package.json (ussv-frontend)
    ├── vite.config.js
    ├── .env
    └── src/
        ├── Pages/{Dashboard (incl. public Home.jsx!), Auth, Eligibility, Consultation, Admin (legacy, dead)}
        ├── components/{eligibility, consultation, checklist, questionnaire, auth, ...}
        ├── layout/{MainLayout, PortalLayout}
        ├── context/{AuthContext, SocketContext, ThemeContext}
        ├── hooks/, services/{api.js, notificationService.js}, utils/, config/, assets/
```

**After (recommended):**
```
Immiglance/
├── package.json                # wrapper, delegates into Landing/ and ClientPortal/
├── Landing/                     # public marketing + all session-origination auth flows
│   ├── package.json (new name, e.g. "immiglance-landing")
│   ├── vite.config.js (explicit port, e.g. 5173)
│   ├── .env  (VITE_API_URL, VITE_ADMIN_URL, VITE_ATTORNEY_PORTAL_URL, VITE_CLIENT_PORTAL_URL [new], Firebase, Stripe pub key if Register/Home ever need it)
│   └── src/
│       ├── Pages/{Marketing/Home.jsx (renamed out of Dashboard/), Auth/{Login,Register,ForgotPassword,ResetPassword,AcceptInvite,OAuthCallback,LegacyHolding}, Eligibility/, Consultation/}
│       ├── components/{Navbar, BrandMark, PageLoader, eligibility/, consultation/, auth/PasswordField, StartAssessmentButton}
│       ├── layout/MainLayout.jsx
│       ├── context/{AuthContext (full, origination-capable), ThemeContext}
│       ├── hooks/useHasCase.js
│       ├── services/api.js (tokenStore/request/authApi + leads/eligibilityQuiz/consultation/entityConfig/compliance/telemetry Api)
│       └── utils/{auth.js, portalRedirect.js (+ClientPortal target), featureFlags.js, eligibilitySession.js, iconComponents.jsx}
└── ClientPortal/                 # authenticated case management only
    ├── package.json (new name, e.g. "immiglance-client-portal" — coordinate with existing Immiglance/package.json's name field)
    ├── vite.config.js (explicit port, e.g. 5175)
    ├── .env  (VITE_API_URL, VITE_ADMIN_URL, VITE_ATTORNEY_PORTAL_URL, VITE_LANDING_URL [new], Firebase, Stripe pub key)
    └── src/
        ├── Pages/Dashboard/{Dashboard,Profile,Documents,DocumentReview,Messages,Payments,PaymentSuccess,PaymentCancel,PlanSelection,FilingTypeSelection,QuickBooks,FedEx,Intake}
        ├── components/{checklist/, questionnaire/, ApplicantTypeSelector, ThemeToggle, BrandMark (own copy)}
        ├── layout/PortalLayout.jsx
        ├── context/{AuthContext (bootstrap-only, SSO+cookie), SocketContext, ThemeContext}
        ├── components/AuthGate.jsx
        ├── hooks/{useCaseChecklists, useCaseDocumentChecklist, useDocumentChecklist, useQuestionnaireAnswers, useMyCaseProfile}
        ├── services/api.js (tokenStore/request/authApi[me/sessionContext/logout] + cases/documents/messages/payments/questionnaires/employer/employeeProfile Api)
        ├── config/{planConfig, pricingCatalog, visaConfig, visaEligibility, visaTypeCanonical}
        └── utils/{auth.js, portalRedirect.js (+Landing target), caseStatusLabel.js, checklistStatus.jsx, dedupeChecklistSections.js, questionnaireEngine.js, visaDisplay.js}

Admin/frontend/    ← unchanged
Attorney/          ← unchanged
Backend/           ← unchanged, + new CLIENT_URLS entries for ClientPortal (and ideally a real Attorney prod origin, independent of this split)
docs/, .github/workflows/inszoom-cicd.yml  ← unchanged structurally, but the workflow gains a 3rd/4th build+deploy block (§14) and the VITE_INSZOOM_URL/VITE_ADMIN_URL naming should be resolved in the same pass
```

`Pages/Admin/*` (AdminLogin/AdminPortal/LeadsInbox) does not appear in the "after" tree at all — recommended for deletion per §4/§17, as a decision to make explicitly before or alongside the split, not silently carried into either new app.

---

## 17. File movement plan

| Current path | Future path | Action | Reason | Dependency risk |
|---|---|---|---|---|
| `Pages/Dashboard/Home.jsx` | `Landing/src/Pages/Marketing/Home.jsx` | MOVE + rename folder | Public homepage misfiled under `Dashboard/` | Low — self-contained, only imports Landing-side utilities |
| `Pages/Auth/{Login,Register,ForgotPassword,ResetPassword,AcceptInvite,OAuthCallback,LegacyHolding}.jsx` | `Landing/src/Pages/Auth/*` | MOVE | All public/session-origination | Medium — `OAuthCallback`/`AcceptInvite` need their post-action redirects rewritten to cross-origin `window.location.href` targets (§12, §19) |
| `Pages/Eligibility/*`, `Pages/Consultation/*` | `Landing/src/Pages/*` | MOVE | Confirmed zero portal dependency | Low |
| `Pages/Admin/*` (AdminLogin, AdminPortal, leads/LeadsInbox) | *(none)* | **DELETE** | Legacy duplicate of real `Admin/frontend`; violates `AGENTS.md` | Low to delete; verify nothing else links to `/admin` first (only `Home.jsx`'s footer "Staff Login" link and `Navbar`'s absence of it — grep confirms only `Home.jsx:547` links to `/admin`) |
| `Pages/Dashboard/{Dashboard,Profile,Documents,DocumentReview,Messages,Payments,PaymentSuccess,PaymentCancel,PlanSelection,FilingTypeSelection,QuickBooks,FedEx,Intake}.jsx` | `ClientPortal/src/Pages/Dashboard/*` | MOVE | Confirmed case-scoped, `AuthGate`-only | Low — internal imports are already portal-only |
| `components/{Navbar,BrandMark,PageLoader,StartAssessmentButton,eligibility/*,consultation/*,auth/*}` | `Landing/src/components/*` | MOVE | Landing-only usage confirmed | Low |
| `components/{AuthGate,checklist/*,questionnaire/*,ApplicantTypeSelector}` | `ClientPortal/src/components/*` | MOVE | Portal-only usage confirmed | Low |
| `components/ProtectedRoute.jsx` | *(none)* | **DELETE** | Confirmed dead code, superseded by `AuthGate` per `App.jsx`'s own comment | Low — verify zero remaining imports before deleting (already confirmed via grep) |
| `components/{BenefitCard,InfoPopup,StepCard}.jsx` | *(none)* | **DELETE** | Confirmed zero importers anywhere | Low |
| `components/{ThemeToggle,NotificationBell,NotificationPreferencesCard}.jsx` | DUPLICATE into both `Landing/` and `ClientPortal/` | DUPLICATE | Genuinely used on both sides (§7); small enough to duplicate | Low |
| `layout/MainLayout.jsx` | `Landing/src/layout/MainLayout.jsx` | MOVE | — | Low |
| `layout/PortalLayout.jsx` | `ClientPortal/src/layout/PortalLayout.jsx` | MOVE | — | Low |
| `context/AuthContext.jsx` | SPLIT — full version to `Landing/`, bootstrap-only version to `ClientPortal/` | SPLIT | Per §12 guidance; not a mechanical move | **Medium/High** — this is the one file whose logic genuinely needs to change shape, not just relocate (new SSO-bootstrap path for ClientPortal has no equivalent in the current file to copy from directly — it must be newly written, modeled on Admin/Attorney's existing `AuthContext`s) |
| `context/SocketContext.jsx` | `ClientPortal/src/context/SocketContext.jsx` | MOVE | Only real consumer (legacy AdminPortal) is being deleted; kept for future portal real-time features | Low |
| `context/ThemeContext.jsx` | DUPLICATE into both | DUPLICATE | Used on both sides | Low |
| `services/api.js` | SPLIT into `Landing/src/services/api.js` and `ClientPortal/src/services/api.js`, each keeping only its own `*Api` namespaces + a shared-shape `tokenStore`/`request()` | SPLIT | Per §7/§9 | **Medium** — mechanical but must be done carefully; the `request()`/refresh-token logic must be byte-identical in both copies or auth behavior silently diverges over time |
| `services/notificationService.js` | `ClientPortal/src/services/notificationService.js` | MOVE | Portal-shaped concern; verify Landing's login flows still function without FCM registration firing (currently fires on every login regardless of role — check whether Landing needs a stub or can safely drop the call) | Medium |
| `utils/{auth.js,portalRedirect.js,featureFlags.js}` | DUPLICATE into both | DUPLICATE | Per §7/§12 | Low |
| `utils/postLoginDest.js` | *(none)* | **DELETE** | Confirmed dead code (file's own header says so) | Low |
| `utils/{eligibilitySession,localDateKey}.js` | `Landing/src/utils/*` | MOVE | — | Low |
| `utils/{caseStatusLabel,checklistStatus,dedupeChecklistSections,questionnaireEngine,visaDisplay}.js` | `ClientPortal/src/utils/*` | MOVE | — | Low |
| `utils/iconComponents.jsx` | DUPLICATE into both | DUPLICATE | Used by both `Home.jsx` (Landing) and portal pages | Low |
| `config/*.js` | `ClientPortal/src/config/*` | MOVE | — | Low |
| `hooks/useHasCase.js` | `Landing/src/hooks/useHasCase.js` | MOVE (keep calling Backend's `/cases/my` over HTTP, no source dependency on ClientPortal) | Per §7 | Low |
| `hooks/{useCaseChecklists,useCaseDocumentChecklist,useDocumentChecklist,useQuestionnaireAnswers,useMyCaseProfile}.js` | `ClientPortal/src/hooks/*` | MOVE | — | Low |
| `assets/images/client-portal/*` | `Landing/src/assets/*` (rename out of the misleading `client-portal` folder name) | MOVE + rename | These are marketing illustration images, not portal screenshots (§4) | Low |
| `assets/admin-login-liberty.{png,webp}` | `Landing/src/assets/*` | MOVE | Used by `Register.jsx` (Landing) | Low |
| Test files colocated with moved code | Move alongside their subject file | MOVE | — | Low |
| `Immiglance/package.json` (wrapper) | *(same path)* | **EDIT** (out of scope for this read-only investigation, but flagged) | Needs its `dev`/`build`/etc. scripts updated to target `Landing/`/`ClientPortal/` instead of `Frontend/` | Low, mechanical |

---

## 18. Files/directories that must NOT move

- **`Backend/` in its entirety.** It is the single shared API for all four frontends; nothing in this migration touches it structurally (only `CLIENT_URLS` gains new entries, per §13).
- **`Admin/frontend/` and `Attorney/`** — per §15, no concrete reason found to move or rename either; both have hard-coded path references in `.github/workflows/inszoom-cicd.yml` and (for Admin) a custom `scripts/vite-options.mjs` build pipeline that would need updating for no functional gain.
- **`.github/workflows/inszoom-cicd.yml`'s existing Admin-related steps** (working directories, S3 keys, EC2 paths) — these must stay pointed at `Admin/frontend` exactly as they are; only new steps should be *added* for the Attorney/ClientPortal builds, not the existing ones rewritten.
- **`docs/architecture/*`** (dependency-graph.json, MODULE-CARDS.md, etc.) — these describe the Backend's module graph and are keyed to Backend file paths, not Immiglance frontend paths; unaffected by this split, do not move.
- **Anything under `Backend/src/modules/*` that returns absolute or relative URLs pointing at "the frontend"** (e.g. Stripe checkout success/cancel URLs, the Google OAuth redirect target, invite-email links, password-reset email links, consultation-booking email links) — these are **not files that move**, but they are **hard-coded-URL dependencies on Immiglance's current single origin** that must be located and updated as part of the split (not identified/enumerated exhaustively here — out of scope for a frontend-focused investigation — but flagged as a required Backend-side audit before cutover, since a moved/renamed frontend route is invisible to Backend code that only knows a base URL string).
- **`Immiglance/Frontend/index.html`'s any hard-coded absolute asset paths or meta tags** — not verified line-by-line in this investigation; check before deleting the old `Frontend/` folder.

---

## 19. Breaking-point analysis

Concrete, file-cited list of what would break and why:

1. **`services/api.js`'s single `tokenStore`** — if Landing and ClientPortal ship two independently-maintained copies of `tokenStore`/`request()` (§7, §17) and they ever drift (e.g. one gets a bugfix the other doesn't), a user could see inconsistent session-expiry behavior between the two apps. Mitigation: treat this file as the one piece of "shared code" that gets copy-reviewed on every future change to either copy, or promote it to a real shared package the day a third internal consumer needs it (§7).
2. **`Pages/Auth/OAuthCallback.jsx`'s post-login `navigate("/dashboard")`** (line ~61 in the version read) — today a same-app React Router navigation; post-split this target lives in a different app/origin entirely. Must become a `window.location.href` to ClientPortal's URL, reusing the SSO-token-handoff shape (§12). If missed, a client who signs up via Google OAuth lands on a 404/blank page in Landing after authenticating.
3. **`AuthGate.jsx`'s `mustSetPassword` → `/accept-invite` redirect** and **`isLegacyNoCaseAccount` → `/legacy-holding` redirect** (both currently same-app `<Navigate>`) — both targets move to Landing. Both must become cross-origin redirects. If missed, an invited employee or a flagged legacy account gets a 404 inside ClientPortal instead of the page that's supposed to help them.
4. **`App.jsx`'s `/dashboard/intake` → `/onboarding/intake` alias** — both ends stay in ClientPortal, so this one is low-risk, but must not be forgotten when the router file is split apart, since it's easy to drop a single redirect line during a large file split.
5. **Stale bookmarks/links to `/dashboard/*` hitting Landing's origin post-split** — anything that emailed a client a direct `/dashboard`-style link (case-status emails, notification emails, etc. — not enumerated here, Backend-side) will resolve against Landing's origin unless Landing keeps a wildcard redirect for `/dashboard/*` and `/onboarding/*` to ClientPortal's origin. Needs an explicit `<Route path="/dashboard/*" element={<RedirectToClientPortal/>} />`-style shim in Landing's router.
6. **`portalRedirect.js`'s `ADMIN_URL`/`ATTORNEY_PORTAL_URL` env-var reads, duplicated into two new files** — if only one of the two duplicated copies gets a new `VITE_LANDING_URL`/`VITE_CLIENT_PORTAL_URL` var added correctly, the staff/attorney bounce keeps working from one app but silently breaks from the other. Cross-check both copies against each other after the split, not just against the original.
7. **The `VITE_INSZOOM_URL`/`VITE_ADMIN_URL` CI/CD mismatch (§14)** — pre-existing, but the split will necessarily touch this exact build step (it's about to become two build steps instead of one), making this the natural moment to verify/fix it. If not verified, both new apps' production builds could ship with the same broken staff-redirect env var.
8. **`AuthContext.jsx`'s split into a "full" (Landing) and "bootstrap" (ClientPortal) version** — this is the highest-effort, highest-risk single item in the whole plan (also flagged in §17). ClientPortal's new `AuthContext` has no direct ancestor to copy wholesale; it must be newly written by combining (a) the session-verification/`sessionContext` logic from today's `AuthContext.jsx` and (b) the SSO-token-bootstrap logic from Admin's or Attorney's existing `AuthContext`. Getting this wrong risks exactly the class of bug the code comments in `AuthContext.jsx`/`AuthGate.jsx` describe having already fixed once (session state flapping between loading/authenticated/error on slow-backend responses) — the new file must preserve those same safeguards (`autoRetry`, distinguishing a 401 from a network error, etc.), not just the happy path.
9. **`assets/images/client-portal/*` folder rename** — purely cosmetic, zero functional risk, but included here because leaving the misleading name in place after the split (now genuinely inside `Landing/`) would preserve exactly the kind of confusion this investigation was asked to resolve, not just document.
10. **SPA fallback / static hosting for a 4th subdomain** — cannot be verified from the repo (no Nginx/host config present, §14); explicitly flagged as unknown rather than assumed to "just work."
11. **BrandMark/favicon duplication becoming 4-way** — no functional risk (the pattern already works 3 ways today), just a maintenance note: a future logo change requires editing 4 copies, not 3.
12. **Backend hard-coded frontend URLs in emails/Stripe/OAuth** (§18's last bullet) — not a frontend file-move risk, but the single most likely "silent" breakage: a Backend email template or Stripe checkout config pointing at the pre-split Immiglance origin for a link that now needs to point at ClientPortal specifically won't error at build or deploy time — it will only surface when a real user clicks a stale link in production.

---

## 20. Migration phases (plan only — not executed)

**Phase 0 — Pre-work / verification (no app code changes):**
- Resolve the `VITE_INSZOOM_URL` vs `VITE_ADMIN_URL` CI/CD discrepancy (§14) — confirm which GitHub secret(s) actually exist and fix the workflow env-var name to match the code, independent of the split.
- Fix the local `.env` `VITE_ADMIN_URL`-pointing-at-production inconsistency (§13).
- Grep the Backend for every hard-coded frontend URL (email templates, Stripe success/cancel URLs, Google OAuth redirect target, invite/reset-password email links, consultation-booking email links) and produce an inventory of what needs a new "which app does this link to" decision post-split (§18).
- Decide and get sign-off on deleting `Pages/Admin/*` (legacy embedded admin) — confirm nothing beyond `Home.jsx`'s one footer link references `/admin`.

**Phase 1 — Scaffold, no behavior change yet:**
- Create `Immiglance/Landing/` and `Immiglance/ClientPortal/` as empty Vite apps (copied `package.json`/`vite.config.js`/`index.html` from today's `Frontend/`, per §9/§10), each with its own explicit dev port.
- Do not touch `Frontend/` yet — it keeps running exactly as today throughout Phase 1 and 2.

**Phase 2 — Move Landing-classified files (§5, §17) into `Landing/`, keep `Frontend/` as the source of truth still running in parallel:**
- Copy (not move-and-delete yet) Landing files into `Landing/`, rename `Home.jsx` out of `Dashboard/` in the copy, fix its import paths.
- Stand up `Landing/`'s own `AuthContext.jsx`/`api.js`/`portalRedirect.js` per §12/§17.
- Get Landing running standalone against the real Backend, manually verify every public route (§21).

**Phase 3 — Move ClientPortal-classified files into `ClientPortal/`:**
- Copy portal files, write the new bootstrap-style `AuthContext.jsx` modeled on Admin/Attorney's (§12, the highest-risk item — budget the most review time here).
- Wire `AuthGate.jsx`'s cross-origin redirects (`/accept-invite`, `/legacy-holding`) to Landing's new URL.
- Get ClientPortal running standalone, manually verify every protected route (§21).

**Phase 4 — Cross-wire the two new apps:**
- Update `portalRedirect.js` (both copies) with the new `VITE_LANDING_URL`/`VITE_CLIENT_PORTAL_URL` vars.
- Fix `OAuthCallback.jsx`'s post-login navigation to cross-origin per §19.
- Add the Landing-side `/dashboard/*`/`/onboarding/*` redirect shim (§19).
- Add ClientPortal's origin to Backend's `CLIENT_URLS` (§13).

**Phase 5 — Deployment pipeline:**
- Add a ClientPortal build+package+upload+extract block to `.github/workflows/inszoom-cicd.yml`, mirroring the existing Immiglance/Admin blocks exactly (§14).
- (Optional, separate decision) add the missing Attorney block at the same time, since the workflow file is already being edited — but treat this as a separate, explicitly-called-out decision, not an assumed part of the Landing/ClientPortal split.

**Phase 6 — Cutover:**
- Point whichever subdomain currently serves Immiglance (`client.bayareaimmigrationservices.com`) at the new `Landing/` build; deploy `ClientPortal/` to a newly-provisioned subdomain.
- Retire the old `Immiglance/Frontend/` folder only after Phase 6 has run cleanly in production for an agreed soak period — do not delete it as part of Phase 1-5.
- Update `Immiglance/package.json`'s wrapper scripts to target the new folders; retire references to `Frontend/`.

**Phase 7 — Cleanup:**
- Delete `Immiglance/Frontend/` and `Pages/Admin/*` (if not already removed in Phase 0).
- Delete confirmed dead code (`ProtectedRoute.jsx`, `postLoginDest.js`, `BenefitCard.jsx`, `InfoPopup.jsx`, `StepCard.jsx`) from wherever it ended up during the copy — don't assume it was dropped automatically just because it wasn't in the "move" table.
- Fix the legacy `package.json` `name` fields (Immiglance's old `ussv-frontend`, Admin's `inszoom-crm-frontend`) and the `inszoom-cicd.yml`/PM2/S3-key legacy naming, as a final branding-consistency pass — independent of function, but consistent with prior "no legacy names anywhere" cleanup work on this project.

---

## 21. Validation/testing plan (plan only)

**After Phase 2 (Landing standalone):**
- Manually walk every route in §11's Landing list against a real (or staging) Backend: `/`, `/eligibility/quiz` (full quiz to submission), `/consultation/book/:leadId` and `/consultation/booking/:token`, `/login` (all three tabs, including that attorney/team-member logins still correctly *don't* land anywhere in Landing itself — verify the cross-origin bounce fires), `/signup`, `/forgot-password` → email → `/reset-password?token=`, `/accept-invite?token=` (both invited-employee and stub-account-from-case-creation flows), `/auth/callback` (Google OAuth round trip end-to-end).
- Confirm `useHasCase`'s `GET /cases/my` call still correctly gates `StartAssessmentButton`/`BlockIfHasCase` cross-origin (it never was same-app-only, so this should be a non-event, but verify).
- Confirm existing automated tests that moved with their subject files still pass in the new app's own `vitest` config (`App.test.jsx`, `PasswordField.test.jsx`).

**After Phase 3 (ClientPortal standalone):**
- Verify a direct (non-SSO) load of ClientPortal with a valid existing cookie session correctly bootstraps via `/auth/me`+`/auth/session-context` without requiring a fresh login.
- Walk every route in §11's ClientPortal list for a client role, an employee/beneficiary role (confined-to-documents check), and confirm the `mustSetPassword` and `isLegacyNoCaseAccount` branches correctly redirect *cross-origin* to Landing rather than 404ing.
- Re-run `Documents.test.jsx` and `useQuestionnaireAnswers.test.js`/`questionnaireEngine.autofill.test.js` in the new app.
- Verify Stripe checkout success/cancel return URLs (§18) land back on ClientPortal, not Landing or a 404.

**After Phase 4 (cross-wiring):**
- Full login-to-portal round trip: anonymous visitor on Landing → signup → lands on ClientPortal already authenticated, no second login prompt.
- Staff-role and attorney-role login on Landing → correctly bounced to Admin/Attorney respectively (regression check — this already works today and must keep working unchanged).
- A stale `/dashboard` bookmark hit directly against Landing's origin correctly redirects to ClientPortal (not a 404).
- An invited employee whose invite link points at Landing's `/accept-invite` correctly ends up authenticated on ClientPortal's `/dashboard/documents` after accepting.

**After Phase 5 (pipeline):**
- A push to `main` produces four (or at minimum three, if Attorney deployment is deferred per Phase 5's note) successfully-built, successfully-uploaded, successfully-extracted `dist/` bundles, verified via the workflow's own log output and a manual smoke check of each live URL.
- Confirm the resolved `VITE_ADMIN_URL`/`VITE_LANDING_URL`/`VITE_CLIENT_PORTAL_URL`/`VITE_ATTORNEY_PORTAL_URL` values actually present in each deployed bundle (e.g. via browser devtools `import.meta.env` inspection on the live site, or grepping the built JS for the expected origin strings) — this is the concrete check that would have caught the `VITE_INSZOOM_URL` mismatch in §14 had it been run before.

**After Phase 6/7 (cutover/cleanup):**
- Soak-period monitoring of both new production origins' error logs/Backend CORS-rejection logs for any request from an unexpected origin (would indicate a missed hard-coded URL somewhere).
- Confirm no remaining code, config, or CI reference to `Immiglance/Frontend/` before deleting it.

---

## 22. Final recommended repository tree

```
ImmigrationCRM/
├── AGENTS.md                       # updated to describe Landing/ClientPortal as the two Immiglance halves
├── Backend/                        # unchanged
├── Immiglance/
│   ├── package.json                # wrapper, updated to target Landing/ + ClientPortal/
│   ├── Landing/                    # public marketing site + login/signup/OAuth/invite/reset/eligibility/consultation
│   │   ├── package.json
│   │   ├── vite.config.js
│   │   ├── .env
│   │   └── src/...
│   └── ClientPortal/               # authenticated case dashboard, documents, messages, payments, intake
│       ├── package.json
│       ├── vite.config.js
│       ├── .env
│       └── src/...
├── Admin/
│   └── frontend/                   # unchanged (nesting kept — see §15)
├── Attorney/                       # unchanged
├── docs/                           # + this report; architecture docs updated to reflect the 5-frontend-surface reality (Landing/ClientPortal/Admin/Attorney + Backend)
└── .github/workflows/
    └── inszoom-cicd.yml            # extended with ClientPortal (and, as a separate decision, Attorney) build/deploy blocks; VITE_INSZOOM_URL naming resolved
```

`Pages/Admin/*` does not exist anywhere in this final tree — removed, not relocated.

---

*End of investigation. No files other than this report were created; no existing file in the repository was modified.*
