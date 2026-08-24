# Phase 0 Baseline — USCIS Forms Pipeline Inventory

Characterization of the pipeline as it exists today, gathered by read-only tracing (no behavior
changed). This is the reference later phases (canonical write-back, mapping fixes, field-type
registry, renderer changes) are graded against. See `docs/forms/PHASE0_RUN_JOURNAL.md` for how
this was produced and `docs/forms/PHASE0_CANDIDATE_DEFECTS.md` for defects found while building it.

Scope: **H-1B (I-129)**, **L-1A/L-1B (I-129)**, **K-1 (I-129F)** and **K-3 (I-130)** — the only
forms with real canonical→PDF crosswalks today (`ARCHITECTURE.md` §4: I-134/I-539/I-539A/I-907
have zero mappings and are out of scope for golden fixtures).

## 1. End-to-end data flow

```
Source answers (Answer docs, via questionnaireService.saveAnswers)
  -> Case.canonicalProfile (built by CanonicalProfileService.rebuild -> CanonicalBuilderService.build)
  -> CanonicalDataService.build(caseId, user, req)
       - CanonicalProfileService.get(caseId, user, req, { rebuild: true, reason: "form_mapping" })
       - Case.findById(caseId).select("questionnaireData")
       - merges canonicalProfile.profile + questionnaireData.masterData into one object with
         { canonicalProfile, fieldMetadata, sourceAttribution, sources, conflicts, validation, metadata }
  -> FormMappingService.mapTemplate(template, canonicalData)          [preview only, not persisted]
       - per template.formFields[]: isFieldVisible -> MappingResolver.resolveConditionalRule
       - resolveField -> normalizeMappings -> MappingResolver.resolveMapping
         (resolveDerivedValue / getSourcePath / resolvePath / resolveDefaultValue / applyTransform)
       - writes filledData / fieldValues / sourceAttribution via MappingResolver.setPath
       - ValidationService.validateTemplateOutput, FormMappingService.calculateCompletion
  -> AutoFillService.generate(caseId, formType, user, req, options)
       - AutoFillService.mergeMappedFields(caseForm, template, mapped, canonicalData, options)
         merges into the existing CaseForm, SKIPPING fields where isReviewedOrManual() is true
         unless options.overwriteReviewed === true (AutoFillService.js:109-116, 134-137)
       - persists CaseForm.filledData / fieldValues / sourceAttribution / validationErrors /
         completion / autoFillReport, status="ai_filled"
  -> PDFGenerationService.generate(caseFormId, user, req, options)
       - loadCaseForm -> assertCanGenerate -> PDFValidationService.validate
       - PDFRenderer.render({ caseForm, template, watermark, flatten })
           - loadTemplatePdf: loads the stored blank PDF; if AcroForm field count is 0 but
             template.formFields is non-empty, shells out to qpdf via normalizePdf() and reloads
           - PDFFieldMapper.mapFields(caseForm, template): resolves each pdfField's value from
             caseForm.filledData via MappingResolver.resolvePath, applies mapValue() (date
             formatting / valueMap / checkbox coercion)
           - PDFRenderer.setFormField per mapped field (checkbox/radio/dropdown/optionlist/text)
           - flatten or NeedAppearances, pdf.save() -> Buffer, WatermarkService.apply
       - createGeneratedDocument -> storageService.storeBuffer, Document.create
       - CaseForm.generatedPdfVersions.push(...), status="generated"
  -> FilingPackageService.assemble/assembleOrdered
       - merges each form's generatedPdfDocument + approved Documents into one combined PDF
         (pdf-lib copyPages), applies WatermarkService, stores as a new Document
```

Key files (all confirmed to exist at these exact paths):
- `Backend/src/modules/form-generation/services/{PDFRenderer,PDFFieldMapper,PDFGenerationService,FilingPackageService}.js`
- `Backend/src/modules/form-mapping/services/{MappingResolver,AutoFillService,CanonicalDataService,ValidationService,CanonicalFieldRegistryService,FormMappingService,MappingGraphService}.js`
- `Backend/src/modules/form-mapping/config/{i129-h1b-crosswalk,i130-k3-crosswalk,i129f-k1-crosswalk}.js`
  (the H-1B crosswalk file also covers L-1A/L-1B, per its own header comment)
- `Backend/src/modules/canonical/services/CanonicalProfileService.js`
- `Backend/src/utils/normalizePdf.js` (qpdf shell-out; `env.qpdfPath` from `Backend/src/config/env.js:155`)

## 2. `CaseForm` data shape (as actually defined, `Backend/src/models/CaseForm.js`)

- `filledData: Mixed` — nested object, keyed by dotted/bracket paths or raw AcroForm field ids.
- `fieldValues: { Mixed, default: {} }` — flat map `{ [fieldId]: value }`.
- `sourceAttribution: { Mixed, default: {} }` — flat map `{ [fieldId]: {...} }`, shape below.
- `manualOverrides: { Mixed, default: {} }` — flat map `{ [fieldId]: { previousValue, value,
  reason, overriddenBy, overriddenAt } }`.
- `fieldReviews: { Mixed, default: {} }` — flat map `{ [fieldId]: { status, comment, reviewedBy,
  reviewedAt } }`.
- `syncState`, `comparisonBaseline`, `versions[]` — versioning/staleness bookkeeping.

`sourceAttribution[fieldId]` as written by auto-fill merge (`AutoFillService.js:143-154`):
```js
{ ...attribution, value, originalValue: previousValue, canonicalSource: attribution.sourceField,
  mappingUsed, populatedAt: Date, populationTimestamp: Date,
  verificationStatus: "auto_filled", validationStatus: attribution.validationStatus || "not_validated",
  confidence: attribution.confidence ?? mappingUsed?.confidence ?? 100 }
```
as written by a manual override (`AutoFillService.js:336-344`):
```js
{ value, source: "AttorneyOverride", sourceField: fieldId, confidence: 100,
  generatedAt: Date, validationStatus: "manual_override" }
```
`populatedAt`/`populationTimestamp`/`generatedAt` are wall-clock timestamps — **volatile, stripped
before golden-fixture comparison** (see `PHASE0_RUN_JOURNAL.md` determinism notes and
`tests/phase0/goldenHarness.js`'s `normalizeForSnapshot`).

## 3. Override path (confirmed by direct read of `AutoFillService.js`)

`AutoFillService.overrideField(caseId, formType, fieldId, value, user, req, reason)`
(`AutoFillService.js:310-364`) writes **only** to the one `CaseForm` document it loads via
`findCaseForm(caseId, formType)`:
- `filledData` (via `MappingResolver.setPath`)
- `fieldValues[fieldId]` (via a plain-object copy + full-field re-`.set()`, because AcroForm field
  ids like `"form1[0].#subform[2].Line8a_StreetNumberName[0]"` contain literal dots/brackets that
  break Mongoose's dotted-path `.set()` API — this is a deliberate workaround, not a bug)
- `sourceAttribution[fieldId]` — `source: "AttorneyOverride"`, `validationStatus: "manual_override"`
- `manualOverrides[fieldId]` — `{ previousValue, value, reason, overriddenBy, overriddenAt }`
- an `auditHistory` entry (`FIELD_OVERRIDDEN`) plus a separate `AuditLog` document.

**It never touches `Case.canonicalProfile` or any canonical-profile document.** No call into
`CanonicalProfileService` appears anywhere in `overrideField`.

`CanonicalProfileService` (`Backend/src/modules/canonical/services/CanonicalProfileService.js`,
read in full) has these methods: `userId` (helper), `audit` (writes `AuditLog` only), `get`
(read-only unless it delegates to `rebuild`), `rebuild` (rebuilds+persists the whole profile from
source documents), `resolveConflict` (persists a conflict-resolution merge), `validate` (despite
its name, can trigger `rebuild` and always re-persists `validation`/`status`/`missingFields`),
`history` (read-only). **Correction to the task's initial assumption**: `CanonicalProfileService`
is not purely read-only — it has write methods, but every one of them operates on the whole
profile (rebuild-from-sources or resolve-a-detected-conflict). **What it genuinely lacks is any
method to apply a single manually-overridden field value into the canonical profile** — there is
no `applyOverride`/`setField`/`overrideField` equivalent to `AutoFillService.overrideField`. That
precise gap — not "no write API at all" — is what Phase 3's new API surface needs to fill, and is
guarded by `Backend/src/modules/canonical/tests/phase0.invariants.test.js`'s allowlist test (fails
loudly if a same-shaped method appears without a deliberate decision).

## 4. Re-autofill / reviewed-field protection

`AutoFillService.isReviewedOrManual(caseForm, fieldId)` (`AutoFillService.js:109-116`) — a field
is protected from being overwritten by a fresh auto-fill merge if **any** of:
- `manualOverrides[fieldId]` exists, OR
- `fieldReviews[fieldId].status` is `"approved"` or `"edited"`, OR
- `sourceAttribution[fieldId].verificationStatus`/`.validationStatus` is one of
  `manual_override` / `approved` / `attorney_verified` / `case_manager_verified`.

`mergeMappedFields` (`AutoFillService.js:118-168`) checks this per field and records
`{ fieldId, reason: "manual_or_reviewed_field" }` in `skippedFields` instead of overwriting,
**unless** the caller passes `options.overwriteReviewed = true`. `resetAutoFilledFields` uses the
same guard to decide what's safe to clear.

## 5. Crosswalk fan-out (one canonical `source` -> many `pdfField`s)

Verified by loading the three crosswalk config modules directly and grouping `MAPPED_EDGES` by
`source`:

| Crosswalk | Total edges | Distinct sources | Fan-out sources (source -> pdfField count) |
|---|---|---|---|
| `i129-h1b-crosswalk.js` (H-1B **and** L-1A/L-1B) | 101 | 68 | 15 fan-out sources, incl. `employee_education_highestLevel.value`->9, `employer_foreignCompany_relationshipType.value`->5, `employee_filingType.value`->5, `case.visaType`->4, `employer_position_wageLevel.value`->4, plus several 2-way Yes/No checkbox pairs |
| `i129f-k1-crosswalk.js` | 34 | 26 | 4: `petitioner_info_gender`->2, `petitioner_info_maritalStatus`->4, `beneficiary_info_gender`->2, `beneficiary_info_maritalStatus`->4 |
| `i130-k3-crosswalk.js` | 33 | 25 | 4: same shape as K-1 (gender/maritalStatus checkbox groups) |

Fan-out is driven almost entirely by mutually-exclusive checkbox/radio groups, resolved per-widget
via each config's `checkboxMatch(source, value)` helper. This is exactly the shape the invariant
suite's "every crosswalk edge resolves to a real field, and re-running autofill doesn't diverge
per edge" checks target.

## 6. `USCISMappingVersion` "exactly one active per template"

No boolean `isActive` field — `status: enum["draft","needs_review","active","retired"]`
(`USCISMappingVersion.js:12`). The only uniqueness constraint is `{template, mappingVersion}`
**unique** (line 22); `{formCode, formVersion, status}` is a plain, non-unique query index. There
is **no DB-level partial-unique index** enforcing "at most one active version per template" —
the invariant is enforced purely at the application level by
`MappingGraphService.activate()` (`MappingGraphService.js:544-575`), which does a non-transactional
`updateMany({template, status:"active"}, {$set:{status:"retired"}})` followed by setting the new
version to `"active"`. A crash between those two writes could leave zero or multiple active
versions for one template. This is a real (if currently unexercised) risk, characterized-only —
see ledger entry P0-004 and the corresponding invariant test.

## 7. Visibility / conditional-field rules

`FormMappingService.isFieldVisible` resolves `MappingResolver.resolveConditionalRule` per field
before mapping — a field not currently visible is excluded from `filledData`/`fieldValues` for
that run rather than being mapped and hidden client-side. This means golden fixtures must capture
which fields were *present at all* in the output, not just their values, since an invisible field
legitimately has no entry.

## 8. Seeding — no reusable factory exists

There is no generic "build a Case + canonical profile + Answers" factory. The proven pattern
(used by all `*-golden-path.test.js` files) is: `Case.create({ caseNumber, visaType, user,
beneficiary, companyId, status: "active" })` with real `User`/`Beneficiary`/`Company` docs, then
`questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true })` +
`Questionnaire.findOne({ key, latestVersion: true })` + `questionnaireService.saveAnswers({
questionnaireId, caseId, answers }, { _id: userId, role: "client" }, req, "submitted")`. Golden
fixtures reuse this pattern (see `Backend/src/modules/form-generation/tests/phase0/goldenHarness.js`)
plus the pre-existing flat data objects in `Backend/src/test-utils/fixtures/{h1b,l1a,k1,k3}-golden.js`
— field names come from real code, per the anti-invention rule, not invented for Phase 0.

`Backend/src/test-utils/db.js`'s `PROTECTED_COLLECTIONS` (`USCISFormTemplate`,
`USCISMappingVersion`, `Questionnaire`, `Question`, `PackageDefinition`) already guard the master
data these fixtures depend on from being wiped by any test's cleanup — Phase 0 fixtures reuse
this guard rather than adding a new one.

## 9. Local environment quirk (harness-only workaround, not a pipeline change)

The user's in-progress, uncommitted S3-migration edits to `Backend/src/config/env.js` /
`Backend/src/modules/uploads/storage.service.js` make local permanent-storage resolution fall back
to `UPLOAD_DIR` (`./uploads`) when `LOCAL_STORAGE_PATH` is unset. The actual seeded government
template files live under `Backend/storage/...`, not `Backend/uploads/...`, so PDF generation
fails with `ENOENT` unless `LOCAL_STORAGE_PATH=./storage` is set explicitly. The Phase 0 harness
(`npm run phase0:verify`) sets this env var itself — no source file was touched. See
`PHASE0_RUN_JOURNAL.md` and ledger entry P0-002.

## 10. Existing test coverage this Phase 0 builds on (not duplicated)

- `Backend/src/modules/form-mapping/tests/{i129-l1a,i129f-k1,i130-k3}-crosswalk-coverage.test.js`
  — already exhaustively classify every real AcroForm field on the three templates into
  `mapped/manual_entry/out_of_scope/uscis_use_only` and ground every mapped edge against the real
  PDF and the real questionnaire field catalog. Phase 0's invariant suite asserts these still pass
  rather than re-implementing the same checks.
- `Backend/src/modules/h1b-e2e/tests/{h1b,k1,k3,l1a}-golden-path.test.js` — existing "does the
  pipeline produce the *correct* value" tests (four of five currently fail on real, pre-existing
  defects — see journal). Phase 0's golden fixtures are a different thing: they characterize
  *whatever the pipeline currently outputs*, correct or not, as a frozen baseline for drift
  detection, with defects tracked separately in the candidate-defect ledger rather than asserted
  away.
