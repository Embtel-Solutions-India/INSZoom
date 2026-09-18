# Repository Rearchitecture — Immiglance Landing / Client Split (Implementation)

**Branch:** `refactor` · **Base commit:** `bbce6df` · **Status:** implemented, **not committed, not pushed**
**Companion document:** `docs/REPOSITORY_ARCHITECTURE_INVESTIGATION.md` (read-only investigation that preceded this work)

---

## 1. Executive summary

`Immiglance/Frontend/` — a single Vite app that fused a public marketing site, all pre-authentication
entry points, and the authenticated client portal behind one router — has been physically split into
two independently-runnable applications:

| New app | Path | Dev port | What it owns |
|---|---|---|---|
| **Landing** | `Immiglance/Landing/` | 5173 | Public marketing home, login/signup/OAuth/invite/password-reset, eligibility quiz, consultation booking |
| **Client** | `Immiglance/Client/` | 5175 | Everything behind `AuthGate`: dashboard, profile, documents, document review, messages, payments, plan/filing selection, QuickBooks, FedEx, intake |

`Immiglance/Frontend/` no longer exists — every file it contained was moved into one of the two new
apps, and the now-empty folder was removed. Nothing else moved: `Admin/frontend/`, `Attorney/`, and
`Backend/` are untouched. No `apps/` directory was created. No authentication, session, cookie, CORS,
DNS, or deployment logic was changed.

**All four frontends build, and both new apps' test suites pass.** See §14.

**Three findings worth reading before anything else:**

1. **`Pages/Dashboard/Home.jsx` is the public marketing homepage, not the client dashboard.** The
   task prompt raised the possibility that it was the authenticated case-overview screen. It is not.
   Verified directly: `App.jsx:44` renders `<Home />` at `/` inside `MainLayout` and **outside**
   `AuthGate`, while `/dashboard` renders a completely separate 875-line `Dashboard.jsx` inside
   `AuthGate` + `PortalLayout`. `Home.jsx` contains visa-category marketing cards, a "how it works"
   section, an FAQ, and a public contact form; it touches `useAuth()`/`useHasCase()` only to swap one
   CTA label. It therefore moved to **Landing**, at `Immiglance/Landing/src/Pages/Marketing/Home.jsx`
   (folder renamed `Dashboard` → `Marketing`, because leaving a file called `Dashboard/Home.jsx` in a
   marketing app would be actively misleading).
2. **The legacy `/admin` pages were NOT deleted — they are not provably safe to delete, so they were
   relocated to Landing instead.** `Home.jsx:547` contains a live
   `<Link to="/admin">Staff Login</Link>` in the public homepage footer, which is a reachable route in
   the currently-deployed app. Deleting the pages would 404 that link. They moved, byte-unchanged, to
   `Immiglance/Landing/src/Pages/Admin/`, and the `/admin` + `/admin/portal` routes were carried over
   into Landing's router verbatim — so behaviour is identical to before the split. Retiring them
   properly is a product decision, spelled out in §7.
3. **The CI/CD workflow will fail on the next push to `main`.** It builds `Immiglance/Frontend`, which
   no longer exists. This is unavoidable given the split, and fixing CI/CD was explicitly out of scope;
   it is the single most important manual follow-up. See §13 and §16.

---

## 2. Original repository structure

```
ImmigrationCRM/
├── package.json                      # not a workspace; one unrelated dependency
├── .github/workflows/inszoom-cicd.yml
├── Backend/                          # Express + Mongo API, :7000        (untouched)
├── Admin/frontend/                   # internal staff CRM, :3002         (untouched)
├── Attorney/                         # external counsel portal, :5174    (untouched)
└── Immiglance/
    ├── package.json                  # thin wrapper: `cd Frontend && npm run <script>`
    └── Frontend/                     # ONE Vite app, :5173 — marketing + auth + client portal
        ├── index.html, vite.config.js, package.json, eslint.config.js, .env, .env.example
        ├── public/{favicon.svg, icons.svg, firebase-messaging-sw.js}
        ├── scripts/optimize-images.mjs
        └── src/
            ├── main.jsx, App.jsx, App.test.jsx, index.css, App.css
            ├── Pages/{Admin, Auth, Consultation, Dashboard, Eligibility}/
            ├── components/{, auth, checklist, consultation, eligibility, questionnaire}/
            ├── config/, context/, hooks/, layout/, services/, utils/, assets/
```

One router (`App.jsx`) served every route. The Landing/Client seam already existed logically —
`MainLayout` vs `PortalLayout`, with `AuthGate` as the single routing authority — but the two halves
shared one `AuthContext`, one `services/api.js`, one build, and one origin.

---

## 3. Final repository structure

```
ImmigrationCRM/
├── Backend/                          (untouched)
├── Admin/frontend/                   (untouched)
├── Attorney/                         (untouched)
└── Immiglance/
    ├── package.json                  # wrapper now orchestrates BOTH apps
    │
    ├── Landing/                      # :5173 — public marketing + pre-auth
    │   ├── index.html, vite.config.js, package.json, package-lock.json
    │   ├── eslint.config.js, .gitignore, .env, .env.example
    │   ├── public/{favicon.svg, icons.svg, firebase-messaging-sw.js}
    │   ├── scripts/optimize-images.mjs
    │   └── src/
    │       ├── main.jsx, App.jsx, App.test.jsx, index.css, App.css
    │       ├── Pages/Marketing/Home.jsx
    │       ├── Pages/Auth/{Login, Register, AcceptInvite, ForgotPassword,
    │       │               ResetPassword, OAuthCallback, LegacyHolding}.jsx
    │       ├── Pages/Eligibility/{EligibilityQuiz.jsx, eligibilityCategories.js}
    │       ├── Pages/Consultation/{BookConsultation, ManageBooking}.jsx
    │       ├── Pages/Admin/{AdminLogin, AdminPortal, leads/LeadsInbox}.jsx   ⚠ legacy, §7
    │       ├── components/  (Navbar, BrandMark, StartAssessmentButton, NotificationBell,
    │       │                 PageLoader*, ThemeToggle*, CrossAppRedirect†,
    │       │                 auth/, eligibility/, consultation/, + 4 dead files)
    │       ├── context/{AuthContext*, SocketContext*, ThemeContext*}.jsx
    │       ├── hooks/useHasCase.js*
    │       ├── layout/MainLayout.jsx
    │       ├── services/{api.js*, notificationService.js*}
    │       ├── utils/  (auth*, portalRedirect*, iconComponents*, visaDisplay*,
    │       │            eligibilitySession, localDateKey, featureFlags, postLoginDest)
    │       └── assets/
    │
    ├── Client/                       # :5175 — authenticated client portal
    │   ├── index.html, vite.config.js, package.json, package-lock.json
    │   ├── eslint.config.js, .gitignore, .env, .env.example
    │   ├── public/{favicon.svg, icons.svg, firebase-messaging-sw.js}
    │   └── src/
    │       ├── main.jsx, App.jsx, index.css
    │       ├── Pages/Dashboard/  (Dashboard, Profile, Documents(+test), DocumentReview,
    │       │                      Messages, Payments, PaymentSuccess, PaymentCancel,
    │       │                      PlanSelection, FilingTypeSelection, QuickBooks,
    │       │                      FedEx, Intake, Notifications)
    │       ├── components/  (AuthGate, PortalLayout's deps, ApplicantTypeSelector,
    │       │                 DocumentChecklist, PrefillBadge, ProtectedRoute,
    │       │                 NotificationPreferencesCard, PageLoader*, ThemeToggle*,
    │       │                 CrossAppRedirect†, checklist/, questionnaire/)
    │       ├── config/{planConfig, pricingCatalog, visaConfig, visaEligibility,
    │       │           visaTypeCanonical}.js
    │       ├── context/{AuthContext*, SocketContext*, ThemeContext*}.jsx
    │       ├── hooks/  (useCaseChecklists, useCaseDocumentChecklist, useCaseQuestionnaire,
    │       │            useDocumentChecklist, useMyCaseProfile, useQuestionnaireAnswers(+test),
    │       │            useHasCase*)
    │       ├── layout/PortalLayout.jsx
    │       ├── services/{api.js*, notificationService.js*}
            └── utils/  (auth*, portalRedirect*, iconComponents*, visaDisplay*,
                         caseStatusLabel, checklistStatus, dedupeChecklistSections,
                         questionnaireEngine(+test))

    (Immiglance/Frontend/ — DELETED, see §4.4)
```

`*` = duplicated into both apps (see §8). `†` = new file created by this split (see §9).

---

## 4. Complete file movement summary

Every move below was performed with `git mv`, so rename history is preserved (`git status` reports
them as `R`, not `D`+`A`).

### 4.1 → Landing

| OLD PATH (under `Immiglance/Frontend/src/`) | NEW PATH (under `Immiglance/Landing/src/`) | Reason |
|---|---|---|
| `Pages/Dashboard/Home.jsx` | `Pages/Marketing/Home.jsx` | Public marketing homepage at `/`, outside `AuthGate`; folder renamed to stop the "Dashboard" misnomer |
| `Pages/Auth/Login.jsx` | `Pages/Auth/Login.jsx` | Pre-auth; must be reachable by an anonymous visitor |
| `Pages/Auth/Register.jsx` | `Pages/Auth/Register.jsx` | Public signup |
| `Pages/Auth/ForgotPassword.jsx` | same | Public, token-based |
| `Pages/Auth/ResetPassword.jsx` | same | Public, token-based |
| `Pages/Auth/AcceptInvite.jsx` | same | Deliberately outside `AuthGate` so `mustSetPassword` never loops |
| `Pages/Auth/OAuthCallback.jsx` | same | Receiving end of a flow that starts on Landing |
| `Pages/Auth/LegacyHolding.jsx` | same | Public route (`/legacy-holding`), static content |
| `Pages/Eligibility/EligibilityQuiz.jsx` | same | Public acquisition funnel |
| `Pages/Eligibility/eligibilityCategories.js` | same | Quiz data |
| `Pages/Consultation/BookConsultation.jsx` | same | Public, unguarded |
| `Pages/Consultation/ManageBooking.jsx` | same | Reached via emailed token link, no login |
| `components/Navbar.jsx` | same | Renders only inside `MainLayout` |
| `components/BrandMark.jsx` | same | Used by `Navbar` + `Login` only |
| `components/StartAssessmentButton.jsx` | same | Used by `Home` + `Navbar` |
| `components/NotificationBell.jsx` | same | Imported only by `Navbar` (and the legacy `AdminPortal`) |
| `components/auth/PasswordField.jsx` (+ `.test.jsx`) | same | Used by Login/Register/ResetPassword/AcceptInvite only |
| `components/eligibility/*` (6 files) | same | Quiz + `BlockIfHasCase` guard |
| `components/consultation/*` (4 files) | same | Booking flow only |
| `components/{BenefitCard,StepCard,InfoPopup,ConsultationSection}.jsx` | same | **Dead code** (zero importers) — marketing-shaped, parked in Landing rather than deleted (deletion out of scope) |
| `layout/MainLayout.jsx` | same | Wraps `/` only; carries the staff/attorney bounce effect |
| `utils/eligibilitySession.js` | same | Quiz only |
| `utils/localDateKey.js` | same | Booking calendar only |
| `utils/featureFlags.js` | same | **Dead code**; reads `AuthContext` |
| `utils/postLoginDest.js` | same | **Dead code**; superseded by `AuthGate`, but it is a post-login *destination* helper → Landing |
| `index.css`, `App.css`, `App.test.jsx` | same | Global styles + the app-level routing test, which exercises `/` and `/eligibility/quiz` — both Landing routes |
| `assets/**` (26 files) | same | `admin-login-liberty.{png,webp}` is used by `Register.jsx`; the rest are unreferenced marketing illustrations |
| `Pages/Admin/AdminLogin.jsx`, `Pages/Admin/AdminPortal.jsx`, `Pages/Admin/leads/LeadsInbox.jsx` | same | **Legacy admin surface.** Not deletable (live `<Link to="/admin">` from `Home.jsx`), so it follows its one live caller into Landing. Both of its entry points are pre-authentication (`/admin` is a login form). Files are byte-unchanged. See §7 |
| *(from `Immiglance/Frontend/`)* `scripts/optimize-images.mjs` | `Immiglance/Landing/scripts/` | Operates on `src/assets/images/client-portal/`, which moved to Landing |

### 4.2 → Client

| OLD PATH (under `Immiglance/Frontend/src/`) | NEW PATH (under `Immiglance/Client/src/`) | Reason |
|---|---|---|
| `Pages/Dashboard/Dashboard.jsx` | same | The real authenticated case-overview screen at `/dashboard` |
| `Pages/Dashboard/{Profile,Documents,Documents.test,DocumentReview,Messages,Payments,PaymentSuccess,PaymentCancel,PlanSelection,FilingTypeSelection,QuickBooks,FedEx,Intake}.jsx` | same | All routed under `AuthGate` |
| `Pages/Dashboard/Notifications.jsx` | same | **Dead code** (never routed), but portal-domain |
| `components/AuthGate.jsx` | same | Gates `/dashboard/*` and `/onboarding/intake` |
| `components/ApplicantTypeSelector.jsx` | same | Used by `PlanSelection` only |
| `components/DocumentChecklist.jsx`, `components/PrefillBadge.jsx` | same | Used by `Documents` / questionnaire components |
| `components/ProtectedRoute.jsx` | same | **Dead code** (superseded by `AuthGate`), but it is a protected-route guard |
| `components/NotificationPreferencesCard.jsx` | same | **Dead code**; notification prefs is a portal concern |
| `components/checklist/*` (5 files) | same | Imported only by `Documents`/`Intake` |
| `components/questionnaire/*` (8 files) | same | Imported only by `Documents`/`Intake` (`CanonicalProfileForm.jsx` + `canonicalFieldGroups.js` are dead) |
| `config/*` (5 files) | same | Zero Landing importers; `visaEligibility.js`/`visaTypeCanonical.js` are dead |
| `hooks/{useCaseChecklists,useCaseDocumentChecklist,useCaseQuestionnaire,useDocumentChecklist,useMyCaseProfile,useQuestionnaireAnswers,useQuestionnaireAnswers.test}.js` | same | Case-scoped data hooks, zero Landing importers |
| `layout/PortalLayout.jsx` | same | Sidebar/top-bar shell for `/dashboard/*` |
| `utils/{caseStatusLabel.js,checklistStatus.jsx,dedupeChecklistSections.js,questionnaireEngine.js,questionnaireEngine.autofill.test.js,visaDisplay.js}` | same | Used only by portal pages |

### 4.3 Deleted files

| PATH | Reason |
|---|---|
| `Immiglance/Frontend/src/App.jsx` | Superseded by `Landing/src/App.jsx` + `Client/src/App.jsx`, each carrying its own half of the route tree verbatim |
| `Immiglance/Frontend/src/main.jsx` | Superseded by each app's own `main.jsx` (provider stack copied unchanged) |
| `Immiglance/Frontend/{index.html, vite.config.js, package.json, package-lock.json, eslint.config.js, .gitignore, .env.example}` | Superseded by a per-app copy in each of Landing and Client |
| `Immiglance/Frontend/public/{favicon.svg, icons.svg, firebase-messaging-sw.js}` | Copied verbatim into `Landing/public/` and `Client/public/` before removal |
| `Immiglance/Frontend/scripts/optimize-images.mjs` | Moved to `Landing/scripts/` |
| `Immiglance/Frontend/.env` (untracked) | Copied verbatim into `Landing/.env` and `Client/.env` before removal; no value was lost |

**No source file was deleted without its content first existing somewhere else.** In particular, **no
legacy-admin file was deleted** (§7).

### 4.4 Removal of `Immiglance/Frontend/`

The folder is **gone**. Sequence and the evidence gathered before deleting:

1. **Everything was accounted for.** After the moves in §4.1/§4.2, `find Immiglance/Frontend/src -type f`
   returned only the three legacy-admin files plus `App.jsx`/`main.jsx`. The legacy-admin trio was then
   `git mv`'d into `Landing/src/Pages/Admin/` (§7); `App.jsx`/`main.jsx` were removed as superseded.
   `git ls-files Immiglance/Frontend` then listed only the build shell, each file of which had already
   been copied into both new apps.
2. **Nothing imports from it.** A repo-wide search for the string `Immiglance/Frontend` (excluding
   `node_modules/`, `dist/`, `.git/`, `docs/`) returned **zero source imports**. Every remaining hit is
   either the CI/CD workflow (item 3) or a prose comment/doc reference in `Backend/docs/*`,
   `Attorney/docs/*`, `Admin/frontend/src/hooks/useCaseQuestionnaire.js`,
   `Backend/src/modules/**` and `Backend/src/models/DocumentExtraction.js` — all of which are
   descriptive comments pointing at where a counterpart file used to live, not code dependencies.
   Those were deliberately left alone (touching unrelated files was out of scope); they are now stale
   path references, logged as **M-9**.
3. **One config still points at it, and it cannot be fixed here.**
   `.github/workflows/inszoom-cicd.yml` references `Immiglance/Frontend` on lines 32, 37, 41, 58, 125,
   126 and 127. This is the known blocker **M-3**. It is worth being precise about the causality: that
   workflow was already going to fail the moment `src/App.jsx`/`main.jsx` moved out, whether or not the
   folder itself remained — leaving an empty `Frontend/` behind would not have kept CI green, it would
   only have changed the error message. CI/CD restructuring was explicitly deferred by the task brief,
   so the workflow is byte-unchanged.
4. **Builds were validated before deletion, and again after.** All four apps built green both times
   (§14), so the removal is confirmed not to have broken Landing, Client, Admin, Attorney, or Backend.

Removal was performed with `git rm -r Immiglance/Frontend` (13 tracked files) followed by deleting the
untracked remainder (`.env`, `node_modules/`, `dist/`). The first `rm -rf` of the leftover empty
directory failed with `Device or resource busy` — the user's still-running Vite dev server held a
handle on it. Per the task's instruction not to force-kill user processes, it was **not** killed; a
second attempt via PowerShell `Remove-Item -Recurse -Force` succeeded, and `Immiglance/` now contains
exactly `Landing/`, `Client/`, and `package.json`. A stray `Immiglance/node_modules/.vite` cache
directory (gitignored, created by a Vite process during this work) was removed at the same time.

---

## 5. Landing application contents

**Routes served** (all byte-identical path/element pairings to the pre-split `App.jsx`):

| Route | Wrapper | Component |
|---|---|---|
| `/` | `MainLayout` | `Pages/Marketing/Home` |
| `/eligibility` | — | `<Navigate to="/eligibility/quiz" replace />` |
| `/eligibility/quiz` | `BlockIfHasCase` | `Pages/Eligibility/EligibilityQuiz` |
| `/consultation/book/:leadId?` | — | `Pages/Consultation/BookConsultation` |
| `/consultation/booking/:token` | — | `Pages/Consultation/ManageBooking` |
| `/legacy-holding` | — | `Pages/Auth/LegacyHolding` |
| `/login` | — | `Pages/Auth/Login` |
| `/signup` | — | `Pages/Auth/Register` |
| `/accept-invite` | — | `Pages/Auth/AcceptInvite` |
| `/forgot-password` | — | `Pages/Auth/ForgotPassword` |
| `/reset-password` | — | `Pages/Auth/ResetPassword` |
| `/auth/callback` | — | `Pages/Auth/OAuthCallback` |
| `/admin` | — | `Pages/Admin/AdminLogin` ⚠ legacy, §7 |
| `/admin/portal` | — | `Pages/Admin/AdminPortal` ⚠ legacy, §7 |
| `/dashboard`, `/dashboard/*`, `/onboarding/*` | — | `CrossAppRedirect` → Client origin (**new**, §9) |

Every public route the fused app served is still served, on the same path, by Landing.

**Backend API surfaces Landing calls:** `authApi`, `leadsApi`, `eligibilityQuizApi`, `consultationApi`,
`complianceApi` (disclaimer banner), `telemetryApi`, `notificationsApi` (bell), and `casesApi.my()` via
`useHasCase`. Landing keeps the whole `services/api.js` — see §8.

---

## 6. Client application contents

**Routes served** (all byte-identical to the pre-split `App.jsx`):

| Route | Wrapper | Component |
|---|---|---|
| `/dashboard` | `AuthGate` + `PortalLayout` | `Dashboard` |
| `/dashboard/profile` | `AuthGate` + `PortalLayout` | `Profile` |
| `/dashboard/messages` | `AuthGate` + `PortalLayout` | `Messages` |
| `/dashboard/plan` | `AuthGate` + `PortalLayout` | `PlanSelection` |
| `/dashboard/filing-type` | `AuthGate` + `PortalLayout` | `FilingTypeSelection` |
| `/dashboard/payments` | `AuthGate` + `PortalLayout` | `Payments` |
| `/dashboard/payments/success` | `AuthGate` + `PortalLayout` | `PaymentSuccess` |
| `/dashboard/payments/cancel` | `AuthGate` + `PortalLayout` | `PaymentCancel` |
| `/dashboard/quickbooks` | `AuthGate` + `PortalLayout` | `QuickBooks` |
| `/dashboard/fedex` | `AuthGate` + `PortalLayout` | `FedEx` |
| `/dashboard/documents` | `AuthGate` + `PortalLayout` | `Documents` |
| `/dashboard/documents/:caseId` | `AuthGate` + `PortalLayout` | `Documents` |
| `/dashboard/document-review` | `AuthGate` + `PortalLayout` | `DocumentReview` |
| `/onboarding/intake` | `AuthGate` (no layout chrome) | `Intake` |
| `/dashboard/intake` | — | `<Navigate to="/onboarding/intake" replace />` |
| `*` (everything else) | — | `CrossAppRedirect` → Landing origin (**new**, §9) |

`AuthGate.jsx` was moved **unmodified**. Its `<Navigate to="/login" />`,
`<Navigate to="/accept-invite" />` and `<Navigate to="/legacy-holding" />` branches still emit
same-app navigations exactly as before; the `*` catch-all is what converts those into a forward to the
Landing origin instead of a 404.

---

## 7. Legacy Admin investigation

**What was found:** a second, fully-functional internal admin UI built into the client-facing app —
`src/Pages/Admin/AdminLogin.jsx` (`/admin`), `src/Pages/Admin/AdminPortal.jsx` (`/admin/portal`, ~890
lines, with its own overview/cases/users/documents/appointments sections), and
`src/Pages/Admin/leads/LeadsInbox.jsx`. It duplicates what the real, actively-developed
`Admin/frontend/` app does, and it contradicts `AGENTS.md`'s rule that admin-only functionality never
belongs in the Immiglance app.

**Every reference traced (exhaustive grep over `Immiglance/Frontend/src`):**

| Referencing file | Reference | Live? |
|---|---|---|
| `src/App.jsx:29-30, 133-134` | `lazy(() => import(...))` + `<Route path="/admin">` / `<Route path="/admin/portal">` | Yes — routed |
| **`src/Pages/Dashboard/Home.jsx:547`** | **`<Link to="/admin" ...>Staff Login</Link>`** | **Yes — a visible link in the public homepage footer** |
| `src/Pages/Admin/AdminLogin.jsx:42,57` | `navigate("/admin/portal")` | Internal to the cluster |
| `src/Pages/Admin/AdminPortal.jsx:7,871` | `import LeadsSection from "./leads/LeadsInbox"`, `navigate("/admin")` | Internal to the cluster |
| `src/components/ConsultationSection.jsx:9` | Comment only ("see LeadsInbox.jsx") | Not a dependency |
| `src/services/api.js:673,680` | `adminApi.overview()` → `GET /admin/overview` etc. | Backend endpoints, not the frontend route |

Repo-wide search outside Immiglance found no importer or link. `Backend/`, `Admin/frontend/`,
`Attorney/`, and the CI/CD workflow contain no reference to these files.

**Safe to delete?** **No.** `Home.jsx:547` is a live `<Link to="/admin">Staff Login</Link>` rendered in
the footer of the public homepage of the currently-deployed app. That is a reachable, user-facing
dependency, which fails the "prove nothing reachable depends on them" bar. Deleting the pages would
have turned a working footer link into a 404 — a behaviour change, which this task was not allowed to
make.

**What was done:** the three files were **relocated, byte-unchanged, to
`Immiglance/Landing/src/Pages/Admin/`**, and the `/admin` + `/admin/portal` routes were carried over
into `Landing/src/App.jsx` exactly as they appeared in the pre-split router. **Net behaviour is
identical to before the split**: the same link leads to the same login form leads to the same portal.

Landing (not Client) is the correct home for them, on three independent grounds:
* `/admin` is `AdminLogin.jsx`, a **pre-authentication login form** — the same reason `Login.jsx` had to
  go to Landing.
* Their only live caller, `Home.jsx`, is a Landing page.
* Their dependency set (`AuthContext`, `SocketContext`, `services/api`, `utils/iconComponents`) already
  existed in Landing. The one exception, `utils/visaDisplay.js`, was duplicated into Landing (§8) —
  it is a 40-line pure formatting helper.

This was the **only** content still sitting in `Immiglance/Frontend/` at that point, so relocating it
is what made removing that folder possible (§4.4).

**Retiring this surface properly — a product decision, not done here.** Two clean options:
* **(a) Recommended.** Re-point `Home.jsx`'s "Staff Login" link at the real Admin app
  (`import.meta.env.VITE_ADMIN_URL`, which Landing already has), then delete
  `Landing/src/Pages/Admin/`, the two routes in `Landing/src/App.jsx`, and — if nothing else needs it —
  `Landing/src/utils/visaDisplay.js` and `adminApi` from `Landing/src/services/api.js`. This is a
  contained, single-commit change now that everything involved lives in one app.
* **(b)** Keep it. Not recommended: `AGENTS.md` explicitly forbids admin-only functionality in the
  client-facing Immiglance app, and this surface duplicates `Admin/frontend/` wholesale.

Tracked as **M-2** in §16.

---

## 8. Shared code decisions

Rule applied, in the priority order given: **correctness > minimal duplication > architectural
elegance**, and no new shared package/workspace was created (the repo has no workspace tooling
anywhere, and `Admin`/`Attorney` already solve cross-app sharing at the Backend-API and
URL-handoff levels, not via shared frontend source).

| Item | Decision | Justification |
|---|---|---|
| `services/api.js` (681 lines: `tokenStore`, `request()`, refresh logic, 26 `*Api` namespaces) | **(A) Duplicate verbatim into both apps** | The investigation recommended splitting it along the Landing/Client seam. Rejected here: that is a *refactor* of the exact file that owns token storage, the 401-refresh race, and every endpoint path — precisely the code this task was told not to change the behaviour of. A byte-identical copy in each app guarantees identical auth/transport behaviour on day one. The drift risk is real and is logged as deferred work (§15, D-6). |
| `context/AuthContext.jsx` | **(A) Duplicate verbatim** | Explicitly the sanctioned stopgap: Client needs *some* auth context to know whether a user is signed in, and duplicating the existing one preserves the current cookie/token bootstrap exactly. No new cross-app session mechanism was invented. |
| `services/notificationService.js` | **(A) Duplicate** | Imported directly by `AuthContext.jsx`; it cannot be left behind without editing `AuthContext`. |
| `context/SocketContext.jsx` | **(A) Duplicate** | Required by Landing (`NotificationBell` inside `Navbar`) *and* Client (`Messages`, `Payments`, `PaymentSuccess`). Genuinely used on both sides. |
| `context/ThemeContext.jsx` + `components/ThemeToggle.jsx` | **(A) Duplicate** | ~60 lines total; consumed by `Navbar`/`Login` (Landing) and `PortalLayout` (Client). |
| `components/PageLoader.jsx` | **(A) Duplicate** | 1 component, no deps; each app's root `<Suspense>` fallback. |
| `utils/auth.js` (`isEmployeeAccount`) | **(A) Duplicate** | 10 lines; used by `Navbar`/`BlockIfHasCase` (Landing) and `AuthGate`/`Dashboard`/`Documents`/`Profile`/`PortalLayout` (Client). |
| `utils/portalRedirect.js` | **(A) Duplicate** | Both apps independently need the staff/attorney bounce — Landing's `MainLayout` and Client's `AuthGate` each call it. Copied **unmodified**; no third destination was added (that would be the cross-app session work being deferred). |
| `utils/iconComponents.jsx` | **(A) Duplicate** | Pure SVG components, no logic; used by `Home` (Landing) and `Messages`/`Payments`/`PlanSelection`/`QuestionInput`/`PrefillBadge` (Client). |
| `hooks/useHasCase.js` | **(A) Duplicate** | Used by `Home`/`StartAssessmentButton`/`BlockIfHasCase` (Landing) **and** `Intake.jsx` (Client). It calls `casesApi.my()` over HTTP, so the dependency is on the Backend contract, not on the other app's source. |
| `utils/visaDisplay.js` | **(A) Duplicate** | Primary home is Client (`Dashboard`, `PortalLayout`). A second copy went to Landing solely because the relocated legacy `AdminPortal.jsx` imports it (§7). 40 lines, pure formatting, no state. Deletable from Landing the moment option (a) in §7 is taken. |
| `src/index.css` | **(A) Duplicate** | Tailwind v4 entry + the shared design tokens. Both apps need identical tokens; a shared CSS package would be the only way to avoid this, and that is exactly the abstraction we were told not to build. |
| `index.html`, `eslint.config.js`, `.gitignore`, `public/*` | **(A) Duplicate verbatim** | Per-app build shell. `index.html` was copied byte-for-byte including its SEO/OG metadata — no content edits. |
| `components/BrandMark.jsx` | **(D) Not actually shared** | Only `Navbar` and `Login` import it, both Landing. Kept single-copy in Landing. (`PortalLayout` inlines its own separate SVG mark — a pre-existing inconsistency, untouched.) |
| `components/ProtectedRoute.jsx`, `postLoginDest.js`, `featureFlags.js`, `NotificationPreferencesCard.jsx`, `Notifications.jsx`, `BenefitCard/StepCard/InfoPopup/ConsultationSection.jsx`, `CanonicalProfileForm.jsx`, `canonicalFieldGroups.js`, `visaEligibility.js`, `visaTypeCanonical.js`, `App.css` | **(D) Dead code — single copy, parked by domain** | All confirmed zero-importer by exhaustive grep. Not deleted (deletion beyond the legacy-admin question was out of scope); each landed in the app whose domain it belongs to, so a future cleanup has an obvious home. |
| Test files | **(D) Move with the code under test** | `App.test.jsx` + `PasswordField.test.jsx` → Landing; `Documents.test.jsx`, `useQuestionnaireAnswers.test.js`, `questionnaireEngine.autofill.test.js` → Client. |

**No new shared package or npm workspace was created.** Total duplicated source: 13 files
(~1,350 lines), dominated by `api.js`.

---

## 9. Import / dependency changes

**Relative import paths inside moved files: zero edits required.** Each file kept its directory depth
relative to `src/` (`Pages/X/Y.jsx`, `components/**`, `utils/*`, …), so every `../../services/api`-style
specifier still resolves. `Pages/Dashboard/Home.jsx` → `Pages/Marketing/Home.jsx` is the same depth,
so even its imports are untouched. No `@/` alias exists in this codebase (confirmed: no `resolve.alias`
in any vite config), so nothing alias-related needed updating.

Verified mechanically: a resolver script walked every `.js`/`.jsx` file in both new apps and resolved
every relative specifier against the filesystem — **0 unresolved imports in Landing, 0 in Client.**

**Files whose content changed (3):**

| File | Change | Why |
|---|---|---|
| `Landing/src/App.test.jsx` | `vi.mock("./Pages/Dashboard/Home")` → `vi.mock("./Pages/Marketing/Home")` | Required by the `Home.jsx` folder rename; the test's assertions are unchanged |
| `Immiglance/package.json` | Wrapper scripts retargeted from `Frontend/` to `Landing/` + `Client/`; `name` `immiglance-client-portal` → `immiglance` | The wrapper is the existing repo convention for `Immiglance/`; it had to point at the two new apps. `immiglance-client-portal` was freed up so it could not be confused with the new Client app |
| `Pages/Admin/{AdminLogin,AdminPortal,leads/LeadsInbox}.jsx` | **none** | Left byte-identical; only their location changed (§7) |

**Architecture documentation updated (docs only, no code/behaviour change):**

| File | Change |
|---|---|
| `AGENTS.md` | "Project Overview" now describes **five** applications instead of four, with Immiglance Landing and Immiglance Client as separate entries (responsibilities, dev ports, and the rule that Landing is the only app that originates a session). "Workspace Structure" replaces the single `Immiglance/` entry with the wrapper + `Landing/` + `Client/` layout, each with its own responsibilities and "never put X here" guardrails, plus an explicit list of the duplicated files that must be edited in both copies. "Migration Rules" and the final Codex checklist updated to name all four frontends. |
| `docs/architecture/CANONICAL_WORKFLOW.md` | "§0. The four apps" → "§0. The five apps", with a Landing/Client row each and a dev-port column; all `Immiglance/Frontend/src/...` path references repointed to `Immiglance/Client/src/...`; "both portals" phrasing replaced; the reusable agent prompt updated to name Landing and Client separately. |
| `docs/architecture/MODULE-CARDS.md` | Added a structure note at the top explaining the five-app layout and that unqualified "Immiglance" frontend consumers resolve to `Immiglance/Client`; the Case model card's frontend-consumer list now distinguishes Client pages from Landing's `useHasCase` and says "four frontends" rather than "three portals". |
| `docs/architecture/COVERAGE.md` | The Immiglance frontend-artifact coverage row now notes that the scan predates the split, that no file was added or removed by it, and that only paths changed. |

Deliberately **not** touched, per this repo's established convention of leaving historical journals
with their original references intact: `docs/phases/`, `docs/audits/`, `docs/archive/`,
`docs/forms/ARCHITECTURE.md` (forms-pipeline-specific, not overall app architecture), and the other
pre-existing completion reports under `docs/`.

**New files created (8):**

| File | Purpose |
|---|---|
| `Landing/src/App.jsx`, `Client/src/App.jsx` | Each app's half of the original route tree, carried over verbatim (route comments included) plus one cross-app shim route block |
| `Landing/src/main.jsx`, `Client/src/main.jsx` | Copies of the original `main.jsx`, provider stack unchanged (`QueryClientProvider` → `ThemeProvider` → `AuthProvider` → `SocketProvider`) |
| `Landing/src/components/CrossAppRedirect.jsx`, `Client/src/components/CrossAppRedirect.jsx` | Path-forwarding shim, see below |
| `Landing/vite.config.js`, `Client/vite.config.js` | Per-app Vite config (§11) |
| `Landing/package.json`, `Client/package.json` | Per-app manifests (§11) |

**`CrossAppRedirect.jsx` — what it is and what it deliberately is not.** Splitting one origin into two
means paths that used to resolve in-app now 404. The shim reads `useLocation()` and issues
`window.location.replace(<sibling origin><same path><search><hash>)`. It hands over **no token, no
cookie, no session state**, and it does not touch `AuthContext`, `tokenStore`, `portalRedirect.js`, or
`AuthGate`'s decision logic. The session continues to come from the same httpOnly refresh cookie plus
the `GET /auth/me` bootstrap, exactly as before. It exists so that:
* Landing: `Login`/`Register`/`OAuthCallback`'s existing `navigate("/dashboard")` calls and any
  `/dashboard/*` bookmark reach the Client app instead of 404-ing.
* Client: `AuthGate`'s existing `<Navigate to="/login" />` / `"/accept-invite"` / `"/legacy-holding"`
  redirects reach the Landing app instead of 404-ing.

A real cross-origin session handoff between Landing and Client (the equivalent of what
`portalRedirect.js` does for Admin/Attorney) is **not** implemented here — see §15, D-1.

---

## 10. Routing changes

Every route in the original `App.jsx` still exists, on the same path, with the same wrapper and the
same element — just distributed across two routers. The redirect-only routes moved with their targets:
`/eligibility` → `/eligibility/quiz` stays entirely in Landing; `/dashboard/intake` →
`/onboarding/intake` stays entirely in Client.

| Original route | Now lives in | Change |
|---|---|---|
| `/`, `/eligibility`, `/eligibility/quiz`, `/consultation/*`, `/legacy-holding`, `/login`, `/signup`, `/accept-invite`, `/forgot-password`, `/reset-password`, `/auth/callback` | Landing | none |
| `/dashboard/*`, `/onboarding/intake`, `/dashboard/intake` | Client | none |
| `/admin`, `/admin/portal` | Landing | none (legacy — see §7) |
| *(new)* `/dashboard`, `/dashboard/*`, `/onboarding/*` on Landing | Landing | Forward to Client origin |
| *(new)* `*` on Client | Client | Forward to Landing origin |

**No route was lost.** Every path the fused router served is still served, on the same path, with the
same wrapper and the same element.

No route guard, gate, or redirect condition was modified. `AuthGate.jsx`, `BlockIfHasCase.jsx`,
`MainLayout.jsx`'s staff bounce, and `portalRedirect.js` are byte-identical to before the split.

---

## 11. Package / Vite configuration changes

### `package.json`

Both new manifests are derived from `Immiglance/Frontend/package.json`. **No version specifier was
changed anywhere** — every retained dependency keeps its exact original range.

| | Landing | Client |
|---|---|---|
| `name` | `immiglance-landing` | `immiglance-client` |
| scripts | `dev`/`build`/`lint`/`preview`/`test` — identical to the original | identical |
| dropped deps | `@stripe/stripe-js` (payments are a Client concern; also unimported anywhere in `src`) | `sharp` (only used by `scripts/optimize-images.mjs`, which moved to Landing) |
| retained deps | `@tailwindcss/vite`, `@tanstack/react-query`, `firebase`, `framer-motion`, `react`, `react-dom`, `react-router-dom`, `socket.io-client`, `tailwindcss` | same, plus `@stripe/stripe-js` |

**One structural change was necessary to make `npm install` work at all:**
`@rolldown/binding-linux-x64-gnu` and `lightningcss-linux-x64-gnu` are Linux-only native bindings that
sat in the original `devDependencies`. On Windows, `npm install` aborts with
`EBADPLATFORM … wanted {"os":"linux"} (current: {"os":"win32"})` — reproduced on the first install
attempt. They were moved, **at their original version specifiers**, from `devDependencies` to
`optionalDependencies` in both new manifests. npm skips an unsatisfiable optional dependency instead of
failing, so Windows now installs cleanly while a Linux CI runner still gets both bindings. This is a
platform-gating fix, not a version change, and it affects only the two new manifests —
`Immiglance/Frontend/package.json` was left untouched.

`package-lock.json` was copied from `Frontend/` into both apps and then reconciled by `npm install`, so
transitive versions stay pinned to what the fused app was already using.

### `vite.config.js`

Copied verbatim from `Immiglance/Frontend/vite.config.js` into both apps — same plugins
(`@vitejs/plugin-react`, `@tailwindcss/vite`, `@rolldown/plugin-babel` with the React Compiler preset),
same `test` block (`jsdom`, globals), same COOP/COEP headers, same `/api` and `/socket.io` proxies to
`http://localhost:7000`. **One addition:** an explicit `server.port`, because two apps can no longer
both rely on Vite's 5173 default.

| App | Port | Note |
|---|---|---|
| Landing | **5173** | Keeps the historic Immiglance port, so existing `CLIENT_URLS` / OAuth-redirect config that points at `localhost:5173` keeps working |
| Client | **5175** | New. 5174 is Attorney's, 3002 is Admin's |

`base` and `build.outDir` were left unset (Vite defaults `/` and `dist`) in both, matching the original
and matching `Admin/frontend` and `Attorney`.

### `Immiglance/package.json` (the wrapper)

A root `Immiglance/package.json` was **already** the repo's convention — it existed purely to delegate
`npm run dev|build|lint|preview` into `Frontend/`. It was retargeted, not invented, and deliberately
kept as plain `cd`-and-delegate scripts: no `workspaces` field, no Turbo/Nx/pnpm, matching the rest of
the repo (no workspace tooling exists at any level).

```
dev:landing / dev:client        build / build:landing / build:client
lint / lint:landing / lint:client   test / test:landing / test:client
preview:landing / preview:client
```

No root `ImmigrationCRM/package.json` change was made.

---

## 12. Environment file changes

`Frontend/.env` (untracked, gitignored) and `Frontend/.env.example` (tracked) were **copied** into both
new apps; the originals were left in place. Every pre-existing variable name and value carries over
unchanged. Two variables were added, one per app, both consumed **only** by `CrossAppRedirect.jsx`:

| App | New var | Dev default (built into the component) |
|---|---|---|
| Landing | `VITE_CLIENT_URL` | `http://localhost:5175` |
| Client | `VITE_LANDING_URL` | `http://localhost:5173` |

Neither is an auth or session variable; each is a plain origin used for path forwarding.

`VITE_STRIPE_PUBLISHABLE_KEY` was dropped from `Landing/.env.example` (payments live in Client; it is
in fact read nowhere in `src` at all — a pre-existing dead variable, left alone in Client).
`Landing/.env.example` and `Client/.env.example` were also rewritten with a trailing newline, which the
original was missing.

**Pre-existing issue carried over unchanged (not fixed here):** `Frontend/.env` sets `VITE_ADMIN_URL`
to the **production** admin origin (`https://admin.bayareaimmigrationservices.com`) while
`VITE_ATTORNEY_PORTAL_URL` points at `http://localhost:5174`. A developer running locally therefore
sends staff-role SSO redirects at production. Both new apps inherit this verbatim, because changing it
would change redirect behaviour.

**Backend `.env` was not touched.** `CLIENT_URLS` still lists `http://localhost:5173` but **not**
`http://localhost:5175`, so the Client dev server's browser-origin requests are not yet CORS-allowlisted.
See §16, M-1.

---

## 13. CI/CD references discovered

The only CI/CD artifact in the repo is `.github/workflows/inszoom-cicd.yml` (push to `main` only). It
was **not modified** — CI/CD restructuring is explicitly deferred.

| Finding | Detail |
|---|---|
| **`VITE_INSZOOM_URL` vs `VITE_ADMIN_URL` mismatch — NOT FIXED HERE** | The workflow's "Build Immiglance Frontend" step injects `VITE_INSZOOM_URL: ${{ secrets.BAIS_VITE_INSZOOM_URL }}` (line 45). No frontend code reads `VITE_INSZOOM_URL`. The code reads **`VITE_ADMIN_URL`** — in `utils/portalRedirect.js`, `Pages/Auth/OAuthCallback.jsx`, and `Pages/Auth/Register.jsx`. Unless a `BAIS_VITE_ADMIN_URL` secret is also being injected by some means not visible in this repo, every production build ships with `VITE_ADMIN_URL` undefined, and `portalRedirect.js` falls back to `http://localhost:3002` — a dead address for real visitors, exactly the failure its own `console.error` was added to surface. **This was deliberately left unfixed, per the task's explicit instruction.** It now affects both new apps identically (both inherit `portalRedirect.js` verbatim). It cannot be confirmed from this repo alone which GitHub secrets actually exist. |
| **Hard-coded build paths now stale** | Lines 32/33 (`cache-dependency-path`), 36-41 (`working-directory: Immiglance/Frontend`), 55-58 (tar `-C Immiglance/Frontend/dist`) all point at `Immiglance/Frontend`, which no longer has an entry point. **The next push to `main` will fail the build step**, which also blocks the Admin-frontend and Backend deploy stages in the same job. |
| **Hard-coded remote paths now stale** | Lines 125-127 extract to `/home/ubuntu/INSZoom/Immiglance/Frontend/dist` on the EC2 host. Two `dist` targets are now needed, one per new app. |
| **Attorney is absent from CI/CD entirely** | Pre-existing: no build, no artifact, no deploy target. Unrelated to this split. |
| **`Admin/frontend` steps unaffected** | Nothing under `Admin/` moved, so those steps are byte-correct as written. |
| **No Dockerfile / nginx / reverse-proxy config in the repo** | The static-hosting layer that would need a new vhost for the Client app is not visible from this repository and could not be audited. |

---

## 14. Validation results

All commands below were actually executed on Windows 11, Node v22.20.0, npm 10.9.3. Results are
observed, not assumed.

### 14.1 Dependency installation (new apps only)

| Command | Result |
|---|---|
| `cd Immiglance/Landing && npm install` | **FAIL** on first attempt — `npm error code EBADPLATFORM` / `Unsupported platform for @rolldown/binding-linux-x64-gnu@1.2.6: wanted {"os":"linux"} (current: {"os":"win32"})`. No `node_modules` was produced. |
| `cd Immiglance/Client && npm install` | **FAIL**, identical cause. |
| *(fix applied: both Linux-only bindings moved to `optionalDependencies` at unchanged versions — §11)* | |
| `cd Immiglance/Landing && npm install` (retry) | **PASS** |
| `cd Immiglance/Client && npm install` (retry) | **PASS** |

No `npm install` was run in `Admin/frontend` or `Attorney` — both already had `node_modules` and
neither was modified.

### 14.2 Static import resolution

A resolver script walked every `.js`/`.jsx` file under each new app's `src/`, extracted every relative
`from "…"` / `import("…")` specifier, and resolved it against the filesystem (trying `""`, `.js`,
`.jsx`, `.ts`, `.tsx`, `.css`, `/index.js`, `/index.jsx`):

| App | Unresolved relative imports |
|---|---|
| Landing | **0** — PASS |
| Client | **0** — PASS |

### 14.3 Production builds

Run **twice** for the two new apps — once before `Immiglance/Frontend/` was deleted and once after — to
prove the deletion broke nothing. Admin and Attorney were also built twice, before and after.

| Command | Before `Frontend/` deletion | After `Frontend/` deletion |
|---|---|---|
| `cd Immiglance/Landing && npm run build` | **PASS** — `✓ built in 7.00s` | **PASS** — `✓ built in 5.56s`, exit 0 |
| `cd Immiglance/Client && npm run build` | **PASS** — `✓ built in 6.69s` | **PASS** — `✓ built in 4.00s`, exit 0 |
| `cd Admin/frontend && npm run build` | **PASS** — exit 0 | **PASS** — `✓ 2473 modules transformed`, `✓ built in 10.47s`, exit 0 |
| `cd Attorney && npm run build` | **PASS** — exit 0 | **PASS** — `✓ 1457 modules transformed`, `✓ built in 4.35s`, exit 0 |

**Zero `Module not found` / unresolved-import errors in any of the eight builds.** Landing's output
includes a `AdminPortal-*.js` chunk (74.38 kB), confirming the relocated legacy admin pages compile in
their new home. Client's output includes all 13 `/dashboard/*` route chunks plus `Intake`.

### 14.4 Test suites

| Command | Result |
|---|---|
| `cd Immiglance/Landing && npm test` (`vitest run`) | **PASS** — 2 files, **4 tests passed**, 0 failed |
| `cd Immiglance/Client && npm test` (`vitest run`) | **PASS** — 3 files, **20 tests passed**, 0 failed |

Landing's `App.test.jsx` is the most valuable single check here: it mounts the **real** `App.jsx` inside
`BrowserRouter`, pushes `/` and `/eligibility/quiz`, and asserts that `/` renders under `MainLayout`
(navbar present) while the quiz renders standalone (navbar absent). That passing means Landing's
post-split router resolves correctly at runtime, not just at build time.

### 14.5 Runtime / dev-server check

`npm run build` succeeding for both apps is the validation bar the task set, and it was met. A
`npm run dev` boot was **deliberately not** performed: the user has four dev servers running
(including one on port 5173, which Landing now also claims), and starting competing Vite instances
risked port collisions with the user's own processes. The combination of a clean production build plus
`App.test.jsx` mounting the real router covers the same failure modes.

**Not validated (cannot be, from this repository):** end-to-end login → Client hand-off across two
origins. This requires Backend `CLIENT_URLS` to allowlist `http://localhost:5175` (**M-1**), which was
not changed because Backend config was out of scope.

### 14.6 Git safety verification

Two snapshots are given: one taken immediately after the code move (before the documentation pass),
and the final state.

**After the code move, before the docs pass:**

```
$ git status --short | awk '{print $1}' | sort | uniq -c
     34 ??      (new untracked files — the two new apps' shells + this report)
     13 D       (Immiglance/Frontend/ removal)
      1 M       (Immiglance/package.json — the wrapper)
    132 R       (git-tracked renames; history preserved)
      1 RM      (App.test.jsx — renamed, plus its one-line mock-path edit)

$ git diff --cached --stat | tail -1
 146 files changed, 6529 deletions(-)

$ git diff --stat                        # content changes only
 Immiglance/Landing/src/App.test.jsx |  2 +-
 Immiglance/package.json             | 19 ++++++++++++++-----
 2 files changed, 15 insertions(+), 6 deletions(-)

$ git diff --cached --stat --diff-filter=M
 (empty — every staged change was a pure rename or a deletion, zero content edits)

$ git status --short | grep -v "Immiglance/"
 ?? docs/REPOSITORY_REARCHITECTURE_IMPLEMENTATION.md
```

The decisive line is the fourth one: **every single staged change was a rename or a deletion, with
zero content diff.** Only two files anywhere had their contents modified, both explained in §9
(`App.test.jsx`'s mock path, `Immiglance/package.json`'s wrapper scripts). The 6,529 deleted lines are
`Immiglance/Frontend/`'s build shell, dominated by its `package-lock.json` (~5,600 lines), every file
of which now exists as a per-app copy.

**Final state (after the documentation pass):**

```
$ git status --short | awk '{print $1}' | sort | uniq -c
    145 R       28 A       5 M       1 AM       1 D

$ git status --short | grep -v "Immiglance/"
 M  AGENTS.md
 AM docs/REPOSITORY_REARCHITECTURE_IMPLEMENTATION.md
 M  docs/architecture/CANONICAL_WORKFLOW.md
 M  docs/architecture/COVERAGE.md
 M  docs/architecture/MODULE-CARDS.md

$ git diff --stat
 AGENTS.md                                        | 97 ++++++++++++++++++++----
 docs/REPOSITORY_REARCHITECTURE_IMPLEMENTATION.md | 16 +++-
 docs/architecture/CANONICAL_WORKFLOW.md          | 42 +++++-----
 docs/architecture/COVERAGE.md                    |  2 +-
 docs/architecture/MODULE-CARDS.md                |  4 +-
 5 files changed, 124 insertions(+), 37 deletions(-)

$ git log --oneline -1 && git branch --show-current
 bbce6df complete architecture investigation and fix …
 refactor
```

Two notes on reading the final numbers:

* **The working tree became staged part-way through** (the previously-untracked files now show as `A`
  rather than `??`). This was not done by any command in this session — most likely the editor's
  Source Control integration. It is harmless: staging is not committing, and `git reset` un-stages it.
  The `R` count rose from 132 to 145 and `D` fell from 13 to 1 purely as a consequence: once both
  sides are in the index, git pairs the deleted `Frontend/` shell files with their new per-app copies
  as renames instead of reporting them as separate deletes and adds. No file content changed between
  the two snapshots except the five documentation files.
* **The only changes outside `Immiglance/` are documentation.** `Admin/`, `Attorney/`, `Backend/`,
  `.github/`, and the root `package.json` are untouched — confirming no collateral damage.

`git reflog` shows no new entry beyond `bbce6df`. **`HEAD` is still `bbce6df` on branch `refactor`.
Nothing was committed. Nothing was pushed. Nothing was stashed, reset, or reverted.**

---

## 15. Deferred work — explicitly NOT done here

| ID | Item | Status |
|---|---|---|
| D-1 | **Centralized authentication / single sign-on origin for Landing + Client** | Not done. Both apps duplicate the existing `AuthContext`/`api.js`/`tokenStore` and each bootstraps its own session from the shared refresh cookie, exactly as the fused app did. This duplicated-context approach is a **stopgap, not the final design**. |
| D-2 | **Shared cookie domain** (e.g. `.immiglance.com`) so one refresh cookie serves both origins | Not done. No cookie attribute, domain, path, or `SameSite` value was changed anywhere. |
| D-3 | **7-day session redesign** | Not done. `REFRESH_TOKEN_TTL_DAYS` and all JWT/refresh expiry settings untouched. |
| D-4 | **Cross-subdomain session / real Landing→Client token handoff** | Not done. `CrossAppRedirect` forwards a *path* and nothing else. The `portalRedirect.js` SSO-token-in-URL mechanism was **not** extended with a Client destination. |
| D-5 | **Central login page + role-based subdomain routing** | Not done. `Login.jsx` still authenticates all three role tabs from Landing and still calls `navigate("/dashboard")`, which the shim forwards. |
| D-6 | **De-duplicating `services/api.js` / `AuthContext.jsx`** | Not done. Two copies now exist and *will* drift if an endpoint is edited in only one. Highest-value cleanup once D-1 lands. |
| D-7 | **DNS, SSL, CORS** | Not done. No Backend config, no `CLIENT_URLS` entry, no certificate or DNS work. |
| D-8 | **Production deployment for the Client app** | Not done. No S3/EC2/PM2/static-host target exists for a fourth (now fifth) frontend. |
| D-9 | **CI/CD restructuring** | Not done. `.github/workflows/inszoom-cicd.yml` is byte-unchanged and currently points at a folder that no longer builds (§13). |
| D-10 | **API domain migration** | Not done. `VITE_API_URL` and the `/api` + `/socket.io` dev proxies are identical in both apps. |
| D-11 | **`VITE_INSZOOM_URL` → `VITE_ADMIN_URL` rename** | Not done, by explicit instruction. Documented in §13. |

---

## 16. Manual follow-up work

| ID | Action | Priority |
|---|---|---|
| **M-1** | Add `http://localhost:5175` (and, later, the deployed Client origin) to Backend's `CLIENT_URLS`. Until then the Client dev server's browser requests are not CORS-allowlisted. **This blocks running Client locally end-to-end.** | Blocker |
| **M-2** | Retire the legacy `/admin` surface now living in `Landing/src/Pages/Admin/` (§7, option (a)): re-point `Home.jsx:547`'s "Staff Login" link at `VITE_ADMIN_URL`, then delete the folder, its two routes, `Landing/src/utils/visaDisplay.js`, and `adminApi`. Not urgent — nothing is broken — but it violates `AGENTS.md`. | Medium |
| **M-3** | Update `.github/workflows/inszoom-cicd.yml`: two build/package/upload/extract blocks (Landing + Client) in place of the one `Immiglance/Frontend` block (lines 32, 37, 41, 58), and two remote `dist` paths (lines 125-127). **Without this, the next push to `main` fails the whole deploy job — including the Admin and Backend stages, which share it.** | Blocker |
| **M-4** | Provision serving for the Client app (subdomain/vhost/static host). Not visible from this repo. | High |
| **M-5** | Set `VITE_CLIENT_URL` (Landing) and `VITE_LANDING_URL` (Client) in every deployed environment. The localhost fallbacks are dev-only and will silently misroute in production, the same failure mode `portalRedirect.js` already warns about. | High |
| **M-6** | Verify the backend's `GOOGLE_OAUTH_REDIRECT_URI` still targets whatever origin serves Landing's `/auth/callback`. Unchanged for localhost:5173; must be revisited when Landing gets its own production origin. | High |
| **M-7** | Verify Stripe's configured success/cancel return URLs resolve on the Client origin once it is deployed (`/dashboard/payments/success|cancel` moved apps). | Medium |
| **M-8** | Optional cleanup: 12 confirmed dead files (zero importers) were relocated rather than deleted (§8). Listed there for a future pass. | Low |
| **M-9** | Stale `Immiglance/Frontend/...` path references remain in prose comments and docs outside the scope of this change: `Backend/docs/{ISSUES.md, MONGODB_STARTUP_LOAD_FINDINGS.md}`, `Attorney/docs/*`, `Attorney/PHASE0_FINDINGS.md`, `Admin/frontend/src/hooks/useCaseQuestionnaire.js:7`, `Backend/src/models/DocumentExtraction.js:197`, `Backend/src/modules/{auth/auth.controller.js:293, auth/auth.routes.js:65, document-intelligence/config/autofill-document-types.js:5, entity-config/entityConfig.constants.js:59, questionnaires/familyChecklists.js:77, questionnaires/employmentChecklists.js:526}`. All are comments, not code. Left alone deliberately (per the repo convention of not rewriting historical/journal docs, and to avoid touching unrelated files). | Low |
| **M-10** | Fix the local `.env` `VITE_ADMIN_URL`-points-at-production inconsistency (§12). Pre-existing. | Low |

---

## 17. Risks and remaining issues

1. **CI/CD is broken until M-3.** The highest-impact consequence of this change, and unfixable within
   this task's scope. The deploy job builds `Immiglance/Frontend`, whose `main.jsx` is gone.
2. **Duplicated `services/api.js` and `AuthContext.jsx` will drift.** Two 681-line and two 261-line
   copies of the most auth-critical files in the frontend now exist. Any endpoint or token-handling
   edit must be applied twice until D-1/D-6 land. This was the deliberate, instructed trade: identical
   behaviour now over less duplication.
3. **Cross-origin session continuity is unproven in production.** On localhost the refresh cookie is
   shared across ports, so Landing→Client navigation after login works. Across real subdomains it
   depends on cookie-domain configuration that has **not** been set up (D-2). Until then, a user who
   logs in on Landing may land on Client and be bounced straight back to `/login`.
4. **Landing now ships the legacy admin surface.** `AdminPortal.jsx` is a 74 kB lazy chunk in the
   public marketing app. It is code-split so anonymous visitors never download it, and it behaves
   exactly as it did before — but it contradicts `AGENTS.md`'s rule against admin functionality in the
   client-facing app. This is pre-existing scope creep that the split inherited rather than created;
   M-2 retires it.
5. **Landing still ships portal-domain code paths.** `useHasCase` calls `casesApi.my()`, and Landing
   carries the full `api.js`. Functionally correct (it is an HTTP call, not a source dependency), but
   Landing's bundle is larger than a pure marketing site needs.
6. **Port 5173 is now Landing's.** Anyone with muscle memory that `localhost:5173` is "the client
   portal" will land on the marketing site; the portal is on **5175**.
7. **`optionalDependencies` platform gating is a behaviour change for CI.** If a Linux CI runner ever
   runs `npm ci --omit=optional`, it will no longer get the rolldown/lightningcss Linux bindings. The
   existing workflow uses `npm ci --include=optional`, so it is safe as written — but worth knowing.
8. **Dead code was relocated, not removed.** 12 files with zero importers now sit in the new apps,
   which slightly overstates each app's real surface area.

---

## 18. Recommended next phase

**Centralized authentication and subdomain routing — design first, do not start by writing code.**

The shape is already validated inside this repo: `Admin/frontend/src/pages/SSOHandler.jsx` and
`Attorney/src/auth/SSOHandler.jsx` both receive a session rather than originate one, verifying the
handed-over token against `GET /auth/me` before trusting it. The Client app should become the third
app that does this. Concretely, in order:

1. **Decide the origin map** (e.g. `www.` / `app.` / `admin.` / `attorney.` under one apex), then set a
   refresh-cookie `Domain` on the apex so all four apps share one session (D-2). This single decision
   determines whether steps 2-4 are even needed.
2. **Extend `portalRedirect.js` with a Client destination** and replace `CrossAppRedirect`'s bare path
   forward with the same token-handoff already used for staff/attorney (D-4). `CrossAppRedirect.jsx` was
   written as a single, clearly-marked file in each app specifically so it is easy to replace here.
3. **Slim Client's `AuthContext` to a bootstrap-only context** (`/auth/me` + `/auth/session-context`,
   plus `logout`), leaving the full login/signup/OAuth/invite surface in Landing (D-1, D-6). This is the
   point at which the duplicated `api.js` should be split along the same seam.
4. **Then, and only then**, do CI/CD (M-3), hosting (M-4), and CORS/`CLIENT_URLS` (M-1, D-7) as one
   coordinated change, fixing `VITE_INSZOOM_URL` → `VITE_ADMIN_URL` (D-11) in the same edit since that
   file is being rewritten anyway.

The three blockers in §16 (M-1, M-2, M-3) should be cleared **before** that phase starts, not as part
of it.
