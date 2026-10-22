// Phase 7.4 - the per-field inventory of ONE exact form edition (owner decision D1: every field has an explicit class with a stated reason; NO percentage score).
// Pure: build() reads plain objects (the edition's fields, the active mapping graph, the previous edition when there is one) and returns the inventory; nothing is
// written anywhere. Persisting a compact summary and applying the gate are done by the callers behind FORM_PIPELINE_AUTONOMY (see ReleaseGate, MappingCoverageService,
// EditionMigrationService), so with the switch off nothing here is even called.
const { CLASSES, facts, classifyField } = require("./classify");

const CAP = 50; // lists in the stored summary are capped: it is a report, not an export
const VERSION = 1;
const norm = (value) => String(value ?? "").toLowerCase().replace(/\[\d+\]/g, "").trim();

/**
 * The inventory gate is REPORT-ONLY, always (owner decision 2026-10-23): a box that cannot be mapped is left unmapped (blank) and the import / release goes on with every other
 * box; the inventory only lists those boxes. FORM_INVENTORY_GATE=enforce is therefore ignored - nothing is ever held because of the inventory.
 */
const gateMode = () => "report";

/** The previous edition's fields as plain facts, from its template or (when only the graph is known) from the graph's form nodes. */
function previousFacts(previous = {}) {
  if (Array.isArray(previous.fields) && previous.fields.length) return previous.fields.map(facts);
  if (previous.template?.formFields?.length) return previous.template.formFields.map(facts);
  const nodes = previous.graph?.nodes?.form;
  if (Array.isArray(nodes)) return nodes.map((node) => facts({ fieldId: node.fieldId, pdfFieldName: node.pdfField, label: node.label, type: node.type, section: node.section, pageNumber: node.pageNumber, required: node.required }));
  return [];
}

/**
 * Removed / renamed / structurally-changed boxes versus the previous edition. `renamedEdges` is the carry-forward's own result (edges that followed a renamed box); a box
 * is "new" when nothing in the previous edition has its id or its PDF name and no rename reached it.
 */
function diffAgainstPrevious(currentFacts, previous, { renamedEdges = [], lostEdges = [] } = {}) {
  const before = previousFacts(previous);
  if (!before.length) return { hasPrevious: false, removed: [], renamed: [], structurallyChanged: [], newIds: [] };
  const key = (f) => norm(f.pdfField) || norm(f.id);
  const nowByKey = new Map(currentFacts.map((f) => [key(f), f]));
  const nowById = new Map(currentFacts.map((f) => [norm(f.id), f]));
  const beforeKeys = new Set(before.map(key));
  const beforeIds = new Set(before.map((f) => norm(f.id)));
  const renamedTargets = new Set(renamedEdges.map((edge) => norm(edge.to)));
  const removed = [];
  const structurallyChanged = [];
  for (const old of before) {
    const now = nowByKey.get(key(old)) || nowById.get(norm(old.id));
    if (!now) {
      const renamedTo = renamedEdges.find((edge) => norm(edge.from) === norm(old.pdfField));
      if (!renamedTo) removed.push({ id: old.id, label: old.label, page: old.page });
      continue;
    }
    const changes = [];
    if (old.type !== now.type) changes.push(`type ${old.type} -> ${now.type}`);
    if (JSON.stringify(old.options) !== JSON.stringify(now.options) && (old.options.length || now.options.length)) changes.push("option set changed");
    if (old.page != null && now.page != null && Number(old.page) !== Number(now.page)) changes.push(`page ${old.page} -> ${now.page}`);
    if (changes.length) structurallyChanged.push({ id: now.id, label: now.label, changes });
  }
  const renamed = renamedEdges.map((edge) => ({ from: edge.from, to: edge.to, label: edge.label }));
  const newIds = currentFacts.filter((f) => !beforeKeys.has(key(f)) && !beforeIds.has(norm(f.id)) && !renamedTargets.has(norm(f.pdfField))).map((f) => f.id);
  return { hasPrevious: true, removed, renamed, structurallyChanged, newIds, lostEdges: lostEdges.length };
}

/**
 * build({ template | fields, graph, previous?, renamedEdges?, lostEdges?, formCode? }) -> the inventory
 *   fields   every field with { id, label, page, type, class, reason, role, required, conditional, protectedRole, roleUnknown, isNew }
 *   counts   per class
 *   hold     the fields the gate would hold on, each with the exact reason (never a percentage)
 */
function build({ template = {}, fields, graph = {}, previous = null, renamedEdges = [], lostEdges = [], formCode } = {}) {
  const list = fields || template.formFields || [];
  const edges = graph.edges || [];
  const mappedIds = new Set(edges.filter((edge) => edge.status === "active").map((edge) => String(edge.targetFieldId)));
  const pendingIds = new Set(edges.filter((edge) => edge.status !== "active").map((edge) => String(edge.targetFieldId)));
  const keptBlank = new Map((graph.keepBlank || []).map((entry) => [String(entry.targetFieldId), entry]));
  const code = formCode || template.formCode || template.formNumber;
  const currentFacts = list.map(facts);
  const diff = previous ? diffAgainstPrevious(currentFacts, previous, { renamedEdges, lostEdges }) : { hasPrevious: false, removed: [], renamed: [], structurallyChanged: [], newIds: [] };
  const newSet = new Set(diff.newIds);

  const classified = list.map((field) => ({ ...classifyField(field, { mappedIds, pendingIds, keptBlank, formCode: code }), }));
  classified.forEach((entry) => { entry.isNew = newSet.has(entry.id); });
  const counts = Object.fromEntries(CLASSES.map((cls) => [cls, 0]));
  classified.forEach((entry) => { counts[entry.class] += 1; });
  counts.total = classified.length;

  // the gate: any applicable protected-role / required / conditionally-required / party-unclear box with no active mapping
  const hold = classified.filter((entry) => entry.class === "unmapped_needs_source" || (entry.class === "conditional" && entry.required));
  const holdBy = {
    protectedRole: hold.filter((entry) => entry.protectedRole).length,
    required: hold.filter((entry) => entry.required && entry.class === "unmapped_needs_source").length,
    conditionalRequired: hold.filter((entry) => entry.class === "conditional").length,
    roleUnknown: hold.filter((entry) => entry.roleUnknown).length,
    new: hold.filter((entry) => entry.isNew).length,
  };
  return { version: VERSION, formCode: code, fields: classified, counts, hold, holdBy, previous: diff, decision: hold.length ? "held" : "pass" };
}

/** The compact, stored form of an inventory (it goes next to the coverage report on the mapping VERSION, never on the template document). */
function summarize(inventory) {
  const pick = (entry) => ({ id: entry.id, label: String(entry.label || "").slice(0, 120), page: entry.page, role: entry.role, required: entry.required, class: entry.class, reason: entry.reason, isNew: Boolean(entry.isNew) });
  return {
    version: VERSION,
    generatedAt: new Date(),
    formCode: inventory.formCode,
    counts: inventory.counts,
    decision: inventory.decision,
    hold: { count: inventory.hold.length, ...inventory.holdBy, fields: inventory.hold.slice(0, CAP).map(pick) },
    previous: inventory.previous?.hasPrevious
      ? { removed: inventory.previous.removed.length, renamed: inventory.previous.renamed.length, structurallyChanged: inventory.previous.structurallyChanged.length, new: inventory.previous.newIds.length, newIds: inventory.previous.newIds.slice(0, CAP), removedFields: inventory.previous.removed.slice(0, CAP), structurallyChangedFields: inventory.previous.structurallyChanged.slice(0, CAP) }
      : null,
  };
}

/**
 * The gate's answer from a stored (or freshly built) summary: { outcome: "pass" | "held", wouldBe, report, detail }. In report mode the OUTCOME stays "pass" (nothing is
 * blocked) and `wouldBe` carries what enforcement would say; in enforce mode the outcome is the decision itself.
 */
function gateCheck(summary) {
  if (!summary) return { name: "inventory", outcome: "pass", wouldBe: "unknown", report: true, detail: "report only: no inventory has been computed for this edition yet" };
  const held = summary.decision === "held";
  const detail = held
    ? `${summary.hold.count} box(es) have no active mapping and cannot be left empty on their own: ${summary.hold.protectedRole} about a person, ${summary.hold.required} required, ${summary.hold.conditionalRequired} conditionally required, ${summary.hold.roleUnknown} with an unclear party${summary.hold.new ? `, ${summary.hold.new} new in this edition` : ""}`
    : "every box is mapped, deliberately left empty with a stated reason, or not client data";
  return { name: "inventory", outcome: "pass", wouldBe: held ? "held" : "pass", report: true, detail: `report only (not blocking): ${detail}`, holdCount: summary.hold.count };
}

module.exports = { VERSION, CAP, gateMode, build, summarize, gateCheck, diffAgainstPrevious, previousFacts };
