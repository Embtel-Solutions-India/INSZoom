// Biographic Activation tier: for a USCIS form template that has scanned
// PDF fields but no curated crosswalk (a form imported on-demand from
// uscis.gov, see OnDemandFormAcquisitionService), generates a RESTRICTED
// mapping graph containing only the high-confidence biographic-core edges
// (family name, DOB, address, employer name, ...), persists it as a real
// USCISMappingVersion, and promotes the template to
// mappingStatus:"biographic_active" - a tier BELOW full production
// "active", so AutoFillService can use it for biographic-only autofill
// while VersionManagementService.activate's Gate 2 (mappingStatus !==
// "active") continues to correctly refuse full activation until a human
// completes real curated mapping review.
//
// Reuse, not a new mapping engine (Non-Negotiable Constraint #7):
// MappingGraphService.getTemplateFields/scoreField/buildEdge/validateGraph/
// persistVersion do all the real work here - this module only restricts
// WHICH source/target pairs are allowed to become edges (biographic-core
// canonical paths, confidence >= 72) and owns the extra activation step
// MappingGraphService.activate() itself would refuse to do (that method
// requires validateGraph(...).readyForActivation === true, which a
// deliberately-partial biographic graph can never satisfy - and must not,
// per Constraint #2).
const AuditLog = require("../../../models/AuditLog");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const MappingGraphService = require("./MappingGraphService");
const CanonicalFieldRegistryService = require("./CanonicalFieldRegistryService");

// Same threshold MappingGraphService.buildEdge already uses to mark an edge
// "active" vs "needs_review" (confidence = Math.round(score*100) >= 72) -
// not a new number invented for this tier.
const BIOGRAPHIC_CONFIDENCE_THRESHOLD = 72;

function userId(user) {
  return user?._id || user?.id || null;
}

// CanonicalFieldRegistryService.BASE_FIELDS is not itself exported (only the
// class, with list()/tokenize() as its public surface) - but list(),
// called with no canonicalProfile argument, flattens an empty {} to zero
// discovered fields and returns exactly the static base registry (each
// entry already carrying .id/.label/.tokens, precomputed the same way
// scoreField expects). This is the deterministic "base registry only" set
// the biographic tier needs, with no modification to that file at all.
function biographicSourceFields() {
  return CanonicalFieldRegistryService.list();
}

// Restricted edge-building pass: same target-field iteration
// MappingGraphService.generateGraph performs, but (a) only ever considers
// BASE_FIELDS as candidate sources (never a live canonicalProfile's
// discovered/case-specific fields) and (b) only keeps a match at or above
// the confidence threshold that already means "active" elsewhere in this
// codebase - never generateGraph's own looser 0.34 inclusion threshold,
// which would let low-confidence/needs_review edges into a graph this
// module is about to mark as reviewed.
function generateBiographicGraph(template) {
  const sourceFields = biographicSourceFields();
  const targetFields = MappingGraphService.getTemplateFields(template);
  const edges = [];
  const usedTargets = new Set();

  targetFields.forEach((targetField) => {
    const best = sourceFields
      .map((sourceField) => ({ sourceField, score: MappingGraphService.scoreField(sourceField, targetField) }))
      .sort((left, right) => right.score - left.score)[0];
    const confidence = best ? Math.round(best.score * 100) : 0;
    if (best && confidence >= BIOGRAPHIC_CONFIDENCE_THRESHOLD) {
      edges.push(MappingGraphService.buildEdge(best.sourceField, targetField, template, confidence));
      usedTargets.add(targetField.targetFieldId);
    }
    // Below-threshold or no match at all: deliberately left unmapped
    // (Constraint #2) - never forced in with an inflated confidence.
  });

  const graph = {
    templateId: String(template._id || ""),
    formCode: template.formCode || template.formNumber,
    formName: template.formName || template.title,
    editionDate: template.editionDate,
    version: template.version,
    // No generatedAt - same determinism reasoning as the curated seed's own
    // graph (see i129-h1b-mapping.seed.js's comment): this graph is
    // checksummed for idempotency, so a live timestamp would make every
    // ensureBiographicMapping() call look like a change.
    biographicOnly: true,
    nodes: {
      canonical: sourceFields.map((field) => ({ id: field.id, path: field.path, label: field.label, type: field.type, repeatable: field.repeatable })),
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
    // Honestly populated (Constraint #2) - every template field not matched
    // above threshold is listed here, never dropped from the count.
    unmappedTargets: targetFields.filter((field) => !usedTargets.has(field.targetFieldId)).map((field) => field.targetFieldId),
    summary: {
      sourceFields: sourceFields.length,
      formFields: targetFields.length,
      mappedFields: edges.length,
      activeMappings: edges.length, // every kept edge is >= threshold, so buildEdge already marked it "active"
      reviewRequired: 0,
      mappingCoverage: targetFields.length ? Math.round((edges.length / targetFields.length) * 100) : 100,
    },
  };
  // validateGraph will correctly report readyForActivation: false (unmapped
  // targets exist) - expected and required, never patched around
  // (Constraint #2).
  graph.validation = MappingGraphService.validateGraph(graph, template);

  const coverage = {
    totalFields: targetFields.length,
    biographicMapped: edges.length,
    unmapped: graph.unmappedTargets.length,
    coveragePct: targetFields.length ? Math.round((edges.length / targetFields.length) * 100) : 0,
    sampleMatches: edges.slice(0, 10).map((edge) => ({ canonicalPath: edge.sourcePath, pdfField: edge.targetPdfField, label: edge.targetLabel, confidence: edge.confidence })),
  };

  return { graph, coverage };
}

// Persists the biographic graph as a real USCISMappingVersion (via the
// existing, unmodified MappingGraphService.persistVersion - never a second
// version-storage mechanism), then promotes it: the version itself flips
// from persistVersion's own "needs_review" to "active" (its edges genuinely
// are all high-confidence and reviewed-by-formula, unlike a
// needs_review-status version awaiting human triage), and the TEMPLATE is
// tagged mappingStatus:"biographic_active" - never "active" itself.
// VersionManagementService.activate/MappingGraphService.activate are never
// called here (Constraint #1) - this is a parallel, lower tier, not a
// shortcut through the production gate.
async function persistAndActivateBiographic(template, graph, coverage, user, req) {
  // persistVersion mutates `template` in place via applyGraphToTemplate
  // (sets formFields[i].mappings, mappingGraph, mappingVersion, and - since
  // readyForActivation is false - mappingStatus:"needs_review") and creates
  // the USCISMappingVersion at status "needs_review". Both are expected
  // intermediate states, overridden below.
  const version = await MappingGraphService.persistVersion(template, graph, user);

  await USCISMappingVersion.findByIdAndUpdate(version._id, {
    status: "active",
    activatedBy: userId(user),
    activatedAt: new Date(),
  });

  template.mappingStatus = "biographic_active";
  template.activeMappingVersion = version.mappingVersion;
  template.activeMappingVersionId = version._id;
  await template.save();

  await AuditLog.create({
    userId: userId(user),
    userRole: user?.role,
    action: "BIOGRAPHIC_MAPPING_ACTIVATED",
    entityType: "USCISFormTemplate",
    entityId: String(template._id),
    changes: { formCode: template.formCode, coverage, mappingVersion: version.mappingVersion },
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    source: "api",
  }).catch(() => null);

  return { template, mappingVersion: version, coverage };
}

// Idempotent entry point - safe to call every time a template is acquired/
// re-acquired, mirroring OnDemandFormAcquisitionService's own idempotency
// style.
async function ensureBiographicMapping(template, user, req) {
  if (template.mappingStatus === "active") {
    return { skipped: true, reason: "fully_curated" };
  }
  if (template.mappingStatus === "biographic_active" && template.activeMappingVersionId) {
    const stillCurrent = await USCISMappingVersion.exists({ _id: template.activeMappingVersionId, status: "active" });
    if (stillCurrent) return { skipped: true, reason: "already_biographic_active" };
  }
  const { graph, coverage } = generateBiographicGraph(template);
  const result = await persistAndActivateBiographic(template, graph, coverage, user, req);
  return { skipped: false, ...result };
}

module.exports = {
  BIOGRAPHIC_CONFIDENCE_THRESHOLD,
  generateBiographicGraph,
  persistAndActivateBiographic,
  ensureBiographicMapping,
};
