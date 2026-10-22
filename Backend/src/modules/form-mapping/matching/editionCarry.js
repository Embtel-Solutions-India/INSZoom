// Phase 7.3 integration helpers. Both are GATED by FORM_PIPELINE_AUTONOMY (read only through config/formPipelineAutonomy.js):
//   off     nothing runs (the callers behave byte-for-byte as before);
//   shadow  the matcher runs and the DIFFERENCE from what the current code decided is logged; nothing is changed;
//   on      the matcher is applied, ONLY to what the current logic did not resolve.
// Neither helper ever throws into its caller: a matcher failure means "no extra match" (the current behavior).
const autonomy = require("../../../config/formPipelineAutonomy");
const { match, exactMatchConflicts } = require("./FieldMatcher");

const defaultLog = () => require("../../../utils/logger");

/**
 * Mapping carry-forward, pass 2b: edges that lost their target in BOTH the exact pass and the existing rename pass.
 * Returns an array parallel to `previousEdges`: null, or { target, similarity, matcher: { confidence, reasons } } (and adds the target to `claimed`).
 */
function matcherRenames({ previousEdges, exact, renames, targetFields, claimed, previousTemplate = null, previousGraph = null, formCode = null, mode = autonomy.mode(), log = defaultLog() }) {
  const none = previousEdges.map(() => null);
  if (mode === "off") return none;
  try {
    const lostIndexes = previousEdges.map((edge, index) => index).filter((index) => !exact[index] && !renames[index]);
    if (!lostIndexes.length) return none;
    const oldById = new Map();
    const oldByPdf = new Map();
    ((previousTemplate && previousTemplate.formFields) || []).forEach((field) => {
      const plain = field.toObject?.() || field;
      [plain.fieldId, plain.id].filter(Boolean).forEach((key) => oldById.set(String(key), plain));
      [plain.pdfFieldName, plain.fieldName].filter(Boolean).forEach((key) => oldByPdf.set(String(key), plain));
    });
    const graphNodes = new Map(((previousGraph && previousGraph.nodes && previousGraph.nodes.form) || []).map((node) => [String(node.fieldId), node]));
    const oldFields = lostIndexes.map((index) => {
      const edge = previousEdges[index];
      const stored = oldById.get(String(edge.targetFieldId)) || oldByPdf.get(String(edge.targetPdfField));
      const node = graphNodes.get(String(edge.targetFieldId)) || {};
      // the stored template field carries everything (geometry, options, help text); a graph node / edge only label, type, section and page
      return stored ? { ...stored, fieldId: `old:${index}` } : { fieldId: `old:${index}`, fieldName: edge.targetPdfField, label: edge.targetLabel || node.label, type: edge.targetType || node.type, section: edge.section || node.section, pageNumber: edge.pageNumber ?? node.pageNumber };
    });
    const unclaimed = targetFields.filter((field) => !claimed.has(field.targetFieldId)).map((field) => ({ ...field, fieldId: field.targetFieldId }));
    const { results } = match(oldFields, unclaimed);
    const byTarget = new Map(targetFields.map((field) => [field.targetFieldId, field]));
    const out = [...none];
    const wouldCarry = [];
    for (const result of results) {
      if (!result.newId || !["high", "medium"].includes(result.confidence)) continue;
      const index = Number(String(result.oldId).split(":")[1]);
      const target = byTarget.get(result.newId);
      if (!target || claimed.has(target.targetFieldId)) continue;
      wouldCarry.push({ from: previousEdges[index].targetPdfField, to: target.targetPdfField, confidence: result.confidence, reasons: result.reasons });
      if (mode === "on") {
        claimed.add(target.targetFieldId);
        out[index] = { target, similarity: Math.round(result.score * 100), matcher: { confidence: result.confidence, reasons: result.reasons } };
      }
    }
    log.warn?.(mode === "shadow" ? "field_matcher_shadow_carry_forward" : "field_matcher_carry_forward", { formCode, mode, currentlyLost: lostIndexes.length, wouldCarry: wouldCarry.length, sample: wouldCarry.slice(0, 10) });
    return out;
  } catch (error) {
    try { log.warn?.("field_matcher_failed", { formCode, error: error.message }); } catch { /* never throw */ }
    return none;
  }
}

// the all-pairs matching of an edition pair, computed ONCE per (old edition, new edition) and reused by every case form that moves between them
const prepared = new Map();
function prepareCaseMatch(oldTemplate, newTemplate) {
  const key = [oldTemplate._id, oldTemplate.updatedAt, newTemplate._id, newTemplate.updatedAt, (oldTemplate.formFields || []).length, (newTemplate.formFields || []).length].map(String).join("|");
  if (prepared.has(key)) return prepared.get(key);
  const oldFields = (oldTemplate.formFields || []).map((field) => field.toObject?.() || field);
  const newFields = (newTemplate.formFields || []).map((field) => field.toObject?.() || field);
  const { matched } = match(oldFields, newFields);
  const keyOf = (field) => [field.fieldId, field.id, field.fieldName, field.pdfFieldName, field.normalizedName].filter(Boolean);
  const newById = new Map();
  newFields.forEach((field) => keyOf(field).forEach((id) => newById.set(String(id), field)));
  const targetByOldKey = new Map();
  oldFields.forEach((field) => {
    const result = matched.get(field.fieldId || field.id || field.fieldName || field.pdfFieldName);
    const target = result && result.confidence === "high" ? newById.get(String(result.newId)) : null;
    if (target) keyOf(field).forEach((id) => targetByOldKey.set(String(id), target));
  });
  const entry = { targetByOldKey, conflicts: exactMatchConflicts(oldFields, newFields), oldKeys: oldFields.map((field) => field.fieldId || field.id || field.fieldName).filter(Boolean) };
  prepared.set(key, entry);
  if (prepared.size > 8) prepared.delete(prepared.keys().next().value);
  return entry;
}

/**
 * Case-form migration: wraps the CURRENT per-key matcher `current(path) -> newField | undefined`.
 *   off     returns `current` itself (identical function);
 *   shadow  returns `current`, after logging where the matcher would differ;
 *   on      returns a function that asks `current` first and, ONLY when it finds nothing, accepts a HIGH-confidence matcher result.
 * `conflicts` (exact-name pairs whose widget kind / option set changed, or whose help text changed) is returned for the caller; applying it (archiving the value instead of
 * carrying it) needs changes in the migration's planning step and is NOT done here.
 */
function wrapCaseMatcher({ current, oldTemplate, newTemplate, mode = autonomy.mode(), log = defaultLog() }) {
  const base = { match: current, conflicts: [], mode };
  if (mode === "off" || !oldTemplate || !newTemplate) return base;
  try {
    const entry = prepareCaseMatch(oldTemplate, newTemplate);
    if (mode === "shadow") {
      let fillsGap = 0;
      let differs = 0;
      entry.oldKeys.forEach((key) => {
        const viaMatcher = entry.targetByOldKey.get(String(key));
        if (!viaMatcher) return;
        const now = current(key);
        if (!now) fillsGap += 1;
        else if ((now.fieldId || now.id) !== (viaMatcher.fieldId || viaMatcher.id)) differs += 1;
      });
      log.warn?.("field_matcher_shadow_case_migration", { formCode: newTemplate.formCode, matcherWouldResolve: fillsGap, matcherDisagrees: differs, hardConflicts: entry.conflicts.filter((item) => item.severity === "hard").length, softConflicts: entry.conflicts.filter((item) => item.severity === "soft").length });
      return { ...base, conflicts: entry.conflicts };
    }
    return { match: (path) => current(path) || entry.targetByOldKey.get(String(path)) || undefined, conflicts: entry.conflicts, mode };
  } catch (error) {
    try { log.warn?.("field_matcher_failed", { error: error.message }); } catch { /* never throw */ }
    return base;
  }
}

module.exports = { matcherRenames, wrapCaseMatcher };
