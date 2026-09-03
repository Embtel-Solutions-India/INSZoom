// Single source of truth for "this PDF field must never be written to by
// this application" - consulted by BOTH PDFFieldMapper.mapFields() (first
// line of defense: the field must never even appear in mappedFields) and
// PDFRenderer.setFormField() (last line of defense: no pdf-lib mutation
// call, ever, even if a future mapping-layer bug reintroduces one).
//
// Root cause this exists to close (documented in full in Backend/docs/ISSUES.md):
// FormMappingService.normalizeMappings() falls back to a field's own scanned
// `defaultValue` as a legitimate "default" data source whenever no real
// crosswalk mapping exists for it. That fallback is correct for an ordinary
// field with no canonical source, but it also applies to USCIS-internal
// fields (PDF417 barcodes, signature fields) that are NEVER meant to have a
// canonical source in the first place - feeding a barcode's own pre-existing
// text back into caseForm.filledData as if it were resolved case data. From
// there PDFFieldMapper.mapFields() (no protected-field filtering) and
// PDFRenderer.setFormField()'s field.setText() (which unconditionally
// regenerates the field's appearance stream, destroying any embedded raster
// image) corrupt the field's authentic USCIS appearance. Confirmed
// empirically: every barcode field on every seeded USCIS template in this
// system currently receives a value through this exact path.
//
// Signal priority (verified against real imported templates, not assumed):
//   1. field.uscisUseOnly === true - an explicit per-field flag
//      FieldLabelEnrichmentService sets at import time. Authoritative when
//      present, but NOT populated on templates imported before that
//      enrichment existed (confirmed empirically: undefined on every
//      barcode field in the currently-seeded I-129/I-130/I-539/etc.
//      templates) - never assumed present, always falls through.
//   2. field.pdfFieldType === "signature" - PDFFieldScannerService already
//      distinguishes this via pdf-lib's own PDFSignature class (not a name
//      guess), and it IS reliably set on every imported template checked.
//   3. isUscisUseOnly(fieldName, formCode) - the existing, already-tested
//      function (FieldLabelEnrichmentService.js) combining the generic
//      PDF417 barcode pattern with each form's own authored crosswalk
//      USCIS_USE_ONLY_PATTERNS. Reused here, not duplicated - this is the
//      same signal that already keeps these fields out of the interactive
//      review UI (uscis-form.service.js's isReviewFacing), just never
//      previously consulted by the render/mapping pipeline.
//   4. A raw /barcode/i or /signature/i name-pattern match - the minimum
//      safety-net fallback, in case a field lacks both (1) stored metadata
//      and (2)/(3) a matching crosswalk entry (e.g. a form imported without
//      any authored crosswalk at all). Never the ONLY check relied on, but
//      always present as the final backstop.
const { isUscisUseOnly } = require("../../uscis-form-import/services/FieldLabelEnrichmentService");

const NAME_FALLBACK_PATTERNS = [/barcode/i, /signature/i];

// `templateField` is optional - PDFFieldMapper has the full scanned field
// object on hand (richest signal available); PDFRenderer's setFormField only
// has the flat pdfField name string, and still gets a fully correct answer
// via (3)/(4) alone.
function isProtectedField(pdfFieldName, formCode, templateField) {
  if (templateField?.uscisUseOnly === true) return true;
  if (templateField?.pdfFieldType === "signature" || templateField?.fieldType === "signature") return true;
  if (isUscisUseOnly(pdfFieldName, formCode)) return true;
  return NAME_FALLBACK_PATTERNS.some((pattern) => pattern.test(String(pdfFieldName || "")));
}

module.exports = { isProtectedField };
