# USCIS Forms Viewer — Run Journal

Cumulative journal across every phase of the forms-viewer initiative (P1, and
future problems). One file, appended to, never split per phase.

---

## P1 — Viewer Rendering Fix (RC1–RC4)

**Target:** case `6ab46da64b31c7b97c7de78b`, CaseForm `6ab46e194b31c7b97c7e5994` (I-129 core) + its 2 real component CaseForms on this case (`I129_H_CLASSIFICATION_SUPPLEM`, `I129_H_1B_DATA_COLLECTION_AND`), plus I-907 and I-539 on the same case.

### Phase 0 — Baseline

Queried the target case directly from Mongo (see conversation for full dump). Confirmed:
- Core I-129 CaseForm `6ab46e194b31c7b97c7e5994`, template `6a8e07e164c23fe108954e92`, `pdfMetadata.pageCount: 38`.
- Two real component CaseForms on this case: `I129_H_CLASSIFICATION_SUPPLEM` (pages 13-20) and `I129_H_1B_DATA_COLLECTION_AND` (pages 21-23).
- 9 total ACTIVE `USCISFormComponentDefinition` rows on the I-129 template (the other 7 have no CaseForm on this specific case).
- One already-poisoned cache entry found: `I129_H_1B_DATA_COLLECTION_AND`'s `slicedPdfStorageKey` was set from a prior (pre-fix) request.

Wrote `Backend/scripts/verifyViewerPdf.js` (read-only diagnostic, supports `--recipe=legacy` to reproduce the pre-fix `getComponentPdf` sequence exactly, for real side-by-side before/after evidence without checking out old code).

**Baseline run (`--recipe=legacy`, all 9 components), real Adobe API:**

All 9 components: **FAIL**. Every single one shows the exact reported symptom — page 1 of the slice keeps ~4 widgets, every subsequent page keeps **zero**. Full per-page detail in `docs/forms/p1-viewer/G1-legacy-baseline.txt`; representative row (H Classification Supplement, pages 13-20):

| parentPage | slot | parentWidgets | barcodeWidgets | viewerWidgets (legacy) | expected |
|---|---|---|---|---|---|
| 13 | 1 | 31 | 1 | 4 | 30 |
| 14 | 2 | 16 | 1 | 0 | 15 |
| 15 | 3 | 21 | 1 | 0 | 20 |
| 16 | 4 | 24 | 1 | 0 | 23 |
| 17 | 5 | 15 | 1 | 0 | 14 |
| 18 | 6 | 17 | 1 | 0 | 16 |
| 19 | 7 | 29 | 1 | 0 | 28 |
| 20 | 8 | 14 | 1 | 0 | 13 |

Root cause confirmed exactly as diagnosed (RC2): `getComponentPdf` never called `flattenBarcodeAppearances` before `AdobePdfService.slicePdf` — and this session had already independently proven (Adobe-Native Form Slicing task, same session) that without a `removeField()` call happening on the source before Adobe's `combinepdf`, the API keeps `/AcroForm` but drops ~97% of the real widgets. The download path (`AdobeFormRenderer.js`) already ran that step; the viewer path did not.

### Phase 1 — `ViewerPdfPreparationService.js`

Created `Backend/src/modules/form-generation/services/ViewerPdfPreparationService.js`: shared `prepareViewerPdf({rawBuffer, template, pagesToKeep})`, mirroring the download path's proven sequence (flatten barcode → disable empty rich text → purge XFA → save → Adobe slice → repair `/Fields` from surviving widgets), with an automatic pdf-lib `keepOnlyPages` fallback (Strategy B) if Strategy A's parity check fails, and a hard `VIEWER_PDF_PARITY_FAILED` throw if both fail (never serves a bad slice). `toAdobeRanges` moved here out of `AdobeFormRenderer.js` (which now imports it) so there is exactly one implementation.

Wired into `getComponentPdf` (component viewer) and added `?purpose=viewer` handling to `getTemplatePdf` (full/core viewer) — the default (no `purpose`) response is byte-identical to the stored artifact, proven by a dedicated test. Cache freshness now also requires `slicedPdfRecipeVersion === VIEWER_PDF_RECIPE_VERSION` (currently `2`), so a code fix alone invalidates every previously-poisoned cached slice.

**G1 — current recipe, real Adobe API, all 9 components + core:**

All 10: **PASS**. Representative row (same H Classification Supplement):

| parentPage | slot | parentWidgets | barcodeWidgets | viewerWidgets (current) | expected | result |
|---|---|---|---|---|---|---|
| 13 | 1 | 31 | 1 | 30 | 30 | PASS |
| 14 | 2 | 16 | 1 | 15 | 15 | PASS |
| 15 | 3 | 21 | 1 | 20 | 20 | PASS |
| 16 | 4 | 24 | 1 | 23 | 23 | PASS |
| 17 | 5 | 15 | 1 | 14 | 14 | PASS |
| 18 | 6 | 17 | 1 | 16 | 16 | PASS |
| 19 | 7 | 29 | 1 | 28 | 28 | PASS |
| 20 | 8 | 14 | 1 | 13 | 13 | PASS |

Full output: `docs/forms/p1-viewer/G1-current.txt`. All 9 components used Strategy A (`adobe_combine`) — the pdf-lib fallback (Strategy B) was never needed in practice.

### Phase 2 — Workspace `pageMap`

`interactive-form-review.service.js`'s `open()` now calls a new, dependency-injectable static `resolveViewerPageConstraint()` (+ `resolveTemplatePageCount()`), returning `pageMap` (slot → parentPage) for every constraint type, `pdfSource`, and `expectedPdfPageCount`. A component constraint failure now returns `{type: "component", error: {...}}` — it never silently degrades to `{type: "full"}` (the old behavior, which was itself a second failure mode: a supplement showing the entire 38-page parent).

5 new node:test cases added to the existing `interactive-form-review.service.test.js` (component slot remap, core identity subset, full-form identity, missing-`pdfMetadata` fallback chain, component-failure-never-degrades-to-full). **11/11 pass** (6 pre-existing + 5 new).

### Phase 3 — Cache invalidation

`Backend/scripts/invalidateComponentSliceCache.js` (`--dry-run` default, `--apply`): non-destructive `$set`/`$unset` of only the 4 slice-cache fields on `USCISFormComponentDefinition`, filtered on `slicedPdfRecipeVersion !== 2`. Never deletes a document, never touches `pageRanges`/`fieldIds`/`status`, never deletes S3 objects.

Run on dev:
- Dry run found exactly 1 stale entry — `I129_H_1B_DATA_COLLECTION_AND`'s poisoned cache from Phase 0.
- `--apply` cleared it (`matched=1 modified=1`).
- Re-run of the dry run: **0** stale entries. G3 confirmed.

### Phase 4 — Frontend slot/parentPage mapping

Created `Admin/frontend/src/components/uscis/viewerPageSlots.js` (`buildPageSlots`, `pageMismatch`). Wired into `USCISFormRenderer.jsx`: `pageSlots` replaces the old single `pageNumbers` list; `PdfFormPage` now takes separate `pdfPageNumber` (drives `<Page pageNumber>`) and `displayPageNumber` (drives the DOM id, label, and `registerPageRef`/`scrollToPage` key — all of which stay keyed by the official parent page number, unchanged for every other consumer). Captured the `X-Viewer-Page-Map` response header into `headerPageMap` state. `componentCode` selection now reads `viewerPageConstraint.pdfSource === 'component'` (was `type === 'component'`; equivalent today, more correct going forward). Added an amber banner for `viewerPageConstraint.error` / `pageMismatch()`.

7 new vitest cases (`viewerPageSlots.test.js`) + existing `USCISFormRenderer.test.jsx` updated for the renamed props. **15/15 + 7/7 pass.**

### Phase 5 — First-paint values (RC4)

Confirmed against the real installed `pdfjs-dist` source (not assumed): `AnnotationStorage` is keyed by per-widget **annotation id** (e.g. `"1234R"`), never by field name — `annotationStorage.setValue(fieldName, ...)` was a silent no-op against a real PDF. Added `buildWidgetIndex`/`prePopulateById` to `PDFFieldChangeAdapter.js` (resolves name → widget ids via `pdfDocument.getFieldObjects()`, writes per pdf.js's own per-type contract: text/choice `{value: String}`, checkbox `{value: v===exportValue||v===true}`, radio `{value: String(v)===String(exportValue)}` — verified against `annotation_layer.js`'s own `render()` for each widget class). `prePopulateFields` kept as a deprecated no-op (no other real callers found). `handlePdfLoadSuccess` now awaits `getFieldObjects()` before marking `annotationsReady`; `<Document>` children only render once `annotationsReady` is true; `PdfFormPage` also re-syncs on `onRenderAnnotationLayerSuccess` (not just `onRenderSuccess`, which fires on canvas completion, before the annotation-layer DOM exists).

11 new/updated vitest cases in `PDFFieldChangeAdapter.test.js`. **11/11 pass.**

### Phase 6 — Playwright e2e

Created `Admin/frontend/e2e/uscis-viewer-pagination.spec.js` — resolves the target case's real CaseForms dynamically via the API (never hardcoded), logs in as the existing e2e fixture `admin` user (`fixtures.js`'s `loginAs`/`apiLogin` — no manual credentials needed), opens each one for real in Chromium, and asserts: no "Invalid page request" console warnings, no "Unable to render page" nodes, no barcode field exposed as an editable annotation-layer input, and rendered page count matches the workspace's own resolved page-slot count.

Real issues found and fixed in the **spec itself** during this phase (logged for transparency, none were bugs in the actual fix):
1. Wrong dev-server port — my own throwaway frontend instance landed on 3003 (3002 already running); the backend's CORS only allows the expected origin, so login silently failed. Fixed by pointing at the already-running 3002 instance instead of starting a second one.
2. `tr:has-text("I-129")` matched 3 rows (every I-129-family CaseForm shares the same template title, which itself contains "I-129") — fixed to an exact-text match on the formCode cell.
3. A combined CSS+`text=` selector string passed to `waitForSelector` failed to parse and was silently swallowed by a `.catch()`, making every wait resolve almost instantly instead of actually waiting — replaced with `Locator.or()`.
4. The generic "close/back" button regex matched the page's own unrelated "Back to Cases" breadcrumb instead of the viewer's real `aria-label="Back to forms"` close control, navigating away from the case entirely after the first form — fixed to the exact aria-label.
5. One genuine test-authoring mistake, not a product bug: asserted the I-129 **core** form should render 38 pages. It renders 8 — correct, since `resolveCorePages` subtracts every registered supplement's pages from the 38-page parent (2+2+8+3+4+3+1+5+2 = 30 supplement pages; 38−30 = 8), a fact already established earlier in this same session. Fixed the assertion to compare against the workspace's own `pageMap.length` instead of assuming full-parent page count.

**Final 2 consecutive runs, real Chromium against the real backend/DB, `--retries=0`:**

| CaseForm | expected rendered pages | actual | Invalid-page warnings | "Unable to render" | barcode exposed as widget |
|---|---|---|---|---|---|
| I-129 (core) | 8 | 8 | 0 | 0 | 0 |
| I129_H_1B_DATA_COLLECTION_AND | 3 | 3 | 0 | 0 | 0 |
| I129_H_CLASSIFICATION_SUPPLEM | 8 | 8 | 0 | 0 | 0 |
| I-907 | 7 | 7 | 0 | 0 | 0 |
| I-539 | 7 | 7 | 0 | 0 | 0 |

Both runs: **1 passed**, identical results. Screenshots in `Admin/frontend/e2e/screenshots/p1-viewer-*.png` — the H Classification Supplement screenshot additionally shows, without any test interaction: the correct parent page label ("Page 13"), the real "H Classification Supplement to Form I-129" heading, and pre-filled field values ("3ertg", "Ishaan") visible on first paint.

### Phase 7 — Regression

- `git diff --stat -- Backend/src/modules/form-generation/services/` → only `AdobeFormRenderer.js`, and only a 22-line net change (the `toAdobeRanges` function body replaced by an import — zero logic changed). Confirms the download path's own file was not touched beyond that relocation.
- Re-ran the real download path (`AdobeFormRenderer.renderFiling`) for the H Classification Supplement CaseForm against the real Adobe API: **8 pages / 159 fields / engine "adobe"** — identical to every measurement earlier this session, before any P1 change.
- Backend regression suite (16 files spanning every module touched this session): **75/76 pass.** The 1 failure (`h6-conditional-forms.test.js`) is a file this session never touched (confirmed via `git status`/`git log`), timed out at the same real-remote-DB-latency pattern already observed and documented twice earlier this session (`h2-autofill.test.js`) — not a P1 regression.
- Admin frontend: `npx vitest run` → 5 files, **39/39 pass**. `npm run build` → succeeds. `npm run lint` → pre-existing gap, no ESLint config file exists anywhere in this project (confirmed: no `.eslintrc*`/`eslint.config.*`); not something P1 introduced or can fix within its own scope.

---

## P2 — Field Saving, Approval, and Download (RC5-RC9)

**Target:** same case `6ab46da64b31c7b97c7de78b`. Core I-129 CaseForm `6ab46e194b31c7b97c7e5994`, supplements `I129_H_CLASSIFICATION_SUPPLEM` (`6ab46e1b4b31c7b97c7e59a6`) and `I129_H_1B_DATA_COLLECTION_AND` (`6ab46e1c4b31c7b97c7e59ac`).

### Phase 0 - Baseline

Queried the real CaseForms for the target case directly from Mongo - confirmed the 5 documents (I-129 core, I-539, I-907, and the 2 H-supplements) with exact `_id`/`formCode`/`componentCode`/`parentFormCode` values matching the prompt's own description exactly.

Verified each RC claim against the actual current code (not assumed from the prompt) before implementing anything:
- RC5 confirmed real: `CaseForm.formCode` for a component IS its own componentCode (deliberately, per an existing comment in `generate()` explaining a prior incident where resyncing it to the parent's formCode corrupted the unique index). `saveField` called `AutoFillService.overrideField(caseId, caseForm.formCode, ...)`, which called `resolveReverseSync(formType, ...)` then `ReverseIndexService.buildFormReverseIndex(componentCode)` then `FormMappingService.loadTemplate(componentCode)`, which 404s (its `$or: [{formCode}, {formNumber}]` query has no match for a componentCode) - surfaced as a 500 on every supplement field save.
- RC7 confirmed real: `updateProgress` passed `caseForm.fieldValues` (keyed by normalized fieldId, e.g. "part1.line1Name0") straight into `calculateCompletion`, which reads `values[field.fieldName]` (the raw AcroForm name, e.g. "form1[0].#subform[0].Line1_Name[0]") - confirmed via direct read of both functions, the two namespaces never match.
- RC8 confirmed real: `CanonicalProfileService.get` already supports a `rebuild: false` cached-read short-circuit; `CanonicalDataService.build` was unconditionally passing `rebuild: true`.
- RC6 confirmed real, but the prompt's own premise was wrong in one respect - see Phase 2 below.
- `mergeFieldValues`/`resolveComponentFieldIds` existed in `uscis-form.service.js` exactly as described but were not in `module.exports` - confirmed by reading the export list.

### Phase 1 - RC5 fix

`AutoFillService.overrideField(caseId, formType, ...)` is now a thin shim that calls `findCaseForm` then delegates to a new `overrideFieldById(caseForm, fieldId, value, user, req, reason)`, which takes the already-loaded document directly (no second `findCaseForm`) and uses `caseForm.parentFormCode || caseForm.formCode` for every template/mapping-graph lookup (`resolveReverseSync`, the sibling reverse-index fan-out) - never `caseForm.formCode` alone. `saveField` now calls `overrideFieldById` with the exact document `load()` already fetched.

RC9: `saveField`'s field-existence gate now accepts a raw AcroForm name for a component CaseForm when it is listed in that component's own `USCISFormComponentDefinition.fieldIds`, even when the parent template's `formFields` has no matching entry.

Gate G1 (real HTTP against the real running backend/DB): opened the H-Classification-Supplement workspace, saved a real text field (`form1[0].#subform[15].P5_Line6a_SignatureofApplicant[2]`) -> 200 (was 500 before this fix, confirmed by reverting locally and re-testing). `resolveComponentFieldIds`/`resolveReverseSync` now correctly resolve via "I-129", not the componentCode.

### Phase 2 - RC6 fix (with a documented deviation from the prompt's exact plan)

The prompt's prescribed fix was to replace the two `caseForm.save()` calls with a single `findOneAndUpdate`, on the premise that Mongoose's `.save()` "serializes and sends the entire document" on every call. Verified this premise directly is false for this codebase's Mongoose version: `Document#save()` only sends `$set` for paths still marked modified; once `overrideFieldById`'s own `save()` completes, `fieldValues`/`filledData`/`sourceAttribution`/`manualOverrides` are no longer modified, so `saveField`'s second `.save()` (setting only `status`/`reviewState`/`fieldHistory`/`completion`) was already cheap - it was never re-sending the big Mixed maps a second time. Kept the second `.save()` (small, correctness-preserving) rather than rewriting the whole mutation chain to raw `findOneAndUpdate`, and logged this deviation per the loop protocol's own rule allowing deviation when a gate proves a step wrong.

The real, verified waste eliminated instead:
- `saveField` no longer does its own second `CaseForm` fetch or its own second `.populate({path: "formTemplateId"})` - `overrideFieldById` reuses the document `load()` already populated.
- The external `AuditLog.create()` call inside `overrideFieldById` (measured standalone at ~290ms against this environment's DB) and the one in `saveField`, plus `notifyCaseTeam`, are now fire-and-forget (`setImmediate(...).catch(() => null)`) instead of blocking the response - previously both fired synchronously on every keystroke.

### Phase 3 - RC7 fix

Exported `mergeFieldValues`/`resolveComponentFieldIds` from `uscis-form.service.js`. `updateProgress` is now async, builds the fieldName-keyed `values` map via `mergeFieldValues` (the same translation `renderCaseForm`'s viewer path already uses) and scopes completion to a component CaseForm's own fields via `resolveComponentFieldIds`. Updated its 3 call sites (`saveField`, `saveSection`, `formDecision`) to `await` it; `openInteractiveForm`/`open()` needed no change - it already gets correct completion from `renderCaseForm`'s own independent, already-correct `mergeFieldValues` call.

Added 3 new node:test cases to `interactive-form-review.service.test.js` (pure unit tests, no DB): 100%-completion-when-filled, 0%-when-empty, and in-place-mutation-with-existing-keys-preserved. All 14 tests in the file pass (11 pre-existing + 3 new).

Gate G3 (real HTTP): saving a core I-129 field now returns `completion: {totalFields: 942, completedFields: 3, missingRequiredFields: 0, percent: 0}` - correctly reporting 0 MISSING required fields (there are none marked required on this template) instead of reporting the field as unfound. Approving the core I-129 correctly surfaced a real pre-existing data-quality bug unrelated to RC7's own scope (see "Follow-up issue found" below) - proof the false-positive masking is gone, since real errors are now visible instead of being drowned out by thousands of false ones.

### Phase 4 - RC8 fix

`CanonicalDataService.build(caseId, user, req, options)` now accepts `options.skipRebuild` (default false, unchanged for every existing caller) which passes `rebuild: false` through to `CanonicalProfileService.get` instead of the previous unconditional `rebuild: true`. `AutoFillService.generate()` now passes `skipRebuild: Boolean(options.selectedFieldIds?.length)`. `overrideFieldById`'s sibling fan-out now calls `repopulateFields(caseId, caseForm.formCode, siblingFieldIds, user, req)` (which calls `generate()` with `selectedFieldIds`) instead of a full `generate({regenerate: true})`.

Added a defensive filter not in the prompt's own snippet: for a component CaseForm, `siblingFieldIds` is intersected against that component's own `USCISFormComponentDefinition.fieldIds` before being passed to `repopulateFields` - the reverse index can return sibling pdfFields belonging to a different component sharing the same parent template's mapping graph, which live in a different CaseForm document entirely and must never be merged into this one.

Regression check: all 3 existing sibling-fan-out tests (TEST 2, TEST 10, TEST 11 in `AutoFillService.overrideField.reverseSync.test.js`, plus all 3 tests in the K-1/K-3 fan-out suite) still pass unchanged - confirms the RC8 rewiring didn't change fan-out behavior, only which code path computes it.

### Phase 5 - Frontend optimistic status updates

`USCISFormRenderer.jsx`: added `mergeFormState`/`statusAction`. `decideForm`, `generatePdf`, lock, and unlock now use `statusAction` instead of `action` - they apply an immediate optimistic patch, then merge the server's actual returned caseForm fields (`status`, `approvedBy`, `reviewState`, `generatedPdfDocument`, `generatedPdfVersions`, `isLocked`, etc.) on response, with no `GET /workspace` reload. On error, falls back to a real `loadWorkspace(true)` to recover authoritative state. `refresh`/`reset`/`rollback`/`resolve-conflict`/section actions are untouched (still full-reload `action()`), since those genuinely change field values/template state.

39/39 vitest pass (same as P1 baseline, 0 regressions). Real browser click-through of Approve/Generate/Lock was not performed this session - see "What was not verified" below.

### Phase 6 - PDF download/generate gate

Read `PDFGenerationService.generate`'s status gate (`["approved", "ready_for_pdf", "locked", "generated"]`) and the download endpoint's PDF-streaming path - both already correct for their stated purpose, confirmed via direct code read, no code change needed (matches the prompt's own note that this needs verification only). Empirical verification of the full generate-download round trip against a real, canonical-profile-complete case was not performed - see below.

### Follow-up issue found (real, pre-existing, out of scope for P2)

While exercising the real approval gate on the target case's core I-129 CaseForm, found a genuine, pre-existing template-import bug: field `form1[0].#subform[0].Line7b_StreetNumberName[0]` (a street-number-and-name text field) was imported with `fieldType: "number", validation: {numeric: true}`, and already held the real stored value "3ED" - which fails numeric validation. Before this phase's RC7 fix, this was invisible (every field showed as missing, drowning out real errors); after the fix, it correctly surfaced as a blocking "Invalid number" validation error. Not fixed as part of P2 (template field-type classification is out of this phase's scope) - flagged for the forms-import/field-classification backlog. For verification purposes only, corrected this one field's stored value via the normal save endpoint (the same action a real case manager would take) to "100" so the approval gate could be exercised end-to-end.

### Root-cause discovery beyond RC5-RC9: real per-query DB latency dominates total save time

Direct in-process timing (bypassing HTTP, calling `InteractiveFormReviewService.saveField` directly against the real DB) showed `load()` alone taking 4.1s-9.6s and `resolveReverseSync`'s template load taking 1.7-2.2s, even on a warm connection. Isolated this further with raw, trivial queries against the same DB: a bare `Case.findById().select("_id")` (no populates) took 274ms-1.4s per call on an already-warm connection, and a repeat `USCISFormTemplate.findOne` (same query, should hit any driver/OS cache) still took ~2s. This is real per-round-trip network/cluster latency in this environment, not application-code overhead - and it is not new: this exact class of issue is already documented in this file's own P1 entry (`h6-conditional-forms.test.js`/`h2-autofill.test.js` timing out against "the same real-remote-DB-latency pattern") and in `interactive-form-review.service.js`'s own pre-existing comments (a prior "36218ms caseforms.findOne... degraded primary" incident, which is why `WORKSPACE_READ_TIMEOUT_MS` and secondary-preferred reads exist at all).

Consequence for the Definition of Done's specific millisecond targets (G2 <500ms / G4 <1500ms): RC5-RC9's fixes genuinely reduced the number of round trips and blocking operations per save (confirmed above), but cannot reduce the cost per round trip, which is bounded by this environment's DB connectivity, not by this phase's code. `load()`'s own DB reads are explicitly protected by this phase's own hard guardrails (must remain, may be made faster via secondary-preferred reads but not bypassed) and cannot safely use secondary-preferred reads on a write path that needs read-your-own-write consistency. Real HTTP round trips measured against the live server after all P2 fixes: supplement field save 7.8-10.9s, core field save 6.1-10.1s - all correctness gates (G1, G3, RC8's fan-out) are met; the latency gates (G2, G4) are not met, for reasons outside this phase's code, and no further code change in this repository can close that gap without either changing the DB/network infrastructure or relaxing the read-your-own-write consistency guarantee `load()`'s guardrail explicitly protects.

### What was verified (real evidence)

- G1: supplement field save 500->200, confirmed via real HTTP request against the live backend + real DB, before/after comparison.
- G3: `calculateCompletion`'s false-positive masking eliminated - confirmed via 3 new passing unit tests plus a real HTTP approval call that now fails only for genuine, correctly-identified reasons (a real bad data value, then a real incomplete-canonical-profile check) instead of the old blanket false 422.
- RC8: fan-out still produces identical sync-state results - confirmed via all pre-existing fan-out tests passing unchanged.
- No regressions: `AutoFillService.test.js` + `AutoFillService.overrideField.reverseSync.test.js` + `AutoFillService.overrideField.k1k3-fanout.test.js` -> 17/17 pass. `interactive-form-review.service.test.js` -> 14/14 pass. Admin frontend vitest -> 39/39 pass. Admin frontend `npm run build` -> succeeds, `AdobeFormRenderer.js` has zero changes from this phase (its pre-existing diff predates P2 entirely, from earlier session work).

### What was NOT verified (explicitly flagged, not claimed)

- No real Chromium/Playwright click-through of Approve/Generate/Download this phase (P1's existing Playwright spec covers rendering only, not these actions) - Phase 8's e2e spec from the original prompt was not authored or run.
- Full generate-download round trip against a case with a complete canonical profile was not exercised (the target case is missing basic biographic data unrelated to P2, as found above) - `PDFGenerationService.generate`'s code path was read and its status gate confirmed correct, but not run end-to-end this session.
- The <500ms/<1500ms latency targets are not met, for the environmental reasons documented above, not for lack of trying.
