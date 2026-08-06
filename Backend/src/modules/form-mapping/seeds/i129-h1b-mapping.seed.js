// node src/modules/form-mapping/seeds/i129-h1b-mapping.seed.js
// (or: npm run seed:i129-mapping, from Backend/)
//
// Phase H1 — converts the reviewed crosswalk (../config/i129-h1b-crosswalk.js)
// into a USCISMappingVersion graph for the active I-129 template and
// activates it. Idempotent: re-running with an unchanged crosswalk produces
// the same graph checksum and is a no-op (or re-activates if somehow
// retired); a changed crosswalk creates version N+1 via
// MappingGraphService.persistVersion/activate, which itself retires the
// prior active version - never mutates an existing USCISMappingVersion's
// (immutable) graph in place.
//
// As of the L-1A crosswalk addition, the graph this seed produces covers
// BOTH H-1B and L-1A/L-1B - there is no separate "i129-l1a-mapping.seed.js"
// (USCISFormTemplate only supports one active mapping version per template,
// so a second independently-run seed against the same I-129 template would
// fight this one over that single slot). Re-run this same seed after any
// crosswalk change, for any visa type sharing this form.
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const User = require("../../../models/User");
const MappingGraphService = require("../services/MappingGraphService");
const { classifyField, MAPPED_EDGES } = require("../config/i129-h1b-crosswalk");

const FORM_CODE = "I-129";
const VERSION = "2026-02-27";

async function resolveSystemActor() {
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  return admin || { _id: undefined, role: "super_admin" };
}

// Builds a MappingGraphService-compatible graph directly from the reviewed
// crosswalk, rather than via MappingGraphService.generateGraph()'s fuzzy
// auto-suggest (that's a draft-only tool per the task - see §3b). Mirrors
// the shape MappingGraphService.buildEdge()/generateGraph() themselves
// produce so downstream code (applyGraphToTemplate, validateGraph,
// FormMappingService.mapTemplate) sees nothing unusual.
function buildCrosswalkGraph(template) {
  const targetFields = MappingGraphService.getTemplateFields(template);
  const edges = [];
  const classification = { mapped: 0, manual_entry: 0, out_of_scope: 0, uscis_use_only: 0 };
  const sourcePaths = new Set();

  targetFields.forEach((targetField) => {
    // classifyField matches on the RAW AcroForm field name (targetPdfField),
    // not targetFieldId (a separately normalized/slugified identifier that
    // does not match this crosswalk's fieldName keys - see the crosswalk
    // file's own note). The resulting edge still targets targetFieldId,
    // since that's what FormMappingService.applyMappingGraph looks up by.
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
    });
  });

  const graph = {
    templateId: String(template._id),
    formCode: FORM_CODE,
    formName: template.title,
    editionDate: template.editionDate,
    version: VERSION,
    // Deliberately no `generatedAt: new Date()` here (unlike
    // MappingGraphService.generateGraph()'s own auto-suggest path) - this
    // graph is checksummed (MappingGraphService.graphChecksum hashes
    // JSON.stringify(graph)) to decide idempotency (§3e/AC6), so it must be
    // byte-for-byte deterministic across runs of the same crosswalk. A live
    // timestamp here would make every run "look changed" and create a new
    // USCISMappingVersion every time, defeating idempotency entirely -
    // confirmed empirically (this was AC6's original failure).
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
    // Every field was explicitly classified by classifyField() (mapped,
    // manual_entry, out_of_scope, or uscis_use_only) - nothing is left in an
    // "unaddressed, needs triage" state, so this stays empty rather than
    // listing every non-mapped field (that's what `classification` is for).
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

// MappingGraphService.applyGraphToTemplate (called from inside persistVersion,
// before persistVersion computes/stores ITS OWN checksum) mutates the graph
// object we pass it by appending a `mappingVersion` field
// (`graph.mappingVersion = template.mappingVersion`, an ever-incrementing
// integer) - see MappingGraphService.js around line 283. That means the
// checksum persistVersion actually stores on the USCISMappingVersion document
// is computed on a graph that includes this version-dependent field, so it
// can never equal a checksum computed on our freshly-built (pre-mutation)
// graph - every re-run would look "changed" and create a new version, even
// with byte-identical crosswalk content. This is a real bug in the existing
// service, but MappingGraphService/FormMappingService/MappingResolver are out
// of scope to edit (task constraint 3f) - worked around entirely here by
// comparing CONTENT checksums (the version-dependent field stripped from both
// sides) instead of trusting the polluted stored `.checksum` field.
function contentChecksum(graph) {
  const { mappingVersion, ...rest } = graph || {};
  return MappingGraphService.graphChecksum(rest);
}

async function seedI129H1bMapping({ user } = {}) {
  const template = await USCISFormTemplate.findOne({ formCode: FORM_CODE, version: VERSION });
  if (!template) {
    const error = new Error(`No USCISFormTemplate found for ${FORM_CODE} ${VERSION} - run Phase H0's seed:i129 first.`);
    error.code = "I129_TEMPLATE_NOT_FOUND";
    throw error;
  }
  if (template.status !== "active") {
    const error = new Error(`USCISFormTemplate ${FORM_CODE} ${VERSION} is not active (status: ${template.status}) - Phase H0 must complete first.`);
    error.code = "I129_TEMPLATE_NOT_ACTIVE";
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

module.exports = seedI129H1bMapping;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedI129H1bMapping({}))
    .then(({ template, mappingVersion, classification }) => {
      console.log("I-129 mapping seeded and activated (covers H-1B and L-1A/L-1B).");
      console.log("  templateId:", String(template._id));
      console.log("  mappingVersion:", mappingVersion.mappingVersion, "| status:", mappingVersion.status, "| checksum:", mappingVersion.checksum.slice(0, 12) + "...");
      console.log("  template.mappingStatus:", template.mappingStatus, "| activeMappingVersionId:", String(template.activeMappingVersionId));
      console.log("  classification:", JSON.stringify(classification));
      console.log(`  mapped edges: ${MAPPED_EDGES.length}`);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Failed to seed I-129 H-1B mapping:", error.message);
      if (error.code) console.error("  code:", error.code);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
