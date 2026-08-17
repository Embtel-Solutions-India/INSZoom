# ISSUE-008: IDOR — Eligibility, Package Generation, and Auto-Fill Have No Per-Case Authorization

## Issue

Three live, mounted route groups allow any authenticated user holding the right role/permission (not necessarily any relationship to the case) to read or write **any case in the system** by substituting its `caseId`, because the per-case ownership check (`canAccessCase`/`requireCaseFormAccess`) that every sibling route in the same file uses is missing on these specific routes. A fourth surface (`modules/sync/sync.routes.js`) has the same defect at the router level but is currently unmounted dead code — flagged so it is never mounted without fixing this first.

## Evidence

- `Backend/src/modules/eligibility-engine/routes/eligibilityRoutes.js:9` — `POST /evaluate` gated only by `authorizePermissions("cases:read")`. `EligibilityEngineService.js` never imports `case.service`/`canAccessCase` (grep: zero hits). `EligibilityEngineService.latest(caseId)` (`:83-86`) takes no `user` parameter at all. `evaluate()` **writes** `caseRecord.eligibility` and `assessmentMatchPercentage` behind a read-only-sounding permission name.
- `Backend/src/modules/form-generation/routes/formGenerationRoutes.js:10` — `POST /packages/generate` carries `authorizeRoles(...) + authorizePermissions("forms:update")` but, unlike every other route in the same file (`:11-18`), omits `requireCaseFormAccess`. `requireCaseFormAccess.js` is keyed on `req.params.caseFormId`, which this route doesn't have — it takes `caseId` from the request body instead, structurally bypassing the middleware even if someone tried to add it without changing the route shape. `FilingPackageService.assemble()` returns every generated USCIS PDF and approved evidence document for the given case.
- `Backend/src/modules/form-mapping/services/AutoFillService.js` — ten routes under `/api/cases/:caseId/forms/:formType`; `AutoFillService.preview`, `.validation`, `.generate` etc. take no `user` parameter anywhere in the file (grep for `canAccessCase|Not authorized|403` returns zero hits).
- `Backend/src/modules/sync/sync.routes.js:9-67` — every route has `authenticate` only, no role/permission/ownership check at all; not reachable today (`grep -rn "sync.routes|modules/sync" Backend/src` and `routes/index.js` both confirm zero mount references).

## Proposed Plan

1. Add `canAccessCase(req.user, caseData)` checks to `EligibilityEngineService.latest`/`.evaluate` and to every `AutoFillService` entry point, following the exact pattern already correct in `case.service.js`, `document.service.js`, and `payment.service.js`.
2. Add a `caseId`-based authorization middleware (or an inline `canAccessCase` call in `FormGenerationController.generatePackage`) to `POST /packages/generate` before `FilingPackageService.assemble` runs.
3. Either delete `modules/sync/sync.routes.js` if it is confirmed dead/superseded, or bring it up to the same authorization standard as every other case-touching route before it is ever mounted.
4. Add a regression test asserting that a non-case-manager/non-assigned user gets 403 from each of these three route groups for a case they don't own — this class of bug (fetch-then-forget-the-check) is exactly what a route-level test catches cheaply.

## Contradictions / Alternatives

Do not "fix" this by hiding the buttons/links in the UI for unauthorized users — the audit confirmed this is a server-side gap; client-side hiding does not stop a direct API call with a substituted `caseId`.

## Delivered

Not yet delivered — audit finding only. Given the data classes involved (SSNs, alien numbers, passport numbers, employer financials, immigration eligibility assessments), this is ranked P0 in the audit's root-cause severity ranking.

## Future Learning

When one route in a file carries a per-record ownership check and a sibling route in the *same* file with the *same* apparent purpose doesn't, that asymmetry is a strong, cheap signal to grep for during any future route-file review — it was exactly how this issue and the parallel `saveAssessment`/`addUSCISFormReference`/`updateChecklistItem` gaps in `case.controller.js` were found this session.
