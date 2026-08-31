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

## 2026-08-28 Pre-F2 Follow-Up

### Issues Encountered

- Employer/employee principal cases used the Phase 9 canonical profile save path, but the generate-forms readiness gate still looked only at legacy questionnaire references or submitted `Answer` records. Saving the employer questionnaire could therefore leave `questionnaireComplete=false` and keep returning `409 QUESTIONNAIRE_INCOMPLETE`.
- The BAIS login page did not expose the backend's already-supported Case ID login payload, so users with a case ID still had to use email login.
- BAIS navigation showed Dashboard, Messages, and Payments before the session had an active case context.
- The H-1B employer/employee questionnaire configs were still a first-cut subset and did not cover the checklist reference fields.
- Employer and employee records could be confused by matching emails during employer/employee flows; create-case needed a warning and employee invite needed a clear validation failure instead of a downstream duplicate-user error.

### Resolution

- Employer profile saves now stamp `questionnaireData.lastSubmittedAt` and profile progress flags on the principal case.
- `CaseLifecycleOrchestrator.metrics()` now treats an employer/employee principal case with a submitted employer profile as questionnaire-complete for generation readiness.
- BAIS login now supports a UI toggle for Email vs Case ID login while reusing the existing `/auth/login` contract.
- BAIS navbar now uses `/auth/session-context` and hides case-only navigation until `hasCase` is true.
- Canonical employer/employee schemas and the generic questionnaire field config were expanded from the H-1B employer and employee checklist references.
- Create-case now returns a non-blocking warning when employer email matches client email, and employee invite now returns a targeted validation error when the invite email matches the employer principal email.

### Impact

Saving employer questionnaire data now unblocks the first generate-forms gate for employer/employee principal cases without requiring the employee questionnaire to block employer form generation. Employee profile completion remains tracked separately on the child case and parent progress metadata.
