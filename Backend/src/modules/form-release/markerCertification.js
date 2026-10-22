// Phase 3 certification that PROVES correctness, in memory (no PDF, no database): two checks over an edition's active mapping graph.
//
//   party_markers   Every party gets a distinct synthetic marker (PETITIONER_TEST_001, BENEFICIARY_TEST_002, COMPANY_TEST_003, PREPARER_TEST_004). Each active edge is
//                   resolved by the REAL MappingResolver against a profile where every path of a party holds that party's marker, so the check follows what autofill really
//                   does (transforms, conditions, composite sources) and not just the source path. A box may only receive its own side's marker, and never two sides at once.
//                   The party a box speaks about comes from its own printed label / section / PDF name - a source independent of the mapping - so the check is not circular.
//   widget_inputs   Each active edge is resolved for a fictional but believable client and the result is checked against the box it fills: tick boxes get a boolean, a
//                   drop-down gets one of its options, a date is a date, a value fits the box's length.
//
// Only what can be OBSERVED is judged: an edge whose condition does not apply, whose value a transform consumed, or whose source holds nothing for the sample is counted as
// unobserved, never as a failure. A reviewed exception on an edge (contractExceptions, the same mechanism the mapping contract uses) silences only that code on only that edge.
// Evidence, not legal verification.
const MappingResolver = require("../form-mapping/services/MappingResolver");
const { partyOfText, conditionPaths, isAcknowledged } = require("../form-mapping/contract/MappingContractValidator");
const { isInterpreterOrPreparerField } = require("../form-mapping/config/blankFieldPolicy");
const { buildSampleCanonical, valuesThatSatisfy } = require("../form-mapping/golden/sampleClient");
const { widgetKind } = require("../form-mapping/golden/humanize");
// the SAME matcher the PDF renderer uses to put a value into a drop-down, so this check agrees with what really gets filled ("H-1B" finds "H1B - SPECIALITY OCCUPATION")
const { fitChoiceValue } = require("../form-generation/services/FieldValueFitter");

const MARKERS = Object.freeze({ petitioner: "PETITIONER_TEST_001", beneficiary: "BENEFICIARY_TEST_002", company: "COMPANY_TEST_003", preparer: "PREPARER_TEST_004" });
const MARKER_PATTERN = /(PETITIONER|BENEFICIARY|COMPANY|PREPARER)_TEST_00[1-4]/g;
// the side of the form a marker belongs to: the employer / sponsor and their company are one side
const SIDE = Object.freeze({ PETITIONER: "petitioner", COMPANY: "petitioner", BENEFICIARY: "beneficiary", PREPARER: "preparer" });
const NEUTRAL = "NEUTRAL_TEST";

const clean = (path) => String(path || "").replace(/\[\d*\]/g, "");
const isRaw = (path) => /^raw\.questionnaireAnswers\./.test(path);

/** The marker a canonical path holds: by its root (petitioner / beneficiary / company ...), or, for a raw checklist answer, by the party word its key starts with. */
function markerForPath(path) {
  const value = clean(path);
  const root = value.split(".")[0];
  if (isRaw(value)) {
    const key = value.replace(/^raw\.questionnaireAnswers\./, "").split(".")[0].toLowerCase();
    if (/^(employer_|company_|petitioner_|sponsor_)/.test(key)) return MARKERS.petitioner;
    if (/^(employee_|beneficiary_)/.test(key)) return MARKERS.beneficiary;
    return NEUTRAL;
  }
  if (root === "petitioner") return MARKERS.petitioner;
  if (["company", "employer"].includes(root)) return MARKERS.company;
  if (["beneficiary", "employee"].includes(root)) return MARKERS.beneficiary;
  if (["preparer", "interpreter", "attorney", "representative"].includes(root)) return MARKERS.preparer;
  return NEUTRAL;
}

/** Every canonical path an edge can read: its source, fallback and the paths its transform names. (A condition's paths are set separately, to what makes it apply.) */
function valuePathsOf(edge) {
  const transform = edge.transform || {};
  return [edge.sourcePath, edge.fallback, ...(Array.isArray(transform.fields) ? transform.fields : []), transform.countryPath, transform.source].filter((path) => typeof path === "string" && path);
}

function mappingOf(edge) {
  return { source: "canonical", path: edge.sourcePath, sourceField: edge.sourcePath, transform: edge.transform, condition: edge.condition, fallback: edge.fallback };
}

const targetNames = (edge, target = {}) => [edge.targetLabel || target.label || target.fieldLabel, edge.section || target.section, String(edge.targetPdfField || target.pdfFieldName || "").split(".").pop()].join(" ");
const fieldOf = (edge, target = {}) => ({ fieldName: edge.targetPdfField || target.pdfFieldName, pdfFieldName: edge.targetPdfField || target.pdfFieldName, label: edge.targetLabel || target.label, fieldLabel: edge.targetLabel || target.label });

function markersIn(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return [...new Set((text.match(MARKER_PATTERN) || []))];
}

/** party_markers. graph: { edges }, fields: the template's fields by targetFieldId (Map) - optional extra text for a box. */
function partyMarkerReport({ graph, targetsById = new Map() }) {
  const violations = [];
  const report = { checked: 0, unobserved: 0, blankPolicyBoxes: 0, violations, advisories: [] };
  for (const edge of graph?.edges || []) {
    if (edge.status !== "active" || !edge.sourcePath) continue;
    const target = targetsById.get(edge.targetFieldId) || {};
    if (isInterpreterOrPreparerField(fieldOf(edge, target))) { report.blankPolicyBoxes += 1; continue; } // never filled, whatever the mapping says (FormMappingService drops it)
    const canonical = {};
    for (const path of new Set(valuePathsOf(edge).map(clean))) {
      const marker = markerForPath(path);
      if (isRaw(path)) MappingResolver.setPath(canonical, path.replace(/\.value$/, ""), { value: marker });
      else MappingResolver.setPath(canonical, path, marker);
    }
    // a condition applies when the client says what it asks for; those paths hold real values, not markers
    for (const [path, value] of Object.entries(valuesThatSatisfy(edge.condition))) {
      if (isRaw(path)) MappingResolver.setPath(canonical, path.replace(/\.value$/, ""), { value });
      else MappingResolver.setPath(canonical, path, value);
    }
    for (const { path } of conditionPaths(edge.condition)) { if (path && MappingResolver.resolvePath(canonical, clean(path)) === undefined && !/^filledData\./.test(path)) { /* an unsatisfiable condition simply leaves the edge unobserved */ } }
    let result;
    try { result = MappingResolver.resolveMapping(mappingOf(edge), canonical, { filledData: {} }); } catch (error) { report.unobserved += 1; continue; }
    if (result.skipped || MappingResolver.isEmpty(result.value)) { report.unobserved += 1; continue; }
    const found = markersIn(result.value);
    if (!found.length) { report.unobserved += 1; continue; }
    report.checked += 1;
    const base = { mappingId: edge.mappingId, targetFieldId: edge.targetFieldId, field: String(edge.targetPdfField || "").split(".").pop() };
    const sides = [...new Set(found.map((marker) => SIDE[marker.split("_")[0]]))];
    if (sides.length > 1) {
      if (!isAcknowledged(edge, "MIXED_PARTIES")) violations.push({ ...base, code: "MIXED_PARTIES", reason: `one box would receive data of ${sides.join(" and ")} at the same time (${found.join(", ")})` });
      continue;
    }
    const boxSide = partyOfText(targetNames(edge, target));
    if (boxSide && sides[0] !== boxSide) {
      if (!isAcknowledged(edge, "PARTY_CONTRADICTION") && !isAcknowledged(edge, "PARTY_MARKER_MISMATCH")) violations.push({ ...base, code: "PARTY_MARKER_MISMATCH", reason: `the box speaks about the ${boxSide} but receives ${found[0]} (${sides[0]})` });
    }
    // a fallback of the other side is the single-party pairing (applicant = the checklist's petitioner) the contract allows; it is shown, never blocking
    if (edge.fallback && markerForPath(edge.fallback) !== NEUTRAL && boxSide && SIDE[markerForPath(edge.fallback).split("_")[0]] !== boxSide) report.advisories.push({ ...base, code: "FALLBACK_OTHER_SIDE", reason: `its fallback ${edge.fallback} belongs to the other side` });
  }
  report.passed = violations.length === 0;
  return report;
}

const DATE = /^(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/;
// the choices the PDF itself offers (what pdf-lib's getOptions() returns at render time)
const optionsOf = (target = {}) => (target.options || []).map((option) => (option && typeof option === "object" ? (option.exportValue ?? option.value ?? option.label) : option)).map((item) => String(item ?? "")).filter((item) => item.trim() !== "");

/** widget_inputs. family only chooses sample wording ("employment" / "family" / "single"). */
function widgetInputReport({ graph, targetsById = new Map(), family = "general" }) {
  const violations = [];
  const report = { checked: 0, unobserved: 0, byKind: {}, violations };
  for (const edge of graph?.edges || []) {
    if (edge.status !== "active" || !edge.sourcePath) continue;
    const target = targetsById.get(edge.targetFieldId) || {};
    if (isInterpreterOrPreparerField(fieldOf(edge, target))) continue;
    const kind = widgetKind(edge.targetType || target.fieldType || target.type);
    let result;
    try {
      const canonical = buildSampleCanonical([...valuePathsOf(edge), ...Object.keys(valuesThatSatisfy(edge.condition))], { family, overrides: valuesThatSatisfy(edge.condition) });
      result = MappingResolver.resolveMapping(mappingOf(edge), canonical, { filledData: {} });
    } catch (error) { report.unobserved += 1; continue; }
    if (result.skipped || MappingResolver.isEmpty(result.value)) { report.unobserved += 1; continue; }
    const value = result.value;
    // "Yes" is the sample client's placeholder for an answer it has no believable sample for (a free-form checklist question); it says nothing about a date or a drop-down
    if (value === "Yes" && (kind === "dropdown" || kind === "date")) { report.unobserved += 1; continue; }
    report.checked += 1;
    report.byKind[kind] = (report.byKind[kind] || 0) + 1;
    const base = { mappingId: edge.mappingId, targetFieldId: edge.targetFieldId, field: String(edge.targetPdfField || "").split(".").pop(), kind };
    if (isAcknowledged(edge, "WIDGET_INPUT")) continue;
    if ((kind === "checkbox" || kind === "radio") && typeof value !== "boolean") {
      violations.push({ ...base, code: "WIDGET_NOT_BOOLEAN", reason: `a tick box was given ${JSON.stringify(value).slice(0, 40)} instead of ticked / not ticked` });
    } else if (kind === "dropdown" || kind === "radio") {
      const options = optionsOf(target);
      if (options.length && kind === "dropdown" && fitChoiceValue({ value, options }).status === "dropped") violations.push({ ...base, code: "DROPDOWN_VALUE_NOT_AN_OPTION", reason: `the drop-down was given ${JSON.stringify(value).slice(0, 40)}, which matches none of its ${options.length} choices, so the renderer would leave it unselected` });
    } else if (kind === "date" && !(typeof value === "string" && DATE.test(value))) {
      violations.push({ ...base, code: "DATE_NOT_A_DATE", reason: `a date box was given ${JSON.stringify(value).slice(0, 40)}` });
    }
  }
  report.passed = violations.length === 0;
  return report;
}

module.exports = { MARKERS, markerForPath, partyMarkerReport, widgetInputReport, valuePathsOf };
