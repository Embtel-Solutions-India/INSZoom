// Phase 1 (USCIS-forms re-architecture) reconciliation analyzer. READ-ONLY: cross-references the
// authoritative, already-persisted USCISFormTemplate.formFields (from PDFFieldScannerService, see
// docs/forms/PHASE1_BASELINE.md) against each crosswalk's hand-reviewed MAPPED_EDGES. Reports
// mismatches; never mutates formFields or a crosswalk config. Three classes, per the Phase 1 spec:
//   - unmapped-required-field: a real, required AcroForm field with no crosswalk mapping at all
//     (classifyField() says manual_entry/out_of_scope/uscis_use_only) -> always renders blank.
//   - dangling-mapping: a crosswalk edge whose target fieldName does not exist on the CURRENT
//     template's formFields (template PDF drift since the crosswalk was authored).
//   - semantic-type-mismatch: a mapped edge whose transform disagrees with the field's own
//     semanticType/pdfFieldType - the checkbox-truthiness class (P0-CD-004/ARCHITECTURE.md §4)
//     and the "date field with no date transform" class. Flagged as CANDIDATES for Phase 2's
//     semantic enforcement, not asserted as certainly wrong (a source may already be pre-formatted).

function reconcileForm({ formLabel, formFields, crosswalk }) {
  const byName = new Map(formFields.map((field) => [field.fieldName, field]));
  const mappedFieldNames = new Set(crosswalk.MAPPED_EDGES.map((edge) => edge.fieldName));

  const unmappedRequiredFields = [];
  for (const field of formFields) {
    const classification = crosswalk.classifyField(field);
    if (field.required && classification.status !== "mapped") {
      unmappedRequiredFields.push({ fieldName: field.fieldName, fieldId: field.fieldId, classification: classification.status, note: classification.note });
    }
  }

  const danglingMappings = [];
  for (const edge of crosswalk.MAPPED_EDGES) {
    if (!byName.has(edge.fieldName)) {
      danglingMappings.push({ fieldName: edge.fieldName, source: edge.source, note: "crosswalk edge target does not exist on the current template's formFields - template PDF may have drifted since this crosswalk was authored" });
    }
  }

  const semanticTypeMismatches = [];
  for (const edge of crosswalk.MAPPED_EDGES) {
    const field = byName.get(edge.fieldName);
    if (!field) continue; // already reported as dangling-mapping above
    const isCheckboxLike = field.pdfFieldType === "checkbox" || field.pdfFieldType === "radio";
    if (isCheckboxLike && edge.transform?.type !== "boolean") {
      semanticTypeMismatches.push({
        fieldName: edge.fieldName,
        source: edge.source,
        subclass: "checkbox-widget-without-boolean-transform",
        note: `Widget is pdfFieldType="${field.pdfFieldType}" but the crosswalk edge has no {transform:{type:"boolean"}} - PDFFieldMapper/PDFRenderer will apply plain-JS truthiness to whatever raw value the source resolves to. Same class as P0-CD-004 (docs/forms/PHASE0_CANDIDATE_DEFECTS.md) and the manual-override truthiness gap in ARCHITECTURE.md §4.`,
      });
    }
    if (field.semanticType === "date" && edge.transform?.type !== "date") {
      semanticTypeMismatches.push({
        fieldName: edge.fieldName,
        source: edge.source,
        subclass: "date-field-without-date-transform",
        note: `Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string).`,
      });
    }
  }

  return {
    formLabel,
    fieldCount: formFields.length,
    mappedEdgeCount: crosswalk.MAPPED_EDGES.length,
    unmappedRequiredFields,
    danglingMappings,
    semanticTypeMismatches,
  };
}

module.exports = { reconcileForm };
