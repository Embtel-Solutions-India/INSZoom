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

## Permanent Reference (forensic audit, 2026-08-13/14)

**DB stabilized since this doc's original "Current Evidence" was written**: this session's live DNS probe resolved `_mongodb._tcp.cluster0.eqpju6f.mongodb.net` in 45ms (3 shard hosts), and a direct driver connection succeeded (connect 673ms, ping 50ms, MongoDB 8.0.29). The specific DNS blocker described above no longer reproduces — treat lines 19-21 above as a historical point-in-time record, not current status.

**However, the underlying instability is not resolved** — reproduced live this session on a *different* module: `GET /api/cases` and `GET /api/cases/dashboard/team-lead` both returned `503 DATABASE_UNAVAILABLE` after ~30.2s, with server logs showing `MongoNetworkTimeoutError` and `mongodb_connection_closed(reason:"error")` on the pooled connection immediately before each failure — the same mechanism this doc's evidence describes for Forms, now confirmed on Cases too (see `docs/forms/issues/ISSUE-006-cases-503-dead-pooled-connections.md`).

**Regression status of this doc's Implementation Rules, re-verified against current code (not assumed from the "Delivered" labels in the issue files):**
- `metadataOnly` list requests genuinely skip assignment resolution/conditional-template resolution/`Answer.find()` — **PASS** (`uscis-form.service.js:501`, first line of `ensureAssignedForms`).
- Assignment/generation idempotency — **PASS** (`case-lifecycle-orchestrator.service.js:391-411`, verified via live code trace, not assumed).
- **New gap found, not covered by this doc's original rules**: `GET .../render` (a route separate from `GET .../workspace`) still performs unconditional writes — the "must not silently discard user input" rule this doc states is intact for `/workspace` but was never extended to `/render`.

**Additional verification-required items, added to the checklist above:**
9. Reproduce two near-simultaneous `POST /api/auth/refresh` calls (e.g. two browser tabs, or a slow page triggering independent 401-driven refreshes) and confirm whether the second returns 500 (`docs/forms/issues/ISSUE-007-auth-refresh-session-rotation-race.md`) — this is a genuine code defect (unguarded `AuthSession` version race), not a database-availability question, so it will reproduce regardless of DB health.
10. Verify `POST /api/eligibility/evaluate`, `POST /api/forms/packages/generate`, and any `/api/cases/:caseId/forms/:formType` auto-fill route return 403 (not case data) when called with a `caseId` the authenticated user does not own — confirmed missing server-side this session (`docs/forms/issues/ISSUE-008-idor-eligibility-packages-autofill.md`).

