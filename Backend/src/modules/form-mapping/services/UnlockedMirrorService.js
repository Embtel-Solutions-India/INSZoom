// Boxes USCIS marks read-only are now fillable (uscis-forms/field-lock-policy.js). Many of them are COPIES of a box on another page - the A-Number or the name
// repeated at the top of every continuation page ("This field pre-populates from page 1"). When the form already maps one box of that name to a canonical
// path, its copies are the same fact, so they get the same edge: the value flows into every copy and an edit in any of them updates the same canonical value.
//
// Conservative by design - an edge is copied only when
//   * the box is one the policy unlocks (never a signature or barcode) and has no edge of its own,
//   * every box of the same field name on the form that already has an edge points to ONE canonical source with the same transform and condition,
//   * that edge is active, its source is a canonical path (never a raw questionnaire answer key - those are not generic), and it is TRUSTED: part of the
//     mapping version that is live, or created by this very run from an authored rule - an unreviewed draft edge is never copied.
// Nothing existing is changed or removed; the result is added to the mapping version PartyFieldMappingService is already building.
const { keepsLock } = require("../../uscis-forms/field-lock-policy");

const stemOf = (pdfField) => String(pdfField || "").split(".").pop().replace(/\[\d+\]$/, "").toLowerCase();
const sameEdge = (left, right) => left.sourcePath === right.sourcePath
  && JSON.stringify(left.transform || null) === JSON.stringify(right.transform || null)
  && JSON.stringify(left.condition || null) === JSON.stringify(right.condition || null);

function isUnlockedField(target) {
  return Boolean(target.readOnly || target.readonly)
    && !keepsLock({ ...target, fieldType: target.fieldType || target.type, pdfFieldType: target.pdfFieldType });
}

// cheap check on the template alone (no graph needed): is there any unlocked box that shares its name with another box?
function hasCandidates(template) {
  const fields = template?.formFields || [];
  const counts = new Map();
  fields.forEach((field) => { const stem = stemOf(field.pdfFieldName || field.fieldName); counts.set(stem, (counts.get(stem) || 0) + 1); });
  return fields.some((field) => (field.readOnly || field.readonly) && counts.get(stemOf(field.pdfFieldName || field.fieldName)) > 1);
}

// targets: MappingGraphService.getTemplateFields(template); out: the edges being built (mutated: new edges are appended)
// isTrusted(edge) -> boolean: may this edge be copied? (defaults to: any edge)
function addMirrorEdges({ formCode, version, editionDate }, targets, out, report, isTrusted = () => true) {
  const bySiblingStem = new Map();
  out.forEach((edge) => {
    const stem = stemOf(edge.targetPdfField);
    bySiblingStem.set(stem, [...(bySiblingStem.get(stem) || []), edge]);
  });
  const has = new Set(out.map((edge) => edge.targetFieldId));
  let added = 0;
  for (const target of targets) {
    if (has.has(target.targetFieldId) || /PDF417|barcode/i.test(target.targetPdfField) || !isUnlockedField(target)) continue;
    const siblings = bySiblingStem.get(stemOf(target.targetPdfField));
    if (!siblings || !siblings.length) continue;
    const [first] = siblings;
    if (!siblings.every((edge) => sameEdge(edge, first)) || !siblings.every(isTrusted)) continue;
    if (first.status !== "active" || !first.sourcePath || String(first.sourcePath).startsWith("raw.")) continue;
    out.push({
      ...first,
      mappingId: `${formCode}:${version}:${target.targetFieldId}`,
      editionDate,
      version,
      targetFieldId: target.targetFieldId,
      targetPdfField: target.targetPdfField,
      targetLabel: target.label,
      targetType: target.type,
      section: target.section,
      pageNumber: target.pageNumber,
      note: `Copy of ${String(first.targetPdfField).split(".").pop()} (the same box on another page): ${first.sourcePath}`,
      origin: "mirror",
      createdAt: new Date(),
    });
    has.add(target.targetFieldId);
    added += 1;
  }
  if (report) report.mirrored = (report.mirrored || 0) + added;
  return added;
}

module.exports = { addMirrorEdges, hasCandidates, isUnlockedField };
