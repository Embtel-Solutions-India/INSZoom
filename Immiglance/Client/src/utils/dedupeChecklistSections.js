// Display-only dedupe for the checklist. Never mutates/deletes source data —
// this only filters the already-fetched, already-built section list right
// before render. Collisions are logged (not silently dropped) so a real
// template issue surfaces for review.
//
// Keyed by CANONICAL identity, not display label: a reusable document's own
// `docId`, or a questionnaire file-question's `documentType`/question key.
// Label alone is not a safe key — real checklists legitimately reuse the
// same generic label for two different documents (e.g. L-1A's employer
// checklist has a "Lease" for the U.S. company AND a separate "Lease" for
// the foreign company; "Company Website" and "Brochure" repeat the same
// way) — those are two distinct required documents, not a duplicate, and
// label-based dedupe was silently discarding the second one. Only items that
// share the same canonical id (or, absent one, an identical label with no
// id at all — e.g. two field questions that are genuinely the same
// question) are ever collapsed.
function canonicalKey(item) {
  const docId = item.docId || item.question?.metadata?.documentType || item.question?.key;
  if (docId) return `id:${String(docId).trim().toLowerCase()}`;
  const label = String(item.label || "").trim().toLowerCase();
  return label ? `label:${label}` : null;
}

export function dedupeSectionsByLabel(sections) {
  const seen = new Set();
  const collisions = [];
  const deduped = sections.map((section) => {
    const items = section.items.filter((item) => {
      const key = canonicalKey(item);
      if (!key) return true;
      if (seen.has(key)) {
        collisions.push(item.label);
        return false;
      }
      seen.add(key);
      return true;
    });
    return { ...section, items };
  }).filter((section) => section.items.length > 0);

  if (collisions.length) {
    console.warn("[Documents] Duplicate checklist items collapsed by canonical id (source template should not repeat these):", collisions);
  }
  return deduped;
}
