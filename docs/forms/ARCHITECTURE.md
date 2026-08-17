# USCIS Forms Architecture Memory

## Dependency Map

Browser Forms tab
-> `INSZoom/frontend/src/pages/CRMCaseDetail.jsx`
-> `uscisFormsApi.caseForms(caseId)`
-> `GET /api/uscis-forms/case/:caseId`
-> `authenticate` + `authorizePermissions("forms:read")`
-> `uscis-form.controller.getCaseForms`
-> `uscis-form.service.listCaseForms`
-> `getAccessibleCase(..., { allowStaleFallback: true })`
-> `ensureAssignedForms(..., { metadataOnly: true })`
-> `CaseForm.find({ caseId })` projected list rows
-> Forms table.

Open form
-> `USCISFormRenderer`
-> `uscisFormsApi.workspace(caseId, caseFormId)`
-> `GET /api/uscis-forms/case/:caseId/:formId/workspace`
-> `interactiveFormReviewService.open(..., { track: false, readOnlyOpen: true })`
-> `uscis-form.service.renderCaseForm(..., { readOnlyOpen: true })`
-> `CaseForm` + locked `USCISFormTemplate`
-> `FormMappingService.loadMappingVersion`
-> current `fieldValues`/`filledData`
-> rendered sections/pages/field overlays.

Edit/save
-> `USCISFormRenderer.savePendingChanges`
-> `PATCH /api/uscis-forms/case/:caseId/:formId/workspace/field`
-> `interactiveFormReviewService.saveField`
-> `AutoFillService.overrideField`
-> `CaseForm.fieldValues`/`filledData`/manual override history.

Draft PDF
-> `formGenerationApi.draftPdf(caseFormId)`
-> `GET /api/forms/:caseFormId/draft-pdf`
-> `formGenerationRoutes`
-> `requireCaseFormAccess`
-> `FormGenerationController.draftPdf`
-> `PDFGenerationService.loadCaseForm(..., { readOnly: true })`
-> `PDFRenderer.render({ flatten: false, watermark: "DRAFT" })`
-> `PDFFieldMapper`
-> official USCIS PDF template bytes
-> `pdf-lib` AcroForm fill
-> `application/pdf` response.

## Guardrails

- Do not put `uscis-form.routes` before `formGenerationRoutes` on `/api/forms`; generic `/:id` routes will swallow `/draft-pdf`.
- Do not start background DB recovery loops at module import time. Start them only after `connectDB()` and `server.listen()`.
- Do not make GET open/list paths write to MongoDB. Hidden writes make browser rendering depend on primary availability.
- Do not replace official USCIS PDFs with HTML placeholders. HTML may be an editing overlay only; final output must fill the official PDF.
- Do not claim PDF correctness from JSON responses. Verify `%PDF-` bytes, page count, and field values in the generated file.

## Permanent Reference (forensic audit, 2026-08-13/14)

### 1. Current architecture (confirmed this session)

```
Client Portal (BAIS/Frontend)              Admin Portal (INSZoom/frontend)
        |  fetch-based api.js, 25s timeout          |  axios-based api.js, 120s timeout
        v                                            v
                    Backend (Express + Mongoose, 29 router mounts, 350 routes)
                                    |
                    authenticate -> authorizeRoles/authorizePermissions -> controller -> service
                                    |
                    MongoDB Atlas (cluster0.eqpju6f.mongodb.net, shared/free tier)
```
Full node/edge detail: `docs/architecture/dependency-graph.json`, `docs/architecture/FULL-SYSTEM-DEPENDENCY-GRAPH.mmd` (structural), `docs/architecture/data-flow.mmd` (operational). Confirmed live: MongoDB itself is healthy (~50ms round trips, 93 cases in the whole DB); slowness/503s come from dead pooled connections and payload size, not data volume or an unreachable database.

### 2. Confirmed issues (this session, in addition to ISSUE-001..005)

- **ISSUE-006** (`docs/forms/issues/ISSUE-006-cases-503-dead-pooled-connections.md`): `GET /api/cases` and `GET /api/cases/dashboard/team-lead` reproduced live at 503 after ~30.2s — same dead-pooled-connection mechanism as ISSUE-005, on a different module. Root cause: `Backend/src/config/database.js`'s documented connection instability, multiplied by `case.service.js`'s 12-17 populate paths per request.
- **ISSUE-007** (`docs/forms/issues/ISSUE-007-auth-refresh-session-rotation-race.md`): `POST /api/auth/refresh` 500, root-caused to a genuine concurrency bug (unguarded `AuthSession` version race in `session.service.js:rotateSession`), not a database outage. `errorHandler.js` has no `VersionError` branch, so it falls through to a generic 500.
- **ISSUE-008** (`docs/forms/issues/ISSUE-008-idor-eligibility-packages-autofill.md`): P0 IDOR — `/api/eligibility/evaluate`, `/api/forms/packages/generate`, and the 10 auto-fill routes under `/api/cases/:caseId/forms/:formType` have no per-case ownership check at all (contrast with every sibling route in the same files, which do). A dead-but-unmounted `modules/sync/sync.routes.js` has the identical defect and must not be mounted before it's fixed.
- **GET .../render still performs hidden writes** — ISSUE-003's fix covers `GET .../workspace` only; `GET /case/:caseId/:formId/render` (a different route in the same controller) still runs `caseForm.save()` + `writeAuditLog()` unconditionally, because its controller never passes `readOnlyOpen`.
- **Case model declares 127 indexes** — MongoDB's hard limit is 64/collection; the explicit compound and text indexes (`Case.js:851-897`) are all past that ceiling and do not exist on the live collection, silently degrading Cases-list query performance.
- **ISSUE-005 reclassified**: this session's live DNS probe resolved cleanly (45ms, 3 shard hosts) and a direct driver connection succeeded — the SRV/DNS failure originally documented does not currently reproduce. The regression check concludes ISSUE-005 was a symptom of a broader connection-instability class (dying pooled connections on a shared/free Atlas tier), not a DNS-specific defect; DNS was one visible manifestation, not the root cause. Also newly confirmed: `server.js`'s `connectDB().catch(() => process.exit(1))` has no retry — any transient startup connection failure (DNS or otherwise) requires a manual process restart.

### 3. Permanent working style (carried forward from this audit)

- Never preload every page/module at startup; page-specific queries run only when the page/tab is opened (already correctly implemented for USCIS forms' `metadataOnly` list path — extend this discipline to any new list/dashboard endpoint).
- Do not fetch hidden tabs/subpages speculatively.
- Add `.maxTimeMS()` fail-fast budgets to every list/dashboard read path on a case, not just the one that gets reported slow — the Cases 503 (ISSUE-006) is proof that a fix scoped to one endpoint (Forms) does not protect a structurally identical endpoint (Cases) hitting the same unreliable cluster.
- Do not solve pool-wait/timeout symptoms by raising `MONGO_MAX_POOL_SIZE`/timeouts further — the historical 90s incident was made *worse*, not better, by larger timeouts; shorter fail-fast budgets plus fewer round trips per request is the correct direction.
- Trace every failure Frontend -> API -> Route -> Middleware -> Controller -> Service -> DB -> Response -> UI before changing code; this session's Cases-503 and auth-refresh-500 findings were reached by tracing both the forward path and, separately, the parallel auth-middleware path, before attributing either failure.
- Never treat correlation as proof — the regression check on ISSUE-005 explicitly declines to claim "DNS caused the 503s," instead separating the confirmed connection-instability mechanism from the unverified causal link to the specific historical DNS incident.

### 4. Forms-specific rules (this session's additions)

- `GET .../render` (uscis-form.controller.js) must receive the same `readOnlyOpen`/`track:false` treatment already correctly applied to `GET .../workspace` — do not assume a fix on one route covers a sibling route with a similar name.
- Checkbox/radio field values reaching `CaseForm.filledData` via a manual override (`AutoFillService.overrideField`) receive zero type coercion before `PDFRenderer.js` applies plain JS truthiness (`value ? field.check() : field.uncheck()`) — a non-boolean truthy string (e.g. the literal string `"No"`) would render as checked. The active I-129/H-1B crosswalk avoids this today because every mapped edge routes through a `{transform:{type:"boolean"}}` step; manual overrides do not.
- I-134, I-539, I-539A, and I-907 currently have **zero** canonical-to-PDF field mappings (only I-129, I-129F, and I-130 have crosswalk seeds) — auto-fill produces an effectively empty form for those 4, requiring full manual entry. This does not contradict the verified I-129 PDF-rendering evidence below; it is a separate, form-specific mapping-coverage gap.
- Preserve the verified I-129 rendering fidelity (38 pages, 980 AcroForm fields, 349/351 written, 311/311 persisted-value fidelity) as the baseline any future PDF-pipeline change must not regress.

### 5. Security rules (reaffirmed)

- Never log passwords/tokens/sensitive bodies — confirmed still correctly enforced by `Backend/src/utils/logger.js`'s recursive redaction.
- Enforce authentication + authorization + ownership server-side — this session found three P0 exceptions to that rule (ISSUE-008) that must be closed before they're relied upon as "already enforced."
- DevTools cannot be disabled; security must come from server-side checks, not hidden UI — directly relevant to ISSUE-008, where the gap is server-side, not a UI-hiding problem.

### 6. Target outcome

```
USER ACTION -> ONLY REQUIRED PAGE/API -> ONLY REQUIRED QUERY -> MINIMAL DATA -> UI
```
No unnecessary startup queries. No N+1. No uncontrolled populate. No unnecessary concurrent requests. No sensitive logging. No unverified root-cause claims. No regression of the verified I-129 PDF pipeline. This session's Cases-503, auth-refresh-500, and IDOR findings are the concrete gaps between current code and that target — see the full forensic report (chat transcript, 2026-08-13/14 session) for evidence-cited detail on each.

