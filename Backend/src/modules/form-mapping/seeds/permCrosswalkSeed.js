// Shared builder for the PERM-sourced mapping graphs of I-485 / I-765 / I-131 (i140-perm-mapping.seed.js
// is the same structure, written first for I-140). Converts a reviewed crosswalk into a
// USCISMappingVersion graph for the form's ACTIVE USCISFormTemplate and activates it. Idempotent by
// content checksum; every earlier mapping version is kept (append-only), so it is reversible.
// Required fields the PERM checklist cannot supply are published on graph.missingSourceTargets (explicit
// MISSING_SOURCE / UNMAPPED, shown to the Case Manager) - graph.unmappedTargets must stay empty or
// MappingGraphService.activate refuses the graph.
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const User = require("../../../models/User");
const MappingGraphService = require("../services/MappingGraphService");

async function resolveSystemActor() {
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  return admin || { _id: undefined, role: "super_admin" };
}

function profileOwnerFor(path) {
  if (typeof path !== "string") return "employee";
  if (path.startsWith("case.")) return "case";
  if (path.startsWith("company.") || path.startsWith("employer.")) return "employer";
  return "employee"; // person.* / contact.* / immigration.*
}

function contentChecksum(graph) {
  const { mappingVersion, ...rest } = graph || {};
  return MappingGraphService.graphChecksum(rest);
}

// { formCode, crosswalk, missingSource: [{ fieldName?, item, formSection, reason, group, note, required }] }
function createPermCrosswalkSeed({ formCode, crosswalk, missingSource }) {
  const { MAPPED_EDGES, classifyField } = crosswalk;
  const edgePath = (edge) => edge.canonicalPath || edge.source;

  function buildGraph(template) {
    const version = template.version || String(template.editionDate || "unknown");
    const targetFields = MappingGraphService.getTemplateFields(template);
    const edges = [];
    const classification = { mapped: 0, manual_entry: 0, out_of_scope: 0, uscis_use_only: 0 };
    const sourcePaths = new Set();
    const lowConfidenceTargets = [];
    targetFields.forEach((targetField) => {
      const result = classifyField({ fieldName: targetField.targetPdfField, pageNumber: targetField.pageNumber });
      classification[result.status] = (classification[result.status] || 0) + 1;
      if (result.status !== "mapped") return;
      const { edge } = result;
      // LOW confidence = "may help, but must not be populated without review": never an active edge.
      // Published instead on graph.lowConfidenceTargets so the Case Manager sees the suggestion.
      if (edge.confidenceLevel === "LOW" || edge.status === "review_required") {
        lowConfidenceTargets.push({ formCode, targetPdfField: targetField.targetPdfField, targetLabel: targetField.label, canonicalPath: edgePath(edge), checklistField: edge.checklistField, confidenceLevel: "LOW", formPage: targetField.pageNumber, note: edge.note });
        return;
      }
      sourcePaths.add(edgePath(edge));
      edges.push({
        mappingId: `${formCode}:${version}:${targetField.targetFieldId}`,
        formCode,
        editionDate: template.editionDate,
        version,
        sourcePath: edgePath(edge),
        sourceType: "canonical",
        targetFieldId: targetField.targetFieldId,
        targetPdfField: targetField.targetPdfField,
        targetLabel: targetField.label,
        targetType: targetField.type,
        section: targetField.section,
        pageNumber: targetField.pageNumber,
        mappingType: edge.transform?.type === "date" ? "date" : "direct",
        confidence: edge.confidence,
        confidenceLevel: edge.confidenceLevel,
        status: "active",
        transform: edge.transform || { type: "direct" },
        condition: edge.condition,
        note: edge.note,
        checklistField: edge.checklistField,
        sourceChecklist: edge.sourceChecklist || "perm_employee_information",
        canonicalPath: edgePath(edge),
        pdfFieldName: targetField.targetPdfField,
        formSection: edge.formSection,
        formItem: edge.formItem || edge.item,
        formPage: edge.formPage || targetField.pageNumber,
        dataType: edge.dataType,
        required: edge.required,
        source: "PERM checklist",
        profileOwner: profileOwnerFor(edgePath(edge)),
        allowsOccurrenceOverride: false,
      });
    });
    const mappedFieldNames = new Set(edges.map((edge) => edge.targetPdfField));
    const missingSourceTargets = (missingSource || [])
      .filter((entry) => !entry.fieldName || !mappedFieldNames.has(entry.fieldName))
      .map((entry) => ({ ...entry, formCode, reason: "MISSING_SOURCE", confidenceLevel: "UNMAPPED" }));
    const graph = {
      templateId: String(template._id),
      formCode,
      formName: template.title,
      editionDate: template.editionDate,
      version,
      nodes: {
        canonical: [...sourcePaths].map((path) => ({ id: `canonical:${path}`, path, label: path, type: "text" })),
        form: targetFields.map((field) => ({
          id: `form:${field.targetFieldId}`, fieldId: field.targetFieldId, pdfField: field.targetPdfField, label: field.label,
          type: field.type, section: field.section, pageNumber: field.pageNumber, required: field.required,
        })),
      },
      edges,
      unmappedTargets: [],
      missingSourceTargets,
      lowConfidenceTargets,
      classification,
      summary: {
        sourceFields: sourcePaths.size,
        formFields: targetFields.length,
        mappedFields: edges.length,
        activeMappings: edges.length,
        reviewRequired: edges.filter((edge) => edge.status !== "active").length,
        missingSource: missingSourceTargets.length,
        mappingCoverage: targetFields.length ? Math.round((edges.length / targetFields.length) * 100) : 100,
      },
    };
    graph.validation = MappingGraphService.validateGraph(graph, template);
    return graph;
  }

  // `template` (optional): seed a specific edition - e.g. a newly imported draft that is not active yet - instead of
  // the currently active one. Used by the edition-replacement flow so a new edition is fully mapped BEFORE it goes live.
  async function seed({ user, template: explicitTemplate } = {}) {
    const template = explicitTemplate || await USCISFormTemplate.findOne({ formCode, status: "active" }).sort({ createdAt: -1 });
    if (!template) {
      const error = new Error(`No active USCISFormTemplate found for ${formCode}.`);
      error.code = `${formCode.replace("-", "")}_TEMPLATE_NOT_FOUND`;
      throw error;
    }
    const actor = user || (await resolveSystemActor());
    const graph = buildGraph(template);
    const checksum = contentChecksum(graph);
    // A crosswalk may carry edges for more than one edition (renamed widgets); only edges whose field exists in THIS
    // template can match, so compare against those.
    const templateFieldNames = new Set(MappingGraphService.getTemplateFields(template).map((field) => field.targetPdfField));
    const applicableEdges = MAPPED_EDGES.filter((edgeSpec) => templateFieldNames.has(edgeSpec.fieldName)).length;
    if (graph.summary.mappedFields + (graph.lowConfidenceTargets || []).length !== applicableEdges) {
      console.warn(`WARNING: ${applicableEdges} crosswalk edges apply to this ${formCode} edition but ${graph.summary.mappedFields} (+${(graph.lowConfidenceTargets || []).length} low-confidence) were mapped.`);
    }
    const existingVersions = await USCISMappingVersion.find({ template: template._id }).sort({ mappingVersion: -1 }).lean();
    const existingWithChecksum = existingVersions.find((version) => contentChecksum(version.graph) === checksum);
    if (existingWithChecksum) {
      if (existingWithChecksum.status !== "active") {
        template.mappingVersion = existingWithChecksum.mappingVersion;
        await template.save();
        await MappingGraphService.activate(template._id, actor, null);
      }
    } else {
      const latest = await USCISMappingVersion.findOne({ template: template._id }).sort({ mappingVersion: -1 });
      template.mappingVersion = (latest?.mappingVersion || 0) + 1;
      await template.save();
      await MappingGraphService.persistVersion(template, graph, actor);
      await MappingGraphService.activate(template._id, actor, null);
    }
    const refreshed = await USCISFormTemplate.findById(template._id);
    const active = await USCISMappingVersion.findById(refreshed.activeMappingVersionId);
    return { template: refreshed, mappingVersion: active, graph, classification: graph.classification };
  }

  function runCli(label) {
    if (require.main !== module && !process.argv[1]?.includes(label)) return;
    mongoose.connect(env.mongoUri)
      .then(() => seed({}))
      .then(({ template, mappingVersion, classification, graph }) => {
        console.log(`${formCode} mapping seeded and activated.`);
        console.log("  mappingVersion:", mappingVersion.mappingVersion, "| status:", mappingVersion.status, "| template.mappingStatus:", template.mappingStatus);
        console.log("  classification:", JSON.stringify(classification));
        console.log(`  mapped edges: ${graph.edges.length} | missing-source entries: ${graph.missingSourceTargets.length} | valid: ${graph.validation.valid}`);
      })
      .then(() => mongoose.disconnect())
      .then(() => process.exit(0))
      .catch(async (error) => {
        console.error(`Failed to seed ${formCode} mapping:`, error.message);
        if (error.details) console.error("  details:", JSON.stringify(error.details.summary || error.details).slice(0, 600));
        await mongoose.disconnect().catch(() => {});
        process.exit(1);
      });
  }

  return { seed, buildGraph, runCli };
}

module.exports = { createPermCrosswalkSeed };
