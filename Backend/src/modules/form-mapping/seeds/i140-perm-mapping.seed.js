// node src/modules/form-mapping/seeds/i140-perm-mapping.seed.js
//
// Converts the reviewed crosswalk (../config/i140-perm-crosswalk.js) into a USCISMappingVersion graph
// for the active I-140 template and activates it. Same structure as i907-mapping.seed.js: idempotent by
// content checksum; every earlier mapping version is kept (append-only), so it is reversible by
// re-activating another version. Required fields with no PERM/canonical source are published on
// graph.missingSourceTargets (graph.unmappedTargets must stay empty or activation is refused - see the
// crosswalk header).
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const User = require("../../../models/User");
const MappingGraphService = require("../services/MappingGraphService");
const { classifyField, MAPPED_EDGES, FORM_CODE } = require("../config/i140-perm-crosswalk");

async function resolveSystemActor() {
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  return admin || { _id: undefined, role: "super_admin" };
}

function classifyProfileOwner(sourcePath) {
  if (typeof sourcePath !== "string") return "employee";
  if (sourcePath.startsWith("case.")) return "case";
  if (sourcePath.startsWith("company.") || sourcePath.startsWith("employer.")) return "employer";
  return "employee"; // person.* / contact.* / immigration.*
}

function buildCrosswalkGraph(template) {
  const version = template.version || String(template.editionDate || "unknown");
  const targetFields = MappingGraphService.getTemplateFields(template);
  const edges = [];
  const missingSourceTargets = [];
  const classification = { mapped: 0, manual_entry: 0, out_of_scope: 0, uscis_use_only: 0, missing_source: 0 };
  const sourcePaths = new Set();

  targetFields.forEach((targetField) => {
    const result = classifyField({ fieldName: targetField.targetPdfField, pageNumber: targetField.pageNumber });
    classification[result.status] = (classification[result.status] || 0) + 1;
    if (result.missingSource) {
      classification.missing_source += 1;
      missingSourceTargets.push({
        ...result.missingSource,
        targetFieldId: targetField.targetFieldId,
        targetPdfField: targetField.targetPdfField,
        targetLabel: targetField.label,
        pageNumber: targetField.pageNumber,
        formPage: targetField.pageNumber,
      });
    }
    if (result.status !== "mapped") return;
    const { edge } = result;
    sourcePaths.add(edge.canonicalPath);
    edges.push({
      mappingId: `${FORM_CODE}:${version}:${targetField.targetFieldId}`,
      formCode: FORM_CODE,
      editionDate: template.editionDate,
      version,
      sourcePath: edge.canonicalPath,
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
      status: edge.status,
      transform: edge.transform || { type: "direct" },
      condition: edge.condition,
      note: edge.note,
      checklistField: edge.checklistField,
      sourceChecklist: edge.sourceChecklist,
      canonicalPath: edge.canonicalPath,
      pdfFieldName: edge.pdfFieldName,
      formSection: edge.formSection,
      formItem: edge.formItem,
      formPage: edge.formPage,
      dataType: edge.dataType,
      required: edge.required,
      source: "PERM checklist",
      profileOwner: classifyProfileOwner(edge.canonicalPath),
      allowsOccurrenceOverride: false,
    });
  });

  const graph = {
    templateId: String(template._id),
    formCode: FORM_CODE,
    formName: template.title,
    editionDate: template.editionDate,
    version,
    nodes: {
      canonical: [...sourcePaths].map((path) => ({ id: `canonical:${path}`, path, label: path, type: "text" })),
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
    missingSourceTargets,
    classification,
    summary: {
      sourceFields: sourcePaths.size,
      formFields: targetFields.length,
      mappedFields: edges.length,
      activeMappings: edges.length,
      reviewRequired: edges.filter((e) => e.status !== "active").length,
      missingSource: missingSourceTargets.length,
      mappingCoverage: targetFields.length ? Math.round((edges.length / targetFields.length) * 100) : 100,
    },
  };
  graph.validation = MappingGraphService.validateGraph(graph, template);
  return graph;
}

function contentChecksum(graph) {
  const { mappingVersion, ...rest } = graph || {};
  return MappingGraphService.graphChecksum(rest);
}

async function seedI140PermMapping({ user } = {}) {
  const template = await USCISFormTemplate.findOne({ formCode: FORM_CODE, status: "active" }).sort({ createdAt: -1 });
  if (!template) {
    const error = new Error(`No active USCISFormTemplate found for ${FORM_CODE} - import/activate an I-140 template first.`);
    error.code = "I140_TEMPLATE_NOT_FOUND";
    throw error;
  }

  const actor = user || (await resolveSystemActor());
  const graph = buildCrosswalkGraph(template);
  const checksum = contentChecksum(graph);

  if (graph.summary.mappedFields !== MAPPED_EDGES.length) {
    console.warn(
      `WARNING: ${MAPPED_EDGES.length} crosswalk edges authored but only ${graph.summary.mappedFields} matched the active I-140 template - ` +
      `field names have drifted (edition change?). Diff template.formFields[].targetPdfField against i140-perm-crosswalk.js.`
    );
  }

  const existingVersions = await USCISMappingVersion.find({ template: template._id }).sort({ mappingVersion: -1 }).lean();
  const existingWithChecksum = existingVersions.find((v) => contentChecksum(v.graph) === checksum);
  let mappingVersionDoc;
  if (existingWithChecksum) {
    mappingVersionDoc = existingWithChecksum;
    if (existingWithChecksum.status !== "active") {
      template.mappingVersion = existingWithChecksum.mappingVersion;
      await template.save();
      await MappingGraphService.activate(template._id, actor, null);
    }
  } else {
    const latest = await USCISMappingVersion.findOne({ template: template._id }).sort({ mappingVersion: -1 });
    template.mappingVersion = (latest?.mappingVersion || 0) + 1;
    await template.save();
    mappingVersionDoc = await MappingGraphService.persistVersion(template, graph, actor);
    await MappingGraphService.activate(template._id, actor, null);
  }

  const refreshedTemplate = await USCISFormTemplate.findById(template._id);
  const activeVersion = await USCISMappingVersion.findById(refreshedTemplate.activeMappingVersionId);
  return { template: refreshedTemplate, mappingVersion: activeVersion || mappingVersionDoc, graph, classification: graph.classification };
}

module.exports = seedI140PermMapping;
module.exports.buildCrosswalkGraph = buildCrosswalkGraph;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI140PermMapping({}))
    .then(({ template, mappingVersion, classification, graph }) => {
      console.log("I-140 mapping seeded and activated.");
      console.log("  templateId:", String(template._id));
      console.log("  mappingVersion:", mappingVersion.mappingVersion, "| status:", mappingVersion.status, "| checksum:", mappingVersion.checksum.slice(0, 12) + "...");
      console.log("  template.mappingStatus:", template.mappingStatus, "| activeMappingVersionId:", String(template.activeMappingVersionId));
      console.log("  classification:", JSON.stringify(classification));
      console.log(`  mapped edges: ${MAPPED_EDGES.length} | missing-source required fields: ${graph.missingSourceTargets.length}`);
      console.log("  validation:", JSON.stringify(graph.validation.summary), "valid:", graph.validation.valid);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Failed to seed I-140 mapping:", error.message);
      if (error.code) console.error("  code:", error.code);
      if (error.details) console.error("  details:", JSON.stringify(error.details.summary || error.details).slice(0, 500));
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
