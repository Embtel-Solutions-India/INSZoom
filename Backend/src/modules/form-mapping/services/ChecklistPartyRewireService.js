// Rewires a form's mapping graph from "this PDF box reads checklist question X" (raw.questionnaireAnswers.<questionKey>.value) to "this PDF box reads the
// petitioner / beneficiary fact" (petitioner.* / beneficiary.*). After this a form no longer knows which checklist, visa or question produced a value: any
// checklist that stores the fact under the generic path fills it.
//
// Safety, by construction (same contract as PartyFieldMappingService):
//   - the old source is kept as the edge's FALLBACK, so an answer that only exists under the old key still fills the box (conditions accept either path);
//   - nothing is removed, no edge's target, status or transform's meaning changes, and an edge that does not read a listed question is untouched;
//   - the result is a NEW mapping version (history is kept) built from the ACTIVE version, activated only when it validates; CaseForms already created keep the
//     mapping version they are locked to, so no form in progress changes underneath anyone;
//   - every rewired edge remembers what it was (partyRewire), so planRollback restores it exactly;
//   - dryRun (the default of the script) only reports.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const MappingGraphService = require("./MappingGraphService");
const { QUESTION_PATH_INDEX } = require("../../canonical/config/partyChecklistPaths");

const RAW_PATH = /^raw\.questionnaireAnswers\.([^.]+)\.value(.*)$/;

// raw.questionnaireAnswers.<key>.value[.rest] -> <generic path>[.rest]; null when the path does not read a listed question
function genericPathFor(path, index = QUESTION_PATH_INDEX) {
  const match = RAW_PATH.exec(String(path || ""));
  if (!match) return null;
  const spec = index.get(match[1]);
  return spec ? `${spec.path}${match[2] || ""}` : null;
}

const remapString = (value, index) => (typeof value === "string" ? genericPathFor(value, index) || value : value);

// A condition that looked at the old question key must keep working for a profile that only has the old answer AND start working for one that only has the
// generic value. A positive test (equals / in / exists ...) passes when EITHER path passes; a negative test (not equals / empty / missing ...) must hold for
// BOTH paths, otherwise a value that exists under only one of them would flip the result.
const NEGATIVE_OPERATORS = new Set(["not_equals", "notEquals", "not_in", "notIn", "not_contains", "empty", "missing", "not_exists"]);

// { any|all: [ <generic leaf>, <old raw leaf> ] } is what a previous run produced: it is final, never wrapped again
function isDualGroup(condition, index) {
  const group = condition.any || condition.all;
  if (!Array.isArray(group) || group.length !== 2) return false;
  const [generic, raw] = group;
  return Boolean(generic?.field && raw?.field && genericPathFor(raw.field, index) === generic.field);
}

function remapCondition(condition, index) {
  if (!condition || typeof condition !== "object") return condition;
  if (isDualGroup(condition, index)) return condition;
  const next = { ...condition };
  for (const key of ["rules", "all", "any", "groups"]) {
    if (Array.isArray(next[key])) next[key] = next[key].map((item) => remapCondition(item, index));
  }
  const leafPath = typeof condition.field === "string" ? condition.field : null;
  const generic = leafPath ? genericPathFor(leafPath, index) : null;
  if (!generic) return next;
  const rewired = { ...next, field: generic };
  return NEGATIVE_OPERATORS.has(condition.operator) ? { all: [rewired, condition] } : { any: [rewired, condition] };
}

function remapTransform(transform, index) {
  if (!transform || typeof transform !== "object") return transform;
  const next = { ...transform };
  if (Array.isArray(next.fields)) next.fields = next.fields.map((field) => remapString(field, index));
  if (typeof next.countryPath === "string") next.countryPath = remapString(next.countryPath, index);
  return next;
}

// PURE. graph -> { graph, report }. Never mutates its input.
// Two kinds of edge are taken over:
//   1. the edge reads a listed question directly (raw.questionnaireAnswers.<key>.value ...): it reads the question's generic path, the old key becomes its fallback;
//   2. the edge already reads some generic path but keeps a listed question as its raw fallback (an earlier party-rules pass wired it by PDF field name) and the
//      question's own generic path is a DIFFERENT fact: the question's path becomes primary, the path it read until now becomes the fallback (nothing is lost).
function planRewire(graph = {}, index = QUESTION_PATH_INDEX) {
  const report = { rewired: 0, retargeted: 0, conditionsRewired: 0, unchanged: 0, byPath: {}, questionKeys: new Set() };
  const edges = (graph.edges || []).map((edge) => {
    const direct = RAW_PATH.exec(String(edge.sourcePath || ""));
    // an edge this step already processed (it carries its snapshot) is final: its fallback is the OLD question key kept on purpose, so reading it again as "an edge
    // wired by PDF field name" would swap unrelated facts (a second run must change nothing)
    const viaFallback = !direct && !edge.partyRewire && typeof edge.fallback === "string" ? RAW_PATH.exec(edge.fallback) : null;
    const hit = direct || viaFallback;
    const spec = hit ? index.get(hit[1]) : null;
    const target = spec ? `${spec.path}${hit[2] || ""}` : null;
    const generic = direct ? target : (viaFallback && target && target !== edge.sourcePath ? target : null);
    const condition = remapCondition(edge.condition, index);
    const transform = remapTransform(edge.transform, index);
    const conditionChanged = JSON.stringify(condition) !== JSON.stringify(edge.condition);
    const transformChanged = JSON.stringify(transform) !== JSON.stringify(edge.transform);
    if (!generic && !conditionChanged && !transformChanged) { report.unchanged += 1; return edge; }
    const next = { ...edge };
    // what this edge looked like before (once): lets planRollback put it back exactly
    if (!next.partyRewire) {
      next.partyRewire = { sourcePath: edge.sourcePath, fallback: edge.fallback, profileOwner: edge.profileOwner, partyRule: edge.partyRule, origin: edge.origin, condition: edge.condition, transform: edge.transform };
      // a rewired edge is no longer what was live before: it is held to the contract like any new edge (legacy edges are only reported on)
      next.origin = "authored";
    }
    if (generic) {
      next.sourcePath = generic;
      if (direct) {
        // the old key keeps working for answers that exist only under it (an existing fallback is never replaced)
        if (!next.fallback) next.fallback = edge.sourcePath;
        report.rewired += 1;
      } else {
        next.fallback = edge.sourcePath;
        report.retargeted += 1;
      }
      // the contract requires the derived label to follow the source path exactly (a repeating path keeps its row number and field name)
      next.partyRule = generic;
      next.profileOwner = generic.startsWith("petitioner") ? "employer" : "employee";
      const group = generic.replace(/\.\d+(\..*)?$/, "");
      report.byPath[group] = (report.byPath[group] || 0) + 1;
      report.questionKeys.add(hit[1]);
    }
    if (conditionChanged) { next.condition = condition; report.conditionsRewired += 1; }
    if (transformChanged) next.transform = transform;
    return next;
  });
  const nodes = { ...(graph.nodes || {}) };
  const known = new Set((nodes.canonical || []).map((node) => node.path));
  const wanted = new Set();
  edges.forEach((edge) => { wanted.add(edge.sourcePath); if (edge.fallback) wanted.add(edge.fallback); (edge.transform?.fields || []).forEach((field) => wanted.add(field)); });
  nodes.canonical = [...(nodes.canonical || []), ...[...wanted].filter((path) => path && !known.has(path) && !RAW_PATH.test(path)).map((path) => ({ id: `canonical:${path}`, path, label: path, type: "text" }))];
  report.questionKeys = [...report.questionKeys];
  return { graph: { ...graph, nodes, edges }, report };
}

// PURE. Puts every rewired edge back exactly as it was (from the snapshot kept on the edge). An edge no run touched is left alone.
function planRollback(graph = {}) {
  let restored = 0;
  const edges = (graph.edges || []).map((edge) => {
    if (!edge.partyRewire) return edge;
    const { partyRewire, ...rest } = edge;
    const next = { ...rest, sourcePath: partyRewire.sourcePath };
    for (const key of ["fallback", "profileOwner", "partyRule", "origin", "condition", "transform"]) {
      if (partyRewire[key] === undefined) delete next[key]; else next[key] = partyRewire[key];
    }
    restored += 1;
    return next;
  });
  return { graph: { ...graph, edges }, report: { restored } };
}

// The graph cases actually use is the ACTIVE mapping version, not whatever "latest" points at (an I-129 template can have a retired newer version as latest).
async function loadBaseGraph(template) {
  if (template.activeMappingVersionId) {
    const version = await USCISMappingVersion.findById(template.activeMappingVersionId).select("graph").lean();
    if (version?.graph) return version.graph;
  }
  return MappingGraphService.loadCurrentGraph(template);
}

async function loadTemplate(templateOrId) {
  const template = typeof templateOrId === "object" && templateOrId.save ? templateOrId : await USCISFormTemplate.findById(templateOrId);
  if (!template) throw Object.assign(new Error("USCIS form template not found"), { status: 404 });
  return template;
}

async function save(template, graph, user, req, { activate }) {
  const version = await MappingGraphService.persistVersion(template, graph, user);
  let activated = false;
  if (activate && graph.validation.readyForActivation) {
    await MappingGraphService.activate(template._id, user, req);
    activated = true;
  }
  return { mappingVersion: version.mappingVersion, activated };
}

// dryRun: only reports. Otherwise saves a new mapping version and activates it when it validates (a template that is not the live edition is saved only).
async function apply(templateOrId, user, req, { dryRun = true, activate = true, index = QUESTION_PATH_INDEX } = {}) {
  const template = await loadTemplate(templateOrId);
  const current = await loadBaseGraph(template);
  const { graph, report } = planRewire(current, index);
  const outcome = { formCode: template.formCode, templateId: String(template._id), previousMappingVersion: template.activeMappingVersion, ...report };
  if (!report.rewired && !report.retargeted && !report.conditionsRewired) return { ...outcome, saved: false, skipped: "no edge reads a listed question" };
  graph.summary = { ...(graph.summary || {}) };
  graph.validation = MappingGraphService.validateGraph(graph, template);
  outcome.validation = graph.validation.summary;
  if (dryRun) return { ...outcome, saved: false, wouldSave: graph.validation.valid };
  if (!graph.validation.valid) return { ...outcome, saved: false, error: "graph does not validate", errors: graph.validation.errors.slice(0, 5) };
  return { ...outcome, saved: true, ...(await save(template, graph, user, req, { activate })) };
}

async function rollback(templateOrId, user, req, { dryRun = true, activate = true } = {}) {
  const template = await loadTemplate(templateOrId);
  const current = await loadBaseGraph(template);
  const { graph, report } = planRollback(current);
  const outcome = { formCode: template.formCode, templateId: String(template._id), ...report };
  if (!report.restored) return { ...outcome, saved: false, skipped: "no rewired edge" };
  graph.validation = MappingGraphService.validateGraph(graph, template);
  if (dryRun) return { ...outcome, saved: false, wouldSave: graph.validation.valid };
  if (!graph.validation.valid) return { ...outcome, saved: false, error: "graph does not validate", errors: graph.validation.errors.slice(0, 5) };
  return { ...outcome, saved: true, ...(await save(template, graph, user, req, { activate })) };
}

// Cheap pre-check for a bulk run: does this form's ACTIVE graph (about half a MB) have anything to change? Lets a script skip the forms that need nothing without
// loading their full template (10-16 MB each).
async function needsChange(templateLean, { rollback: isRollback = false, index = QUESTION_PATH_INDEX } = {}) {
  const graph = await loadBaseGraph(templateLean);
  if (isRollback) return planRollback(graph).report.restored > 0;
  const { report } = planRewire(graph, index);
  return report.rewired + report.retargeted + report.conditionsRewired > 0;
}

module.exports = { genericPathFor, planRewire, planRollback, apply, rollback, needsChange, loadBaseGraph };
