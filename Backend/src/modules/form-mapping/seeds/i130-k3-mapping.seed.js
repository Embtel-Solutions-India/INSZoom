// node src/modules/form-mapping/seeds/i130-k3-mapping.seed.js
// (or: npm run seed:i130-k3-mapping, from Backend/)
//
// Converts the reviewed crosswalk (../config/i130-k3-crosswalk.js) into a
// USCISMappingVersion graph for the active I-130 template and activates it.
// Mirrors i129f-k1-mapping.seed.js's exact mechanics. I-130 is not shared
// with any other visa type's mapping in this codebase, so - like the K-1
// seed - this one is genuinely independent (no single-active-version
// conflict to worry about).
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const User = require("../../../models/User");
const MappingGraphService = require("../services/MappingGraphService");
const { classifyField, MAPPED_EDGES, FORM_CODE, VERSION } = require("../config/i130-k3-crosswalk");

async function resolveSystemActor() {
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  return admin || { _id: undefined, role: "super_admin" };
}

// PHASE 2 — classifies which canonical data store (EmployerProfile,
// EmployeeProfile, or the Case document itself) each edge's sourcePath
// reads from. For this K-3 family case, "petitioner_*" plays the same
// principal-party role "employer_*" plays in an employer/employee case
// (both map to EmployerProfile per Step 21's "employer/petitioner canonical
// data" scope), and "beneficiary_*" plays the same role "employee_*" plays
// (both map to EmployeeProfile per Step 22's "employee or beneficiary"
// scope). "case.*" reads the Case document directly. Unclassifiable paths
// default to 'employee' per the Phase 2 spec.
function classifyProfileOwner(sourcePath) {
  if (typeof sourcePath !== "string") return "employee";
  if (sourcePath.startsWith("case.")) return "case";
  if (sourcePath.startsWith("company.") || sourcePath.startsWith("organization.") || sourcePath.startsWith("employer.") || sourcePath.startsWith("petitioner.")) return "employer";
  if (sourcePath.includes(".employer_") || sourcePath.includes(".petitioner_") || sourcePath.includes(".organization_")) return "employer";
  if (sourcePath.startsWith("beneficiary.") || sourcePath.startsWith("employee.") || sourcePath.startsWith("applicant.")) return "employee";
  if (sourcePath.includes(".employee_") || sourcePath.includes(".beneficiary_") || sourcePath.includes(".applicant_")) return "employee";
  if (sourcePath.startsWith("person.") || sourcePath.startsWith("contact.") || sourcePath.startsWith("immigration.")) return "employee";
  return "employee";
}

// No edge in this crosswalk needs a TRUE override — see the identical note
// in i129-h1b-mapping.seed.js.
const ALLOWS_OCCURRENCE_OVERRIDE = false;

function buildCrosswalkGraph(template) {
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
      mappingId: `${FORM_CODE}:${VERSION}:${targetField.targetFieldId}`,
      formCode: FORM_CODE,
      editionDate: template.editionDate,
      version: VERSION,
      sourcePath: edge.source,
      sourceType: "canonical",
      targetFieldId: targetField.targetFieldId,
      targetPdfField: targetField.targetPdfField,
      targetLabel: targetField.label,
      targetType: targetField.type,
      section: targetField.section,
      pageNumber: targetField.pageNumber,
      mappingType: edge.transform?.type === "date" ? "date" : edge.condition ? "checkbox" : "direct",
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
    version: VERSION,
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
      reviewRequired: 0,
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

async function seedI130K3Mapping({ user } = {}) {
  const template = await USCISFormTemplate.findOne({ formCode: FORM_CODE, version: VERSION });
  if (!template) {
    const error = new Error(`No USCISFormTemplate found for ${FORM_CODE} ${VERSION} - run seed:i130 first.`);
    error.code = "I130_TEMPLATE_NOT_FOUND";
    throw error;
  }
  if (template.status !== "active") {
    const error = new Error(`USCISFormTemplate ${FORM_CODE} ${VERSION} is not active (status: ${template.status}) - seed:i130 must complete first.`);
    error.code = "I130_TEMPLATE_NOT_ACTIVE";
    throw error;
  }

  const actor = user || (await resolveSystemActor());
  const graph = buildCrosswalkGraph(template);
  const checksum = contentChecksum(graph);

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

module.exports = seedI130K3Mapping;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI130K3Mapping({}))
    .then(({ template, mappingVersion, classification }) => {
      console.log("I-130 K-3 mapping seeded and activated.");
      console.log("  templateId:", String(template._id));
      console.log("  mappingVersion:", mappingVersion.mappingVersion, "| status:", mappingVersion.status);
      console.log("  classification:", JSON.stringify(classification));
      console.log(`  mapped edges: ${MAPPED_EDGES.length}`);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Failed to seed I-130 K-3 mapping:", error.message);
      if (error.code) console.error("  code:", error.code);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
