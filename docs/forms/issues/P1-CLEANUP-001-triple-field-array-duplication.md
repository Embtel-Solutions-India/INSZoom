### [P1-CLEANUP-001] Triple duplication of the per-field array on one ~15.7MB template document
- Date: 2026-08-20
- Area / file(s): `Backend/src/modules/uscis-form-import/services/USCISFormImporterService.js:320,330,341`
  (`formFields: scanResult.fields`, `definition.fields: scanResult.fields`,
  `pdfFieldMappings: pdfFieldMappings(scanResult.fields)`), `Backend/src/models/USCISFormTemplate.js`
- Category: data-consistency (storage efficiency, not a correctness defect)
- Symptom: the exact same `PDFFieldScannerService.scan()` field array is stored three times on
  one `USCISFormTemplate` document — verbatim at `formFields`, verbatim again at
  `definition.fields`, and a reshaped/mapping-oriented projection at `pdfFieldMappings`. This
  session independently re-measured the live I-129 template document at **15.72MB** (BSON size,
  via `bson.calculateObjectSize`) — only ~290KB of headroom under MongoDB's 16MB hard per-document
  ceiling (see `docs/forms/PHASE1_BASELINE.md`). This is the exact reason a `-definition`
  projection (`TEMPLATE_RENDER_EXCLUDE` and four inline equivalents) exists at every render/fill
  load site, and the exact reason this Phase explicitly forbids adding any new per-field array.
- Reproduction: inspect any seeded `USCISFormTemplate` document (e.g. I-129) and compare
  `formFields` vs `definition.fields` — byte-identical arrays, ~980 entries each, stored twice.
- Root cause: `USCISFormImporterService.importFromBuffer()` assigns `scanResult.fields` to both
  `formFields` (the field the rest of the codebase actually reads - render, fill, this Phase's
  reconciliation) and `definition.fields` (part of a larger `definition` object that also appears
  unused by the render/fill path, per the existing `-definition` exclusion projections already in
  place everywhere the template is loaded for those purposes).
- Causing action: not investigated via `git blame`/`git log -S` this session — likely present
  since `USCISFormImporterService`'s original authoring, not a recent regression.
- Impact: ~2x-3x storage inflation per template purely from duplication, directly contributing to
  the template document sitting this close to Mongo's 16MB ceiling, which in turn is the reason
  this phase and any future phase must treat "add a new per-field array" as forbidden by default.
  Deduplicating would recover meaningful headroom without changing any field semantics.
- Phase-1 handling: characterized-only, NOT fixed — deduplicating is **behavior-touching**
  (multiple services read `definition`/`definition.fields` today per the existing `-definition`
  exclusion projections' own existence as evidence something still reads it at least
  conditionally; removing it without auditing every read site risks breaking whatever still
  depends on it) and therefore requires its own gated, reviewed cleanup phase, not a Phase 1
  side-effect.
- Status: open
- Planned fix phase: a dedicated future cleanup phase. Fix approach: audit every remaining read of
  `template.definition`/`template.definition.fields` (starting from wherever `-definition`
  projections are NOT applied, since those call sites are the only ones that could still be
  reading it), remove the field once confirmed unused, and re-measure the document size drop
  (expect it to move well clear of the 16MB ceiling, restoring real headroom for legitimate future
  additions).
