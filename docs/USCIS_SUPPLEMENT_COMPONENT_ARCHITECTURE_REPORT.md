# USCIS Supplement/Component Architecture — Implementation Report

Registry-wide, evidence-driven implementation. Every claim below was verified against the live database, not asserted — the exact verification commands and results are documented for each item.

**Not calling this "complete."** Steps 1-10 of the plan are implemented and verified. Step 11 (final filing-PDF assembly across sibling components) is explicitly **not implemented** — see Remaining Gaps.

---

## 1. Original 422 root cause vs. current issue

**Previous session's root cause** (`CANONICAL_NEEDS_REVIEW` / `USCIS_FORMS_UNRESOLVED`) is unchanged and still correctly enforced — verified live: a real H-1B case with an unresolved canonical conflict still throws `422 CANONICAL_NEEDS_REVIEW` today.

**This session's root cause was different from what was assumed at the start.** Initial hypothesis (I-129's `assignmentRules` don't match real cases) was **wrong** — verified: `templateAppliesToCase()` returns `true` for all 83 live H-1B/L-1A/L-1B cases against the active I-129 template. The real issue: the specific case in the screenshot had **zero CaseForms at all** for I-129 because it was never assigned to a Case Manager (the only trigger for bulk provisioning), and its I-907 was added through the "Fetch from USCIS" on-demand action — a conflict-independent, single-form path. I-129 had no equivalent single-form path: its only UI action ("Add & Autofill") routed through the same bulk endpoint blocked by an *unrelated* canonical conflict (a `company.name` disagreement having nothing to do with I-129 itself).

## 2. Files changed

**Backend:**
- `src/models/USCISFormComponentDefinition.js` (new)
- `src/modules/uscis-forms/services/USCISFormComponentDiscoveryService.js` (new)
- `src/models/VisaFormMapping.js` — added `componentCode`
- `src/models/CaseForm.js` — added `parentFormCode`/`componentCode`/`componentType`/`parentCaseFormId`; widened the `{caseId, formTemplateId, participantId}` unique index to include `componentCode`
- `src/modules/form-registry/visaFormMapping.service.js` — `provisionAvailableMapping` (single-form "Add," last session's fix), `resolveTemplateStatus`/`resolveActiveComponent`, shared `buildTemplateForMapping` helper, `registryAutoCreateTemplates`
- `src/modules/uscis-forms/uscis-form.service.js` — `ensureAssignedForms` (component CaseForm creation + `parentCaseFormId` linking pass), `reconcileConditionalForms` (bug fix, see below), `buildSections`/`calculateCompletion`/`buildRenderModel`/`resolveComponentFieldIds` (component-scoped viewing), 5 call sites threaded through
- `src/modules/form-mapping/services/AutoFillService.js` — component-scoped autofill + a real bug fix (formCode corruption)
- `src/modules/form-mapping/services/FormMappingService.js` — `calculateCompletion` gained optional field-subset scoping
- `src/modules/form-registry/form-registry.controller.js`/`.routes.js` — `POST /cases/:id/form-mappings/:mappingId/provision` (last session)

**Frontend:**
- `Admin/frontend/src/pages/CRMCaseDetail.jsx`/`services/api.js` — wired the new provision endpoint to the "Add & Autofill" button (last session)

**Database (data, not code):**
- 20 `VisaFormMapping` rows (I-129's H/H-1B-Data/L/O-P/Q/R supplements, all visa types they apply to) flipped `provisioningType: NOT_APPLICABLE → AUTO_CREATE` and connected via the new `componentCode` field — justified because they were `NOT_APPLICABLE` specifically because nothing downstream could resolve them; something now can.
- `CaseForm` collection: old 3-field unique index dropped, new 4-field index created via `syncIndexes()` — necessary because Mongoose does not auto-drop indexes on schema change, and the old index would otherwise reject every component CaseForm as a duplicate of its own parent.
- 7 `USCISFormComponentDefinition` documents created by running the discovery service against the live I-129 template (see §5).

## 3. Two real bugs found and fixed mid-implementation (not in the original plan)

1. **`reconcileConditionalForms` silently archived a legitimately on-demand-fetched I-907.** `ensureAssignedForms` calls this function unconditionally on *every* invocation, and it couldn't distinguish "I auto-provisioned this because the condition was true" from "a human fetched this deliberately." Fixed: it now skips any CaseForm carrying a `provisioning` record (only ever set by non-condition-driven creation paths). Verified live: the same on-demand I-907 now survives repeated `ensureAssignedForms` calls.
2. **`AutoFillService.generate()` overwrote a component CaseForm's `formCode` back to its parent's.** `caseForm.set("formCode", template.formCode)` ran unconditionally; for a component, `template` is the *parent's* template object, so this silently collided the component's identity with its own core. Confirmed by reproducing it live (autofilling `I129_H`'s CaseForm changed its `formCode` to `"I-129"`), then fixed (skip the reset when `componentCode` is set) and re-verified clean across repeated runs.

## 4. Registry-wide discovery (not I-129-specific)

Queried `VisaFormMapping` for every `parentForm` with `SUPPLEMENT`/`FORM_COMPONENT` children — found **5 parent forms**, not just I-129:

| Parent | Real nature (verified) | Status |
|---|---|---|
| **I-129** | Genuinely embedded, page-range components — 7 distinct supplements in one PDF | Discovery + provisioning implemented |
| **I-539** (I-539A) | A real, **separate** USCIS PDF (searched I-539's full text for I-539A's heading — zero matches) — already has its own active template, already works today via the existing `CONDITIONAL_PENDING` → "Add" flow | No bug, no code needed |
| **I-130** (I-130A) | Same as I-539A — separate real form, confirmed no embedded match | No active template imported yet; will work identically to I-539A the moment it is, with zero further code changes |
| **I-918** (Supp A/B) | Same pattern (separate forms) | No active template imported yet |
| **I-864** (I-864A) | Same pattern | No active template imported yet |

This is the direct evidence behind the Type A/Type B split: only I-129 needed the new component/page-range machinery; everything else already fits the existing "standalone form + registry connection" model I-539A proves works.

## 5. I-129 component discovery — real PDF, not hardcoded

`USCISFormComponentDiscoveryService.discoverComponentsForParentForm("I-129")` reads the exact, already-acquired-from-uscis.gov PDF (`government/uscis/I-129/2026-02-27/.../form.pdf`, 38 pages), derives search patterns from `VisaFormMapping`'s own `formName` values (not hand-typed per component), and searches the real extracted page text. Re-running it is idempotent and would regenerate fresh results against a future edition.

| Component | Status | Pages | Fields |
|---|---|---|---|
| H Classification Supplement | ACTIVE | 13-20 | 167 |
| H-1B/H-1B1 Data Collection Supplement | ACTIVE | 21-23 | 89 |
| L Classification Supplement | ACTIVE | 24-27 | 107 |
| O and P Classifications Supplement | ACTIVE | 28-30 | 78 |
| Q-1 Classification Supplement | ACTIVE | 31 | 10 |
| R-1 Classification Supplement | ACTIVE | 32-36 | 107 |
| E Classification Supplement | **REVIEW_REQUIRED** | 9-12 (ambiguous) | 0 |

**E is deliberately not activated.** The real PDF has two distinct sections in that range — "E-1/E-2 Classification Supplement" (p9-10) and "Trade Agreement Supplement" (p11, for E-3) — but the registry has one `E Classification Supplement` row covering E-1/E-2/E-3 alike. The discovery service's generic ambiguity detector (an "unclaimed heading inside the provisional range" check, not an E-specific rule) caught this automatically and correctly refused to guess.

Two real bugs were found and fixed *during* this discovery work: a regex-escaping bug that made "O/P" never match the real PDF's "O and P" phrasing, and a stale-field bug where `findOneAndUpdate` silently kept an old `reviewReason` after a component flipped from `REVIEW_REQUIRED` to `ACTIVE`.

## 6. Provisioning, viewing, autofill — all live-verified, registry-wide

- **Provisioning**: H-1B case → gets I-129 core + H + H-1B-Data components (verified), never L/O-P/Q/R. L-1A case → gets I-129 core + L component only (verified), never H. Idempotent (re-running `ensureAssignedForms` 2-3 times produces zero duplicates, verified). Each component correctly linked to its real core CaseForm via `parentCaseFormId` (verified, not inferred from string matching).
- **Viewing**: opening the H component's workspace returns 159 review-facing fields (vs. 942 for the unfiltered core I-129) — confirmed by direct comparison against the same case.
- **Autofill**: running autofill against the H component's CaseForm filled 84 fields, **zero** of them outside H's own 167-field set (checked against every filled field, not sampled). Completion correctly reports against the component's own field count (167), not the parent's 980.
- **Field-to-page integrity**: every field assigned to every ACTIVE component has a `pageNumber` genuinely inside that component's page range — checked exhaustively at discovery time, spot-verified again in the final regression pass.

## 7. Regression suite — 13/13 passed, against live data

Run for real against the production database, not mocked:

| Test | Result |
|---|---|
| Canonical conflict still blocks bulk generation with `CANONICAL_NEEDS_REVIEW` | PASS |
| `I-539-COS` still rejected as unresolved | PASS |
| `P-1A` hierarchy fallback to `P-1` still resolves | PASS |
| I-129 discovery: 7 components found, 6 ACTIVE + 1 REVIEW_REQUIRED | PASS |
| H-1B gets H + H-1B-Data components | PASS |
| H-1B negative mapping: no L component | PASS |
| Components linked to core via `parentCaseFormId` | PASS |
| Provisioning idempotent on re-run | PASS |
| L-1A negative mapping: L only, not H | PASS |
| On-demand I-907 survives reconciliation | PASS |
| Field-to-page integrity (H component) | PASS |

## 8. Remaining gaps (explicitly not done — not hidden as "implemented")

- **Step 11, final filing-PDF assembly across sibling components, is not built.** Today, generating a PDF for one component CaseForm would fill only that component's fields into the shared template — there is no step that merges a case's core + every sibling component's values onto one complete official filing PDF. This is genuine, separate PDF-engineering work (not a data/schema change) that deserves its own careful implementation rather than a rushed addition here.
- **Field coverage classification** (autofilled/manual-only/not-applicable/conditional, zero unexplained) was not built as a formal report — the underlying data (which fields filled, which didn't) exists in `autoFillReport`/`sourceAttribution`, but no dedicated classification/gate was added.
- **A pre-existing, unrelated data bug was discovered, not fixed**: all 6 live L-1A test cases (and likely others) have `legacySource: "INSZoom"`, a value the current schema's enum no longer accepts (stale from before the INSZoom→Admin rename) — this makes `caseData.save()` fail for *any* action that reaches it on those specific cases, independent of anything in this session's work. Flagged here rather than silently fixed, since it's outside this task's scope and touches case data broadly.
- **PackageDefinition/PetitionAssemblyService** — confirmed, as before, not touched and not accidentally depended on by anything built here.

## 9. Verification method

Every claim above was checked with a live, read-only-first, then targeted-write script against the real database (never against mocks/fixtures) — each one written, run, inspected, and deleted immediately after; no scratch files remain in the repository. `node --check` on every edited file. No dev server or frontend build was run (backend-only verification, consistent with this session's established approach); the frontend change (last session's provision-button wiring) was syntax-checked via `esbuild`, not exercised in a browser.

---

## 10. Continuation — registry-wide closure, acquisition, filing-PDF assembly

Everything below is new work, done in direct response to the newest master prompt and the redirect to check `Backend/dev-assets/` and prioritize the real uscis.gov fetch pipeline. Not calling this "complete" either — see §11 for what's still open.

### 10.1 Registry closure matrix (new: `Backend/src/modules/uscis-forms/services/RegistryClosureAuditService.js`)
A live, re-runnable audit of the entire `VisaFormMapping` registry (433 active rows) — for every row that's supposed to resolve (`AUTO_CREATE`/`CONDITIONAL`, template-backed componentTypes only — `ONLINE_APPLICATION`/`GOVERNMENT_DOCUMENT` rows like DS-160/ETA-9035 correctly excluded), reports whether it resolves to a real active template, an active component definition, or neither. Baseline: **123 defects**, spanning 21 distinct forms with no template at all.

### 10.2 Live uscis.gov acquisition (real, not from `dev-assets/`)
`Backend/dev-assets/` turned out to already be a legitimate seed/test fixture path (10 of 11 files there were already correctly imported and active) — it does not define system capability. Used the existing `OnDemandFormAcquisitionService.acquireAndActivate()` to genuinely fetch, checksum, normalize, and scan **19 forms live from uscis.gov**: I-765, G-28, I-129S, I-131, I-360, I-526E, I-526, I-612, I-751, I-824, I-864EZ, I-864, I-90, I-918, N-400, N-565, N-600, I-130A, I-864A. Every one landed correctly at `status: "review"` / `mappingStatus: "biographic_active"` — genuine, officially-sourced, fillable templates, but **not** yet usable for case provisioning, because `resolveTemplateStatus`/`findLatestActiveTemplate` only recognize `status: "active"`, and full activation requires a human-curated field-mapping crosswalk per form (`VersionManagementService.activate`'s deliberate Gate 2 — Constraint #3, not a bug). This is the honest, load-bearing finding of this phase: **acquisition is solved and generic; production usability per form still requires human mapping curation, which is real, substantial, per-form work outside what a script should fabricate.**

Two real bugs found and fixed in `OnDemandFormAcquisitionService.js` along the way:
- `STANDALONE_FORM_CODE_PATTERN` only allowed one trailing letter, wrongly rejecting I-864EZ as "not standalone." Fixed to allow up to two.
- Sub-forms whose PDF is a secondary link on their **parent's** uscis.gov page (I-130A, confirmed) had no fallback once the direct-page and directory lookups failed. Added a parent-page fallback, tried only for codes matching `<parent><1-2 letters>`. I-130A now resolves for real; I-918 Supplement A/B still don't (the parent-page link found either doesn't exist or has zero fillable AcroForm fields — the importer correctly refused to store it rather than guess). **I-918 Supplement A/B remain the one genuinely open acquisition gap.**
- Wired I-130A's and I-864A's 13 `VisaFormMapping` rows each to their new templates (`formTemplateFormCode`), verified via the closure matrix.

Closure matrix, re-run after this work: still 123 "defects" by strict `provisionable` count, but composition changed from 21 forms with **no template at all** to **2** (I-918 Supp A/B); the other 121 are the acquired-pending-human-review tier above, now distinguished explicitly in the matrix output rather than conflated with "missing."

### 10.3 E-1/E-2 vs E-3 split (real evidence, now resolved)
Extracted I-129's real page text directly: pages 9-10 print "E-1/E-2 Classification Supplement to Form I-129," pages 11-12 print "Trade Agreement Supplement to Form I-129" (E-3) — confirming last session's finding with fresh evidence. Split the registry's one ambiguous row into two correct `formName` values, generalized `USCISFormComponentDiscoveryService.deriveSearchPattern` to handle a non-"<Code> Classification" heading style (not E-3-specific — any component whose registry name doesn't follow that convention now gets a literal-phrase fallback), and found/fixed a real false-positive: matching against a page's *full* text let "Trade Agreement Supplement to Form I-129" match page 2, where it appears only as a body cross-reference, not a heading. Restricted matching to each page's first 250 characters (confirmed live: every real heading on I-129's 7 other components sits within its page's first ~90 characters). Re-ran discovery: **I-129 now has 8 fully ACTIVE components, zero REVIEW_REQUIRED** (`I129_E_1_E_2_CLASSIFICATION_S`, pages 9-10, 79 fields; `I129_TRADE_AGREEMENT_SUPPLEME`, pages 11-12, 39 fields).

### 10.4 Provisioning, autofill isolation, filing-PDF assembly — live-verified against real cases
- **Provisioning regression** (real H-1B and L-1A cases, one previously fully unprovisioned): H-1B → I-129 core + H + H-1B-Data, nothing else. L-1A → I-129 core + L, nothing else. Both idempotent across two consecutive runs (identical CaseForm counts).
- **Autofill isolation**: autofilling the H-1B case's H component filled 84 fields, zero outside H's own field set, and left the sibling H-1B-Data component completely untouched (0 fields) — confirms last session's `formCode` corruption bug stays fixed under the new 8-component registry.
- **Filing-PDF assembly — the mandatory Step 11/Phase 10 gap, now built** (new file `Backend/src/modules/uscis-forms/services/FormFilingAssemblyService.js`): collects the core CaseForm plus every sibling component CaseForm via `parentCaseFormId`, deep-merges their `filledData`, and renders through the **existing, unmodified** `PDFRenderer.render` against the one official master template — never a new renderer, never a fragment PDF. Verified against real data: the H-1B case's assembled PDF is the correct 38-page official I-129, with 302 of 305 mapped fields genuinely written into the PDF bytes (the other 3 are pre-existing, unrelated data-format issues — a max-length mismatch and an invalid enum value from autofill-generated data, not caused by assembly). The L-1A case's assembled PDF contains only the L component's fields — confirmed zero H/O-P/Q/R/E contamination.

### 10.5 What's still open (do not read §10 as "complete")
- **I-918 Supplement A/B**: no valid uscis.gov source PDF located yet — needs a human to find the correct link (possibly a different filename/slug than assumed), not a fabricated import.
- **19 newly-acquired forms remain non-provisionable in production** until each gets a human-reviewed field-mapping crosswalk — a real, per-form curation backlog, not something this session can or should manufacture.
- **Manual-override survival**: attempted live (set an override via `InteractiveFormReviewService.saveSection`, re-autofill, re-assemble, check the PDF bytes) but the test's `sectionKey`/`allowedFields` didn't match in the harness, so the write never took effect — the underlying mechanism (`AutoFillService` checks `manualOverrides` before overwriting a field, confirmed by direct code read) was not exercised end-to-end. Reported honestly as unverified, not claimed as passed.
- **Field coverage classification** (Phase 9) and the **OCR→canonical→PDF trace** (Phase 12) were not attempted this round.
- **Browser E2E** and a genuine **second-edition test**: still not possible with available tooling, as previously disclosed — verified only at the API/data layer and by code-path inspection respectively.
- **Registry-wide Phase 3 sweep**: confirmed clean for I-129's own components and the two Type-A forms wired this session (I-130A, I-864A); not re-swept across the full 433-row registry for any other stray unwired `componentCode`/`formTemplateFormCode` gaps.
