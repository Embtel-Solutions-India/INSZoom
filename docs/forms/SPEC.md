# USCIS Forms Working Spec

## Required Workflow

Login -> Cases -> Open case -> Forms -> Select USCIS form -> render official PDF pages with editable overlays -> edit field -> save -> reload -> values remain -> generate/download draft PDF -> PDF opens and contains entered values.

## Implementation Rules

- `CaseForm` is the authoritative per-case form state.
- `USCISFormTemplate` is the authoritative template/version/PDF/mapping state.
- `formVersionLock` must preserve historical template and mapping version for existing cases.
- `metadataOnly` list requests must not run assignment resolution, conditional template resolution, or `Answer.find()`.
- Assignment/generation must be idempotent when valid CaseForms already exist.
- Draft PDF generation must fail explicitly on missing template, missing PDF, unsupported/empty AcroForm, or field write failures that cannot be safely handled.
- Save operations must show saving/saved/failed in the UI and must not silently discard user input.

## Current Evidence

- `GET /api/uscis-forms/case/6a720bec10a0b7740072d8ab`: verified `200`, 1 I-129 form, about 31.6s under current Atlas instability.
- `POST /api/cases/6a720bec10a0b7740072d8ab/workflow/generate-forms`: verified `200`, existing form reused, about 39.9s under current Atlas instability.
- Backend clean startup is currently blocked by `querySrv ETIMEOUT _mongodb._tcp.cluster0.eqpju6f.mongodb.net`, so full browser verification is blocked by external MongoDB DNS/connectivity.

## Verification Required After DB Stabilizes

1. Start one backend process and one INSZoom frontend process.
2. Login as Team Lead.
3. Open the real case Forms tab.
4. Open I-129 and at least two additional representative templates.
5. Edit text/date/checkbox/radio fields.
6. Save, refresh page, reopen form, verify values remain.
7. Download draft PDF, verify `Content-Type: application/pdf`, non-zero size, `%PDF-` magic, page count, and entered values in correct fields.
8. Run negative tests for invalid IDs, unauthorized user, missing template, missing PDF, duplicate generation, concurrent save, and temporary DB failure.

