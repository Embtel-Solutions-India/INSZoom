# VisaFormMapping Architecture Audit

Audit of the `VisaFormMapping` registry (Backend), the "USCIS Forms" surfaces that consume it, and the visa-type/checklist configuration around it — produced alongside the architecture correction described below. All data is queried live against the dev database (415 `VisaFormMapping` documents, post-migration) unless marked otherwise.

## Summary of the correction

`VisaFormMapping` already carried most of the metadata this correction needed (`agency`, `componentType`, `parentForm`, `provisioningType`, `processingPaths`) — the actual defects were (1) I-129's embedded classification supplements were tagged `componentType: SUPPLEMENT` (indistinguishable from a genuinely separate, dependent form), (2) nothing consuming the registry filtered by `componentType`/`agency` at all, so the Case Manager's "USCIS Forms" list showed supplements, dependents, and DOS/DOL/SEVP documents as if they were independently filed USCIS forms, and (3) resolution was an exact string match on `case.visaType` with no parent-visa fallback, so several subclassifications (confirmed: P-1A, P-1B) resolved to nothing at all. Fixed by: re-tagging the 23 mis-tagged records to a new `FORM_COMPONENT` componentType, adding a single `isIndependentUSCISForm` predicate used everywhere "USCIS Forms" is rendered/provisioned, and adding a canonical visa hierarchy + shared fallback walker reused by both form-mapping and checklist resolution.

---

## 1. Independent USCIS forms (`agency: USCIS`, `componentType: STANDALONE_FORM`, no `parentForm`)

265 records. Representative set: I-129, I-129F, I-129S, I-130, I-140, I-360, I-485, I-526, I-526E, I-539, I-612, I-693, I-751, I-765, I-824, I-829, I-90, I-907, I-918, I-956F, N-400, N-565, N-600, G-28 — matching the user's own worked list exactly, plus several confirmed already active in the registry (I-131, I-864, I-864EZ). These are the **only** records eligible for `isIndependentUSCISForm()` and the only ones the Case Manager/Team Lead/Admin "USCIS Forms" list may ever show.

## 2. Embedded USCIS supplements (`componentType: FORM_COMPONENT`) — corrected this pass

7 records, all `provisioningType: NOT_APPLICABLE` (never independently provisionable), all `parentForm: "I-129"`:

| Form number | Visa types |
|---|---|
| I-129 H Classification Supplement | H-1B, H-2A, H-2B, H-3 |
| I-129 O/P Classification Supplement | O-1A, O-1B, O-2, P-1, P-1S, P-2, P-2S, P-3, P-3S |
| I-129 L Classification Supplement | L-1A, L-1B |
| I-129 Q Classification Supplement | Q-1 |
| I-129 R Classification Supplement | R-1 |
| I-129 E Classification Supplement | E-1, E-2, E-3 |
| H-1B Data Collection and Filing Fee Exemption Supplement | H-1B, H-1B1 Chile, H-1B1 Singapore |

**Why `FORM_COMPONENT`, not `SUPPLEMENT`:** confirmed via `Backend/docs/forms/H0_I-129_template_seed_prompt.md` that the imported I-129 `USCISFormTemplate` PDF (`~980 fields`) already contains the base petition plus every one of these supplement sections as pages of the *same* PDF. There is no separate PDF/template for any of them, and there never will be — they cannot be independently provisioned as their own `CaseForm`, only ever rendered as part of I-129's own document.

Previously `componentType: SUPPLEMENT` with `provisioningType: AUTO_CREATE`/`CONDITIONAL` — i.e. tagged identically to the genuinely dependent forms in §3, and visible in the Case Manager's forms list as if independently actionable.

## 3. Dependent USCIS forms (`componentType: SUPPLEMENT`, own real PDF template, left untouched)

30 records, unaffected by this correction — they already have their own PDF/`USCISFormTemplate` and were already correctly excluded from `STANDALONE_FORM`, just never actually *filtered out* by any consumer until this pass:

| Form number | Parent | Visa types |
|---|---|---|
| I-539A | I-539 | H-4, L-2 |
| I-130A | I-130 | K-3, IR-1, CR-1, IR-2, CR-2, IR-3, IR-4, IR-5, F1, F2A, F2B, F3, F4 |
| I-864A | I-864 | IR-1, CR-1, IR-2, CR-2, IR-3, IR-4, IR-5, F1, F2A, F2B, F3, F4, GC-NVC |
| I-918 Supplement A | I-918 | U derivative |
| I-918 Supplement B | I-918 | U-1 |

`I-918 Supplement B` is `provisioningType: AUTO_CREATE` (correct — always filed alongside I-918 for a U-1 case) and is auto-provisioned via the registry's existing `AUTO_CREATE` mechanism exactly as before; this correction does **not** gate `CaseForm` auto-creation by independence (see §"Design note" below) — only what's *listed as independent* changes.

## 4. DOS forms

6 form numbers, agency `DOS`: DS-117, DS-156E, DS-160, DS-260, DS-261, DS-3035. All `componentType: ONLINE_APPLICATION`. Never independent by definition (agency check alone excludes them).

## 5. DOL forms

6 form numbers, agency `DOL`: ETA-9035, ETA-9089, ETA-9141, ETA-9142A, ETA-9142B, ETA-790/790A. Same exclusion basis as §4.

## 6. ICE/SEVP/school documents

| Form | Agency | Visa types |
|---|---|---|
| I-20 | SCHOOL_OR_PROGRAM_SPONSOR | F-1, F-2, F-1 OPT, F-1 STEM OPT, M-1, M-2 |
| DS-2019 | SCHOOL_OR_PROGRAM_SPONSOR | J-1, J-2 |
| I-983 | SEVP | F-1 STEM OPT |

None are agency `USCIS` — excluded by the agency check alone, regardless of componentType.

## 7. Government-issued / reference documents

| Form | Agency | componentType | Visa type |
|---|---|---|---|
| I-551 (Permanent Resident Card) | **USCIS** | REFERENCE_DOCUMENT | SB-1 |
| I-131 (as a *reference*, not a filing) | USCIS | REFERENCE_DOCUMENT | SB-1 |

I-551 is the one case in this registry where `agency === "USCIS"` alone would wrongly suggest independence — confirmed `isIndependentUSCISForm()`'s `componentType === "STANDALONE_FORM"` check correctly excludes it anyway. This is exactly the "I-20 is not a USCIS form simply because its name begins with 'I-'" pitfall the business flagged, generalized: agency is necessary but not sufficient, and this registry's predicate never relies on agency alone.

## 8. Visa hierarchy (`Backend/src/config/visaHierarchy.js`, new)

```
P
├── P-1 (own exact VisaFormMapping row)
│    ├── P-1A (no row — inherits P-1)
│    ├── P-1B (no row — inherits P-1)
│    └── P-1S (own exact row — inheritance never triggers)
├── P-2 (own exact row)
│    └── P-2S (own exact row)
└── P-3 (own exact row)
     └── P-3S (own exact row)

L-1 (no row of its own) → L-1A (own row) / L-1B (own row)
O-1 (no row of its own) → O-1A (own row) / O-1B (own row)
EB-1 (no row, no default) → EB-1A / EB-1B / EB-1C (each own row)
EB-2 (no row, no default) → EB-2 PERM / EB-2 NIW (each own row)
EB-3 (no row, no default) → EB-3 Skilled Worker / EB-3 Professional / EB-3 Other Worker (each own row)
EB-5 (no row, no default) → EB-5 Regional Center / EB-5 Standalone (each own row)
TN (no row) → TN Canada / TN Mexico (each own row)
H-1B1 (no row) → H-1B1 Chile / H-1B1 Singapore (each own row)
```
IR-1 and CR-1 are **not** linked as parent/child (per explicit decision) — each has its own identical-today-but-independently-resolved set of rows. `P-4` is deliberately absent from the hierarchy: it's a dependent-status filing (I-539+DS-160, no I-129) with its own correct exact row, not a subclassification of P-1/P-2/P-3.

## 9. Exact visa mappings (no fallback ever needed)

H-1B, L-1A, L-1B, O-1A, O-1B, O-2, P-1, P-1S, P-2, P-2S, P-3, P-3S, P-4, Q-1, R-1, E-1, E-2, E-3, H-1B1 Chile, H-1B1 Singapore, TN Canada, TN Mexico, EB-1A, EB-1B, EB-1C, EB-2 PERM, EB-2 NIW, EB-3 Skilled Worker/Professional/Other Worker, EB-5 Regional Center, EB-5 Standalone, K-1, K-3, IR-1 through IR-5, CR-1, CR-2, F1, F2A, F2B, F3, F4, GC-NVC, and 30+ others (79 distinct `visaType` keys total in the registry).

## 10. Parent fallback mappings (confirmed via live resolver test, post-migration)

| Case visaType | Resolved via | Independent forms |
|---|---|---|
| P-1A | fallback → P-1 | I-129 (+ I-907 when offered) |
| P-1B | fallback → P-1 | I-129 (+ I-907 when offered) |

These are the **only two** visa types in the entire registry that currently need the fallback for forms — every other subtype already has its own exact row (see §"Corrections to my own working assumptions" below).

## 11. Missing mappings (confirmed unresolved, correctly not guessed)

- **EB-2** (generic, no subtype specified): 0 rows, no parent registered → `unresolved: true`. Never silently resolves to EB-2 PERM or EB-2 NIW.
- **EB-5** (generic): same — never silently resolves to Regional Center or Standalone.
- **L-1**, **O-1**, **TN**, **H-1B1**, **EB-1**, **EB-3** (bare/generic forms): 0 rows, no parent → `unresolved: true`, by design (each requires its subclassification to be selected upstream).

## 12. Dedicated child overrides (never inherit despite a plausible parent existing)

L-1A/L-1B (never fall back to a hypothetical "L-1"), O-1A/O-1B (never "O-1"), EB-1A/EB-1B/EB-1C (never "EB-1"), EB-2 NIW/EB-2 PERM (never each other or a generic "EB-2"), EB-3's three subtypes, EB-5 Regional Center vs. Standalone, TN Canada/Mexico, H-1B1 Chile/Singapore — confirmed via `resolveVisaFormMappings`: each has its own non-empty exact-match result, so the hierarchy walker never advances past it.

## 13. Extension-specific / processing-path-specific mappings

Handled by the registry's existing `processingPaths` dimension (`CHANGE_OF_STATUS`, `EXTENSION_OF_STATUS`, `ADJUSTMENT_OF_STATUS`, `CONSULAR`, `NVC`, ...), evaluated at the *same* hierarchy level before any fallback — e.g. H-1B's I-539 only applies when `processingPath` is `CHANGE_OF_STATUS`/`EXTENSION_OF_STATUS`; IR-1's I-485/I-131/I-693/I-765 only apply when `processingPath` is `ADJUSTMENT_OF_STATUS`. No separate "extension workflow" concept was introduced — this dimension already existed and already takes precedence naturally, since it's evaluated as part of the exact/parent match at each hierarchy level, never bypassed.

## 14. Checklist inheritance

- **Forms and checklists resolve independently**, per the business rule — confirmed no code path conflates "no form mapping" with "no checklist" or vice versa.
- `visaChecklists.js`'s `generateChecklist()`: now uses the same `resolveWithHierarchyFallback` walker. Before this pass, P-1A/P-1B/P-1S/P-1/P-2/P-2S/P-4 **all** returned an empty checklist (confirmed reproduced) due to a compounding bug: `normalizeVisaType()` (`visaTypes.js`) has no entry for any "P-1"-shaped string beyond bare `"P"`, which gated the employment-workflow registry lookup behind a canonical-normalization step that always failed for these subtypes. Fixed by letting the exact-match layer try the *raw* visaType against the registry's own `matches()` regexes (which already work directly on strings like "P-1A") before falling through, **and** adding `"P"` as the root of the `P-1`/`P-2`/`P-3` hierarchy (the checklist registry's own umbrella is bare `"P"`, not `"P-1"` — a real, distinct convention from the *forms* registry, which does key on `"P-1"`/`"P-2"`/`"P-3"` directly). Confirmed post-fix: P-1A/P-1B/P-1S/P-1/P-2/P-2S/P-3/P-3S/P all resolve to the same 22-item checklist; P-4 correctly still returns empty (it's a dependent-status filing with no evidentiary checklist of its own, consistent with its forms behavior).
- **New**: IR-1, CR-1, F2A, F2B previously had **zero checklist definitions of any kind** (not a role-mixing bug — a total absence; `familyChecklists.js` only covered K-1/K-3). Added `family-workflow/questionnaires/familyBasedImmigrantPetition.js` + three new checklist builders (petitioner/beneficiary/joint_sponsor) reusing the existing `checklistRole` mechanism, exactly like K-1/K-3. `joint_sponsor` is a new role (added to `Case.js`/`Questionnaire.js`'s enums, additive) for the I-864 co-sponsor, previously unmodeled and would have been silently folded into "petitioner." 12 new checklist templates (4 visa types × 3 roles); the joint-sponsor checklist is `isDefault: false` (only assigned when a joint sponsor is actually added to a case).
- **Follow-up flagged, not fixed in this pass**: IR-2 through IR-5, CR-2, F1, F3, F4, and GC-NVC already have the identical I-130/I-864 form-mapping gap and would benefit from the same checklist content — deliberately scoped out (the business's own worked examples named only IR-1/CR-1/F2A/F2B). `familyBasedImmigrantPetition.js`'s `matches()` regex already recognizes all of them; only `FAMILY_VISA_TYPES` in `familyChecklists.js` needs extending to wire them up.
- `questionnaire.service.js`'s broader DB-backed questionnaire-assignment engine (its own ad hoc `P_VISA_TYPES` handling) is explicitly left untouched per your decision — it already works for P, and migrating its ~2000-line assignment logic to the new hierarchy is flagged as a larger follow-up, not attempted here.

## 15. Problematic aliases (documented, not unified in this pass)

Six independent visa-type vocabularies exist across the codebase, confirmed with **no two using identical spelling conventions**:
1. `Backend/src/config/visaTypes.js` — 30 stripped, uppercased keys (`P`, `EB1A`, `F2A`, `IR1CR1`...). No "P1A"/"P1B" key at all.
2. `Backend/src/config/visaCategories.js` — ~80 hyphenated display strings (`"P-1A"`, `"TN Canada"`, `"F-2A"` *and* a separate hyphen-less `"F2A"` key in the same file).
3. `Backend/src/modules/form-registry/seeds/visaFormMappings.seed.js` / this registry — 79 keys, hyphenated, closest to visaCategories.js but not identical (e.g. uses `"F1"`/`"F2A"` without hyphens for the family set).
4. `Backend/src/modules/eligibility-quiz/quiz.config.js` — 22 keys, e.g. `"CR-1/IR-1"` (order swapped vs. everything else), `"P-1"` only (no P-1A/P-1B/P-3 split).
5. `Immiglance/Client/src/config/visaConfig.js`/`visaEligibility.js` — smallest vocabulary, unsplit `"L-1"`/`"O-1"`/`"EB-1"`, no P-visa at all.
6. `Admin/frontend/src/components/CreateCaseModal.jsx` — 24 lowercase `value` codes mapped to hyphenated labels; submits the label, so it lines up with #2/#3 for the types it covers, but is missing several of #2's entries entirely (P-1, P-1S, EB-5, F-2A, IR-1/CR-1, B-1/B-2, J-1, M-1...).

This correction deliberately treats `visaCategories.js`'s spelling as the real-world source of truth (it matches what `Case.visaType` and this registry actually store) and does not attempt to unify the other five vocabularies — that's a separate, larger normalization project than "fix VisaFormMapping," flagged here as a known, pre-existing risk (a case created via a UI path using a spelling absent from the registry will resolve as if unmapped) rather than silently left undocumented.

---

## Design note: independence filtering vs. `CaseForm` auto-creation (corrected during implementation)

An earlier version of this fix also gated `registryAutoCreateTemplates` (the function that actually creates `CaseForm` documents) behind `isIndependentUSCISForm`. That was wrong and was reverted: `I-918 Supplement B` is a genuinely dependent form (§3) that is nonetheless `provisioningType: AUTO_CREATE` because it must always be filed alongside I-918 for every U-1 case, and it has its own real PDF template that needs its own `CaseForm`. Gating `CaseForm` creation by independence would have silently stopped it from ever being provisioned — a real regression. The independence filter belongs only where "should this be listed/offered as its own independent form" is the actual question (the Case Manager's forms list, `getFormsOverview`); it does not, and must not, gate whether a dependent form with a real template gets its `CaseForm` created when its own condition is met. `FORM_COMPONENT` records (§2) are excluded from `CaseForm` creation by `provisioningType: NOT_APPLICABLE` instead — the correct, separate mechanism, since they have no template to create at all.

## Files changed

- `Backend/src/config/visaHierarchy.js` (new) — canonical hierarchy + shared `resolveWithHierarchyFallback` walker.
- `Backend/src/modules/form-registry/visaFormMapping.service.js` — `resolveVisaFormMappings`, `isIndependentUSCISForm`, `independentFormsFrom`; `registryAutoCreateTemplates` now parent-fallback-aware (unchanged independence behavior, see design note above).
- `Backend/src/modules/form-registry/form-registry.controller.js` — `getFormsOverview` filters through the independence predicate and reports `resolvedVisaType`/`usedParentFallback`/`unresolved`.
- `Backend/src/modules/form-registry/seeds/visaFormMappings.seed.js` — 23 records re-tagged `SUPPLEMENT` → `FORM_COMPONENT` / `NOT_APPLICABLE`.
- `Backend/src/modules/form-registry/seeds/loadVisaFormMappings.js` — stale-variant cleanup (so a future `componentType` correction doesn't leave an orphaned duplicate row), and a pre-existing `rawResult` counting bug fixed (`includeResultMetadata`, the current Mongoose 8.x option name).
- `Backend/src/config/visaChecklists.js` — hierarchy-fallback-aware `generateChecklist()`, raw-string registry matching fallback.
- `Backend/src/models/Case.js`, `Backend/src/models/Questionnaire.js` — additive `"joint_sponsor"` role.
- `Backend/src/modules/family-workflow/questionnaires/familyBasedImmigrantPetition.js` (new) — IR-1/CR-1/F2A/F2B petitioner/beneficiary/joint-sponsor content.
- `Backend/src/modules/questionnaires/familyChecklists.js` — 12 new checklist definitions.
- Tests: `Backend/src/modules/form-registry/tests/visaFormMapping.resolver.test.js` (new), `Backend/src/config/tests/visaHierarchy.test.js` (new), `Backend/src/modules/family-workflow/tests/family-workflow.test.js` (updated).
- Database: 23 `VisaFormMapping` documents corrected in place (dev DB), 0 duplicates, 0 data loss — verified via `loadVisaFormMappings.js`.

No second visa-to-form mapping system was introduced; `VisaFormMapping` + this one resolver remain the sole authority, called by case-form provisioning and every "USCIS Forms" surface alike.
