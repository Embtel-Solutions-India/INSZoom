// Typed settings catalog — schema lives in code (D4), only values live in
// Mongo (SettingValue). Every category module exports an array of entries;
// this aggregator flattens them into one Map keyed by dot-notation `key`
// for O(1) lookup, plus indexes by category for the UI/catalog endpoint.
//
// "Settings Overhaul" pass — organization.registry.js/branding.registry.js/
// integrations.registry.js/roles.registry.js were deleted (their content
// had zero live runtime consumers, confirmed before deleting) and replaced
// by firm/users/portal/intake/email/invoice below, matching Docketwise/
// INSZoom's real settings taxonomy. workflow/modules/ai/data/billing are
// UNCHANGED — their keys already have live consumers (SLA sweep, feature
// flags, AI budget, retention sweep) that this pass did not touch, and
// there was no reason to.
const firm = require("./firm.registry");
const users = require("./users.registry");
const portal = require("./portal.registry");
const notifications = require("./notifications.registry");
const intake = require("./intake.registry");
const email = require("./email.registry");
const invoice = require("./invoice.registry");
const security = require("./security.registry");
const workflow = require("./workflow.registry");
const modules = require("./modules.registry");
const ai = require("./ai.registry");
const data = require("./data.registry");
const billing = require("./billing.registry");

const ALL_ENTRIES = [
  ...firm,
  ...users,
  ...portal,
  ...notifications,
  ...intake,
  ...email,
  ...invoice,
  ...security,
  ...workflow,
  ...modules,
  ...ai,
  ...data,
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
