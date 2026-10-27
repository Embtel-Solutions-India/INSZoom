// Applies the generic party rules (config/partyFieldRules.js) to a form's mapping: every field that asks for a beneficiary / petitioner fact is wired to
// the generic canonical path (beneficiary.* / petitioner.*), once per occurrence on the form.
//   - a field that already has an edge keeps everything it had: the generic path becomes the primary source and the old source is kept as its
//     fallback, so data that flowed before (e.g. a visa-specific questionnaire key) still fills when the generic value is empty;
//   - a field with no edge gets a new one;
//   - nothing else is touched, nothing is removed, and the result is a NEW mapping version (history is kept), activated only if it validates.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const MappingGraphService = require("./MappingGraphService");
const { RULES, EXCLUSIVE_FORMS } = require("../config/partyFieldRules");
const { inferRules } = require("./FieldRuleInferenceService");
const UnlockedMirrorService = require("./UnlockedMirrorService");

const SKIP_TYPES = new Set(["checkbox", "radio", "signature", "button"]);
const indexOf = (pdfField) => { const match = /\[(\d+)\]$/.exec(String(pdfField || "")); return match ? Number(match[1]) : 0; };
// a Yes / No box: ticked when the generic yes/no answer (boolean, or the older "Yes"/"No" text) matches the box
// rule.box: a checkbox that takes its value from the rule's own transform (for example the Apt / Ste / Flr boxes of an address block)
const boxTransformOf = (rule) => (rule.checkboxEquals !== undefined ? { type: "checkbox", value: rule.checkboxEquals, ...(rule.ignoreCase ? { ignoreCase: true } : {}) } : rule.checkbox !== undefined ? checkboxTransform(rule.checkbox) : rule.box && rule.transform ? rule.transform : null);
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

// authored rules always win; a form without any gets conservative rules inferred from its own field names (FieldRuleInferenceService)
function rulesFor(template, { allowInference = true } = {}) {
  if (RULES[template.formCode]) return { rules: RULES[template.formCode], inferred: false };
  if (!allowInference) return { rules: [], inferred: true };
  return { rules: inferRules(template, (item) => MappingGraphService.getTemplateFields(item)), inferred: true };
}

function indexRules(rules) {
  const byStem = new Map();
  for (const rule of rules || []) {
    for (const stem of rule.stems) {
      const key = stem.toLowerCase();
      byStem.set(key, [...(byStem.get(key) || []), rule]);
    }
  }
  return byStem;
}

function plan(template, graph, options = {}) {
  const formCode = template.formCode;
  // mirrorsOnly: add nothing but the copies of already-mapped boxes (see UnlockedMirrorService) - no rule of the form is applied
  const { rules: formRules, inferred } = options.mirrorsOnly ? { rules: [], inferred: false } : rulesFor(template, options);
  const byStem = indexRules(formRules);
  const version = template.version || String(template.editionDate || "unknown");
  const targets = MappingGraphService.getTemplateFields(template);
  const edgesByTarget = new Map((graph.edges || []).map((edge) => [edge.targetFieldId, edge]));
  const out = (graph.edges || []).map((edge) => ({ ...edge }));
  const outIndex = new Map(out.map((edge, index) => [edge.targetFieldId, index]));
  const report = { formCode, matched: 0, created: 0, rewired: 0, unchanged: 0, byConcept: {}, conflicts: [], unmatchedCandidates: [] };
  const matchedStems = new Set();
  const removeIds = new Set();

  // (mirrorsOnly applies no rule at all - not even the removal of an old guess on an exclusive form)
  for (const target of options.mirrorsOnly ? [] : targets) {
    if (/PDF417|barcode/i.test(target.targetPdfField)) continue;
    const rules = (byStem.get(stemOf(target.targetPdfField)) || [])
      .filter((rule) => !rule.pages || rule.pages.includes(target.pageNumber))
      .filter((rule) => rule.index === undefined || rule.index === indexOf(target.targetPdfField))
      // `within`: only the boxes under one named block of the PDF (a name repeated in two blocks of the same form)
      .filter((rule) => !rule.within || String(target.targetPdfField || "").includes(rule.within));
    if (!rules.length) {
      // exclusive forms keep only rule-backed edges; for an inferred form the importer's unreviewed guesses (status != active) are dropped the same way,
      // while an already-active edge (carried over from a verified earlier edition) is kept
      const existingEdge = edgesByTarget.get(target.targetFieldId);
      if (existingEdge && (EXCLUSIVE_FORMS.has(formCode) || (inferred && formRules.length && existingEdge.status !== "active"))) { removeIds.add(target.targetFieldId); report.removed = (report.removed || 0) + 1; }
      continue;
    }
    if (rules.some((rule) => rule.remove)) {
      if (edgesByTarget.has(target.targetFieldId)) { removeIds.add(target.targetFieldId); report.removed = (report.removed || 0) + 1; }
      continue;
    }
    if (SKIP_TYPES.has(target.type) && !rules.some((rule) => boxTransformOf(rule))) continue;
    if (rules.length > 1 && new Set(rules.map((rule) => rule.to)).size > 1) report.conflicts.push({ field: target.targetPdfField, paths: rules.map((rule) => rule.to) });
    const rule = rules[0];
    matchedStems.add(stemOf(target.targetPdfField));
    report.matched += 1;
    report.byConcept[rule.to] = (report.byConcept[rule.to] || 0) + 1;
    const sourcePath = rule.transform?.fields?.[0] || rule.to;
    const existing = edgesByTarget.get(target.targetFieldId);
    if (existing) {
      const isBox = Boolean(boxTransformOf(rule));
      const nextTransform = isBox ? boxTransformOf(rule) : (rule.transform || remapTransform(existing.transform, rule) || defaultTransform(target.type));
      const nextCondition = isBox ? undefined : remapCondition(existing.condition, rule);
      if (existing.sourcePath === sourcePath && JSON.stringify(existing.transform) === JSON.stringify(nextTransform) && JSON.stringify(existing.condition) === JSON.stringify(nextCondition)) { report.unchanged += 1; continue; }
      const index = outIndex.get(target.targetFieldId);
      out[index] = {
        ...existing,
        sourcePath,
        fallback: existing.sourcePath && existing.sourcePath !== sourcePath ? existing.sourcePath : existing.fallback,
        transform: nextTransform,
        partyRule: rule.to,
        profileOwner: rule.to.startsWith("petitioner") ? "employer" : "employee",
      };
      if (nextCondition) out[index].condition = nextCondition; else delete out[index].condition;
      if (isBox) out[index].mappingType = "checkbox";
      if ("fallback" in rule) { if (rule.fallback === null) delete out[index].fallback; else out[index].fallback = rule.fallback; }
      if (EXCLUSIVE_FORMS.has(formCode) || (rule.inferred && existing.status !== "active")) {
        // a verified rule replaces the old guess completely: no inherited fallback source, no inherited review status
        if (!rule.fallback) delete out[index].fallback;
        out[index].status = "active";
        out[index].confidence = 90;
        out[index].origin = rule.inferred ? "inferred" : "authored";
        out[index].note = `Verified ${formCode} rule: ${rule.to}`;
      }
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
      mappingType: boxTransformOf(rule) ? "checkbox" : target.type === "date" ? "date" : "direct",
      ...(rule.fallback ? { fallback: rule.fallback } : {}),
      confidence: 90,
      status: "active",
      transform: boxTransformOf(rule) || rule.transform || defaultTransform(target.type),
      note: `Generic ${rule.to.split(".")[0]} rule: ${rule.to}`,
      profileOwner: rule.to.startsWith("petitioner") ? "employer" : "employee",
      allowsOccurrenceOverride: false,
      partyRule: rule.to,
      origin: rule.inferred ? "inferred" : "authored",
      createdAt: new Date(),
    });
    report.created += 1;
  }

  // rule stems that matched no box of this edition (a typo, or a box the edition does not have) - reported, never silently ignored
  const allStems = new Set(targets.map((target) => stemOf(target.targetPdfField)));
  report.unusedRuleStems = options.mirrorsOnly ? [] : [...new Set(formRules.flatMap((rule) => rule.stems).filter((stem) => !allStems.has(stem.toLowerCase())))];

  // fields whose name looks party-related but no rule covers - listed for review, never guessed
  for (const target of targets) {
    const stem = stemOf(target.targetPdfField);
    if (matchedStems.has(stem) || SKIP_TYPES.has(target.type)) continue;
    if (/petitioner|beneficiary|companyor|nameofemployer/.test(stem) && !edgesByTarget.has(target.targetFieldId)) report.unmatchedCandidates.push(`${target.targetPdfField.split(".").pop()} (p${target.pageNumber}) ${String(target.label).slice(0, 40)}`);
  }

  const keptOut = out.filter((edge) => !removeIds.has(edge.targetFieldId));
  out.length = 0;
  out.push(...keptOut);
  // copies of an already-mapped box (the A-Number / name repeated on every continuation page) that USCIS marks read-only and are now fillable: same edge
  // (only siblings that are part of the live mapping, or were created by this run's own rules, are copied: options.trustedTargetIds)
  const createdHere = new Set(out.filter((edge) => !edgesByTarget.has(edge.targetFieldId)).map((edge) => edge.targetFieldId));
  const trusted = options.trustedTargetIds ? (edge) => options.trustedTargetIds.has(edge.targetFieldId) || createdHere.has(edge.targetFieldId) : undefined;
  if (options.mirrors !== false) UnlockedMirrorService.addMirrorEdges({ formCode, version, editionDate: template.editionDate }, targets, out, report, trusted);
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
  if (EXCLUSIVE_FORMS.has(formCode) || (inferred && formRules.length)) {
    // Rule-driven forms: every field is either rule-mapped or deliberately left for the case manager (preparer / interpreter / signature / requested-action
    // boxes, evidence-only items). Those are listed for review, not treated as an activation-blocking gap.
    const mappedTargets = new Set(out.map((edge) => edge.targetFieldId));
    next.unmappedTargets = [];
    next.intentionallyUnmapped = targets
      .filter((target) => !mappedTargets.has(target.targetFieldId) && !/PDF417|barcode/i.test(target.targetPdfField))
      .map((target) => ({ targetFieldId: target.targetFieldId, targetPdfField: target.targetPdfField, label: target.label, pageNumber: target.pageNumber, reason: "no verified rule - left for the case manager / retained as case information" }));
    report.intentionallyUnmapped = next.intentionallyUnmapped.length;
  }
  next.validation = MappingGraphService.validateGraph(next, template);
  return { graph: next, report };
}

// dryRun: only reports; otherwise saves a new mapping version and activates it when it validates (a template that is not the live edition is saved only)
async function apply(templateOrId, user, req, { dryRun = false, activate = true, allowInference = true, mirrorsOnly = false } = {}) {
  const template = typeof templateOrId === "object" && templateOrId.save ? templateOrId : await USCISFormTemplate.findById(templateOrId);
  if (!template) throw Object.assign(new Error("USCIS form template not found"), { status: 404 });
  const hasRules = !mirrorsOnly && rulesFor(template, { allowInference }).rules.length > 0;
  if (!hasRules && !UnlockedMirrorService.hasCandidates(template)) return { formCode: template.formCode, skipped: "no authored or inferable rules for this form" };
  const current = await MappingGraphService.loadCurrentGraph(template);
  // the edges of the LIVE mapping version are the ones a copy may be based on (a draft version's edges were never reviewed)
  const live = await USCISMappingVersion.findOne({ template: template._id, status: "active" }).select("graph.edges.targetFieldId").lean();
  const trustedTargetIds = new Set((live?.graph?.edges || []).map((edge) => edge.targetFieldId));
  const { graph, report } = plan(template, current, { allowInference, mirrorsOnly, trustedTargetIds });
  report.validation = graph.validation.summary;
  const staleUnmapped = hasRules && (EXCLUSIVE_FORMS.has(template.formCode) || rulesFor(template, { allowInference }).inferred) && (current.unmappedTargets || []).length > 0;
  if (dryRun || (report.created === 0 && report.rewired === 0 && !report.mirrored && !report.removed && !staleUnmapped)) return { ...report, saved: false };
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
