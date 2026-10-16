// Moves a form's field mapping onto a newly imported USCIS edition WITHOUT any AI or manual step.
//
// When USCIS publishes a new edition the scanner imports it (normalized, AcroForm-only), and this service then builds the new edition's mapping:
//   1. a form with a hand-authored crosswalk (G-28) gets its graph rebuilt from that crosswalk against the new edition's real field names;
//   2. every other form carries the PREVIOUS edition's mapping graph forward: each edge is re-pointed at the new edition's field with the same
//      PDF field name (falling back to the same field id). An edge whose field no longer exists is DROPPED and reported, never guessed.
// The result is saved as a new mapping version. If nothing was lost and the graph validates, the mapping is activated and the caller activates
// the edition, so every visa (they all resolve a form by its number) starts using the new edition. If any edge was lost, or the graph does not
// validate, the previous edition stays in service and admins are told exactly which fields need a person.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const MappingGraphService = require("./MappingGraphService");
const { findRenamedTarget } = require("../contract/fieldEquivalence");
const { originOf } = require("../contract/MappingPolicy");

// formCode -> () => { buildCrosswalkGraph(template) }; add a form here only when it has an authored crosswalk
const CROSSWALK_BUILDERS = {
  "G-28": () => require("../seeds/g28-mapping.seed").buildCrosswalkGraph,
};

const norm = (value) => String(value ?? "").trim();

async function findPreviousEdition(template) {
  if (template.parentVersion) {
    const parent = await USCISFormTemplate.findById(template.parentVersion);
    if (parent) return parent;
  }
  const others = await USCISFormTemplate.find({ formCode: template.formCode, _id: { $ne: template._id } }).sort({ editionDate: -1, createdAt: -1 });
  for (const candidate of others) {
    if (await USCISMappingVersion.exists({ template: candidate._id })) return candidate;
  }
  return null;
}

function carryForwardGraph(previousGraph, template) {
  const targetFields = MappingGraphService.getTemplateFields(template);
  const byPdfName = new Map(targetFields.map((field) => [norm(field.targetPdfField), field]));
  const byId = new Map(targetFields.map((field) => [norm(field.targetFieldId), field]));
  const version = template.version || String(template.editionDate || "unknown");
  const formCode = template.formCode || template.formNumber;
  const edges = [];
  const lostEdges = [];
  const renamedEdges = [];
  const claimed = new Set();

  // pass 1: an edge follows the field with the same PDF name (or id) - exactly as before
  const previousEdges = previousGraph.edges || [];
  const exact = previousEdges.map((edge) => {
    const target = byPdfName.get(norm(edge.targetPdfField)) || byId.get(norm(edge.targetFieldId));
    if (!target || claimed.has(target.targetFieldId)) return null;
    claimed.add(target.targetFieldId);
    return target;
  });
  // pass 2: an edge whose field is gone may follow a RENAMED field, but only one that is provably the same (same type, same printed label, same section, and the
  // only such field). It is carried as needs_review - a person confirms it - and never as active.
  const renames = previousEdges.map((edge, index) => {
    if (exact[index]) return null;
    const unclaimed = targetFields.filter((field) => !claimed.has(field.targetFieldId));
    const found = findRenamedTarget({ label: edge.targetLabel, type: edge.targetType, section: edge.section }, unclaimed.map((field) => ({ ...field, type: field.type, label: field.label, section: field.section })));
    if (found?.target) claimed.add(found.target.targetFieldId);
    return found?.target ? found : null;
  });

  previousEdges.forEach((edge, index) => {
    const renamed = renames[index];
    const target = exact[index] || renamed?.target;
    if (!target) {
      lostEdges.push({ mappingId: edge.mappingId, sourcePath: edge.sourcePath, targetPdfField: edge.targetPdfField, targetLabel: edge.targetLabel });
      return;
    }
    if (renamed) renamedEdges.push({ mappingId: edge.mappingId, sourcePath: edge.sourcePath, from: edge.targetPdfField, to: target.targetPdfField, label: edge.targetLabel, similarity: renamed.similarity });
    edges.push({
      ...edge,
      ...(renamed ? { status: "needs_review", confidence: Math.min(Number(edge.confidence ?? 60), 60), origin: originOf(edge), evidence: { ...(edge.evidence || {}), renamedFrom: { pdfField: edge.targetPdfField, label: edge.targetLabel }, similarity: renamed.similarity }, note: `Carried over from a renamed field (${edge.targetPdfField}); a person must confirm it` } : {}),
      mappingId: `${formCode}:${version}:${target.targetFieldId}`,
      formCode,
      editionDate: template.editionDate,
      version,
      targetFieldId: target.targetFieldId,
      targetPdfField: target.targetPdfField,
      targetLabel: target.label || edge.targetLabel,
      targetType: target.type || edge.targetType,
      section: target.section ?? edge.section,
      pageNumber: target.pageNumber ?? edge.pageNumber,
      createdAt: new Date(),
    });
  });

  const sourcePaths = new Set(edges.map((edge) => edge.sourcePath));
  const oldCanonical = new Map((previousGraph.nodes?.canonical || []).map((node) => [node.path, node]));
  const graph = {
    templateId: String(template._id),
    formCode,
    formName: template.title,
    editionDate: template.editionDate,
    version,
    nodes: {
      canonical: [...sourcePaths].map((path) => oldCanonical.get(path) || { id: `canonical:${path}`, path, label: path, type: "text" }),
      form: targetFields.map((field) => ({
        id: `form:${field.targetFieldId}`,
        fieldId: field.targetFieldId,
        pdfField: field.targetPdfField,
        label: field.label,
        type: field.type,
        section: field.section,
        pageNumber: field.pageNumber,
        required: field.required,
      })),
    },
    edges,
    unmappedTargets: [],
    summary: {
      sourceFields: sourcePaths.size,
      formFields: targetFields.length,
      mappedFields: edges.length,
      activeMappings: edges.filter((edge) => edge.status === "active").length,
      reviewRequired: edges.filter((edge) => edge.status !== "active").length,
      mappingCoverage: targetFields.length ? Math.round((edges.length / targetFields.length) * 100) : 100,
    },
    carriedForwardFrom: previousGraph.version,
  };
  graph.validation = MappingGraphService.validateGraph(graph, template);
  return { graph, lostEdges, renamedEdges };
}

// Pre-activation readiness: the new edition must be fully usable BEFORE it replaces the live one. Checked without activating anything:
// it has its stored PDF and fields, and every supplement/component the live edition serves can be sliced from the new PDF (page ranges are
// re-derived from the new edition's own text, never inherited). Returns { ready, problems[], components }.
async function checkEditionReady(template, previous) {
  const problems = [];
  if (!template.artifacts?.form?.storageKey) problems.push("the new edition has no stored PDF");
  if (!(template.formFields || []).length) problems.push("the new edition has no fields");
  let components = [];
  try {
    const USCISFormComponentDiscoveryService = require("../../uscis-forms/services/USCISFormComponentDiscoveryService");
    const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");
    const discovery = await USCISFormComponentDiscoveryService.discoverComponentsForParentForm(template.formCode, { templateId: template._id });
    if (discovery.error) problems.push(`component slicing failed: ${discovery.error}`);
    components = discovery.results || [];
    const VisaFormMapping = require("../../../models/VisaFormMapping");
    const inUse = new Set(await VisaFormMapping.distinct("componentCode", { parentForm: template.formCode }));
    // only components something depends on: used by a registry row, or a manually registered continuation sheet (stale duplicates are ignored)
    const needed = previous
      ? (await USCISFormComponentDefinition.find({ parentTemplateId: previous._id, status: "ACTIVE" }).select("componentCode verificationMethod").lean())
          .filter((item) => inUse.has(item.componentCode) || item.verificationMethod === "manual_registration_not_visa_driven")
      : [];
    for (const { componentCode } of needed) {
      const found = components.find((item) => item.componentCode === componentCode);
      if (!found || found.status !== "ACTIVE") problems.push(`component ${componentCode} could not be sliced from the new edition${found?.reviewReason ? ": " + found.reviewReason : ""}`);
    }
  } catch (error) {
    problems.push(`component check failed: ${error.message}`);
  }
  return { ready: problems.length === 0, problems, components };
}

// Returns { migrated, activated, reason?, lostEdges, summary }. Never throws for a "needs a person" outcome - only for real faults.
async function migrateMappingToEdition(template, user, req, options = {}) {
  if (!template) return { migrated: false, reason: "no_template" };
  if (template.mappingStatus === "active") return { migrated: false, activated: true, reason: "already_active" };

  const previous = options.previousTemplate || (await findPreviousEdition(template));
  const crosswalk = CROSSWALK_BUILDERS[template.formCode];
  let graph;
  let lostEdges = [];
  let renamedEdges = [];
  let source;

  if (crosswalk) {
    graph = crosswalk()(template);
    source = "crosswalk";
  } else if (previous) {
    const previousGraph = await MappingGraphService.loadCurrentGraph(previous);
    if (!previousGraph?.edges?.length) return { migrated: false, reason: "previous_edition_has_no_mapping" };
    ({ graph, lostEdges, renamedEdges } = carryForwardGraph(previousGraph, template));
    source = `edition ${previous.version}`;
  } else {
    return { migrated: false, reason: "no_previous_edition_or_crosswalk" };
  }

  if (!graph.edges.length) return { migrated: false, reason: "no_fields_matched", source, lostEdges };

  const existing = (await USCISMappingVersion.find({ template: template._id }).lean()).find((version) => {
    const { mappingVersion: _a, ...left } = version.graph || {};
    const { mappingVersion: _b, ...right } = graph;
    return MappingGraphService.graphChecksum(left) === MappingGraphService.graphChecksum(right);
  });
  const version = existing || (await MappingGraphService.persistVersion(template, graph, user));
  if (existing) {
    template.latestMappingVersionId = existing._id;
    template.mappingVersion = existing.mappingVersion;
    await template.save();
  }

  const summary = { source, edges: graph.edges.length, formFields: graph.summary.formFields, lost: lostEdges.length, renamed: renamedEdges.length, validation: graph.validation.summary };
  const lossless = lostEdges.length === 0 && graph.validation.readyForActivation;
  if (!lossless || options.activate === false) {
    return { migrated: true, activated: false, reason: lostEdges.length ? "fields_removed_in_new_edition" : "graph_not_ready", mappingVersion: version.mappingVersion, lostEdges, renamedEdges, summary };
  }
  try {
    await MappingGraphService.activate(template._id, user, req);
  } catch (error) {
    return { migrated: true, activated: false, reason: error.code || "activation_refused", message: error.message, mappingVersion: version.mappingVersion, lostEdges, summary };
  }
  return { migrated: true, activated: true, mappingVersion: version.mappingVersion, lostEdges, renamedEdges, summary };
}

module.exports = { migrateMappingToEdition, carryForwardGraph, findPreviousEdition, checkEditionReady };
