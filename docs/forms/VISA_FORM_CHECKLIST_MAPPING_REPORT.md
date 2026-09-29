# Visa → Form → Checklist Mapping

**Date:** 2026-09-29
**Status:** PARTIAL — schema, data, resolver, and case-creation integration complete; deeper traceability/OCR/coverage-diagnostics features (see §5) not attempted.

## 0. Objective

Extend the existing `VisaFormMapping` registry so each applicable USCIS form also identifies the correct client checklist(s)/questionnaire(s) for that visa/form combination — one registry, not a second parallel checklist-mapping system.

## 1. Schema

**`Backend/src/models/VisaFormMapping.js`** — added `checklistMappings[]`: `checklistKey` (references an existing `Questionnaire.key`, never redefines one), `assignmentType` (`AUTO` / `CONDITIONAL` / `EXPLICIT_CM`), `role` (descriptive only), `condition`, `notes`. Conditions reuse the *existing* trigger DSL/whitelist/evaluator verbatim — no second condition language. Two new whitelist fields added: `newOfficePetition` (resolves from the exact same `caseData.assessmentAnswers`/`questionnaireData.masterData` path `immigration-knowledge-engine.service.js` already reads for the same gate) and `hasJointSponsor` (`Boolean(caseData.jointSponsorUser)`).

## 2. Data

**`Backend/src/modules/form-registry/seeds/checklistMappings.seed.js`** — 189 of 449 `VisaFormMapping` rows updated by exact `{visaType, formNumber}`, covering H-1B, L-1A (+ New-Office-conditional business-plan checklist), E-2/E-3, P-1/2/3, O-1A/O-1B, EB-1A/1B/2/2 NIW/3, TN, all 3 H-4 variants, all 4 Change-of-Status variants (F-1→B-2 shares B-2's checklist, never a separate one), all 12 family visa types (petition-only/AOS/consular — one set of entries covers all three, since `VisaFormMapping`'s unique index allows only one document per `{visaType, formNumber, componentType}`; joint-sponsor is `CONDITIONAL` on `hasJointSponsor`, GC-NVC is `EXPLICIT_CM`, never automatic just because the path is consular), K-1/K-3, green card renewal, N-400/565/600.

Deliberately left as GAP (empty, not guessed): L-1B, O-2, EB-5, and any visa type the source spec didn't address. Component/supplement forms (I-129 H/L/O/P/Q/R/E Classification Supplements, I-130A, I-864A) never get their own entry — enforced by a dedicated test.

**Two real mistakes caught before calling this done, both worth recording:**
1. The source spec directly contradicted itself on `I-539A` (one section forbids ever mapping it as a supplement; two other sections explicitly map it as CONDITIONAL). Flagged to the user rather than guessing; resolved by keeping the specific H-4/COS mappings.
2. `DS-117` (SB-1's return-document form) was initially mapped to `sb1_returning_resident_document_checklist` — but `DS-117` is a **State Department** form, directly violating the registry's own USCIS-only rule. Caught by the test suite itself (`agency exclusion` test), corrected — that checklist already auto-assigns correctly via the pre-existing generic `isDefault`/visaType-match mechanism, no registry row needed.

## 3. Resolver

**`visaFormMappingService.resolveChecklistsForCase(caseData)`** (`Backend/src/modules/form-registry/visaFormMapping.service.js`) — reuses `resolveVisaFormMappings()`'s existing applicability decision (never re-derives it), evaluates each applicable form's `checklistMappings`, buckets into `auto` (assign now — includes AUTO entries and CONDITIONAL entries whose condition currently evaluates true), `conditional` (defined, not currently true), `explicitCm` (never automatic, a case manager adds it). Deduped by checklist key.

## 4. Case-creation integration

**`CaseLifecycleOrchestrator.provisionChecklistAssignments()`** (`Backend/src/modules/cases/case-lifecycle-orchestrator.service.js`), wired into `initializeCase()` — for each `auto`-bucket entry, resolves the real `Questionnaire` by key and calls the *existing*, already-idempotent `assignQuestionnaireIfNotActive()`. No new assignment logic. `targetRole` is deliberately left to default to the questionnaire's own `checklistRole` (the tested, authoritative source) rather than the registry's descriptive-only `role` string. Same target-resolution (child cases for employer_employee/family structures) and never-throw contract as the form/petition provisioning steps beside it.

Verified live: calling it twice against the same (freshly-fetched) case produces no duplicate `questionnaireReferences`; a stale in-memory case object reused across two separate top-level calls is not representative of real usage (the real flow always operates on a freshly loaded case) and was confirmed to still be correct once re-tested against a fresh fetch.

## 5. Governance UI

**`Backend/src/modules/form-registry/form-registry.controller.js`**'s `getFormCatalog()` now includes each visa association's `checklistMappings` (key, assignment type, role). **`Admin/frontend/src/pages/FormGovernanceDetail.jsx`**'s "Used by these case types" section is now a table showing case type, assignment, and every checklist sent to the client for that combination, color-coded by assignment type.

## 6. Verification

New suite `Backend/src/modules/form-registry/tests/checklistMappings.test.js` (11/11): agency exclusion, component/supplement exclusion, H-1B, L-1A New-Office conditional, all 3 H-4 variants, family (petition-only/AOS/joint-sponsor/consular-NVC), Change of Status, GAP reporting, scaffold non-wiring. Full existing `form-registry` regression suite (35/35) and `case-lifecycle`/`immigration-knowledge-engine` suites (16/17 — the 1 failure is the same pre-existing, unrelated issue recorded in `PETITION_AND_FORMS_AUTOFETCH_REPORT.md`) still pass. Seeded identically on both the dev and local test databases.

## 7. What was explicitly not done (deferred)

The originating spec's deeper asks were intentionally not attempted in this pass, to avoid rushing a repeat of the mapping-corruption mistake documented in `FORM_GOVERNANCE_PAGE_REPORT.md`:
- Bidirectional PDF-field ↔ checklist-question traceability (forward and reverse).
- OCR/document-intelligence → canonical → checklist linkage.
- Missing-data detection surfaced back to a specific checklist question.
- Per-CaseForm autofill coverage diagnostics (mapped/autofilled/missing/manual-override counts, with source attribution).
- Manual-override/provenance display in this specific UI (the underlying provenance system already exists and is untouched/unaffected).
- USCIS edition-change re-validation of checklist mappings.
- Questionnaire admin page section-level visa/form applicability display.

Each is a substantial feature in its own right and should be scoped and built as its own follow-up, not folded into this one.
