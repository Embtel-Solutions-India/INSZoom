# I-824 — Case Creation, Checklists and USCIS Form Integration

Status: implemented, certified and verified end to end on the shared database (throw-away data permanently removed afterwards).

## 1. Architecture inspected and reused (nothing parallel was built)

| Concern | Reused module |
|---|---|
| Two-party (petitioner + beneficiary) case | `family-workflow` (`createFamilyCase`, `ensureFamilyChecklistReferences`) — the K-1/K-3 model: one shared Case, two checklists by `checklistRole` |
| Case-type registry | `config/visaCategories.js` |
| Checklist engine | `questionnaire.service` (`VISA_TEMPLATE_DEFINITIONS`, `ensureTemplate`, `assignQuestionnaireIfNotActive`), existing client rendering / save-resume / approval gate (`Case.checklistApproval`) |
| Form registry / provisioning | `VisaFormMapping` seeds, `provisionRequiredForms` → `ensureAssignedForms` |
| Canonical data | `CanonicalFieldRegistryService`, `CanonicalBuilderService`, `familyPartyPaths` |
| Mapping + PDF | `PartyFieldMappingService` / `partyFieldRules`, `MappingGraphService`, `AutoFillService`, `PDFRenderer` |
| Form import | `USCISFormImporterService`, `OnDemandFormAcquisitionService`, `EditionMigrationService`, `normalizePdf` (qpdf) |

A pre-existing I-824 template (edition 2026-09-22) and a conditional "Action on Approved Case" add-on row already existed; both are kept unchanged (backward compatible). The new standalone case type is separate: visa type **`I-824`**.

## 2. Case type and related-case linkage

* `config/visaCategories.js`: `"I-824"` (`caseStructure: "family"`, label exactly `I-824`, form `i-824`). One entry only.
* Admin: `visaOptions.js` adds the **I-824** option; `CreateCaseModal.jsx` creates it through the family workflow. Optional, staff-verified intake: underlying approved form, receipt number, approval date, requested action.
* Backend: `family-workflow/i824CaseDetails.js` stores that on `Case.postApprovalAction` with **staff-review flags** (`underlying_petition_form_unverified`, `underlying_receipt_number_missing`, `underlying_approval_date_missing`, `requested_action_unverified`, `underlying_petition_not_i130_verify_workflow`, `consular_or_other_agency_route_staff_review`) and a timeline entry. If an original case number is supplied it is linked through the existing `Case.linkedCases` (relationship `related`); the original case and its history are never modified. Nothing assumes the approval was an I-130, and the case is never converted to another type.
* Existing creation authorization (staff roles only on `POST /family-workflow/cases`) is unchanged.

## 3. Checklists (`questionnaires/i824Checklist.js`)

Exactly two checklists; **no Principal Immigrant checklist exists**. Every question and upload has `required:false` (+ `metadata.optional`). Question keys are `i824_petitioner_*`, `i824_principal_*`, `i824_beneficiary_*`.

**I-824 — Petitioner Checklist** (`checklistRole: petitioner`, key `i824_petitioner_checklist`)

| Section | Labels (exact) → canonical path |
|---|---|
| Information about the Petitioner | Last/First/Middle Name, Date of Birth, Country of Birth / Citizenship (country selector), Company or Organization Name (if any), Current Immigration Status (single select: US Citizen; Lawful Permanent Resident), Certificate of Naturalization/ Citizenship Number (if any), A Number (if any), IRS Tax Number (if any) *(sensitive)*, Social Security Number *(sensitive, masked)*, USCIS Online Account Number, Mailing Address, Physical Address (if different from Mailing Address) → `petitioner.*` (`lastName … physicalAddress`) |
| Information about the Principal Applicant | Last/First/Middle Name, Date of Birth, Country of Birth/Citizenship, A Number (if any), Daytime Telephone Number (phone), Mailing Address, Physical Address (if different…) → `principalImmigrant.*` |
| Documents required from Petitioner | naturalization certificate, green card (multi), passport, SSN, driver's license/State ID, I-130 approval notice → `petitioner.documents.{citizenshipCertificate,greenCard,passport,ssnCard,stateId,i130ApprovalNotice}` |
| Documents required from Principal Immigrant | passport, green card (multi), SSN, driver's license/State ID, evidence of relationship (multi) → `principalImmigrant.documents.*`; each question carries `metadata.documentOwner = "principal_immigrant"` |

**I-824 — Beneficiary Checklist** (`checklistRole: beneficiary`, key `i824_beneficiary_checklist`): Last/First/Middle Name, Date of Birth, Country of Birth/Citizenship, Relationship to Principal Applicant, Daytime Telephone Number, Foreign Telephone Number, Email id, Outside US Address of beneficiary → `beneficiary.*`; documents: passport, evidence of relationship (multi) → `beneficiary.documents.{passport,relationshipEvidence}`. No petitioner or principal content.

Addresses reuse the existing structured `address` input (`line1, line2, city, state, postalCode, country`). Canonical paths are registered in `canonical/config/i824CanonicalPaths.js` and wired into `CanonicalFieldRegistryService`.

**Person separation.** Three disjoint namespaces: `petitioner.*`, `principalImmigrant.*`, `beneficiary.*`. Principal-immigrant uploads become `Document` records tagged `participantRole = principal_immigrant` (description "Document of the principal immigrant"); OCR from them is never routed into the petitioner's or beneficiary's profile (`partyOf` returns no party, so party-ambiguous paths are dropped). **Confirmed: all principal-immigrant data lives only in the Petitioner Checklist.**

*Notes / limits.* The file input is always multi-entry in the existing UI, so "file upload" vs "multi-file upload" is recorded in `metadata.multiple` but both accept several files. A family Case holds one beneficiary record, so the beneficiary section is single-person; additional derivative beneficiaries (the PDF has slots for four) are a staff item — this repo has no repeated-person beneficiary schema to reuse, and none was invented. `metadata.sensitive` is recorded on SSN/IRS items; the end-to-end test confirms the SSN is not written to the form audit trail.

## 4. Assignment and approval workflow

* `resolveFamilyChecklistKeys` returns exactly `[i824_petitioner_checklist, i824_beneficiary_checklist]` for any spelling and any filing path; `assignQuestionnaireIfNotActive` is idempotent by questionnaire id, so retries never duplicate (verified, including re-running provisioning twice).
* `ensureFamilyChecklistReferences` now self-heals a not-yet-materialised built-in template (`ensureTemplate(..., { wait: true })`) instead of skipping it.
* The existing Case Manager release gate (`CHECKLIST_NOT_APPROVED`) and save/resume behaviour are untouched.
* Registry: `checklistMappings.seed.js` maps Form I-824 (visa type `I-824`) to the two checklists by role.

## 5. USCIS forms (registry rows for visa type `I-824`)

| Form | Provisioning | Why |
|---|---|---|
| **I-824** | AUTO_CREATE (core form of the case) | official active template from the registry |
| G-28 | CONDITIONAL (`attorneyOnRecord`) | only when attorney representation applies |

No I-130, I-485, I-864, I-129, DS-260 or DS-160 is registered or assigned; the I-130 approval notice is evidence. A consular / other-agency requested action is only a **review flag**. Requested action and underlying approval are staff-verified (flags above); Form I-824 is assigned because the case type itself is the I-824 filing.

## 6. Verified I-824 PDF mapping

Template: active registry template `I-824` edition 2026-09-22 (181 fields; identical field set to the 2024-01-04 file). Mapping version 5 is **active**, 0 validation errors, 0 review-required edges. 65 fields are mapped by 59 verified rules (`form-mapping/config/i824FieldRules.js`, every rule keyed on the real PDF field-name stem):

* **Part 1 – petitioner** (names, company, status, certificate no., A-number, DOB, countries, IRS no., SSN, USCIS account no., mailing and physical address incl. state/country transforms) ← `petitioner.*` (names/DOB/countries fall back to the family `person.*` petitioner namespace).
* **Part 3 Items 2-4 – principal applicant** (name, DOB, country of birth, A-number, phone, mailing and physical address) ← `principalImmigrant.*`.
* **Part 3 Items 5-10, 33-34 – beneficiary** (name, DOB, countries, relationship, email, daytime phone, outside-U.S. address, foreign phone) ← `beneficiary.*`.

The 42 previous auto-guessed edges (e.g. `company.name` on beneficiary name boxes, the applicant's phone/e-mail on interpreter/preparer boxes) were **removed**, not extended. 110 fields are deliberately unmapped and listed in `graph.intentionallyUnmapped` for staff: Part 2 requested-action boxes, Part 3 Item 1 (underlying form/receipt/dates), applicant-vs-petitioner and G-28 boxes, Apt/Ste/Flr type boxes, foreign state/province of the petitioner address, preparer/interpreter/signature blocks, beneficiaries 2-4, additional-information page. Unresolved filing items therefore stay for Case Manager review; nothing is fabricated. Part 3 Line 33-34 follow the supplied checklist ("Outside US Address of beneficiary" / "Foreign Telephone Number") — please confirm they are the intended beneficiary slot on the current edition.

`manualOverrides`, `fieldValueProvenance` and regeneration use the existing `AutoFillService`/`PDFRenderer` pipeline unchanged.

## 7. Automatic, code-only form pipeline (new)

Requested: every stage must run from code triggers, with retries, backups, no data loss and no old-form removal until the new form is certified.

| Stage | Code | Trigger |
|---|---|---|
| Fetch + import | `acquireMissingForm` now wrapped in `utils/resilientRetry.js` (bounded exponential backoff + jitter, rotates variants; 400/403/413/429/5xx/timeouts/bad-gateway retried; permanent errors stop) | case needs a missing form (`registryAutoCreateTemplates` self-heal), edition scan |
| qpdf install | `utils/ensureQpdf.js` (PATH → known locations → winget/choco/scoop · brew · apt/dnf/apk; opt-out `QPDF_AUTO_INSTALL=false`) | `normalizePdf` on `ENOENT`, then retries normalization |
| Decrypt + XFA removal | existing `normalizePdf` (`--decrypt`, object streams off) + `XfaPurgeGuard` | every import / render |
| Edition matching + mapping carry-over | existing `EditionMigrationService` | `activateOrPromote` |
| Mapping from rules | `PartyFieldMappingService.apply` (retried) for any form with authored rules | `activateOrPromote` |
| Component slicing | existing `checkEditionReady` / component discovery | `activateOrPromote` + certification |
| **Certification engine** | `form-mapping/services/FormCertificationService.js`: `pdf_fillable`, `mapping_valid`, `fill_roundtrip` (every mapped field written, saved, reloaded, read back — i.e. not blank), `viewer_download` (valid PDF, same page count), `components_slice`; report stored in `importMetadata.validationSummary.certification` | runs automatically on every new edition; **only a PASS may promote it** |
| Backup | `backupTemplate` writes `Backend/backups/forms/<form>-<version>-<ts>.json` (graph + metadata) before promotion; mapping versions are append-only | before activation |
| Old edition kept | unchanged rule + certification gate: the live edition is not retired until the new one passes; case forms migrate (`migrateCaseFormsToEdition`) only after promotion | automatic |

On demand: `node src/scripts/certifyForm.js I-824 [--apply]` (backup → rules mapping → visa-type scope → certification; exit code 1 on failure).

Honest limits: retries are bounded (5 attempts per request) rather than infinite - an unbounded loop would hang a request; after the bound the error is recorded and the existing hourly self-heal cooldown retries on the next trigger. **Mapping for a form with no authored rules is now inferred by code** (`FieldRuleInferenceService`): only the filer's own Part 1 identity facts (name, date of birth, countries, A-number, SSN, email, phones) are mapped, to `beneficiary.*`; addresses, other people (spouse, sponsor, preparer, interpreter, ...), repeated "other names" lines, signatures, barcodes and checkboxes are never inferred and are listed in `graph.intentionallyUnmapped` for the case manager. Authored rules always win. An inferred form is promoted only if certification passes, so it opens, shows and downloads without error, but its address and multi-party fields are filled manually until rules are authored for it. **Live proof (first-ever import, code only):** `node src/scripts/verifyFormImportEndToEnd.js I-912` downloaded Form I-912 from uscis.gov, normalized it (qpdf decrypt / XFA removal), imported it (221 fields), built 12 mapping edges by inference, activated the mapping, certified it (5/5 checks), promoted the edition and ran the case-form migration - 5/5 checks, then removed only the records it created. The run exposed and fixed four defects in the code itself: edition strings such as `07/22/2025` broke the backup file name; the filer's identity block was only looked for in Part 1 (and `P10` matched `P1`); the importer's unreviewed guessed edges blocked mapping activation; and `activateOrPromote` kept the whole `{ template, impact, ... }` object returned by `activate`. Not exercised: qpdf auto-install on a machine without qpdf.


### Autopilot (no manual script runs)

`form-registry/FormPipelineAutopilot.js`, started by `server.js` (45 s after boot, then every 6 h, lock-guarded across instances; opt out with `FORM_AUTOPILOT=false`), does by code what was first done by hand: (1) registry gap-fill - seed rows and checklist mappings only for visa types the DB lacks, never overwriting an existing row; (2) component linking - re-runs slicing discovery when any FORM_COMPONENT row has no `componentCode` (`loadVisaFormMappings.js` now does the same after a reseed; this fixed the `L-1A Extension` row); (3) per-form readiness for rule-exclusive forms (I-824): scope visa types from the registry, build the mapping from the rules, certify, skip when already certified for that edition. Covered by `form-registry/tests/FormPipelineAutopilot.test.js` (3 tests, passing).


### 12-hour catalog sync (every uscis.gov form, installed or not)

`uscis-lifecycle/jobs/USCISCatalogSyncJob.js` (started in `server.js`; every 12 h, first run 10 min after boot; lock `uscis-catalog-sync`; `USCIS_CATALOG_SYNC=false` disables) runs `FormCatalogSyncService.runCatalogSync`: it crawls the whole all-forms directory, compares each form's published edition (the form's own page is authoritative) with the installed edition, and sends every **new** form or **edition-changed** form (example: installed I-589 01/04/2026 vs published 04/09/2026) through the existing import pipeline. Changed installed forms go first, then new forms; each run is bounded (`USCIS_CATALOG_MAX_FORMS_PER_RUN`, default 15) and the remainder is picked up by the next run. The edition being replaced stays live until the new one is fetched (retried), qpdf-normalized, mapped, certified and scoped to its registry visa types; only then is it promoted and the open cases migrated with all saved values (`migrateCaseFormsToEdition`). A failure or failed certification leaves the installed edition untouched and is retried next run. Entry point for a manual run of the same code: `node src/scripts/runCatalogSync.js [--apply] [--only I-589]` (dry run by default). Live dry run against uscis.gov: 101 forms listed, 24 up to date, 1 edition-changed/unknown (G-28), 74 not in the software.

**Where `beneficiary.*` / `petitioner.*` go:** decided from the registry, not guessed. A new edition first carries its earlier edition's verified mapping forward; authored rules (e.g. I-824) are applied next; inference of the filer's own identity block to the applicant root `beneficiary.*` is allowed only when every registry visa type using the form is a single-applicant case (or, for a form the registry does not know, when it is not a petition). Petition / sponsored forms (family or employer structure) are never inferred: they keep the earlier edition's mapping or authored rules, and without either they stay in review (not promoted) rather than risk putting one person's data in another's field.


### Edition date and file naming (canonical, set once at import)

* `editionDate` is a date; `version` is always **yyyy-mm-dd** of it (the old helper returned `MM/DD/YYYY`, which is how I-912 got `07/22/2025`). Date-shaped versions supplied by callers are normalised. The edition printed on the PDF wins; the date USCIS shows on the form page is stored separately as `importMetadata.publishedEditionDate` (with `editionDateSource`: `pdf` | `uscis_page` | `import_date`), because the catalog sync compares the page with the page. With no date at all the import date is used and marked `import_date` - never silently treated as an edition.
* Every imported file is stored as **`<form>_<yyyy-mm-dd>.pdf`** (e.g. `i-129_2026-09-09.pdf`) under its immutable hash folder. `FormPipelineAutopilot` also copies the forms fetched automatically before this rule from `.../form.pdf` to that name (copy verified byte for byte before the template is switched; the old object is kept; hand-uploaded and scanner forms untouched) and backfills a missing `editionDate` from a clean yyyy-mm-dd version. When an edition check finds nothing new, the catalog sync records the page date so the form compares normally from then on.

## 8. Persistence / Admin synchronization

Verified by `src/scripts/verifyI824EndToEnd.js` against the real services and DB (all data then permanently deleted; dry principle: only rows for that run's case/e-mails): case created as `I-824`; underlying approval stored; exactly two checklists assigned; one I-824 `CaseForm` (idempotent) and no I-130/I-485/I-864/DOS form; petitioner / principal / beneficiary answers persisted; canonical profile keeps the three people separate; autofill writes each into its own PDF block; SSN absent from the audit trail; the rendered PDF is non-blank with the saved names. Staff read the same `Answer`/`Document`/`CaseForm` rows through existing APIs and permission checks.

## 9. Tests

New, all passing (29): `questionnaires/tests/i824Checklists.test.js` (exact labels/types/paths, optionality, ownership, two checklists, registry rows), `form-mapping/tests/i824Mapping.test.js` (real field names from `fixtures/i824-template-fields.json`, person isolation, stale-edge replacement, idempotency, transforms), `utils/tests/resilientRetry.test.js`, `family-workflow/tests/i824CaseDetails.test.js`. Plus the live certification (5/5 checks) and end-to-end script (9/9). Admin `vite build` succeeds. Regression results: see §10.

## 10. Regression

Targeted regression over questionnaires, form-registry, form-mapping, family-workflow, canonical and utils (a full-suite run stalled on a hanging DB test and was stopped; the 12 files that had failures were re-run: 47 pass / 13 fail).

* **Caused by this work and fixed:** `family-workflow.test.js` pinned the exact `FAMILY_SINGLE_CASE_VISA_TYPES` set; updated to include `i824`. Passing.
* **Not touched by this work (I-539 / I-907 / MappingGraph / I-130 golden-case tests):** `MappingGraphService` (fails identically with this change reverted), I-539 Part 3 name edges mapped to `company.name`, I-907 classification edge, `Phase 2` / `P0-CD-001` I-130 tests ("checklist not released by your case manager yet" - approval gate in those fixtures), and `L-1A Extension` FORM_COMPONENT row without `componentCode`. None reads any file or data I changed.
* **Registry-expectation tests (L-1B / scaffold / H-1B I-907 / CR-1 joint sponsor, 5 tests):** they compare the DB's checklist mappings with expectations last written 2026-09-29, while the repository seed (`checklistMappings.seed.js`) has carried L-1B and I-907 profile checklists since 2026-10-02, so they contradict the committed seed. **Caveat:** to register the I-824 mappings I ran the seed's `seedChecklistMappings()`, which re-applies the seed to all 214 rows. I could not capture the earlier DB values, so I cannot prove the DB did not differ from the seed before; if it did, those registry rows changed. If the previous registry state matters, restore it from a database backup taken before 2026-10-14.
* New tests (29), the I-824 certification (5/5) and the end-to-end script (9/9) all pass; Admin `vite build` passes.

## 11. Blockers / staff-review conditions

* Part 2 requested action and Part 3 Item 1 (underlying petition) are not auto-filled — they need the staff-verified action; capture exists on `Case.postApprovalAction`.
* Multiple beneficiaries: not representable in the existing family model.
* Apt/Ste/Flr unit-type boxes and the applicant/petitioner check boxes are left for staff.
* The running API process caches form templates; it picks up the new `I-824` visa-type scope after its template-cache TTL or a restart.
