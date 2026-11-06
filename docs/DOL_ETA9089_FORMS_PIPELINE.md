# DOL ETA-9089 forms in the form pipeline (completion report)

Date: 2026-11-07. Scope: exactly two forms, added to the **existing** form auto-fetch pipeline.

| Code | Official name | Official file (at the time of writing) |
|---|---|---|
| `ETA-9089A` | Form ETA-9089, Appendix A | `https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/ETA-9089-AppendixA-Expires02-28-29.pdf` |
| `ETA-9089FD` | Form ETA-9089, Final Determination | `https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/ETA-9089-Final-Determination-Expires02-28-29.pdf` |

Deliberately NOT included: the main ETA-9089, every other ETA form, and the "Appendix A - 508 Compliant - 06.01.2023" file (Professional Athletes).

## What the real PDFs are
Plain fillable AcroForms (Appendix A: 5 pages / 114 boxes; Final Determination: 2 pages / 28 boxes). No XFA, no JavaScript, no character limits, no read-only boxes. The only locked boxes are the four signature boxes of the Final Determination (the scanner types them `signature`). **They print no edition date**: the footer is "Form ETA-9089 - Appendix A | FOR DEPARTMENT OF LABOR USE ONLY | Page A.1 of A.5" plus blank DOL fill-in lines; the only date is the OMB header "Expiration Date: 02/28/2029". The OMB date is therefore **not** used as a version.

## How it works
Everything after the download is the same shared pipeline (importer: qpdf normalize, XFA check, scan, labels, storage; mapping; optional AI suggestions; certification; edition gate; activation; case migration).

1. **Source** - `uscis-form-import/config/externalForms.js` (data, one entry per form) + `services/ExternalFormSource.js`. Host pinned to `www.dol.gov`, every redirect hop re-checked, size cap, timeout, `%PDF-` check, one honest User-Agent (`Immiglance-FormEditionEvidence/0b-1`); nothing imitates a browser. **Two ways** to the file, because a direct link can answer HTTP 403:
   1. direct (stored address, then the known address);
   2. the official forms page: its *current* link whose **file name starts with** `ETA-9089-AppendixA-` / `ETA-9089-Final-Determination-` (this also survives a renewal that changes `Expires02-28-29` in the file name).
   If both are refused the live edition keeps serving, the job is classed `blocked` (slow retry, one alert) and a person can upload the PDF through the existing admin upload (third way, never automatic).
2. **Version by content** - `services/ExternalFormFingerprint.js`: SHA-256 of the file + a content hash (page count + every box name/kind + normalized text). Same bytes = no change. Different bytes, same content = "identical re-issue" (recorded, **no** new version). Different content = a real new version: `v1`, `v2`, ... (`lifecycle.external.internalVersion`, e.g. `ETA-9089-APPENDIX-A-v2`). The edition date stored is the day the version was first detected (`editionDateSource: "import_date"`). OMB expiry is stored for information only.
3. **Edition gate** - an edition fetched from the official DOL source is the accepted one (owner policy `official_external_source`); a recorded "not accepted" decision still wins; no USCIS-page evidence is requested for these forms.
4. **12-hourly check** - `services/ExternalFormsSyncService.js`, a step of the existing catalog-sync job, run **first and independently** (a USCIS-side failure cannot skip it; it cannot hold up a USCIS form). Each form goes through `FormPipeline.runForm` (durable job, retries with backoff, alerts). Switch: `EXTERNAL_FORMS_SYNC=false`.
5. **Identity** - both footers print "Form ETA-9089", so the form's own title decides; the other form's file is refused (`FORM_PDF_MISMATCH`).
6. **Box types** - the generic name-based type guess misreads "...institution that *issued* the degree" (date) and "apartment suite floor and *number*" (number); per-form overrides in the entry fix exactly those six boxes (text). No other form is affected (the scanner option is passed only for these entries).
7. **Canonical values** - `form-mapping/config/etaFieldRules.js`, authored and EXCLUSIVE like the I-9 (no guessed value can reach an unmapped box). Appendix A maps 13 boxes (worker name, address, date of birth, class of admission, A-number, countries of birth and citizenship); Final Determination maps 7 (employer name and FEIN, worker name, job title, SOC code). Every stem was verified against the real PDFs to match exactly one box. Left blank on purpose: DOL-issued boxes, all signature / date-signed / initial boxes, attorney and signatory blocks, and Appendix A's education / training / employment-history blocks (no other form maps those repeating records yet; unmapped boxes stay blank and editable).
8. **Case Manager** - the Case Manager's form catalogue now lists both forms (`case-form-catalog.service.js`), so they can be added to a case and opened, edited and downloaded like any form.

## Files
New: `uscis-form-import/config/externalForms.js`, `services/ExternalFormSource.js`, `services/ExternalFormFingerprint.js`, `services/ExternalFormAcquisitionService.js`, `services/ExternalFormsSyncService.js`, `form-mapping/config/etaFieldRules.js`, `scripts/checkExternalFormSources.js` (read-only diagnostic), tests `uscis-form-import/tests/externalForms.test.js`, `uscis-forms/tests/case-form-catalog.externalForms.test.js`.
Small additive edits: `OnDemandFormAcquisitionService` (branch for the two codes at the top of `ensureCurrentUSCISFormInner`), `FormMetadataService` (detection day as edition only when nothing else exists), `FormIdentityService`, `PDFFieldScannerService` + `USCISFormImporterService` (optional per-form type overrides), `EditionPolicyEnforcer` + `EditionPolicyScheduler`, `errorClassifier` (three new codes), `models/USCISFormTemplate` (`lifecycle.external`), `partyFieldRules.js` (register rules), `USCISCatalogSyncJob` (the independent step), `case-form-catalog.service.js`, `config/visaCategories.js`, `uscis-forms/uscis-form.service.js`, Admin `CRMCaseDetail.jsx`. Tests added: `uscis-forms/tests/perm-manual-forms.test.js`.

## Future versions of these two forms
Everything below is keyed to the FORM CODE, so it applies to every later version (v2, v3, ...) automatically and to no other form:
- **Text size** - `AutoFontSizeGuard` (hooked in `FullTextFieldGuard`, see the deploy constraint below) gives the auto-size boxes `fontSizePt` (12 pt) when the form is rendered, whichever version is live; a version that ships fixed sizes keeps its own.
- **Version label** - the internal `v<number>` is hidden in the Forms tab (`Admin/frontend/src/utils/formVersion.js`); USCIS versions (dates) are shown as before.
- **Box types and canonical values** - `fieldTypeOverrides` and the authored rules match boxes by NAME. After every import `ExternalFormHealth` checks that each rule stem and override still matches a box of the new version. If DOL renames a box, the log warns `external_form_rules_unmatched` naming the exact stem, and the template records it in `lifecycle.external.ruleHealth`; the fix is one edit of `etaFieldRules.js` (and the override in `externalForms.js`). Nothing fails and nothing is guessed: the affected box stays blank and editable until then.

## Errors and their linked solutions (all in code)
Every failure of these two forms has a named error code, a diagnosis in the pipeline's resolution engine, and a coded solution. A new error of a known kind is solved by the same solution; a new KIND of error gets a new entry in `form-pipeline/resolution/catalog/` (files are auto-loaded) and, if it is a code defect, a fix plus a test.

| Situation | Code / diagnosis | Solution (where) |
|---|---|---|
| Direct PDF link answers 403 | `EXTERNAL_SOURCE_BLOCKED` -> cause `source_not_found` | Way 2: the forms page's current link (`ExternalFormSource.resolveExternalPdf`); catalog entry `external_source` re-runs each way alone (`direct_address`, `forms_page_current_link`) and asks the engine to retry on a verified success |
| Both ways refused / file not listed | `EXTERNAL_SOURCE_BLOCKED` / `EXTERNAL_SOURCE_UNRESOLVED` | Live edition keeps serving; class `blocked` (daily slow retry), documented hold `NO_OFFICIAL_SOURCE`, one alert, the 12-hourly step tries again; last resort a person uploads the PDF (admin upload). Never a bot-check workaround. |
| DOL renames the file on renewal (`Expires02-28-29` changes) | - | Forms page scanned for the file-name prefix; the stored address is only tried first |
| Redirect to another host, wrong content type, not a PDF, too large | refused before / during the request | `fetchExternal` returns an error -> `EXTERNAL_SOURCE_UNRESOLVED` (above) |
| Wrong file served (the other ETA-9089 form) | `FORM_PDF_MISMATCH` | blocked, never stored (`FormIdentityService.judgeExternal`, decided by the form title) |
| PDF cannot be read | `PDF_UNREADABLE` | live edition keeps serving; blocked (slow retry) |
| Same form re-saved (new bytes, same content) | - | "identical re-issue": recorded, no new version (`ExternalFormFingerprint.compare`) |
| Run stopped after import, before activation | - | Next run RESUMES that copy (matched by content or file checksum), never imports a duplicate (`findPendingSameContent`) |
| Version bookkeeping lost to the shared activation step (it rewrites `lifecycle` from an older in-memory copy) | - | Activation gets the current template and the stamp is verified and re-written afterwards (`ensureStamp`) |
| A low-confidence importer guess left in review points at the same path as the authored rule, so the mapping never activates | `LOW_CONFIDENCE_MAPPING`, `reviewRequired: 1` | The authored rule is the verification: promoted to active (`PartyFieldMappingService.plan`, DOL forms only) |
| Box type misread from its name | - | `fieldTypeOverrides` in the form's entry (scanner option, DOL forms only) |
| Edition gate has no record for the edition | `no_policy` | owner policy `official_external_source` (a recorded "not accepted" still wins) |
| One form or the DOL step fails | - | Each form is its own pipeline job; the DOL step runs before and independently of the USCIS sync; `EXTERNAL_FORMS_SYNC=false` switches it off |

Latent issue noticed, deliberately NOT changed for USCIS forms: `PartyFieldMappingService.plan` skips promoting a review-status edge that already equals its authored rule (the defect above) for every form. It is fixed for the two DOL forms only, because promoting edges on live USCIS forms would change what their cases fill. Say so if you want it fixed for all forms.

## Deploy constraint: PDFRenderer.js is never edited for these forms
The production server keeps a local change to `Backend/src/modules/form-generation/services/PDFRenderer.js`. A commit that touches that file makes the server's `git pull` abort ("Your local changes ... would be overwritten by merge"), so the deploy fails. The 12 pt font fix therefore does NOT live there: `FullTextFieldGuard.shrinkLongTextToFit` (called by both `PDFRenderer` and `AdobeFormRenderer`, after the values are written and before their appearances are drawn) calls `AutoFontSizeGuard.applyAutoFontSizeByBoxes`, which recognises the two DOL forms from their own boxes. A test (`externalForms.test.js`) fails if `PDFRenderer.js` ever references the guard again.

## Production environment
No new variable is required. Optional: `EXTERNAL_FORMS_SYNC=false` switches the DOL step off. Restart the backend; the first import runs at the next catalog sync (10 minutes after start, then every 12 hours). Check beforehand with `node src/scripts/checkExternalFormSources.js` (read-only).

## PERM cases (owner decision, 2026-11-07: "no hiding of forms, they may be used with PERM")
PERM keeps `noForms` (nothing is ever assigned to it automatically) and gains `manualForms: true` (`config/visaCategories.js`, `allowsManualForms`). Effects: the Forms tab is no longer replaced by "No forms are associated with the PERM case type" (Admin `CRMCaseDetail.jsx`, `NO_FORM_VISA_TYPES` is now GC-NVC only); `listCaseForms` lists the forms a Case Manager added; `ensureAssignedForms` accepts a Case Manager's own selection for a case type that allows manual forms. GC-NVC and every other case type are unchanged. No PERM case gets a form until a Case Manager adds one.
