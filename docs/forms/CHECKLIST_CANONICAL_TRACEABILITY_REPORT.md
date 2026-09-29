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

---

## Phase 3 — Closing the Remaining Gaps, OCR/Canonical Autofill, Readiness & Governance

**Goal:** close every Phase-2 deferral first, then build the OCR→canonical→CaseForm pipeline with provenance, a real readiness engine, missing-data diagnostics, admin governance extensions, and USCIS edition governance — all reusing Phase 1/2's architecture, never a parallel system.

### 3A — Closing the four explicit Phase-2 gaps

**1. I-134 checklist mapping.** Investigated I-134's actual use (Declaration of Financial Support, filed at the K-1/K-3 visa-interview stage, distinct from the later I-864 used after AOS marriage). Per explicit instruction: added `VisaFormMapping` rows for I-134 under **K-1** and **K-3** (`CONDITIONAL`, `STANDALONE`, `stage: "consular_interview"`), and assigned each the existing petitioner checklist already registered for that visa type (`k1_petitioner_checklist` / `k3_petitioner_checklist`, `CONDITIONAL`, `role: "petitioner"`) — no new checklist invented, since the petitioner checklist already collects the sponsor's identity/employment data I-134 needs. Coverage: 0/96 → 24/96 (the remaining 72 are genuinely income/household-size/asset fields no existing checklist collects — a real missing-data gap, not fabricated around).

**2. `h4_ead_questionnaire`'s `applicant.*` namespace.** Fixed field-by-field, mirroring the Phase 2 fix already applied to its sibling H-4 questionnaires exactly: `applicant.lastName/firstName/middleName/gender/dateOfBirth/aNumber/mailingAddress/i94Number/passportNumber/passportCountry/passportExpirationDate/currentVisaStatus` → `person.lastName/firstName/middleName/gender/dob/alienNumber`, `contact.address.line1`, `immigration.i94.number`, `person.passport.number/country/expirationDate`, `immigration.currentStatus`. `usPhysicalAddress` left unmapped (same precedent: no distinct "physical, if different from mailing" canonical field). Verified every mapped path resolves to a real `CanonicalFieldRegistryService.BASE_FIELDS` entry.

**3. I-539A's mapping graph.** Investigation found the reported `contact.address.line2` → "Business/Org Name" edge was one symptom of a much larger defect: **16 of 33 edges** in both persisted draft versions were wrong (e.g. Family/Given/Middle Name fields on page 1 and the page-2 repeat occurrence bound to `contact.address.line1`; Interpreter's/Preparer's Business-Org-Name/Given-Name/Family-Name/Email/Telephone fields all bound to the applicant's own `contact.*` — a different participant with no canonical namespace of its own; a Travel-Document-Number field and two Yes/No checkboxes also bound to address fields). Confirmed with the user before fixing the whole graph (scope was materially larger than "one edge"). Corrected via `MappingGraphService`'s real governance path (`loadCurrentGraph`/`validateGraph`/`persistVersion`/`audit` — never a raw DB write): 6 edges corrected to `person.lastName/firstName/middleName`, 16 invalid edges removed (left genuinely unmapped — Interpreter/Preparer have no canonical namespace, and never bypassing the "different participant" rule by reusing the applicant's own identity). This template was never activated (`status: needs_review` both before and after), so no live PDF generation was affected. Coverage: 17/17 traced (all mapped edges now resolve to real checklist questions), 33 → 17 total mapped fields (16 invalid ones removed rather than left wrong).

**4. I-907/I-539 field-by-field audit** (see 3B below — folded in together since the same systemic bug was found in I-907).

### 3B — Completing the I-907/I-539 audit

Live coverage numbers had already improved since the Phase 2 report was written (I-907 31/54→ now measured 40/44 total mapped, I-539 36/44→32/33) — some other work between Phase 2 and Phase 3 evidently touched these forms. Re-ran `coverageSummary()` fresh rather than trusting the stale numbers, then audited every untraced edge individually:

**I-907** (7 untraced, then a further 6 found by regression testing beyond the untraced set — the SAME systemic bug as I-539A):
- `contact.address.country` → Mailing/Physical Address Country (×2): **correct**, just no checklist question sources it yet — classified "missing checklist → canonical mapping," left as-is.
- `immigrationHistory.receiptNumbers` → Receipt Number of Related Petition: **correct** (a real, recognized `QuestionLibraryItem.canonicalPath`, a parallel-but-valid namespace to `CanonicalFieldRegistryService`'s `immigration.receiptNumbers[]` — investigated before assuming invalid), no checklist question sources it yet — same classification.
- "Classification or Eligibility Requested" was bound to `contact.address.line2` — **invalid**; corrected to `case.visaType` (the real matching concept).
- Representative's Name, and Interpreter's/Preparer's Business-Org-Name/Given-Name/Family-Name/Email fields, were all bound to the applicant's own `contact.*` — **invalid**, same bug class as I-539A; all removed (different participants, no canonical namespace).
- Coverage: 44 → 40/44 mapped fields traced (4 corrected/removed edges' targets stay genuinely unmapped rather than fabricated).

**I-539** (3 untraced): `immigration.i94.expirationDate` → I-94 expiration date field: **correct** concept, just not yet a registered `BASE_FIELDS` entry (added one, mirroring the existing `beneficiary.i94ExpirationDate` precedent) and no checklist sources it yet. **"Beneficiary or Applicant" First/Last Name fields were bound to `company.name`** (the employer/petitioner's name) — a **real, live production bug**: this template's mapping was `status: active` (mappingVersion 3), meaning any I-539 case's own name was being filled with the employer's company name on the actual generated PDF. Corrected to `person.firstName`/`person.lastName` via a new draft version (mappingVersion 4) — **left unactivated**, per the existing activation gate; a human must explicitly activate it in the mapping editor before the fix reaches live PDFs.

Every remaining genuinely-unmapped field across both forms carries an explicit classification (missing-checklist-source, no-canonical-consumer, etc.) rather than being left ambiguous.

### 3C/3D — OCR → Canonical → CaseForm, with provenance and precedence

Reused the existing pipeline exactly — no parallel autofill system:
- `CanonicalBuilderService.addOcrCandidates()` (already existed, previously ungated) now gates every OCR-extracted field through `isOcrFieldCanonicalEligible()`: a field reaches canonical data only if it's human-reviewed (`reviewedBy` set, or `reviewStatus` `approved`/`edited`), **or** it's `reviewStatus: "auto_accepted"` (≥95% confidence, this repo's own existing `confidenceBand()` convention) **with no unresolved `validationIssues`**. Anything lower-confidence or flagged stays parked in `DocumentExtraction`'s own needs-review state — never silently promoted onto a legal government form. `addDocumentExtractionCandidates()` added as a named alias for the same codepath (matching the spec's vocabulary, not a second implementation).
- `AutoFillService.mergeMappedFields()`/`generate()` now write `CaseForm.fieldValueProvenance.source` accurately (`"ocr"` when the merge winner came from OCR, `"case_manager_override"` on a direct CM edit, etc.) instead of leaving that schema slot unused — additively extended with `sourceId`/`sourceDocumentId` so an OCR-derived field traces back to its extraction record.
- Precedence (Case Manager override beats OCR reruns) was already implemented in `CanonicalMergeService`'s existing priority table (`case_manager_verified` 500 > `ocr_verified` 450 > `ocr` 350) and `mergeMappedFields`'s existing `isReviewedOrManual` skip — verified with a new regression test that an override survives an OCR rerun, rather than re-implementing precedence from scratch.
- Genuine schema gap found and fixed additively: `fieldValueProvenance` is a real Mongoose `Map`, which rejects keys containing `.` — but real PDF AcroForm field IDs are routinely dotted. Reversibly encoded at this file's read/write boundary only (`.` ↔ `‥`), schema left untouched.
- Tests: `CanonicalBuilderService.ocrGate.test.js` (5), `AutoFillService.ocrProvenance.test.js` (3) — covering high-confidence OCR reaching canonical+CaseForm with correct provenance, low-confidence/unreviewed OCR never auto-populating, and CM overrides surviving OCR reruns.

### 3E/3F — Readiness engine and missing-data diagnostics

New `FormReadinessService.js`, built entirely on existing services (`FormMappingService.loadMappingVersion`, `MappingGraphService`, `ChecklistFieldTraceabilityService`, `MappingResolver`, `visaFormMapping.service.resolveChecklistsForCase`) — no new mapping/traceability logic:
- Per field: `mapped` (has a graph edge) is never conflated with `hasValue` (present in `filledData`). Status is `unmapped` / `missing_value` / `needs_review` / `filled`; a value with a low-confidence edge or unconfirmed OCR provenance is `needs_review`, never silently counted as filled.
- Readiness status is rule-based, worst-first, never from a percentage: **BLOCKED** (a required field has no mapping edge at all) > **NOT_READY** (a required mapped field has no value) > **NEEDS_REVIEW** (a required field's value is unconfirmed/low-confidence) > **READY**.
- `traceMissingField()` walks PDF field → canonical `sourcePath` → checklist question (scoped to checklists actually applicable to that case) → participant/role, exactly as the spec's I-129 `person.currentStatus` example describes. No matching question → `NO_MAPPED_COLLECTION_SOURCE` (never fabricated); a matching-but-unanswered question → `AWAITING_CHECKLIST_ANSWER`; an answered-but-never-reaching-the-field case → `ANSWERED_BUT_NOT_REACHING_FIELD` (flags a real autofill bug, the same class as the I-130 bug found in Phase 2).
- Two new read-only, case-access-gated routes: `GET /form-mappings/case-forms/:caseFormId/readiness` and `.../fields/:targetFieldId/trace`.
- Documented limitation: `fieldValueProvenance`'s real enum has no `"needs-review"` value, so the provenance breakdown reports the real enum (`canonical`/`case_manager_override`/`ocr`/`questionnaire`) plus a separate cross-cutting `needsReviewCount`, rather than inventing a schema value that doesn't exist.
- Tests: `FormReadinessService.test.js`, 9/9 passing (READY, BLOCKED-outranks-NOT_READY, NOT_READY with correct trace, NEEDS_REVIEW for pending OCR, post-approval reclassification, UNMAPPED_PDF_FIELD trace).

### 3G is deferred — see "Remaining genuine limitations" below.

### 3H/3I — Admin governance UI and Checklist Health

Extended, not replaced, the existing Form Governance UI:
- `ChecklistFieldTraceabilityService.governanceDefects(templateId)` (per-form) and `checklistHealth()` (system-wide) — reusing `MappingGraphService.validateGraph()`'s existing defect codes verbatim (`INVALID_SOURCE`/`INVALID_TARGET`/`BROKEN_MAPPING`/`BROKEN_REPEATING_MAPPING`/`DUPLICATE_TARGET_MAPPING`/`MISSING_FIELD_MAPPING`/`MISSING_REQUIRED_MAPPING`) rather than inventing a second validation vocabulary, and cross-referencing `checklistMappings.seed.js`'s own documented "deliberate GAP" scope notes so an intentional gap is never flagged as a defect.
- `FormGovernance.jsx` gained a "Checklist Health" panel (orphan/scaffold/not-live/invalid-canonical-path/no-consumer filters); `FormGovernanceDetail.jsx` gained a per-form defects summary and a "Defects" column on the field-mapping table. Read-only — no auto-fix action, matching the spec's explicit "never automatically modify records from the diagnostic UI" rule.
- Not implemented: a distinct "invalid form reference" category (no real case of `VisaFormMapping.formTemplateFormCode` pointing at a nonexistent template was found — not fabricated as a check with nothing to detect).
- Tests: `governanceDefectsAndChecklistHealth.test.js`, 6/6 passing; `Admin/frontend` build verified clean.

### 3J — USCIS edition governance

Found that field-level edition diffing and template comparison (`FieldDiffService`, `FormComparisonService`, wired into `FormVersionService.createTemplate`) **already existed** in `Backend/src/modules/uscis-lifecycle/` — confirmed live against real data (I-129 has an active 2026-02-27 edition and a `review`-status 2026-09-09 edition linked via `parentVersion`, with a real detected field rename between them). The actual gap was narrower than the spec implied: nothing cross-referenced a field diff against the **mapping graph's** edges/checklist traces, and there was no activation gate tied to it.
- New `FormEditionComparisonService.compareEditions()` reuses `FieldDiffService.diff()` for the raw field diff, adds only the one genuine gap it doesn't cover (a required/optional flip), and cross-references both against the old template's live mapping graph and `ChecklistFieldTraceabilityService.traceAllFieldsForTemplate()` to produce `affectedMappingEdges` and `brokenChecklistTraces`.
- `MappingGraphService.activate()` gained one additive block *after* its existing "every field mapped" gate: activating a new edition's mapping is blocked (`422`, `UNREVIEWED_EDITION_CHANGES`) until a human explicitly acknowledges the edition's breaking changes via a new `acknowledge()` step — the pre-existing gate and `validateGraph()` are untouched.
- New read-only preview route (`GET .../edition-diff`) and acknowledgement route (`POST .../edition-diff/acknowledge`).
- Tests: `FormEditionComparisonService.test.js`, 6/6 passing (genuine removal blocks activation until acknowledged; a non-breaking edition is unaffected; the pre-existing unmapped-required-field gate still works unchanged) — verified against both disposable fixtures and the real I-129 edition pair, read-only.

### Final coverage, before (Phase 2) → after (Phase 3)

| Form | Phase 2 | Phase 3 | Note |
|---|---|---|---|
| I-129 | 94/101 | 96/101 | Unaffected by this phase's edits; number drifted slightly from unrelated concurrent work |
| I-907 | 31/54 | 40/44 | Field-by-field audit; 4 invalid edges corrected/removed, total mapped-field count also dropped from removing genuinely-wrong edges |
| I-539 | 36/44 | 32/33 | **Live production bug fixed** (company.name → person name); registry BASE_FIELDS gap closed |
| I-539A | 29/32 | 17/17 | Whole mapping graph corrected; 16 invalid edges removed rather than left wrong |
| I-129F | 34/34 | 34/34 | Unchanged |
| I-130 | 32/33 | 32/33 | Unchanged (untouched this phase) |
| I-134 | 0/96 | 24/96 | Checklist assigned (K-1/K-3, reusing existing petitioner checklists) |

### Tests and regression

- New test files this phase: `checklistMappings.test.js` (+1 K-1/K-3/I-134 test), `h4EadQuestionnaire.canonicalPaths.test.js` (3), `i539a-mapping-graph.test.js` (3), `i907-mapping-graph.test.js` (2), `i539-beneficiary-name-mapping.test.js` (1), `CanonicalBuilderService.ocrGate.test.js` (5), `AutoFillService.ocrProvenance.test.js` (3), `FormReadinessService.test.js` (9), `governanceDefectsAndChecklistHealth.test.js` (6), `FormEditionComparisonService.test.js` (6) — all passing.
- Combined regression sweep across `form-mapping/`, `form-registry/`, `questionnaires/`, `canonical/`, `uscis-lifecycle/`, `uscis-form-import/` tests: 478/487 passing. All 9 failures confirmed pre-existing and unrelated to this phase's changes, via `git stash` isolation (reproduced identically with this phase's files stashed out):
  - `visaFormMapping.test.js` — H-1B/L-1A/SB-1 registry-applicability assertions (3) — confirmed failing identically with every Phase 3 file stashed.
  - I-130/K-3 fan-out and reverse-sync assertions (5, across `AutoFillService.overrideField.k1k3-fanout.test.js`, `phase3.fanout-invariant.test.js`, `i130-k3-golden-case.test.js`) — the same pre-existing I-130 checklist-key-mismatch class of issue this document already tracks; one of the 5 failed on a leftover test-fixture duplicate-key collision from repeated local runs, not a real regression.
  - `h1-i129-mapping.test.js` AC1 — one of the three failures this document has tracked since Phase 2, unchanged.
- One operational incident during this phase: running four workstreams concurrently in the same working tree caused a `git stash` collision between agents, which transiently wiped the K-1/K-3 I-134 registry rows from the shared database (the source seed files were never affected, only the already-seeded DB documents). Caught during the 3K coverage re-run (I-134 unexpectedly back at 0 checklist keys), root-caused, and fixed by re-running the idempotent seed loaders (`loadVisaFormMappings.js`, `checklistMappings.seed.js`) — verified restored and re-tested clean.

### Remaining genuine limitations

- **3G (Case Manager readiness UI)** was not built this phase — the backend (`FormReadinessService` + routes) is real and tested, but no frontend surface consumes it yet.
- **I-907's `Classification or Eligibility Requested` fix and I-539's `person.firstName`/`lastName` fix** are both live in the database's mapping graphs; I-539's specific fix sits in an **unactivated draft version** (mappingVersion 4) — someone must explicitly activate it for the live-bug fix to reach generated PDFs.
- I-134's remaining 72/96 unmapped fields (income, household size, assets) are a genuine missing-checklist-source gap, not fabricated around — Affidavit-of-Support financial data collection doesn't exist yet in any checklist.
- I-130 remains untouched this phase; its Phase 2-documented checklist-key-mismatch-adjacent test failures persist exactly as before.
- Coverage percentages throughout this document (66/394, 256/394, etc.) only ever covered 7 of the ~71 form rows in the full registry — system-wide 100% traceability was never in scope, by design (per the spec's own "do not pursue 100% coverage artificially" rule).
