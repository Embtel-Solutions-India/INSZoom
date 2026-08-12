# ISSUE-001: Draft PDF Route Shadowing

## Issue

`GET /api/forms/:caseFormId/draft-pdf` returned a 500 because `/api/forms` mounted `uscis-form.routes` before `formGenerationRoutes`. The generic USCIS `/:id` route treated `draft-pdf` as a `USCISFormTemplate` id.

## Evidence

HTTP error body included: `Cast to ObjectId failed for value "draft-pdf" ... for model "USCISFormTemplate"`.

## Proposed Plan

1. Put `formGenerationRoutes` before the generic forms router.
2. Keep the USCIS template routes available after specific form-generation routes.
3. Re-test `/api/forms/:caseFormId/draft-pdf`.
4. Add/keep route registration tests.

## Contradictions / Alternatives

Do not add special-case code to `/:id` to ignore `draft-pdf`; that leaves future form-generation routes vulnerable to the same ordering bug.

## Delivered

`Backend/src/routes/index.js` now mounts `formGenerationRoutes` before `uscis-form.routes` for `/forms`.

## Future Learning

When an Express route has both generic `/:id` and specific nested endpoints, always mount specific routers first. Do not “fix” the symptom by catching CastError and returning an empty PDF.

