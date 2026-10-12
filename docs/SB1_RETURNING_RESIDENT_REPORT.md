# SB-1 Visa — Returning Resident

## 1. Starting point and decisions

SB-1 was **already integrated** (commit `3285c11`): single-person case type, a 54-question checklist covering all 13 sections, 14 document uploads, and tests. Gaps found: only 6 questions were canonically bound, and those used an `applicant.*` root that is not a real canonical namespace (the profile never received them); addresses were single text lines; tables had no date-order checks; documents were marked required; the display name differed.

Two parts of the new spec conflict with what exists. Decisions taken by the product owner:

| Conflict | Decision |
|---|---|
| Spec: no DS-117 / DS-260 / USCIS forms for SB-1. Existing registry: `SB-1 → DS-117` (AUTO_CREATE), `DS-260` (CONDITIONAL), `I-551` / `I-131` (reference), SB-1 forced to `processingPath: CONSULAR`. | **Keep them.** Not touched. The questionnaire itself has no form binding (tested). |
| Spec: answers and documents visible in the Admin Portal only. Existing: staff with case access (case manager, team lead, admin) can see them. | **Keep existing case access.** No new restriction code; attorneys stay excluded (question visibility lists client + staff roles only). |

## 2. What changed

| File | Change |
|---|---|
| `Backend/src/modules/questionnaires/sb1Checklist.js` | Reworked in place (same key `sb1_returning_resident_document_checklist`, so the stored template reconciles, nothing recreated). Titled **SB-1 Visa Questionnaire**; 66 questions; 52 non-file questions all canonically bound; nothing marked required |
| `Backend/src/modules/canonical/config/sb1CanonicalPaths.js` (new) + `CanonicalFieldRegistryService.js` | Registers the 35 genuinely new paths; the rest reuse existing ones |
| `Backend/src/modules/questionnaires/questionnaire.service.js` | `getQuestionnaireForCase` no longer returns the internal parts of the case (canonical profile + provenance/history, audit log, knowledge plan) to client-side users (see §5). Also the shared `past` date rule from the I-90 work |
| `Admin/frontend/src/utils/visaOptions.js`, `Backend/src/config/visaCategories.js` | Case-creation option reads exactly **SB-1 Visa — Returning Resident** (creates the case as visa type `SB-1`) |
| `Backend/src/integrations/ghl/ghlAuxOutbound.js` | SB-1 defaults to the immigrant GHL pipeline (it previously fell to non-immigrant); existing opportunity identity / idempotency untouched |
| Tests | `sb1Spec.test.js` (14, pure), `sb1-e2e.test.js` (1, real DB), `sb1Checklist.test.js` updated |

Case creation, assignment, approval gate, persistence, canonical sync, GHL: all existing shared paths; no new endpoint, engine or store. The earlier fix to `provisionChecklistAssignments` (two identical checklist references on first provisioning) is what makes SB-1 provisioning idempotent.

## 3. Case type

`SB-1` · structure `single` · category individual · checklistRole `client` (the applicant) · no petitioner / employer / employee / beneficiary · no automatic subcases (verified: `childCases` empty, no child case after answering "Married" or "employed abroad"). Provisioned: one questionnaire reference, which stays a draft until a case manager approves it.

## 4. Questionnaire and canonical crosswalk

One questionnaire record holds the 13 sections **and** the document checklist as its document sections. They stay one record because the conditional documents (e.g. re-entry permit) read answers from the questions above them, and a condition can only resolve within one response. Spec titles "SB-1 Visa Questionnaire" / "SB-1 Visa Documents Checklist" are therefore the questionnaire title and its document sections.

All questions are optional; the client can save and resume partial drafts. (Platform rule: submit needs every *visible* question answered, so "optional" is expressed by gating; one more platform rule makes passport information always required — `passportInformation.js` — the only exception.)

| Spec path | Used path | Why |
|---|---|---|
| `person.firstName/middleName/lastName` | same | existing |
| `person.dateOfBirth` | `person.dob` | existing path for the same fact |
| `person.currentAddress` | `contact.address.line1 … country` | existing; **structured as one question per component** (street, unit, city, state/province, ZIP/postal, country) |
| `person.phone` | `contact.phone` | existing |
| `person.birthPlace.city / country` | `person.cityTownOfBirth` / `person.countryOfBirth` | existing; `person.birthPlace.stateProvince` is new |
| `person.otherNames[]` | `person.otherNames` | repeatable table, one column |
| `person.maritalStatus` | same | existing |
| `spouse.*` | `family.spouse.*` | existing `family.spouse.firstName/lastName`; the rest added under the same root; no spouse participant is created |
| `familyMembersInUS[]` | `familyMembersInUS` | table: name, relationship (with Other), U.S. status (with Other), address as five component columns; no maximum |
| `immigration.aNumber` | `person.alienNumber` | existing, with A-Number format validation |
| `immigration.previousImmigrationCategory`, `previousImmigrantVisa.*`, `adjustmentOfStatus.*`, `permanentResidentHistory.{initialEntry,lastEntry,mostRecentDeparture}.*`, `returningResident.*`, `residenceAbroadPeriods[]` | same | new; entry/exit/departure stored independently; visa kept apart from card |
| `employment.outsideUS.*` | **`immigration.returningResident.employmentOutsideUS.*`** | the platform replaces the whole `employment` root with its own employment-history collection on every rebuild, so the proposed path is silently wiped (caught by the end-to-end test). Equivalent path in a non-colliding root |

Conditional logic: spouse block only when marital status = Married; employer table only when employed outside the US = Yes; adjustment details only when "adjusted status" = Yes; re-entry permit upload only when "has a re-entry permit" = Yes. Changing a gate keeps earlier answers (retention verified). Periods-abroad and employer rows carry a `dateOrder` rule (end before start is flagged server-side) and incomplete rows are kept, not dropped; more than six periods are accepted. Narrative answers (ties, delayed return, reason for leaving) are long text stored verbatim; nothing decides eligibility. Dates cannot be in the future (birth, entry, departure …).

Provenance is the platform's (source = questionnaire answer, status-based confidence, staff-override priority replayed on every rebuild). **No questionnaire field is mapped to any government form.**

Not delivered: *stable row identifiers* for table rows — the platform's repeating tables are positional arrays with no row ids; adding them is a change to the shared table component and was not done.

## 5. Documents and visibility

Ten spec categories present as `file` questions (passport, I-551, re-entry permit [conditional], travel records, entry/exit stamps, tax returns, W-2s, employer letter, property, business, circumstances-beyond-control evidence) plus the existing extra "other ties", medical and U.S.-employment evidence. All optional; each has its own `documentType`, so uploads become `Document` records on the case (existing secure storage, uploader, timestamps, review status) and sync back to the question; staff request extra evidence through the existing "Additional Requested Information" without duplicating the checklist. Provisioning is idempotent (tested twice).

Visibility: existing case access (decision above). Questions list roles client + admin/staff only. **Fix found by the end-to-end test:** the questionnaire endpoint returned the *entire case document* to the client, including the canonical profile with provenance, canonical history and audit log (every case type, not only SB-1). Client-side users now receive the case without those four internal fields; the client portal reads none of them; staff payload unchanged.

## 6. Tests and results

- `sb1Spec.test.js` + `sb1Checklist.test.js`: 30/30 (sections, optionality, canonical binding and registration, no form binding, conditions, tables, validation, documents, GHL).
- `sb1-e2e.test.js` (real DB, self-cleaning): provisioning twice → one reference, no subcases, no I-130/I-485/I-129/I-140/DS-260 forms; approval gate; other client refused; draft save with tables; staff read; client payload free of internal data; canonical values and provenance; no spouse/employer case created; gate retention — pass.
- All `questionnaires/tests` plus the SB-1 DS-260 registry test and the I-90 crosswalk test: **366/366 pass.** Admin frontend builds.
- Not run this session: the wider form-mapping / cases / form-registry suites (earlier I-90 run had 7 failures in other forms' suites, not investigated).

## 7. Limitations

- DS-117 is still auto-created for SB-1 if a DS-117 template exists (kept by decision); the spec's "no DS forms" is therefore **not** met. Removing it means deleting the SB-1 rows in `visaFormMappings.seed.js`, the DS-260 test, the forced CONSULAR path in `case.controller.js`, and deactivating the stored mapping rows.
- Optional-by-gating and the always-required passport rule follow platform behavior.
- Single-party "Submit case" does not call the questionnaire submit endpoint (shared behavior; the I-90 strict check is opt-in per checklist and not enabled for SB-1).
- SSN / A-Number values are stored without field-level encryption (platform-wide).
