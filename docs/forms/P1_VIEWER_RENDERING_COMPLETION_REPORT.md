# P1 — USCIS Form Viewer Rendering Fix — Completion Report

## Summary

The interactive USCIS form viewer was showing only ~4 fillable fields, no barcode, wrong page labels, and "Unable to render page N" for every supplement/component CaseForm on the target case. Root cause: the viewer's blank-PDF endpoint (`getComponentPdf`) never applied the barcode-flattening step the filled-download path already used before calling Adobe's `combinepdf` — and this session had already proven, with real Adobe API evidence, that without that step Adobe keeps the document's `/AcroForm` dictionary but silently drops ~97% of the real page widgets. A second, independent bug (page-number namespace mismatch) meant the frontend was asking `react-pdf` to render parent page numbers (e.g. 21) against an already-sliced N-page document.

Fixed both, on the backend and frontend, with a shared `ViewerPdfPreparationService` reused by every viewer PDF endpoint, a corrected page-slot/parent-page mapping threaded end-to-end, first-paint autofill values, and a real Chromium Playwright spec proving all of it against the live app, twice consecutively.

## Files changed

```
 Admin/frontend/src/components/uscis/USCISFormRenderer.jsx          | 140 +++++++++++++-------
 Admin/frontend/src/components/uscis/USCISFormRenderer.test.jsx     |  12 +-
 Admin/frontend/src/services/api.js                                 |   5 +
 Admin/frontend/src/utils/PDFFieldChangeAdapter.js                   |  58 ++++++++-
 Admin/frontend/src/utils/PDFFieldChangeAdapter.test.js              |  66 ++++++++--
 Backend/package.json                                                |   4 +-
 Backend/src/models/USCISFormComponentDefinition.js                  |   9 ++
 Backend/src/modules/form-generation/services/AdobeFormRenderer.js   |  22 +---
 Backend/src/modules/uscis-forms/interactive-form-review.service.js  | 142 ++++++++++++++++-----
 Backend/src/modules/uscis-forms/tests/interactive-form-review.service.test.js | 79 ++++++++++++
 Backend/src/modules/uscis-forms/uscis-form.controller.js             |  89 +++++++++----
 11 files changed, 485 insertions(+), 141 deletions(-)

New files:
 Admin/frontend/e2e/uscis-viewer-pagination.spec.js
 Admin/frontend/src/components/uscis/viewerPageSlots.js
 Admin/frontend/src/components/uscis/viewerPageSlots.test.js
 Backend/scripts/invalidateComponentSliceCache.js
 Backend/scripts/verifyViewerPdf.js
 Backend/src/modules/form-generation/services/ViewerPdfPreparationService.js
 Backend/src/modules/uscis-forms/tests/template-pdf-viewer-purpose.test.js
 docs/forms/FORMS_VIEWER_JOURNAL.md (this initiative's ongoing journal)
```

`AdobeFormRenderer.js` (the filled-download path) changed by only 22 lines — a function relocation (`toAdobeRanges` moved into the new shared service), zero logic changed. `PDFRenderer.js`, `PDFFidelityService.js`, and `FormFilingAssemblyService.js` were not touched at all.

## Why it broke (root causes)

**RC1 — page-number namespace mismatch.** A component CaseForm's viewer loads an Adobe-sliced, renumbered-1..N PDF, but the frontend passed the same "page number" (always the *parent's* page number, e.g. 20) straight to both `<Page pageNumber>` (which needs the slice's own 1..N numbering) and every label/lookup (which needs the parent's real page number). `react-pdf` threw `Invalid page request` for every requested page beyond N.

**RC2 — the actual missing-widgets bug.** Confirmed with real Adobe API calls, before touching any code: sending a buffer to Adobe's `combinepdf` *without* first running `flattenBarcodeAppearances` (which internally calls pdf-lib's `PDFForm.removeField()` once per barcode field) makes Adobe keep the catalog's `/AcroForm` entry but drop ~97% of the real widget annotations from the kept pages. The filled-download path already ran that step; `getComponentPdf` (the blank viewer path) did not.

**RC3 — barcode.** Same root cause as RC2 for components; for the full/core viewer, the raw template's barcode field rendered as a live, re-rasterizable text widget instead of its real baked image.

**RC4 — autofilled values not shown on first paint.** Confirmed against the actual installed `pdfjs-dist` source: `AnnotationStorage` is keyed by each widget's own **annotation id**, never by field name — the existing `prePopulateFields(annotationStorage, fieldName, ...)` call was a silent no-op against any real PDF.

## Before / after (real Adobe API, real DB, all 9 registered I-129 components + core)

| Component | Legacy (pre-fix) widgets surviving | Current (fixed) widgets surviving | Strategy used |
|---|---|---|---|
| I-129 core (8 pages) | n/a (not sliced) | 210/210 | full |
| I129_H_CLASSIFICATION_SUPPLEM (8 pages) | 4/159 | 159/159 | adobe_combine |
| I129_H_1B_DATA_COLLECTION_AND (3 pages) | 4/89 | 89/89 | adobe_combine |
| I129_L_CLASSIFICATION_SUPPLEM (4 pages) | 4/107 | 107/107 | adobe_combine |
| I129_O_P_CLASSIFICATION_SUPPL (3 pages) | 5/78 | 78/78 | adobe_combine |
| I129_Q_CLASSIFICATION_SUPPLEM (1 page) | 3/10 | 10/10 | adobe_combine |
| I129_R_CLASSIFICATION_SUPPLEM (5 pages) | 3/107 | 107/107 | adobe_combine |
| I129_TRADE_AGREEMENT_SUPPLEME (2 pages) | 4/39 | 39/39 | adobe_combine |
| I129_E_1_E_2_CLASSIFICATION_S (2 pages) | 4/79 | 79/79 | adobe_combine |
| I129_ADDITIONAL_BENEFICIARY (2 pages) | 5/84 | 84/84 | adobe_combine |

The pdf-lib fallback (Strategy B) was implemented and unit-verified but never needed in practice — Strategy A (Adobe `combinepdf` + `flattenBarcodeAppearances`) passed parity on every real component. Full per-page tables in `docs/forms/FORMS_VIEWER_JOURNAL.md` / `docs/forms/p1-viewer/G1-*.txt`.

## Test commands and results

| Command | Result |
|---|---|
| `node scripts/verifyViewerPdf.js --template=<id> --all-components --core --recipe=legacy` | 10/10 **FAIL** (baseline, proves the bug) |
| `node scripts/verifyViewerPdf.js --template=<id> --all-components --core --recipe=current` | 10/10 **PASS** |
| `node --test src/modules/uscis-forms/tests/interactive-form-review.service.test.js` | 11/11 pass |
| `node --test src/modules/uscis-forms/tests/template-pdf-viewer-purpose.test.js` | 2/2 pass |
| Real `AdobeFormRenderer.renderFiling` (download path, H supplement) | 8 pages / 159 fields — unchanged from pre-P1 |
| Backend regression (16 files across every module touched this session) | 75/76 pass (1 pre-existing, unrelated DB-latency timeout — see journal) |
| `cd Admin/frontend && npx vitest run` | 5 files, 39/39 pass |
| `cd Admin/frontend && npm run build` | succeeds |
| `cd Admin/frontend && npm run lint` | fails — **pre-existing**: no ESLint config file exists anywhere in this project |
| `npm run cache:invalidate-viewer-slices` (dry run → apply → dry run) | found 1 poisoned entry → cleared → re-run reports 0 |
| `npx playwright test e2e/uscis-viewer-pagination.spec.js --project=desktop` (real Chromium, real backend/DB) | **passed twice consecutively** — all 5 real CaseForms on the target case, 0 invalid-page warnings, 0 unrenderable pages, 0 barcode fields exposed as editable widgets, rendered page counts match exactly |

## Screenshots

`Admin/frontend/e2e/screenshots/p1-viewer-*.png` (one per CaseForm, captured by the passing spec). The H Classification Supplement screenshot shows, with zero test interaction: the correct parent page label ("Page 13", not "Page 1"), the real "H Classification Supplement to Form I-129" heading, and autofilled field values already visible ("3ertg", "Ishaan").

## Prod rollout steps

1. Deploy the backend and frontend.
2. `cd Backend && npm run cache:invalidate-viewer-slices -- --dry-run` — review the list of stale slices.
3. `npm run cache:invalidate-viewer-slices -- --apply`.
4. Open one supplement per active parent template in the viewer and confirm the `X-Viewer-Recipe: 2` response header on its PDF request (Network tab).

## Known remaining issues — handed to P2

Per this task's own scope boundary, these were observed but deliberately not touched:
- Saving a field on a supplement (`saveField`/`overrideField`/reverse-sync).
- The 500 on `workspace/field`.
- Approval 422s.
- `FIELD_NOT_IN_MAPPING` handling for unmapped widgets.

## Corrections made to the original diagnosis during implementation

For transparency, two assumptions in the original task prompt turned out to be wrong and were corrected with evidence rather than followed blindly:
1. The root-cause narrative for *why* Adobe drops `/AcroForm` (a claim about a specific object being recursively deleted) didn't match direct inspection of the real sliced PDF — the actual mechanism is an Adobe-side `combinepdf` behavior tied to whether `removeField()` ran beforehand, not a dangling-reference bug in the source document. The fix (create `/AcroForm` when absent, rebuild `/Fields` from surviving widgets) is correct regardless of the precise mechanism.
2. The Playwright spec initially asserted the I-129 core form should render all 38 pages — it renders 8, which is correct: `resolveCorePages` subtracts every registered supplement's pages from the 38-page parent. The assertion was fixed, not the product.
