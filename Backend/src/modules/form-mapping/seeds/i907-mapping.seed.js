// node src/modules/form-mapping/seeds/i907-mapping.seed.js
//
// Converts the reviewed crosswalk (../config/i907-crosswalk.js) into a USCISMappingVersion graph for
// the active I-907 template and activates it, replacing the auto-guessed graph. Same structure as
// i765-h4-mapping.seed.js / i539-h4-mapping.seed.js: idempotent by content checksum, and every earlier
// mapping version is kept (never deleted), so the change is reversible by re-activating one.
// The active I-907 template is imported by ../../uscis-form-import/seeds/i907.seed.js (edition 2024-04-01).
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const User = require("../../../models/User");
const MappingGraphService = require("../services/MappingGraphService");
const { classifyField, MAPPED_EDGES } = require("../config/i907-crosswalk");

const FORM_CODE = "I-907";

async function resolveSystemActor() {
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  return admin || { _id: undefined, role: "super_admin" };
}

function classifyProfileOwner(sourcePath) {
  if (typeof sourcePath !== "string") return "employee";
  if (sourcePath.startsWith("case.")) return "case";
  if (sourcePath.startsWith("company.") || sourcePath.startsWith("organization.") || sourcePath.startsWith("employer.")) return "employer";
  if (sourcePath.includes(".employer_") || sourcePath.includes(".petitioner_") || sourcePath.includes(".organization_")) return "employer";
  if (sourcePath.startsWith("beneficiary.") || sourcePath.startsWith("employee.") || sourcePath.startsWith("applicant.")) return "employee";
  if (sourcePath.includes(".employee_") || sourcePath.includes(".beneficiary_") || sourcePath.includes(".applicant_") || sourcePath.includes(".client_")) return "employee";
  if (sourcePath.startsWith("person.") || sourcePath.startsWith("contact.") || sourcePath.startsWith("immigration.")) return "employee";
  return "employee";
}

const ALLOWS_OCCURRENCE_OVERRIDE = false;

function buildCrosswalkGraph(template) {
  const version = template.version || String(template.editionDate || "unknown");
  const targetFields = MappingGraphService.getTemplateFields(template);
  const edges = [];
  const classification = { mapped: 0, manual_entry: 0, out_of_scope: 0, uscis_use_only: 0 };
  const sourcePaths = new Set();

  targetFields.forEach((targetField) => {
    const result = classifyField({ fieldName: targetField.targetPdfField, pageNumber: targetField.pageNumber });
    classification[result.status] = (classification[result.status] || 0) + 1;
    if (result.status !== "mapped") return;
    const { edge } = result;
    sourcePaths.add(edge.source);
    edges.push({
      mappingId: `${FORM_CODE}:${version}:${targetField.targetFieldId}`,
      formCode: FORM_CODE,
      editionDate: template.editionDate,
      version,
      sourcePath: edge.source,
      sourceType: "canonical",
      targetFieldId: targetField.targetFieldId,
      targetPdfField: targetField.targetPdfField,
      targetLabel: targetField.label,
      targetType: targetField.type,
      section: targetField.section,
      pageNumber: targetField.pageNumber,
      mappingType: edge.transform?.type === "date" ? "date" : edge.transform?.type === "boolean" ? "checkbox" : "direct",
      confidence: 100,
      status: "active",
      transform: edge.transform || { type: "direct" },
      condition: edge.condition,
      note: edge.note,
      profileOwner: classifyProfileOwner(edge.source),
      allowsOccurrenceOverride: ALLOWS_OCCURRENCE_OVERRIDE,
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
    classification,
    summary: {
      sourceFields: sourcePaths.size,
      formFields: targetFields.length,
      mappedFields: edges.length,
      activeMappings: edges.length,
      reviewRequired: edges.filter((e) => e.confidence < 100).length,
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

async function seedI907Mapping({ user } = {}) {
  const template = await USCISFormTemplate.findOne({ formCode: FORM_CODE, status: "active" }).sort({ createdAt: -1 });
  if (!template) {
    const error = new Error(
      `No active USCISFormTemplate found for ${FORM_CODE} - import/activate an I-907 template first ` +
      `(uscis-form-import's Upload PDF flow, or OnDemandFormAcquisitionService.ensureCurrentUSCISForm("I-907", ...)). ` +
      `See this file's own header comment before running it.`
    );
    error.code = "I907_TEMPLATE_NOT_FOUND";
    throw error;
  }

  const actor = user || (await resolveSystemActor());
  const graph = buildCrosswalkGraph(template);
  const checksum = contentChecksum(graph);

  if (graph.summary.mappingCoverage === 0) {
    // Not a hard failure - manual_entry is always a safe fallback - but
    // extremely likely to mean the real template's field names have
    // drifted from this crosswalk's authored fieldName values (see the
    // header's edition-drift warning). Logged loudly rather than silently
    // seeding a useless graph.
    console.warn(
      `WARNING: 0 of ${graph.summary.formFields} I-907 template fields matched this crosswalk's fieldName values. ` +
      `This almost certainly means the active I-907 template is a different edition than the PDF this crosswalk ` +
      `was authored against - diff template.formFields[].targetPdfField against i907-crosswalk.js before trusting this seed.`
    );
  }

  const existingVersions = await USCISMappingVersion.find({ template: template._id }).sort({ mappingVersion: -1 }).lean();
  const existingWithChecksum = existingVersions.find((version) => contentChecksum(version.graph) === checksum);
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
  return { template: refreshedTemplate, mappingVersion: activeVersion, graph, classification: graph.classification };
}

module.exports = seedI907Mapping;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI907Mapping({}))
    .then(({ template, mappingVersion, classification }) => {
      console.log("I-907 mapping seeded and activated.");
      console.log("  templateId:", String(template._id));
      console.log("  mappingVersion:", mappingVersion.mappingVersion, "| status:", mappingVersion.status, "| checksum:", mappingVersion.checksum.slice(0, 12) + "...");
      console.log("  template.mappingStatus:", template.mappingStatus, "| activeMappingVersionId:", String(template.activeMappingVersionId));
      console.log("  classification:", JSON.stringify(classification));
      console.log(`  mapped edges: ${MAPPED_EDGES.length}`);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Failed to seed I-907 mapping:", error.message);
      if (error.code) console.error("  code:", error.code);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
