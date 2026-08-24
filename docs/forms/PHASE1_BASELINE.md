# Phase 1 Baseline — Authority Chain, Serialization, and What Was Locked In

Phase 1 does not build a new AcroForm field dictionary. See
`docs/forms/issues/P1-000-dictionary-premise-retracted.md` for why an earlier attempt at this was
retracted. This document records what Phase 1 actually proved and locked in. See
`docs/forms/PHASE1_RUN_JOURNAL.md` for the chronological log and
`docs/forms/PHASE1_RECONCILIATION.md` for the mismatch report.

## 1. The authority chain (proof)

```
Blank government PDF (Backend/dev-assets/uscis/*.pdf)
  -> normalizePdf() [qpdf: object-streams disable, stream-data uncompress, decrypt,
     deterministic-id] (Backend/src/utils/normalizePdf.js)
  -> USCISFormImporterService.importFromBuffer() [normalizes ONCE at import, stores the
     NORMALIZED bytes at template.pdfStorageKey - PDFRenderer.loadTemplatePdf's own normalize
     call is a lazy backstop for pre-existing templates, not the primary path for new imports]
  -> PDFFieldScannerService.scan(normalizedBuffer) [THE authoritative AcroForm field dictionary:
     per field - pdfFieldType (raw widget kind), semanticType (inferred), pageNumber, coordinates
     {x,y,width,height,boundingBox,coordinateSystem}, widgets[] (per-widget geometry+flags+
     appearance), options ({label,value,exportValue} triples), pdfFlags (raw /Ff int), classified
     textFieldFlags/choiceFieldFlags/radioFieldFlags, required/readOnly/hidden]
  -> USCISFormImporterService.js:320  formFields: scanResult.fields   [PERSISTED verbatim]
  -> USCISFormTemplate.formFields[]   [the one authoritative store other code reads]
  -> uscis-form.service.js:normalizeField (565-589) / buildSections (602-632)
     interactive-form-review.service.js:buildFieldView (268-291)
     [ALL THREE spread `{ ...field, ... }` before adding their own keys - none of those keys
     collide with semanticType/pdfFieldType, so both survive unmodified]
  -> GET .../workspace and GET .../render JSON response, sections[].fields[]
  -> INSZoom/frontend/.../USCISFormRenderer.jsx: FieldInput/FieldOverlay
     [reads field.fieldType, field.options, field.coordinates||field.position verbatim - no
     client-side transform layer]
```

Every step was verified by direct source read this session (file:line citations in
`PHASE1_RUN_JOURNAL.md`'s serialization-probe entry). **The authoritative dictionary is
`USCISFormTemplate.formFields[]`. Nothing new needed to be built.**

## 2. Serialization finding (§F.0) — `semanticType` pass-through is a no-op

Traced `normalizeField`, `buildSections`, and `buildFieldView` in full. All three spread the
complete raw field object before layering their own additions; none of those additions overlap
`semanticType` or `pdfFieldType`. **Both fields already reach the workspace/render API response
today.** The one narrowed structure in the whole chain, `template.fieldIndex`
(`uscis-form.service.js:805-815`), is a separate lightweight lookup map, not the
`sections[].fields[]` array the renderer actually consumes — its narrower shape is irrelevant to
this finding.

**Conclusion: P1.2 (the conditional pass-through) is a no-op.** No code was added. This is
recorded as evidence, not assumed.

## 3. Why no new dictionary/array was built (the 16MB reason)

This session independently re-measured the real, seeded I-129 `USCISFormTemplate` document (after
fully reverting an earlier, incorrect attempt at this phase) via `bson.calculateObjectSize()`:

**15.72MB — only ~290KB of headroom under MongoDB's 16MB hard per-document ceiling.**

This is tighter than the previously-documented 15.10MB figure in `docs/forms/ARCHITECTURE.md`/
`PHASE0_BASELINE.md` (likely measured at an earlier point; not re-derived here, just noted as
drift). `formFields`, `definition.fields` (a byte-identical duplicate of `formFields`, see
`docs/forms/issues/P1-CLEANUP-001-triple-field-array-duplication.md`), and `pdfFieldMappings` (a
reshaped third copy) already coexist on this one document. A prior, unrelated change to this same
model already breached the 16MB ceiling once (`formFields.labelSource` exists specifically
because storing the raw `/TU` tooltip text for ~980 fields pushed a real template past it — see
the schema comment at `USCISFormTemplate.js`). Adding any new ~980-entry array — even a minimal
one — would repeat that exact failure with ~290KB to spare. `npm run phase1:verify`'s
no-new-array/doc-size guard enforces this going forward (fails if the schema gains an
`acroFieldDictionary`-shaped path, or if the I-129 template document grows beyond a small
tolerance over this session's measured baseline).

## 4. What was locked in (characterization tests)

`Backend/src/modules/uscis-form-import/tests/phase1.scan-lockin.test.js` (11 assertions across 8
tests) locks in, for the first time, scan output that `PDFFieldScannerService.test.js` did not
previously assert:
- `semanticType` inference (date/textarea/checkbox/radio/dropdown) on a small fixture PDF.
- `pdfFieldType` (raw widget kind) as distinct from `semanticType` — a text-widget DOB field has
  `pdfFieldType==="text"` but `semanticType==="date"`, exactly the distinction Phase 2's semantic
  enforcement will need.
- Geometry: `coordinates.{width,height,pageNumber,boundingBox,coordinateSystem}`, and per-widget
  `widgets[]` array (proven on a radio group with widgets split across two different pages).
- Flags: `pdfFlags` (raw `/Ff`), the Required bit, and the classified `textFieldFlags`/
  `choiceFieldFlags`/`radioFieldFlags` objects (including that each is `{}` when not applicable to
  that widget kind).
- Options as `{label, value, exportValue}` triples for radio/dropdown; `[]` for checkbox.
- Determinism: two scans of the same bytes produce identical output, proven both on the small
  fixture PDF and on the real, seeded I-129 template's actual stored PDF (980 fields) — see
  `docs/forms/issues/P1-001-scannedat-nondeterminism.md` for the one (expected, excluded)
  wall-clock exception.
- Persistence fidelity: the PERSISTED `formFields` on the real I-129 template (not just the
  in-memory `scan()` result) still carries `pageNumber`/`coordinates`/`pdfFlags`/`semanticType`/
  `options` — i.e. nothing the renderer or reconciliation needs is silently dropped by the Mongo
  round-trip.

## 5. Reconciliation summary

See `docs/forms/PHASE1_RECONCILIATION.md` for the full per-form tables. Headline:

| Form | Real fields | Mapped edges | unmapped-required | dangling-mapping | semantic-mismatch |
|---|---|---|---|---|---|
| I-129 (H-1B/L-1A) | 980 | 101 | 0 | 0 | 5 (all one root cause, see below) |
| I-129F (K-1) | 445 | 34 | 0 | 0 | 4 (same root cause) |
| I-130 (K-3) | 450 | 33 | 0 | 0 | 4 (same root cause) |

- **0 unmapped-required-field everywhere**: no AcroForm field with its `Required` flag actually
  set has zero crosswalk coverage. Note this check is a different, narrower signal than
  P0-CD-001 — USCIS PDFs generally do NOT set the `/Ff` Required bit even for logically-required
  fields like name/DOB, so this static check cannot and does not catch that class of gap; Phase
  0's runtime golden-fixture capture remains the tool that caught P0-CD-001.
- **0 dangling-mapping everywhere, including I-130**: this DISPROVES a hypothesis raised while
  scoping this phase — that P0-CD-001's missing petitioner/beneficiary name/DOB/birthplace fields
  might be caused by a crosswalk-fieldName-vs-real-template naming drift. All 10 of P0-CD-001's
  crosswalk edges resolve to real, present fields on the current I-130 template. **This confirms,
  independently and from a different angle, Phase 0's own conclusion**: the break is downstream
  in `FormMappingService`/`MappingResolver`'s field-resolution layer for those specific fields,
  not a naming/template-drift issue and not a canonical-data population gap. Phase 2 should start
  there, not re-check crosswalk-to-template naming.
- **13 semantic-type-mismatch findings, all one root cause**: every one is the
  `date-field-without-date-transform` subclass, and every one traces to a single pre-existing bug
  in the scanner's own semantic inference — see `docs/forms/issues/P1-002-semantictype-inference-false-positives.md`.
  **Zero** `checkbox-widget-without-boolean-transform` findings — every checkbox/radio edge across
  all three crosswalks correctly applies the boolean-condition pattern; this dimension is clean.

## 6. Cross-links

- `docs/forms/PHASE1_RUN_JOURNAL.md` — chronological log, the Atlas-accident writeup, and the §F.0
  scope confirmation.
- `docs/forms/PHASE1_RECONCILIATION.md` — full per-form reconciliation tables.
- `docs/forms/issues/P1-000-dictionary-premise-retracted.md` — the retraction.
- `docs/forms/issues/P1-001-scannedat-nondeterminism.md` — the one expected, excluded volatile field.
- `docs/forms/issues/P1-002-semantictype-inference-false-positives.md` — the scanner regex bug behind all 13 semantic-mismatch findings.
- `docs/forms/issues/P1-LOG-001-invalid-object-ref-flood.md`, `P1-LOG-002-sort-memory-limit.md`,
  `P1-CLEANUP-001-triple-field-array-duplication.md` — out-of-scope tickets, recorded not fixed.
- `docs/forms/PHASE0_CANDIDATE_DEFECTS.md` (P0-CD-001, P0-CD-004) — cross-referenced above.
