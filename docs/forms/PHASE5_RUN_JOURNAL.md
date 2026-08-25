# Phase 5 Run Journal

## 2026-08-25 — Pre-work protocol (mandatory, per this phase's own header)

Ran `phase4:verify` first to confirm the Phase 4 baseline: **PASS** (Phase 4 backend 15/15, Phase 3
suite 20/20, frontend 12/12, Phase 2 suite 37/37, `phase1:verify` PASS including `phase0:verify` —
h1b/l1a/k3 all PASS — diff-scope guard PASS).

Re-read every file §E names, in full, before writing anything. Drifts found:

1. **`PDFGenerationService.loadCaseForm` does not return `{ caseForm }`.** §E's own §I.3 controller
   snippet wrote `const { caseForm } = await PDFGenerationService.loadCaseForm(...)`. The real
   signature (`Backend/src/modules/form-generation/services/PDFGenerationService.js:30-50`) is
   `static async loadCaseForm(caseFormId, options = {})` and it `return caseForm;` directly — a plain
   Mongoose document, not wrapped in an object. Confirmed against the existing `draftPdf` controller
   (`FormGenerationController.js:74`), which already calls it as
   `const caseForm = await PDFGenerationService.loadCaseForm(req.params.caseFormId, { readOnly: true });`
   with no destructure. **Fix applied:** `filingPdf` calls it the same, unwrapped way `draftPdf` does.
2. **`CaseForm.js`'s real status enum does not match §E's quoted list.** §E stated:
   `"draft" | "in_progress" | "review" | "approved" | "ready_for_pdf" | "locked" | "generated" |
   "filed" | "rejected" | "archived"`. The actual enum (`Backend/src/models/CaseForm.js:30`) is:
   `["pending", "draft", "ai_filled", "in_review", "under_review", "needs_revision", "approved",
   "ready_for_pdf", "generated", "finalized", "filed", "rejected", "locked", "archived"]` — no
   `"in_progress"`/`"review"` values exist; the real enum has `"pending"`, `"ai_filled"`,
   `"in_review"`, `"under_review"`, `"needs_revision"`, `"finalized"` instead. This does not change
   Phase 5's actual filing-gate list: all 4 values §E asked for (`approved`, `ready_for_pdf`,
   `locked`, `generated`) DO exist in the real enum, and are the exact same 4 values
   `PDFGenerationService.generate`'s own pre-existing status gate already uses
   (`PDFGenerationService.js:172`). Reused that identical literal for consistency rather than
   inventing a new list.
3. **No `actionWithRetry` function exists anywhere in `USCISFormRenderer.jsx`** (confirmed via a
   full-file grep — zero matches). §D.6/§E/§I.5 reference it, but the real download-flow pattern
   (`downloadDraftPdf`, lines 892–911; `downloadPdf`, lines 867–888) is a manual
   `setBusy`/try-catch/`URL.createObjectURL`/`<a download>` sequence, not a wrapped retry helper —
   §E's own §I.5 code sample already matches this real pattern despite the prose calling it
   "actionWithRetry". Built `downloadFilingPdf` by mirroring `downloadDraftPdf` exactly, per §E's own
   instruction, and ignored the incorrect "actionWithRetry" prose reference.
4. **`WatermarkService.apply` has a second caller §E didn't mention**: `FilingPackageService.js`
   (lines 81, 252), in addition to `PDFRenderer.render` (line 137). Confirmed via
   `grep -rn "WatermarkService"` across `Backend/src`. Not relevant to Phase 5's own change (nothing
   in `FilingPackageService.js` is touched), but recorded here per §F's explicit "grep and note if
   found elsewhere" instruction.
5. **ISSUE-001's stated route order is backwards from the real file.** §E's guardrail says
   "`uscis-form.routes` must remain before `formGenerationRoutes`". The real mount order in
   `Backend/src/routes/index.js` is: line 26 `router.use("/forms", formGenerationRoutes)`, THEN line
   27 `router.use("/forms", uscisFormRoutes)` — i.e. `formGenerationRoutes` is mounted FIRST, the
   opposite of what the guardrail describes. Checked whether this matters for the new route: read
   `uscis-form.routes.js` in full — its only generic catch-alls are `/:id/pdf` and `/:id` (lines
   53–54). Since `formGenerationRoutes` is tried first and none of its own routes are a bare
   `/:caseFormId` (all have static suffixes: `/validation`, `/generate`, `/preview`, `/download`,
   `/draft-pdf`, `/approve`, `/regenerate`), a request to `/forms/:caseFormId/filing-pdf` is matched
   inside `formGenerationRoutes` and never reaches `uscis-form.routes`'s catch-alls regardless of
   which router is "supposed to" come first. Adding `/:caseFormId/filing-pdf` to
   `formGenerationRoutes` is safe under the CURRENT (already-working) order. Did not reorder anything
   — §J.3's route-order confirmation step (curl for 401, not 404) is the real verification, not the
   mount-order prose.
6. Confirmed `template.pdfMetadata.pageCount` is real and populated at import time
   (`USCISFormImporterService.js:304-306`), not a guess — needed for the fidelity verifier's
   structural page-count check.
7. Confirmed `template.formFields[].pdfFieldType`/`.semanticType` are real schema fields
   (`USCISFormTemplate.js:113,120-121`) — needed for the fidelity verifier's text-field sampling
   filter.

**Pre-work complete. Drifts found: 7 (listed above, all reconciled before writing code — none block
Phase 5; #1 required a fix to §E's own sketch, #2/#3/#5 are documentation corrections with no
functional change needed, #4/#6/#7 are confirmations). Ready to proceed.**

## 2026-08-25 — PDFFidelityService (§G, gate G2)

Wrote `PDFFidelityService.js` per §G. Test 4 ("missing field is a warning not a block") initially
failed for an unrelated reason: with 2 `template.formFields` entries but only 1 real PDF field, the
structural field-COUNT ratio check (±10%) legitimately failed first, masking the behavior the test
meant to isolate. Fixed by padding the test PDF/template with 10 unrelated filler fields present in
both, so the ratio stays within tolerance while the one field under test is genuinely absent from
the real PDF - a test-design issue, not a verifier bug (documented inline in the test file). All 6
unit tests pass.

## 2026-08-25 — PDFRenderer.renderFiling (§D.1, gate G3) + the P5-001 discovery

Added `renderFiling` to `PDFRenderer.js`. Wrote an integration test against a REAL seeded H-1B case
(`buildGoldenH1bCase` + `AutoFillService.generate`, the exact pattern `h1-i129-mapping.test.js`
already proved) rather than only synthetic fixtures, since §C warns against claiming correctness
that was only checked against hand-built data.

First run failed: `result.fidelityReport.sampledFields > 0` was `0`. Diagnosed by reading
`AutoFillService.js`'s own header comment (not guessed): `caseForm.fieldValues` is a FLAT map keyed
by `fieldId`, a namespace distinct from the PDF's own `fieldName`, even though the two are equal for
most real fields as strings. My first `sampleFieldNames` implementation iterated
`Object.keys(fieldValues)` and looked each key up directly against `template.formFields` BY
`fieldName` - for the real, crosswalk-populated H-1B case this produced zero matches. Fixed by
iterating `template.formFields` instead and resolving `fieldValues[field.fieldId || field.fieldName]`.
Re-ran: `sampledFields` became a real positive count. Filed as P5-001 - the most consequential
finding this phase, since a spec-literal implementation would have shipped a field-level fidelity
check that silently verified nothing, every time, in production.

Built the watermark-absence proof by decoding real page content streams (not just form-field
values, per §C's explicit requirement): discovered empirically that pdf-lib's `drawText` encodes
Latin text as hex-string `Tj` operands (`<4452414654> Tj` for "DRAFT"), not literal parenthesized
strings - a naive `buffer.toString().includes("DRAFT")` on the raw (Flate-compressed) bytes returns
false even when the watermark IS present. Wrote a small decoder (`decodePageText`) that pulls the
real content stream via pdf-lib's `decodePDFRawStream`, extracts hex- and literal-string tokens, and
reassembles the drawn text. Verified the decoder itself isn't a silent no-op by also rendering the
SAME data through the watermarked path and confirming "DRAFT" IS detected there.

Both tests pass: the real filing-copy render has zero watermark text on any page, and a tampered
template (3x the real field count) correctly makes `renderFiling` throw `PDF_FIDELITY_FAILURE`.

## 2026-08-25 — FormGenerationController.filingPdf + route (§D.3/§D.4, gate G4)

Wrote `filingPdf` using the P5-002 fix (unwrapped `loadCaseForm` call) and the exact 4-value status
list `generate()` already uses. Added the route immediately after `draft-pdf`. Extended (not
duplicated) the existing `h3-formGenerationRoutes.test.js` route-registration check with the new
route/handler pair.

Wrote 3 controller-level tests against a real seeded case with a mock req/res: approved -> 200,
non-approved (`"ai_filled"`, `AutoFillService.generate`'s own default status) -> 422, and a
monkey-patched `PDFRenderer.renderFiling` throwing `PDF_FIDELITY_FAILURE` -> 422 with no `Document`
record created (confirmed via an explicit before/after count, not assumed). All 3 pass on first
correct run.

## 2026-08-25 — §K-G7 regression proof (existing paths unchanged)

Wrote `watermark-regression.test.js`, reusing the same page-content-stream decoder, to prove
`draftPdf` still stamps "DRAFT" and the legacy `generate` path still stamps the right label. The
first attempt used status `"locked"` for the FINAL-watermark case, which failed with "PDF generation
blocked by validation errors" - `PDFGenerationService.generate`'s own validation call switches to
strict (non-draft) mode only when status is exactly `"locked"`, and the golden H-1B fixture doesn't
satisfy that stricter validation (a pre-existing, Phase-5-unrelated gap). Fixed by using
`"ready_for_pdf"` instead, which `generate()`'s watermark ternary also treats as FINAL but which
keeps validation in draft mode - proves the same watermark branch without tripping an unrelated gap.
Both tests (draftPdf/DRAFT, generate/ATTORNEY REVIEW->FINAL) pass.

## 2026-08-25 — Frontend (§D.6/§I.5, gate G5)

Added `downloadFilingPdf` (mirrors `downloadDraftPdf` exactly, per the pre-work finding that no
"actionWithRetry" helper exists) and a conditionally-rendered "Download filing copy" button. Added
`filingPdf` to `api.js`'s `formGenerationApi` and to the test file's api mock (was previously an
empty `{}` stub). 3 new component tests pass alongside the 12 pre-existing ones (15/15 total);
confirmed `URL.createObjectURL` is already polyfilled in the shared test setup
(`src/test/setup.js`), so no new test-environment scaffolding was needed.

## 2026-08-25 — `phase5:verify` (§D.7, gate G6) + final run

Modeled directly on `phase4Verify.js`. First full run:
```
PASS - Phase 5 backend test suite (14 pass / 0 fail)
PASS - Phase 4 test suite (re-run directly) (15 pass / 0 fail)
PASS - Phase 3 test suite (re-run directly) (20 pass / 0 fail)
PASS - Frontend component tests (15 pass / 0 fail)
PASS - Phase 2 test suite (re-run directly) (37 pass / 0 fail)
PASS - phase1:verify (includes phase0:verify)
FAIL - Diff scope guard
Overall: FAIL
```
The diff-scope guard's only flagged file: `Backend/src/config/env.js`, a single-line (blank line)
whitespace-only diff. Investigated before treating this as a Phase 5 problem: `git diff` shows a
1-line insertion inside the REFRESH_COOKIE_SAMESITE comment block (lines 90-101 of that file) - a
file Phase 5 never opened, read, or had any reason to touch (it's authentication/cookie config, not
form-generation). This is the same file and the same line range the user's own IDE selection showed
at the very start of this task, strongly suggesting it's the user's own in-progress edit in their
editor, not anything this session produced. Per this session's own safety rules (never revert
unfamiliar changes without asking), left it untouched and did NOT add it to the allowlist (which
would incorrectly imply Phase 5 owns it) - reported transparently instead of silently papering over
the one non-green gate.

A broader, non-blocking sanity sweep (`node --test src/modules/form-generation/tests/*.test.js`, the
WHOLE module's test directory, not just the Phase 5-curated list) was also kicked off as an extra
regression check beyond phase5:verify's own targeted file list - result recorded below once it
completed.

## §J — outstanding (recorded, not performed)

**§J.4 (the combined Phase 3+4+5 visual smoke check)** requires a human in a real browser with a
real seeded case; not performed by the agent. **§J.3 (route-order live confirmation via curl)** also
requires a running server; not performed. Both explicitly flagged for the user - see
`PHASE5_BASELINE.md` §8.

## Diff scope (all five phases combined)

Phase 5 touched: `PDFFidelityService.js` (new), `PDFRenderer.js` (`renderFiling` added),
`FormGenerationController.js` (`filingPdf` added), `formGenerationRoutes.js` (1 new route line), 5
new backend test files, `USCISFormRenderer.jsx`/`.test.jsx` (button + tests), `api.js` (1 new
entry), `phase5Verify.js` (new), `package.json` (1 new script), and the `docs/forms/` Phase 5 docs/
ledger files. No locked file (`AutoFillService.js`, `CanonicalProfileService.js`,
`SyncStateService.js`, `ReverseIndexService.js`, `MappingResolver.js`, `CaseForm.js` schema,
`WatermarkService.js`, `PDFFieldMapper.js`) was touched. The one diff-scope guard flag
(`Backend/src/config/env.js`) is an unrelated, pre-existing, out-of-session edit - see above.
