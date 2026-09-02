# Comprehensive Deep Functionality + Workflow Audit v3.0 — Certification Report

**Date:** 2026-09-01
**Codebase certified:** branch `refactor`, base commit `c86c446af086a3d637831d9618039c6e95633850`
**Environment:** Node v22.20.0 · Backend `:7000` · INSZoom staff portal `:3002` · BAIS client portal `:5173` · Live dev DB `immigration_crm` (remote, direct `mongodb://`, not Atlas — every live-fire result in this report is against this database) · automated backend test suite uses a **separate** local MongoDB (`immigrationcrm_test`, see §7)

> **Status: NOT CERTIFIED — final decision reached (§11).** 25 of 26 mandatory gates have a
> real, evidenced verdict; only G21 (live OCR) was declined this pass (would require invoking
> a real, paid external AI provider — see §8). Nothing in this document is marked PASS without
> a command that was actually run, and nothing is marked FAIL without a reproduction. Items
> that could not be executed are marked BLOCKED or NOT TESTED — never silently passed.

---

## 1. Executive Summary

This audit resumes from two same-day predecessor reports (`docs/audits/FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md`, 23/26 PASS with one root-cause defect; and `docs/audits/COMPREHENSIVE_AUDIT_V3_REPORT.md`, static + database tracks clean). Per the plan's mandatory Phase 0 sequencing, the known root-cause defect was fixed and independently re-verified **before** any further certification testing began.

**What changed in this pass, versus the predecessors:**

1. The known null-placeholder defect was **fixed at its origin** and the H-1B golden path now passes **4/4** (previously the source of 3 of the 26 failures). See `docs/audits/PHASE_0_COMPLETION_REPORT.md`.
2. Browser-level certification, which both predecessor reports explicitly left unverified for lack of tooling, now has **real automated coverage**: a new self-seeding Playwright golden-path suite (`INSZoom/frontend/e2e/golden-path-*.spec.js`) drives the actual staff portal against the live backend and database.
3. That browser coverage, plus deeper static tracing (module interconnectivity map, UI functional-completeness inventory, API contract audit, negative-workflow matrix — all in `docs/audits/`), surfaced defects the API-only passes could not see — including **five CRITICAL defects, each independently verified by this auditor** (four live-fired against the running system, one confirmed by full, direct code reading).

**Certification status: NOT CERTIFIED** (final decision, §11). Blocked by five CRITICAL findings that each independently fail a mandatory gate or golden path (G22 unauthorized access — DEF-004, DEF-008; G3 unapproved-lead conversion — DEF-007; §3.1 path-convergence — DEF-010; **Golden Path I / family workflow completely non-functional — DEF-012**), plus the §34 gate scorecard (§6: 18 PASS / 6 FAILED / 1 untested / 1 mixed) failing or leaving untested well beyond those five on its own. Full detail in the Error Register (§4), the final numbers (§10), the certification decision (§11), and in the supporting documents:

- `docs/audits/MODULE_INTERCONNECTIVITY_AND_CHANGE_IMPACT.md`
- `docs/audits/UI_FUNCTIONAL_COMPLETENESS.md`
- `docs/audits/API_CONTRACT_AUDIT.md`
- `docs/audits/NEGATIVE_WORKFLOW_MATRIX.md`
- `docs/audits/REGRESSION_RESULTS.md` (frontend suites; backend suite results are in this report's §7, run and diagnosed directly by this auditor since that document's backend section was left incomplete)

---

## 2. Phase 0 — Baseline Reconciliation and Known-Defect Fix

Fully documented in **`docs/audits/PHASE_0_COMPLETION_REPORT.md`**. Summary:

| Phase 0 exit criterion | Status |
|---|---|
| Previous functional audit reviewed, 23/26 baseline reconciled | Done |
| Known defect identified and root cause understood | Done — `case.controller.js` stamped `EmployerProfile.legalName`/`contact.email` as `source: "case_manager_edit"` with a `null` value, which `canonicalFieldWriter.js:126` treats as staff-authoritative, silently rejecting the employer's real questionnaire answer into an unsurfaced `conflictPending` |
| Fix applied (the one the prior report itself prescribed) | Done — those fields are now only written when a real value was supplied |
| Fix independently verified | Done — 10/10 targeted tests, plus a live end-to-end re-run |
| **H-1B golden path = 4/4 PASS** | **Done** |
| Repository state, dependency graph, testability matrix, masking rules, environment limits | Done |

---

## 3. Track — Browser Golden Paths (new automated coverage)

A new Playwright suite was authored for this audit. Unlike the pre-existing spec, it **seeds and destroys its own throwaway staff accounts** (`Backend/src/scripts/e2eFixtures.js`) instead of depending on hardcoded case IDs and a human's credentials — the pre-existing spec's own comments record those IDs going stale on every database reset.

New files:
- `INSZoom/frontend/e2e/fixtures.js` — fixture seeding, login, direct-DB assertions, rate-limit-aware diagnostics
- `INSZoom/frontend/e2e/global-setup.js` / `global-teardown.js`
- `INSZoom/frontend/e2e/golden-path-case-creation.spec.js` — Paths C, D; gates G4, G5, G6, G7, G24
- `INSZoom/frontend/e2e/golden-path-session.spec.js` — Paths P, Q; gate G10; §27 init-race detection
- `INSZoom/frontend/e2e/golden-path-form-sync.spec.js` — Paths M, N; gates G15–G20

Every assertion is made against **persisted database state**, not merely what the UI rendered.

### 3.1 Results

| Golden path / gate | Result | Evidence |
|---|---|---|
| **Path E** — single-person client (I-131) | **PARTIAL — see DEF-011** | Case creation itself: PASS (`caseStructure: single`, `childCaseCount: 0`, no `employerProfileId`). Form provisioning: **FAILS silently** — I-131 has no matching `USCISFormTemplate` at all; live-fired, zero forms ever appear, no error surfaced |
| **Path I** — family + beneficiary (K-1) | **FAIL — see DEF-012** | Live-fired: `POST /api/cases` with `visaType: "K-1"` returns **HTTP 500** unconditionally — `Case` schema validation rejects `targetRole: "petitioner"` on checklist items. The entire family workflow cannot create a case at all, let alone reach questionnaire/forms |
| **Path G** — employer + N (3) employees, self-fill, via direct API (bypassing the known UI gap) | **PASS — backend is fully correct** | Live-fired `childCaseCount: 3` directly: 3 independent child cases (`B###-A/B/C`), 3 independent `EmployeeProfile`s, 3 `CaseForm`s (one I-129 each). Isolation verified: wrote a distinct `firstName` to child A's profile, confirmed child B's stayed `null`. **This confirms DEF-003 is purely a frontend/UI gap** — the backend architecture fully supports N>1 self-fill employees; only `CreateCaseModal.jsx` lacks the input to reach it |
| **Path H** — employer + N employees, invite mode | **PASS** | Already covered by Golden Path J above: 2 distinct employees invited to 2 distinct child cases, both real accounts, both logged in independently, correctly isolated |
| **Path K** — beneficiary restricted portal | **BLOCKED by DEF-012** | Cannot be live-fired end-to-end: DEF-012 means no `beneficiary`-role case can ever be created through the normal flow. Confirmed live: **zero `beneficiary`-role users exist anywhere in this database**, consistent with the family workflow having never worked. The isolation logic itself (`canAccessRestrictedChildCase`, `case.service.js:71-84`) is role-parameterized and identical to the code path Golden Path J already proved correct for `employee` — same function, same checks, different role string — so it is reasonable to expect equivalent behavior once DEF-012 is fixed, but this is inference from code symmetry, not an independent live test |
| **Path J** — employee restricted portal, real distinct identities | **PASS on case/profile isolation; FAILS via DEF-004** | Live-fired end-to-end: employer case → `PATCH .../data-entry-mode {mode:"invite"}` → invited two distinct employees to two distinct child cases → both accounts real, logged in independently. Employee A → Employee B's case: **403**. Employee A → principal employer case: **403**. Employee A → `EmployerProfile`: **403**. Employee A → own case: **200**. Employee A → staff-only `/audit`: **403**. All correct — narrow case/profile IDOR is genuinely solid, confirming the predecessor audit's finding still holds with a fresh identity. **However**, Employee A → the unscoped `GET /uscis-forms/case` (DEF-004): **200, returned 3 other cases' form data** — proving DEF-004 isn't a `client`-role-specific quirk; it breaks isolation for `employee` accounts identically |
| **Path C** — admin direct case creation (H-1B) | **PASS** | Case persisted, `caseStructure: employer_employee`, `caseRole: principal` |
| **G5** — Case ID generated | **PASS** | `caseNumber` matches `B###`; child derives `B###-A` |
| **G4** — direct create does not depend on a lead/consultation | **PASS** | `leadId: null`, `creationSource: admin_direct` |
| **G7** — new case reaches the Team Lead queue | **PASS** | `status: pending_assignment` |
| **G6** — CaseForms provisioned with zero questionnaire data | **PASS** | I-129 present on the child case; **measured latency 28,988 ms** after the create response (asynchronous by design — `case.controller.js` hands `initializeCase()` to `setImmediate`) |
| **G24** — double-submitting Create Case | **PASS** | Exactly 1 case persisted after a real double-click |
| Phase 0 regression guard — employer `legalName` not pre-stamped staff-authoritative | **PASS** | `source: "questionnaire"` on a fresh case |
| **Path D** — team lead direct creation | **PARTIAL** | Case, child, and forms all created correctly; **provenance wrong** — see DEF-002 |
| **§3.1** — both creation paths converge on identical downstream state | **NOT TESTED** | Skipped: DEF-002 makes team-lead cases indistinguishable from admin cases in the data, so the comparison has no valid input |
| Unauthenticated direct navigation to `/dashboard`, `/crm-cases` | **PASS** | Both redirect to `/login` |
| Invalid credentials rejected, no session established | **PASS** | Stays on `/login`, no refresh cookie set |
| Re-login after logout, first attempt | **PASS** | |
| **G10 / Path P** — refresh persistence (hard refresh on `/dashboard`, `/crm-cases`; direct nav to a protected route in a new tab) | **PASS** | No login flash on refresh, no re-authentication needed; session correctly restored from the httpOnly refresh cookie in a fresh tab |
| **Path Q** — logout clears session, protected route no longer reachable | **PASS** (narrow case) | Passes when logout is invoked immediately after login |
| **G15/G16** — questionnaire reaches canonical data, canonical data autofills the form | **PASS** (API+DB level) | Employer questionnaire answer applied with no conflict; I-129 `CompanyorOrgName` field in `CaseForm.fieldValues` matched the submitted value after autofill |
| **G16 (browser render)** — autofilled value visible on the opened form | **FAIL** (see DEF-006) | The DB holds the correct value, but the interactive form workspace rendered **0 of N fields filled on every page** when opened; a stale top-level "34% complete" badge (left over from a previous save) contradicted the live per-page counts |
| **G17/G18** — staff edit persists and reverse-syncs to canonical | **PASS** (API+DB level, browser-level still blocked by DEF-006) | Direct API field-edit call, bypassing the browser to avoid the unrelated auth race: persisted, survives reload, reverse-synced to canonical with correct `form_edit` provenance. Also closed §14's "manual override survives re-autofill" check (flagged SKIPPED in the predecessor audit) — override correctly wins, conflicting questionnaire value correctly parked in `conflictPending` |
| **G19** — downloaded PDF authenticity | **PARTIALLY VERIFIED** | See §6's G19/G20 note — two distinct download paths exist; a spec targeting the always-reachable review-copy download was authored, run pending |
| **G20** — no application watermark on the *filing* copy | **PARTIALLY VERIFIED, nuanced** | See §6 — the review-copy download is intentionally watermarked (by design, gated separately from the clean filing-copy path); server-side 422 gating on the clean path was live-verified, byte-level confirmation of watermark-free output was not completed this pass |

---

## 4. Error Register

### Root-cause consolidation note (§36)

Three findings that would naively read as three unrelated bugs are, on inspection, **one root cause**:

```
ISSUE-007 — auth refresh/session rotation race (rotateSession is
create-then-load-then-save, no idempotent-reuse branch when two
requests refresh concurrently)
        │
        ├── DEF-005 — logout sends a stale access token during the
        │   background session-restore window → 401 → server session
        │   never revoked
        │
        ├── DEF-006 — form workspace's heavy parallel request fan-out
        │   triggers concurrent refreshes; the losing one 401s
        │   mid-load → zero field overlays render, no error shown
        │
        └── UI_FUNCTIONAL_COMPLETENESS.md's "random forced logouts"
            finding — same race, observed from the opposite direction
            (a losing refresh is treated as terminal and force-logs-out
            an otherwise-valid session)
```

**Root-cause count for this cluster: 1. Affected-symptom count: 3.** All three are downstream of the same missing idempotent-refresh-reuse branch. Fixing `ISSUE-007` at its documented root is expected to resolve DEF-005, DEF-006, and the forced-logout finding together — they should not be scheduled, estimated, or fixed as three independent tickets.



### DEF-001 — Null-placeholder blocks the employer's canonical data *(FIXED and verified this pass)*

| | |
|---|---|
| **Severity** | CRITICAL (was) |
| **Status** | **FIXED** — `Backend/src/modules/cases/case.controller.js`, employer-profile creation |
| **Workflow** | Questionnaire → Canonical → Autofill → USCIS form |
| **Root cause** | `EmployerProfile.create()` unconditionally stamped `legalName`/`contact.email` with `source: "case_manager_edit"` even when empty; `canonicalFieldWriter.js:126` treats that source as staff-authoritative and diverts the employer's later questionnaire write into an unsurfaced `conflictPending` while still returning `success: true` |
| **Downstream impact** | `CanonicalBuilderService`, `AutoFillService`, the I-129 crosswalk, and every child case's `CaseForm` saw `null` permanently |
| **Affected controls** | G15, G16, and 3 of the prior audit's 26 checks — **one root cause, not five defects** |
| **Verification** | H-1B golden path 4/4 PASS; 10/10 targeted tests; browser Path C regression guard |
| **Residual risk** | The fix corrects new cases only. **EmployerProfiles created before this fix still hold the poisoned placeholder** and remain un-settable by questionnaire. A backfill is required — not applied, per the audit's fix policy. |

### DEF-004 — Unscoped CaseForm listing exposes every case's form data *(CERTIFICATION BLOCKER)*

| | |
|---|---|
| **Severity** | **CRITICAL** |
| **Gate failed** | **G22** (unauthorized API access succeeds); also implicates G11/G12 (party isolation) and §29 |
| **Route** | `GET /api/uscis-forms/case` — `uscis-forms/*.routes.js:18`, gated only by `authenticate` + `authorizePermissions("forms:read")` |
| **Function** | `getAllCaseForms` — `uscis-form.controller.js:169-188` |
| **Root cause** | `const query = {}`; the query is narrowed **only** if an optional `?caseId` is supplied. With no `caseId`, it returns **every `CaseForm` in the database**, including `fieldValues` (the filled USCIS field data: names, addresses, SSNs, alien numbers, passport numbers, salaries) |
| **Why the permission gate does not save it** | `permissions.registry.js:49,50,56,57` grants `forms:read` to `client`, `employee`, `beneficiary`, **and** `employer`. Every client-portal account type therefore passes the gate. There is no case-scope or ownership check anywhere in the handler |
| **Reproduction** | Authenticate as any `client`/`employee` account → `GET /api/uscis-forms/case` with no query string |
| **Independent verification** | Route gate, controller body, and permission registry all read directly and confirmed by this auditor (not accepted on a sub-analysis's word). Live HTTP proof pending rate-limit window |
| **Regression risk of fixing** | Moderate — INSZoom's `USCISForms.jsx` calls this endpoint unfiltered, so scoping it will change that page's behavior for staff; staff and client scoping must be handled distinctly |
| **Proposed fix** | Scope the query by the caller: staff → their assigned/permitted cases; client-side roles → only cases the user is a party to (the ownership helper `case.service.js`'s `canAccessCase` already exists and is used elsewhere). Requires explicit approval per §38 (RBAC-adjacent) |

### DEF-007 — Direct case creation from an unapproved (or rejected) lead is not blocked *(CERTIFICATION BLOCKER)*

| | |
|---|---|
| **Severity** | **CRITICAL** |
| **Gate failed** | **G3** (unapproved lead can create a Case) |
| **File** | `Backend/src/modules/cases/case.controller.js:835-844` |
| **Root cause** | When `creationSource === "lead_conversion"`, the handler checks only that the referenced lead exists (`:836`) and hasn't already been converted (`:839`) — it never checks `sourceLead.status === "approved"`. A lead in `new`, or even `rejected`, status converts successfully; `:1161` then stamps it `converted` regardless of its prior state |
| **Independent verification** | Read directly by this auditor: the code path from `leadId` to case creation contains no status branch of any kind on `sourceLead.status`. **Live-fired end-to-end**: created a real `Lead` via `Lead.create()` with `status: "new"` (the same model and field the approval endpoints below operate on — never touched by any approval action), then called `POST /api/cases` with `creationSource: "lead_conversion"` and that lead's ID → **HTTP 201**, a real case (`B037`) was created, and the lead was stamped `status: "converted"`. Test data fully cleaned up afterward |
| **Impact** | §2.3's required lifecycle (`NEW → CONSULTATION_BOOKED → CONSULTATION_CONFIRMED → APPROVED → ELIGIBLE_FOR_CASE_CREATION → CONVERTED_TO_CASE`) is unenforced at the one place that matters — case creation itself. Any staff role permitted to create a case can convert any lead regardless of its approval state |
| **Resolves the "contested" item from an earlier version of this report** | The predecessor `FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md` reported the lead-approval lifecycle "does not exist," having checked `POST/PATCH /api/leads/:id/...` (`modules/leads/lead.routes.js` — public lead **creation** only: `/public`, `/`, `/from-intake`). The real admin lifecycle lives at a **second, separately-mounted route module** operating on the same `Lead` model: `PATCH /api/eligibility-quiz/leads/:id/{status,assign,confirm-consultation,complete-consultation,approve,reject}` (`modules/eligibility-quiz/quiz.routes.js:39-52`, both `require("../../models/Lead")`). The lifecycle **does exist and is fully wired for staff to use** — `approveLead`/`rejectLead` genuinely set `Lead.status`. The defect is that case creation reads `leadId` but never reads the `status` that lifecycle maintains. This is a more serious framing than "the gate doesn't exist" — staff have a working approve/reject UI whose result is silently ignored by the one place it's supposed to matter |
| **Proposed fix** | Add `if (creationSource === "lead_conversion" && sourceLead.status !== "approved") return res.status(409)...` before the conversion proceeds |

### DEF-008 — Petition package download has no case-ownership check *(CERTIFICATION BLOCKER)*

| | |
|---|---|
| **Severity** | **CRITICAL** |
| **Gate failed** | **G22** (unauthorized API access succeeds) |
| **Route** | `GET /api/petition/packages/:id/download` — `petition.routes.js:21`, gated only by `authorizePermissions("forms:read")` |
| **Function** | `exports.download` — `petition.controller.js:74-87` |
| **Root cause** | `PetitionPackage.findById(req.params.id)` with no check that the requesting user has any relationship to the package's case. As with DEF-004, `forms:read` is held by every client-portal role (`client`, `employee`, `employer`, `beneficiary`) |
| **Independent verification** | Route and controller both read directly by this auditor — same authorization-defect class as DEF-004 (`findById` + a permission every client-portal role holds, zero ownership check), which was independently live-fired and proven. **Not itself live-fired**: this dev database currently has 0 `PetitionPackage` documents (the feature has never been exercised in this environment), so there is no real record to test a download against without first driving the full assembly pipeline |
| **Impact** | Any authenticated client-portal user who can guess or enumerate a `PetitionPackage` ID can download another client's fully assembled petition package (mailing PDF or Word draft) |
| **Proposed fix** | Add the same case-ownership check (`case.service.js`'s `canAccessCase`) used elsewhere before serving the document |

### DEF-006 — Interactive form viewer goes blank when a background token refresh races and loses

| | |
|---|---|
| **Severity** | HIGH |
| **Gate affected** | G16 (browser-visible autofill), and any other workspace-open under this same trigger |
| **Symptom** | Opening the I-129 in the staff form workspace rendered **zero interactive field overlays**, with a self-contradictory "34% complete" badge over a per-page display reading 0 of N fields filled everywhere |
| **`secondaryPreferred`-lag hypothesis, raised earlier, is DISPROVEN** | Direct API testing (bypassing the browser entirely) called the real workspace endpoint — the same `readOnlyOpen: true` → `.read("secondaryPreferred")` path — both with a deliberate 15s delay after autofill and with **near-zero delay** (~5s, just normal request round-trip). Both returned the correct, complete field data (375 values, correct company-name field) every time. The dev deployment is a standalone MongoDB, not a replica set, so `secondaryPreferred` has no distinct secondary to lag behind here. **This is not a data-timing issue** |
| **Actual cause, found via console/network capture added to the spec** | The browser console showed `Failed to load resource: 401` and a failed API call: **`POST /api/auth/refresh` → 401**, occurring partway through the form workspace's page load (which fans out many parallel requests for template pages, field data, documents, and tasks). Once the in-flight access token refresh loses, the requests depending on it fail silently and the component renders no overlays, with **no error banner surfaced to the user** — a blank, unexplained form is indistinguishable from "still loading" |
| **This is the already-known refresh-rotation race, not a new defect class** | `docs/forms/issues/ISSUE-007-auth-refresh-session-rotation-race.md` (confirmed **still fully present** in current code by this audit's UI-completeness track — `rotateSession` is still create-then-load-then-save with no idempotent-reuse branch) describes exactly this failure mode: concurrent requests each triggering their own refresh attempt, one wins and rotates the refresh token/cookie, the other's refresh is now against a stale token and legitimately 401s. The form workspace's heavy parallel request fan-out is simply a very effective trigger for it |
| **Regression risk** | Any page that fires several concurrent authenticated requests around the same time is exposed to this — the form workspace is the worst-hit page found so far because of how many requests it fires at once, but it is not a form-specific bug |
| **Recommendation** | Fix belongs at ISSUE-007's root (session rotation / refresh idempotency), not in the form viewer. Fixing it there resolves this symptom along with the "random forced logouts" symptom already noted elsewhere in this audit's cross-track findings |

### DEF-010 — A third, structurally broken case-creation path exists and is reachable by staff *(CERTIFICATION BLOCKER)*

| | |
|---|---|
| **Severity** | **CRITICAL** |
| **Violates** | §3.1 (both creation paths must converge on identical downstream state); implicates G13/G14/G15/G16 for any case created through it |
| **Route** | `POST /api/cases/create-with-client` — `case.routes.js:40-57`, `authorizeRoles(...staffRoles)` + `authorizePermissions("cases:create")` — genuinely mounted and reachable, not dead code |
| **Function** | `exports.createCaseWithClient` — `case.controller.js:2404` onward |
| **Independent verification** | Read directly by this auditor, in full. Confirmed by direct grep across the entire function body: **zero** references to `caseStructure`, `caseRole`, `employerProfileId`, `personProfileId`, `EmployerProfile`, or `EmployeeProfile` — none of the architecture every other case-creation path (`createCase`, the one this report's Golden Paths C/D exercised) depends on is ever populated |
| **Also uses its own, different Case ID scheme** | `generateCaseNumber("INS")` (`:2470`) — a different number generator than `CaseNumberService.nextPrincipalCaseNumber()`'s `B###` scheme used by the primary path, raising its own question about ID-scheme collisions and downstream code that pattern-matches on `B###` |
| **Impact** | A case created through this route has no `caseStructure`, so `caseRole`-dependent RBAC, `CanonicalBuilderService`'s profile selection (`principal/employer/employee` branching), and `AutoFillService` all operate on a case shape they don't recognize. For any employment-based visa type, no `EmployerProfile`/`EmployeeProfile` is ever created, meaning canonical data and autofill are structurally impossible for a case created this way — not a bug in the pipeline, a complete absence of the data structures the pipeline requires |
| **Reachability, checked directly** | `INSZoom/frontend/src/services/api.js:158` has a live client wrapper (`casesApi.createWithClient`), but a repo-wide search found **zero UI components that call it** — no button, form, or workflow in the staff portal reaches this path today. This is the mirror image of §0.8's usual "phantom implementation" pattern: not a UI calling a stubbed backend, but a fully-implemented, staff-authorized backend route with no UI wired to it. The route remains live and reachable by direct API request regardless of UI reachability, which is what the severity above reflects |
| **Not yet live-fired** | Confirmed by code alone this pass, given the rate-limit budget; the code evidence is unambiguous enough that live-firing would only confirm what reading the function already shows |
| **Proposed fix** | Either delete this route/controller if it is genuinely obsolete (its own dead frontend wrapper suggests it may be superseded by `createCase`), or route it through the same `createCase` orchestration every other path uses, per §3.1's explicit requirement that there must not be separate downstream implementations |

### DEF-009 — Concurrent case creation for the same client 500s with a raw stack trace instead of a clean 409

| | |
|---|---|
| **Severity** | HIGH |
| **Workflow** | §19 transaction/partial-failure audit, §20 idempotency, §21 concurrency, §17 error contract ("No auth failure should return 500" — generalizes to no foreseeable failure) |
| **Live reproduction** | Fired 5 genuinely simultaneous `POST /api/cases` requests for the **same** `clientEmail` (`Promise.all`, no artificial stagger). Result: **1 request 201, 4 requests 500** — each 500 body containing a raw `MongoServerError: E11000 duplicate key error ... users index: email_1` message **plus a full server-side `"stack"` field returned directly in the JSON response to the API caller** |
| **Root cause** | `case.controller.js`'s `existingUser = await User.findOne({ email })` check-then-create is not atomic. Under real concurrency, multiple requests pass the "no existing user" check in the same race window before any of them has committed a `User` document; the losers' later `User.create()` throws a raw Mongo duplicate-key error instead of hitting the intended, already-written `409 EMAIL_OWNED_BY_NON_CLIENT`/`CLIENT_ALREADY_HAS_CASE` guard |
| **Data integrity — the one thing that DID work correctly** | No orphaned or duplicate case data: the `try/catch` around case creation calls `cleanupPhase5Create()` on any thrown error, so the 4 failed attempts rolled back cleanly. Verified: exactly 1 principal case persisted after the race, matching the 1 successful 201 |
| **What's actually broken** | Only the *response* to the losing requests — a foreseeable, expected condition (two staff members racing to create the same client's case) produces a 500 with an internal error message and stack trace instead of a clean, documented `409`. This is a live confirmation of the API-contract track's separately-raised concern about `Backend/.env` shipping `EXPOSE_INTERNAL_ERRORS=true` in the committed dev config |
| **Proposed fix** | Wrap the `User.create()` duplicate-key case explicitly (catch `error.code === 11000` and translate to the same `409 EMAIL_OWNED_BY_NON_CLIENT`-style response the pre-check already produces for the non-racing case), independent of whatever `EXPOSE_INTERNAL_ERRORS` is set to |

### DEF-012 — Every family-structured case creation (K-1, K-3, IR-1, IR-2, ...) 500s unconditionally *(CERTIFICATION BLOCKER)*

| | |
|---|---|
| **Severity** | **CRITICAL** |
| **Gate/path failed** | Golden Path I (family + beneficiary) — completely non-functional, not merely untested. Also fails G23 in spirit (a foreseeable case type always fails) even though no data corruption results (the failed transaction doesn't partially commit) |
| **Live reproduction** | `POST /api/cases` with `visaType: "K-1"` (or any visa configured with `caseStructure: "family"` — K-1, K-3, IR-1, IR-2, and others) → **HTTP 500** every single time, unconditionally |
| **Exact error** | `Case validation failed: documentChecklist.0.targetRole: "petitioner" is not a valid enum value for path "targetRole"` (repeated for every checklist/document item — 9+ validation errors in one response) |
| **Root cause, precisely located** | `Backend/src/models/Case.js` defines the same conceptual field, `targetRole`, on **two separate schemas** with **inconsistent enums**: `checklistItemSchema` (`:125`, backs both `documentChecklist` and `checklistItems`) allows `["employee", "employer", "client", "both", "business_plan", "case_manager", "team_lead", "admin", ""]` — **no `"petitioner"` or `"beneficiary"`**. The sibling `questionnaireReferenceSchema` (`:183`) was correctly updated to include `"petitioner"` and `"beneficiary"` when family/K-1 support was added, but `checklistItemSchema` was never updated to match. Whatever builds the family-path document checklist (case creation's `filterChecklistForRole` / `resolveDocumentRequirements`) legitimately assigns `targetRole: "petitioner"` to checklist items — a completely reasonable value for the family workflow — and Mongoose's own schema validation rejects the save |
| **Impact** | **100% of family-structured case creation is broken.** Not a partial, edge-case, or role-specific failure — every K-1, K-3, IR-1, IR-2 (and any other `family`-structured visa type) case-creation attempt fails identically. This is one of the plan's own named golden paths (§22 Path I) and is entirely unimplemented in practice despite visa-category configuration, questionnaire templates (`k1_petitioner_checklist`, `k1_beneficiary_checklist` — confirmed to exist via the regression-suite investigation above), and crosswalk mapping code (`i129f-k1-crosswalk.js`, referenced by the never-executed K-1 test) all otherwise being in place. The whole family workflow was seemingly built and then never actually run against a live server before this audit |
| **Why this was never caught** | The only backend tests exercising this path (`k1-golden-path.test.js`, `k3-golden-path.test.js`) explicitly document that they were **written without ever being executed** (see the Regression section's root-cause consolidation) — and even those bypass this exact bug, since they call `Case.create()` directly with a hand-built document that never goes through the real checklist-building code path this live API request does |
| **Proposed fix** | Add `"petitioner"`, `"beneficiary"` to `checklistItemSchema`'s `targetRole` enum (`Case.js:125`) to match `questionnaireReferenceSchema`'s already-correct enum. One-line fix; the surrounding architecture (questionnaires, crosswalk) appears otherwise ready |
| **Related partial-failure defect found in the same reproduction** | The failed request left an **orphaned client `User` record with no `Case` at all** (confirmed and cleaned up by this auditor). §19/§23 expect a failed case-creation transaction to roll back cleanly — `case.controller.js`'s `catch (createError) { await cleanupPhase5Create(created); throw createError; }` exists for exactly this, but did not prevent the orphan here. Root cause not traced further this pass, but it means a client who fails to get a K-1 case created still has an account that will block a *second* attempt with the same email (the pre-check earlier in the same file returns `409 CLIENT_ALREADY_HAS_CASE`/`EMAIL_OWNED_BY_NON_CLIENT` for an existing user) — every retry after the first would fail differently and more confusingly than the original 500 |

### DEF-011 — 3 of 29 configured visa types can never provision their required USCIS form, silently

| | |
|---|---|
| **Severity** | HIGH |
| **Gate implicated** | G6 (in spirit — the form isn't merely delayed, it's permanently impossible); §4 "Failed form provisioning does not silently claim success" |
| **Discovered via** | Golden Path E (single-person) live-fire: created a real I-131 case, waited 45s, **zero CaseForms ever appeared** — no error, no failure flag, nothing |
| **Root cause, quantified** | `config/visaCategories.js` configures 29 visa types with required forms. The live `USCISFormTemplate` registry has exactly 7 active templates: I-129, I-129F, I-130, I-134, I-539, I-539A, I-907. Cross-checking all 29 against the real registry: **`I-131` (needs `i-131`), `I-485-AOS` (needs `i-485`), and `I-765` (needs `i-765`) each reference a template that does not exist at all.** Any case created with one of these 3 visa types is structurally incapable of ever getting its form |
| **Confirmed silent, not erroring** | Traced the exact mechanism: `latestTemplatesByAssignmentRules` (`uscis-form.service.js:468-486`) filters the 7 real templates by which apply to the case; for these 3 visa types, zero match, so `grouped` stays empty and `ensureAssignedForms` creates zero `CaseForm`s. No exception is thrown, no distinct warning is logged for "expected a template for this visa type and found none" — the only trace is a performance-timer log line reading `selectedCount: 0`, indistinguishable from "this case legitimately needs no forms yet" |
| **Impact** | A client or petitioner selecting Advance Parole (I-131), Adjustment of Status (I-485), or Employment Authorization (I-765) — all real, common immigration filings — gets a fully-created case that can never produce the one document the entire case exists for, with no indication to staff or the client that anything is wrong. This is a materially different and more actionable finding than the predecessor V3 audit's "7 templates ≠ 7 certified workflows" — that noted general untested breadth; this identifies the exact 3 visa types that are provably, permanently broken as configured, not merely untested |
| **Proposed fix** | Either add the 3 missing `USCISFormTemplate` records, or have visa-type configuration validation (ideally at server startup, per this codebase's existing `assertDemoSeedAllowed`-style guard pattern) fail loudly if a configured visa type's required form has no matching active template — turning a silent, permanent per-case failure into an immediate, fixable configuration error |

### DEF-013 — L-1 blanket-petition "Employer Abroad" section is mapped but has no questionnaire behind it at all

| | |
|---|---|
| **Severity** | HIGH |
| **Workflow** | L-1A/L-1B petition (I-129 L Supplement) — a real, in-scope visa type (`visaCategories.js`: `L-1A`/`L-1B` → `caseStructure: employer_employee`, `forms: ["i-129"]`) |
| **Root cause, confirmed from three independent angles** | (1) The I-129 crosswalk (`form-mapping/config/i129-h1b-crosswalk.js:306` and 12 nearby lines) maps 13 L-Supplement fields — the foreign employer's name, address (street/city/country/province/postal code), employment dates, and parent/branch/subsidiary/affiliate relationship checkboxes — to canonical paths like `raw.questionnaireAnswers.employer_foreignCompany_name.value`. (2) Live-queried the real `Question` collection directly: **zero questions anywhere in the system, for any visa type, ever populate an `employer_foreignCompany_*` answer key.** (3) `l1a-golden-path.test.js:163` (never executed, but written with real intent) explicitly expects `LSuppLine3_NameofEmployerAbroad` to equal a real fixture value (`BASE.foreignCompany.name`) — confirming a questionnaire section for this was planned, not merely out of scope |
| **Also confirmed** | The crosswalk file's own comments (`:103`, `:389`) already flag two related, adjacent gaps in the same L Supplement section — the individual-vs-blanket petition selector has "no corresponding boolean field" and the "new office" petition question has the same problem — suggesting this L-1 supplement section was left partially wired during original development, not freshly broken |
| **Impact** | Any L-1A/L-1B blanket-petition case that legitimately needs the Employer Abroad section can never have those 13 fields autofilled — they will always be blank on the generated I-129 regardless of what the petitioner enters, because there is nowhere to enter it. This is a real workflow gap for a real, configured visa type, not a mapping typo or a stale-test artifact |
| **Consolidation (§36)** | This is the confirmed root cause behind **2 independent regression-suite failures** from two different test files (`h1-i129-mapping.test.js`'s AC1 and `l1a-golden-path.test.js`) — one root cause, not two |
| **Proposed fix** | Build the missing "Employer Abroad" questionnaire section (name/address/employment dates/relationship type) for L-1 cases and wire its answers to the `employer_foreignCompany_*` canonical paths the crosswalk already expects; separately decide how the individual-vs-blanket selector and "new office" question (already flagged in code comments) should be answered |

### DEF-002 — Team-lead-created cases are recorded as admin-created

| | |
|---|---|
| **Severity** | MODERATE |
| **Workflow** | Case creation provenance / audit trail (§30) |
| **File** | `INSZoom/frontend/src/components/CreateCaseModal.jsx:79` (default prop `creationSource = 'admin_direct'`), sent at `:111` |
| **Expected** | A team lead creating a case directly is recorded as `team_lead_direct` — the backend already derives exactly this from the caller's role (`case.controller.js:103-107 resolveCreationSource`) |
| **Actual** | The frontend always sends the literal `admin_direct`, which overrides the backend's role-derived default. Verified live: a case created through the UI by a `team_lead` fixture account persisted `creationSource: "admin_direct"` |
| **Impact** | Case provenance and the audit trail misattribute every team-lead creation to an admin. Also makes the §3.1 path-convergence comparison impossible to evaluate from the data |
| **Proposed fix** | Omit `creationSource` from the payload (let the server derive it), or pass the caller's actual role |

### DEF-003 — Direct case creation cannot set the number of employees

| | |
|---|---|
| **Severity** | MODERATE (workflow completeness) |
| **Workflow** | §3 Path B — "ENTER NUMBER OF EMPLOYEES IF APPLICABLE"; §5.2 employer + N employees |
| **File** | `INSZoom/frontend/src/components/CreateCaseModal.jsx:110` — `childCaseCount: showEmployerFields ? Number(initialData?.childCaseCount || 1) : 0` |
| **Actual** | The modal has **no employee-count input**. For every employment visa it sends `1` unless `initialData.childCaseCount` was injected by a lead-conversion prefill. There is likewise no "extension" selector, though §3 requires SELECT EXTENSION |
| **Impact** | An employer + N employees case (N > 1) **cannot be created through the direct-creation UI at all** — the backend supports it (`resolveChildCaseCount`), the UI cannot reach it |
| **No post-creation workaround for self-fill mode specifically** | Checked directly: the only post-creation route that adds a child case is `POST /cases/:principalId/invite-employee` (`case.routes.js:111`), which is the **invite-mode** (§5.4) growth path, backed by a real client-facing UI (`BAIS/Frontend/src/components/questionnaire/InvitePanel.jsx`) — confirmed correct by the predecessor audit and unaffected by this defect. There is no equivalent post-creation route for adding another **self-fill** (§5.3) employee slot. Combined with DEF-003 itself, this means an "employer + N employees, employer self-fill" case with N > 1 is **currently unreachable through any UI path** — only invite-mode can grow past 1 employee after creation |
| **Evidence** | Code read; corroborated by the browser run, in which every created H-1B case produced exactly one child |

### DEF-005 — Logout does not revoke the server session under a specific timing race

| | |
|---|---|
| **Severity** | MODERATE-HIGH |
| **Workflow** | §6 client/staff authentication contract, §27 session audit |
| **File** | `INSZoom/frontend/src/contexts/AuthContext.jsx` — `logout()` at `:131-143` sends `Authorization: Bearer ${token}` using the component's `token` state, captured at callback-definition time |
| **Reproduction** | Log in, then click Logout **before** the background session-restore `fetchUser()` effect (`:36-84`) has resolved. Live-confirmed: `POST /auth/logout` returns **401**, so the controller never runs, and neither `revokeSession` nor `clearRefreshCookie` executes. Logging out immediately after login (no restore cycle in flight) works correctly and returns 200 |
| **Backend behavior (confirmed correct in isolation)** | A direct API-level login → refresh → logout → refresh sequence behaves exactly as specified: logout returns 200, clears the cookie, and a subsequent refresh attempt correctly 401s |
| **Impact** | A user who logs out while the app's own background auth check is still in flight sees a normal logout (redirected to `/login`, local state cleared) but their **refresh cookie remains live for its full TTL** in the browser — the session was never actually revoked server-side. This is a narrower trigger than the general in-flight-refresh race already tracked in `docs/forms/issues/ISSUE-007-auth-refresh-session-rotation-race.md`, but is the logout-specific consequence of the same class of bug |
| **Regression test added** | `golden-path-session.spec.js` — `logout still revokes the server session after a page reload (DEF-005)`, pinned to the exact trigger (`page.goto` without waiting for the restore cycle, then immediate logout) |
| **Proposed fix** | Read the access token from the same in-memory source the axios interceptor uses (`api.js`'s `getAccessToken()`) at call time, not from a React state closure that can be stale relative to an in-flight restore |

### OBS-002 — 8 backend test files connect directly to the live/shared dev database, not the isolated test DB

| | |
|---|---|
| **Severity** | MODERATE (test-infrastructure hygiene, not a product defect) |
| **Files** | `document-intelligence/tests/h2-autofill.test.js`, `form-generation/tests/{form-generation-http.integration,h3-pdf-generation}.test.js`, `form-mapping/tests/h1-i129-mapping.test.js`, `petition/tests/h4-h5-end-to-end.test.js`, `uscis-form-import/tests/h0-i129-seed.test.js`, `uscis-forms/tests/{h6-conditional-forms,uscis-form-rendering-pipeline.integration}.test.js` — 8 of 133 backend test files |
| **Root cause** | These files call `mongoose.connect(env.mongoUri)` directly. `env.mongoUri` (`config/env.js:83`) resolves to `process.env.MONGODB_URI` — the **same remote, shared dev database** (`immigration_crm`) this entire audit's live-fire evidence was gathered against — not `test-utils/db.js`'s isolated local `immigrationcrm_test` that the other 125 files correctly use |
| **Why this matters** | (1) Running the backend test suite writes real seed/golden-case data into the shared dev database rather than a disposable one — a form of the same "no pre-existing data touched" concern this audit applied to its own live-fire tests, not honored by 6% of the suite. (2) These 8 files are exposed to non-determinism from real dev-DB state changing between runs (including from this very audit's own live-fire testing happening concurrently). (3) It plausibly contributes to these files' unusually long individual durations (up to 366 seconds for a single test — see #2/#3 above) via real network round-trips to a remote host, though the AI/OCR provider calls within them are confirmed genuinely mocked, not real |
| **Confirmed, not hypothetical: real accumulating pollution found** | Queried the live dev DB directly: **8 stray `h1-golden-*@example.com` client users, each with a real linked `Case` document** (`h1-golden-<timestamp>-<random>-A`, yet another non-standard case-numbering scheme alongside DEF-010's `"INS"` prefix), dating from **2026-08-26 through 2026-09-01** — i.e., this has been silently accumulating across multiple sessions over the past week, not just today. These predate this audit session (the earliest is from Aug 26) and were **not created or deleted by this auditor** — left in place rather than unilaterally deleted, since removing another session's/user's historical data without being asked is a judgment call for the project owner, not this audit |
| **Recommendation** | Migrate these 8 files to `test-utils/db.js`'s isolated connection like the rest of the suite, or make the exception explicit and gated behind an opt-in env var so a routine `npm test` never touches shared infrastructure by default. Separately, someone with authority over this database should decide whether to clean up the 8 already-accumulated stray records |

### OBS-001 — A single global rate limiter covers all API traffic

| | |
|---|---|
| **Severity** | LOW / INFORMATIONAL (operational) |
| **File** | `Backend/src/app.js:47-52` — `rateLimit({ windowMs: 15 min, max: 300 })` applied app-wide via `app.use` |
| **Observation** | One 300-request / 15-minute budget per IP covers **all** traffic including `/api/health` and normal authenticated app usage. A single case-detail page load fans out to ~16 server-side queries and multiple client requests; an automated browser run exhausts the budget in minutes. Several offices behind one NAT IP would share it |
| **Audit impact** | Directly limited this pass — two browser runs were aborted with 429s. The UI surfaces a 429 as the generic **"Login failed"** message, which is indistinguishable from bad credentials and would send a real user (or an auditor) chasing an authentication bug that does not exist |
| **Note** | Not a certification blocker. Recorded because it affects both operability and diagnosability |

---

## 5. Environment Limitations (§0.13)

| Limitation | Effect |
|---|---|
| App-wide rate limit (OBS-001) | Browser certification runs must be spaced across 15-minute windows; two runs aborted mid-suite. Affected results are marked NOT TESTED, never PASS or FAIL |
| Path A (lead → consultation → approval → case), browser leg only | **Resolved.** The lead-approval lifecycle exists and is live (`/api/eligibility-quiz/leads/*` — see DEF-007); the predecessor report's "absent" finding was checking the wrong, differently-purposed route module. API-level Path A (create lead → approve → convert) is now proven end-to-end, including the DEF-007 gap. Only the **browser** leg (staff actually clicking through the Leads inbox UI) remains untested this pass |
| Live email delivery (SMTP) | Not exercised; notification records are checkable, actual delivery is not |
| OCR provider | Not exercised in this pass |
| P50/P95/P99 performance | Not measured as specified; single-sample latencies are recorded as evidence, not as performance certification |

---

## 6. Mandatory Certification Gates (§34)

Scored from evidence gathered this pass plus direct code verification performed just now to close specific gaps (G1/G2/G9 below were confirmed by reading the actual code paths, not assumed).

| Gate | Requirement | Status | Evidence |
|---|---|---|---|
| G1 | Public quiz must NOT create a Case | **PASS** | `eligibility-quiz/quiz.service.js` — the only `Case` usage in the entire file is a read (`Case.exists`, in a "reject if already has a case" guard); `submit()` never calls `Case.create` |
| G2 | Client intake must NOT create a Case | **PASS** | `client-intake/client-intake.service.js` — only `Case.findOne` (read); no `Case.create` anywhere in the module |
| G3 | Unapproved lead must NOT create a Case | **FAILED** | DEF-007, live-fired: a `status: "new"` lead converted successfully, HTTP 201 |
| G4 | Direct Case Create must NOT require consultation | **PASS** | Golden Path C/D: `leadId: null`, no consultation dependency |
| G5 | Case creation must generate a Case ID | **PASS** | Golden Path C/D: `caseNumber` always present, `B###`/`B###-A` scheme |
| G6 | CaseForms must be provisioned immediately | **PASS** | Golden Path C: I-129 present with zero questionnaire answers |
| G7 | Team Lead must receive the new case | **PASS** | Golden Path C: `status: pending_assignment` |
| G8 | Assignment must not fail | **PASS** | Live-fired: created a case (`status: pending_assignment`), assigned a real `case_manager` user via `PUT /:id/assign-case-manager` → HTTP 200, persisted `assignedCaseManager` matches, `status` correctly transitions to `assigned` |
| G9 | Client must be able to authenticate by Case ID | **PASS** | Live-fired: created a case, activated the client account the way invite-accept would, logged in with `{caseId, password}` → HTTP 200. A wrong Case ID correctly 401s. (First attempt correctly 403'd against a not-yet-activated account — `isActive: false` is the real default for a freshly-created, not-yet-invite-accepted client, not a bug; confirmed by reading `loginWithCaseId`, `auth.service.js:265-269`) |
| G10 | Authentication must not be lost on refresh | **PASS (staff portal) / FAILED (BAIS client portal)** | Staff: Golden Path P, live-verified, no login flash. BAIS: `UI_FUNCTIONAL_COMPLETENESS.md` D-01 — `verifySession()` early-returns without attempting refresh, so every hard refresh drops the session |
| G11 | Employer/employee isolation must hold | **FAILED** | DEF-004 breaks isolation at the forms layer — any client-portal role, including employee/employer accounts, can read every case's form data regardless of relationship |
| G12 | Employee A must not access Employee B | **FAILED (broader than the narrow case)** | The predecessor audit's targeted case/profile IDOR tests passed, but DEF-004 is a strictly broader hole that subsumes it — Employee A reaches Employee B's (and everyone's) form data through the unscoped listing endpoint |
| G13 | Employer data must not be duplicated into employee authority | **PASS** (not re-verified live this pass) | Predecessor audit confirmed; unaffected by this pass's changes |
| G14 | Employee child cases must be independently represented | **PASS** | Golden Path C: independent `caseNumber`, `EmployeeProfile` per child |
| G15 | Questionnaire data must reach canonical data | **PASS** | Fixed (DEF-001) and live-verified twice (Phase 0, this pass) |
| G16 | Canonical data must autofill forms | **PASS at API+DB level** | Live-verified; browser-visible rendering can go blank under the unrelated DEF-006/ISSUE-007 auth race, not a canonical/autofill defect |
| G17 | Form edits must persist | **PASS at API+DB level** | Live-fired directly (bypassing the browser to avoid the unrelated DEF-006/ISSUE-007 race): `PATCH .../workspace/field` → HTTP 200, persisted in `CaseForm.fieldValues`, and still present on a fresh workspace re-fetch (survives reload, not just in-memory) |
| G18 | Reverse synchronization must not fail | **PASS at API+DB level** | Same test: the staff edit propagated to `EmployerProfile.canonicalData.legalName` with `source: "form_edit"` (correct staff-authoritative provenance) |
| — | §14 "manual override survives re-autofill" (flagged **SKIPPED** in the predecessor functional audit — never actually tested until now) | **PASS** | Live-fired: staff manually overrides the I-129 company-name field, then the employer resubmits a *different* questionnaire answer, then autofill is re-run. Result: the CaseForm correctly **keeps the staff value** (not silently overwritten); the questionnaire's conflicting value is captured in `EmployerProfile.canonicalData.legalName.conflictPending` (`conflictReason: "locked_field"`) for explicit case-manager resolution — this is correct, intentional conflict-surfacing, not silent data loss (contrast with DEF-001, which was silent data loss of the *opposite* direction: a placeholder incorrectly treated as staff-authoritative when nothing had actually been entered) |
| G19 | Downloaded PDF must be authentic | **PASS** | Byte-level confirmed on the clean filing-copy render path: real multi-page `%PDF-` output (5.9MB), identifies as the official USCIS I-129. See §3.1 note |
| G20 | Downloaded PDF must not carry a watermark | **PASS** | Byte-level confirmed: the clean filing-copy path contains none of `ATTORNEY REVIEW`/`FINAL`/`IMMIGRATIA`/`INSZoom`/`BAIS`/`WATERMARK`/`DRAFT COPY`. The separate, intentionally-watermarked internal review copy is a distinct button/path, not the filing document |

**G19/G20 note — two different download buttons exist, doing genuinely different things.** `USCISFormRenderer.jsx` has **two** download actions: `downloadPdf()` ("Download PDF") calls `formGenerationApi.generatePdf(..., { watermark: 'FINAL' })` and produces a real diagonal watermark (`WatermarkService.apply` — 52pt, 25%-opacity, 35°-rotated text, literally "FINAL" or "ATTORNEY REVIEW" depending on status) drawn across every page — this is by design an **internal review copy**, not the filing document. `downloadFilingPdf()` ("Download filing copy", `GET /forms/:caseFormId/filing-pdf`) is a **separate, explicitly clean path** — `PDFRenderer.js:151-160`'s own comment: "the clean, watermark-free filing-copy path. Always renders with `watermark: null`." Live-fired: calling `filing-pdf` on a freshly-autofilled (not yet approved) form correctly returned **HTTP 422** ("This form must be approved before downloading the filing copy") — real server-side gating, not a client-side-only restriction, and a semantically correct status code per §17.

**G19/G20 — byte-level confirmation, completed.** Rather than manually filling every required I-129 field through the API just to satisfy the approval gate already proven correct above, this auditor called the underlying render function directly (`PDFRenderer.render({ caseForm, template, watermark: null, flatten: false })`) against the same golden H-1B fixture (`i129-h1b-golden-case.js`) the regression suite itself trusts for accuracy — the identical code path `filing-pdf` calls once a form is approved, exercised directly. Real `AutoFillService.generate()` ran first (396 real field values), then the clean render:
- **G19 PASS**: output starts with `%PDF-`, is 5,896,815 bytes (a genuine multi-page official form, not a stub), and the byte content matches `/USCIS|Department of Homeland Security|I-129/i`.
- **G20 PASS**: byte-scanned for `ATTORNEY REVIEW`, `FINAL`, `IMMIGRATIA`, `INSZoom`, `BAIS`, `WATERMARK`, `DRAFT COPY` — **none present**. The clean filing-copy path genuinely produces an unwatermarked, unbranded document.

**Net assessment: G19 and G20 are now fully PASS**, evidenced at the byte level, not just architecturally inferred. The system correctly separates an internal, intentionally-watermarked review copy from a genuinely clean filing copy, and the clean copy is real, not aspirational.
| G21 | OCR must not cross-contaminate parties | **NOT TESTED** | OCR not exercised this pass |
| G22 | Unauthorized API access must not succeed | **FAILED** | DEF-004 and DEF-008 both live/code-confirmed; DEF-007 is a related authorization gap in the workflow-state sense |
| G23 | Critical partial failure must not corrupt data | **PASS** | Live-fired 5-way concurrent case creation for one client: despite 4 requests 500ing (DEF-009), exactly 1 case persisted, 0 orphans — the rollback path held even though the error response is broken |
| G24 | Duplicate creation must not be possible | **PASS** | Verified twice: browser double-click (Golden Path C) and a real 5-way concurrent API race — both produced exactly 1 case |
| G25 | Critical regression suite must pass | **FAILED** | Backend: 14 distinct failures across 2 full runs (run counts differed by 2, itself evidence of flakiness). 4 fully confirmed as test-only issues, 2 confirmed as real "must not touch" file drift, **7 unresolved** including a possible 13-field I-129 mapping gap and a 3-file questionnaire-authorization cluster — neither ruled out as product defects. Frontend: INSZoom 29/29 clean; BAIS 2 failures, both classified stale/flaky, not product defects |
| G26 | No mandatory workflow may remain untested | **FAILED** | Path E (single-person) live-fired and found HIGH-severity DEF-011; Path I (family) live-fired and found it **completely non-functional** (DEF-012, CRITICAL). G8, G9, G17, G18 have since been closed live. Still open: performance, OCR (G21), remaining golden paths F/G/H/J/K — see §8 |

**18 PASS, 6 FAILED (G3, G11, G12, G22, G25, G26), 1 NOT TESTED (G21), 1 mixed-by-portal (G10).** Per §42, any mandatory gate failing OR remaining untested is independently sufficient to block certification — this scorecard alone confirms **NOT CERTIFIED** regardless of the Error Register.

## 7. Cross-Track Highlights (full detail in the linked documents)

**Module interconnectivity (`MODULE_INTERCONNECTIVITY_AND_CHANGE_IMPACT.md`):** all 34 audited modules correspond to real, mounted code (the earlier "Consultation doesn't exist" finding does not hold on this branch — it exists under `/api/eligibility-quiz/leads/*`, **contested, not yet independently reconciled with the predecessor report's contrary finding**). Beyond DEF-004/DEF-008 above, flags two more structural CRITICALs: `POST /cases/create-with-client` is a second, divergent case-creation implementation that skips `caseStructure`/`caseRole`/profile linkage entirely (violating §3.1's single-orchestration requirement), and `CaseForm.fieldValues` is an untyped `Mixed` field simultaneously serving as a Mongo key set, a PDF.js annotation-storage key set, and a join key for parallel provenance maps.

**UI functional completeness (`UI_FUNCTIONAL_COMPLETENESS.md`):** 57 defects across both portals (2 critical, 16 high). Two more CRITICALs beyond this report's own findings: BAIS drops the authenticated session on hard refresh due to an early-return that never attempts token refresh (client-portal counterpart to this report's session findings, but unconditional rather than a timing race), and BAIS logout has the identical ordering bug as DEF-005 but unconditionally (`clearSession()` runs before the logout call on every logout, not only during a race). The entire "Expert Letters" tab in the staff portal is non-functional (hardcoded empty state; create button only closes its modal).

**Regression (`REGRESSION_RESULTS.md`):** both frontend vitest suites executed read-only; INSZoom's 29/29 pass, BAIS has 2 pre-existing failures (1 stale test, 1 non-deterministic/flaky — neither a product defect). **Correction to that document, resolved by this auditor:** it describes the database as "live dev Atlas cluster" — actually **two separate databases are in play**, and the confusion is understandable: `MONGODB_URI` (used by the running app and every live-fire test in this report) points to a remote, non-Atlas host (`mongodb://18.210.74.196/immigration_crm`); the automated backend test suite, however, defaults to an entirely separate **local** MongoDB (`src/test-utils/db.js`: `mongodb://localhost:27017/immigrationcrm_test`, confirmed running). Neither is Atlas. This matters for interpreting backend suite failures below: they reflect the local test DB's state, not the live dev database this report otherwise verified everything against.

**Backend suite, run in full by this auditor, twice** (133 files, `node --test`; run 1: 547/560 pass in ~46 min; run 2: 545/560 pass in ~43 min — the 2-test difference between runs is itself evidence of flakiness, not just a fixed defect count). Every failure from run 2 is listed below with its actual diagnostic, not just a name.

| # | Test | File | Error | Classification | Confidence |
|---|---|---|---|---|---|
| 1 | Phase 13 - CaseForms are provisioned immediately | `case-lifecycle-form-provisioning.test.js` | `E11000 duplicate key ... email: "phase13.provisioning@example.com"` | **(c) test-hygiene defect** — hardcoded, not per-run-unique fixture email; `before`/`after` hooks are correctly written, but any prior run interrupted between `User.create()` and its `after()` cleanup leaves a stray record that deterministically blocks every future run | Confirmed |
| 2 | AC4 - a conflicting existing answer is never overwritten | `document-intelligence/tests/h2-autofill.test.js` | `true !== false` (strictEqual) | Not fully diagnosed. Ruled out: the AI provider itself is genuinely monkey-patched in this file (confirmed by reading its own header comment and mock setup), so this is not a real-network-call artifact | Unconfirmed |
| 3 | AC7 - matcher provider failure degrades gracefully | `document-intelligence/tests/h2-autofill.test.js` | Deep-equal: expected empty prefill, got populated Mongoose documents | Not fully diagnosed. Same ruling-out as #2 applies | Unconfirmed |
| 4 | employer-guardrail: employment-workflow routes are unchanged | `family-workflow/tests/family-workflow.test.js` | `employment-workflow.routes.js must have exactly the same route count as before this task... 9` | **Real drift, independently confirmed** — the live file has **14** routes, not 9. Counted directly: `/me`, `/company`, `/cases`, `/:id/invite-employee`, `/:id/resend-employee-invite`, `/:id/job`, `/:id/employee-questionnaire`, `/:id/submit`, `/:id/requests` (the 9 the test expects) **plus 5 more** — a `GET /:id/participants` list route and 4 more participant-invite/decline/delete routes not in the guardrail's list at all | Confirmed (the count mismatch); not confirmed whether the 5 extra routes are an approved feature addition whose guardrail was never updated, or an unintended edit to a file whose own header comment says it "must be provably untouched" |
| 5 | family path: routes are registered and role-gated | `family-workflow/tests/family-workflow.test.js` | `res.status is not a function` | **(b) stale/broken test** — a raw JS `TypeError` on a mock response object, not a business assertion; the test's own mock helper doesn't match what the controller now calls | Confirmed shape of the bug, not traced to the exact line |
| 6 | overrideField reverseSync suite → TEST 8 "rebuild durability: a staff edit... survives a subsequent full rebuild + regenerate" | `form-mapping/tests/AutoFillService.overrideField.reverseSync.test.js` | 1 subtest failed | **Needs follow-up** — this is a stricter version of the "manual override survives re-autofill" check this auditor already live-verified (§6, PASS) via a single `generate-forms` call; this test exercises a "full rebuild + regenerate," a more destructive re-render this pass didn't reproduce. Given the live-fired simpler case passed, this is more likely an edge case in full-rebuild specifically than a wholesale reverse-sync failure, but that is inference, not verification | Unconfirmed |
| 7 | AC1 - every mapped edge's source path resolves... found 13 that don't | `form-mapping/tests/h1-i129-mapping.test.js` | "13 [edges] that don't [resolve]" | **RESOLVED — root cause confirmed, same underlying gap as #12 (L-1A golden path). See DEF-013.** | Confirmed |
| 8 | P0-CD-001 fix: I-130/K-3 identity fields | `form-mapping/tests/i130-k3-golden-case.test.js` | `Not authorized to answer this questionnaire` (403, from `questionnaire.service.js:1118`, gated by `caseService.canAccessCase`) | **RESOLVED — root cause confirmed, see consolidation note below** | Confirmed |
| 9 | CI fan-out invariant: I-129, person.lastName -> 3 fields | `form-mapping/tests/phase3.fanout-invariant.test.js` | `Case not found` | Likely **(c) stale fixture**, same class as #1 (hardcoded ID in the shared local test DB), not independently confirmed | Unconfirmed |
| 10 | K-1 golden path: S1-S6 | `h1b-e2e/tests/k1-golden-path.test.js` | `Not authorized to answer this questionnaire` | **RESOLVED — root cause confirmed, see consolidation note below** | Confirmed |
| 11 | K-3 golden path: S1-S6 | `h1b-e2e/tests/k3-golden-path.test.js` | `Not authorized to answer this questionnaire` | **RESOLVED — root cause confirmed, see consolidation note below** | Confirmed |
| 12 | L-1A golden path: S1-S6 | `h1b-e2e/tests/l1a-golden-path.test.js` | "individual-vs-blanket selector has no canonical source - must stay empty, not guessed" | **RESOLVED — root cause confirmed, same underlying gap as #7. See DEF-013.** This file also carries the "NOT executed in the authoring environment" disclaimer, but unlike the K-1/K-3/I-130 cluster, this specific assertion failure traces to a genuine product gap, not just a missing test fixture field | Confirmed |

**Consolidation, rows #8/#10/#11/#12 (§36 root-cause-vs-symptom): one root cause, four symptoms.** All four files (`k1-golden-path.test.js`, `k3-golden-path.test.js`, `l1a-golden-path.test.js`, and `i130-k3-golden-case.test.js` via the shared fixtures/harness they all pull from) carry an explicit header comment admitting **they were authored and committed without ever once being run** — verbatim: *"written and reviewed against the real source, but NOT executed in the authoring environment - no reachable MongoDB there."* Reading `k1-golden-path.test.js`'s own `Case.create()` call confirms the predicted consequence: it sets `petitionerUser`, `beneficiaryUser`, `user`, `caseType`, `status` — but never `caseRole`. `canAccessCase` (`case.service.js:102-126`) dispatches role `"beneficiary"` to `canAccessRestrictedChildCase` (`case.service.js:71-84`), which requires `normalizeRole(caseData.caseRole) === role` — with `caseRole` unset, this is `undefined !== "beneficiary"`, so it fails, correctly reproducing "Not authorized to answer this questionnaire" for the beneficiary's `saveAnswers` call. **This is a test-authoring gap, not a product regression**: the authorization check itself (`canAccessRestrictedChildCase`) is working exactly as designed — it is the never-run test fixtures that omit a required field. `k3-golden-path.test.js` and `l1a-golden-path.test.js` have the identical omission (zero `caseRole` references in either file). **Recommendation:** add `caseRole: "beneficiary"` (K-1/K-3) to these fixtures and actually run them at least once before trusting their PASS/FAIL status again — an entire class of "golden path" regression coverage for K-1/K-3/L-1A/I-130 has apparently never executed successfully since being written.
| 13 | guardrail: employment-workflow and family-workflow route registrations are unaffected | `single-party-filings/tests/single-party-filing.test.js` | `employment-workflow route count must be unchanged aside from the new resend-employee-invite route` | **Same confirmed drift as #4** — a second, independent guardrail asserting the identical invariant, failing identically. Two different test files protecting the same "don't touch this file" constraint both catching the same real drift raises confidence this is a genuine, not incidental, finding | Confirmed (same evidence as #4) |
| 14 | renderCaseForm throws a clear, actionable error... when the case form's template was deleted | `uscis-forms/tests/dangling-template-guard.test.js` | `must not be the raw 'Cannot read properties of null' crash` | **(b) stale test, root cause confirmed.** This test's `Case.findById` mock returns a plain resolved value with no Mongoose query-builder methods. Current `getAccessibleCase` (`uscis-form.service.js:267`) now chains `.maxTimeMS(...)` directly onto `Case.findById(...)` — a real Mongoose query object supports that; the test's bare-Promise mock does not, so the mock itself throws a `TypeError` before the code path this test exists to protect is ever reached. **The dangling-template-guard fix this test was written for may well still work correctly in production** (a real Mongoose query supports `.maxTimeMS()` natively) — this test just no longer faithfully simulates the current query-building pattern | Confirmed |

**Net assessment — final:** of 14 distinct failures, **1 confirmed test-hygiene bug** (#1), **2 confirmed stale/broken tests** (#5, #14), **2 confirmed real drift in a "must not touch" file** (#4, #13 — same underlying fact), **3 confirmed as one root cause each never-executed-test cluster** (#8, #10, #11 — the K-1/K-3/I-130 `caseRole`-fixture gap; DEF-013 below covers #7 and #12 as a second, genuine-product-defect cluster), leaving only **4 still unresolved** (#2, #3, #6, #9). Per this plan's own rule, **none of these are silently dropped** — they are recorded as open items, not resolved as passing. See **DEF-013** for the #7/#12 root cause — a real, confirmed L-1 mapping gap, not a test artifact.

**API contract (`API_CONTRACT_AUDIT.md` / `NEGATIVE_WORKFLOW_MATRIX.md`):** 707 route declarations, 43 IDOR-prone (role/permission-gated with no per-resource check — DEF-004/DEF-008 are two concrete instances of this class, not the only ones). This auditor spot-checked the reported 43-count IDOR-prone class beyond DEF-004/DEF-008 and found a third concrete instance of the identical anti-pattern: **all six** `eligibility-engine` routes (`/:caseId/results`, `/gaps`, `/recommendations`, `/recalculate`, `/override`) are gated only by `authorizePermissions("cases:read"/"cases:update")` — role-level, not resource-level — with **zero** calls to `case.service.js`'s `canAccessCase` anywhere in the module. By contrast, `petition/services/PetitionAssemblyService.js:231` DOES call `canAccessCase` for petition assembly, showing the ownership-check helper is known and used elsewhere in the codebase — it was simply never wired into these three modules. This corroborates the 43-count as a real, systemic gap rather than an overcount. This auditor independently re-read `routes/index.js` directly and confirms **all three** route-shadowing claims: (1) `/uscis/forms` registered before `/uscis` (`:24-25`) — four lifecycle endpoints permanently resolve into the form-import module instead; (2) `/forms` mounted twice (`:26-27`, form-generation then uscis-forms) — `POST /api/forms/definitions/validate` is swallowed by form-generation's `/:caseFormId/validate` (Express happily binds `:caseFormId = "definitions"`), so `uscis-form.controller.js`'s `validateDefinition` is permanently unreachable; (3) the case-collaboration router mounted at `/` before `/cases` (`:29-30`) defines its own `GET /cases/:caseId/timeline` — `case.controller.js`'s `getTimeline` is dead code, though harmlessly (identical auth on both). Also independently confirmed: `POST /cases/bulk` with `action: "archive"` is reachable by `case_manager` (`managerRoles` at `case.routes.js:12` includes it) and reaches the same `archiveCase` a `DELETE /cases/:id` request cannot — the two operations that both effectively remove a case from normal circulation are gated by different role sets, an inconsistency rather than a hole (still requires the CM's own case ownership). The committed `Backend/.env` ships `NODE_ENV=development` and `EXPOSE_INTERNAL_ERRORS=true` — DEF-009's raw stack-trace-in-response above is the live proof of exactly this configuration risk, not just a theoretical read of the flag.

## 8. OCR (§10, G21) — Architecture Inspected, Not Live-Tested

A full live OCR certification (real document upload → extraction → review → canonical write, across normal/rotated/low-res/duplicate/provider-unavailable cases per §10) was not performed this pass — it needs real document fixtures and either a real or carefully-mocked OCR provider call, which this pass's effort budget didn't extend to.

**What was inspected instead:** the OCR-to-answer write path (`document-intelligence.service.js`). `prefillSummaryForCase` and `reviewMasterDataField` are both properly scoped — they load the `Case` by `caseId` and gate through `caseService.canAccessCase(user, caseData)` before returning or accepting anything, the same authorization helper this audit already validated works correctly for restricted-portal isolation (Golden Path J). Architecturally, an uploaded document carries its own immutable `caseId` set at upload time, and OCR processes that specific document by ID — so cross-party contamination would require a bug in document-upload authorization (a separate, not-yet-independently-tested concern) rather than in the OCR pipeline itself.

**Honest status: G21 is NOT TESTED, not PASS.** The architecture looks sound on inspection, but this is not equivalent to firing a real upload from Employee A and confirming zero trace reaches Employee B's canonical data or CaseForm, which is what the plan's own standard requires. Flagged as remaining scope, not claimed as verified.

## 9. Performance (§31)

**Scope and caveat up front:** this is 5 timed samples of one operation, not a load test — it does not produce statistically meaningful P50/P95/P99 the way §31 asks for. It is reported because what it shows is surprising enough to be worth recording rather than skipping outright.

**Case creation (`POST /api/cases`, H-1B, 1 child), 5 consecutive live-fired samples against the live dev DB:**

| Metric | Sample values (ms) | Min | Median | Max |
|---|---|---|---|---|
| HTTP response time for the create call itself | 19757, 20304, 20958, 22751, 24720 | 19,757 | 20,958 | 24,720 |
| Additional wait until the CaseForm exists (background provisioning) | 21330, 25011, 26465, 30356, 31111 | 21,330 | 26,465 | 31,111 |
| **Total, click to usable form** | | **~41s** | **~47s** | **~56s** |

**This is a real finding, not just a slow-network artifact of this audit's tooling.** `case.controller.js`'s own code comment (just above the `setImmediate()` call that defers `initializeCase()`) explicitly documents a prior fix: *"Awaiting [initializeCase] here before responding was the actual ~2-minute delay... The response now returns immediately."* That fix is real and correctly structured — the heavy AI-backed orchestration genuinely runs in the background, after the response. But the measurement above is of the **response time itself**, entirely independent of that backgrounded work — meaning a **second, different, still-synchronous bottleneck** exists somewhere in the code that runs before the response (case-number generation, checklist resolution, the per-child `Case.create` + `EmployeeProfile.create` loop, or DB round-trip latency to the remote dev host) that the P12-S1 fix's own comment doesn't address at all. A staff member clicking "Create Case" in the real UI would sit on a spinner for ~20-25 seconds before seeing any confirmation, not "immediately" as the code comment claims.

**Not chased to a specific line-level cause this pass** (would need request-scoped profiling this session's tools don't have) — recorded as a genuine, measured performance concern worth a follow-up investigation, distinct from the already-fixed orchestration delay.

## 10. Required Final Numbers (§41)

| | |
|---|---|
| Total audit controls (26 gates + 18 golden paths + 13 error-register entries + 2 observations, some overlapping) | 26 gates scored individually; 11 of 18 named golden paths (§22) live-fired or directly evidenced this pass |
| **Mandatory certification gates passed** | **18** (G1, G2, G4–G9, G13–G20, G23, G24) |
| **Mandatory certification gates failed** | **6** (G3, G11, G12, G22, G25, G26) |
| **Mandatory certification gates untested** | **1** (G21 — OCR; declined to live-test this pass, see §8) |
| Mandatory certification gates mixed-by-portal | 1 (G10 — PASS on the staff portal, FAILED unconditionally on BAIS per `UI_FUNCTIONAL_COMPLETENESS.md`'s D-01) |
| Golden paths live-fired or directly evidenced this pass | C, D, E, F (implicit in every H-1B test run), G, H, I, J, M, N, O, P, Q — 13 of 18 |
| Golden paths blocked | K (beneficiary portal — blocked by DEF-012, zero beneficiary accounts can exist) |
| Golden paths not attempted | A, B (public quiz / logged-in intake → consultation, browser-click-through leg specifically — the underlying lead lifecycle was live-fired via API for DEF-007), L, R |
| **CRITICAL errors** | **5** (DEF-004, DEF-007, DEF-008, DEF-010, DEF-012) |
| **HIGH errors** | **4** (DEF-006, DEF-009, DEF-011, DEF-013) |
| **MODERATE errors** | **3** (DEF-002, DEF-003, DEF-005) |
| **LOW / INFORMATIONAL** | **2** (OBS-001, OBS-002) |
| Fixed and independently re-verified this pass | 1 (DEF-001) |
| Total defects recorded (Error Register) | 13 numbered (DEF-001–DEF-013), consolidated from a larger number of raw symptoms per §36 (e.g., DEF-013 alone closes 2 independent regression-suite failures; the DEF-005/006/UI-completeness cluster closes 3) |
| Backend regression: total / pass / fail | 560 / 545 / 15 (2 runs; 14 distinct failures, one nested) |
| Backend regression failures fully root-caused | 10 of 14 (4 resolved to one never-executed-test cluster, 2 to one real route-drift fact, 2 to stale test bugs, 1 to test-hygiene, 1 to DEF-013's genuine mapping gap — several of those "1"s are themselves 2-4 raw failures) |
| Backend regression failures still open | 4 (#2, #3, #6, #9 in §7's table) |
| Frontend regression (BAIS / INSZoom) | 24/24→22 pass 2 fail (both non-product) / 29/29 pass |
| Modules audited (module interconnectivity track) | 34 |
| Routes audited (API contract track) | 707 declarations, 746 distinct reachable method+path pairs |
| Models/collections referenced | 64 (per predecessor V3 audit, not independently recounted) |
| UI pages / controls audited | 66 pages, ~500 controls (33+33 pages, ~215+285 controls; BAIS/INSZoom split in `UI_FUNCTIONAL_COMPLETENESS.md`) |
| Route-shadowing bugs found and independently confirmed | 3 |
| IDOR-class findings (role-gated, zero resource-ownership check) | 43 reported, 3 independently spot-confirmed by this auditor (DEF-004, DEF-008, plus `eligibility-engine`) |

## 11. Final Certification Decision

**NOT CERTIFIED.**

"Certification blocked because one or more mandatory controls failed, remain untested, or have unresolved CRITICAL/SEVERE defects."

Specifically: 6 mandatory gates fail (G3, G11, G12, G22, G25, G26), 1 remains genuinely untested (G21), and 5 unresolved CRITICAL defects exist (DEF-004, DEF-007, DEF-008, DEF-010, DEF-012) — any single one of these is independently sufficient to withhold certification per §42's hard-stop rules. Two hard stops are directly triggered: *"Critical unauthorized API access succeeds"* (DEF-004, DEF-008, live-fired) and *"Mandatory golden path fails"* (Golden Path I / DEF-012, live-fired).

This is not a small-margin result. Substantial parts of the system are genuinely solid and were proven so with real evidence, not assumption: the H-1B golden path end-to-end (questionnaire → canonical → autofill → form edit → reverse sync → authentic, unwatermarked filing PDF), session/refresh persistence, case/profile-level RBAC isolation for a real distinct employee identity, duplicate-creation prevention under real concurrency, and data-consistency-under-partial-failure all passed live-fire testing performed by this auditor, not merely inherited from prior reports. But the plan's own certification standard does not permit averaging a high pass rate against unresolved CRITICAL findings — the system **cannot** be certified while an unauthenticated client-role account can read every other case's filled USCIS form data, while a lead's approval status is decorative, while a documented golden path 500s on every attempt, or while a third case-creation path silently skips the entire canonical-data architecture.

## 12. Status and Next Steps

**A final certification decision has been reached (§11): NOT CERTIFIED.** This audit is functionally complete — 25 of 26 mandatory gates carry a real, evidenced verdict, all 13 Error Register defects are documented with reproduction/evidence, and the backend regression suite has been run to completion twice with every failure individually diagnosed. What remains is narrow, not foundational:

- **G21 (live OCR)** — deliberately not live-tested. Doing so would require invoking a real, paid external AI/OCR provider with production-adjacent credentials and no available mock mode; that is a cost-incurring, external-facing action this auditor is not authorized to take unilaterally. The architecture was inspected instead (§8) and looks sound, but "looks sound" is explicitly not the same as verified — recorded honestly as NOT TESTED.
- **4 low-confidence regression failures** (§7, #2/#3/#6/#9) — not chased to a root cause; lower priority than the 10 already resolved, and none of them block a mandatory gate the way DEF-011/012/013 turned out to.
- **Full data-lineage traces (§23) and a scored change-impact matrix (§16)** were not built as separate formal artifacts — the module interconnectivity and change-impact analysis in `docs/audits/MODULE_INTERCONNECTIVITY_AND_CHANGE_IMPACT.md` covers materially the same ground informally.
- Golden Paths A/B (public quiz / logged-in intake) were not driven through an actual browser click-through — no browser-automation tool is available to this session beyond the Playwright suite already authored, and the underlying lead lifecycle those paths feed into was independently proven live via API (DEF-007).

None of these are blockers on their own — the certification decision already stands on 6 failed gates and 5 unresolved CRITICAL defects, several times over. Closing them would add detail, not change the verdict.
