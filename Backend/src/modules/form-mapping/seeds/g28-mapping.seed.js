// node src/modules/form-mapping/seeds/g28-mapping.seed.js
//
// Converts the DRAFT crosswalk (../config/g28-crosswalk.js) into a USCISMappingVersion graph for the latest G-28 template and SAVES it WITHOUT
// activating it: the version waits for a reviewer's approval (form-governance screen / MappingGraphService.activate). Idempotent by content checksum;
// earlier versions are never touched. The G-28 template itself stays in review: activating the template is also a reviewer's decision.
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const User = require("../../../models/User");
const MappingGraphService = require("../services/MappingGraphService");
const { classifyField, MAPPED_EDGES } = require("../config/g28-crosswalk");

const FORM_CODE = "G-28";
const CHECKLIST_KEY = "none";

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
      confidence: edge.sourceVerified === false ? 70 : 100,
      sourceChecklist: CHECKLIST_KEY,
      status: "active",
      transform: edge.transform || { type: "direct" },
      condition: edge.condition,
      fallback: edge.fallback,
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

async function seedG28Mapping({ user } = {}) {
  const template = await USCISFormTemplate.findOne({ formCode: FORM_CODE, status: { $in: ["active", "review"] } }).sort({ version: -1, createdAt: -1 });
  if (!template) {
    const error = new Error(
      `No active USCISFormTemplate found for ${FORM_CODE} - import/activate an G-28 template first ` +
      `(uscis-form-import's Upload PDF flow, or OnDemandFormAcquisitionService.ensureCurrentUSCISForm("G-28", ...)). ` +
      `See this file's own header comment before running it.`
    );
    error.code = "I90_TEMPLATE_NOT_FOUND";
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
      `WARNING: 0 of ${graph.summary.formFields} G-28 template fields matched this crosswalk's fieldName values. ` +
      `This almost certainly means the active G-28 template is a different edition than the PDF this crosswalk ` +
      `was authored against - diff template.formFields[].targetPdfField against g28-crosswalk.js before trusting this seed.`
    );
  }

  const existingVersions = await USCISMappingVersion.find({ template: template._id }).sort({ mappingVersion: -1 }).lean();
  const existingWithChecksum = existingVersions.find((version) => contentChecksum(version.graph) === checksum);
  let mappingVersionDoc;
  if (existingWithChecksum) {
    mappingVersionDoc = existingWithChecksum;
  } else {
    const latest = await USCISMappingVersion.findOne({ template: template._id }).sort({ mappingVersion: -1 });
    template.mappingVersion = (latest?.mappingVersion || 0) + 1;
    await template.save();
    mappingVersionDoc = await MappingGraphService.persistVersion(template, graph, actor);
  }

  const refreshedTemplate = await USCISFormTemplate.findById(template._id);
  const activeVersion = mappingVersionDoc;
  return { template: refreshedTemplate, mappingVersion: activeVersion, graph, classification: graph.classification };
}

module.exports = seedG28Mapping;
module.exports.buildCrosswalkGraph = buildCrosswalkGraph;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedG28Mapping({}))
    .then(({ template, mappingVersion, classification }) => {
      console.log("G-28 mapping saved as a DRAFT version (not activated) - awaiting approval.");
      console.log("  templateId:", String(template._id));
      console.log("  mappingVersion:", mappingVersion.mappingVersion, "| status:", mappingVersion.status, "| checksum:", mappingVersion.checksum.slice(0, 12) + "...");
      console.log("  template.mappingStatus:", template.mappingStatus, "| activeMappingVersionId:", String(template.activeMappingVersionId));
      console.log("  classification:", JSON.stringify(classification));
      console.log(`  mapped edges: ${MAPPED_EDGES.length}`);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Failed to seed G-28 mapping:", error.message);
      if (error.code) console.error("  code:", error.code);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
