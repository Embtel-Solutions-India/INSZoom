// Applies the generic party rules (config/partyFieldRules.js) to a form's mapping: every field that asks for a beneficiary / petitioner fact is wired to
// the generic canonical path (beneficiary.* / petitioner.*), once per occurrence on the form.
//   - a field that already has an edge keeps everything it had: the generic path becomes the primary source and the old source is kept as its
//     fallback, so data that flowed before (e.g. a visa-specific questionnaire key) still fills when the generic value is empty;
//   - a field with no edge gets a new one;
//   - nothing else is touched, nothing is removed, and the result is a NEW mapping version (history is kept), activated only if it validates.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const MappingGraphService = require("./MappingGraphService");
const { RULES } = require("../config/partyFieldRules");

const SKIP_TYPES = new Set(["checkbox", "radio", "signature", "button"]);
const indexOf = (pdfField) => { const match = /\[(\d+)\]$/.exec(String(pdfField || "")); return match ? Number(match[1]) : 0; };
// a Yes / No box: ticked when the generic yes/no answer (boolean, or the older "Yes"/"No" text) matches the box
const checkboxTransform = (ticksWhenYes) => ({ type: "checkbox", optionsMap: ticksWhenYes
  ? { true: true, false: false, Yes: true, yes: true, No: false, no: false }
  : { true: false, false: true, Yes: false, yes: false, No: true, no: true } });
const stemOf = (pdfField) => String(pdfField || "").split(".").pop().replace(/\[\d+\]/g, "").toLowerCase();

function defaultTransform(type) {
  if (type === "date") return { type: "date", format: "mm/dd/yyyy" };
  if (type === "phone") return { type: "phone" };
  return { type: "direct" };
}

// An old edge's condition / country reference points at the OLD source's address (contact.address.*). When the field is rewired to the petitioner's
// address, the condition must look at the petitioner's address too, otherwise it can never be true.
function remapPath(path, rule) {
  if (typeof path !== "string") return path;
  if (rule.to.startsWith("petitioner.address.") && path.startsWith("contact.address.")) return path.replace("contact.address.", "petitioner.address.");
  return path;
}
function remapCondition(condition, rule) {
  if (!condition || typeof condition !== "object") return condition;
  const next = { ...condition };
  if (next.field) next.field = remapPath(next.field, rule);
  if (Array.isArray(next.rules)) next.rules = next.rules.map((item) => remapCondition(item, rule));
  return next;
}
function remapTransform(transform, rule) {
  if (!transform || typeof transform !== "object" || !transform.countryPath) return transform;
  return { ...transform, countryPath: remapPath(transform.countryPath, rule) };
}

function indexRules(formCode) {
  const byStem = new Map();
  for (const rule of RULES[formCode] || []) {
    for (const stem of rule.stems) {
      const key = stem.toLowerCase();
      byStem.set(key, [...(byStem.get(key) || []), rule]);
    }
  }
  return byStem;
}

function plan(template, graph) {
  const formCode = template.formCode;
  const byStem = indexRules(formCode);
  const version = template.version || String(template.editionDate || "unknown");
  const targets = MappingGraphService.getTemplateFields(template);
  const edgesByTarget = new Map((graph.edges || []).map((edge) => [edge.targetFieldId, edge]));
  const out = (graph.edges || []).map((edge) => ({ ...edge }));
  const outIndex = new Map(out.map((edge, index) => [edge.targetFieldId, index]));
  const report = { formCode, matched: 0, created: 0, rewired: 0, unchanged: 0, byConcept: {}, conflicts: [], unmatchedCandidates: [] };
  const matchedStems = new Set();

  for (const target of targets) {
    if (/PDF417|barcode/i.test(target.targetPdfField)) continue;
    const rules = (byStem.get(stemOf(target.targetPdfField)) || [])
      .filter((rule) => !rule.pages || rule.pages.includes(target.pageNumber))
      .filter((rule) => rule.index === undefined || rule.index === indexOf(target.targetPdfField));
    if (!rules.length) continue;
    if (SKIP_TYPES.has(target.type) && !rules.some((rule) => rule.checkbox !== undefined)) continue;
    if (rules.length > 1 && new Set(rules.map((rule) => rule.to)).size > 1) report.conflicts.push({ field: target.targetPdfField, paths: rules.map((rule) => rule.to) });
    const rule = rules[0];
    matchedStems.add(stemOf(target.targetPdfField));
    report.matched += 1;
    report.byConcept[rule.to] = (report.byConcept[rule.to] || 0) + 1;
    const sourcePath = rule.transform?.fields?.[0] || rule.to;
    const existing = edgesByTarget.get(target.targetFieldId);
    if (existing) {
      const isBox = rule.checkbox !== undefined;
      const nextTransform = isBox ? checkboxTransform(rule.checkbox) : (rule.transform || remapTransform(existing.transform, rule) || defaultTransform(target.type));
      const nextCondition = isBox ? undefined : remapCondition(existing.condition, rule);
      if (existing.sourcePath === sourcePath && JSON.stringify(existing.transform) === JSON.stringify(nextTransform) && JSON.stringify(existing.condition) === JSON.stringify(nextCondition)) { report.unchanged += 1; continue; }
      const index = outIndex.get(target.targetFieldId);
      out[index] = {
        ...existing,
        sourcePath,
        fallback: existing.sourcePath && existing.sourcePath !== sourcePath ? existing.sourcePath : existing.fallback,
        transform: nextTransform,
        partyRule: rule.to,
      };
      if (nextCondition) out[index].condition = nextCondition; else delete out[index].condition;
      if (isBox) out[index].mappingType = "checkbox";
      report.rewired += 1;
      continue;
    }
    out.push({
      mappingId: `${formCode}:${version}:${target.targetFieldId}`,
      formCode,
      editionDate: template.editionDate,
      version,
      sourcePath,
      sourceType: "canonical",
      targetFieldId: target.targetFieldId,
      targetPdfField: target.targetPdfField,
      targetLabel: target.label,
      targetType: target.type,
      section: target.section,
      pageNumber: target.pageNumber,
      mappingType: rule.checkbox !== undefined ? "checkbox" : target.type === "date" ? "date" : "direct",
      confidence: 90,
      status: "active",
      transform: rule.checkbox !== undefined ? checkboxTransform(rule.checkbox) : (rule.transform || defaultTransform(target.type)),
      note: `Generic ${rule.to.split(".")[0]} rule: ${rule.to}`,
      profileOwner: rule.to.startsWith("petitioner") ? "employer" : "employee",
      allowsOccurrenceOverride: false,
      partyRule: rule.to,
      createdAt: new Date(),
    });
    report.created += 1;
  }

  // fields whose name looks party-related but no rule covers - listed for review, never guessed
  for (const target of targets) {
    const stem = stemOf(target.targetPdfField);
    if (matchedStems.has(stem) || SKIP_TYPES.has(target.type)) continue;
    if (/petitioner|beneficiary|companyor|nameofemployer/.test(stem) && !edgesByTarget.has(target.targetFieldId)) report.unmatchedCandidates.push(`${target.targetPdfField.split(".").pop()} (p${target.pageNumber}) ${String(target.label).slice(0, 40)}`);
  }

  const canonicalPaths = new Set();
  out.forEach((edge) => {
    canonicalPaths.add(edge.sourcePath);
    (edge.transform?.fields || []).forEach((path) => canonicalPaths.add(path));
  });
  const nodes = { ...(graph.nodes || {}) };
  const known = new Set((nodes.canonical || []).map((node) => node.path));
  nodes.canonical = [...(nodes.canonical || []), ...[...canonicalPaths].filter((path) => path && !known.has(path)).map((path) => ({ id: `canonical:${path}`, path, label: path, type: "text" }))];
  const next = {
    ...graph,
    nodes,
    edges: out,
    summary: {
      ...(graph.summary || {}),
      mappedFields: out.length,
      activeMappings: out.filter((edge) => edge.status === "active").length,
      reviewRequired: out.filter((edge) => edge.status !== "active").length,
      mappingCoverage: targets.length ? Math.round((out.length / targets.length) * 100) : 100,
    },
  };
  next.validation = MappingGraphService.validateGraph(next, template);
  return { graph: next, report };
}

// dryRun: only reports; otherwise saves a new mapping version and activates it when it validates (a template that is not the live edition is saved only)
async function apply(templateOrId, user, req, { dryRun = false, activate = true } = {}) {
  const template = typeof templateOrId === "object" && templateOrId.save ? templateOrId : await USCISFormTemplate.findById(templateOrId);
  if (!template) throw Object.assign(new Error("USCIS form template not found"), { status: 404 });
  if (!RULES[template.formCode]) return { formCode: template.formCode, skipped: "no party rules for this form" };
  const current = await MappingGraphService.loadCurrentGraph(template);
  const { graph, report } = plan(template, current);
  report.validation = graph.validation.summary;
  if (dryRun || (report.created === 0 && report.rewired === 0)) return { ...report, saved: false };
  if (!graph.validation.valid) return { ...report, saved: false, error: "graph does not validate", errors: graph.validation.errors.slice(0, 5) };
  const version = await MappingGraphService.persistVersion(template, graph, user);
  let activated = false;
  if (activate && graph.validation.readyForActivation) {
    await MappingGraphService.activate(template._id, user, req);
    activated = true;
  }
  return { ...report, saved: true, mappingVersion: version.mappingVersion, activated };
}

module.exports = { apply, plan, RULES };
