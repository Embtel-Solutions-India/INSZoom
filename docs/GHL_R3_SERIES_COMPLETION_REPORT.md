# GHL integration, Revision 3 series: completion report

Scope: phases R3-1 to R3-7 of `GHL_INTEGRATION_PLAN_TEMP.md` (Revision 3.1). Reference for operating the result: `GHL_INTEGRATION.md`.

## Status by phase

| Phase | Delivered | Verified |
|---|---|---|
| R3-1 | Two separate boards (Immigrant / Non-Immigrant), per-pipeline stage mapping | isolated DB script, frontend tests |
| R3-2 | Service Type to visa mapping table; routing for individual cases | isolated DB script |
| R3-3 | Employer model inbound: matching, one employer matter, one employee card per opportunity, mixed-visa flag | isolated DB script (17 checks) |
| R3-4 | Outbound employee sync: create opportunity on Add Employee, "Employer, Employee" naming, abandon on remove / reopen on restore, idempotent marker, safety sweep | isolated DB script (16 checks), 6 unit tests |
| R3-5 | Family: one case, one opportunity, petitioner = GHL contact | isolated DB script (14 checks) |
| R3-6A | Mixed-visa employers: each extra visa adds its own employer checklist (draft, approved by the case manager); visa-aware lookup; waive with a reason; flag clears only when all visas are covered; Required Documents card and client portal sections follow approved checklists; staff saves land in the right response | isolated DB script (10 checks) |
| R3-6B | Repeat petitioners: later family case pre-filled from `person.*` / `contact.*` (never `beneficiary.*`), editable independently, provenance on the timeline | isolated DB script (5 checks) |
| R3-7 | Reconciliation every 30 s and on demand, drift reporting, flag-never-delete for removed opportunities, admin Retry on failed cards, optional pacing, `GHL_INTEGRATION.md` | isolated DB script (8 checks) |

## Verification summary

- GHL unit tests: 80/80. Questionnaire tests: 304/304. Admin frontend: 108/108 tests and build. Client frontend: 30/30 tests and build.
- Existing case suite: 97/98 (one failure in form generation, present before this work). Combined questionnaires + cases + family + GHL run: 506/507 with that same failure.
- **Live GHL write test (approved)**: a throwaway contact and opportunity were created, moved, renamed, abandoned, reopened and found by search, then both deleted (verified 404). All writes the integration makes work against the real account.
- Every other test ran against throwaway databases with GHL mocked and dropped afterwards.

## Also delivered during the series (outside the plan)

- Case deletion is now fast: the case and orphaned accounts disappear immediately; files and linked records are cleaned in a durable background job with retries and an admin alert (measured cause: 79 collections swept one by one, ~53 s even with nothing to delete).
- Admin: Delete button on uploaded documents; pipeline board switch no longer loops (feedback loop between the hook and page caused `ERR_INSUFFICIENT_RESOURCES`).

## Known follow-ups

1. **Inbound webhooks have never arrived** (zero events in the database). GHL must have the webhook registered at `GHL_WEBHOOK_PUBLIC_URL` with the opportunity and contact events ticked, and the host must be reachable (a local backend needs a tunnel). Reconciliation covers the gap within about 30 seconds meanwhile.
2. `h1b-e2e` golden-path suite fails in its own fixture setup (duplicate email at `User.create`); it was not part of earlier baselines and was not shown to be caused by this work.
3. Mapping editor UI for the Service Type table is not built (API only). An optional dedicated "Immiglance Case Number" custom field in GHL would replace the marker in `source`.
4. The R3-6A/6B/7 isolated-DB scripts live in the working scratch folder, not in the repo; only the GHL unit tests are committed under `Backend/src/integrations/ghl/tests/`.
5. Re-approval when a checklist is edited after approval is deliberately not built (edits go live immediately, as before); an audit entry per edit was planned but not confirmed in code.
6. A secret was echoed to the terminal once during the work (`.env`); rotating the GHL token is advisable.

## Files (main)

New: `Backend/src/integrations/ghl/*` (client, services, workers, presenter, reconcile, employee sync), `Backend/src/models/{GHLIntegration,GHLCaseLink,GHLEmployerLink,GHLWebhookEvent,GHLSyncJob,CaseDeletionJob}.js`, `Backend/src/modules/questionnaires/employer-visa-checklists.service.js`, `Backend/src/modules/family-workflow/petitioner-prefill.service.js`, `Backend/src/modules/cases/case-deletion.service.js` (rewritten). Existing files touched with minimal guarded changes: `case.controller.js`, `questionnaire.service.js`, `case-checklist.service.js`, `Case.js`, `server.js`, `app.js`, routes, Admin `CRMCaseDetail.jsx` / `CRMCases.jsx` / pipeline components, Client `Documents.jsx`.
