# Checklist ↔ Canonical Data ↔ USCIS PDF Field Traceability & Autofill

Covers Phase 1 (traceability/governance) and Phase 2 (closing the gaps Phase 1 found, plus checklist→canonical autofill correctness). Phase 3 will be appended to this same file when it happens — do not create a separate doc for it.

---

## Phase 1 — Bidirectional Traceability & Governance

**Goal:** given a checklist question and a USCIS PDF field, be able to answer "does this question's answer reach this field, and how" — and the reverse — without building a second mapping/autofill engine.

### What was built

- **`ChecklistFieldTraceabilityService`** (`Backend/src/modules/form-mapping/services/ChecklistFieldTraceabilityService.js`) — the core service. Reuses, never duplicates:
  - `VisaFormMapping.checklistMappings` to scope every lookup to the checklist(s) actually registered for a form (never a global scan).
  - `QuestionLibraryItem.canonicalPath` / `Question.mapping.canonicalPath` for the question→canonical link.
  - `MappingGraphService`'s existing persisted mapping graph and its `edge.confidence` for the canonical→PDF-field link and confidence tiering (`HIGH ≥85`, `MEDIUM ≥72`, `LOW <72`, matching the mapping editor's own "Mapped"/"Needs review" cutoff — no new scoring algorithm).
  - Methods: `traceQuestionsToFields` (checklist→field), `traceFieldToQuestions` (field→checklist, reverse), `traceAllFieldsForTemplate` (bulk, one template), `coverageSummary` / `coverageSummaryForAllForms` (governance diagnostics, system-wide).
- **Routes** (`mappingGraphRoutes.js` / `MappingGraphController.js`): 5 new read-only endpoints, including the system-wide `GET /form-mappings/checklist-trace/coverage`.
- **UI**: [FormGovernance.jsx](../../Admin/frontend/src/pages/FormGovernance.jsx) — a "Show Checklist Coverage" panel listing every active form's traced/untraced counts. [FormGovernanceDetail.jsx](../../Admin/frontend/src/pages/FormGovernanceDetail.jsx) — a "Checklist source" column on the per-field mapping table.
- **Tests**: `ChecklistFieldTraceabilityService.test.js`, 11 tests (Phase 1) + 9 more (Phase 2, below).

### What Phase 1 found (the mid-course correction)

Initial verification used I-129 as a sample; a user correction ("this has to be done for all the visas and all the forms and all the checklists") led to adding the system-wide `coverageSummaryForAllForms()` and re-verifying live across every active template. Baseline (before Phase 2):

| Form | Traced / Mapped |
|---|---|
| I-129 | 17 / 101 |
| I-907 | 22 / 54 |
| I-539 | 27 / 44 |
| I-539A | 0 / 32 |
| I-129F | 0 / 34 |
| I-130 | 0 / 33 |
| I-134 | 0 / 96 (no checklist registered at all) |

Zero-trace forms were deliberately **not** treated as a traceability-service bug at the time — flagged as a real checklist/canonical-mapping gap for Phase 2 to investigate.

---

## Phase 2 — Closing the Gaps (and one real production bug)

**Goal (per the governing spec):** close the Phase 1 gaps, make checklist answers reliably reach canonical data, wire OCR/document intelligence into the same canonical layer (deferred — see "Deferred to Phase 3" below), and re-verify end-to-end. Investigate before mapping; never fabricate a mapping merely to raise a percentage.

### Investigation before touching anything

Re-tracing each zero-coverage form against its **real** PDF mapping graph edges (not assumptions) found three genuinely different root causes, not one:

1. **I-129F — already worked.** Its PDF mapping binds directly to `raw.questionnaireAnswers.<key>.value`, which exactly matches its real checklist's (`k1_petitioner_checklist`/`k1_beneficiary_checklist`) question keys. The 0/34 was a **traceability-service blind spot** — the service only recognized `canonicalPath` matches, not this legitimate direct-binding style. No data was wrong; nothing needed to change on I-129F's own mapping.

2. **I-539A / cos_f1_questionnaire / cos_f2_questionnaire / h4_extension_ead_questionnaire — wrong namespace.** These four questionnaires already had `mapping.canonicalPath` set on ~17-18 questions each, but under a self-invented `applicant.*` namespace that nothing in the real canonical/PDF-mapping pipeline consumes (confirmed: `CanonicalFieldRegistryService.BASE_FIELDS` and I-539/I-539A's real PDF edges use `person.*`/`contact.*`/`immigration.*`). The namespace's own design comment claimed it reused `profileCanonicalMap.js`'s `EMPLOYEE_PROFILE_TO_CANONICAL` translation convention — but that map has no `applicant.*` entries, and the function that actually processes a saved questionnaire Answer (`CanonicalBuilderService.addQuestionnaireCandidates`) applies no translation at all; it uses `question.mapping.canonicalPath` verbatim. The original intent and the actual runtime behavior never matched.

3. **I-130 — a real, live, pre-existing autofill bug**, not a mapping gap. I-130's PDF mapping graph binds every petitioner/beneficiary identity field to `raw.questionnaireAnswers.petitioner_info_lastName.value`-style keys (the `k3_petitioner_checklist`/`k3_beneficiary_checklist` key style). But the registry actually assigns **12 other** checklists to I-130 — `i130_ir1_petitioner_checklist` through `i130_f4_beneficiary_checklist` (IR1-5, CR1-2, F1-4) — which use a **different** key style (`petitioner_lastName`, no `_info_` infix). A real client answering one of those 12 checklists had their answers **silently never reach the I-130 PDF** — the literal key string never matched. This predates Phase 1 and Phase 2; Phase 1's traceability work only surfaced it.

4. **I-134 — a registry gap, not a canonical-mapping gap.** No `VisaFormMapping` row exists for formCode `I-134` at all; it isn't assigned any checklist. Deferred to Phase 3 by explicit user decision (assigning a checklist to I-134 is a checklist-mapping-seed decision, not canonical-path authoring).

### Fixes applied

**1. Traceability service now recognizes direct bindings** (`ChecklistFieldTraceabilityService.js`): added `directBindingPath(questionKey)` = `raw.questionnaireAnswers.<key>.value`, and a `matchedSourcePath()` helper that accepts either a real `canonicalPath` match or a real `directBindingPath` match against the **actual edges on that specific template** — never fabricated, never guessed. I-129F's own mapping was **not modified** — only the traceability service's recognition logic changed.

**2. `applicant.*` → real taxonomy, field-by-field** (source definitions, not just DB data — see "Reconciliation durability" below): `h4Checklist.js`, `cosF1Checklist.js`, `cosF2Checklist.js`. Renamed 15 fields per questionnaire to `person.*`/`contact.*`/`immigration.*`; left `usPhysicalAddress` **unmapped** on all four (no distinct "physical, if different from mailing" canonical field exists once `mailingAddress` claims `contact.address.line1` — mapping both would conflate two different addresses, a genuine schema gap, not invented around). Also left passport-number/expiration/I-94/visa-status-adjacent fields mapped to their correct canonical path even though I-539/I-539A's PDF mapping has no edge for them yet — correct link, separate "form mapping incomplete" gap, not papered over.

Added the small number of genuinely-missing `CanonicalFieldRegistryService.BASE_FIELDS` entries this required: `person.cityTownOfBirth`, `person.uscisOnlineAccountNumber`, `person.certificateNumber/certificateDateOfIssuance/certificatePlaceOfIssuance`, `immigration.currentStatusExpirationDate`, `beneficiary.cityTownOfBirth` — each mirroring the existing `beneficiary.*` precedent (a documented, deliberate registry addition, not new architecture).

**Note:** `h4_ead_questionnaire` (distinct from `h4_extension_ead_questionnaire`) uses the identical broken `applicant.*` convention and was deliberately left untouched — it is not one of I-539A's registered checklists and was out of the instructed scope. Flagged for Phase 3.

**3. I-130's real production bug, fixed via canonical routing (not a raw-key swap)** — per explicit instruction, not a quick key-rename:
- Authored `Question.mapping.canonicalPath` on **all 14** petitioner/beneficiary checklist pairs (`k3_*` plus all 12 `i130_<code>_*`, which are byte-identical clones of one another) — `person.*` for petitioner (the I-130 filer/signer, matching `CanonicalFieldRegistryService`'s own documented "person.* = whoever's filing/signing" convention), `beneficiary.*` for the beneficiary. Both checklist key styles map to the **same** canonical path, so either one now reaches the same PDF field. Left combined free-text fields that don't decompose to atomic canonical fields unmapped (e.g. `petitioner_cityCountryOfBirth`, `beneficiary_cityStateCountryOfBirth`), and left `beneficiary_ssn`/`beneficiary_info_ssn` unmapped (no full-SSN canonical field, by existing policy).
- Rewrote I-130's live PDF mapping graph edges (`scripts/fix-i130-mapping-graph.js`) from `raw.questionnaireAnswers.*` to the new canonical paths via `MappingGraphService.upsertMapping` (the real, audited edit path — not a raw DB write). 32 of 33 edges converted; 1 (beneficiary SSN) correctly left as-is, no valid target.
- **Found and fixed a second, deeper bug this uncovered**: `template.activeMappingVersionId` is what the real runtime autofill path (`FormMappingService.loadTemplate` → `loadMappingVersion` → `applyMappingGraph`) actually reads — not the `formFields[].mappings` that `applyGraphToTemplate`/`persistVersion` update. I-130's mapping had drifted out of `MappingGraphService.activate()`'s reach entirely (its formFields count grew after the version that was last actually activated, so `activate()`'s strict "zero unmapped fields" gate can never pass for it again — true before this phase too). Repointed `activeMappingVersionId` to the new version directly, mirroring the state the template already operated in.
- **Found and fixed a third, genuinely pre-existing bug** in `CanonicalBuilderService.build()`: `merged.profile.beneficiary = rawCollections.beneficiary` unconditionally overwrote the entire `beneficiary.*` canonical namespace with the (often empty, cross-case) `Beneficiary` model document, discarding whatever `addQuestionnaireCandidates` had just merged in from real checklist answers — the exact same overwrite bug the code's own comment says was already fixed for `company.*` and `petitioner.*`, just missed for `beneficiary.*`. Fixed with the identical established pattern: `{ ...(merged.profile.beneficiary || {}), ...rawCollections.beneficiary }`.

**4. Reconciliation durability.** `ensureDefaultVisaTemplates()` reconciles `Question.mapping` from source-code definitions back onto the DB on every questionnaire fetch (5-minute TTL cache, or immediately with `force:true`) for any non-published questionnaire — confirmed live: a DB-only fix to the `applicant.*` namespace was silently reverted the next time this ran. All four affected questionnaires' **source files** (`h4Checklist.js`, `cosF1Checklist.js`, `cosF2Checklist.js`) were corrected directly, not just their DB documents, so the fix survives redeploys/reconciliation. I-130's checklists were unaffected by this risk (their source definitions never had a `mapping` key authored at all, so reconciliation never touches that field there) — only the DB-level fix was needed.

### Result: system-wide coverage, before → after

| Form | Before | After | Note |
|---|---|---|---|
| I-129 | 17/101 | 94/101 | Improved as a side-effect of the traceability-service fix (I-129 also has some direct-binding edges) — no data on I-129 itself changed |
| I-907 | 22/54 | 31/54 | Shares `cos_f1_questionnaire` |
| I-539 | 27/44 | 36/44 | Shares the 4 fixed questionnaires |
| I-539A | 0/32 | 29/32 | Namespace fix. Remaining 3: 1 genuine SSN gap, 2 a pre-existing, unrelated `contact.address.line2` → "Business/Org Name" mismapping (a form-governance data-quality defect, out of this phase's scope — flagged, not fixed) |
| I-129F | 0/34 | 34/34 | Traceability-service fix only; mapping untouched |
| I-130 | 0/33 | 32/33 | Canonical routing fix (the real bug) |
| I-134 | 0/96 | 0/96 | Deferred to Phase 3 (registry gap) |
| **Total** | **66/394** | **256/394** | |

### Tests

- `ChecklistFieldTraceabilityService.test.js`: 11 Phase 1 tests + 9 new Phase 2 tests (I-129F recognition without mapping changes, I-130 dual-checklist-style canonical convergence, I-130/I-539A coverage assertions, `applicant.*` namespace absence).
- `i130-ir1-checklist-to-pdf.test.js` (new): end-to-end regression proving a **real** `i130_ir1_petitioner_checklist`/`i130_ir1_beneficiary_checklist` answer (the previously-broken key style) reaches I-130's `CaseForm.filledData` via the real `AutoFillService.generate` pipeline — the concrete proof the production bug is fixed.
- `i130-k3-golden-case.test.js` (pre-existing): re-run and still passes — confirms the K-3 checklist style (and the full PDF-generation pipeline) is unaffected by the I-130 mapping-graph rewrite.
- `cos-f2-checklist-and-forms.test.js`: one pre-existing test asserted the old, broken `applicant.*` values as if correct — updated to assert the fixed `person.*`/`immigration.*` values instead (a genuine correction, not a weakened assertion).

### Pre-existing failures (confirmed, not caused by this work)

Re-verified via `git stash` isolation:
- `case-lifecycle-form-provisioning.test.js` — "Phase 13 - CaseForms are provisioned immediately..." (missing expected rejection for a staff-override conflict edge case).
- `h1-i129-mapping.test.js` — "AC1 - every mapped edge's source path resolves to a non-undefined value" (13 `raw.questionnaireAnswers.employer_foreignCompany_*` paths).
- `single-party-filing.test.js` — "guardrail: employment-workflow and family-workflow route registrations are unaffected" (route count drifted 9→14 from unrelated feature work over time; confirmed present with every Phase 1/2 change stashed out).

### Deferred to Phase 3

- **I-134**: no checklist assigned in the registry at all — needs a checklist-mapping-seed decision (which checklist(s) legitimately apply to an Affidavit of Support), not canonical authoring.
- **`h4_ead_questionnaire`**: shares the identical `applicant.*` namespace bug as the four fixed questionnaires; left untouched since it isn't one of I-539A's registered checklists (out of instructed scope).
- **I-539A's `contact.address.line2` → "Business/Org Name" edge**: a pre-existing, unrelated form-mapping data-quality defect (a nonsensical PDF-field-to-canonical-path binding), surfaced by this phase's audit but not in scope to fix.
- **I-907/I-539's own remaining untraced fields** (23 and 8 respectively): not individually audited field-by-field in this phase — the four questionnaires' fixes lifted them as a side effect, but a dedicated pass wasn't done.
- **OCR/Document-Intelligence → canonical → CaseForm wiring** (governing spec Rules 6/7/9): `CaseForm.fieldValueProvenance`'s `source: "ocr"` enum slot exists in the schema but nothing writes to it yet; `DocumentExtraction` results reach canonical data only indirectly (via triggering a full profile rebuild, not by passing extracted field values through). Investigated but not implemented this round — a substantial, separate piece of work.
- **Missing-data diagnostics UI** (spec Rule 16: distinguishing "no canonical value" vs "no checklist mapping" vs "OCR needs review" vs "wrong participant" etc. in the governance UI) — the underlying data now exists to build this (via `matchType`/`canonicalPathSource` on traceability results) but no UI was added for it.
