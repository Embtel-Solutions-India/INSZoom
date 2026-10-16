// Phase 2: when a new edition renames a form field, an old mapping edge may follow it ONLY if the new field is provably the same thing (plan: "equivalence
// required"). The weak FieldDiffService.similarity (shared characters) is used to FIND candidates; this module decides whether a candidate is accepted. Pure.
// A rename is accepted only when ALL hold:
//   - the field type is the same
//   - the printed label is the same text once case, punctuation and the "Item N:" numbering are ignored (or one is the other plus numbering words)
//   - the section is the same where both editions state one
//   - it is the ONLY such candidate (two equal candidates are ambiguous and are never guessed)
// An accepted rename is carried as needs_review (a person confirms it), never active.
const FieldDiffService = require("../../uscis-lifecycle/services/FieldDiffService");

const clean = (value) => String(value ?? "")
  .toLowerCase()
  .replace(/\b(item|line|part|page)\s*\d+[a-z]?\.?\d*\s*[:.\-)]?/g, " ")
  .replace(/\bpt\d+\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const typeOf = (field) => String(field?.type || field?.fieldType || "text").toLowerCase();
const labelOf = (field) => field?.label || field?.targetLabel || field?.fieldLabel || "";
// a section keeps its "Part N" (Part 1 and Part 4 are different places); only case and punctuation are ignored
const sectionOf = (field) => String(field?.section || field?.sectionTitle || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Is `candidate` provably the same field as the (old) edge's target? */
function equivalent(oldTarget, candidate) {
  if (typeOf(oldTarget) !== typeOf(candidate)) return { ok: false, reason: "different field type" };
  const oldLabel = clean(labelOf(oldTarget));
  const newLabel = clean(labelOf(candidate));
  if (!oldLabel || !newLabel) return { ok: false, reason: "a label is missing" };
  if (oldLabel !== newLabel) return { ok: false, reason: "different label" };
  const oldSection = sectionOf(oldTarget);
  const newSection = sectionOf(candidate);
  if (oldSection && newSection && oldSection !== "general" && newSection !== "general" && oldSection !== newSection) return { ok: false, reason: "different section" };
  return { ok: true };
}

/**
 * For an old edge whose target is gone: the single provably-equivalent unclaimed field of the new edition, or null.
 *   oldTarget  { label, type, section }  - taken from the edge (targetLabel / targetType / section)
 *   candidates the new edition's fields not yet claimed by another edge (each with targetFieldId, label, type, section)
 * Returns { target, similarity } or { ambiguous: [...] } or null.
 */
function findRenamedTarget(oldTarget, candidates) {
  const matches = candidates.filter((candidate) => equivalent(oldTarget, candidate).ok);
  if (matches.length === 1) {
    return { target: matches[0], similarity: Math.round(FieldDiffService.similarity(labelOf(oldTarget), labelOf(matches[0])) * 100) };
  }
  if (matches.length > 1) return { ambiguous: matches.map((match) => match.targetFieldId) };
  return null;
}

module.exports = { equivalent, findRenamedTarget, clean };
