// "Keep blank": a person decides a form box must stay EMPTY (no information is ever stored in it). The decision lives on the mapping graph as `graph.keepBlank`
// (a list, one entry per box) and wins over every automatic writer: scoring, inference, party rules, edition carry-forward and a template's own default value.
// Pure functions only.

const idOf = (field = {}) => field.targetFieldId || field.fieldId || field.id || field.fieldName;

/** Set of the target field ids kept blank in a graph. */
function keepBlankSet(graph = {}) {
  return new Set((graph.keepBlank || []).map((entry) => entry.targetFieldId).filter(Boolean));
}

/**
 * Removes every edge that targets a kept-blank box and takes those boxes out of `unmappedTargets` (a deliberately empty box is not a gap). Returns a new graph;
 * `removed` lists what was dropped so the caller can record it.
 */
function enforceKeepBlank(graph = {}) {
  const blank = keepBlankSet(graph);
  if (!blank.size) return { graph, removed: [] };
  const removed = (graph.edges || []).filter((edge) => blank.has(edge.targetFieldId));
  return {
    removed,
    graph: {
      ...graph,
      edges: (graph.edges || []).filter((edge) => !blank.has(edge.targetFieldId)),
      unmappedTargets: (graph.unmappedTargets || []).filter((target) => !blank.has(typeof target === "string" ? target : target?.targetFieldId)),
    },
  };
}

/**
 * Marks (or unmarks) one box. Marking removes any mapping the box had; unmarking just takes it off the list (the box is then unmapped again and can be mapped).
 * `field` is the target template field; `by` / `at` record who and when.
 */
function setKeepBlank(graph = {}, field = {}, { keepBlank = true, reason = "", by, at = new Date() } = {}) {
  const targetFieldId = idOf(field);
  const others = (graph.keepBlank || []).filter((entry) => entry.targetFieldId !== targetFieldId);
  if (!keepBlank) return { ...graph, keepBlank: others };
  const entry = { targetFieldId, targetPdfField: field.targetPdfField || field.pdfFieldName, label: field.label, section: field.section, pageNumber: field.pageNumber, reason: String(reason || "").trim().slice(0, 500), by, at };
  return enforceKeepBlank({ ...graph, keepBlank: [...others, entry] }).graph;
}

/** Carries the kept-blank boxes of a previous edition onto the matching boxes of a new one (same PDF name or id; a box that no longer exists is dropped). */
function carryKeepBlank(previousGraph = {}, targetFields = [], norm = (value) => String(value || "").toLowerCase()) {
  const byPdf = new Map(targetFields.map((field) => [norm(field.targetPdfField), field]));
  const byId = new Map(targetFields.map((field) => [norm(idOf(field)), field]));
  const seen = new Set();
  const carried = [];
  for (const entry of previousGraph.keepBlank || []) {
    const target = byPdf.get(norm(entry.targetPdfField)) || byId.get(norm(entry.targetFieldId));
    const id = target && idOf(target);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    carried.push({ ...entry, targetFieldId: id, targetPdfField: target.targetPdfField || entry.targetPdfField, label: target.label || entry.label, section: target.section ?? entry.section, pageNumber: target.pageNumber ?? entry.pageNumber });
  }
  return carried;
}

module.exports = { keepBlankSet, enforceKeepBlank, setKeepBlank, carryKeepBlank };
