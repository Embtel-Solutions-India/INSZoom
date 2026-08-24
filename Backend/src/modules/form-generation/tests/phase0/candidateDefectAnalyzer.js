// Phase 0 candidate-defect analyzer. READ-ONLY: takes an already-captured golden snapshot (see
// goldenHarness.js) plus the relevant crosswalk module and flags candidates for the human
// correctness gate (docs/forms/PHASE0_CANDIDATE_DEFECTS.md, §J.5 in the Phase 0 task spec). It
// does not fix anything and does not touch any pipeline file - it only reads a snapshot object
// and the crosswalk config module already used elsewhere in this codebase.

const BOOLEAN_LIKE = /^(yes|no|true|false|on|off|1|0)$/i;
const CHECKBOX_WIDGET_CLASSES = new Set(["PDFCheckBox", "PDFRadioGroup"]);

function widgetClassByName(pdfSnapshot) {
  const map = new Map();
  for (const [name, widgetClass] of pdfSnapshot.fields) map.set(name, widgetClass);
  return map;
}

/**
 * Candidate A/B: value-shape vs AcroForm widget-type mismatch. A checkbox/radio widget fed a
 * long free-text value (or vice versa, a text widget fed a bare boolean) is exactly the class of
 * defect ARCHITECTURE.md already flagged for manual overrides ("a non-boolean truthy string...
 * would render as checked") - this generalizes the check to every field the snapshot captured.
 */
function findWidgetShapeMismatches(snapshot) {
  const widgetClass = widgetClassByName(snapshot.pdfSnapshot);
  const findings = [];
  for (const [fieldName, value] of Object.entries(snapshot.pdfFieldValues)) {
    const cls = widgetClass.get(fieldName);
    if (!cls) continue;
    const isCheckboxLike = CHECKBOX_WIDGET_CLASSES.has(cls);
    if (isCheckboxLike && typeof value === "string" && value.length > 5 && !BOOLEAN_LIKE.test(value)) {
      findings.push({
        category: "type-mismatch",
        fieldName,
        widgetClass: cls,
        value,
        note: `Widget is ${cls} but was fed a long free-text value ("${value}"). PDFRenderer.setFormField applies plain JS truthiness (value ? check() : uncheck()) for checkbox/radio fields, so ANY non-empty string - not just "yes"/"true" - renders as checked. See docs/forms/ARCHITECTURE.md §4's manual-override finding, which this generalizes.`,
      });
    }
    if (!isCheckboxLike && cls === "PDFTextField" && typeof value === "boolean") {
      findings.push({
        category: "type-mismatch",
        fieldName,
        widgetClass: cls,
        value,
        note: `Widget is PDFTextField but was fed a bare boolean (${value}). Likely renders as the literal string "true"/"false" rather than the intended text.`,
      });
    }
  }
  return findings;
}

/**
 * Candidate C: crosswalk says a field is authored/"mapped" (i.e. a human reviewed it and gave it
 * a canonical source - see i129-h1b-crosswalk.js's classifyField), but at runtime no value ended
 * up in pdfFieldValues for it. Either the source path is wrong, the field wasn't visible for this
 * particular case (a legitimate false positive - see PHASE0_BASELINE.md §7), or the value
 * resolved to undefined/empty. Flagged for human triage, not assumed to be a bug.
 */
function findMappedEdgesWithNoRuntimeValue(snapshot, crosswalkModule) {
  const findings = [];
  for (const edge of crosswalkModule.MAPPED_EDGES) {
    if (!(edge.fieldName in snapshot.pdfFieldValues)) {
      findings.push({
        category: "unmapped-field",
        fieldName: edge.fieldName,
        source: edge.source,
        note: `Crosswalk edge exists (source="${edge.source}") but produced no value in this capture's filledData/pdfFieldValues. May be a legitimate conditional-visibility skip (PHASE0_BASELINE.md §7) or a broken source path - needs human triage, not assumed broken.`,
      });
    }
  }
  return findings;
}

/**
 * Candidate D: fan-out divergence. A canonical source feeding N mutually-exclusive checkbox/radio
 * pdfFields (PHASE0_BASELINE.md §5) should result in AT MOST ONE of those N widgets reading as
 * checked/selected for a given case. More than one checked at once means the underlying
 * condition-matching logic diverged per edge for the same source.
 */
function findFanOutDivergence(snapshot, crosswalkModule) {
  const bySource = new Map();
  for (const edge of crosswalkModule.MAPPED_EDGES) {
    if (!bySource.has(edge.source)) bySource.set(edge.source, []);
    bySource.get(edge.source).push(edge.fieldName);
  }
  const exportedByName = new Map(snapshot.pdfSnapshot.fields.map(([name, , exported]) => [name, exported]));
  const findings = [];
  for (const [source, fieldNames] of bySource.entries()) {
    if (fieldNames.length < 2) continue;
    const checkedCount = fieldNames.filter((name) => exportedByName.get(name) === true).length;
    if (checkedCount > 1) {
      findings.push({
        category: "fan-out-divergence",
        source,
        fieldNames,
        note: `${checkedCount} of ${fieldNames.length} mutually-exclusive widgets for source "${source}" are simultaneously checked in the generated PDF - expected at most 1.`,
      });
    }
  }
  return findings;
}

function analyze(snapshot, crosswalkModule) {
  return {
    visaKey: snapshot.visaKey,
    formCode: snapshot.formCode,
    widgetShapeMismatches: findWidgetShapeMismatches(snapshot),
    mappedEdgesWithNoRuntimeValue: findMappedEdgesWithNoRuntimeValue(snapshot, crosswalkModule),
    fanOutDivergence: findFanOutDivergence(snapshot, crosswalkModule),
  };
}

module.exports = { analyze, findWidgetShapeMismatches, findMappedEdgesWithNoRuntimeValue, findFanOutDivergence };
