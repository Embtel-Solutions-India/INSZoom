# One client, many cases — plan

Status: plan approved by the owner on 2026-11-05; no phase started yet. Progress and results are recorded in `docs/MULTI_CASE_CLIENTS_REPORT.md` (one report covering all phases, created in Phase 1).

## Context

Today one email = one client login = one case. When a returning person needs another matter (H-1B now, I-765 EAD later; a second family petition; a second employer matter; an employee who later opens their own case), staff hit `CLIENT_ALREADY_HAS_CASE` and the client portal can only ever show one case. Goal: the **same login** owns **any number** of independent cases (2nd, 3rd, 4th, …), the client switches between them, each case's answers/documents/forms/status stay separate, and the person's identity data (name, DOB, address, passport, resume…) is **auto-copied into each new case, never overwriting**. Owner decisions: staff create the new case (no client self-serve start yet); auto-copy, never overwrite; all case types; N cases.

### What the pasted plan gets right / where the code differs
- Right: keep unique email + one `User`; extend `caseIds`; keep `primaryCaseId` as the default; per-case `CaseForm`; never authorise by email match; phase + test.
- The guard is in **more places**: `case.controller.js:1238` (`CLIENT_ALREADY_HAS_CASE`), `ghlCaseFactory.js:64` ("Client already has a case"), `ghlEmployerMatching.js:77-89`, `createCaseWithClient` (`CLIENT_ALREADY_REGISTERED`, and a crash for other existing users at `:3945`), quiz `rejectIfHasCase` (keep — staff-only start).
- Several paths **overwrite** links instead of appending: `case.controller.js:1447,1552`, `ghlCaseFactory.js:292`, `ghlEmployerService.js:138`. Family, delegate and invite-employee paths already append (`$addToSet`).
- Client **authorisation does not use `caseIds`** — `case.service.js canAccessCase` (137-191) checks per-case relations (`user`, `employerUser`, `petitionerUser`, `employeeUser`, `beneficiaryUser`…), so a second case is authorised by its own relations, never by email. Gap: `applyCaseRoleFilter` (`:252`) client branch omits `employerUser`/`employeeUser`.
- "Current case" is picked by **four different rules** (`/cases/my`, `/auth/session-context`, client-intake `getActiveCaseForClient`, payments newest-by-`user`). With one case they agree; with two they won't.
- Portal mixes cases today: `useDocumentChecklist.js` lists **all** the user's documents grouped by type; `useMyCaseProfile` query key has no case id; no switcher; `Login.jsx:72` always goes to `/dashboard`.
- **No new person-profile model needed**: per-case canonical profile with provenance (`CanonicalMergeService`), `config/fieldScope.js` (what may carry over), shared `Beneficiary` record, and a working copier `family-workflow/petitioner-prefill.service.js` already exist.
- No Mongo transactions anywhere; rollback is manual (`cleanupPhase5Create`). Linking must be idempotent (`$addToSet`).
- To verify first: `single-party-filing.controller.js:33` and `employment-workflow createEmployerCase:272` appear to set the **staff caller** as `Case.user`/`employerUser`.

## No-error rules (apply to every phase — a phase is not done until all hold)

1. **Nothing that works today may break**: signup, login, Google login, email verification, accept invite / set password, forgot / reset password, sessions, staff case creation (all paths incl. GHL and lead conversion), checklist filling + Save progress + Submit, document upload / view / download, forms autofill / generate / download, petition + supporting documents, messages, payments, notifications, Attorney portal, Admin pages.
2. **One-case clients see zero change** (same screens, same URLs, same responses). Every new parameter is optional; every existing endpoint keeps its contract; new fields are additive.
3. **Fail-safe side effects**: linking, prefill, notifications run so that a failure is logged and never fails the request or leaves a half-created case (owner rule "additive, fail-safe"). No new uncaught throw paths in the UI — every new call has loading / empty / error states.
4. **No cross-case leaks**: a request for a case the person is not on returns 404 exactly like today; email match alone grants nothing.
5. **No data damage**: never overwrite an existing answer/link; never touch real cases; DB writes only via dry-run-then-apply scripts with approval; one test person only, deleted after.
6. **Kill switch** `MULTI_CASE_CLIENTS` (backend env): off = exactly today's behaviour.
7. **Checks per phase**: targeted new unit tests + `npm run test:safe` compared with the known-failure list (no new failures), Admin / Client / Landing / Attorney `npm run build` all green, read-only DB dry-runs. No e2e, no full DB suites (owner rules).

## Working method (owner instruction)
- **One phase at a time.** After each phase I stop and report: what was done, test/build results, what is remaining, any risks found — then wait for explicit approval before the next phase.
- **Backend and frontend in every phase** (each phase ships something visible).
- **One completion report covering all phases**: `docs/MULTI_CASE_CLIENTS_REPORT.md`, created in Phase 1 and extended after every phase (done / not done / tests / files / env vars for production).

## Phase 1 — Link many cases to one login (backend) + staff see it (Admin)

Backend
1. **Shared linker** `Backend/src/modules/cases/caseLinks.service.js`: `linkPersonToCase` (`$addToSet caseIds`, set `primaryCaseId` only if empty/stale, reusing `auth/staleCaseLinks.js pruneStaleCaseLinks`), `unlinkPersonFromCase` (`$pull`, repoint primary to newest remaining).
2. **Every creation path reuses the existing person and appends**: `createCase` (no has-case refusal for client-side accounts; keep `EMAIL_OWNED_BY_NON_CLIENT` for staff/attorney; rollback snapshot keeps prior links), `createCaseWithClient` (reuse instead of 409/crash), single-party + employment paths (link the client by email), GHL `ghlCaseFactory` / `ghlEmployerService` / `ghlEmployerMatching`; family / delegate / invite paths moved onto the same linker.
3. **Capacities**: a person can be client, petitioner, employer, employee, beneficiary on different cases; access stays per case via existing relation fields. An employee/beneficiary login that gains its own case becomes `client` without losing its employee/beneficiary case. `applyCaseRoleFilter` client branch adds `employerUser`, `employeeUser`, `delegateEmployerUser`.
4. **Lifecycle**: invites stay per user; an already-active person gets the existing "case created for a client with a working account" e-mail + in-app + browser notification; deleting one case keeps the account if others remain; recycle-bin restore re-links via the linker.
5. `GET /cases/people/:userId/cases` (staff) for the Admin strip.

Frontend (Admin)
6. **New case** modal: when the email belongs to an existing person, show "This person already has N case(s) — the new case is added to the same login" (name + email, not case numbers).
7. **Case detail**: "Other cases for this person" strip with links.

Exit gate: tests for every creation path (append, no overwrite, idempotent retry, rollback keeps old links), access matrix, all auth flows green; builds; report written.

## Phase 2 — Client Portal: My Cases + switching

Backend
1. **One "current case" resolver** used by `/cases/my`, `/cases/my/pipeline`, client-intake `/me`, `POST /documents/me`, payments summary + partial checkout: explicit `caseId` (authorised via `canAccessCase`) → `primaryCaseId` → newest. No `caseId` = exactly today.
2. `GET /cases/mine`: every case the person is on (number, visa, status, stage, capacity, last activity).
3. Client e-mail links carry `?case=<id>` (`email.service.js:238`).

Frontend (Client, Landing login)
4. `ActiveCaseContext` (URL `?case=` → sessionStorage → server default); every React Query key holding case data includes the case id.
5. Header switcher in `PortalLayout.jsx`, shown **only with 2+ cases**; "My Cases" list page.
6. Every page sends the selected case: Dashboard, Profile intake, PlanSelection, Messages (thread per case, list labelled by case), Payments, Petition (rows labelled by case), Documents — fix `useDocumentChecklist.js` to filter by case.
7. Employer matters keep `PrincipalCaseWorkspace`; employee + own case both in the switcher; `AuthGate.jsx` confinement per selected case.
8. Login keeps a safe same-origin return-to so an e-mailed case link lands on that case.

Exit gate: tests for 0 / 1 / 3 cases, switching never shows stale data, deep link → right case; builds; report updated.

## Phase 3 — Carry personal data into each new case (auto-copy, never overwrite)

Backend
1. Generalise `petitioner-prefill.service.js` into `cases/personPrefill.service.js`, run (fail-safe) after any case is linked to an existing person; source = that person's most recent earlier case(s) as the **same person**; match by canonical path, never by label.
2. Copy only carry-over facts (identity, contact, passport, address history, education, travel — `config/fieldScope.js`); never employment, current status/visa, employer facts, signatures, attestations, declarations.
3. Party translation through existing maps (`PartyAliasService.js`, `familyPartyPaths.js`, `profileCanonicalMap.js`) — only the person's own facts, never an employer's or a relative's.
4. One timezone-safe date normaliser (reuse `MappingResolver.calendarParts`): `yyyy-mm-dd`, `mm/dd/yyyy`; `dd-mm-yyyy` only when unambiguous, else left blank — never guessed; fix `CanonicalTransformationService.date`.
5. Skip already-answered questions; record source case + path + time; rebuild the new case's canonical profile with the existing builder so forms fill through the existing pipeline.
6. Documents (passport, resume/CV, ID, degree, birth certificate): new case gets its **own Document record pointing to the same stored file**, marked "from case X"; reference check before any hard purge.
7. Employer matters: company facts from the employer's latest `EmployerProfile` via `canonicalFieldWriter`; employees never copied across employers.

Frontend (Client + Admin)
8. "Pre-filled from your earlier case" marker on copied answers/documents in the client checklist; the same marker + source case in Admin's answers / documents panels; editing changes only the current case.

Exit gate: prefill matrix tests (roles, never overwrite, excluded fields, ambiguous dates, per-case documents, form values identical to hand-entered); builds; report updated.

## Phase 4 — Hardening, full verification, rollout

Backend: dry-run report of existing users whose links disagree with their cases (fix only with approval); production env var list (`MULTI_CASE_CLIENTS`). Frontend: polish found during Phases 1-3 (empty/error states, Attorney portal labels if a person has several cases). Full `test:safe`, all four builds, one owner-run walkthrough on a single test person (create case A, then B and C for the same email; log in; switch; confirm separate checklists / documents / forms and pre-filled identity data; delete the test data). Completion report finalised.

## Critical files
Backend: `modules/cases/case.controller.js`, `cases/case.service.js`, `auth/staleCaseLinks.js`, `auth/auth.controller.js`, `integrations/ghl/{ghlCaseFactory,ghlEmployerService,ghlEmployerMatching}.js`, `single-party-filings/single-party-filing.controller.js`, `employment-workflow/employment-workflow.controller.js`, `client-intake/client-intake.service.js`, `payments/payment.controller.js`, `family-workflow/petitioner-prefill.service.js`, `config/fieldScope.js`, `canonical/*`, `email/email.service.js`.
Client: `context/AuthContext.jsx`, `hooks/useMyCaseProfile.js`, `hooks/useDocumentChecklist.js`, `layout/PortalLayout.jsx`, `components/AuthGate.jsx`, Landing `Pages/Auth/Login.jsx`. Admin: `components/CreateCaseModal.jsx`, `pages/CRMCaseDetail.jsx`.

## Verification
Per phase as in the no-error rules; stop after each phase with a report and wait for approval.
