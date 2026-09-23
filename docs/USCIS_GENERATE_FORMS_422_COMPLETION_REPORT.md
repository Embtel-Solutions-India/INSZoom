# USCIS Generate-Forms 422 — Completion Report

## Summary

The Case Manager's "Generate USCIS Forms" button was failing with a bare `422 (Unprocessable Entity)` and no actionable message. Root cause was traced to two real throw sites in one function, confirmed against live production data (not assumed), and fixed with structured diagnostics — no rebuild of the surrounding USCIS pipeline, which turned out to already be a mature, working system.

---

## Root cause

`Frontend casesApi.generateForms(id)` → `POST /cases/:id/workflow/generate-forms` → `case.controller.js:generateCaseForms` → `CaseLifecycleOrchestrator.generateForms` (`Backend/src/modules/cases/case-lifecycle-orchestrator.service.js`). Exactly two `422` throws exist in the real call path, both in this one function:

- **`CANONICAL_NEEDS_REVIEW`** — the case's canonical profile has an unresolved conflict: two data sources disagree on the same field and neither has been reviewed.
- **Generic "No active USCIS form templates are configured for `<visaType>`"** — after provisioning runs, zero `CaseForm` records exist for the case. This branch carried **no error code**, which is why the frontend showed nothing useful for it specifically.

### Live evidence (92 real cases queried, read-only)

| Finding | Evidence |
|---|---|
| 10 real H-1B cases hit `CANONICAL_NEEDS_REVIEW` right now | `canonicalProfile.conflicts[].status === "pending_review"`, all on `person.fullName`, e.g. `"Ada Kingsley Lovelace"` (from `beneficiary.fullName`) vs `"Ada Lovelace"` (from `user.name`) — both sources tagged `sourceType: "database"` at **identical priority (200)**, so the merge logic has no way to pick a winner automatically |
| 1 case hits the generic zero-forms 422 | `visaType: "I-539-COS"` — not a real visa classification anywhere in the registry; `resolveVisaFormMappings()` returns `resolvedVisaType: null, unresolved: true` |
| P-1A initially looked broken — it isn't | A naive first pass (checking `VisaFormMapping` for an exact `"P-1A"` match) missed that P-1A has no row *by design* and correctly falls back to `"P-1"` via the hierarchy walker; `"P-1"` has a complete, active mapping (I-129/I-539/I-907) |

---

## Fix

1. **`Backend/src/modules/cases/case-lifecycle-orchestrator.service.js`** — the zero-forms throw now carries `code: "USCIS_FORMS_UNRESOLVED"` plus a `details` payload (`resolvedVisaType`, `usedParentFallback`, `unresolved`, per-form `templateDiagnostics`). Built entirely from `visaFormMapping.service.js`'s existing `resolveVisaFormMappings()`/`templateDiagnostics()` — no new resolution logic written; these functions already existed for a different debug surface and were simply reused here.
2. **`Admin/frontend/src/pages/CRMCaseDetail.jsx`** — `generateCaseForms()`'s catch block now:
   - For `CANONICAL_NEEDS_REVIEW`: names the actual conflicting field and both competing values (`data.details.validation.conflicts` was already being sent by the backend — just never read on the frontend).
   - For the new `USCIS_FORMS_UNRESOLVED`: explains *why* (unmapped visa type vs. mapped-but-no-active-template), listing affected forms.
   - Both replace what used to fall through to a generic/blank message.

---

## What was investigated but deliberately not touched

- **The `beneficiary.fullName` vs `user.name` same-priority tie** — a structural data-consistency gap in how two database-sourced fields are prioritized during canonical merge. Real, and likely to recur, but fixing merge-priority logic affects canonical data app-wide (document intelligence, questionnaire prefill, case profile display), not just USCIS forms — out of scope for a 422 fix. Now surfaces clearly enough for a human to resolve it instead of hitting an opaque wall.
- **The `I-539-COS` case's invalid visa type** — a single case with bad data, not a registry gap. Not silently reassigned; the new error message tells a human to check it.
- **`PackageDefinition`/`PetitionAssemblyService`** — a separate, adjacent visa→form mapping system covering only 6 visa types, with its own independent `422 NO_PACKAGE_DEFINITION`. Confirmed via full call-chain trace that this is **not** in the "Generate USCIS Forms" button's path — flagged as a known, pre-existing risk (also independently documented in the repo's own `docs/visa-form-mapping-audit.md`), not fixed here.
- **Everything else the original task description asked for** — live USCIS PDF acquisition/versioning, PDF field extraction, canonical autofill, manual-override preservation, checkbox/date normalization, SSRF hardening, caching, structured logging. All confirmed, by reading the real code, to already be implemented and working. No rebuild was performed.

---

## Verification

- Live, read-only diagnostic run against the production DB (92 cases) before writing any fix — confirmed the real failure modes rather than guessing.
- The new `USCIS_FORMS_UNRESOLVED` diagnostic logic re-run live against the actual `I-539-COS` case (correctly returns `unresolved: true`, empty form list) and a working `H-1B` case (correctly returns 2 resolvable forms) — confirmed it produces the intended output before and after.
- `node --check` + a require-time load test on the backend file; an `esbuild` syntax check on the frontend file (no lint config present in that app).
- No dev server or application was started; all temporary diagnostic scripts were deleted after use.

## Files changed

- `Backend/src/modules/cases/case-lifecycle-orchestrator.service.js`
- `Admin/frontend/src/pages/CRMCaseDetail.jsx`
