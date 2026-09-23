# USCIS FORM_COMPONENT Slicing — Completion Report

Each phase of this work is appended below as its own dated section, most recent last. Do not retitle this document per-phase.

---

## Phase 1 — Generic FORM_COMPONENT page slicing

### Root Cause

`USCISFormComponentDefinition.pageRanges` (e.g. I-129 H's `13-20`) was **write-only metadata**. `USCISFormComponentDiscoveryService` wrote it during discovery, and `uscis-form.service.js`'s `resolveComponentFieldIds`/`buildSections` used it to filter which *fields* the editing UI shows — but nothing anywhere read it to actually slice *pages* out of the rendered/downloaded PDF.

Traced every real render/download call site:
- **View/edit** → `PDFGenerationService.generate` → `PDFRenderer.render({caseForm, template})`, where `template = caseForm.formTemplateId.toObject()` — the full parent template, unconditionally.
- **Official download** (the default engine — `ADOBE_PDF_FILL_ENABLED` defaults to `true`) → `FormGenerationController.downloadForm` → `AdobeFormRenderer.renderFiling({caseForm, template})`, same unconditional full template.
- **Download fallback / non-Adobe** → `PDFRenderer.renderFiling` → `PDFRenderer.render`, same.

`grep` for `copyPages|removePage|pageRanges|startPage|endPage` across `Backend/src/modules/form-generation/` returned zero matches before this change — no page-removal logic existed anywhere in the actual render path; `componentCode` was never read there either. Result: a component CaseForm rendered/downloaded the entire 38-page I-129 PDF (with only that component's own fields filled, the rest blank), never a slice.

### Implementation

New file `Backend/src/modules/form-generation/services/ComponentPageResolver.js` — the single, generic choke point:
- `resolveComponentPages(caseForm, template, totalPages)` — looks up the `ACTIVE` `USCISFormComponentDefinition` for `{parentTemplateId: template._id, componentCode: caseForm.componentCode}` (mirrors `visaFormMapping.service.js`'s `resolveActiveComponent` contract), expands its `pageRanges` into a validated, deduped, ascending list of 1-based page numbers. Returns `null` for a non-component CaseForm (`componentCode` unset) — the existing, unchanged full-document behavior.
- `expandPageRanges` — validates each range (integer, `start ≤ end`, `end ≤ totalPages`) and throws a `COMPONENT_PAGE_RESOLUTION_FAILED` error (status 422, with `parentFormCode`/`componentCode`/`pageRanges`/`totalPages` in `.details`) on anything invalid or missing. **Never falls back to rendering all pages.**
- `keepOnlyPages` — applies the resolved 1-based pages to a live pdf-lib `PDFDocument`, converting to 0-based indices at this one controlled boundary, removing every other page in descending order (so removal never shifts unprocessed indices).

Wired into both real rendering engines (the only two places that ever produce final PDF bytes):
- `PDFRenderer.render` — slices right before `pdf.save()`, **after** fields are filled and flatten/`NeedAppearances` is decided (so field-filling logic is completely untouched).
- `AdobeFormRenderer.renderFiling` — Adobe fills the PDF externally (not via pdf-lib), so slicing is applied as a post-process on the already-reopened output document (reusing the same reopen this file already does for barcode-appearance flattening), right before its own final save.

`PDFFidelityService.verify` (the "read the rendered bytes back and check them" gate both `renderFiling` paths call) needed one connected fix: its page-count check compared the SLICED buffer's page count against the full `template.pdfMetadata.pageCount`, which would reject every correctly-sliced component PDF. Fixed to compute the expected count from the component's own resolved range (bounds-checked against the *original* parent page count, not the already-sliced buffer's count — a real bug caught during live testing, see below). The field-count check was deliberately left comparing against the full template's field count: empirically, `pdf-lib`'s `removePage()` does not prune the AcroForm's field *definitions* for fields whose only widget lived on a removed page (they become inert, not deleted) — so a correctly-sliced 8-page component PDF still reports ~942 AcroForm fields, matching the full template, not the component's own ~167.

### Generic Architecture

```
CaseForm.componentCode
        ↓ (null → skip entirely, full-document behavior unchanged)
USCISFormComponentDefinition.findOne({parentTemplateId: template._id, componentCode, status: "ACTIVE"})
        ↓ (not found → throw, never fall back)
pageRanges: [{startPage, endPage}, ...]
        ↓ validate + expand + dedupe + sort (1-based)
        ↓ convert to 0-based (single boundary)
pdf.removePage(i) for every page not in the set
```

No `if (formCode === "I-129")` or hardcoded page arrays exist anywhere in the new/modified code (confirmed by a final grep sweep across `Backend/src/modules/form-generation/`). The mechanism operates purely on `caseForm.componentCode` + `USCISFormComponentDefinition` — it works identically for any parent form the registry defines components for, not just I-129.

### I-129 Verification (live, real data)

| CaseForm | componentCode | Expected pages | Actual (pdf-lib engine) | Actual (Adobe engine, the default) |
|---|---|---|---|---|
| I-129 core (H-1B case) | `null` | 38 (full) | 38 | 38 |
| I129_H (H-1B case) | `I129_H_CLASSIFICATION_SUPPLEM` | 8 (13-20) | 8 | 8 |
| I129_H_1B_DATA (H-1B case) | `I129_H_1B_DATA_COLLECTION_AND` | 3 (21-23) | 3 | — |
| I129_L (L-1A case) | `I129_L_CLASSIFICATION_SUPPLEM` | 4 (24-27) | — | 4 |

Both engines verified independently against real, live CaseForms (not mocks) — including the Adobe path, which is the actual default production download engine (`ADOBE_PDF_FILL_ENABLED !== "false"`), hit with a real external API call.

### Tests

**New: `Backend/src/modules/form-generation/tests/ComponentPageResolver.test.js`** (9/9 pass, `node --test`):
- Test A: single range expands correctly (13-20 → 8 pages).
- Test B/B2/B3: multiple ranges, out-of-order input, overlapping ranges — all dedupe/sort correctly, order preserved.
- Test C/C2/C3/C4: empty ranges, `end < start`, out-of-bounds range, non-integer/zero page — all throw `COMPONENT_PAGE_RESOLUTION_FAILED`, never silently pass.
- `componentPageError` carries structured debug details.

**Live integration verification** (ad hoc scripts, run against the real database and real stored I-129 PDF, deleted after use per this session's established discipline):
- Independent-form regression: I-129 core still renders 38 pages through both `PDFRenderer.renderFiling` and `AdobeFormRenderer.renderFiling`.
- Component slicing: H (8 pages) and L (4 pages) components verified correct through both engines.
- Controlled-error path: a CaseForm with a `componentCode` pointing at a definition that doesn't exist throws `COMPONENT_PAGE_RESOLUTION_FAILED` from `PDFRenderer.render` rather than rendering anything.

**Existing suite regression**: `node --test "src/modules/form-generation/tests/*.test.js"` — 35/40 pass. The 5 failures are in `h3-pdf-render.test.js`, all originating from `PDFRenderer.loadTemplateBuffer` (`"No stored PDF artifact is registered..."`) — i.e. they fail before any of this session's code ever runs. **Confirmed pre-existing**: re-ran the same file with this session's changes fully stashed out (`git stash` / re-test / `git stash pop`) and it failed identically (worse in isolation, in fact — 4/4 fail standalone vs. partial pass inside the full suite, a pre-existing test-isolation/fixture-seeding issue, not a page-slicing one).

### PDF Verification

Real generated PDFs were loaded back with `pdf-lib` and their actual `getPageCount()` inspected (not asserted from JSON/logs) for every row in the table above. Field-fill fidelity was independently confirmed via `PDFFidelityService.verify` running against the real sliced bytes (not skipped, not weakened) for both the pdf-lib and Adobe engines — passing after the page-count-bounds bug was found and fixed.

### Files Changed

- `Backend/src/modules/form-generation/services/ComponentPageResolver.js` (new)
- `Backend/src/modules/form-generation/services/PDFRenderer.js` (slicing wired into `render()`)
- `Backend/src/modules/form-generation/services/AdobeFormRenderer.js` (slicing wired into `renderFiling()`, the default download path)
- `Backend/src/modules/form-generation/services/PDFFidelityService.js` (component-aware expected page count)
- `Backend/src/modules/form-generation/tests/ComponentPageResolver.test.js` (new)

### Remaining Issues (explicitly out of Phase 1 scope)

- **Orphaned AcroForm field definitions**: slicing removes pages but not the now-inert field definitions whose only widget lived on a removed page (confirmed: a sliced 8-page component PDF still reports ~942 AcroForm fields internally, same as the full document). Invisible/inert, not a correctness defect for page content or values, but not a fully "clean" document either — pruning would require deeper, riskier pdf-lib field-tree surgery, deliberately not attempted here.
- **`sampleFieldNames` in `PDFFidelityService`** still samples from the full `template.formFields` list rather than the component's own `fieldIds` — harmless (produces `warnings`, not `errors`, for fields it can't find on the sliced pages), left unchanged rather than expanding scope.
- **SUPPLEMENT architecture, registry-wide regression beyond I-129/L-1A, broader mapping changes** — explicitly Phase 3, not touched here.
- The 5 pre-existing `h3-pdf-render.test.js` failures (missing stored PDF test fixtures / qpdf-related) are unrelated to this phase and were not fixed, per the explicit "do not implement unrelated fixes" scope boundary.

---

## Phase 2 — Registry-wide FORM_COMPONENT integration + core/component page boundary

### 1. Registry Inventory

Queried the live registry directly (not documentation):

- **`USCISFormComponentDefinition`**: 10 documents existed before this phase. 8 are real, `ACTIVE`, correctly structured `FORM_COMPONENT` definitions — all under I-129 (`I129_H_CLASSIFICATION_SUPPLEM`, `I129_H_1B_DATA_COLLECTION_AND`, `I129_L_CLASSIFICATION_SUPPLEM`, `I129_O_P_CLASSIFICATION_SUPPL`, `I129_Q_CLASSIFICATION_SUPPLEM`, `I129_R_CLASSIFICATION_SUPPLEM`, `I129_TRADE_AGREEMENT_SUPPLEME`, `I129_E_1_E_2_CLASSIFICATION_S`), all sharing one `parentTemplateId` (I-129's current active template, version `2026-02-27`), zero page-range overlaps, zero duplicate `componentCode`s. The other 2 (`I130_SUPPLEMENTAL_INFORMATION`, `I539_SUPPLEMENTAL_INFORMATION`) were `REVIEW_REQUIRED` stubs with 0 fields and a placeholder `[{1,1}]` page range, referenced by **zero** `VisaFormMapping` rows — confirmed orphaned (see Issues).
- **`VisaFormMapping`**: 53 active rows with `componentType` in `{SUPPLEMENT, FORM_COMPONENT}`. Of these, 8 distinct `formName`s are genuine `FORM_COMPONENT` rows (I-129's classification supplements, spanning 24 visa-type rows total). The rest are `SUPPLEMENT` rows for I-539A, I-130A, I-864A (Type A — separate real standalone templates, correctly using `formTemplateFormCode`, not `componentCode` — out of Phase 2 scope per §14), and I-918's two supplements (still unresolved from an earlier phase, also Type A/Phase 3 territory).
- I-130 and I-539 each have exactly one `SUPPLEMENT`-type component definition, both `REVIEW_REQUIRED` (never activated) — neither parent form is affected by the Phase 2 core-boundary change (see §4).

### 2. Issues Found

1. **Two orphaned, invalid component-definition stubs** (`I130_SUPPLEMENTAL_INFORMATION`, `I539_SUPPLEMENTAL_INFORMATION`) — leftover artifacts from an earlier discovery run's generic "Supplemental Information" heading match inside I-130/I-539's own PDFs, never `ACTIVE`, never referenced by any mapping row, but registry clutter that could confuse a future audit or re-discovery run.
2. **The real, significant defect**: `USCISFormTemplate` (I-129)'s own `visaTypes` field was `["H-1B","L-1A","L-1B"]` — set once by the original seed script and never updated as the registry grew. `templateAppliesToCase()` (`uscis-form.service.js:330`) falls back to `template.visaTypes` whenever `assignmentRules.visaTypes` is empty (it is, for I-129), so **every other visa type the registry maps to I-129 or one of its 8 components — O-1A, O-1B, O-2, P-1/1S/2/2S/3/3S, Q-1, R-1, E-1, E-2, E-3, H-2A, H-2B, H-3, H-1B1 Chile, H-1B1 Singapore, TN Canada, TN Mexico (24 visa types total, 21 of them never provisionable before this fix) — silently resolved to `TEMPLATE_RULE_CONFLICT` and could never be provisioned**, whether via auto-create or a case manager's manual "Add" action (both paths gate through the same function). Confirmed live: a real O-1A case in the database had zero I-129/O-P CaseForms and `resolveApplicableMappings` reported `TEMPLATE_RULE_CONFLICT` for both rows.
3. **The core/independent-form page boundary** (explicit add-on): before this phase, `componentCode = null` meant "render every page of the parent PDF" unconditionally — so the I-129 core CaseForm rendered/downloaded all 38 pages, including the 8 components' own pages (9-36), even though those pages are separately addressable as their own CaseForms. Confirmed via real PDF text extraction: pages 1-8 are the actual I-129 core form (ending in "Part 9. Additional Information About Your Petition"), pages 9-36 are exactly the union of the 8 active components' ranges, and pages 37-38 are a generic "Attachment-1" sheet (for listing additional beneficiaries) that belongs to neither the core Parts 1-8 nor any specific classification — genuinely shared, core-level content, not a 9th component.

### 3. Fixes

1. **Registry cleanup**: deleted the 2 orphaned/invalid component-definition stubs (`USCISFormComponentDefinition.deleteMany({componentCode: {$in: [...]}})`, printed before/after per the safe-write protocol). 8 real `ACTIVE` definitions remain.
2. **`template.visaTypes` corrected** to the real, complete, registry-derived set: queried every active `AUTO_CREATE`/`CONDITIONAL` `VisaFormMapping` row whose `formTemplateFormCode` is `i-129` or whose `parentForm` is `I-129`, unioned the 24 resulting visa types with the existing 3, and saved (printed before/after; `uscisFormService.invalidateTemplateCache()` called afterward so the fix took effect without a restart). This is a targeted, registry-provable data correction, not a guess — every added visa type has a real, active mapping row justifying it.
3. **Core/component page boundary** (new in `ComponentPageResolver.js`): added `resolveCorePages(template, totalPages)` — queries every `ACTIVE` component definition sharing the template's `_id`, unions their resolved pages, and returns every remaining page (or `null` if the template has zero active components, preserving the exact original full-document behavior for every other independent form). Added `resolvePagesToKeep(caseForm, template, totalPages)` as the single dispatch point (component → its own range; core → the computed complement) and rewired `PDFRenderer.render` and `AdobeFormRenderer.renderFiling` to call it instead of the component-only `resolveComponentPages`. `PDFFidelityService.verify`'s expected-page-count logic was extended the same way, bounds-checked against the parent's original page count (not the already-sliced buffer's count) for both branches.

### 4. Component Flow

```
Visa Type (e.g. O-1A)
      ↓
VisaFormMapping (registry: parentForm/formTemplateFormCode = I-129, componentCode = I129_O_P_...)
      ↓
resolveApplicableMappings → templateAppliesToCase(I-129 template, case)
      ↓  (now TRUE for all 24 registry-mapped visa types, was only 3 before the visaTypes fix)
ensureAssignedForms → CaseForm.create({formCode: "I129_O_P_...", componentCode: "I129_O_P_...", parentFormCode: "I-129", parentCaseFormId: <core CaseForm._id>})
      ↓
PDFRenderer.render / AdobeFormRenderer.renderFiling
      ↓
ComponentPageResolver.resolvePagesToKeep(caseForm, template, totalPages)
      ↓  componentCode set → resolveComponentPages (component's own pageRanges)
      ↓  componentCode null → resolveCorePages (every page NOT claimed by an active sibling component)
      ↓
keepOnlyPages(pdf, pagesToKeep)
      ↓
sliced PDF (component: only its pages; core: only its own pages, minus every component's)
```

### 5. Verification (real data, real PDFs)

| CaseForm | componentCode | Resolved pages | Actual rendered page count |
|---|---|---|---|
| I-129 core (H-1B case) | `null` | 1-8, 37-38 (10 pages) | **10** (was 38 before this phase) |
| I129_H (H-1B case) | `I129_H_CLASSIFICATION_SUPPLEM` | 13-20 | 8 |
| I129_H_1B_DATA (H-1B case) | `I129_H_1B_DATA_COLLECTION_AND` | 21-23 | 3 |
| I129_L (L-1A case) | `I129_L_CLASSIFICATION_SUPPLEM` | 24-27 | 4 |
| I129_O_P (real, live O-1A case, provisioned end-to-end by this phase's fix) | `I129_O_P_CLASSIFICATION_SUPPL` | 28-30 | 3 |
| I129_Q (synthetic CaseForm, no live Q-1 case exists) | `I129_Q_CLASSIFICATION_SUPPLEM` | 31-31 | 1 |
| I129_R (synthetic, no live R-1 case) | `I129_R_CLASSIFICATION_SUPPLEM` | 32-36 | 5 |
| I129_TRADE_AGREEMENT (E-3, synthetic, no live case) | `I129_TRADE_AGREEMENT_SUPPLEME` | 11-12 | 2 |
| I129_E_1_E_2 (E-1/E-2, synthetic, no live case) | `I129_E_1_E_2_CLASSIFICATION_S` | 9-10 | 2 |
| I-140 (independent, zero registered components) | `null` | unaffected | 8 (its real full page count, unchanged) |

Every row's *actual* page count was read back from a real generated PDF via `pdf-lib`'s `getPageCount()`, not asserted from logs/JSON. Q/R/Trade Agreement/E-1-E-2 had no live case to provision through (no Q-1/R-1/E-1/E-2/E-3 case exists in this database) — rendered directly via `PDFRenderer.render` with the real, live `USCISFormComponentDefinition` metadata and an empty `filledData`, which exercises the exact same `ComponentPageResolver` code path a real CaseForm would; disclosed honestly rather than left untested or faked as "provisioned."

### 6. Tests

- `node --test src/modules/form-generation/tests/ComponentPageResolver.test.js` — 9/9 pass (unchanged from Phase 1).
- `node --test src/modules/form-generation/tests/ComponentRegistryAudit.test.js` (new, §20's registry-wide validation gate) — 2/2 pass: every `ACTIVE` component definition has a resolvable parent template matching its own `templateVersion`, valid non-overlapping page ranges, and every `fieldIds` entry resolves to a real template field whose own `pageNumber` falls inside that component's pages. This test derives its input from the live registry, not a hardcoded list — it will fail against any future component added with broken metadata.
- Live integration (ad hoc scripts, run against real data, deleted after use): core-boundary math verified against real extracted PDF text (page 8 = core's own closing section, page 9 = first component heading, pages 37-38 = generic shared attachment sheet); all 8 components + core re-verified after the `visaTypes` fix; H-1B and L-1A re-checked for zero cross-contamination after the fix (still exactly their own forms, nothing extra); real O-1A provisioning end-to-end (zero CaseForms → I-129 core + O/P component, `componentCode`/`parentFormCode`/`parentCaseFormId` all correct) plus idempotency (second run: no duplicates).

### 7. Regression

Phase 1's guarantees re-verified intact: no component falls back to the full parent PDF; invalid/missing component metadata still throws `COMPONENT_PAGE_RESOLUTION_FAILED` rather than rendering anything; both PDF engines (`PDFRenderer`, `AdobeFormRenderer`) still slice consistently; independent forms with zero registered components (I-140) are byte-for-byte unaffected. The one **intentional, explicit** behavior change from Phase 1 is the I-129 core's own page count (38 → 10) — required by this phase's add-on, not a regression; Phase 1's report table describing "I-129 core stays full 38 pages" is now superseded by this phase's own boundary logic and should be read as historical.

### 8. Remaining Issues (explicitly out of Phase 2 scope)

- **Q-1, R-1, E-1/E-2, E-3 have no live CaseForm/case to provision end-to-end** — verified via direct render against real component metadata (see §5), not via full live provisioning, since no such case exists in this database today. The provisioning code path itself is identical to the one just verified for O-1A (fully generic, no per-visa branching), so this is a data-availability gap, not a known defect.
- **I-918's two supplements remain unresolved** (no `formTemplateFormCode`, no active template acquired) — a pre-existing gap from an earlier phase, `SUPPLEMENT`-type (Type A), explicitly Phase 3 territory.
- **Orphaned AcroForm field definitions** (fields whose widget lived on a removed page but whose definition remains in the sliced PDF's AcroForm) — same known, disclosed Phase 1 limitation, now also true of the core form's own sliced output; not re-attempted here.

---

## Phase 3 — SUPPLEMENT architecture, I-918 resolution, registry-wide visaTypes drift audit

### 1. Supplement Inventory

Queried every active `VisaFormMapping` row with `componentType: "SUPPLEMENT"` (30 rows, 5 distinct supplement forms) and classified each by resolving its `formTemplateFormCode` against `USCISFormTemplate`:

| Supplement | Parent | `formTemplateFormCode` | Template status (before Phase 3) | Classification |
|---|---|---|---|---|
| I-539A | I-539 | `i-539a` | `active` | VALID STANDALONE SUPPLEMENT — fully working |
| I-130A | I-130 | `i-130a` | `review` (biographic_active) | VALID STANDALONE SUPPLEMENT — acquired, pending human mapping review (pre-existing, disclosed) |
| I-864A | I-864 | `i-864a` | `review` (biographic_active) | VALID STANDALONE SUPPLEMENT — same as I-130A |
| I-918 Supplement A | I-918 | `null` | none | UNRESOLVED — the primary Phase 3 target |
| I-918 Supplement B | I-918 | `null` | none | UNRESOLVED — same |

None of the 5 supplement forms are, or were ever, `USCISFormComponentDefinition` entries — confirmed by querying the live `USCISFormComponentDefinition` collection: all 8 documents that exist are I-129's own `FORM_COMPONENT`s, none reference I-539/I-130/I-864/I-918. The architecture is already correctly separated; this phase's job was closing the one real supplement gap (I-918) and auditing a structural risk Phase 2 flagged (§18-19 below), not correcting any component/supplement confusion.

### 2. I-918 Resolution

The registry's own names for both rows are real, correct USCIS form names — no guessing needed: "I-918 Supplement A" = *Petition for Qualifying Family Member of U-1 Recipient* (`U derivative`, `CONDITIONAL`), "I-918 Supplement B" = *U Nonimmigrant Status Certification* (`U-1`, `AUTO_CREATE`).

The earlier (Phase 1) acquisition attempt guessed form codes `I-918A`/`I-918B` and failed — fetched the wrong PDF from a URL search and hit `NORMALIZED_SCAN_EMPTY_FIELDS`. Investigated the real, live `uscis.gov/i-918` page directly this phase and found USCIS's actual naming convention differs from a simple letter suffix: the real files are `i-918supa.pdf` and `i-918supb.pdf`, listed as secondary downloads on I-918's own page (same pattern as I-130A/I-864A, not a page of their own).

Imported both directly via `USCISFormImporterService.importFromUrl()` — the same underlying pipeline `OnDemandFormAcquisitionService` uses, given the now-confirmed real URLs (a one-time acquisition action using real, non-guessed data, not new hardcoded production logic — identical in kind to every existing form-seed script):

| Form | Real field count | Landed status |
|---|---|---|
| I-918 Supplement A | 368 | `review` / `mappingStatus: biographic_active` |
| I-918 Supplement B | 138 | `review` / `mappingStatus: biographic_active` |

Both landed at the same deliberate human-mapping-review tier as every other newly-acquired form this session (Constraint #3 — not bypassed). Wired both `VisaFormMapping` rows' `formTemplateFormCode` to `i-918supa`/`i-918supb` (safe-write, printed before/after). Verified live: `resolveApplicableMappings({visaType: "U-1", ...})` now correctly returns I-918 Supplement B with `formTemplateFormCode: "i-918supb"` set.

### 3. Architecture

```
INDEPENDENT FORM (e.g. I-140, I-485, I-539A, I-918)
      componentCode = null, no active FORM_COMPONENT definitions for its template
      → resolveCorePages returns null → full, complete own PDF, unsliced

FORM_COMPONENT (e.g. I-129 H/L/O-P/Q/R/E-1E2/E3)
      componentCode set → USCISFormComponentDefinition (parentTemplateId + componentCode)
      → pageRanges → ComponentPageResolver → sliced PARENT PDF, component's pages only

SUPPLEMENT (e.g. I-539A, I-130A, I-864A, I-918 Supplement A/B)
      componentType: "SUPPLEMENT", componentCode = null, formTemplateFormCode set
      → resolves its OWN, separate USCISFormTemplate (own real official PDF)
      → goes through the exact same "independent form" path as I-140/I-485 —
        never touches ComponentPageResolver, never slices, never reads the
        parent form's PDF at all
```

A `SUPPLEMENT` and an ordinary `INDEPENDENT FORM` are architecturally identical from the renderer's point of view — both have `componentCode = null` and their own `USCISFormTemplate`. The only thing that makes something a "supplement" is the `VisaFormMapping.componentType` label and its `parentForm` reference, which are business/registry metadata, not rendering-path metadata. No separate supplement-rendering code exists or was created — confirmed by a final grep sweep: zero `if (componentType === "SUPPLEMENT")` or hardcoded supplement-list branches anywhere in `form-generation/`.

### 4. Registry Hardening — visaTypes Drift Audit

Built a registry-wide audit (ad hoc script, not a permanent file — the underlying pattern is simple enough not to warrant a new test given it's a one-time data hardening pass, unlike Phase 2's `ComponentRegistryAudit.test.js` which guards an architecture invariant): for every template referenced by an active `AUTO_CREATE`/`CONDITIONAL` mapping row where `assignmentRules.visaTypes` is empty (meaning `templateAppliesToCase` falls back to `template.visaTypes`), compared the registry's real required visa-type set against what the template actually had.

**7 templates had real drift, beyond I-129 (fixed in Phase 2):**

| Template | Before | After | Note |
|---|---|---|---|
| I-129F | 1 visa type | 2 | missing `K-3` |
| I-130 | 2 | 14 | missing all 12 family-based categories (IR/CR/F-series) |
| I-485 | 16 | 28 | missing all IR/CR/F-series adjustment categories |
| **I-539** | **0** | **31** | **template.visaTypes was completely empty — I-539 could never be provisioned or manually added for ANY visa before this fix** |
| **I-907** | **0** | **31** | **same — completely empty, Premium Processing was unreachable for every visa** |
| I-539A | 0 | 2 | empty — H-4/L-2 dependents could never get I-539A |
| I-693 | 11 | 24 | missing all IR/CR/F-series categories |

Each correction was derived directly from the live, already-active `VisaFormMapping` rows for that template (the registry's own, already-established intent — the same justification used for I-129 in Phase 2, not a guess), printed before/after per the safe-write protocol, followed by `uscisFormService.invalidateTemplateCache()`.

The I-539/I-907 findings are the most significant: both had a completely empty `visaTypes` array, meaning `templateAppliesToCase` returned `false` unconditionally for every case, for any visa — these two real, active, already-imported USCIS forms were silently unreachable through the entire provisioning system before this phase, independent of anything to do with supplements or components.

### 5. Provisioning

- Re-verified I-129/O-1A end-to-end provisioning (from Phase 2) still correct after this phase's changes.
- Verified `resolveApplicableMappings({visaType: "H-4", processingPath: "CHANGE_OF_STATUS"})` now finds the I-539 mapping (previously impossible — `template.visaTypes` was empty); `templateAppliesToCase(I-539 template, {visaType: "H-4"})` confirmed `true` directly.
- I-918 Supplement B now resolves with its correct `formTemplateFormCode` for a U-1 case.
- Full production activation for I-130A/I-864A/I-918 Supplement A/B remains gated behind human field-mapping review (same disclosed limitation as every form acquired this way) — the registry/template plumbing is correct and provable; actually creating a CaseForm for these specific forms still requires that human step, which is intentionally outside any phase's scope to bypass.

### 6. PDF Verification

| Form | Engine | Page count | Result |
|---|---|---|---|
| I-539A (standalone supplement) | pdf-lib | matches its own `pdfMetadata.pageCount` (5) exactly, not I-539's | PASS — confirmed never routed through `ComponentPageResolver` |
| I-129 core | pdf-lib | 10 (1-8, 37-38) | PASS — Phase 2 boundary intact after registry changes |
| I-140 (independent) | pdf-lib | full, unchanged | PASS |

**New, unrelated pre-existing defect discovered while testing I-485**: `PDFRenderer.render` throws `"Reading rich text fields is not supported: ... P14_Line5_AdditionalInfo"` for I-485 — a real limitation of pdf-lib against I-485's actual template (a rich-text AcroForm field type). Confirmed pre-existing via the same `git stash`/retest/`git stash pop` discipline used in Phase 1: fails identically with every Phase 1-3 change stashed out. Unrelated to supplement/component/visaTypes architecture — flagged, not fixed, per this phase's scope boundary.

### 7. Regression

- Phase 1's `ComponentPageResolver.test.js` — 9/9 pass, unchanged.
- Phase 2's `ComponentRegistryAudit.test.js` — 2/2 pass, unchanged (re-run after all registry writes in this phase).
- I-129 core (10 pages) and I-140 (full, unaffected) re-verified live after the 7-template `visaTypes` correction.
- No new `FORM_COMPONENT`/`ComponentPageResolver` code was touched this phase at all — every change was either a registry data correction (`formTemplateFormCode`, `visaTypes`) or a new standalone-template acquisition, both flowing through pre-existing, unmodified code paths.

### 8. Tests

- `node --test src/modules/form-generation/tests/ComponentPageResolver.test.js src/modules/form-generation/tests/ComponentRegistryAudit.test.js` → 11/11 pass.
- Live integration (ad hoc scripts, run against real data, deleted after use): I-918 Supplement A/B acquisition and registry wiring; I-539A standalone-path confirmation; registry-wide `visaTypes` drift computation and correction across 7 templates; `resolveApplicableMappings` re-checks for U-1/H-4; I-129 core + I-140 regression.

### 9. Remaining Issues (explicitly outside Phase 3 scope)

- **I-130A, I-864A, I-918 Supplement A/B are not yet production-`active`** — genuinely acquired, correctly wired in the registry, but pending human-curated field-mapping review before a real CaseForm can be created against them. This is the same disclosed, deliberate architectural gate every newly-acquired form in this project hits (Constraint #3) — real, substantial per-form work, not something any phase should fabricate.
- **I-485's rich-text-field pdf-lib limitation** — a genuine, pre-existing defect, confirmed unrelated to this or any prior phase's work, affecting any render of I-485 regardless of supplement/component status. Not fixed here.
- **`template.visaTypes` drift audit was scoped to templates referenced by `AUTO_CREATE`/`CONDITIONAL` mappings whose `assignmentRules.visaTypes` is empty** (the actual failure mode `templateAppliesToCase` exhibits) — a template that sets `assignmentRules.visaTypes` directly was correctly skipped as not-at-risk; this is the complete, real risk surface, not a partial sweep.
- **`SUPPLEMENT` rows still resolve applicability the same way `STANDALONE_FORM` rows do** (via `resolveTemplateStatus`/`templateAppliesToCase`) — this phase found and fixed data (visaTypes), not a code-path distinction, since none was needed: the existing generic path already treats a supplement exactly like an independent form, correctly.
- **`template.visaTypes` drift is a structural risk beyond I-129**: the same failure mode (a template's own `visaTypes` field silently falling behind the registry as new mappings are added) could exist for other templates with components/conditionals. Not audited registry-wide in this phase since it was discovered and fixed reactively for I-129 specifically, provably from real data; a proactive sweep across every template would be reasonable future hardening but was not requested.

---

## Phase 4 — Production readiness + durability hardening

This phase's job was closing remaining production gaps and making Phase 2/3's live database corrections **durable** — proven to survive a fresh environment, not just true of the current, manually-corrected database.

**Overall status: CODE COMPLETE + REGISTRY COMPLETE + DURABLE.** Four specific templates remain genuinely blocked on human field-mapping review — a real, disclosed, external dependency, not bypassed.

### 1. Architecture (unchanged, reconfirmed)

```
INDEPENDENT FORM              FORM_COMPONENT                 SUPPLEMENT
componentCode = null          componentCode set              componentType: SUPPLEMENT
no active components          → USCISFormComponentDefinition  componentCode = null
for its own template          → pageRanges                    → own formTemplateFormCode
→ own template,                → ComponentPageResolver         → own USCISFormTemplate
  complete PDF                 → sliced PARENT PDF, own        → complete own PDF, never
                                  pages only                     the parent's
```

A `SUPPLEMENT` and an `INDEPENDENT FORM` are architecturally identical from the renderer's point of view — confirmed by a new `RegistryClassificationGuard.test.js`, which asserts no active `SUPPLEMENT`/`STANDALONE_FORM` row ever carries a `componentCode`, and no `FORM_COMPONENT` row ever resolves via its own `formTemplateFormCode`.

### 2. Production-Ready Forms (verified live, real PDFs, both engines where applicable)

| Form | Class | Pages | Engine(s) verified |
|---|---|---|---|
| I-129 core | Independent-with-components | 10 (1-8, 37-38) | pdf-lib + Adobe |
| I-129 H/H-1B-Data/L/O-P/Q/R/E-1E2/Trade Agreement | FORM_COMPONENT | own registered ranges | pdf-lib + Adobe |
| I-140 | Independent | full, own page count | pdf-lib |
| I-539A | SUPPLEMENT (standalone) | 5 (own, never I-539's) | pdf-lib |
| **I-485** | Independent | 24 (full) | **pdf-lib + Adobe — newly fixed this phase** |
| I-539, I-907 | Independent | resolvable for their full registry-mapped visa sets (previously 0) | mapping-resolution verified live |

### 3. Pending Human Review

| Template | Status | `mappingStatus` | Mapped fields | Why |
|---|---|---|---|---|
| I-130A | `review` | `biographic_active` | 0 / 194 | No curated field-mapping graph exists yet |
| I-864A | `review` | `biographic_active` | 0 / 162 | Same |
| I-918 Supplement A | `draft` | `biographic_active` | 0 / 368 | Same (newly acquired this phase) |
| I-918 Supplement B | `draft` | `biographic_active` | 0 / 138 | Same |

`VersionManagementService.activate()` requires `mappingStatus === "active"`, which `MappingGraphService.activate()` only grants once *every* template field has an approved Master Case Data mapping edge (`validateGraph(...).readyForActivation`). All four templates currently have **zero** mapped edges — confirmed by direct query, not inferred. This is genuine, substantial, per-form human/legal mapping-curation work (up to 368 individual field decisions for I-918 Supplement A alone). **No field mappings, source attribution, or semantics were fabricated to force activation** — all four remain honestly `review`/`draft`, not silently treated as active.

### 4. Registry Hardening

**I-918 Supplement A/B — templates acquired this phase.** The earlier guessed form codes (`I-918A`/`I-918B`) had failed. Fetched `uscis.gov/i-918` directly and read its actual PDF links, finding USCIS's real file names (`i-918supa.pdf`, `i-918supb.pdf`), then imported both via the standard `USCISFormImporterService.importFromUrl()` pipeline: 368 fields (Supplement A), 138 fields (Supplement B), both landing at `mappingStatus: "biographic_active"` — the same tier every newly-acquired form in this project reaches, never bypassed.

**The critical durability fix.** Every Phase 2/3 `visaTypes` correction was, until this phase, a **live-database-only fix**. Inspecting the authoritative seed scripts (`Backend/src/modules/uscis-form-import/seeds/*.seed.js`) revealed the exact reason the bugs existed in the first place: **every one hardcoded a static `visaTypes` array in source**, e.g. `i129.seed.js`: `["H-1B", "L-1A", "L-1B"]`. Two seeds — `i539.seed.js` and `i907.seed.js` — had **no `visaTypes` assignment at all**, the literal root cause of those two templates having an empty `visaTypes` array in production. **A fresh environment or database rebuild would have silently reintroduced every one of these bugs.**

Fixed by adding `Backend/src/modules/uscis-form-import/seeds/deriveVisaTypesFromRegistry.js` — a shared helper that computes a form's real `visaTypes` set live from `VisaFormMapping` — and wiring it into all 9 affected seed scripts (`i129`, `i129f`, `i130`, `i140`, `i485`, `i539`, `i539a`, `i693`, `i907`), unioned with each script's existing hardcoded floor for backward safety. **Verified live**: re-ran `i539.seed.js` and `i907.seed.js` against the real database — both correctly re-derived their full 31-visa-type sets from the registry, proving a fresh environment now reproduces Phase 2/3's fixes automatically.

**Permanent automated drift guard.** New `Backend/src/modules/form-registry/tests/TemplateVisaTypeDrift.test.js` — registry-driven (never a hardcoded form/visa list), calls the **real, unmodified** `templateAppliesToCase`/`hasAssignmentScope` production functions (not a simplified reimplementation), and fails with a structured `TEMPLATE_VISA_MAPPING_DRIFT` report if this class of bug ever recurs. Passes live against the current, fully-corrected registry.

**Registry classification guard.** New `Backend/src/modules/form-registry/tests/RegistryClassificationGuard.test.js` extends Phase 2's `FORM_COMPONENT`-only audit to `SUPPLEMENT` and `STANDALONE_FORM`. 3/3 pass.

### 5. Fresh Environment Verification

Directly answers the phase's core question — "if the database were created fresh tomorrow, would these fixes still exist?" — **yes**, now: ran `i539.seed.js`/`i907.seed.js`/`i129.seed.js` live against the real database after the fix; all three correctly recomputed their full, registry-correct `visaTypes` sets, and `i129.seed.js`'s re-run confirmed idempotency (no duplicate). The remaining 6 fixed seeds use the identical helper and pattern; syntax-verified and structurally identical, not each individually re-run live.

### 6. PDF Verification

| Form | Engine | Result |
|---|---|---|
| I-485 | pdf-lib | 24 pages, guard disabled 4 real rich-text fields (`P14_Line2-5_AdditionalInfo`) |
| I-485 | Adobe (default production engine) | 24 pages, succeeded |
| I-129 core | pdf-lib, `flatten: true` | 10 pages — regression-confirmed unaffected by the rich-text guard |

### 7. I-485 — Root Cause, Fix, and Classification (supersedes Phase 3's "flagged, not fixed" entry)

**Not a fallback/test-only limitation — a genuine production defect**, confirmed by testing **both** real engines: `AdobeFormRenderer.renderFiling` also crashed identically, because it performs its own local pdf-lib `save()` on the source PDF *before* uploading to Adobe — that local save, not Adobe's API, is where the crash actually originates.

**Root cause**: pdf-lib's own `form.updateFieldAppearances()` (run internally by both `save()` and `flatten()`) throws `RichTextFieldReadError` for any AcroForm text field flagged "rich text" that currently has no plain-text value. I-485's real template has (at least) 4 such fields.

**Fix**: new `Backend/src/modules/form-generation/services/RichTextFieldGuard.js`, using pdf-lib's own **official, public API** (`PDFTextField.isRichFormatted()` / `.disableRichFormatting()`, not a workaround). Clears the flag only on fields that are both rich-text-flagged **and** currently empty; a rich-text field holding a value is left untouched. Fully generic — confirmed by grep, no `if (formCode === "I-485")` branch exists anywhere. Wired into both engines at every independent save/flatten point: `PDFRenderer.render` and `AdobeFormRenderer.renderFiling` (both the pre-upload save and a defensive second pass on Adobe's returned bytes).

New regression suite `RichTextFieldGuard.test.js` (3/3 pass) constructs a real rich-text AcroForm field via pdf-lib's own `enableRichFormatting()` API and verifies the guard's exact scoping.

### 8. Regression

Full combined suite across every phase's permanent tests, run together against live data:

```
node --test src/modules/form-generation/tests/ComponentPageResolver.test.js \
             src/modules/form-generation/tests/ComponentRegistryAudit.test.js \
             src/modules/form-generation/tests/RichTextFieldGuard.test.js \
             src/modules/form-registry/tests/TemplateVisaTypeDrift.test.js \
             src/modules/form-registry/tests/RegistryClassificationGuard.test.js
```
**18/18 pass.** I-129's full component family (core + H + H-1B-Data + L + O-P + Q + R + E-1E2 + Trade Agreement) and I-140/I-539A were independently re-verified live via direct render calls after every registry write this phase, with zero regressions.

### 9. Files Changed

**New:**
- `Backend/src/modules/form-generation/services/RichTextFieldGuard.js`
- `Backend/src/modules/form-generation/tests/RichTextFieldGuard.test.js`
- `Backend/src/modules/form-registry/tests/TemplateVisaTypeDrift.test.js`
- `Backend/src/modules/form-registry/tests/RegistryClassificationGuard.test.js`
- `Backend/src/modules/uscis-form-import/seeds/deriveVisaTypesFromRegistry.js`

**Modified:**
- `Backend/src/modules/form-generation/services/PDFRenderer.js` — rich-text guard wired into `render()`
- `Backend/src/modules/form-generation/services/AdobeFormRenderer.js` — rich-text guard wired into `renderFiling()`
- `Backend/src/modules/uscis-form-import/seeds/{i129,i129f,i130,i140,i485,i539,i539a,i693,i907}.seed.js` — registry-derived `visaTypes`

**Database (data, not code — now also durable via the seed fix above):**
- I-918 Supplement A/B: 2 new `USCISFormTemplate` documents imported
- `VisaFormMapping`: I-918 Supplement A/B rows' `formTemplateFormCode` set

### 10. Remaining External Dependencies (explicitly outside Phase 4 scope)

- **I-130A, I-864A, I-918 Supplement A, I-918 Supplement B require human-curated field-mapping review** before `VersionManagementService.activate()` will allow production activation — 0/194, 0/162, 0/368, 0/138 fields currently mapped respectively. Real, substantial work that no phase of this project should or does fabricate. The registry/template/acquisition layer for all four is complete and correct; only the human mapping-curation step remains.
- **Q-1, R-1, E-1/E-2, E-3 have no live case in this database** to provision end-to-end through — unchanged since Phase 2; rendering path re-verified this phase via direct render against real component metadata, not full live provisioning.
- **Orphaned AcroForm field definitions** on sliced component PDFs — unchanged, not revisited, per the explicit "do not perform risky field-tree surgery for cosmetic cleanup" instruction.
