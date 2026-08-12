# ISSUE-003: GET Workspace Performed Hidden Writes

## Issue

Opening a form performed CaseForm writes: merged values, validation/completion updates, review-opened audit, and status changes. This made a read-only browser action depend on primary MongoDB availability and contributed to long hangs/503s.

## Evidence

Workspace open returned `503 DATABASE_UNAVAILABLE` under primary instability. Code path showed `renderCaseForm()` calling `caseForm.save()` and `writeAuditLog()` during GET.

## Proposed Plan

1. Add a `readOnlyOpen` option to workspace open.
2. Make `renderCaseForm(..., { readOnlyOpen: true })` skip all CaseForm/Audit writes.
3. Use secondaryPreferred for read-only Case/CaseForm/template display reads where authorization remains checked.
4. Leave explicit save/review/approve endpoints as primary-bound write paths.

## Contradictions / Alternatives

Do not hide database errors in the frontend or show stale “saved” state. GET can be read-only; PATCH/PUT/POST must still report write failures.

## Delivered

`openInteractiveForm`, `InteractiveFormReviewService.open/load`, and `uscis-form.service.renderCaseForm` now support a non-writing open path.

## Future Learning

GET endpoints must not mutate state unless there is a deliberate product reason. Hidden writes turn display features into write-availability features.

