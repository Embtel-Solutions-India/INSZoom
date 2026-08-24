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

Edit/save (updated by Phase 2 §I.1/§I.3 - see "Forms-specific rules" below for the full contract)
-> `USCISFormRenderer.savePendingChanges`
-> `PATCH /api/uscis-forms/case/:caseId/:formId/workspace/field`
-> `interactiveFormReviewService.saveField`
-> `AutoFillService.overrideField`
-> `ReverseIndexService.lookupSource` (via `AutoFillService.resolveReverseSync`) decides:
   - **reverseSync-eligible** (direct atomic canonical field, e.g. `person.lastName`):
     `CanonicalProfileService.applyStaffEdit` (the only method that ever mutates
     `Case.canonicalProfile`) -> `AutoFillService.generate(..., {regenerate:true})` fans the new
     canonical value out to this form's other PDF fields sharing the same source -> then
     `CaseForm.fieldValues`/`filledData`/manual override history, same as before.
   - **not eligible** (derived/composite mapping, e.g. `person.fullName`, or a form-only/unmapped
     field): unchanged from before Phase 2 - `CaseForm.fieldValues`/`filledData`/manual override
     history only, `Case.canonicalProfile` untouched.

Conflict resolution (Phase 3 §I.4 - resolves a per-field sync-state CONFLICT, NOT the older
canonical-merge conflict `.../workspace/conflict` still handles further above)
-> `POST /api/uscis-forms/case/:caseId/:formId/workspace/field/resolve-conflict`
-> { fieldName, sectionKey, direction: "canonical" | "manual" }
-> `interactiveFormReviewService.resolveFieldConflict`
-> `SyncStateService.setSynced` (direction: canonical) / `setManualOverride` (direction: manual)
-> `CanonicalProfileService.applyStaffEdit` (canonical direction always; manual direction only when
   the field is itself reverseSync-eligible - never guesses a reverse mapping for a derived/form-only
   field)
-> `fieldHistory` entry `{action: "conflict_resolved", metadata: {direction}}`, same `.save()` call
   as the syncState change (atomic - a mid-request failure can't leave one written without the other)
-> updated workspace field view (`syncState` cleared to `SYNCED` or `MANUAL_OVERRIDE`).

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

**Phase 2 (§I.1/§I.3) - canonical write-back and the reverseSync boundary** (see
`docs/forms/PHASE2_BASELINE.md` for the full contract, test evidence, and the P2-001 ledger entry):

- **Old invariant (Phase 0/1):** `AutoFillService.overrideField` mutated only the edited `CaseForm`
  - it never touched `Case.canonicalProfile`, unconditionally, for every field.
- **New invariant (Phase 2):** that split by field. A **reverseSync-eligible** field (a direct,
  atomic canonical mapping, e.g. `person.lastName`) now ALSO reaches `Case.canonicalProfile` -
  exclusively through `CanonicalProfileService.applyStaffEdit`, never via an ad-hoc write inside
  `overrideField` itself. A **reverseSync:false** field (derived/composite, e.g. `person.fullName`)
  or a form-only (unmapped) field keeps the original invariant unchanged - canonical is never
  touched, never guessed at. `docs/forms/PHASE0_BASELINE.md`'s "Phase 0 invariant" test for this
  boundary was replaced with two Phase 2 tests (`phase0.invariants.test.js`, canonical module) - one
  per half of the new contract - rather than deleted or weakened, because the single old invariant
  is no longer uniformly true across all fields.
- **`CanonicalProfileService.applyStaffEdit` is the SOLE canonical-mutation primitive.**
  `overrideField` only decides WHETHER to call it (via `ReverseIndexService`) and fans its result
  out to sibling PDF fields on the same form afterward (`AutoFillService.generate(...,
  {regenerate:true})`, reusing the existing `isReviewedOrManual`-protected regenerate path - not a
  parallel re-implementation). No canonical mutation logic is duplicated inside `overrideField`.
- **`ReverseIndexService`** (`Backend/src/modules/form-mapping/services/ReverseIndexService.js`)
  determines, for a given PDF field, whether it round-trips to a canonical source path and whether
  that mapping is safely reversible (`reverseSync:true`/`false`), from the real compiled mapping
  graph - never a hand-parsed crosswalk file.
- **STAFF-WINS conflict policy (§J.1 Option A):** a staff correction permanently outranks a later
  conflicting update from any other source (questionnaire, OCR, database). The later value never
  silently overwrites it - `CanonicalProfileService.rebuild()` (called by every subsequent
  `CanonicalDataService.build()`) re-applies the durable staff override on top of the freshly-built
  profile and records a pending conflict in `canonicalProfile.conflicts` when they disagree, using
  the same `resolveConflict` flow a merge-detected conflict already uses.
- **Concurrency & idempotency:** `applyStaffEdit` uses an optimistic-concurrency compare-and-swap on
  `canonicalProfile.version` (`STALE_FORM_REVISION`, HTTP 409, on a stale save) and is idempotent - a
  resubmitted value that doesn't actually change anything is a no-op (no version bump, no duplicate
  history, no event, and `overrideField` skips the fan-out regenerate too).
- **Sync-state model (§I.4, `SyncStateService`):** every data-bound CaseForm field carries one of three
  states, stored in `sourceAttribution[pdfField].syncState` (not `CaseForm.syncState`, which is a
  strictly-typed subdocument that would silently drop an unrecognized key - see `SyncStateService.js`'s
  header comment). `SYNCED` - value came from the last auto-fill/fan-out, matches canonical (the
  default when unset). `MANUAL_OVERRIDE` - a CM explicitly edited this exact field on this form.
  `CONFLICT` - a fan-out wanted to re-fill this field from canonical but it already carries its own,
  different manual override; the stored value is never overwritten, and both the canonical and manual
  values are recorded (`conflictCanonicalValue`/`conflictManualValue`) for a source-panel UI. Fan-out
  is currently scoped to sibling fields on the **same** CaseForm only - cross-form-type fan-out was
  explicitly out of Phase 2's boundary.
- **Two independent conflict systems coexist (Phase 3) - do not merge them.** `buildFieldView`
  returns BOTH `conflicts` (older: `canonicalState.conflicts`, multiple candidate SOURCES disagreeing
  on one canonical field, e.g. OCR vs. questionnaire - resolved via the pre-existing
  `POST .../workspace/conflict` → `resolveConflict` → `useCanonicalValue()`/amber "Source conflict"
  panel) AND `syncState`/`conflictValues` (newer: Phase 2/3's per-field sync conflict, a fan-out
  wanting to overwrite a field that already has its own independent manual override - resolved via
  `POST .../workspace/field/resolve-conflict` → `resolveFieldConflict` → the red "Conflict detected"
  panel). A field can show both badges/panels at once; the UI renders them as separate, clearly
  distinguished elements rather than merging into one "conflict" concept.
- **Sync state reaches the workspace API and UI (Phase 3 §I.2/§I.3):** `buildFieldView` surfaces
  `syncState`/`conflictValues`; `USCISFormRenderer.jsx`'s `fieldFillTone` and the sidebar badges
  render them (violet "Manual", red "Field Conflict", blue "auto_filled" for SYNCED - reusing the
  existing status-tone palette, no new color system). A permanent CI tripwire
  (`phase3.fanout-invariant.test.js`, runs in both `npm test` and `phase3:verify`) protects this
  chain - and the underlying Phase 2 fan-out guarantee itself - from silent regression in any later
  phase.

**Phase 4 (§H) - mapping-version activation, semantic-type inference, and format transforms** (see
`docs/forms/PHASE4_BASELINE.md` for the full contract, test evidence, and the P4-001..004 ledger
entries):

- **`USCISFormTemplate.formFields[].mappings` can silently go stale if `activeMappingVersionId` is
  never set.** `MappingGraphService.applyGraphToTemplate` (seed-time) writes the freshly-built graph
  onto the template but FALLS BACK to a field's PRIOR `mappings` value whenever the current graph
  doesn't produce an edge for it (`mappingsByTarget.get(fieldId) || plain.mappings || []`).
  `FormMappingService.applyMappingGraph` (runtime), by contrast, only substitutes fresh
  crosswalk-derived mappings when `template.activeMappingVersionId` is set and points at a
  `status:"active"` `USCISMappingVersion` - if unset, runtime resolution silently falls through to
  whatever stale, unreviewed data is already baked onto `formFields[].mappings`, with NO error and
  no visible symptom other than specific fields resolving to the wrong (or blank) value. This was
  P0-CD-001's real root cause on I-130, and the identical gap was independently found and fixed on
  I-129F (P4-003) during this phase's coverage audit. **Any future crosswalk (I-134/I-539/I-539A/
  I-907) must confirm `MappingGraphService.activate()` actually succeeds at seed time and that
  `activeMappingVersionId` ends up set** - this failure mode is silent by construction.
- **`inferTextSemanticType` (`PDFFieldScannerService.js`) no longer treats bare `birth`/`to`/`from`
  substrings as date indicators** (P4-002) - only `date`/`dob`/`expiry`/`expires`/`issued` are
  load-bearing for a real date-of-birth/date-shaped field name in this codebase. A scanned template's
  `semanticType` is set once at import time; this fix does not retroactively correct already-imported
  templates unless they are re-scanned.
- **Format transforms (active as of Phase 4)** - `MappingResolver.applyTransform` recognizes, in
  addition to the pre-existing `boolean`/`date`/`uppercase`/`lowercase`/`direct` cases:
  - `phone` - formats a 10-digit (or 11-digit with a leading `1`) numeric string as
    `(xxx) xxx-xxxx`; passthrough otherwise. **Wired to a real edge**:
    `i129-h1b-crosswalk.js`'s `Line2_DaytimePhoneNumber1_Part8[0]`, after confirming that widget's
    real `validationRules` (`maxLength: 15`, a permissive digits/`+`/`()`/`-`/space/`.` regex)
    actually accommodate the formatted output - verified end-to-end via
    `phase4.semantic-transforms.integration.test.js` (real `FormMappingService.mapTemplate` call, not
    just the unit-level transform).
  - `ssn` (→ `xxx-xx-xxxx`), `alienNumber` (→ `A-xxxxxxxxx`), `uscisReceiptNumber` (passthrough) -
    implemented and unit-tested, but **deliberately NOT wired to any real I-129 field.** The real
    `Line5_SSN[0]`/`Line1_AlienNumber[0]`/`Line10_AlienNumber[0]` widgets have `maxLength: 9` with
    regexes that do not admit the dash/prefix these transforms add - wiring either would overflow the
    widget on the actual generated PDF. These 3 fields remain `MANUAL_ENTRY_FIELDS.
    format_mismatch_confirmed_by_validation` exactly as before Phase 4. See the P4-004 ledger entry -
    the eventual fix for these 3 fields is a digits-only NORMALIZATION transform (strip existing
    formatting, add none back), the opposite direction of `ssn`/`alienNumber` as currently specified.
- **Coverage audit (§I.4):** re-checked all three crosswalks (I-129, I-129F, I-130) against
  `PHASE1_RECONCILIATION.md`'s own categories - 0 dangling-mappings and 0 unmapped-required-fields
  confirmed still true for all three; the only previously-outstanding category (13
  semantic-type-mismatch fields, all place-of-birth/unrelated names misclassified as `"date"`) is
  fully resolved by the P1-002 fix above. I-134/I-539/I-539A/I-907 remain unmapped by design - no
  crosswalk was authored for them this phase (would require attorney sign-off, out of scope).

### 5. Security rules (reaffirmed)

- Never log passwords/tokens/sensitive bodies — confirmed still correctly enforced by `Backend/src/utils/logger.js`'s recursive redaction.
- Enforce authentication + authorization + ownership server-side — this session found three P0 exceptions to that rule (ISSUE-008) that must be closed before they're relied upon as "already enforced."
- DevTools cannot be disabled; security must come from server-side checks, not hidden UI — directly relevant to ISSUE-008, where the gap is server-side, not a UI-hiding problem.

### 6. Target outcome

```
USER ACTION -> ONLY REQUIRED PAGE/API -> ONLY REQUIRED QUERY -> MINIMAL DATA -> UI
```
No unnecessary startup queries. No N+1. No uncontrolled populate. No unnecessary concurrent requests. No sensitive logging. No unverified root-cause claims. No regression of the verified I-129 PDF pipeline. This session's Cases-503, auth-refresh-500, and IDOR findings are the concrete gaps between current code and that target — see the full forensic report (chat transcript, 2026-08-13/14 session) for evidence-cited detail on each.

