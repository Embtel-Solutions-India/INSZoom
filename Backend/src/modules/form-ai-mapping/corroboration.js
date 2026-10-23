// What may lift a RISKY box (address block, tick box, drop-down, repeating, conditional, SSN / A-number, other party) from needs_review to auto_use (plan decision 3): a trusted
// SIBLING-FORM mapping, or a VERIFIED golden fixture. Both must name the SAME path the model chose; both also hand over the transform / condition of the mapping they stand for,
// because a tick box or a drop-down needs more than a path.
//   sibling form   at least two OTHER live forms map a box with the same kind and the same normalized label to that path, no live form maps it anywhere else, and none of
//                  those edges is itself an AI edge (an AI result never corroborates an AI result)
//   golden fixture an entry of the signed-off golden set for this exact form + box whose answer is "right" / "keep blank" (a verified answer) and whose wording is current
// Both lookups are cached in memory and injectable; any failure means "not corroborated" (fail closed).
const path = require("path");
const { widgetKind } = require("../form-mapping/golden/humanize");

const TTL_MS = 10 * 60 * 1000;
const normalizeLabel = (text) => String(text || "").toLowerCase().replace(/^(part|item|line)\s*\d+[a-z]?[.:)\-\s]*/i, "").replace(/\b(enter|select|type|provide)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
let siblingCache = null;
let goldenCache = null;

/** Map("<kind>|<normalized label>" -> Map(path -> { forms:Set, transform, condition })) over the active, non-AI edges of every live form except `excludeFormCode`. */
async function buildSiblingIndex(excludeFormCode, { Template = require("../../models/USCISFormTemplate"), Version = require("../../models/USCISMappingVersion") } = {}) {
  const index = new Map();
  const templates = await Template.find({ status: "active", formCode: { $ne: excludeFormCode } }).select("_id formCode").lean();
  for (const template of templates) {
    const version = await Version.findOne({ template: template._id, status: "active" }).sort({ mappingVersion: -1 }).select("graph.edges.status graph.edges.origin graph.edges.sourcePath graph.edges.targetLabel graph.edges.targetType graph.edges.transform graph.edges.condition").lean();
    for (const edge of version?.graph?.edges || []) {
      if (edge.status !== "active" || edge.origin === "ai" || !edge.sourcePath || !edge.targetLabel || /^raw\./.test(edge.sourcePath)) continue;
      const key = `${widgetKind(edge.targetType)}|${normalizeLabel(edge.targetLabel)}`;
      if (key.endsWith("|")) continue;
      const paths = index.get(key) || new Map();
      const entry = paths.get(edge.sourcePath) || { forms: new Set(), transform: edge.transform, condition: edge.condition };
      entry.forms.add(template.formCode);
      paths.set(edge.sourcePath, entry);
      index.set(key, paths);
    }
  }
  return index;
}

async function siblingCorroboration({ field, candidatePath, excludeFormCode, deps = {} }) {
  const now = Date.now();
  if (!siblingCache || siblingCache.excludeFormCode !== excludeFormCode || now - siblingCache.at > TTL_MS) siblingCache = { excludeFormCode, at: now, index: await (deps.buildSiblingIndex || buildSiblingIndex)(excludeFormCode) };
  const paths = siblingCache.index.get(`${widgetKind(field.type)}|${normalizeLabel(field.label || field.fieldLabel)}`);
  if (!paths) return null;
  const agreeing = paths.get(candidatePath);
  if (!agreeing || agreeing.forms.size < 2) return null;
  if ([...paths.keys()].some((other) => other !== candidatePath)) return null; // the live forms do not all agree
  return { source: "sibling_form", path: candidatePath, transform: agreeing.transform, condition: agreeing.condition, forms: [...agreeing.forms] };
}

/** Verified golden entries by "<formCode>|<targetFieldId>" -> { path, transform, condition }. */
async function loadGolden({ draft = require("../form-mapping/golden/goldenSet.draft.json"), Review = require("../../models/GoldenSetReview") } = {}) {
  const reviews = await Review.find({ verdict: { $in: ["right", "blank"] } }).select("entryId contentHash verdict").lean();
  const valid = new Map(reviews.map((review) => [`${review.entryId}|${review.contentHash}`, review]));
  const verified = new Map();
  for (const entry of draft.entries || []) {
    if (!valid.has(`${entry.id}|${entry.contentHash}`) || !entry.technical?.targetFieldId || !entry.technical.sourcePath) continue;
    verified.set(`${entry.formCode}|${entry.technical.targetFieldId}`, { path: entry.technical.sourcePath, transform: entry.technical.transform, condition: entry.technical.condition });
  }
  return verified;
}

async function goldenCorroboration({ formCode, field, candidatePath, deps = {} }) {
  const now = Date.now();
  if (!goldenCache || now - goldenCache.at > TTL_MS) goldenCache = { at: now, verified: await (deps.loadGolden || loadGolden)() };
  const fixture = goldenCache.verified.get(`${formCode}|${field.targetFieldId}`);
  return fixture && fixture.path === candidatePath ? { source: "golden_fixture", path: candidatePath, transform: fixture.transform, condition: fixture.condition } : null;
}

/** null when nothing corroborates; otherwise { source, path, transform, condition }. Never throws. */
async function corroborate({ formCode, field, candidatePath, deps = {} }) {
  try {
    return (await goldenCorroboration({ formCode, field, candidatePath, deps })) || (await siblingCorroboration({ field, candidatePath, excludeFormCode: formCode, deps }));
  } catch {
    return null;
  }
}

const resetCaches = () => { siblingCache = null; goldenCache = null; };

module.exports = { corroborate, buildSiblingIndex, loadGolden, normalizeLabel, resetCaches };
