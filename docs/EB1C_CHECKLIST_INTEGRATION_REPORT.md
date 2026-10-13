# EB-1C (Multinational Manager / Executive) — checklist integration report

## 1. Existing implementation inspected
- `EB-1C` was registered as an `employer_employee` case type (forms I-140, I-485) and had VisaFormMapping rows (I-140 AUTO_CREATE, I-485 / I-765 / I-131 / I-693 / I-907 / I-485 Supplement A and J / DS-260 CONDITIONAL) but **no checklists**, so it was hidden from the Admin "New case" list. EB-1B is the pattern followed.
- Employer-sponsored lifecycle (unchanged, reused): Admin `createCase` makes a **principal (employer) case** with an employer participant plus a **child employee case** (`parentCase`); the shared lifecycle orchestrator provisions one checklist reference per case (employer on the principal, employee on the child); every checklist starts as a draft until a case manager approves it (`checklist-gate.js`).
- Shared petitioner/employer data lives in the existing employer account/profile; I did not add a second company model. I-140 template: active, approved, mapping active (24 edges), already lists EB-1C.

## 2. Files changed
| File | Purpose |
|---|---|
| `employment-workflow/questionnaires/eb1c.js` (new) | Single catalog of the 43 requirements (exact labels, ids, canonical targets), normalizers, registry matcher |
| `employment-workflow/questionnaires/registry.js` | registers `eb1c` |
| `questionnaires/eb1cChecklists.js` (new), `employmentChecklists.js` | builds the two templates and adds them to the template list |
| `canonical/config/eb1cCanonicalPaths.js` (new), `CanonicalFieldRegistryService.js` | registers 69 canonical paths |
| `questionnaire.service.js` | `metadata.sumGroup` validation (duty percentages add up to 100 only when all four answered); EB-1C pair added to the opt-in strict submit check; the strict check now skips `metadata.optional` questions (fix to my earlier I-90 work) |
| `form-registry/seeds/checklistMappings.seed.js`, `visaFormMappings.seed.js` | EB-1C checklist mappings for I-140 / I-485 / I-765 / I-131 / I-693 / I-907; conditional **G-28** row for EB-1C |
| `form-registry/form-registry.controller.js` | **forms-overview now lists every mapped independent USCIS form of the visa**, with the reason it is not on the case yet (see §6) |
| `form-registry/visaFormMapping.service.js` | an explicit case-manager Add / Acquire ignores only the filing-path restriction (trigger conditions still enforced) |
| `form-mapping/config/g28-crosswalk.js`, `seeds/g28-mapping.seed.js` (new) | **draft G-28 mapping for your approval** (see §7) |
| `Admin`: `CreateCaseModal.jsx`, `visaOptions.js`, `CRMCaseDetail.jsx` | EB-1C offered in "New case"; "applies when …" note on other-form rows |
| Tests | `eb1cChecklists.test.js` (7), `eb1c-e2e.test.js` (real DB); count guards in `i140Checklists.test.js` / `tnChecklists.test.js` 30 → 32 |

Database effects: 10 EB-1C registry rows (1 created: G-28), checklist mappings on 6; both EB-1C questionnaires reconciled lazily; G-28 draft mapping version 6.

## 3. Checklists
`eb1c_employer_checklist` "EB-1C Employer/Petitioner Checklist" (role employer) and `eb1c_employee_checklist` "EB-1C Employee/Beneficiary Checklist" (role employee); `visaType EB1C`, default, draft until approved. **Every question is optional** (`required:false`, `metadata.optional`, so nothing blocks Submit; a submit with everything blank passes).

**Count note.** Your tables list **29 employer uploads + 2 website URLs** and **10 employee uploads** (items 26–30, 32–36), not 27 and 9; with the numbered family items 37–40 that is exactly items 1–43. All are implemented as listed.

- Employer (31 questions): items 1–16 US company, 17–25 + 31 foreign company / qualifying relationship, 41–43; URLs 7a, 20a (text validated as a web address, grouped with items 7 / 20; the screenshot upload remains). Question ids `eb1c_us_*`, `eb1c_foreign_*`, `eb1c_qualifying_*`.
- Employee (38 questions): items 26–30, 32–36 (`eb1c_beneficiary_*`); four optional duty percentages next to item 29 (0–100, total 100 only when all four are given; never inferred); optional `has_spouse` / `has_children` (unanswered = unknown) plus an optional child count; spouse items 37a, 38a, 40 shown when spouse = Yes; **child records 1–6** each with its own passport / I-94 / birth certificate uploads (items 37b, 38b, 39), shown as many as the count says.
- Every upload keeps `documentType == question key` (file reference in the Document model; never stored in the canonical profile). Each question carries its supplied canonical path (e.g. `petitioner.usCompany.documents.articlesOfIncorporation`, `beneficiary.family.children[1].documents.passport`).

## 4. Case creation and linkage (verified end to end)
`createCase` (Admin payload) → principal case + 1 employee case linked by `parentCase`, employer account as owner, employer participant. Verified: exactly one reference each (employer on principal, employee on child), still one after re-running provisioning, exactly one I-140 CaseForm, gate hides both from the client until approved, another client is refused, partial answers persist, canonical values land with provenance (`beneficiary.family.hasSpouse = true`, URLs on `petitioner.*`), submit with blanks passes, percentages totalling 110 are refused.

## 5. Tests
`eb1cChecklists.test.js` 7/7, `eb1c-e2e.test.js` pass (re-run alone; it can fail under many parallel database tests with a `VersionError`/connection timeout), count guards updated. Regression over `questionnaires`, `form-registry`, `uscis-forms`: failures that are **not from this work** — `checklistMappings` H-1B / Family / gaps / scaffold tests (the I-907 profile checklist appended to every I-907 row by the earlier I-907 integration), `h6-conditional-forms` "bare H-1B attaches one of I-907/G-28/I-539" (fails identically with my template experiment reverted). Two further failures in that run (I-907 and EB-1C end-to-end) were load flakiness and pass alone.

## 6. Forms visibility (your question) — and what I fixed
**Why those forms were hidden.** EB-1C is an employment-based immigrant case. After the I-140, the beneficiary either adjusts status in the U.S. (I-485 + I-765 work permit + I-131 travel document + I-693 medical) or goes through consular processing abroad (DS-260). The registry therefore only offers I-485 / I-765 / I-131 / I-693 / supplements on the **Adjustment of Status** filing path, and G-28 only when an attorney is on record. Employer cases have no screen to choose the filing path, so the list silently dropped them.
**Fix.** The overview lists every independent USCIS form mapped to the visa (all visas, not only EB-1C), each with an "Applies when …" note, and "Add" now works for them. Verified on a real EB-1C case: I-140, I-485, I-765, I-131, I-693, I-907, G-28 all listed; Add on I-485 provisions it.
**Not listed by design (existing architecture):** DS-260 (a State Department form) and I-485 Supplements A / J (components of the I-485), per the overview's own "independent USCIS forms only" rule.
**Caveat.** I tried scoping the I-485 / I-485 Supplement J / I-907 templates so they would not auto-attach; that broke Add (the template then refused the case), so it was **reverted** — they still auto-attach to EB cases through the legacy template rule, exactly as for EB-1B. The spec's "I-485 / I-907 only when conditions are met" is therefore **not** met for those three; fixing it properly needs a decision on the platform's legacy visa-type rule.

## 7. G-28 (inactive form fetched from USCIS)
The existing acquisition service found the current G-28 (edition 2026-09-22, 101 fields) and activated its biographic mapping, but **activation of the template is blocked until a mapping is validated and approved** ("Activate and validate the form mapping before activating this USCIS edition"). I authored the mapping: **23 fields**, Part 3 (client name, A-Number, USCIS account, phone / mobile / e-mail, mailing address with the Apt / Ste / Flr boxes, receipt number) plus the repeated client name; saved as a **draft version (v6), not activated**. Left manual with reasons (in `g28-crosswalk.js`): Part 1 attorney identity (no canonical source), Part 2 eligibility declarations, appearance scope, the client's legal capacity boxes, entity block, consent / signatures / dates. Edges are marked `sourceVerified:false`; I have not rendered a filled G-28 PDF to check box positions, so please review before approving. To approve: Form Governance → G-28 → mapping version 6 → activate, then activate the template.

## 8. Unresolved
- I-140 scalar fields (company / beneficiary identity) come from the shared employer and employee profiles; the checklists are document-centric as specified, so no new I-140 crosswalk was built.
- G-28 / other inactive forms: approval pending (above). I-131 and I-765 have newer review-status editions beside the active ones (not touched).
- Child records are numbered upload sets (max 6), not a separate dependent entity (none exists in the platform).
- Client-portal self-registration intake list (`visaConfig.js`) was not changed; EB-1C is offered to staff in Admin.

## 9. Fetched USCIS forms: automatic edition upgrade (no AI)
Edition detection was already rule-based (`USCISScannerService` page scrape + checksum, `normalizePdf` strips XFA and rewrites to a clean AcroForm). New pieces, all code, none AI:
- `form-mapping/services/EditionMigrationService.js`: after a new edition is imported, builds its mapping automatically - the form's authored crosswalk (G-28) or the previous edition's graph carried forward by PDF field name / id. A field that disappeared is **dropped from the mapping and reported**, never guessed. If nothing was lost and the graph validates, the mapping is activated and the edition goes live (the old one is retired, visa types are carried over, so every visa resolves the new edition by form number). Otherwise the old edition stays in service and the result lists the fields needing a person.
- `form-mapping/services/CaseFormEditionMigrationService.js`: moves every open case form of the old edition onto the new one. Values are matched by id / PDF name / name without `#subform[n].` / detected rename; a value with no counterpart is **archived on the form (`editionMigrations[]`), never dropped**; counts must reconcile or that form is left untouched; autofill reruns and any carried value it left blank is restored; manual overrides are kept. Finalized / filed / locked forms stay on the edition they were filed on.
- Wired into `OnDemandFormAcquisitionService.activateOrPromote`; `downloadForm` also checks USCIS for non-active templates on every download and reports a newer edition in `X-Form-Warnings`.
- External edit: `POST /form-generation/:caseFormId/external-edit` + Forms-tab buttons "Edit in browser" (opens the autofilled PDF) and "Save edited PDF" (keeps changes as manual overrides).
- Verified with a self-cleaning test on cloned G-28 editions (one field removed, one renamed): lost edge reported and activation correctly withheld; case values 4 carried + 1 archived = 5, template moved, override kept. Not yet verified: a live end-to-end run against uscis.gov with a real new edition, and the browser UI buttons.
- `scripts/replaceFormEdition.js` (manual, I-485 only) is unchanged and still drops unmatched values; prefer the new service.
