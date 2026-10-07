// Which case types actually have a checklist behind them. A case type "has a checklist" when at least one authored checklist is
// associated with it by any of the ways the platform provisions one:
//   default   an isDefault template whose visaType/visaTypes match (assigned automatically at case creation)
//   registry  a VisaFormMapping checklistMapping (AUTO / CONDITIONAL / EXPLICIT_CM) pointing at a template that exists
//   optional  a non-default authored template explicitly listing the visa type (offered by the case manager)
// Auto-generated "uscis_library_*" form questionnaires are not authored checklists and never count.
// The Create Case dropdown offers only case types that have one, so a staff member cannot create a case that would sit empty.

const norm = (value) => String(value || "").replace(/[-\s/]/g, "").toUpperCase();
const isAuthored = (key) => !/^uscis_library_/.test(String(key || ""));

// Pure: templates = [{key,isDefault,visaType,visaTypes}], registryRows = [{visaType,checklistMappings:[{checklistKey}]}]
function computeChecklistCoverage(visaTypes, templates, registryRows) {
  const authored = templates.filter((template) => isAuthored(template.key));
  const byKey = new Map(authored.map((template) => [template.key, template]));
  const covers = (template, visaType) => [template.visaType, ...(template.visaTypes || [])].some((value) => norm(value) === norm(visaType));
  const coverage = {};
  for (const visaType of visaTypes) {
    const defaults = authored.filter((template) => template.isDefault && covers(template, visaType)).map((template) => template.key);
    const registry = [...new Set(registryRows.filter((row) => row.visaType === visaType).flatMap((row) => (row.checklistMappings || []).map((mapping) => mapping.checklistKey)))].filter((key) => byKey.has(key));
    const optional = authored.filter((template) => !template.isDefault && covers(template, visaType)).map((template) => template.key);
    coverage[visaType] = { default: defaults, registry, optional, hasChecklist: Boolean(defaults.length || registry.length || optional.length) };
  }
  return coverage;
}

// DB-backed: authored templates from the database plus the code definitions (so a template not yet written to the database still counts).
async function loadChecklistCoverage(visaTypes) {
  const Questionnaire = require("../../models/Questionnaire");
  const VisaFormMapping = require("../../models/VisaFormMapping");
  const [stored, registryRows] = await Promise.all([
    Questionnaire.find({ latestVersion: true, status: { $ne: "archived" }, isActive: { $ne: false } }).select("key isDefault visaType visaTypes").lean(),
    VisaFormMapping.find({ active: true }).select("visaType checklistMappings").lean(),
  ]);
  const { VISA_TEMPLATE_DEFINITIONS } = require("./questionnaire.service");
  const known = new Set(stored.map((template) => template.key));
  const fromCode = (VISA_TEMPLATE_DEFINITIONS || []).filter((definition) => !known.has(definition.key))
    .map((definition) => ({ key: definition.key, isDefault: Boolean(definition.isDefault), visaType: definition.visaType, visaTypes: definition.visaTypes }));
  return computeChecklistCoverage(visaTypes, [...stored, ...fromCode], registryRows);
}

module.exports = { computeChecklistCoverage, loadChecklistCoverage, norm };
