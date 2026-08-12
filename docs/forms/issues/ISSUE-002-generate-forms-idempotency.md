# ISSUE-002: Generate Forms Returned Conflict/Failure For Existing Forms

## Issue

`POST /api/cases/:caseId/workflow/generate-forms` could fail before noticing that valid CaseForms already existed. Under DB instability it returned `DATABASE_UNAVAILABLE`; under readiness gates it could return 409 even when the browser only needed to reuse assigned forms.

## Evidence

Before patch: request returned `503 DATABASE_UNAVAILABLE` after about 30s.
After patch: same case returned `200`, message `USCIS forms are already assigned for this case. Existing forms were reused.`

## Proposed Plan

1. Read case with bounded primary read and secondary fallback for idempotent detection.
2. Check existing non-archived CaseForms before readiness/canonical/autofill work.
3. Return existing forms instead of creating duplicates.
4. If no existing valid forms and primary is unavailable, fail honestly.

## Contradictions / Alternatives

Do not turn every 409 into 200. Readiness conflicts are still valid when no usable CaseForms exist and generation would require writes.

## Delivered

`CaseLifecycleOrchestrator.generateForms` now returns existing usable CaseForms idempotently.

## Future Learning

For user-clickable generation endpoints, design for double-click and refresh. Existing valid work should be reused; only genuinely invalid generation should conflict.

