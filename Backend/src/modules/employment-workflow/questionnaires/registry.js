const h1b = require("./h1b");
const l1a = require("./l1a");
const p = require("./p");
const o1 = require("./o1");

// One entry per employer-sponsored visa type. Add a new file + require it here
// to support another visa type without touching the controller.
const DEFINITIONS = [h1b, l1a, p, o1];

function getDefinition(visaType) {
  return DEFINITIONS.find((definition) => definition.matches(visaType)) || null;
}

function hasDefinition(...visaTypes) {
  return visaTypes.some((visaType) => Boolean(getDefinition(visaType)));
}

function normalizeEmployer(visaType, payload) {
  const definition = getDefinition(visaType);
  return definition ? definition.normalizeEmployer(payload) : null;
}

function normalizeEmployee(visaType, payload, profile) {
  const definition = getDefinition(visaType);
  return definition ? definition.normalizeEmployee(payload, profile) : null;
}

function employerConditionalDocuments(visaType, questionnaire) {
  const definition = getDefinition(visaType);
  return definition?.employerConditionalDocuments ? definition.employerConditionalDocuments(questionnaire) : {};
}

function standardDocuments(visaType) {
  const definition = getDefinition(visaType);
  if (!definition) return [];
  return [...(definition.employerDocuments || []), ...(definition.employeeDocuments || [])];
}

function fieldCatalog(visaType) {
  const definition = getDefinition(visaType);
  return definition?.fieldCatalog ? definition.fieldCatalog() : [];
}

module.exports = {
  getDefinition,
  hasDefinition,
  normalizeEmployer,
  normalizeEmployee,
  employerConditionalDocuments,
  standardDocuments,
  fieldCatalog,
};
