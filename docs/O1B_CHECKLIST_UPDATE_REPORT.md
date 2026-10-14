# O-1B checklists - update report

## 1. What existed and what changed
- Before: O-1B cases were served by the shared **o1_employer_checklist / o1_employee_checklist** pair (template ids `6a8e19f38dd95fb60a0ae053` / `...ae09b`), which covers O-1A and O-1B with variant-gated criteria.
- Now: O-1B has a **dedicated pair** built from your exact lists - `o1b_employer_checklist` (E1-E19, 19 questions, id `6acebac9499ea3404884f25f`) and `o1b_employee_checklist` (B1-B30 + the B20 follow-up + 6 criteria = 37 questions, id `6aceb98a9525a48a28590972`).
- The shared pair keeps serving O-1A / bare O-1 and **no longer matches O-1B**, so a new O-1B case can never receive both versions. Existing O-1B case(s) (1 found) keep the checklist references, responses, answers and files they already have (historical records are never deleted or rewritten); only new cases use the new pair. No old answer was auto-mapped to a new question by label similarity.

## 2. Files changed
`questionnaires/o1bChecklists.js` (new definitions), `canonical/config/o1bCanonicalPaths.js` and `partyCanonicalPaths.js` (new registered paths), `employmentChecklists.js` (adds the pair; shared O-1 visa list excludes O-1B), `CanonicalFieldRegistryService.js` (hooks), `questionnaire.service.js` (O-1B keys in the optional-aware submit check; exports `reconcileDefinition`), `form-registry/seeds/checklistMappings.seed.js` + `visaFormMappings.seed.js` (O-1B -> o1b checklists; conditional G-28), `scripts/syncChecklistDefinitions.js` (brings stored templates in line with code; run once per deploy for changed keys), tests below.

## 3. Question inventory and canonical mapping
All questions use the exact supplied wording; types as supplied (addresses are `textarea` free text - the canonical layer splits them only where the text shows the parts; Yes/No are `boolean` radios and stay *unknown* until answered; E16 job locations and B16 dependents are `repeating_group` with the child fields you listed; B20's "If Yes, please explain." is a conditional optional follow-up; the six criteria are separate multi-file uploads with the exact criterion text).
- Scalar identity / company / employment answers map to the **existing** shared paths (`person.*`, `contact.*`, `company.*`, `employment.*`), which the party-alias layer exposes as `beneficiary.*` / `petitioner.*` for every form (so `beneficiary.lastName`, `petitioner.company.name` semantics are kept without duplicate fields).
- New registered paths where none existed: `beneficiary.otherNames`, `...consularProcessing.consulateCityCountry`, `...immigration.{petitionHasValidPassport, intendToReplaceI94, anyPersonInRemovalProceedings, petitionerPreviouslyFiledImmigrantPetition, o1VisaIssuedInPastSevenYears, o1VisaDeniedInPastSevenYears, o1VisaDenialExplanation, priorI797Notices}`, `beneficiary.dependents`, `employment.workLocations`, `beneficiary.documents.*`, `beneficiary.o1bEvidence.criterion1..6*`, `petitioner.company.documents.*`. Document paths name where a file belongs; files stay in the Document model and are never put into scalar PDF fields.
- **Every question and upload is optional** (`required:false`, `metadata.optional`), verified for all 56 questions by test; blank save and blank submit are accepted.

## 4. Forms
Registry (live): I-129 (conditional per registry rules, comes with the case) + its O/P supplement, DS-160 reference (not a USCIS form), I-539 and I-907 conditional (never auto-created), **G-28 conditional (added)**. O-3 dependents are handled by the existing O-3 registry rows (I-539 conditional, DS-160 reference); B16 does not create a dependent case or an O-3 form. I-129 petitioner/beneficiary fields are filled from the generic beneficiary./petitioner. rules (every repeated field). Job-location / dependent / evidence answers are preserved in the profile but not written into I-129 fields (no validated one-to-one field; left for review).

## 5. Tests
- `o1bChecklists.test.js` (5, DB-free): exact names/types/targets, six criteria text, all optional, registered paths, shared pair excludes O-1B.
- `o1b-e2e.test.js` (real DB): see result below. Updated for the new design: `o1VisaChecklists.test.js`, `o2Checklists.test.js`, count guards in `tnChecklists.test.js` / `i140Checklists.test.js` (32 -> 34).
- Also fixed a regression from the earlier TN work found by the existing suite: shared paths (`person.provinceOfBirth`, `immigration.lastArrivalDate`, `company.*`, `employment.*`, address `.formatted`) were not registered; now registered.
- Checklist content suites: 94/94 pass.

## 6. Notes / limits
- Deploy step: run `node src/scripts/syncChecklistDefinitions.js o1b_employer_checklist o1b_employee_checklist o1_employer_checklist o1_employee_checklist` once so stored templates match the code (otherwise the old shared template keeps matching O-1B until its background refresh).
- Legal sufficiency of the six criteria is not assessed; none is required.
