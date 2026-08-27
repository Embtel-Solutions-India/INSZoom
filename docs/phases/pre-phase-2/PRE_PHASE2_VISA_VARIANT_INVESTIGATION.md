# Pre-Phase 2 Visa Variant / Classification Field Investigation

Scope: read-and-report only. No source files were modified.

## Step 1 - Exact Field Name Search

Search command used:

```powershell
rg -n -C 4 "visaVariant|oClassification|pClassification" Backend/src BAIS/Frontend/src INSZoom/frontend/src
```

### `visaVariant`

Found in 8 code locations:

1. `INSZoom/frontend/src/utils/visaDisplay.js:5`
   - Context: comment explaining that selected O/P variants are mirrored onto `case.questionnaireData.masterData.visaVariant`.
2. `INSZoom/frontend/src/utils/visaDisplay.js:9`
   - Context: runtime display helper reads `caseItem?.questionnaireData?.masterData?.visaVariant`.
3. `BAIS/Frontend/src/utils/visaDisplay.js:6`
   - Context: same comment as INSZoom helper.
4. `BAIS/Frontend/src/utils/visaDisplay.js:10`
   - Context: runtime display helper reads `caseItem?.questionnaireData?.masterData?.visaVariant`.
5. `Backend/src/utils/visaDisplay.js:4`
   - Context: backend display helper comment says selected variant is mirrored to `case.questionnaireData.masterData.visaVariant`.
6. `Backend/src/utils/visaDisplay.js:7`
   - Context: comment says `oClassification`/`pClassification` fieldCatalog entries use `masterDataPath: "visaVariant"`.
7. `Backend/src/utils/visaDisplay.js:12`
   - Context: runtime helper reads `caseData?.questionnaireData?.masterData?.visaVariant`.
8. `Backend/src/modules/employment-workflow/questionnaires/o1.js:370`, `373`, `378`; `Backend/src/modules/employment-workflow/questionnaires/p.js:199`; `Backend/src/modules/questionnaires/employmentChecklists.js:228`, `232`
   - Context: questionnaire catalog and template-builder comments/metadata route O/P classification answers into `masterData.visaVariant`.

### `oClassification`

Found in 10 code locations:

1. `Backend/src/utils/visaDisplay.js:6`
   - Context: comment names `oClassification/pClassification` as fieldCatalog entries with `masterDataPath: "visaVariant"`.
2. `Backend/src/modules/employment-workflow/questionnaires/o1.js:260`
   - Context: `normalizeEmployer()` stores `oClassification: payload.oClassification || ""`.
3. `Backend/src/modules/employment-workflow/questionnaires/o1.js:370`
   - Context: comment explaining `oClassification` carries `masterDataPath: "visaVariant"`.
4. `Backend/src/modules/employment-workflow/questionnaires/o1.js:378`
   - Context: field catalog entry `{ path: "employer.oClassification", label: "O-1 Classification", required: true, type: "select", options: O_CLASSIFICATIONS, masterDataPath: "visaVariant" }`.
5. `Backend/src/modules/questionnaires/employmentChecklists.js:35`
   - Context: section prefix map entry `["oClassification", "O-1 Classification"]`.
6. `Backend/src/modules/questionnaires/employmentChecklists.js:229`
   - Context: comment says variant selectors like `pClassification/oClassification` override inferred master-data path.
7. `Backend/src/modules/questionnaires/employmentChecklists.js:586`
   - Context: O-1 criteria are gated on `employer_oClassification === variantValue`.
8. `Backend/src/modules/questionnaires/employmentChecklists.js:596`
   - Context: `const gate = { rules: [{ questionKey: "employer_oClassification", operator: "equals", value: variantValue }] }`.
9. `Backend/src/modules/questionnaires/employmentChecklists.js:669-673`
   - Context: comment says the employer checklist asks `oClassification` and gates O-1A/O-1B criteria through `employer_oClassification`.
10. `Backend/src/modules/questionnaires/employmentChecklists.js:703-704`
   - Context: O-1A and O-1B criteria question groups are built with variant values `"O-1A"` and `"O-1B"`.

### `pClassification`

Found in 12 code locations:

1. `Backend/src/utils/visaDisplay.js:6`
   - Context: comment names `oClassification/pClassification` fieldCatalog entries.
2. `Backend/src/modules/employment-workflow/questionnaires/p.js:25`, `36`, `43`
   - Context: comments describe evidence groups shown only when `pClassification === "P-1A"`, `"P-1B"`, or `"P-3"`.
3. `Backend/src/modules/employment-workflow/questionnaires/p.js:79`
   - Context: `normalizeEmployer()` stores `pClassification: payload.pClassification || ""`.
4. `Backend/src/modules/employment-workflow/questionnaires/p.js:114`
   - Context: comment says document groups gate on the `pClassification` answer.
5. `Backend/src/modules/employment-workflow/questionnaires/p.js:199`
   - Context: field catalog entry `{ path: "employer.pClassification", label: "P Classification", required: true, type: "select", options: P_CLASSIFICATIONS, masterDataPath: "visaVariant" }`.
6. `Backend/src/modules/questionnaires/employmentChecklists.js:34`
   - Context: section prefix map entry `["pClassification", "P Classification"]`.
7. `Backend/src/modules/questionnaires/employmentChecklists.js:229`
   - Context: comment says variant selectors like `pClassification/oClassification` override inferred master-data path.
8. `Backend/src/modules/questionnaires/employmentChecklists.js:509`
   - Context: comment says P sub-type is captured by `pClassification`.
9. `Backend/src/modules/questionnaires/employmentChecklists.js:525`
   - Context: `gateOn()` gates on `questionKey: "employer_pClassification"`.
10. `Backend/src/modules/questionnaires/employmentChecklists.js:672-673`
   - Context: comment compares O-1 gating to `employer_pClassification`.

## Step 2 - Case Model Visa/Petition Fields

File read: `Backend/src/models/Case.js`.

Confirmed fields:

- `visaType` at line 442: `{ type: String, required: true, trim: true }`. No enum.
- `visaCategory` at line 441: `{ type: String, default: "" }`. No enum.
- `caseType` at line 443: `{ type: String, default: "immigration", index: true }`. No enum.
- `petitionType` at line 444: `{ type: String, trim: true, index: true }`. No enum.
- `petitionSubType` at line 445: `{ type: String, trim: true }`. No enum.

Other field names in `Case.js` containing visa/classification/variant/category/subtype/petition:

- `internalNoteSchema.category` at line 46; enum `["general", "legal_strategy", "evidence", "forms", "client_communication", "filing", "deadline"]`.
- `checklistItemSchema.category` at line 124; default `"general"`.
- `questionnaireReferenceSchema.targetRole` includes `"petitioner"` at line 183.
- `addonSchema.intake.petitionerFamilyName` and `petitionerGivenName` at lines 262-263.
- `caseParticipantSchema.role` includes `"petitioner"` at line 353.
- `caseParticipantSchema.petitionerId` and `petitionerModel` at lines 367-368.
- Top-level `petitioner`, `petitionerModel`, `petitionerName`, `petitionerEin` at lines 410-413.
- Top-level `visaCategory`, `visaType`, `caseType`, `petitionType`, `petitionSubType` at lines 441-445.
- `petitionerUser` at line 483.
- `familyWorkflow.petitionerStatus` and `petitionerSubmittedAt` at lines 499 and 502.
- `visaExpirationDate` at line 566.
- Indexes on `visaType`, `caseType`, `petitionType`, `visaCategory` at lines 855, 873, 874, 887, 888, 897.

No top-level Case schema field named `visaVariant`, `oClassification`, or `pClassification` exists.

## Step 3 - Visa-Related Config Files

### `Backend/src/config/visaTypes.js`

Exports:

- `VISA_TYPES`: `F1`, `H1B`, `L1A`, `L1B`, `O1`, `P`, `EB1A`, `EB2_NIW`, `B1`, `B2`, `B1B2`, `E1`, `E2`, `E3`, `TN`, `H2B`, `ESTA`, `J1`, `M1`, `K1`, `K3`, `IR1CR1`, `F2A`, `F2B`, `H4`, `EB1`, `EB2`, `EB3`, `EB5`, `N400`, `I130`, `I485`.
- `LEGACY_ALIASES`: `"L1": "L1A"`, `"EB2NIW": "EB2_NIW"`.
- `LEGACY_LABEL_FOR_CHECKLIST`: maps canonical keys to display/checklist strings, including `H1B: "H-1B"`, `O1: "O-1"`, `P: "P"`, `L1A/L1B: "L-1"`, `K1: "K-1"`, `K3: "K-3"`.
- `normalizeVisaType(value)`: strips separators, uppercases, resolves aliases.

Classification/subtype data: it contains broad visa-type keys only. It has no O-1A/O-1B/O-2 enum, no P-1A/P-1B/P-2/P-3 enum, and no H-1B cap/transfer/extension variants.

Similar constants/field names: no `visaVariant`, `oClassification`, or `pClassification`.

### `Backend/src/config/visaChecklists.js`

Exports:

- `VISA_CHECKLISTS` with keys `"F-1"`, `"H-1B"`, `"O-1"`, `"EB-1A"`, `"EB-2 NIW"`.
- `generateChecklist(visaType)`, which prefers employment-workflow questionnaire definitions via `questionnaireRegistry.getDefinition(canonical)` and falls back to `VISA_CHECKLISTS`.

Classification/subtype data: the fallback table has generic `"O-1"` and `"H-1B"` document lists only. It has no O subtype, P subtype, or H-1B variant values. P is not present in the fallback table, but can be served via the employment-workflow registry.

Similar constants/field names: no `visaVariant`, `oClassification`, or `pClassification`.

### `Backend/src/config/filingTypes.js`

Exports:

- `FILING_TYPES` with keys `COS_F1`, `COS_F2`, `COS_GENERIC`, `F1_REINSTATEMENT`, `F1_TO_B2`, `EAD`, `H4_EXTENSION`, `H4_EXTENSION_EAD`.
- Helper functions `listFilingTypes()`, `getFilingType(key)`, `groupedForSelection()`, `resolveTransitionFilingType(fromStatus, toStatus)`.

Classification/subtype data: single-party filing categories only. It has no O/P/H-1B classification or variant data.

Similar constants/field names: no `visaVariant`, `oClassification`, or `pClassification`.

## Step 4 - Form Mapping Crosswalk Files

Files read:

- `Backend/src/modules/form-mapping/seeds/i129-h1b-mapping.seed.js`
- `Backend/src/modules/form-mapping/seeds/i129f-k1-mapping.seed.js`
- `Backend/src/modules/form-mapping/seeds/i130-k3-mapping.seed.js`
- `Backend/src/modules/form-mapping/config/i129-h1b-crosswalk.js`
- `Backend/src/modules/form-mapping/config/i129f-k1-crosswalk.js`
- `Backend/src/modules/form-mapping/config/i130-k3-crosswalk.js`

Optional files checked:

- `Backend/src/modules/form-mapping/config/i129-h1b-crosswalk.js`: exists.
- `Backend/src/modules/form-mapping/config/i129-o1-crosswalk.js`: does not exist.
- `Backend/src/modules/form-mapping/config/i129-l1-crosswalk.js`: does not exist.

### I-129 H-1B/L-1 crosswalk and seed

Visa types covered:

- The seed comment says the active I-129 mapping graph covers both H-1B and L-1A/L-1B.
- The config header says one combined I-129 crosswalk is used because `USCISFormTemplate` supports one active mapping version per template.

References to classification/variant fields:

- No references to `visaVariant`, `oClassification`, `pClassification`, `petitionType`, or `petitionSubType`.
- Uses `case.visaType` for classification symbol and H/L classification checkboxes.
- Uses `raw.questionnaireAnswers.employee_filingType.value` for H-1B requested action checkboxes.
- Uses `raw.questionnaireAnswers.employee_filingCapType.value` for Regular/Master's cap checkboxes.

Relevant conditions:

- `Part2_ClassificationSymbol[0]` source: `case.visaType`.
- `SubHLine4_class[0]` source: `case.visaType`, condition equals `"H-1B"`.
- `a_L1A[0]` source: `case.visaType`, condition equals `"L-1A"`.
- `b_L1B[0]` source: `case.visaType`, condition equals `"L-1B"`.
- H-1B filing action checkboxes use `employee_filingType`: `"New H1B"`, `"H1B Concurrent"`, `"H1B Transfer"`, `"H1B Amendment"`, `"H1B Extension"`.
- H-1B cap checkboxes use `employee_filingCapType`: `"Regular CAP"`, `"Master's CAP"`.

O/P logic:

- No O-1A/O-1B/O-2 or P-1A/P-1B/P-2/P-3 checkbox logic exists.
- `OUT_OF_SCOPE_PAGES` includes pages 28-30, documented as "O and P Classifications Supplement".
- `classifyField()` returns `out_of_scope` for those pages with note: "Belongs to a different classification/supplement (E-1/E-2, Trade Agreement, H-2A/H-2B/H-3, O/P, Q-1, R-1, or the multi-beneficiary Attachment-1) - not applicable to an H-1B or L-1A/L-1B petition."

### I-129F K-1 seed/config

Visa type covered: K-1/I-129F.

Classification fields: no `visaVariant`, `oClassification`, `pClassification`, `petitionType`, or `petitionSubType`. Conditions are based on raw questionnaire answers such as gender/marital status.

### I-130 K-3 seed/config

Visa type covered: K-3/I-130.

Classification fields: no `visaVariant`, `oClassification`, `pClassification`, `petitionType`, or `petitionSubType`. It uses `case.visaType === "K-3"` for the spousal relationship checkbox.

## Step 5 - AutoFillService / FormMappingService / CanonicalBuilderService

Files read:

- `Backend/src/modules/form-mapping/services/AutoFillService.js`
- `Backend/src/modules/form-mapping/services/FormMappingService.js`
- `Backend/src/modules/canonical/services/CanonicalBuilderService.js`

Findings:

- `AutoFillService.generate()` loads a template, builds canonical data with `CanonicalDataService.build()`, then calls `FormMappingService.mapTemplate(template, canonicalData)`.
- `AutoFillService` contains no direct visa-type, petition-type, O/P classification, or `visaVariant` branching.
- `FormMappingService` contains no direct visa-type branching. It applies mapping graph edges and resolves each field generically through `MappingResolver`.
- `CanonicalBuilderService` maps `case.visaType`, `case.visaCategory`, and `case.petitionType` into canonical paths. It does not map `case.petitionSubType`.
- `CanonicalBuilderService` uses the word `classification` only for OCR document classification (`extraction.classification?.documentType`), not visa classification.
- No service references `visaVariant`, `oClassification`, or `pClassification`.

The form-filling behavior is therefore determined by mapping graph edge conditions, not by a hardcoded AutoFillService classification decision tree.

## Step 6 - H-Phase Work Files

Name search found:

- `../../forms/H0_I-129_template_seed_prompt.md`: forms prompt for Phase H0, seed/activate I-129 template.
- H-named source/test files, including:
  - `Backend/src/modules/uscis-form-import/tests/h0-i129-seed.test.js`: H0 test file.
  - `Backend/src/modules/form-mapping/tests/h1-i129-mapping.test.js`: H1 I-129 mapping test.
  - `Backend/src/modules/form-generation/tests/h3-formGenerationRoutes.test.js`, `h3-pdf-generation.test.js`, `h3-pdf-render.test.js`: H3 form-generation tests.
  - `Backend/src/modules/petition/tests/h4-h5-end-to-end.test.js`: H4/H5 petition test.
  - `Backend/src/modules/uscis-forms/tests/h6-conditional-forms.test.js`: H6 conditional forms test.
  - `Backend/src/modules/employment-workflow/questionnaires/h1b.js`: H-1B questionnaire definition, not an H-phase prompt.
  - `Backend/src/modules/h1b-e2e/tests/h1b-golden-path.test.js` and `Backend/src/test-utils/fixtures/h1b-golden.js`: H-1B E2E fixtures/tests.

No files containing `h1b-petition` or `petition-structure` in their names were found.

Searches in `docs/`, `.agents/`, and `.claude/` for `oClassification`, `pClassification`, and `visaVariant` returned zero matches.

## Step 7 - Classification Logic in Case Creation

Files read:

- `Backend/src/modules/cases/case.controller.js`
- `Backend/src/modules/cases/case.service.js`
- `Backend/src/modules/employment-workflow/employment-workflow.controller.js`
- `Backend/src/modules/family-workflow/family-workflow.controller.js`

Findings:

- `case.controller.js`:
  - `supportsPremiumProcessing()` checks `petitionType`, `petitionSubType`, `visaType`, `visaCategory`, and `caseType`, but only for premium-processing eligibility.
  - Case creation accepts `visaType`; staff-created cases set `visaCategory: visaType`.
  - Case update allowlist includes `petitionType` and `petitionSubType`.
  - Changes to `visaType`, `visaCategory`, `caseType`, `petitionType`, or `petitionSubType` trigger `immigration-knowledge-engine.service` with reason `case_classification_changed`.
  - No O/P-specific subtype derivation.
- `case.service.js`:
  - Filters/searches by `visaType`, `visaCategory`, and `petitionType`.
  - `hydrateCaseRelationships()` copies `visaType`/`visaCategory` from related client/beneficiary if absent.
  - No logic sets `petitionType` or `petitionSubType` based on visa type.
- `employment-workflow.controller.js`:
  - Employer case creation sets `visaType = req.body.visaType || req.body.petitionType || "H-1B"`.
  - Sets `petitionType = req.body.petitionType || req.body.visaType`.
  - Normalizes employer questionnaire master data through the per-visa registry.
  - No top-level Case `petitionSubType` assignment and no O/P subtype branching.
- `family-workflow.controller.js`:
  - Family case creation sets `visaType = req.body.visaType || "K-1"` and `petitionType = req.body.petitionType || visaType`.
  - No O/P/H-1B classification branching.

## Explicit Answers

1. **Do `visaVariant`, `oClassification`, and `pClassification` exist anywhere in the codebase?**

   Yes, but not as top-level `Case` model fields.

   - `visaVariant` exists as a questionnaire master-data path and display helper value:
     - `Backend/src/utils/visaDisplay.js:4`, `12`
     - `BAIS/Frontend/src/utils/visaDisplay.js:6`, `10`
     - `INSZoom/frontend/src/utils/visaDisplay.js:5`, `9`
     - `Backend/src/modules/employment-workflow/questionnaires/o1.js:378`
     - `Backend/src/modules/employment-workflow/questionnaires/p.js:199`
     - `Backend/src/modules/questionnaires/employmentChecklists.js:228-232`
   - `oClassification` exists in O-1 questionnaire definitions and checklist gating:
     - `Backend/src/modules/employment-workflow/questionnaires/o1.js:260`, `378`
     - `Backend/src/modules/questionnaires/employmentChecklists.js:35`, `596`, `669-673`
   - `pClassification` exists in P questionnaire definitions and checklist gating:
     - `Backend/src/modules/employment-workflow/questionnaires/p.js:79`, `199`
     - `Backend/src/modules/questionnaires/employmentChecklists.js:34`, `525`, `505-513`

2. **Does the combination of `visaType`, `visaCategory`, `petitionType`, and `petitionSubType` currently capture enough information to distinguish between the listed groups?**

   - H-1B Cap vs H-1B Cap-Exempt vs H-1B Transfer vs H-1B Extension: **No, not through those four Case fields.** The form-mapping pipeline currently distinguishes some H-1B filing/action values through questionnaire answers:
     - `raw.questionnaireAnswers.employee_filingType.value`: `"New H1B"`, `"H1B Extension"`, `"H1B Transfer"`, `"H1B Amendment"`, `"H1B Concurrent"`.
     - `raw.questionnaireAnswers.employee_filingCapType.value`: `"Regular CAP"`, `"Master's CAP"`.
     - Cap-exempt is not represented in the H-1B field catalog options or I-129 crosswalk; the crosswalk explicitly says Chile/Singapore and Cap Exempt have no corresponding source value and are left unmapped.
   - O-1A vs O-1B vs O-2: **No, not through those four Case fields.** O-1A/O-1B are captured by the O-1 employer questionnaire field `employer.oClassification`, and mirrored to `questionnaireData.masterData.visaVariant`. O-2 is not present in `O_CLASSIFICATIONS`, which is only `["O-1A", "O-1B"]`.
   - P-1A vs P-1B vs P-2 vs P-3: **No, not through those four Case fields.** P-1A/P-1B/P-3 are captured by the P employer questionnaire field `employer.pClassification`, and mirrored to `questionnaireData.masterData.visaVariant`. P-2 is not present in `P_CLASSIFICATIONS`, which is only `["P-1A", "P-1B", "P-3"]`.

3. **Does the I-129 crosswalk/mapping file contain conditional logic that uses a classification field to determine which checkboxes are filled?**

   Yes for H-1B/L-1A/L-1B, but no for O/P classifications.

   - It uses `case.visaType` for the requested classification symbol and H/L classification checkboxes:
     - H-1B checkbox: condition `case.visaType === "H-1B"`.
     - L-1A checkbox: condition `case.visaType === "L-1A"`.
     - L-1B checkbox: condition `case.visaType === "L-1B"`.
   - It uses `raw.questionnaireAnswers.employee_filingType.value` for H-1B action checkboxes such as new employment, change of employer, amendment, concurrent, and extension.
   - It uses `raw.questionnaireAnswers.employee_filingCapType.value` for Regular CAP and Master's CAP.
   - It currently handles the multi-visa-type nature of I-129 by one combined crosswalk/active mapping graph and by marking non-H/L supplement pages as `out_of_scope`. O/P supplement pages 28-30 are explicitly out of scope.

4. **Can the AutoFillService currently fill an I-129 for an O-1A case differently from an O-1B case?**

   No. `AutoFillService` has no O-1A/O-1B branching, and the active I-129 crosswalk has no O/P supplement mappings. Although O-1A/O-1B selection is captured in questionnaire data as `employer.oClassification` and mirrored to `questionnaireData.masterData.visaVariant`, the I-129 mapping graph does not consume that data for O/P form fields. The current I-129 crosswalk treats O/P supplement pages as out of scope.

5. **Which option is most accurate: A, B, or C?**

   **B is most accurate.**

   Existing fields and questionnaire data partially cover the intended functionality:

   - `case.visaType` is sufficient for H-1B vs L-1A vs L-1B checkbox branching in the current I-129 crosswalk.
   - H-1B transfer/extension/new/concurrent/amendment and Regular/Master's cap are captured through questionnaire answers, not through top-level `Case` fields.
   - O-1A/O-1B and P-1A/P-1B/P-3 are captured through questionnaire fields and mirrored to `questionnaireData.masterData.visaVariant`, but the form-filling pipeline does not currently use them for I-129 O/P supplement mappings.
   - O-2, P-2, and H-1B Cap-Exempt are not fully represented by the current enums/options found in the inspected code.

   Therefore, adding top-level Case fields with exactly the names `visaVariant`, `oClassification`, and `pClassification` may not be strictly required for the already-modeled O-1A/O-1B/P-1A/P-1B/P-3 questionnaire/display use case, but additional modeling or mapping work is needed for missing variants and for I-129 O/P autofill.

6. **Every file read during this investigation, in order read.**

   1. `Backend/src/models/Case.js`
   2. `Backend/src/config/visaTypes.js`
   3. `Backend/src/config/visaChecklists.js`
   4. `Backend/src/config/filingTypes.js`
   5. `Backend/src/modules/form-mapping/seeds/i129-h1b-mapping.seed.js`
   6. `Backend/src/modules/form-mapping/seeds/i129f-k1-mapping.seed.js`
   7. `Backend/src/modules/form-mapping/seeds/i130-k3-mapping.seed.js`
   8. `Backend/src/modules/form-mapping/config/i129-h1b-crosswalk.js`
   9. `Backend/src/modules/form-mapping/services/AutoFillService.js`
   10. `Backend/src/modules/form-mapping/services/FormMappingService.js`
   11. `Backend/src/modules/canonical/services/CanonicalBuilderService.js`
   12. `Backend/src/modules/cases/case.controller.js`
   13. `Backend/src/modules/cases/case.service.js`
   14. `Backend/src/modules/employment-workflow/employment-workflow.controller.js`
   15. `Backend/src/modules/family-workflow/family-workflow.controller.js`
   16. `Backend/src/modules/employment-workflow/questionnaires/o1.js`
   17. `Backend/src/modules/employment-workflow/questionnaires/p.js`
   18. `Backend/src/modules/questionnaires/employmentChecklists.js`
   19. `Backend/src/utils/visaDisplay.js`
   20. `BAIS/Frontend/src/utils/visaDisplay.js`
   21. `INSZoom/frontend/src/utils/visaDisplay.js`
   22. `Backend/src/modules/questionnaires/questionnaire.service.js`
   23. `../../forms/H0_I-129_template_seed_prompt.md`
   24. `Backend/src/modules/form-mapping/config/i129f-k1-crosswalk.js`
   25. `Backend/src/modules/form-mapping/config/i130-k3-crosswalk.js`
