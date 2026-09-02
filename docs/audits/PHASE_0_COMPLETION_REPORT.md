# Phase 0 — Mandatory Pre-Audit Investigation & Baseline Reconciliation

**Date:** 2026-09-01
**Scope:** Phase 0 of the "Comprehensive Deep Functionality + Workflow Audit v3.0" (`comprehensive audit plan.txt`). This is the prerequisite gate that MUST close before Phase A of the full audit begins.

---

## 0.1–0.2 — Prior documentation reviewed, baseline established

Two same-day artifacts in `docs/audits/` are the authoritative prior audit outputs referenced by this plan's Phase 0:

| Document | What it covers | Result |
|---|---|---|
| `FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md` | Live end-to-end lead→case→questionnaire→forms workflow, 26 checks against the real running server/DB | **23/26 PASS**, 3 failures traced to 1 root cause |
| `COMPREHENSIVE_AUDIT_V3_REPORT.md` | Track 1 (static code) + Track 2 (database) + curl-testable subset of Track 3 (RBAC/IDOR) | All PASS, no CRITICAL/SEVERE findings; browser-only items explicitly left **NOT INDEPENDENTLY VERIFIED** (no browser tool available in that session) |

**Baseline reconciled:** the plan's stated "23/26 PASS, 1 known bug" baseline is confirmed to be this exact `FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md`, not a separate/different prior run. Per §0.2, this PASS/FAIL history is carried forward as the historical baseline; only the failing 3/26 (all one root cause) and the browser-dependent NOT-VERIFIED items from the V3 report needed fresh work in this phase.

## 0.3 — Known defect root cause, understood and traced

**The null-placeholder defect** (this plan's §0.3 dependency-chain requirement):

```
case.controller.js createCase()
  → EmployerProfile.create() unconditionally stamps
    canonicalData.legalName = { value: trimmedEmployerName || null, source: "case_manager_edit" }
    canonicalData.contact.email = { value: trimmedEmployerEmail || null, source: "case_manager_edit" }
  → "case_manager_edit" is in canonicalFieldWriter.js's STAFF_AUTHORITATIVE_SOURCES
  → when the case is created the normal way (no employerName in the request body —
    the common case; employerName isn't even part of the validated create-case payload),
    this stamps a null value as if a staff member had already authoritatively set it
  → later, the employer's real questionnaire submission (POST /employer-profile/:id,
    source: "questionnaire") hits buildCanonicalUpdate()'s staff-authoritative-source
    check (canonicalFieldWriter.js:126) and is silently rejected into an unsurfaced
    conflictPending sub-object — API still responds { success: true }
  → EmployerProfile.canonicalData.legalName stays null forever unless a case manager
    manually finds and resolves the conflict
  → downstream: CanonicalBuilderService / AutoFillService / I-129 crosswalk / every
    child case's CaseForm all see null
  → this is the single root cause behind all 3 FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md
    failures (employer legalName autofill FAIL, manual-override-survives-re-autofill
    SKIPPED as a cascade, and the underlying G15/G16-class gates it maps to in this
    plan) — not three independent bugs
```

This matches the plan's illustrative `Null placeholder defect → G15 → G16 → questionnaire→canonical → canonical→form → golden-path failures` shape exactly.

## 0.4 — Fix applied (approved by user before this session touched any code)

**File:** `Backend/src/modules/cases/case.controller.js` (`createCase`, employer_employee/family case-structure branch, ~line 1080)

**Before:** `EmployerProfile.create()` always wrote `legalName`/`contact.email` with `source: "case_manager_edit"`, even when `trimmedEmployerName`/`trimmedEmployerEmail` were empty.

**After:** those two canonical fields are only included in the initial `EmployerProfile.create()` payload — with `source: "case_manager_edit"` — when a real value was actually supplied at case-creation time. When omitted, the field falls back to the schema's own default (`source: "questionnaire"`, non-staff-authoritative), so the employer's first real questionnaire write applies normally instead of conflicting with itself.

This is the fix the prior functional audit's own report recommended (§"Recommendation" in `FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md`) — no alternative fix was invented, per this plan's §0.4.

**Targeted tests run** (`node --test`, live dev DB):

```
src/modules/cases/tests/case-lifecycle-form-provisioning.test.js
src/modules/cases/tests/case-lifecycle-orchestrator.test.js
src/utils/tests/canonicalFieldWriter.phase11.test.js
→ 10/10 pass, 0 fail
```

## 0.5 — H-1B golden path: 4/4 PASS (live-verified)

Executed against the live running backend (`:7000`) and live dev database — real HTTP calls, a real staff JWT minted for a real admin user pulled from the DB (never fabricated), all test data deleted afterward (0 residue). Full trace:

```
Questionnaire → Canonical Data → Mapping → USCIS Form → Persisted form data
```

| # | Check | Result |
|---|---|---|
| 1/4 | `POST /api/cases` creates H-1B case → auto-derived `caseStructure: employer_employee`, 1 child case | **PASS** (`201`) |
| — | Fix check: fresh `EmployerProfile.canonicalData.legalName` is NOT pre-stamped `case_manager_edit` | **PASS** (`source: "questionnaire"`, `value: null`) |
| 2/4 | Employer's questionnaire submission (`POST /api/employer-profile/:principalCaseId`, `source: "questionnaire"`) is applied, not silently conflicted | **PASS** (`updatedFields: ["legalName"]`, `conflictedFields: []`) |
| 3/4 | Canonical data persists the real legal name, no `conflictPending` | **PASS** |
| 4/4 | `CaseForm.fieldValues` (via `POST /api/cases/:id/workflow/generate-forms`) contains the real legal name on the actual USCIS I-129 field (`page1.form10Subform0Line3CompanyorOrgName0`) | **PASS** |

**Result: 4/4 required checks PASS.** Full certification audit is unblocked.

## 0.6–0.9 — Current-code inspection, completion-claim reconciliation, repo state

Already covered in depth by `COMPREHENSIVE_AUDIT_V3_REPORT.md` (Tracks 1–2, dated the same day) and not re-derived here to avoid duplicating evidence that hasn't gone stale — modules inspected there: auth, RBAC, cases, leads, questionnaires, canonical data, OCR, form registry/mapping/autofill, PDF generation, documents, notifications, email, assignments, storage, audit logging. No contradicting evidence found while investigating the defect above.

**Repository state at time of fix:**

| | |
|---|---|
| Branch | `refactor` |
| Commit (base) | `c86c446af086a3d637831d9618039c6e95633850` |
| Working tree | 1 modified file: `Backend/src/modules/cases/case.controller.js` (this fix, uncommitted) |
| Node | v22.20.0 |
| Backend | running, `:7000`, `/api/health` → 200 |
| MongoDB | live dev DB `immigration_crm`, direct `mongodb://` (not Atlas) |

## 0.10–0.13 — Dependency graph, testability matrix, sensitive-data policy, environment limitations

- Dependency graph: `docs/architecture/FULL-SYSTEM-DEPENDENCY-GRAPH.mmd` and `docs/architecture/dependency-graph.json` already exist in-repo and match this plan's §0.10 shape; reused rather than redrawn.
- Testability matrix: applied implicitly throughout this phase — case creation/questionnaire/canonical/autofill verified API+DB (no browser needed); PDF visual rendering, login-page click-through, and RBAC-driven menu visibility remain browser-testable items, tracked into the next phase.
- Sensitive-data policy: all identifiers above are either synthetic test data (deleted) or masked (emails, JWT secrets, connection strings) per §0.12.
- Environment limitation: no interactive browser-automation tool is available to this session; Playwright (`INSZoom/frontend/playwright.config.js`) is present and will be used for the browser-testable items in the next phase, per user direction — not blindly reported as PASS/FAIL without evidence.

## Phase 0 exit criteria — status

| Criterion | Status |
|---|---|
| Previous functional audit reviewed | Done |
| 23/26 baseline reconciled | Done |
| Known defect identified | Done |
| Known defect root cause understood | Done |
| Existing fix procedure reviewed | Done |
| Fix applied | Done |
| Fix independently verified | Done (10/10 targeted tests + live re-run) |
| H-1B golden path = 4/4 PASS | **Done** |
| Current source inspected | Done (via V3 report + this investigation) |
| Completion reports reconciled with code | Done |
| Current repository state captured | Done |
| Dependency graph established | Done (reused existing) |
| API/browser/database testability matrix established | Done |
| Sensitive-data masking rules established | Done |
| Environment limitations recorded | Done |

**Phase 0 is complete. Phase A may begin.**
