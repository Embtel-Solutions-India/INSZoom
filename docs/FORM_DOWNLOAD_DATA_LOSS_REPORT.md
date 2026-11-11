# Form download – "no saved value is ever lost" (completion report, final state 2026-11-11)

Date: 2026-11-11 · Scope: Backend only (no frontend, no `USCISFormRenderer.jsx`, no CI/CD change).

## Rule
Every value saved on a case form (text, number, date, checkbox, radio, dropdown) must reach the downloaded file. Anything that cannot be placed on a printed
form box is shown on a recovery page instead of being dropped. A download never fails because of this.

## Root causes found (and what now happens)
| # | Cause | Evidence | Now |
|---|-------|----------|-----|
| 1 | Saved value no template mapping reads ("orphan") | none on latest-edition forms today (0) – latent | listed as `orphan1`, `orphan2`, … for that case only; no shared mapping / canonical path is added |
| 2 | Mapping names a PDF box that is not in the PDF (silent skip in `setFormField`) | I-129 | name matched ignoring case/spaces (unique match only); else listed (`pdf_field_missing`) |
| 3 | Box lives on a supplement page the core download removes | latest I-129: 251 mapped values not in the core PDF, 23 of them real values (names etc.), held by no sibling form | listed (`removed_with_page`), unless the supplement's own form already holds the value |
| 4 | Dropdown value not one of the printed choices | code path | value added to the dropdown list so it is kept; radio groups listed (`choice_not_available`) |
| 5 | Text a standard PDF font cannot encode (e.g. 张伟, Ṛ) made `pdf.save()` throw → whole render failed → **blank form downloaded** | reproduced with pdf-lib 1.17.1; none in live data today | saved without redrawing the look (value stored exactly; viewers rebuild it); affected values listed (`not_displayable`) |
| 6 | Written box does not keep its value | read-back check (new) | rewritten once, listed if still different (`readback_mismatch`) |
| 7 | Two answers mapped to one box (last one silently won) | mapper | last still wins (unchanged); the replaced answer is listed (`overwritten`) |
| 8 | Answer held back by the form's own condition | mapper | listed (`held_back_by_rule`) |
| 9 | Form cannot be filled at all → blank USCIS form served | download tiers | blank form is served **with every saved value on the recovery page** (`form_not_filled`) |
| 10 | `/download` could serve a stored snapshot older than the saved values | route | every editable form now goes through the one current-data path; snapshot only for locked/filed forms |

Checked and **not** a cause on the live data (latest editions): editor values vs. renderer values (0 drift), snapshot older than last edit (0 – no form has a stored
snapshot), read-back mismatches in the 15-form render sample (0), blanked writes since 2026-10-14 (0).

## What the user gets
* Last page(s) of the file: "INTERNAL DATA RECOVERY PAGE – NOT PART OF THE USCIS FORM – remove before filing", grouped by reason, with `orphanN` labels.
* The exact text is also embedded as the attachment `case-data-recovery.json` (lossless, covers characters the printed page cannot show).
* One warning line in `X-Form-Warnings` (shown by the existing Admin UI) and the list in the `PDF_OFFICIAL_DOWNLOADED` audit entry (`unplacedValues`).
* Nothing is added when everything was placed – the file is byte-identical to before.

## Changed files
* NEW `Backend/src/modules/form-generation/services/FormDataGuard.js`
* `…/services/PDFRenderer.js` – alias lookup, dropdown self-heal, read-back, removed-page detection, unencodable-text save fallback, `unplacedWrites` in the render report
* `…/services/PDFFieldMapper.js` – additive: `collisions`, value on condition-skipped entries
* `…/services/OfficialFormDownloadService.js` – runs the guard after the render; audit field
* `…/controllers/FormGenerationController.js` – `/download` uses the single current-data path (falls back to it when no stored copy exists)
* NEW `…/tests/formDataGuard.test.js` (13 tests); `…/tests/FormGenerationController.downloadForm.test.js` – two stale tests updated (see below)

## Tests
* 13 new tests pass; 46 existing DB-free form-generation tests pass.
* `FormGenerationController.downloadForm.test.js` (local test DB only): tests 2 and 5 were already failing before this work – test 2 read the Document count before the
  deferred save happened; test 5 expected a 422 although the 2026-10-02 design serves a file with a warning. Both updated; 5/5 pass.
* Not run: `npm run test:safe` (the earlier run produced no result; needs a re-run), DB-backed form tests.

## Not changed on purpose
Filing-package assembly and `PDFGenerationService.generate` still use `PDFRenderer` directly (no recovery page added to them); they gain the new render-report data only.

## Production
No new env vars required. Optional: `FORM_DOWNLOAD_RECOVERY_PAGE=off` hides the appended page (values are still written to the audit log). Restart the backend to load the change.


---
## FINAL STATE (supersedes the recovery-page parts above)
**Strict owner rule: the download button downloads ONLY the form.** No extra page, no attachment, for any form or case. Values that have no box are recorded in the
`PDF_OFFICIAL_DOWNLOADED` audit entry (`unplacedValues`, with the value) and named in the `X-Form-Warnings` message. The appended page exists only as an opt-in
(`FORM_DOWNLOAD_RECOVERY_PAGE=on`, never set in production).

### Extra root cause found with the case manager's real I-907 (Given Name "Jennifer", Middle Name "Glory")
The native PDF editor saved boxes as EMPTY over real values (`manualOverrides`, reason "Native PDF field edit"): 58 boxes on 18 forms, 29 of which had held a value.
The live view ignored the blank, so Immiglance showed the value while the download (built from the saved copy) was blank. Also: the saved copy is a snapshot - boxes
the live view computes (continuation-sheet names, copies of boxes on other pages) were missing from it, and nothing flagged the form stale (12 of 78 case forms, 52 boxes).
New `LiveFormValues.js` (download time, in memory, nothing saved):
* box the live view has and the saved copy lacks -> filled;
* box blanked by an EMPTY override -> live value (or the value it held before) restored;
* what staff typed is always written - also when the saved copy lacks it or holds an older text, and also when the box's own "only if" rule says no (mapper);
* a box a person typed a real value into is never replaced; locked/filed forms are never touched.

### Verified on the real data (read-only)
* Every case form in the database (G-1145, G-1650, G-28, I-129 + supplements, I-140, I-485, I-539, I-765, I-907): 40 forms, 0 boxes empty in the file for live-view values,
  saved values or staff-typed values; download = same page count as the plain render, no attachment.
* Every form template on the Form Governance page (115 templates, ~25,000 boxes, every box type filled): all boxes land in the file for 114 templates.
* Real I-907 `…c394`: Given Name "Jennifer" and Middle Name "Glory" now in the downloaded file.
* Download speed: the render is ~2x faster than before (one box lookup map instead of a scan per box): warm I-129 render 5.7 s vs 11.9 s.

### Decided by the owner (2026-11-11)
* The I-129 download cuts the supplement pages (O/P, Trade Agreement, E-1/E-2, H ...) on purpose: supplement values live ONLY in the supplements' own forms. A box on a cut page is
  never reported as a loss (no warning, no log entry).

### Still open
* `npm run test:safe` was not completed.
* Production: restart the backend. No new env vars. `Admin/frontend/src/components/ChecklistEditorModal.jsx` had a syntax break from another uncommitted edit (fixed).
