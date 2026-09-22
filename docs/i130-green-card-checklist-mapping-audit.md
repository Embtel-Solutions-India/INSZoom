# I-130 / Green Card / I-864 Checklist, Person-Role, and Form-Mapping Audit

Companion to `docs/visa-form-mapping-audit.md` (the VisaFormMapping architecture correction). This covers the follow-up: splitting the real I-130/Green Card/I-864 business checklists by participant role, wiring `Case.processingPath` (Filing Path) into both case creation and the CRM, and the participant/role gaps that split closed.

## Summary table (per your Phase 26 format)

| Process | Checklist | Owner (`checklistRole`) | Independent Forms (VisaFormMapping) | Dependent Components |
|---|---|---|---|---|
| I-130 | `i130_<slug>_petitioner_checklist` | petitioner | I-130 | I-130A (spouse-only trigger) |
| I-130 | `i130_<slug>_beneficiary_checklist` | beneficiary | I-130 | I-130A (spouse-only trigger) |
| Green Card (AOS) | `green_card_<slug>_beneficiary_checklist` | beneficiary | I-485, I-131, I-765, I-693 (`processingPath: ADJUSTMENT_OF_STATUS`) | — |
| Green Card (consular) | `green_card_<slug>_beneficiary_checklist` | beneficiary | DS-260 (`processingPath: CONSULAR`) | — |
| I-864 | `i864_<slug>_petitioner_checklist` | petitioner (sponsor defaults to petitioner) | I-864 | I-864A |
| I-864 (joint sponsor) | `i864_<slug>_joint_sponsor_checklist` | joint_sponsor | I-864 (separate copy) | — |

`<slug>` = lowercased visa type with punctuation stripped (`ir1`, `cr1`, `f2a`, ...), one set of 5 templates per `familyBased()` visa type (12 types × 5 = 60 templates, all seeded and verified in the dev DB — §"Database seeding" below).

## Checklist composition (the business's explicit rule)

`Backend/src/modules/questionnaires/familyChecklists.js`'s `resolveFamilyChecklistKeys(visaType, processingPath)`:

| `Case.processingPath` | Checklists assigned |
|---|---|
| `PETITION_ONLY` / unset | I-130 Petitioner + I-130 Beneficiary |
| `ADJUSTMENT_OF_STATUS` or `CONSULAR` | I-130 Petitioner + Green Card (beneficiary) + I-864 (petitioner/sponsor) — **never** I-130 Beneficiary (Green Card's own beneficiary questionnaire is a superset of it) |

Verified live against a real IR-1 case created through `createFamilyCase` (see §"End-to-end verification"): the Green Card path resolved to exactly `[petitioner, beneficiary, petitioner]` roles — I-130 Petitioner + Green Card Beneficiary + I-864 Petitioner, with **no** I-130 Beneficiary reference. Never all three source documents' checklists at once, per your explicit correction.

## Content — verbatim, split by role, not rewritten

`Backend/src/modules/family-workflow/questionnaires/familyBasedImmigrantPetition.js` now exports three separate content blocks (`i130`, `greenCard`, `i864`) transcribed from your three source documents:

- **I-130** ("Questionnaire for Petition for Alien Relative"): every petitioner field (identity, marital history, parents, 5-year employment/address history, the source's own financial section) and every beneficiary field (identity, marital history, family members, US/foreign address, adjustment office, prior petitions), split exactly where the source document splits them. Petitioner documents (passport, citizenship/naturalization/birth cert, green card, SSN, state ID, marriage cert + termination docs, birth cert, photo) and beneficiary documents (passport, birth cert, marriage cert, photo, national ID) kept as their own lists.
- **Green Card**: entirely beneficiary-owned (the source has no petitioner section) — identity, last-arrival, 5-year residential/employment history, parents, marital history (current + up to 2 prior spouses), children, and the full Public Charge Questionnaire (household size/income/assets/liabilities, education, public-benefits history, institutionalization history). Documents: 6 photos, foreign birth certificate, all passport pages, prior I-20/EAD/I-797, marriage cert/termination docs, I-94, approval notices, plus the mandatory civil-surgeon medical exam note.
- **I-864**: sponsor identity/address/DOB/SSN/A-number/immigration status/marital status/dependents, occupation + up to 3 employers, current + 3 prior years' income, assets, household-member income. Documents: proof of status, passport, driver's license/SSN, income evidence, bank statements, 3 years' tax returns. The joint-sponsor variant reuses the same shape under its own role.

**Structured, not free-text**: "I am Filing for my:" is a `select` (Husband/wife / Parent / Brother/Sister / Child), synced onto `Case.petitionSubType` (already whitelisted in `VisaFormMapping`'s trigger DSL) — verified live: creating a case with `relationship: "Husband/wife"` produced `caseData.petitionSubType === "Husband/wife"`.

## Participant/role fixes (real, confirmed bugs closed)

1. **`Case.js`'s `caseParticipantSchema.role` enum was missing `"joint_sponsor"`** — a joint-sponsor participant could not even be persisted. Fixed additively; every existing role value unaffected.
2. **`Case.jointSponsorUser`/`jointSponsorInvite` added**, mirroring `beneficiaryUser`/`beneficiaryInvite` exactly — the same self-service-invite pattern, so a joint sponsor can complete their own I-864 checklist independently.
3. **`resolveApplicableChecklistRoles` (Immiglance/Client) had no `joint_sponsor` branch** — it fell through to `return null`, which `Documents.jsx` treats as "no restriction" (show every checklist assigned to the case). A joint-sponsor login would have seen the petitioner's and beneficiary's checklists too. Fixed: a `joint_sponsor`-identified user now gets exactly `["joint_sponsor"]`.
4. **`case.service.js`'s `applyCaseRoleFilter`/`canAccessCase` and `roleHierarchy.js`'s `CANONICAL_ROLES`** — `joint_sponsor` added as a first-class role (mirroring `beneficiary`'s own entries) so a joint sponsor's case-list query and case-detail access check agree, and a joint-sponsor login is possible at all.
5. **`case-participant.service.js`'s `participantAssignee`** — added a `joint_sponsor` branch (falls back to `Case.jointSponsorUser`), mirroring the `petitioner`/`beneficiary` branches already there.

## Filing Path (`Case.processingPath`) — the actual root cause, now wired

Confirmed before fixing: `VisaFormMapping`'s `familyBased()` seed factory already generates the correct I-130 (auto)/I-864/I-485/I-765/I-131/I-693 (conditional, gated on `processingPath`)/DS-260 package — but **`processingPath` was never read or set anywhere in the app**. That is the entire reason "I-130 only" vs "Green Card" never worked: every case silently defaulted to `""`, so only I-130 ever provisioned.

- **`family-workflow.controller.js`'s `createFamilyCase`** now accepts and persists `processingPath` (validated against the enum, rejecting anything unrecognized rather than guessing).
- **`case.controller.js`'s `updateCase`** now accepts `processingPath` too, and re-runs `ensureFamilyChecklistReferences` when it changes — additive only (never removes/duplicates an already-assigned checklist).
- **CRM (`CRMCaseDetail.jsx`, Overview tab)**: a "Filing Path" selector, editable, calling the same `PUT /cases/:id`.
- **CRM case creation (`CreateCaseModal.jsx`)**: staff-facing labels use form numbers (*Petition Only (I-130)* / *Adjustment of Status (I-485)* / *Consular Processing (DS-260)*) — appropriate since staff already work with form numbers everywhere else in the CRM. Client-facing surfaces (none currently reach case creation — see next section) would use the plain-language framing ("Just start the family petition" / "Start the petition and apply for the Green Card") per your explicit correction that clients don't know what "I-130" means.

## A significant pre-existing gap found and fixed: no UI ever called `POST /family-workflow/cases`

`createFamilyCase` — the only backend path that assigns the real I-130/Green Card/I-864 checklists — had **zero frontend callers anywhere in the app** before this session. Two more problems were found and fixed along the way, both flagged to you before fixing rather than silently patched:

1. **`CreateCaseModal.jsx`'s visa dropdown didn't list IR-1/CR-1/F2A/F2B (or any of the other 8 `familyBased()` types) at all.** Added, with labels matching `visaCategories.js`'s exact spelling.
2. **`createFamilyCase` set `petitionerUser: req.user._id`** — i.e. whoever calls the (staff-only) endpoint becomes the petitioner. Per your decision, fixed: it now finds-or-creates the actual petitioner as a `client` User from `petitionerEmail`/`petitionerName`/`petitionerPhone` in the request body (mirroring `case.controller.js`'s own find-or-create-client-user pattern for the employer/employee path exactly, including the setup-invite-token flow), and never sets a staff account as petitioner. `createdBy` still correctly records which staff member created it.

`CreateCaseModal.jsx` now routes any `familyBased()` visa type to `POST /family-workflow/cases` (via a new `familyWorkflowApi.createCase`) instead of the generic `POST /cases`, since that's the only path that assigns the right checklists.

**Note, not fixed in this pass**: a *second*, older family-case architecture also exists in `case.controller.js`'s generic `createCase` (`caseStructure === "family"`, a parent/child-case shape using `caseRole: "beneficiary"` rather than `beneficiaryUser`). It uses the flat `Case.checklistItems` system (`visaChecklists.js`'s `generateChecklist()`), which returns an **empty list** for every `familyBased()` visa type today (none of them are registered in that flat-checklist system) — a separate, pre-existing gap, unrelated to this session's changes, and out of scope for this pass. Flagged here rather than silently left for someone to rediscover.

## End-to-end verification (live dev DB, not just unit tests)

Ran `createFamilyCase` directly against the real database (test data cleaned up immediately after):

```
Input:  visaType=IR-1, petitionerEmail=test.petitioner.smoke@example.com,
        relationship="Husband/wife", processingPath=ADJUSTMENT_OF_STATUS,
        beneficiaryEmail=test.beneficiary.smoke@example.com
Result: status 201
        caseNumber: CRM-2026-64231
        petitionSubType: "Husband/wife"
        processingPath: "ADJUSTMENT_OF_STATUS"
        petitionerUser -> a NEW client User (test.petitioner.smoke@example.com),
                           confirmed NOT the staff admin who made the request
        questionnaireReferences roles: [petitioner, beneficiary, petitioner]
                           (I-130 Petitioner + Green Card Beneficiary + I-864
                            Petitioner - no I-130 Beneficiary, no duplicates)
```

## Database seeding

- 60 new Questionnaire templates (12 `familyBased()` visa types × 5 checklists) seeded via `ensureDefaultVisaTemplates({force:true})` — 0 errors.
- 11 stale Questionnaire documents from the prior session's single-merged-checklist design (`family_ir1_petitioner_checklist` etc.) deactivated (`latestVersion:false, isActive:false, status:"archived"`) after confirming zero live cases referenced them — not deleted, so the audit trail is preserved.

## Duplicate prevention

- `assignQuestionnaire` had no dedup of its own; the one caller that needed it (`recordConditionalDecision`) had a hand-rolled, untested copy of the guard. Extracted into a shared, tested `assignQuestionnaireIfNotActive` (`questionnaire.service.js`) — used by both `recordConditionalDecision` and `ensureFamilyChecklistReferences`, so re-running checklist composition (e.g. after a Filing Path change) can never duplicate a `questionnaireReferences` entry. Two new tests cover this directly.
- `CaseForm` creation dedup (`ensureAssignedForms`'s `Map`-then-`Set` by normalized `formCode`) was already correct — confirmed via code read, unchanged.

## Known limitation flagged, not fixed in this pass

The CRM's Overview tab (`useCaseQuestionnaire(caseId, targetRole)`) resolves **one** questionnaire per `(case, role)` pair. A Green-Card-path case now has **two** active `petitioner`-role checklists (I-130 Petitioner + I-864 Petitioner) — the Overview's per-role summary panel can only show one of them at a time. This does **not** affect the actual client-facing checklist visibility (`Documents.jsx` already lists every active checklist for the roles a login is allowed to see, not just one per role) — it's a staff-facing display limitation only. Fixing it would mean changing `useCaseQuestionnaire`/`GET /questionnaires/case/:caseId`'s "one questionnaire per role" convention, which other, unrelated visa types' Overview panels also rely on — flagged here for a future, separate pass rather than risked in this one.

## Tests

- `Backend/src/modules/family-workflow/tests/family-workflow.test.js`: updated to assert the new 5-checklist-per-visa-type structure (60 templates) and `resolveFamilyChecklistKeys`'s exact composition rule (including the explicit "never I-130 Beneficiary alongside Green Card" assertion).
- `Backend/src/modules/questionnaires/tests/questionnaireAssignmentDedup.test.js` (new): `assignQuestionnaireIfNotActive` assigns once, is a no-op on repeat calls, and re-assigns correctly if the existing reference was marked inactive.
- Full regression run (cases/family-workflow/form-registry/questionnaires/config test suites): **165/165 passing**.

## Files changed (this session's follow-up)

- `Backend/src/modules/family-workflow/questionnaires/familyBasedImmigrantPetition.js` — rewritten: three real, verbatim content blocks (was one paraphrased, merged block).
- `Backend/src/modules/questionnaires/familyChecklists.js` — 5 checklist builders per visa type (was 3), `resolveFamilyChecklistKeys` composition function, extended to all 12 `familyBased()` visa types (was 4).
- `Backend/src/modules/family-workflow/family-workflow.controller.js` — `ensureFamilyChecklistReferences` branches on filing-path composition for non-K1/K3 types; `createFamilyCase` accepts `processingPath`/`relationship`, and resolves a real petitioner client User instead of the staff caller.
- `Backend/src/modules/cases/case.controller.js` — `updateCase` accepts `processingPath`, re-triggers checklist composition on change.
- `Backend/src/models/Case.js` — `jointSponsorUser`/`jointSponsorInvite` fields; `caseParticipantSchema.role` enum gains `joint_sponsor`.
- `Backend/src/models/Questionnaire.js` — `CHECKLIST_ROLES` gains `joint_sponsor` (already partially done last session; confirmed complete).
- `Backend/src/modules/authorization/roleHierarchy.js` — `joint_sponsor` added as a canonical role.
- `Backend/src/modules/cases/case.service.js` — `applyCaseRoleFilter`/`canAccessCase` gain `joint_sponsor` branches.
- `Backend/src/modules/cases/case-participant.service.js` — `participantAssignee` gains a `joint_sponsor` branch.
- `Backend/src/modules/questionnaires/questionnaire.service.js` — new shared `assignQuestionnaireIfNotActive`.
- `Backend/src/modules/form-registry/visaFormMapping.service.js` — `recordConditionalDecision` now uses the shared helper instead of its own copy.
- `Admin/frontend/src/components/CreateCaseModal.jsx` — family visa types added to the dropdown; Filing Path/relationship/beneficiary fields; routes family types to `familyWorkflowApi.createCase`.
- `Admin/frontend/src/pages/CRMCaseDetail.jsx` — joint-sponsor Overview panel; editable Filing Path field.
- `Admin/frontend/src/services/api.js` — new `familyWorkflowApi.createCase`.
- `Immiglance/Client/src/utils/questionnaireEngine.js` — `resolveApplicableChecklistRoles` gains the `joint_sponsor` branch.
