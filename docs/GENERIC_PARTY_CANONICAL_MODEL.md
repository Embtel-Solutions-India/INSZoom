# Generic Party Canonical Model (petitioner.* / beneficiary.*)

**Status: all checklists except PERM (125 of 128) mapped and tested on the local test database. NOT yet applied to the real database** (a reviewed dry run is available; see "Applying it").

## The rule
Every USCIS filing is about two people:

| Party | Who it is |
|---|---|
| `petitioner.*` | the sponsor: the **employer** in an employer-sponsored case, the **person filing** in a family case |
| `beneficiary.*` | the person the filing is for: the **employee** in an employer case, the **applicant** in a family case |

A checklist question stores its answer under one of these paths (for example `petitioner.name`, `petitioner.address.city`, `beneficiary.dateOfBirth`, `beneficiary.passport.number`). A form box reads the same generic path. **Where the two match, the box is filled from the client's answer.** Neither side knows the other: no path is named after a form or a visa, and a form box is never wired to a checklist question key.

Facts about the filing itself (the job offered, the LCA, a prior receipt number, the filing type) belong to the petitioner who files it: `petitioner.petition.*`, `petitioner.job.*`, `petitioner.lca.*`.
Existing names are reused wherever one was already in use (`petitioner.name`, `petitioner.ein`, `petitioner.address.*`, `petitioner.signatory.*`, `beneficiary.firstName`, `beneficiary.dateOfBirth`, `beneficiary.alienRegistrationNumber` ...). Single-party cases are out of scope of batch 1 and unchanged.

## Where things live
| What | File |
|---|---|
| question key -> generic path (125 checklists, 7,237 questions) | `Backend/src/modules/canonical/config/partyChecklistPaths.js` |
| applied to the checklist definitions (so a fresh database and the definition reconciler carry it) | `applyChecklistPartyPaths` in `questionnaires/questionnaire.service.js` |
| generic paths registered as known canonical fields | `CanonicalFieldRegistryService.js` (additive) |
| generic -> older shared paths back-fill | `canonical/services/PartyAliasService.js` |
| form graph edges rewired to the generic paths | `form-mapping/services/ChecklistPartyRewireService.js` |
| the migration (dry run by default, rollback) | `Backend/scripts/apply-party-checklist-paths.js` |

## How it flows
1. The client answers a question. Its stored `mapping.canonicalPath` is e.g. `petitioner.address.city`.
2. `CanonicalBuilderService` writes the answer to that path in the case's canonical profile (family routing leaves `petitioner.*` / `beneficiary.*` untouched).
3. **Back-fill (so nothing else breaks):** other forms, the employee / employer profiles and document rules still read the older shared paths (`person.*`, `contact.*`, `company.*`, `immigration.*`). A blank older path is filled from its generic twin; an existing value is never overwritten; running it again changes nothing. In an employer case `beneficiary.X -> person.X`, `petitioner.X -> company.X`; in a family case `petitioner.X -> person.X` (there `person.*` is the petitioner) and `beneficiary.*` is left alone.
4. The form's mapping graph reads `petitioner.*` / `beneficiary.*`; `AutoFillService.generate` fills the box. The report (`autoFillReport.summary`) says what was filled, what needs the client, what no checklist can fill.

## The form side, safely
`ChecklistPartyRewireService` turns edges that read `raw.questionnaireAnswers.<question key>.value` into edges that read the question's generic path:
- the old key stays as the edge's **fallback**, and conditions accept either path (positive tests: either; negative tests: both), so a profile that only has the old answer still fills the box;
- an edge an earlier pass wired by PDF field name (the live I-907 reads `petitioner.address.*` for both mailing and physical boxes) is **retargeted** when the question has its own path: the physical box reads `petitioner.physicalAddress.*` and falls back to what it read before;
- nothing is removed; the result is a **new mapping version built from the ACTIVE version** (a template's "latest" pointer can be a retired version: I-129's is v18, retired; the active one is v15), activated only if it validates; CaseForms already created keep their locked mapping version;
- every rewired edge remembers its original (`partyRewire`); `planRollback` restores it exactly.

## Decisions to confirm (things I chose that you may want different)
1. **Form I-907** follows the live mapping for the person filing and the petitioner-or-applicant: both are `petitioner.signatory.*` (one person, one set of facts: two different answers become a data conflict for staff to resolve, like any shared fact). The **company point of contact** is a separate person, so it is `petitioner.pointOfContact.*` (decided in review); its boxes read it first and fall back to the signatory, so the result is the same as today when no separate contact is answered. Mailing address = `petitioner.address.*`; physical address = `petitioner.physicalAddress.*`.
2. **Filing facts under the petitioner** (`petitioner.petition.*`, `petitioner.job.*`, `petitioner.lca.*`) rather than a third root, to keep to two roots.
3. **`beneficiary.dateOfBirth`** is the existing name (not `beneficiary.dob`).
4. `petitioner.lastName` / `firstName` (an individual petitioner) and `petitioner.signatory.*` (a company's representative) both exist; a company petitioner uses `petitioner.name`.

## Applying it (real database)
```
node Backend/scripts/apply-party-checklist-paths.js                      # dry run: prints exactly what would change, writes nothing
node Backend/scripts/apply-party-checklist-paths.js --apply              # draft checklists + every form graph that reads them
node Backend/scripts/apply-party-checklist-paths.js --apply --include-published   # also the PUBLISHED h1b_employer_checklist (36 questions)
node Backend/scripts/apply-party-checklist-paths.js --rollback --apply   # puts every question path and graph edge back exactly
```
Published checklists are immutable through the app, so they are only touched with `--include-published`; only each question's stored canonical path changes (not the questions, options or answers). Until a published checklist is migrated its values still reach the form through the old-key fallback.

## Tests
- `form-mapping/tests/checklist-party-rewire.test.js` (pure rewire / rollback / conditions / retarget; and, on I-129, I-907, I-130, I-129F: the same boxes filled with the same values from the old answers, from generic paths, and from the old answers through the rewired graph)
- `h1b-e2e/tests/h1b-generic-party-e2e.test.js` (real pipeline: H-1B employer + employee answers -> petitioner.* / beneficiary.* -> I-129 boxes; older paths back-filled)
- `uscis-forms/tests/case-form-selection.autofill-e2e.test.js` (IR-1 petitioner / beneficiary answers -> I-130, on a family case and an unrelated visa case)

## Batch 2 (what it adds)
Checklists: `l1a_employer_checklist`, `l1a_employee_checklist`, `tn_employer_checklist`, `tn_employee_checklist`, `i140_petitioner_checklist`, `i140_beneficiary_checklist`, `i130_ir1_beneficiary_checklist`, `i864_ir1_petitioner_checklist`. Every non-file question of each is mapped (checked by script: 0 left without a path).
- A question key that two checklists share keeps ONE path (tested), so the same fact is stored once.
- L-1A: the qualifying foreign company is `petitioner.foreignCompany.*`; what the employee did there is `beneficiary.foreignEmployment.*`.
- I-140: the labor certification is `petitioner.laborCertification.*`.
- I-864: the sponsor is the petitioner and shares the I-130 petitioner paths; a **joint sponsor** is `petitioner.jointSponsor.*` (never a third root).
- A single-line address answer is kept whole at `petitioner.address.formatted`, `beneficiary.currentAddress.formatted` or `beneficiary.foreignAddress.formatted`; `PartyAliasService` copies it to the older path and splits it into parts.
- The same questions exist in sibling checklists (L-1B / L-1A extension, CR-1 / IR-2 / F-categories ...). Their form boxes are already rewired (the rewire is by question key); the checklists themselves are not listed yet and keep their old paths until a later batch.

## Batch 3 (what it adds)
Checklists: `e3_employer/employee`, `p_employer/employee`, `o1_employer/employee`, `o2_employer/employee`, `k1_petitioner/beneficiary`, plus `k3_petitioner/beneficiary` (the same questions as K-1; the shared I-130 / I-129F graph reads those keys for both, so they must move together).
- Employer / employee blocks reuse the entries of earlier batches (same key = same fact = same path). New: the petition's classification and event (`petitioner.petition.classification` / `.natureOfEvent`), "held / denied this classification in the last 7 years" (`beneficiary.heldClassificationWithinSevenYears` ... one fact whatever the visa is called), K-1 petitioner / beneficiary on the IR-1 vocabulary (parents `*.father.*` / `*.mother.*`, earlier petition `petitioner.priorPetition.*`).
- Family petitioners' new `petitioner.*` paths are copied back to the `person.*` paths family forms read (`PETITIONER_FAMILY_LEGACY`).
- **PERM is deliberately not included**: it has its own canonical pipeline (`permCanonicalPaths`, `education.N.*`, `perm.*`, address objects) that other code depends on; it needs its own reviewed step.
- An edge that already had a fallback keeps it (the engine has one fallback per edge); the old question key is then not read for that box. That affects only the shared I-130 graph (50 boxes) and 6 on I-129F, whose earlier fallback is the canonical `person.*` path every migrated checklist fills.

## Everything else (batch 4) - 64 more checklists + 37 repeats
Table: `partyChecklistPathsExtended.js` (one row per question, generated and then reviewed). Who is who:
- **Single-person filings** (N-400, N-600, N-565, I-131, I-90 green card renewal, SB-1, change of address, change of status F-1 / F-2 / B-1 / B-2 / H-4, F-1 reinstatement, H-4 extension / EAD): the person filing is the **petitioner** (`petitioner.*`) - as you described; relatives and sponsors inside such a checklist are kept under it (`petitioner.father.*`, `petitioner.currentSpouse.*`, `petitioner.sponsor.*`).
- **Family green card and NVC checklists** (all 12 categories) and the general NVC checklist: the applicant is the **beneficiary**; the sponsoring petitioner inside them is `petitioner.*`.
- **Business plans (L-1A / L-1B / L-1A extension, E-2) and E-2 / EB-1B / EB-1C / O-1A / O-1B / I-824**: company facts under `petitioner.*` (shared names such as `petitioner.name`, `petitioner.ein`), the executive / investor / employee under `beneficiary.*`, plan-only detail under `petitioner.businessPlan.*`.
- **Self-petition intake questionnaires** (EB-1A, NIW, H-1B intake): the person the filing is for is the `beneficiary` (they share question keys, so they must share a path).
- **PERM is not included** (own canonical pipeline - `permCanonicalPaths`, `education.N.*`, `perm.*`, address objects - needs its own reviewed step); the E-2 supporting-documents checklist has no questions.

### Nothing that reads an older path loses its value (dual write)
When a question moves, the migration records its old path on the question (`metadata.legacyCanonicalPath`). `CanonicalBuilderService.addQuestionnaireCandidates` then records the answer on BOTH the generic path and the old path, so every form, profile or document rule that still reads the older path (person.*, contact.*, immigration.*, applicant.*, application.*, beneficiary.usMailingAddress ...) receives exactly what it received before. This replaces relying only on the hand-kept alias tables in `PartyAliasService`. Unit test: `canonical/tests/legacy-path-dual-write.test.js`.

### Two things to know about the local test database
- The two end-to-end tests that switch `PARTY_CHECKLIST_PATHS` on (they run the real pipeline) re-point the checklists of the local test database to the generic paths while they run. Master-data tests such as `ChecklistFieldTraceabilityService.test.js` read those paths and fail afterwards until the local database is put back. Run those tests on a fresh local database, or restore it first.
- `checklistMappings.test.js` (4 tests: H-1B / family joint sponsor / gaps / scaffold) fails independently of this work (checklist-to-form assignment, earlier work stream).

## Next batches
Roll out the same way: add the checklist's questions to `partyChecklistPaths.js`, dry-run, apply. The census found 15,214 checklist questions of which 13,929 have no canonical path at all (mostly the auto-generated "Filing Intake" composites, which are never sent to clients), so the real work is the checklists clients actually answer.
