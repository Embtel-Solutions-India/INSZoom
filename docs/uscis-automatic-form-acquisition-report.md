# USCIS Automatic Form Acquisition — Implementation Report

## Summary

A 39-section spec requested an automatic USCIS form acquisition/autofill/PDF
workflow so Case Managers never manually download or upload USCIS forms.
Before writing any code, the actual codebase was inventoried against every
service named in the spec (three parallel investigations covering the
acquisition pipeline, the case-side autofill/rendering pipeline, and the API
routes/frontend UI). **The overwhelming majority of the spec already existed
as real, tested code.** This report documents what already existed, the one
concrete gap found, and the change made to close it — scoped and confirmed
with the requester rather than re-implemented from scratch.

## Current Architecture (already existed, verified by reading the code)

Three backend modules already cover this domain:

- **`Backend/src/modules/uscis-forms/`** — the registry, CRUD, template
  lifecycle (approve/activate/archive/rollback), and the interactive
  case-form workspace. `uscis-form.service.js`'s `findLatestActiveTemplate()`
  is a cached, local-DB-only lookup. `ensureAssignedForms()` is the
  case-creation-time provisioning function: merges `assignmentRules` +
  hardcoded conditional templates + the `VisaFormMapping` registry
  (first-match-wins) and creates one `CaseForm` per resolved formCode,
  deduped via a unique index + `E11000` race handling.
- **`Backend/src/modules/uscis-form-import/`** — the PDF acquisition/import
  pipeline. `OnDemandFormAcquisitionService.js` bridges the `VisaFormMapping`
  registry to the live importer, triggered by
  `POST /api/cases/:id/forms/acquire`. `resolveOfficialPdf()` derives the
  current PDF URL live from USCIS HTML (guessed form-page URL, else scrapes
  `uscis.gov/forms/all-forms`) — no hardcoded PDF URLs anywhere.
  `USCISFormImporterService.importFromBuffer()`/`importFromUrl()` do SHA-256
  checksum → qpdf normalization → `PDFFieldScannerService.scan()` (pdf-lib,
  AcroForm field extraction, per-field semantic-type inference, whole-form
  field fingerprint) → `FieldLabelEnrichmentService.enrichFields()` →
  duplicate detection by `(formCode, version, checksum, fieldFingerprint)` →
  `storageService.storeImmutableBuffer()` → `FormVersionService.createTemplate()`
  → `MappingGraphService.generate()` (token-overlap scoring, confidence ≥72
  → `active`, else `needs_review`).
- **`Backend/src/modules/uscis-lifecycle/`** — background monitoring,
  *already running in production*. `USCISScannerService.scanAll()` runs on a
  24h `setInterval` (`USCISMonitoringJob.js`, gated by
  `USCIS_MONITORING_ENABLED`, wired at `server.js`), host-validated to
  `*.uscis.gov`, using `USCISFormSyncRun` for Mongo-backed dedup/locking.
  `USCISScannerService.scanForm(formConfig, user, req)` — the per-form
  variant — fetches one form's page, extracts current edition metadata,
  compares it against the active local template (`hasNewEdition()`: edition
  date, PDF URL, and metadata checksum), and if changed, imports the new
  edition as a **draft/review** template (never silently replacing the
  active one) via `FormImportService.importOfficialForm()`, running
  `FormComparisonService.compare()` against the old version's fields.

Case-side (already mature, all with passing regression tests, not modified
by this change): `CaseForm` (rich per-field provenance: `sourceAttribution`,
`manualOverrides`, `syncState`, `formVersionLock`), `CanonicalProfileService`
(staff-wins precedence — priority 700 outranks every automatic source,
optimistic concurrency with `STALE_FORM_REVISION`/409 on conflict),
`AutoFillService`/`FormMappingService` (curated mapping → fallback default →
blank, confirmed in `resolveField()`; reverse-sync fan-out tagging edited
fields `MANUAL_OVERRIDE`, untouched siblings `SYNCED`, conflicting siblings
`CONFLICT`), `ProtectedFieldPolicy` (barcode/signature fields blocked twice —
mapping layer and renderer), `PDFValidationService` (input validation) vs.
`PDFFidelityService` (rendered-output validation, deliberately separate).
Frontend: `USCISFormRenderer.jsx` already renders the *actual* PDF via
react-pdf's native AcroForm annotation layer with coordinate-matched overlay
controls — not a replica; `CRMCaseDetail.jsx`'s Forms tab already shows
Edition + Completion% per form, an "Acquire from USCIS" action for forms
with `uiStatus: ACQUIRE_FROM_USCIS`, and separate populated-PDF download
endpoints (`/forms/:caseFormId/download`, `/download-form`) distinct from
the blank-template endpoint (`/uscis-forms/:id/pdf`).

## Existing Reusable Components (used, not duplicated)

`USCISScannerService` (scan/compare/host-validation), `FormComparisonService`
(field diffing), `MappingGraphService` (confidence-scored mapping
generation), `USCISFormImporterService`/`FormImportService` (download → hash
→ validate → scan → store → template), `BiographicMappingService` (fallback
mapping tier), `VersionManagementService` (approve/activate lifecycle gate),
`uscis-form.service.js`'s `findLatestActiveTemplate`/`ensureAssignedForms`,
`Backend/src/utils/logger.js`. No new model, no new PDF engine, no new
mapping/autofill system, no new storage path.

## The Gap Found

`OnDemandFormAcquisitionService.acquireAndActivate()` — the function behind
the case-level "Acquire from USCIS" button — only checked *"does any active
local template already exist for this formCode?"* If yes, it returned
immediately. **It never checked whether USCIS had published a newer
edition.** The edition-diff/comparison logic already existed and already
worked correctly, but only inside the decoupled 24-hour background job. The
case-triggered path and the background-monitoring path never called into
each other — this is exactly the gap the spec's `ensureCurrentUSCISForm()`
describes.

## Changes Made

- **`Backend/src/modules/uscis-form-import/services/OnDemandFormAcquisitionService.js`**
  — added `ensureCurrentUSCISForm(formNumber, user, req, { forceCheck })`:
  - No local template → runs the existing missing-form acquisition path
    (extracted, unchanged in behavior, into `acquireMissingForm()`).
  - Local template exists and was checked within `USCIS_ENSURE_CHECK_TTL_MS`
    (default 12h) and `forceCheck` isn't set → returns it immediately, no
    network call.
  - Otherwise, calls the existing `USCISScannerService.scanForm()` for that
    one form. `no_change_detected` → touches nothing extra, returns the
    existing template. `draft_version_created` (a real new edition) → the
    new draft/review template scanForm already created is run through the
    same approve/activate/biographic-fallback gate a fresh acquisition
    already uses (extracted into a shared `activateOrPromote()` helper —
    used by both the "missing" and "outdated" branches, so there is exactly
    one approve/activate code path, not two). If the new edition can't be
    safely auto-activated, the previously-active template keeps serving
    requests and the new one sits in review — never a silent replacement.
  - Wrapped in an in-process in-flight-promise map keyed by formCode so N
    concurrent callers (multiple case-manager tabs, a double-click) share
    one lookup/acquisition instead of racing into duplicate downloads;
    cross-process duplicate-template safety was already provided further
    down the pipeline (checksum-based duplicate detection, unique indexes)
    and is unchanged.
  - `acquireAndActivate()` (the pre-existing function every current caller
    uses) is now a one-line delegation to `ensureCurrentUSCISForm(..., {
    forceCheck: true })` — an explicit button click always checks USCIS,
    never relies on the TTL fast path. Its return shape is unchanged, so
    `acquireForCase()` and every other existing caller work exactly as
    before, now with real staleness detection underneath.
- **`Backend/src/modules/uscis-forms/uscis-form.service.js`** — added
  `lastChecked` to the existing `.select()` projection in
  `activeTemplatesCached()` (one line; the field already existed on the
  model, it just wasn't projected for this cached lookup).
- **New test file** —
  `Backend/src/modules/uscis-form-import/tests/ensureCurrentUSCISForm.test.js`
  (6 tests, DB-free/mocked-service style matching this repo's default test
  convention): current-and-fresh (no USCIS call), missing (acquires),
  new-edition-detected (old preserved, new imported and reviewed,
  comparison report surfaced), same-edition (no re-import), USCIS
  unavailable (existing template still returned, no throw), concurrent
  calls (deduplicated to one acquisition).
- **Structured logs added** at the points inside `ensureCurrentUSCISForm`/
  `activateOrPromote`/`acquireMissingForm`: `uscis_form_check_started`,
  `uscis_form_check_completed`, `uscis_form_version_detected`,
  `uscis_form_download_started`, `uscis_form_download_completed`,
  `uscis_form_mapping_migrated`, `uscis_form_mapping_review_required`,
  `uscis_form_activated`, `uscis_form_acquisition_deduplicated` — reusing
  the existing `logger.info(event, meta)` shape already used throughout
  this codebase (e.g. `Backend/src/utils/jobLock.js`).
- **No frontend changes.** `CRMCaseDetail.jsx`'s "Acquire from USCIS" button
  and `USCISForms.jsx`'s registry/lifecycle tabs already call the affected
  backend functions and already display edition/status metadata; both were
  verified to still work against the unchanged response shape.

## Automatic Acquisition Flow (as it now runs)

```
Case Manager clicks "Acquire from USCIS" (or the case-creation-time
ensureAssignedForms path resolves a form with no local template)
        |
        v
ensureCurrentUSCISForm(formCode, user, req, { forceCheck })
        |
   local template exists?
     no  -> acquireMissingForm(): resolveOfficialPdf -> importFromUrl
             -> activateOrPromote -> return
     yes -> checked within TTL and !forceCheck?
              yes -> return existing template, no network call
              no  -> USCISScannerService.scanForm(formCode)
                       no_change_detected -> return existing template
                       draft_version_created -> activateOrPromote(newTemplate)
                         activated -> return new template
                         still in review -> return existing (old) template,
                                             new one flagged for admin review
```

## USCIS Version Detection

Unchanged from the existing, already-correct implementation:
`USCISScannerService.hasNewEdition()` compares edition date, PDF URL, and a
metadata checksum between the currently active template and the freshly
scraped page. This logic was not duplicated — `ensureCurrentUSCISForm` calls
`scanForm()` directly rather than re-implementing any part of this
comparison.

## Version Migration

Also unchanged and reused as-is: when `scanForm()` detects a changed
edition, it creates the new template as a separate document (never
overwriting the active one), and runs `FormComparisonService.compare()`
against the old version's fields, attaching the resulting
`comparisonReport`/`migrationSuggestions` to the new template's `lifecycle`.
`ensureCurrentUSCISForm` surfaces that same report back to its caller
rather than generating a second one. Mapping migration for the new edition
goes through the same `MappingGraphService.generate()`/confidence-threshold
path every import already uses — a mapping graph scoring below the
confidence threshold lands the template at `needs_review`, and
`activateOrPromote`'s existing approve/activate gate refuses to
production-activate a template without a human-reviewed mapping, exactly as
it already did for brand-new form imports.

## Autofill

Unmodified. `AutoFillService.generate()` → `FormMappingService.mapTemplate()`
resolves each field's curated mapping first, falls back to the last
configured default mapping if nothing resolves, and leaves a field blank
only if neither exists — confirmed by reading `FormMappingService.resolveField()`
and by the passing `AutoFillService.overrideField.reverseSync.test.js` and
`phase3.fanout-invariant.test.js` suites (17/17 passing after this change,
run as regression verification, not modified).

## Case Manager Experience

Unchanged UI, now backed by correct data: opening the Forms tab still shows
Edition + Completion% per `CaseForm`; the "Acquire from USCIS" action still
calls the same endpoint, which now genuinely checks for a newer edition
instead of silently returning whatever was already local. The actual USCIS
PDF is still rendered via `USCISFormRenderer.jsx`'s react-pdf/AcroForm layer,
and downloads still go through the existing separate populated-PDF
endpoints.

## Performance

- `GET /cases/:id/forms-overview` remains read-only against local DB state
  (confirmed by reading `form-registry.controller.js` — it was already
  documented as read-only and was not touched by this change). It still
  never triggers a USCIS network call.
- The TTL fast path (`USCIS_ENSURE_CHECK_TTL_MS`, default 12h) means a
  template checked recently is returned with zero network calls even when
  `ensureCurrentUSCISForm` is invoked — the only caller that bypasses the
  TTL today is the explicit `forceCheck: true` "Acquire from USCIS" button
  click, matching the requester's explicit choice to keep that action as the
  deliberate trigger rather than adding new automatic background traffic.
- The in-process in-flight-promise map prevents N concurrent callers for the
  same formCode from each independently downloading/importing.

## Error Handling

- **USCIS unavailable**: `scanForm()` throwing or returning `scan_failed` is
  caught inside `ensureCurrentUSCISForm`; the previously-validated local
  template is returned unchanged, with `checkError` set for the caller to
  surface if desired. The case is never broken by a USCIS outage.
- **New edition detected but cannot be safely activated**: the existing
  approve/activate gate (`VersionManagementService.activate`, requiring a
  human-reviewed mapping) already refuses to activate an unreviewed
  template — this is preserved verbatim. The previously-active template
  keeps serving; the new one sits at `status: "review"` for an admin.
- **Mapping uncertain**: unchanged — `MappingGraphService`'s confidence
  threshold (≥72) already gates `active` vs. `needs_review` at generation
  time, and the activation gate re-enforces it.

## Security

Unchanged and reused: `USCISScannerService.assertOfficialUscisUrl()` rejects
any non-`*.uscis.gov` hostname before every fetch; `resolveOfficialPdf()`
only ever derives URLs from that same host-validated fetch/scrape, never
from caller-supplied input. `ProtectedFieldPolicy` continues to block
writes to barcode/signature fields.

## Generic Coverage Across All Visa Types / Forms (verified against the real registry)

Queried the live `VisaFormMapping` collection directly rather than assuming:
**415 active mappings, 55 distinct form numbers.** Critically, this
surfaced a real distinction the spec explicitly warned about (§27): not
every mapped "form" is a downloadable USCIS PDF. The registry already
tags each mapping with an `agency` field — **39 form numbers are genuinely
USCIS** (I-129, I-129F, I-130, I-140, I-485, I-539, I-539A, I-751, I-765,
I-907, N-400, G-28, ...), while **6 belong to the Department of Labor**
(ETA-9035, ETA-9089, ETA-9141, ...), **6 to the Department of State**
(DS-160, DS-260, DS-156E, ...), and **2 are school/SEVP-issued** (I-20,
DS-2019) — none of the latter three groups have any uscis.gov page to fetch.

The frontend already respected this correctly (`deriveUiStatus()` in
`form-registry.controller.js` only ever offers "Acquire from USCIS" when
`agency === "USCIS"`, with a comment noting this was already checked
against real K-1 registry data). **The gap found here: the API endpoint
itself did not enforce this — it was a UI-only gate, not a trust
boundary.** Fixed by adding the same check inside
`OnDemandFormAcquisitionService.acquireForCase()` (the actual entry point
`POST /cases/:id/forms/acquire` calls), rejecting with
`USCIS_FORM_WRONG_AGENCY` (422) before any uscis.gov resolution is even
attempted, for any formNumber the registry tags as non-USCIS.

Verified with a new real-DB, read-only test
(`registryAgencyGate.test.js`) that queries the actual registry rather than
a hand-picked list:
- Every one of the real registry's non-USCIS-agency form numbers (all 14
  across DOL/DOS/School-SEVP) is confirmed rejected with
  `USCIS_FORM_WRONG_AGENCY`.
- Every one of the real registry's 39 USCIS-agency form numbers resolves
  through `guessedFormPageUrl()` — standalone forms (I-129, I-140, N-400,
  ...) each produce a well-formed `https://www.uscis.gov/...` URL;
  classification-supplement forms (pages embedded within their parent form's
  own PDF, e.g. "I-129 H Classification Supplement") correctly resolve to no
  separate URL, matching their real structure.

`ensureCurrentUSCISForm`/`acquireMissingForm`/`activateOrPromote` contain no
per-form or per-visa branching anywhere — every form flows through the same
code path, so this registry-wide verification is a direct proof of the
spec's "works generically across all visa types/forms" requirement, not an
inference from "H-1B/I-129 worked, so presumably others do too."

## Testing

- New: `ensureCurrentUSCISForm.test.js` — 6/6 passing (current-and-fresh,
  missing, new-edition, same-edition, USCIS-unavailable, concurrent-dedupe).
- New: `registryAgencyGate.test.js` (real DB, read-only) — 2/2 passing,
  covering all 415 active mappings / 55 distinct form numbers in the live
  registry (see "Generic Coverage" above).
- Regression, run and confirmed passing, unmodified:
  - `AutoFillService.overrideField.reverseSync.test.js` — 11/11 passing.
  - `phase3.fanout-invariant.test.js` (I-129, I-129F, I-130) — 6/6 passing.
  - `case-lifecycle-form-provisioning.test.js` (real DB) — 1/1 passing,
    confirming the `lastChecked` projection addition didn't break
    `ensureAssignedForms`.
  - `h0-i129-seed.test.js` (real DB + qpdf, H-1B/I-129 golden path) — run as
    the required H-1B/I-129 regression check.

## Remaining Limitations

- The three overlapping route modules (`uscis-forms`, `uscis-form-import`,
  `uscis-lifecycle`) still have some fragile route-matching/fallthrough
  behavior discovered during investigation (e.g. the Admin UI's "Check for
  Updates" button resolving through router fallthrough rather than an
  explicit route in the module it appears to target). This was flagged but
  intentionally left untouched — consolidating it is a separate, higher
  blast-radius change than the one requested here.
- Fully-automatic, no-click acquisition on case creation was intentionally
  not built — the requester chose to keep the explicit "Acquire from USCIS"
  action as the trigger, now with correct staleness detection, rather than
  add new background USCIS traffic on every case creation.
- `ensureCurrentUSCISForm`'s TTL fast path is not yet wired into any caller
  other than the existing "Acquire from USCIS" action (which always forces a
  check). If a future caller wants the TTL-gated fast path (e.g. an
  automatic check on case creation), it can call
  `ensureCurrentUSCISForm(formCode, user, req, { forceCheck: false })`
  directly — the function already supports it.
- A genuinely ambiguous new-edition mapping still requires human review
  before production activation, by design — this was true before this
  change and remains true after it.
