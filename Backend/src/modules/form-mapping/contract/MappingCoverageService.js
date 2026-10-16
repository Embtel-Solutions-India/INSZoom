// Phase 2: MappingCoverageService - one compact report of how well a form's mapping covers the form, composed from what the contract validator, the policy and the
// default-value classifier already know. Pure `computeCoverage`; `persistCoverage` stores it on the mapping VERSION document (small), never on the template
// document (the I-129 template is already ~15.85 MB of the 16 MB limit).
const { originOf, summarize } = require("./MappingPolicy");
const { validateGraphContract } = require("./MappingContractValidator");
const { summarizeDefaults } = require("./defaultValueClassifier");

const CAP = 50; // lists are capped: this is a report, not an export

function computeCoverage({ template = {}, graph = {}, universe, getTemplateFields, libraryItems = [] }) {
  const fields = getTemplateFields ? getTemplateFields(template) : template.formFields || [];
  const edges = graph.edges || [];
  const active = edges.filter((edge) => edge.status === "active");
  const contract = validateGraphContract(graph, template, { universe, getTemplateFields });

  // required vs optional fields that no active edge fills
  const mapped = new Set(active.map((edge) => edge.targetFieldId));
  const requiredUnmapped = [];
  let optionalUnmapped = 0;
  for (const field of fields) {
    const id = field.targetFieldId || field.fieldId || field.id || field.fieldName;
    if (!id || mapped.has(id)) continue;
    if (field.required) { if (requiredUnmapped.length < CAP) requiredUnmapped.push(id); } else optionalUnmapped += 1;
  }

  // checklist questions that belong to this form's template but whose canonical path no active edge reads
  const readPaths = new Set(active.map((edge) => edge.sourcePath));
  const questionsWithoutField = libraryItems.filter((item) => item.canonicalPath && !readPaths.has(item.canonicalPath)).map((item) => item.canonicalPath);

  // sources the engine cannot resolve for any case (edges reading nowhere) and conditions that point at nothing
  const unpopulated = contract.legacy.concat(contract.errors).filter((item) => item.code === "PATH_UNKNOWN").map((item) => item.sourcePath);
  const unreachable = contract.legacy.concat(contract.errors).filter((item) => item.code === "CONDITION_PATH_UNKNOWN").map((item) => item.mappingId);

  // conflicting sources: two edges writing the same form field
  const perTarget = {};
  edges.forEach((edge) => { perTarget[edge.targetFieldId] = (perTarget[edge.targetFieldId] || 0) + 1; });
  const duplicateTargets = Object.entries(perTarget).filter(([, count]) => count > 1).map(([id]) => id);

  // registry paths nothing in this form reads: only counted (a WARNING class, never an error)
  const defaults = summarizeDefaults(template.formFields || []);
  const { byOrigin, byStatus } = summarize(graph);
  return {
    generatedAt: new Date(),
    formCode: template.formCode,
    version: template.version,
    mappingVersion: graph.mappingVersion,
    fields: {
      total: fields.length,
      mapped: mapped.size,
      coveragePercent: fields.length ? Math.round((mapped.size / fields.length) * 100) : 100,
      requiredUnmapped: requiredUnmapped.length,
      requiredUnmappedFields: requiredUnmapped,
      optionalUnmapped,
      unmappedByClass: { intentional: contract.unmapped.intentional, out_of_scope: contract.unmapped.out_of_scope, optional: contract.unmapped.optional, unresolved: contract.unmapped.unresolved },
    },
    edges: { total: edges.length, byStatus, byOrigin, legacy: edges.filter((edge) => originOf(edge) === "legacy").length },
    questions: { withoutPdfField: questionsWithoutField.length, paths: questionsWithoutField.slice(0, CAP) },
    unpopulatedSources: { count: unpopulated.length, paths: [...new Set(unpopulated)].slice(0, CAP) },
    unreachableConditions: { count: unreachable.length, edges: unreachable.slice(0, CAP) },
    conflicts: { duplicateTargets: duplicateTargets.length, targets: duplicateTargets.slice(0, CAP), recorded: (graph.conflicts || []).length },
    contract: { valid: contract.valid, ...contract.summary },
    defaults: { total: defaults.total, categories: defaults.categories, flaggedCount: defaults.flagged.length },
    warnings: [
      ...(contract.summary.legacyViolations ? [{ code: "LEGACY_CONTRACT_VIOLATIONS", count: contract.summary.legacyViolations }] : []),
      ...(defaults.flagged.length ? [{ code: "FLAGGED_DEFAULT_VALUES", count: defaults.flagged.length }] : []),
      ...(requiredUnmapped.length ? [{ code: "REQUIRED_FIELDS_UNMAPPED", count: requiredUnmapped.length }] : []),
    ],
  };
}

/** Stores the report on the mapping version (validation.coverage). Best effort: a failure never affects the caller. */
async function persistCoverage(mappingVersionId, coverage, { model = require("../../../models/USCISMappingVersion") } = {}) {
  if (!mappingVersionId) return false;
  try {
    await model.updateOne({ _id: mappingVersionId }, { $set: { "validation.coverage": coverage } });
    return true;
  } catch {
    return false;
  }
}

module.exports = { computeCoverage, persistCoverage };
