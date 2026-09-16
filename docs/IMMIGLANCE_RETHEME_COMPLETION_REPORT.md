# Immiglance Client Portal Re-theme — Completion Report

**Status: PARTIALLY COMPLETE.** This report documents what has actually been implemented and verified, and lists what remains, honestly. It does not claim 100% completion of the 50-section spec — several sections (full per-route verification matrix with screenshots, tablet/mobile pass, complete "no dead UI" audit, staff/admin portal) are explicitly incomplete or out of scope, called out below.

Scope: `BAIS/Frontend` (the client-facing app) and the shared `Backend`. `INSZoom` (the internal staff CRM) was treated as **out of scope** throughout — this spec is about the client portal, and INSZoom is a separate staff-facing product with its own identity.

---

## 1. Design system (Phase 1 — done)

Centralized token system in `BAIS/Frontend/src/index.css` (Tailwind v4 `@theme inline`), covering:
- Colors: background, foreground, card, primary, secondary, muted, accent, destructive, border, input, ring, sidebar-*, chart-1..5 — light and dark variants, both wired through CSS custom properties (`:root` / `.dark`).
- Typography: Satoshi (body), Cabinet Grotesk (headings — `<h1>`/`<h2>` only, not `<h3>`/`<h4>`, matching the reference's actual usage), JetBrains Mono (case IDs/reference codes). Loaded via Fontshare/Google Fonts in `index.html`. Verified via direct browser inspection (`document.fonts`) that Cabinet Grotesk actually loads, not just falls back.
- Dark mode: `ThemeContext.jsx` + `ThemeToggle.jsx`, persisted to `localStorage`, toggle in the navbar/portal top bar.

**Not done:** the spec's "white Immiglance theme" framing (section 7) argues for light-only; this implementation kept dark mode as a first-class option per earlier decisions in this project. If a light-only mandate is intended, that's a design decision to confirm, not a technical gap.

## 2. Application shell (Phase 1 — done)

- **Public/marketing shell** (`MainLayout.jsx` + `Navbar.jsx`): simple top navbar (logo, Client Login, Start Free Evaluation, dark toggle) matching the Immiglance reference header exactly — verified pixel-by-pixel against the reference screenshots (logo position, gutters, button styling).
- **Authenticated portal shell** (`PortalLayout.jsx`, new): left sidebar ("Case Portal" group — Overview, Profile, Documents, Messages, Billing, QuickBooks, FedEx), collapsible, active-item highlighting; top bar with case reference (mono), visa — client name, status badge, dark toggle, logout. This replaces the old top-nav for every authenticated route.
- **Verified live**, logged in as a real (throwaway, since deleted) test client with a real case: sidebar, top bar, Overview, and Documents/Checklist all render correctly together, in both themes.

## 3. Pages migrated to the token system

Retoned to the shared design system (structural neutrals → tokens; brand-emerald/slate/red → primary/secondary/destructive; deliberately-distinct semantic/category colors left alone, e.g. status badges, category chips):

- Home (rebuilt pixel-faithful to the Immiglance hero/category-grid/how-it-works layout), About, HowItWorks, Offers
- Login (rebuilt with the three-tab Client/Attorney/Team-member entry pattern — presentational only; real routing still decided server-side by `AuthGate`), Register, ForgotPassword, ResetPassword, AcceptInvite
- Dashboard/Overview, Documents (combined checklist+file page), Messages, Payments, PlanSelection, PaymentSuccess/Cancel, FilingTypeSelection, DocumentReview
- Eligibility flow (Intro/Quiz/Results + shell/components), Consultation flow (BookConsultation/ManageBooking + ConsultationSection/StepShowcase)
- Shared components: NotificationBell, InfoPopup, PageLoader, ApplicantTypeSelector, OfferCard, BenefitCard, StartAssessmentButton
- New placeholder pages: QuickBooks, FedEx (routed into the sidebar, "coming soon" empty state)
- Notifications page, ProtectedRoute's auth-error/logged-out states

**Deviation flagged during implementation:** the reference shows separate "Tasks" and "Documents" destinations; this codebase's `Documents.jsx` already combines the questionnaire checklist and file uploads into one integrated page (with real multi-role employer/employee logic). Splitting it apart would have been a logic change, not a retheme, so it was kept as one "Documents" sidebar entry rather than fragmenting working functionality.

**Not yet retoned / not verified in this pass:** Settings screen (if one exists distinct from Profile — not located as a separate route in this app; Profile covers account settings), any remaining Admin/INSZoom-adjacent screens (out of scope), full component-by-component consolidation pass (tables/pagination/tooltips/breadcrumbs) per section 37 — the app doesn't have a data-table-heavy client surface, so most of that section doesn't apply here, but a dedicated pass wasn't done.

## 4. Rebrand — legacy branding removal

Ran a full case-insensitive search across `BAIS/Frontend/src`, `index.html`, and `public/` for `BAIS`, `USAIS`, `Bay Area Immigration Services`, `Immigratia`, `INSZoom`, `ImmigrationCRM`. Findings and actions:

**Fixed (client-facing):**
- `index.html`: title, meta description/keywords/author, Open Graph, Twitter card, apple-mobile-web-app-title, JSON-LD `name`/`provider.name` → all now "Immiglance".
- Every `document.title` across client pages (Login, Register, AcceptInvite, ForgotPassword, ResetPassword, Dashboard, DocumentReview, Documents, FedEx, HowItWorks, Intake, Messages, Profile, QuickBooks, About, Home) → "Immiglance".
- Every visible "BAIS" wordmark/logo text (Login, Register, ForgotPassword, ResetPassword, AcceptInvite, About footer, Intake, PortalLayout sidebar) → "Immiglance". Login's large brand-panel wordmark was resized (7xl/8xl → 5xl/6xl/7xl, tighter tracking) since "Immiglance" is longer than "BAIS" and would have overflowed at the old size — verified by screenshot.
- Footer/copyright lines, About.jsx's Google-review testimonial copy (which named "BAIS" repeatedly), Dashboard's fallback agent name and activity-feed text, Messages' "BAIS Case Team" sender fallback (→ "Immiglance Case Team", matching the original reference screenshot's own wording), Offers' referral share text, HowItWorks' CTA copy, ProtectedRoute's logged-out CTA and footer, LegacyHolding's footer.
- **All 34 client-facing email templates** (`Backend/src/modules/email/templates/*.js`): the single shared HTML wrapper (`email.service.js`'s `wrapHtml`) that every template renders through was rebranded once (header band, footer line, copyright) — fixing all 34 emails in one place rather than 34 separate edits. Six templates additionally had "BAIS" hardcoded directly in their body text (case-approved, case-closed, case-created-client, client-portal-invitation, family-beneficiary-invitation, password-reset) — fixed individually.

**Deliberately left alone (internal/technical, not rendered to users):** CSS class names (`bais-password-input`), a custom DOM event name (`bais:session-expired`), `localStorage` key names (`bais-theme`, `bais_has_session`, `bais_access_token`, `bais_fcm_token_registered`, `bais:ff:` prefix), the `legacySource: "BAIS"` data-tagging value sent to the backend, the `BAIS_FRONTEND_URL` environment variable name, code comments referencing INSZoom/BAIS architecturally, and the real business domain/email (`bayareaimmigrationservices.com`) used for actual links and contact addresses. Renaming any of these would be an infrastructure/config change with no user-visible benefit and real regression risk (session-expiry handling, feature-flag storage, env config across deployments).

**Verified:** re-ran the same six-pattern search after all fixes — zero remaining client-facing occurrences outside the intentionally-excluded technical list above and the Admin/INSZoom staff surfaces (out of scope).

**Not done:** `INSZoom/frontend` and `Backend`'s non-email, non-client-facing surfaces (internal CRM UI, admin-only API messages) were not audited for branding — they are staff-facing, not part of this spec's "client portal" scope.

## 5. Backend integration fixes (found during this work, not pre-existing scope)

Two real bugs were found and fixed while verifying the portal end-to-end, both affecting *every* visa type, not just the ones initially reported:

1. **Visa type recognition**: `Backend/src/config/visaCategories.js` recognized only ~30 visa types; the true source of truth (the `VisaFormMapping` registry, 79 distinct types) was never consulted. Expanded to all 77 legitimate, selectable visa types (excluding two workflow-only pseudo-categories), purely additive — no existing case data affected. Verified: case creation for EB-1B (previously rejected) now succeeds.
2. **Visa dropdown / mapping mismatch**: INSZoom's "New Case" modal had its own separately-maintained, incomplete visa list, including options (plain `"EB-2"`, `"EB-3"`) that could never resolve real forms. Rewritten to match the backend's list exactly.
3. **Form-to-template wiring gap**: ~44 entries in the `VisaFormMapping` registry (I-485, I-765, I-131, I-693, I-360, I-526, I-526E, I-751, I-90, N-400, N-600, N-565, etc.) never set the field linking a mapping row to an actual fillable PDF template — meaning even a correctly-classified case could never get its forms populated. Fixed all of them (purely additive, diffed and test-verified).
4. **Imported three real USCIS PDF templates** (I-140, I-485, I-693) that were sitting unused in `Backend/dev-assets/uscis/`, using the project's existing import pipeline. Verified live: a fresh EB-1B case now auto-attaches all three forms immediately at creation, no manual step.

All backend test suites touched (`visaFormMapping.test.js`, `case-lifecycle-form-provisioning.test.js`, `case-lifecycle-routes.test.js`, `uscis-form-import` tests) pass — 47+ tests, no regressions.

**Not done:** a full "no dead UI" audit (section 30) — checking every button/handler/API call across the entire client portal for orphaned or broken wiring — was not performed as an exhaustive pass. Spot-checks during page-by-page retheming did not surface additional issues, but this was not systematic.

## 6. What was explicitly NOT done in this pass

Being direct about gaps, per the report's own requirement not to claim false completion:

- **No page-by-page verification matrix** (section 36) was produced as a literal table with per-route screenshot comparisons against the reference. Verification was done via targeted screenshots (Home, Login, About, HowItWorks, Documents, Dashboard) in both themes, plus one full live authenticated walkthrough — not all ~25 client routes individually.
- **No tablet-specific responsive verification.** Desktop and a live authenticated session were checked; explicit tablet breakpoint testing was not performed.
- **No email verification matrix** (section 38) as a literal table — the shared wrapper and the six templates with inline branding were fixed and syntax-checked, but sending/rendering each of the 34 templates was not individually tested end-to-end (would require a live SMTP/test-inbox setup not available here).
- **USCIS form templates beyond I-140/I-485/I-693** (I-360, I-526, I-526E, I-751, I-90, N-400, N-600, N-565, I-918, I-612, I-129S, I-864/I-864EZ, I-829, I-956F, I-824) remain unimported — the mapping now correctly wants them, but the actual government PDFs aren't in `dev-assets/uscis` and can't be fabricated. This is a content-acquisition task, not a code gap.
- **Admin/INSZoom staff portal** was not retoned or rebranded — treated as out of scope per this spec's own "client portal" framing, consistent with the scoping decision made earlier in this project.
- **Mobile-specific manual testing** was not performed beyond the responsive Tailwind classes already in place from the original implementation.

## 7. Regression verification performed

- `npm run build` passes cleanly in `BAIS/Frontend` after every batch of changes in this pass.
- Backend: `node --check` on every edited file; full test suites for the touched modules pass (47+ tests, 0 failures).
- Live, authenticated, end-to-end walkthrough (real signup → staff case creation → invite → login → sidebar/Dashboard/Documents) performed and screenshotted in an earlier part of this session; not re-run after the rebrand text changes in this pass, though the rebrand changes were text/copy-only (no logic touched) and the build passed, so regression risk is low.

---

**Bottom line:** the design system, application shell, sidebar navigation, and the large majority of client-facing pages are migrated and verified. The rebrand search-and-fix pass in this session closed out the remaining legacy-branding gaps found by a full repository search. Two real, previously-unknown backend bugs affecting every visa type were found and fixed as part of getting the portal to actually work end-to-end. What remains is primarily *exhaustive verification* (a literal per-route matrix, per-email test sends, tablet pass, dead-UI audit) rather than known-incomplete implementation — but since that verification wasn't done, this report does not claim it.

---

## 8. Follow-up session — 2026-09-16

Six further pieces of client-portal work, done in a separate later session and not previously written up anywhere. Same honesty rule as above: documented as actually done and verified, gaps called out explicitly.

### 8.1 Home page contact-form popup

**Problem:** the "Still have questions?" contact form on `Home.jsx` used a native `window.alert()` for both the success and error outcome — an unthemed browser dialog, and the user's stated request was that submitted leads should reach the admin Leads inbox.

**Circumstances analyzed:** before writing any UI, checked whether the lead pipeline actually worked end-to-end. It did: the form already called `leadsApi.create()` → `POST /leads/public` → `lead.service.js`'s `createLead()`, which persists a real `Lead` document and fires a staff notification (email + in-app), and the admin Leads Inbox (`GET /eligibility-quiz/leads`) already lists every `Lead` with no source filter. So the backend needed no changes — only the popup itself was the actual problem.

**Solution:** built a themed `ContactResultModal` component (backdrop blur, centered card, success/error icon states, app theme tokens) and replaced both `alert()` call sites (success and error) with it; reworded the success message.

**After-effects:** positive — consistent themed UX, zero backend risk since nothing there was touched. No negatives identified.

**What should be done differently next time:** always verify whether a "this needs to be wired up" request is actually already wired up before building new plumbing — here it was, and the real fix was much smaller than the initial framing suggested.

### 8.2 Eligibility quiz — full rebuild

**Problem (as given):** the quiz's colors (navy/tan) didn't match the app theme; the category/visa picker was a separate page with the navbar visible (closeable); the question flow was wrong (profile step + a 0–3 "evidence strength" scoring step); nothing autosaved; an abandoned quiz lost all data.

**Circumstances analyzed (research before any code):** dispatched an Explore agent to map the whole flow first. Findings that shaped every decision below:
- The navy/tan look came from `EligibilityShell.jsx` fetching "brand tokens" from the backend `Settings.brandTokens` (defaulting to hardcoded navy `#0B1F3A`/gold `#C6A15B`) and injecting them as CSS variables that every quiz button/progress-bar read from *instead of* the app's real `--primary`/`--secondary` tokens — a parallel, mismatched theming system layered on top of the real one.
- There was no autosave anywhere: everything was one all-or-nothing `POST /eligibility-quiz/submit` at the very end.
- A real backend scoring engine (`scoring.service.js`, `recommendation.service.js`, per-visa criteria in `quiz.config.js`) computed tiers (A–D) and pathway recommendations from 0–3 "evidence strength" answers.

**Decisions confirmed with the user before building (`AskUserQuestion`, not assumed):** (1) remove the 0–3 scoring step entirely, replacing it with the five new fixed questions — user picked this over "keep scoring as an extra step"; (2) fold the category/visa picker into one continuous, navbar-free quiz — user picked this over "keep the separate intro page." Given the size of the resulting change, a full plan was written and approved (`ExitPlanMode`) before any file was touched.

**Solution — backend:**
- `quiz.config.js`: replaced the old 3-question `DEFAULT_PROFILE_QUESTIONS` with the 5 new questions (location / immigration status / profession / goal / timeline), reusing the exact existing `{key,label,type,options,required}` shape the frontend already knew how to render — no new schema needed.
- `quiz.service.js`'s `submit()`: made scoring conditional on `criteriaAnswers.length > 0`, so a criteria-less submit (the new normal case) no longer produces a meaningless "Tier D" on every lead, while the scoring engine itself stays fully intact for any visa an admin still configures with real criteria via the existing admin CRUD.
- Added a public `POST /eligibility-quiz/draft` autosave endpoint. `Lead.js` gained `sessionId` + `isDraft` fields (additive). `lead.service.js`'s new `saveDraftLead()` upserts a draft `Lead` by `sessionId`; `createQuizLead()` now finalizes that same draft document on real completion instead of creating a second, duplicate lead.

**Solution — frontend:**
- New `ChoiceStep.jsx` component: one big-card single-select question per screen, selecting an option immediately advances (no separate "Next" click for these steps).
- `EligibilityQuiz.jsx` rewritten around `STEPS = [contact, category, visa, location, immigrationStatus, profession, goal, timeline]`. Every step advance fires a fire-and-forget draft save; a `pagehide`/`visibilitychange` listener flushes the latest answers via `navigator.sendBeacon` (survives tab close, unlike a normal fetch) as a safety net for a user who closes mid-step. Completing the quiz navigates straight to `/consultation/book/:leadId` — no results/tier screen.
- Deleted (fully superseded, confirmed unused elsewhere first): `EligibilityIntro.jsx`, `EligibilityResults.jsx`, `ProfileStep.jsx`, `CriteriaStep.jsx`, `CriterionCard.jsx`, `LiveTracker.jsx`.
- Theming fix applied everywhere the navy/tan leak reached, not just the quiz: `EligibilityShell.jsx` no longer fetches/injects brand tokens at all; `QuizProgress.jsx`, `ConfirmedScreen.jsx`, `BookConsultation.jsx`, `MonthCalendar.jsx`, `TimeSlotList.jsx`, `ManageBooking.jsx` all converted from `var(--eligibility-*)`/hardcoded slate-*/navy-hex styling to the real theme classes (`bg-primary`, `text-primary-foreground`, `border-border`, etc).
- Routing (`App.jsx`): `/eligibility` now redirects to `/eligibility/quiz`; `/consultation/book` and `/consultation/booking` moved out of the navbar-having `MainLayout`. **Deliberately left `/consultation/book` unguarded by `BlockIfHasCase`** (unlike the quiz route) — it's also linked to from the logged-in intake flow (`Intake.jsx`), and adding that guard would have been an unintended access-control regression for that unrelated flow. This is the kind of side effect worth specifically checking whenever a route gets regrouped.
- `StartAssessmentButton.jsx` now links straight to `/eligibility/quiz` (dropped the `/eligibility` intro hop).

**Verification:** `eslint` clean on every touched/new file (one known pre-existing false positive — `motion` flagged "unused" on every file using `framer-motion`'s `motion.div`, confirmed via a second, untouched file showing the identical false positive, so not a regression). Full frontend `vitest` suite run: 5/5 files, 24/24 tests passed, including a previously-flaky `App.test.jsx` case — confirmed via `git stash` that this test was already failing *before* any of this session's changes, so not something introduced here.

**After-effects (positive):** one consistent, on-theme flow; real backend enforcement of the new question set instead of a stale hardcoded one; an abandoned quiz still leaves a usable, visible lead behind; a completed quiz never creates a duplicate lead.

**After-effects (risk considered, not a regression):** the scoring engine, admin-authored `QuizDefinition`/`ScoringConfig` CRUD, and criteria-based tier computation were deliberately left fully in place rather than deleted, since they're still reachable/usable infrastructure for admin-configured visas — only the *public* quiz stopped sending criteria answers.

**What should not be done:** don't delete backend capability just because one frontend caller stopped using it, if another caller (here, the admin CRUD) might still depend on it.
**What should be done:** when merging several pages into one flow, explicitly re-check every route that flow used to link *out* to (here, consultation booking) for guard/access-control side effects — not just the pages being merged.

### 8.3 Local dev pointed at production (misdiagnosed as a code bug)

**Problem:** user reported the quiz's 4th step rendering blank.

**Circumstances analyzed:** rather than assuming the just-shipped backend code was wrong, verified it directly — calling `resolveDefinition()` in a throwaway script returned the correct 5 new questions, and the actual locally-running dev backend (already up on port 7000, auto-reloaded via nodemon) also returned them correctly over HTTP. The real cause: `Immiglance/Frontend/.env`'s `VITE_API_URL` pointed at the **live production API**, not `localhost:7000` — so the browser was talking to the old, un-migrated production backend the whole time, which still had the old 3-question set.

**Solution:** confirmed with the user first (`AskUserQuestion` — this touches a config file, and pointing local dev at production instead of localhost could conceivably be intentional), then repointed `.env` at `http://localhost:7000/api` and told the user to restart the Vite dev server (env vars are only read at process startup, not hot-reloaded).

**What should be done:** when a "my change isn't showing up" report comes in, verify *both* that the code is actually correct *and* that the client is actually talking to the environment you think it is — don't assume the bug must be in the code just because you just changed the code.

### 8.4 "BAIS" branding leaking from data, not code (two separate incidents)

**Problem:** the user reported, with visible frustration at a repeat occurrence ("I've told you a zillion times"), that "BAIS" was still appearing — first in a consultation-confirmation email and the top-of-page compliance disclaimer, and later (self-discovered) in a settings field surfaced while building the settings engine (§ see the separate Settings Engine report).

**Circumstances analyzed:** a plain `grep -r "BAIS"` across `Backend/src/modules/email` found **nothing** — the templates were already fully parameterized (`${data.msoEntityShortName || "us"}`). Tracing the data flow (`entityConfigService.getPublicConfig()` ← `Settings` singleton) and querying the live database directly showed the actual document still held `msoEntityName: "Bay Area Immigration Services"`, `msoEntityShortName: "BAIS"`, `activeBrand: "BAIS"` — a stale value from before the rebrand. Notably, the Mongoose **schema's own defaults** already correctly said `"Immiglance"` — schema defaults only apply when a document is first created, never retroactively, so the pre-existing singleton document kept its old values regardless.

**Solution (defense in depth, two layers):**
1. Fixed the root-cause data: updated the live `Settings` document's name fields directly to `"Immiglance"`.
2. Hardened the code so this class of bug can't silently reappear: rewrote the 6 email templates that read the mutable `data.msoEntityShortName` field (`consultation-confirmation`, `consultation-reschedule`, `consultation-cancel`, `lead-approved`, `lead-rejected`, `quiz-lead-confirmation`) to hardcode `"Immiglance"` literally, matching the pattern several *other* templates already used correctly. Did the same for the two disclaimer fallback templates in `compliance.constants.js` (this is what renders the top-of-page banner).

**Verification:** re-rendered every hardened template and the resolved disclaimer text directly, confirmed "Immiglance" everywhere; re-ran the grep sweep, confirmed zero remaining occurrences in `Backend/src/modules/email`.

**Found but deliberately not touched:** `.github/workflows/inszoom-cicd.yml` and a historical rebrand doc still literally say "BAIS" (deploy folder paths, secret names, historical record) — not client-facing, flagged rather than changed (this became relevant again in §8.5 below).

**Memory/documentation updates made at the time:** wrote `feedback_immiglance_branding_only.md` (Claude Code memory) capturing "check database data, not just code, for legacy names"; corrected `project_architecture.md`'s own stale "BAIS client portal" wording.

**What should not be done:** don't treat a clean code-grep as proof a branding leak is fixed — dynamic templates fed from a database are an easy-to-miss second source, and this file itself is proof the same class of bug recurred a second time (`companyName`) after the first fix, because the first pass fixed only the *reported* fields rather than sweeping every name-like field on the same document.
**What should be done:** when a legacy value is found on a settings/config document, check every sibling field on that *same* document for the same staleness in one pass, rather than fixing only the specific field that was reported.

### 8.5 Client portal login page — layout, credential options, and CI/CD fallout

**Problem, part 1 (layout):** the client-portal login page (`Immiglance/Frontend/src/Pages/Auth/Login.jsx`) required scrolling to see the bottom of the form.
**Problem, part 2 (options):** three credential-entry methods were offered (Email / Case ID / Username); per the user's product decision, Username is redundant with Email and should be removed, leaving two.
**Problem, part 3 (raised after the above landed):** the Google sign-in button and the Email/Case-ID toggle were showing for the "Team member" tab too; per the user, those are client-only.
**Problem, part 4:** a specific subtext line under the "Team member" tab's heading needed to be removed outright.

**Circumstances analyzed:** before removing the Username option, checked the backend (`auth.service.js`, `username.service.js`) to understand it correctly first — a `username` field genuinely *can* differ from a user's email for an invited employee/beneficiary who picked a custom one during invite acceptance, so it isn't literally a no-op backend-wise. The user's instruction was still a deliberate product simplification of the *client-facing UI*, not a claim that the fields are identical in the database, so it was implemented as asked on the frontend only, without touching the backend's still-useful `username` login path (used elsewhere, e.g. by invited staff). Before touching `PasswordField`'s internal spacing to help the layout fit, checked all its consumers first — it's shared by 5 other pages (Register, Profile, ResetPassword, AcceptInvite) — and left it untouched, working around it locally in `Login.jsx` instead (including its *local* `FieldWrap` helper, confirmed local-only before adjusting its margin).

**Solution:**
- Layout: compacted paddings/margins/icon sizes throughout the card; changed the outer wrapper from `min-h-screen` (lets the page grow taller than the viewport) to `h-screen`, with `overflow-y-auto` on the card itself as a safety net for very short viewports.
- Options: removed the `username` state, its login-method branch, and its input UI entirely; the method-tab grid went from 3 columns to 2 (Email / Case ID).
- Client-only gating: wrapped the Google button + divider + Email/Case-ID toggle in `roleTab === "client"`; reset `loginMethod` back to `"email"` on every tab switch (prevents a stale "Case ID" selection silently carrying over to a tab that no longer shows the toggle).
- Removed the team-member subtext line outright, and made the subtext `<p>` render conditionally so an empty string doesn't leave a dangling blank-paragraph gap.

**Verification:** `eslint` clean after each change; full frontend test suite (24/24) run once at the end.

**After-effects:** purely presentational; zero backend impact; no shared-component regression risk (PasswordField untouched).

**Problem, part 5 (a genuinely separate, larger issue found while investigating "team member should land straight on their dashboard"):** the user wanted a team member who authenticates via Immiglance's shared login to never see the INSZoom (staff CRM) login page again, and instead land straight on their dashboard — while a team member who visits the INSZoom URL directly with no session should still see the normal login form.

**Circumstances analyzed:** `INSZoom/frontend/src/pages/Login.jsx` had **no** "already authenticated, skip the form" guard at all — unlike Immiglance's own `Login.jsx`, which already had one. Investigating the cross-app session mechanism: the shared `refresh_token` cookie has no explicit `domain` restriction (scoped to whichever host actually issues it), and INSZoom's `AuthContext` already silently attempts `/auth/refresh` on every mount — it's already designed to recognize a shared session, and correctly **rejects** anyone who isn't staff (`canAccessAdminPortal` check) — i.e. a genuine client account correctly can never reach the staff CRM this way; that's intentional security, not a bug to "fix."

**Solution:** added one `useEffect` to INSZoom's `Login.jsx`, mirroring Immiglance's own existing pattern: once `authLoading` is false and `user` is already resolved (via the pre-existing silent-refresh mechanism), redirect to `/dashboard` instead of rendering the form.

**A second, larger problem found in the course of this investigation:** `AuthGate.jsx`'s cross-app redirect target, `VITE_INSZOOM_URL`, was **not set anywhere** — not in Immiglance's `.env`, not in the CI build config — so it silently fell back to a hardcoded `http://localhost:3002`, meaning the staff cross-app redirect went nowhere real in production. Digging further to fix that surfaced a **third, unrelated but more severe** problem: the CI workflow's "Build Immiglance Frontend" step had lost its *entire* env-var injection block (Stripe key, all Firebase config, `VITE_API_URL`) at some point — almost certainly when the app/folder was renamed from BAIS to Immiglance — meaning the CI-built production bundle was compiling with none of those values set at all, not just the one this investigation started from.

**Resolution:** did not guess at production secret values or silently rewrite the CI file. Asked the user directly (`AskUserQuestion`, twice — once for the actual production INSZoom URL, once to confirm whether the GitHub Action secrets were still named `BAIS_VITE_*` or had been renamed) before touching anything. Restored the full `env:` block to the CI workflow's Immiglance build step, referencing the confirmed-still-existing `BAIS_VITE_*` secret names, and added `VITE_INSZOOM_URL` sourced from a new `BAIS_VITE_INSZOOM_URL` secret.

**Left outstanding, explicitly flagged rather than silently assumed done:** the actual GitHub secret `BAIS_VITE_INSZOOM_URL` still needs to be created in the repo's GitHub settings by the user — no tool here has access to GitHub secrets. Also flagged, not fixed: INSZoom's own "Build Admin Frontend" CI step has the same missing-env-block shape; whether that's actually a problem for that app wasn't confirmed either way.

**What should not be done:** never silently rewrite CI/production secret wiring based on a guessed value — this class of change is exactly "hard to reverse, affects shared infrastructure," and here a wrong guess (the placeholder URL used while asking the question) happened to be confirmed correct, but that was luck, not something to rely on.
**What should be done:** when investigating *why* a cross-app redirect "should" work, verify the actual resolved env var value in the real deployment path, not just that the code has a fallback — a fallback silently masks a missing production config exactly like this one did.
</content>
