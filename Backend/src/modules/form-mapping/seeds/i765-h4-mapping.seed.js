// node src/modules/form-mapping/seeds/i765-h4-mapping.seed.js
// (or: npm run seed:i765-h4-mapping, if wired into package.json)
//
// Converts the reviewed crosswalk (../config/i765-h4-crosswalk.js) into a
// USCISMappingVersion graph for the active I-765 template and activates it.
// Structurally mirrors i129-h1b-mapping.seed.js / i539-h4-mapping.seed.js
// (idempotency via content-checksum comparison, classifyProfileOwner, the
// applyGraphToTemplate mutation workaround) — see i129-h1b-mapping.seed.js
// for the full rationale; only the differences are called out here.
//
// ============================================================================
// IMPORTANT DEVIATION FROM THE I-539/I-129 SEED PATTERN — read before running.
// ============================================================================
// Unlike I-539 (already imported/activated in this repo from a real checked-
// in PDF) or I-129, there is NO USCISFormTemplate for I-765 anywhere in this
// codebase as of this file's authoring — confirmed by searching the full
// Backend/ tree. The crosswalk this seed reads
// (../config/i765-h4-crosswalk.js) was built against a live-fetched public
// I-765 PDF, not a template already sitting in Mongo. Because of that:
//
//   1. This seed does NOT hardcode an exact `editionDate`/`version` the way
//      i539-h4-mapping.seed.js does (that file's crosswalk was built
//      against the EXACT PDF the "2024-08-28" template imports). Instead it
//      looks up whatever active I-765 USCISFormTemplate exists at run time
//      (by formCode only) and uses THAT template's own `.version` for the
//      graph/edge version tag — because the real edition this repo
//      eventually imports (via uscis-form-import's Upload PDF flow, or
//      OnDemandFormAcquisitionService.ensureCurrentUSCISForm("I-765", ...))
//      may not be the exact same PDF bytes this crosswalk's fieldName
//      values were extracted from.
//   2. Before this seed is run for real, a human MUST confirm the active
//      I-765 template's real formFields[].targetPdfField values actually
//      match this crosswalk's fieldName strings (e.g. by diffing against a
//      dump of template.formFields). classifyField() defaults anything
//      unrecognized to manual_entry — safe (no silent misfill of the wrong
//      widget) but means a drifted edition will seed a near-zero-coverage
//      graph rather than error loudly. This seed logs `classification` on
//      every run specifically so that's visible.
//   3. No I-765 USCISFormTemplate import seed was added as part of this
//      change (out of scope — see the crosswalk file's own header). Acquire
//      one first via the existing, unmodified on-demand acquisition path
//      or the registry's Upload PDF flow before running this.
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const User = require("../../../models/User");
const MappingGraphService = require("../services/MappingGraphService");
const { classifyField, MAPPED_EDGES } = require("../config/i765-h4-crosswalk");

const FORM_CODE = "I-765";

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
      mappingType: edge.transform?.type === "date" ? "date" : edge.condition ? "checkbox" : "direct",
      confidence: edge.sourceVerified ? 100 : 60,
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

async function seedI765H4Mapping({ user } = {}) {
  const template = await USCISFormTemplate.findOne({ formCode: FORM_CODE, status: "active" }).sort({ createdAt: -1 });
  if (!template) {
    const error = new Error(
      `No active USCISFormTemplate found for ${FORM_CODE} - import/activate an I-765 template first ` +
      `(uscis-form-import's Upload PDF flow, or OnDemandFormAcquisitionService.ensureCurrentUSCISForm("I-765", ...)). ` +
      `See this file's own header comment before running it.`
    );
    error.code = "I765_TEMPLATE_NOT_FOUND";
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
      `WARNING: 0 of ${graph.summary.formFields} I-765 template fields matched this crosswalk's fieldName values. ` +
      `This almost certainly means the active I-765 template is a different edition than the PDF this crosswalk ` +
      `was authored against - diff template.formFields[].targetPdfField against i765-h4-crosswalk.js before trusting this seed.`
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

module.exports = seedI765H4Mapping;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI765H4Mapping({}))
    .then(({ template, mappingVersion, classification }) => {
      console.log("I-765 H-4 mapping seeded and activated.");
      console.log("  templateId:", String(template._id));
      console.log("  mappingVersion:", mappingVersion.mappingVersion, "| status:", mappingVersion.status, "| checksum:", mappingVersion.checksum.slice(0, 12) + "...");
      console.log("  template.mappingStatus:", template.mappingStatus, "| activeMappingVersionId:", String(template.activeMappingVersionId));
      console.log("  classification:", JSON.stringify(classification));
      console.log(`  mapped edges: ${MAPPED_EDGES.length}`);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Failed to seed I-765 H-4 mapping:", error.message);
      if (error.code) console.error("  code:", error.code);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
