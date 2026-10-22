// Phase 2, Rule A - ONE mapping policy. Pure: it never touches a database; MappingGraphService / the projections call it.
//
// Where an edge came from (`origin`) decides how far it can be trusted and who may replace it:
//   authored  - hand-authored crosswalks and verified party rules                               rank 1
//   legacy    - edges that were already live before origins existed (reviewed in practice)      rank 2   (preserved; never bulk-deactivated)
//   inferred  - deterministic inference from the PDF's own field names that passed validation    rank 3
//   ai        - a Gemini suggestion that was independently validated                             rank 4
//   scored    - a lexical / score-based suggestion                                               rank 5   (review only, never auto-active for NEW writes)
// A lower-ranked edge never overwrites a higher-ranked one; the attempt is recorded in `conflicts[]`. Only `active` edges are projected to autofill.
const ORIGINS = Object.freeze(["authored", "legacy", "inferred", "ai", "scored"]);
const RANK = Object.freeze({ authored: 1, legacy: 2, inferred: 3, ai: 4, scored: 5 });
const EDGE_STATUSES = Object.freeze(["active", "needs_review", "rejected"]);
// origins whose NEW edges may never go live on their own: they are review suggestions until a person (or a higher-ranked source) approves them
const NEVER_AUTO_ACTIVE = Object.freeze(["scored", "ai"]);

/** The origin of an edge; an edge written before origins existed is `legacy`. Unknown values are `legacy` too (never trusted more than that). */
const originOf = (edge) => (ORIGINS.includes(edge?.origin) ? edge.origin : "legacy");
const rankOf = (origin) => RANK[ORIGINS.includes(origin) ? origin : "legacy"];

/** Only `active` edges are projected to autofill - the one rule both projections apply. An edge without a status is NOT projected. */
const isProjectable = (edge) => Boolean(edge) && edge.status === "active";

/** May `incoming` replace `existing` for the same target field? Equal or higher priority may; lower may not. */
function canReplace(existing, incoming) {
  if (!existing) return { allowed: true };
  const have = originOf(existing);
  const want = originOf(incoming);
  if (rankOf(want) <= rankOf(have)) return { allowed: true };
  return { allowed: false, reason: `a ${want} edge cannot replace an ${have} edge`, existingOrigin: have, incomingOrigin: want };
}

/**
 * A NEW edge of a never-auto-active origin that asks to be active is stored as needs_review instead (never silently trusted). Returns the edge to store; the
 * original object is not modified.
 */
function admitNewEdge(edge) {
  const origin = originOf(edge);
  // Phase 4: the ONE narrow exception. An "ai" edge may be active only when the Gemini mapping engine itself marked it validated AND in the auto_use tier (an unambiguous,
  // low-risk mapping - or one a sibling form / a verified golden fixture corroborates - that passed every independent code check). Every other ai edge is still review-only.
  const aiValidated = origin === "ai" && edge.evidence?.aiValidated === true && edge.evidence?.tier === "auto_use";
  if (NEVER_AUTO_ACTIVE.includes(origin) && edge.status === "active" && !aiValidated) {
    return { ...edge, status: "needs_review", evidence: { ...(edge.evidence || {}), downgradedFrom: "active", reason: `${origin} suggestions are review-only` } };
  }
  return edge;
}

/**
 * Stamps origins on a graph about to be stored and enforces "lower never overwrites higher" against the graph that is live now.
 *   - an edge with no origin: if the live graph has the same target+source it inherits that edge's origin, otherwise it is `legacy` (provenance unknown)
 *   - a new edge for a target whose live edge outranks it, with a DIFFERENT source: the live edge is kept, the attempt goes to `conflicts[]`
 * Never removes an edge that has no competitor and never changes a status of an existing edge. Returns { graph, conflicts, stamped }.
 */
function reconcile(previousGraph, nextGraph) {
  const previousByTarget = new Map((previousGraph?.edges || []).map((edge) => [edge.targetFieldId, edge]));
  const conflicts = [];
  let stamped = 0;
  const edges = (nextGraph.edges || []).map((edge) => {
    const previous = previousByTarget.get(edge.targetFieldId);
    let current = edge;
    if (!ORIGINS.includes(edge.origin)) {
      const inherited = previous && previous.sourcePath === edge.sourcePath ? originOf(previous) : "legacy";
      current = { ...edge, origin: inherited };
      stamped += 1;
    }
    if (previous && previous.sourcePath !== current.sourcePath && isProjectable(previous)) {
      const verdict = canReplace(previous, current);
      if (!verdict.allowed) {
        conflicts.push({ targetFieldId: current.targetFieldId, kept: { mappingId: previous.mappingId, sourcePath: previous.sourcePath, origin: originOf(previous) }, rejected: { mappingId: current.mappingId, sourcePath: current.sourcePath, origin: originOf(current) }, reason: verdict.reason });
        return previous;
      }
    }
    return current;
  });
  const graph = { ...nextGraph, edges };
  if (conflicts.length) graph.conflicts = [...(nextGraph.conflicts || []), ...conflicts];
  return { graph, conflicts, stamped };
}

/** Counts per origin and status (for reports). */
function summarize(graph) {
  const byOrigin = {};
  const byStatus = {};
  for (const edge of graph?.edges || []) {
    byOrigin[originOf(edge)] = (byOrigin[originOf(edge)] || 0) + 1;
    byStatus[edge.status || "(none)"] = (byStatus[edge.status || "(none)"] || 0) + 1;
  }
  return { byOrigin, byStatus };
}

module.exports = { ORIGINS, RANK, EDGE_STATUSES, NEVER_AUTO_ACTIVE, originOf, rankOf, isProjectable, canReplace, admitNewEdge, reconcile, summarize };
