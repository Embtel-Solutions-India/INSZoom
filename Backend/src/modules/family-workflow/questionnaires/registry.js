const k1 = require("./k1");
const k3 = require("./k3");

// One entry per family/sponsor visa type. Mirrors
// employment-workflow/questionnaires/registry.js's shape exactly, kept as
// its own separate registry.
const DEFINITIONS = [k1, k3];

function getDefinition(visaType) {
  return DEFINITIONS.find((definition) => definition.matches(visaType)) || null;
}

function hasDefinition(...visaTypes) {
  return visaTypes.some((visaType) => Boolean(getDefinition(visaType)));
}

module.exports = {
  getDefinition,
  hasDefinition,
};
