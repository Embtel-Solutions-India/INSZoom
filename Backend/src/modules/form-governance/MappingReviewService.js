// Phase 5 governance: the read-only queue of mapping edges that wait for a person (status needs_review), across the newest mapping version of every form edition that still has
// one. It never changes a mapping: deciding an edge belongs to the mapping screens.
const MAX_ITEMS = 1000;

const defaultModels = () => ({ MappingVersion: require("../../models/USCISMappingVersion") });

const edgeLabel = (edge) => edge.targetLabel || edge.label || edge.targetPdfField || edge.targetFieldId || null;

/** Pure. One needs_review edge -> a queue item. */
function presentEdge(version, edge) {
  const reasons = [
    ...(Array.isArray(edge.evidence?.reasons) ? edge.evidence.reasons : []),
    ...(edge.evidence?.reason ? [edge.evidence.reason] : []),
    ...(edge.evidence?.downgradedFrom ? [`downgraded from ${edge.evidence.downgradedFrom}`] : []),
  ].map(String);
  return {
    formCode: version.formCode,
    templateId: String(version.template),
    mappingVersion: version.mappingVersion,
    targetFieldId: edge.targetFieldId || null,
    targetPdfField: edge.targetPdfField || null,
    label: edgeLabel(edge),
    section: edge.section || null,
    sourcePath: edge.sourcePath || null,
    origin: edge.origin || null,
    status: edge.status,
    evidence: edge.evidence || null,
    reasons: Array.from(new Set(reasons)),
  };
}

/** Pure. Mapping versions (lean, with graph.edges) -> queue items (needs_review edges only). */
function buildQueue(versions = []) {
  const items = [];
  for (const version of versions) {
    for (const edge of version.graph?.edges || []) {
      if (edge?.status === "needs_review") items.push(presentEdge(version, edge));
    }
  }
  return items;
}

/**
 * formCode (optional) narrows the queue to one form. Only the newest ACTIVE or needs_review / draft version per template is read (a retired version is history).
 * Returns { total, items }.
 */
async function mappingReviewQueue({ formCode, models = defaultModels(), limit = MAX_ITEMS } = {}) {
  const { MappingVersion } = models;
  const filter = { status: { $in: ["active", "needs_review", "draft"] }, ...(formCode ? { formCode: String(formCode).toUpperCase() } : {}) };
  const rows = await MappingVersion.find(filter).sort({ formCode: 1, mappingVersion: -1 }).select("formCode template mappingVersion status graph.edges").lean();
  // newest version per template
  const newest = new Map();
  for (const row of rows) if (!newest.has(String(row.template))) newest.set(String(row.template), row);
  const all = buildQueue([...newest.values()]);
  return { total: all.length, items: all.slice(0, limit) };
}

module.exports = { mappingReviewQueue, buildQueue, presentEdge };
