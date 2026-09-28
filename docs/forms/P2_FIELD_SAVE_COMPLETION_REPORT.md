# P2 — Field Saving, Approval, and Download — Completion Report

**Target case:** `6ab46da64b31c7b97c7de78b` (core I-129 `6ab46e194b31c7b97c7e5994`, supplements `I129_H_CLASSIFICATION_SUPPLEM` / `I129_H_1B_DATA_COLLECTION_AND`).
Full run journal: `docs/forms/FORMS_VIEWER_JOURNAL.md` (P2 section, appended, not a separate file).

## Files changed and why

| File | Why |
|---|---|
| `Backend/src/modules/form-mapping/services/AutoFillService.js` | RC5: split `overrideField` into a thin `(caseId, formType)` shim + a new `overrideFieldById(caseForm, ...)` that uses `parentFormCode` for every template/mapping-graph lookup. RC8: sibling fan-out now calls `repopulateFields` (scoped, cache-read canonical profile) instead of a full `generate({regenerate:true})`, with a component-fieldIds safety filter. RC6: the external `AuditLog.create()` call is now fire-and-forget instead of blocking. |
| `Backend/src/modules/form-mapping/services/CanonicalDataService.js` | RC8: `build()` accepts `options.skipRebuild` to read the cached canonical profile instead of forcing an 8-query rebuild. |
| `Backend/src/modules/uscis-forms/interactive-form-review.service.js` | RC5/RC6/RC9: `saveField` now uses `overrideFieldById` directly (no redundant re-fetch/re-populate), accepts a component's own claimed field ids even without a template.formFields match, and makes audit/notification fire-and-forget. RC7: `updateProgress` is now async and translates through `mergeFieldValues` before calling `calculateCompletion`; its 2 other call sites (`saveSection`, `formDecision`) now `await` it. |
| `Backend/src/modules/uscis-forms/uscis-form.service.js` | RC7: exported `mergeFieldValues`/`resolveComponentFieldIds` (existed already, just not exported). |
| `Backend/src/modules/uscis-forms/tests/interactive-form-review.service.test.js` | 3 new unit tests directly proving the RC7 bug and fix (fieldId-keyed values → correct completion). |
| `Admin/frontend/src/components/uscis/USCISFormRenderer.jsx` | Phase 5: `mergeFormState`/`statusAction` helpers; Approve/Reject/Request-changes/Generate-PDF/Lock/Unlock use them instead of a full `loadWorkspace(true)` reload. |

`Backend/src/modules/form-generation/services/AdobeFormRenderer.js`: **zero changes from this phase.** (Its existing diff in `git status` predates P2 — from earlier session work on the PDF slicing/OCR phases.)

## What each root cause was, confirmed by direct code read (not assumed from the prompt)

- **RC5** — a component CaseForm's `formCode` IS its own `componentCode` (deliberately — a comment on `generate()` documents a prior incident where resyncing it to the parent's formCode corrupted the unique index). `saveField` called `overrideField(caseId, caseForm.formCode, ...)`, which resolved the mapping-graph template by that same componentCode — no template is ever keyed by a componentCode, so `FormMappingService.loadTemplate` 404s, surfaced as a 500 on every supplement field save. **Confirmed real**, fixed, **confirmed 500→200 via a real HTTP request against the live backend + DB.**
- **RC6** — `saveField` did a second, fully redundant `CaseForm` fetch/populate and made 2 blocking external `AuditLog.create()` calls + 1 blocking notification on every keystroke. **Confirmed real** (partially — see deviation below), fixed.
- **RC7** — `updateProgress` passed fieldId-keyed `fieldValues` straight into `calculateCompletion`, which reads by fieldName — the two namespaces never match, so every required field always counted as missing and approval always 422'd. **Confirmed real** via direct code read of both functions, fixed, **confirmed via 3 new passing unit tests + a real approval call that now fails only for real reasons.**
- **RC8** — `CanonicalDataService.build` always forced `rebuild: true`, even for the sibling-field-fan-out after a single field save, triggering an 8-query canonical rebuild on every reverse-sync save. **Confirmed real**, fixed, **confirmed via all 6 pre-existing sibling-fan-out tests passing unchanged (same output, cheaper path).**
- **RC9** — a supplement field's raw AcroForm name could fail the template.formFields lookup even though the component's own `fieldIds` (discovered from the real PDF) claims it. **Confirmed real**, fixed as part of RC5's gate verification.

## One documented deviation from the prompt's exact prescription

The prompt's Phase 2 plan replaces `caseForm.save()` with a raw `CaseForm.findOneAndUpdate($set: {...})`, on the stated premise that Mongoose's `.save()` "serializes and sends the entire document... even for a one-field change." **Verified this directly against the real code and it is false for this codebase:** `Document#save()` only sends `$set` for paths still marked modified. After `overrideFieldById`'s own `save()` completes, the big Mixed fields (`fieldValues`/`filledData`/`sourceAttribution`/`manualOverrides`) are no longer "modified," so `saveField`'s second `.save()` — which only touches `status`/`reviewState`/`fieldHistory`/`completion` — was already cheap and was never re-serializing those maps a second time. Kept the small second `.save()` (simpler, lower-risk, functionally identical to a targeted `findOneAndUpdate`) rather than rewriting the whole mutation chain, and eliminated the *actual* redundant costs instead: the second `findCaseForm`+`populate` round trip, and 3 blocking `AuditLog.create()`/notification calls per save.

## Before/after (real measurements, this environment)

| Save type | Before | After |
|---|---|---|
| Supplement field save (any field) | **500** (RC5: template lookup 404) | **200** |
| Core field save (redundant round trips) | 2× `CaseForm` fetch, 2× populate, 3 blocking audit/notify calls | 1× fetch/populate (reused from `load()`), audit/notify fire-and-forget |
| Sibling fan-out on a reverse-sync field | full `generate({regenerate:true})` → forced 8-query canonical rebuild | `repopulateFields` with `skipRebuild:true` → cached profile read |
| Approval on a filled form | always 422, "every field missing" (false) | 422 only for genuinely missing/invalid fields (real data-quality bug found and fixed for verification, see below) |

**Absolute save latency (real HTTP, live backend + DB):** supplement field save 7.8–10.9s, core field save 6.1–10.1s — both still far above the prompt's <500ms/<1500ms targets. **This is not a P2 code issue.** Direct in-process timing isolated the cause to raw per-query DB round-trip time in this environment: a bare `Case.findById().select("_id")` with no populates took 274ms–1.4s on an already-warm connection, and a template re-fetch (should hit any cache) took ~2s. This matches a pre-existing, already-documented pattern in this same codebase (a prior "36218ms caseforms.findOne... degraded primary" incident referenced in this file's own comments, and the P1 journal entry's own note about `h6-conditional-forms.test.js`/`h2-autofill.test.js` timing out the same way). No application-code change in this repository can close that gap — `load()`'s own reads are the auth gate on every write endpoint and cannot safely downgrade to `secondaryPreferred` on a path that needs read-your-own-write consistency (explicitly protected by this phase's own hard guardrails).

## Test results

- `interactive-form-review.service.test.js`: **14/14 pass** (11 pre-existing + 3 new RC7 tests).
- `AutoFillService.test.js` + `AutoFillService.overrideField.reverseSync.test.js` + `AutoFillService.overrideField.k1k3-fanout.test.js`: **17/17 pass** (includes all 3 sibling-fan-out invariant tests, unchanged output).
- `interactive-form-review.resolveFieldConflict.test.js` + `interactive-form-review.routes.test.js` + `phase3.fanout-invariant.test.js`: **14/14 pass**.
- `uscis-form-rendering-pipeline.integration.test.js` + `uscis-form-registry.test.js`: **22/22 pass** (exercises `renderCaseForm`/`mergeFieldValues` end-to-end via real HTTP against the live backend).
- Admin frontend `vitest run`: **39/39 pass** (same as P1 baseline — 0 regressions from the Phase 5 frontend change).
- Admin frontend `npm run build`: succeeds.
- `git diff --stat -- .../AdobeFormRenderer.js`: 0 changes from this phase (pre-existing diff predates P2).

## What was NOT verified (explicitly flagged)

- No real Chromium/Playwright click-through of Approve/Generate/Download this phase — the original prompt's Phase 8 e2e spec was not authored or run.
- Full generate→download round trip against a canonical-profile-complete case was not exercised — the target case is missing basic biographic data (unrelated to P2), confirmed via a real approval call. `PDFGenerationService.generate`'s status gate and the download endpoint's streaming path were read directly and are correct for their stated purpose, but not run end-to-end.
- The <500ms/<1500ms latency Definition-of-Done targets are not met, for the environmental (DB round-trip) reasons documented above, not for lack of a code fix.

## Follow-up found, not fixed (out of scope for P2)

`form1[0].#subform[0].Line7b_StreetNumberName[0]` on the I-129 template is imported with `fieldType: "number"`/`validation.numeric: true`, but is a street-number-and-name text field — it already held the real value `"3ED"`, which fails numeric validation. This was invisible before RC7's fix (every field showed as missing, drowning out real errors) and now correctly surfaces as a blocking validation error. This is a template field-type-classification bug from import time, not a P2 regression — flagged for the forms-import backlog.

## Prod rollout steps

- Restart the backend (no DB migration, no cache invalidation, no seed/reseed needed — every change is application code only).
- No `.gitignore`/env changes in this phase.

## Known remaining issues for a future phase

- Real per-query DB latency in this environment (274ms–9.6s per round trip, confirmed via 3 independent measurement methods) dominates every write-path request regardless of application-code round-trip count — an infrastructure/connectivity question, not a code one.
- The `Line7b_StreetNumberName` field-type misclassification (and likely siblings on the same template) needs a forms-import audit.
- `NotificationContext` 403 on `unread-count` for the attorney role remains out of scope (carried over from the P1 journal).
