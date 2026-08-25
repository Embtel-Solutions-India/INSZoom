# Phase 5 Baseline — Clean Official Filing Download + PDF Fidelity Verification

Covers all of Phase 5's planned work (§D.1–§D.8): the watermark-free filing-copy download path, the
stale-gate bypass for that path, the PDF fidelity verifier, and the two outstanding human visual
smoke checks are flagged (not closed - see §8 below; closing them requires a human). No locked file
(`AutoFillService.js`, `CanonicalProfileService.js`, `SyncStateService.js`, `ReverseIndexService.js`,
`MappingResolver.js`, `CaseForm.js` schema, `WatermarkService.js`, `PDFFieldMapper.js`) was
modified — confirmed by `phase5:verify`'s own diff-scope guard.

## 1. Ground-truth corrections found before writing code (§F)

Seven drifts found during the mandatory pre-work protocol, all reconciled before code was written
(full detail in `docs/forms/PHASE5_RUN_JOURNAL.md`'s pre-work entry):

1. **`PDFGenerationService.loadCaseForm` returns the CaseForm document directly, not `{ caseForm }`.**
   §E's own `filingPdf` sketch destructured it as an object. Fixed by calling it unwrapped, exactly
   like the pre-existing `draftPdf` action already does. See P5-002.
2. **`CaseForm.js`'s real status enum doesn't match §E's quoted list** (no `"in_progress"`/`"review"`;
   the real enum has `"pending"`/`"ai_filled"`/`"in_review"`/`"under_review"`/`"needs_revision"`/
   `"finalized"` instead). No functional impact: all 4 values the filing gate needs
   (`approved`/`ready_for_pdf`/`locked`/`generated`) exist in the real enum and are the exact same 4
   values `PDFGenerationService.generate`'s own pre-existing status gate already uses - reused that
   literal rather than inventing a new one.
3. **No `actionWithRetry` function exists anywhere in the frontend** (confirmed by a full-file grep).
   `downloadFilingPdf` mirrors `downloadDraftPdf`'s real manual busy/try-catch/blob-URL pattern
   instead, per §E's own instruction to mirror that function.
4. **`WatermarkService.apply` has a second caller** (`FilingPackageService.js`, 2 sites) not
   mentioned in §E. Not relevant to Phase 5's change; recorded for completeness only.
5. **ISSUE-001's stated route-mount order is backwards from the real file** (`formGenerationRoutes`
   is actually mounted BEFORE `uscis-form.routes` in `routes/index.js`, not after). Confirmed this is
   safe for the new route regardless: `formGenerationRoutes` has no bare `/:caseFormId` catch-all
   that could be reached before or instead of the new specific `/filing-pdf` path.
6. Confirmed `template.pdfMetadata.pageCount` is real and populated at import time.
7. Confirmed `template.formFields[].pdfFieldType`/`.semanticType` are real schema fields.

An eighth issue was found DURING implementation (not pre-work), the most consequential one: §G's
own field-sampling pseudocode assumed `caseForm.fieldValues` is keyed by PDF field NAME. It is
actually a flat map keyed by `fieldId` (a distinct namespace from `fieldName`, though equal for most
real fields as strings). Caught by a real-pipeline integration test before ship - see P5-001.

## 2. PDFFidelityService (§G, gate G2)

New file: `Backend/src/modules/form-generation/services/PDFFidelityService.js`. Deliberately
separate from `PDFValidationService` (validates CaseForm INPUT data pre-render) - this reads the
GENERATED PDF's actual bytes back and checks them against that same input, closing the exact gap
`ARCHITECTURE.md`'s own guardrail names ("Do not claim PDF correctness from JSON responses").

Structural checks: `%PDF-` magic bytes, pdf-lib load, page count vs.
`template.pdfMetadata.pageCount`, AcroForm field count vs. `template.formFields.length` (±10%
tolerance). Field-level checks: samples up to 20 non-empty `pdfFieldType:"text"` fields (skipping
`semanticType:"signature"`) by resolving each through `template.formFields[].fieldId` into
`caseForm.fieldValues` (see the P5-001 correction above), reads the actual embedded text via
pdf-lib's `getTextField(...).getText()`, and compares. A mismatch is an error (blocks); a field
missing from the generated PDF entirely is a warning (does not block).

6/6 unit tests pass, including the critical Test 3 (field mismatch is caught - a verifier that only
ever reports `valid:true` is not a verifier).

## 3. PDFRenderer.renderFiling (§D.1, gate G3)

Added to `PDFRenderer.js` (unlocked for Phase 5). Always calls `render({ ..., watermark: null })` -
`WatermarkService.apply`'s own pre-existing `if (!label) return buffer` short-circuit means
`WatermarkService.js` needed zero changes - then runs `PDFFidelityService.verify` against the real
output bytes and throws a `PDF_FIDELITY_FAILURE` (422, with the report attached) if invalid.
Deliberately bypasses `PDFGenerationService.generate` entirely, so its stale-gate (irrelevant since
Phase 2's canonical write-back keeps data current by design) and its own status gate (re-implemented
independently in the controller, using the exact same allowed-status literal `generate()` already
uses) never apply to this path.

Verified end-to-end against a REAL seeded H-1B case (`buildGoldenH1bCase` +
`AutoFillService.generate`, the same pattern `h1-i129-mapping.test.js`/`h3-pdf-generation.test.js`
already use):
- Returns a buffer starting with `%PDF-`.
- `fidelityReport.sampledFields > 0` (real fields were actually checked, not zero).
- **No watermark text on any page** - proven by decoding each page's actual content stream (hex/
  literal string tokens inside `Tj`/`TJ` operators, not just reading form-field values) and
  confirming none contain `"DRAFT"`/`"FINAL"`/`"ATTORNEY REVIEW"`. A companion assertion in the same
  test proves the detector itself isn't a silent no-op: the identical template/data rendered through
  the watermarked path (`render()` with `watermark:"DRAFT"`) IS detected.
- A second test tampers a template's `formFields` (triples the count vs. the real PDF) and confirms
  `renderFiling` rejects with `error.code === "PDF_FIDELITY_FAILURE"`, `error.status === 422`, and a
  populated `error.report`.

## 4. FormGenerationController.filingPdf + route (§D.3/§D.4, gate G4)

New controller action, reusing `PDFGenerationService.loadCaseForm`/`createGeneratedDocument`/`audit`
exactly as `draftPdf`/`generate` already do (no new persistence primitive invented). Status gate
uses the identical 4-value list `PDFGenerationService.generate` uses
(`["approved", "ready_for_pdf", "locked", "generated"]`) - not a new/independently-authored list -
returning 422 with `"This form must be approved before downloading the filing copy."` otherwise.
New route `GET /:caseFormId/filing-pdf` added immediately after `/:caseFormId/draft-pdf` in
`formGenerationRoutes.js`, same `authorizePermissions("forms:read")` + `requireCaseFormAccess`
middleware chain as `draft-pdf`.

Controller-level tests (real seeded case, real Express handler with a mock req/res, not just
`renderFiling` in isolation):
- Approved status → 200, `Content-Type: application/pdf`, buffer starts `%PDF-`, filename contains
  `FILING`.
- Non-approved status (`"ai_filled"`, `AutoFillService.generate`'s own default) → 422, correct
  message, no buffer sent.
- A monkey-patched `renderFiling` throwing `PDF_FIDELITY_FAILURE` → 422 with the fidelity message, no
  buffer sent, **no `Document` record created** (confirmed via a before/after count).

Route-registration test (`h3-formGenerationRoutes.test.js`, extended, not duplicated) confirms
`GET /:caseFormId/filing-pdf` is wired to `controller.filingPdf`.

## 5. Existing paths unchanged (§K-G7)

Proven with byte-level evidence (not status-code-only checks), in
`watermark-regression.test.js`, against a real seeded case:
- `draftPdf` still stamps `"DRAFT"` - confirmed by decoding the real returned buffer's page content
  stream.
- The legacy `generate` path still stamps `"ATTORNEY REVIEW"` pre-lock and `"FINAL"` once a form
  reaches `ready_for_pdf`/`locked` - confirmed the same way, reading the real stored `Document`'s
  buffer back from storage.

Neither `WatermarkService.js` nor `FormGenerationController.draftPdf`/`.generate` nor
`PDFGenerationService.generate` were modified this phase - these tests exist purely as a regression
guard proving Phase 5's additions didn't disturb them.

## 6. Frontend (§D.6/§I.5, gate G5)

`downloadFilingPdf` mirrors `downloadDraftPdf`'s exact manual pattern (see drift #3 above - no
"actionWithRetry" helper exists to reuse). A new "Download filing copy" button renders only when
`workspace.caseForm.status` is `approved`/`ready_for_pdf`/`locked`/`generated`, calling
`formGenerationApi.filingPdf(caseForm._id)` → `GET /forms/:caseFormId/filing-pdf`. 3 new component
tests (button renders for `approved`, does not render for the default `draft` status, click calls
the API with the correct id) - all pass, alongside the 12 pre-existing Phase 3 tests (15/15 total).

## 7. `phase5:verify` (§D.7, gate G6)

`Backend/src/scripts/phase5Verify.js`. Runs: Phase 5's own 5 test files (fidelity verifier,
renderFiling integration, filingPdf controller, watermark regression, route registration), Phase 4's
backend suite (re-run directly, same rationale phase4Verify.js already established for phase3),
Phase 3's suite, the frontend component tests, Phase 2's suite, `phase1:verify` (includes
`phase0:verify`), and an expanded diff-scope guard covering all five phases' files.

## 8. §J — human-only gates (NOT closed by this agent)

**§J.4 visual smoke check is explicitly flagged, not performed.** This requires a human in a real
browser with a real seeded case and cannot be automated - the same limitation recorded for Phase 3's
§J.5 and Phase 4's carried-forward item. §J.4 additionally asks this check to close BOTH the
Phase 3/4 outstanding items AND the new Phase 5 items (watermark-absence as seen in an actual PDF
reader, field-value spot-check, button visibility at non-approved status). None of the 9 items in
§J.4 have been recorded as run by a human as of this phase. This is the single explicit gap
preventing Phase 5 from being "complete by construction" per §A's own closing line - everything
automatable is green; the visual check is not something this agent can perform or fake.

**§J.3 route-order confirmation** (curl `GET /api/forms/test-id/filing-pdf` expecting 401, not 404)
is also a manual step requiring a running server - not performed here, flagged for the user. The
static analysis in §1 item 5 above gives strong confidence it will return 401, but a live check is
what §J.3 actually asks for.

## 9. Known gaps (carried forward, unchanged)

- P4-004 (SSN/alienNumber widget format) - untouched, out of scope per this phase's own §A.6.
- §J.5 (Phase 3/4 visual smoke check) - still outstanding, now folded into §J.4 above.
- Everything else Phase 2/3/4 already flagged and characterized is unchanged.
