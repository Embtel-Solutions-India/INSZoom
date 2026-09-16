// Typed settings catalog — schema lives in code (D4), only values live in
// Mongo (SettingValue). Every category module exports an array of entries;
// this aggregator flattens them into one Map keyed by dot-notation `key`
// for O(1) lookup, plus indexes by category for the UI/catalog endpoint.
const organization = require("./organization.registry");
const security = require("./security.registry");
const notifications = require("./notifications.registry");
const branding = require("./branding.registry");
const workflow = require("./workflow.registry");
const modules = require("./modules.registry");
const ai = require("./ai.registry");
const data = require("./data.registry");
const integrations = require("./integrations.registry");
const roles = require("./roles.registry");
const billing = require("./billing.registry");

const ALL_ENTRIES = [
  ...organization,
  ...security,
  ...notifications,
  ...branding,
  ...workflow,
  ...modules,
  ...ai,
  ...data,
  ...integrations,
  ...roles,
  ...billing,
];

const registryMap = new Map();
for (const entry of ALL_ENTRIES) {
  if (registryMap.has(entry.key)) {
    throw new Error(`Duplicate settings registry key: ${entry.key}`);
  }
  registryMap.set(entry.key, entry);
}

function getRegistryEntry(key) {
  return registryMap.get(key);
}

function listRegistry() {
  return ALL_ENTRIES;
}

function listCategories() {
  return [...new Set(ALL_ENTRIES.map((e) => e.category))];
}

module.exports = { registryMap, getRegistryEntry, listRegistry, listCategories };
