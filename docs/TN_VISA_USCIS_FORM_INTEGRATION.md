# TN visa - USCIS form registry mapping, autofill, checklist persistence and PDF integration

## 1. Existing architecture inspected (and reused - nothing duplicated)
- Case creation `case.controller.createCase` -> principal (employer) case + child employee case -> `case-lifecycle-orchestrator.initializeCase` -> `provisionRequiredForms` -> `uscis-form.service.ensureAssignedForms`.
- Form applicability: `VisaFormMapping` registry (sole authority) + legacy `templateAppliesToCase` (template `visaTypes`) + `resolveConditionalTemplates`.
- Canonical data: `CanonicalBuilderService` (merge by source priority), `CanonicalDataService` (autofill input), `MappingGraphService` / `USCISMappingVersion` (edges, versions, activation), `AutoFillService`, `MappingResolver` (transforms), `PDFRenderer` / `OfficialFormDownloadService` (PDF).
- Checklists: `employmentChecklists.js` (TN employer + employee definitions, already existed), `questionnaire.service`, `case-checklist.service`, `checklist-gate.js` (per-case approval gate).

## 2. Registry (forms associated with TN)
Visa types **TN**, **TN Canada**, **TN Mexico** (the Admin New-case list creates plain "TN", which previously had no registry rows - that is why a TN case showed "No active ... templates match TN").

| Form | Registry row | Assignment |
|---|---|---|
| I-129 | conditional, USCIS | attached with the case by default; the case manager can mark it Not Applicable |
| I-129 Trade Agreement Supplement | FORM_COMPONENT of I-129 (same component H-1B1 / E-3 use) | comes with I-129; pages 11-12 of the live edition |
| I-907 | conditional | same as I-129 (case manager decides) |
| G-28 | conditional, trigger `attorneyOnRecord` | added by Add / when an attorney is on record |
| I-539 | conditional, filing paths CHANGE_OF_STATUS / EXTENSION_OF_STATUS | **never auto-assigned** (see 5) |
| DS-160 | agency DOS, `ONLINE_APPLICATION` reference row | **not a USCIS form**: no `USCISFormTemplate`, never a CaseForm, never listed as a USCIS form |

Seed: `form-registry/seeds/visaFormMappings.seed.js`. Template `visaTypes` for I-129 / I-907 / I-539 include TN; every newly activated edition is scoped from the registry (`deriveVisaTypesFromRegistry`) so "Add" can never silently do nothing again.

## 3. Form assignment fix
`uscis-form.service.latestTemplatesByAssignmentRules`: the legacy visa-type scan no longer attaches a form that the registry marks CONDITIONAL for that visa type (registry rows with `provisioningType: CONDITIONAL`, STANDALONE, USCIS). This fixed I-539 being auto-created on TN cases (same rule now applies to every visa type; it also fixes the previously failing "bare H-1B must not attach I-539/G-28" behaviour).

## 4. Field mapping (generic, not form- or visa-specific)
- `canonical/services/PartyAliasService.js` (called by the profile builder and by `CanonicalDataService`): fills **beneficiary.\*** and **petitioner.\*** from person / contact / immigration / company data and from free-text addresses (split by `AddressParser`; an address that cannot be split stays on the street line, never guessed into city/state/ZIP). Never overwrites a value; derives nothing for family cases (where person.\* is the petitioner).
- `form-mapping/config/partyFieldRules.js` + `PartyFieldMappingService`: for I-129, I-907, I-539, G-28 every field that asks for a beneficiary/petitioner fact is wired to the generic path, **once per occurrence** (the petitioner name is mapped into 8 I-129 fields, 5 of them on supplements). Exact PDF field-name stems, optional page restriction; fields about someone else (joint employer, preparer, additional beneficiary, foreign employer) are deliberately excluded. An existing edge keeps its old source as `fallback` (nothing that filled before stops filling) and its condition follows the new source. New mapping versions: I-129 v16, I-907 v9, I-539 v11, G-28 v7/v8 (history kept, activated after validation). Script: `scripts/applyPartyFieldMappings.js`.
- TN checklist questions now carry shared canonical paths (16 employer -> company.\* / employment.\*, 19 employee -> person.\* / contact.\* / immigration.\*). Employee-side additions are shared by every visa; the employer-side table is opt-in per checklist (TN only).
- Coverage after mapping (I-129 / I-907 / I-539 / G-28): 62 / 28 / 29 / 12 fields matched. Unmapped candidates are reported by the engine (signature dates, joint employer, additional-beneficiary pages, I-907 "other information about company").

## 5. Existing cases
`scripts/applyPartyMappingsToExistingCases.js`: refreshes TN question paths, re-points every open case form at the current mapping version and re-autofills; **nothing entered by a client or case manager is lost** (answers are never touched; manual overrides are preserved; a backup JSON of every touched form is written; any value that came back blank is restored; finalized / filed / locked forms untouched). Applied: 24 case forms relocked; orphan case forms whose Case no longer exists report "Case not found" (left untouched).

## 6. Checklist persistence / synchronization
- Answers are persisted by the existing `Answer` model; verified end to end: save, reopen, resume, repeated save does not duplicate, partial sections.
- Approval gate: an employee case inherits its principal's approval of the employee checklist for **every visa type** (`inheritParentApprovals`, run at provisioning; reads also honor the principal's approval). Repair script `scripts/inheritChecklistApprovals.js` (applied: 1 case).
- Client portal shows "We are preparing this checklist..." instead of an error when a checklist is not released yet.
- Large file answers (up to 50 MB): uploaded in 3 MB chunks, 4 in parallel, assembled and saved by the server through the same save function (same authorization and limits). Removes the hosting-proxy 413 above ~5 MB; 22 MB: ~62 s -> ~30 s, verified byte-identical.

## 7. Tests
`form-mapping/tests/partyMapping.test.js` (6, DB-free), `questionnaires/tests/tn-e2e.test.js` (real DB, TN / TN Canada / TN Mexico: checklists, registry forms, Add, autofill with manual override, PDF download, resume, isolation), `auth/tests/inviteTokenHistory.test.js`. Verified on a fresh TN case: petitioner/beneficiary canonical roots populated; downloads filled for I-129 (+Trade Agreement Supplement), I-907, G-28, I-539.
Failing tests that are **not** from this work: checklistMappings (H-1B/Family/gaps/scaffold), governanceDefects L-1B, I-130/K-3 golden cases (checklist gate), I-539 "Beneficiary name" and I-907 "Classification" graph tests (edges unchanged since v1/v2).

## 8. Limitations / manual review
- TD dependents are not a separate visa type in the platform, so I-539 stays manual (never assigned to the principal TN worker).
- The I-129 is attached by default for TN (registry rule for conditional forms); restricting it by filing route needs a filing-route field on employer cases (none exists).
- `company.name`: a case-manager-verified value outranks the client's checklist answer by design.
- Fields the client was never asked (e.g. employer phone, city/ZIP when the address is one line) stay blank; the engine never guesses.
