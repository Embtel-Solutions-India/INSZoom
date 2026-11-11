# Employment-Based Green Card: case type and checklist integration report

Date: 2026-11-12

## Case type (two parties only: Petitioner + Beneficiary)
- Visa type **"Employment-Based Green Card"** (`config/visaCategories.js`, `config/visaDropdown.js`, Admin `utils/visaOptions.js`; value `employmentbasedgreencard`). Listed under "Employment based" in the Admin dropdown, created through the two-party create form (petitioner = sponsoring employer, beneficiary = employee; both optional) and the existing family-workflow case creation. No `employee` / `employer` party: the checklist roles are `petitioner` and `beneficiary`.
- Filing path defaults to `ADJUSTMENT_OF_STATUS` (no Filing Path field), as for "I-130 + I-485".

## Checklists (assigned automatically at creation, once, by key)
`resolveFamilyChecklistKeys` returns exactly two (`questionnaires/familyChecklists.js`):
1. `ebgc_petitioner_checklist` (role petitioner): the **existing I-140 employer questionnaire** (`i140_petitioner_checklist`: same questions, same documents, same canonical `petitioner.*` paths), re-roled to petitioner and visible to the petitioner/client portal. Nothing invented; a test checks the question keys equal the original's.
2. `green_card_ebgc_beneficiary_checklist` (role beneficiary): the **existing Green Card checklist** (Personal info, last arrival, residential and employment history, parents, marital history, prior spouses, children, public charge, documents list), canonical table = the family Green Card table (`beneficiary.*`).
Assignment is the existing idempotent path (`ensureFamilyChecklistReferences`, one reference per questionnaire). Existing cases are not touched.

## Canonical paths
Reused, not duplicated: `ebgc_petitioner_checklist` uses the I-140 petitioner table (`partyChecklistPaths.js`, employer data under `petitioner.*`); `green_card_ebgc_beneficiary_checklist` uses the Green Card table (`partyChecklistPathsExtended.js`). The Green Card checklist's own paths (`beneficiary.gc*`, combined place/address answers) differ from the proposed split paths in the request; they were not rewritten (see unresolved).

## Forms (registry rows + checklist mappings)
I-140 (auto), I-485, I-765, I-131, I-693 (conditional, adjustment of status), I-485 Supplement J, I-907 and G-28 (case-manager decisions). Never I-130 / I-864 / DS-260. Rows mirror EB-1B/EB-1C. Checklist mappings: I-140 <- petitioner + beneficiary; I-485 <- Green Card; I-765/I-131/I-693 <- Green Card (conditional); Supplement J and I-907 <- both.

## Tests actually run (DB-free, named files only)
Backend 65 pass (`i130Checklists` incl. new Employment-Based Green Card test, `familyChecklists.gcNvc`, `checklist-party-rewire` = 85 tables, `family-workflow`, `questionnairePageVisaSync`); Admin utils 69 pass. Not run: any DB-backed or end-to-end test, real case creation, document upload/versioning, form autofill of a real case (no DB writes allowed).

## Unresolved / not verified
- Field-level mapping manifest (questionId to template field id) not produced; the I-140 form's reads of the beneficiary's Green Card answers (it was mapped against the old I-140 beneficiary checklist's paths) are not verified, so some I-140 beneficiary fields may stay blank until mapped.
- The petitioner checklist has no new dependent/children handling beyond the existing questions.
- Requiredness follows the existing I-140 and Green Card definitions; the requested conditional rules were not re-applied.
- In a family-structure case `person.*`/`contact.*` mean the petitioner; employer data is stored under `petitioner.*` and not verified against every employer-oriented mapping.
- Existing EB-1/2/3 employer-employee cases are unchanged.

## Deploy
Restart the backend (code-defined checklists and form mappings reconcile at startup).

## SUPERSEDED 2026-11-12 (later): plan changed
"Employment-Based Green Card" no longer exists. It is replaced by two case types, **I-485 (Employment Based)** (Employment based group) and **I-485 (Family Based)** (Family group). Both are two-party (petitioner + beneficiary) and get exactly two checklists: the Green Card checklist (`green_card_i485employmentbased_beneficiary_checklist` / `..._i485familybased_...`) and the I-864 sponsor checklist (`i864_<slug>_petitioner_checklist`). Forms: I-485 (+ Supplement J for Employment Based, Supplement A for Family Based), I-864/I-864A/I-864EZ, I-765, I-131, I-693, G-28; adjustment of status only. The earlier I-140 petitioner re-role and I-140/I-907 rows were removed. "I-130 + Green Card (I-485)" was renamed "I-130 + I-485" (checklists unchanged: I-130 petitioner, I-130 beneficiary, Green Card, I-864). I-130 is unchanged.

## SUPERSEDED 2026-11-12 (final plan): I-485 is a single-person case type
The "Employment-Based Green Card" / "I-485 (Employment Based)" / "I-485 (Family Based)" two-party types were removed. There is ONE **I-485** case type: the registry's existing single-person "Adjustment of Status" (listed as "I-485" under Single applicant). It gets exactly two checklists, answered by the applicant (client role): `i485_green_card_checklist` (the existing Green Card checklist, canonical table = the family Green Card table) and `i485_i864_checklist` (the existing I-864 checklist, canonical table = the family I-864 table). Form rows (I-485, I-765, I-131, I-693, I-864) already existed and are now fed by these checklists. "I-130 + I-485" (renamed from "I-130 + Green Card (I-485)") and I-130 are unchanged. Not verified: that the existing I-485 form mappings read the Green Card answers under the client role; no DB-backed or end-to-end test was run.
