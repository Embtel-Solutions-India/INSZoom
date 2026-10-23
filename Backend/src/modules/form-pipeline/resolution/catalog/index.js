// Loads every catalog entry in this folder (files starting with "_" and this file are skipped). An entry is { id, description, matches(diagnosis, error, ctx), strategies: [{ id, run, verify }] }.
// A malformed entry is skipped with a warning, never fatal. Order: alphabetical, with "generic" last (it is the portfolio, not a matcher).
const fs = require("fs");
const path = require("path");

function validEntry(entry) {
  return Boolean(entry) && typeof entry.id === "string" && typeof entry.matches === "function" && Array.isArray(entry.strategies)
    && entry.strategies.every((strategy) => strategy && typeof strategy.id === "string" && typeof strategy.run === "function");
}

function loadCatalog({ dir = __dirname, log = { warn() {} } } = {}) {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".js") && name !== "index.js" && !name.startsWith("_")).sort();
  const entries = [];
  for (const name of files) {
    try {
      const loaded = require(path.join(dir, name));
      for (const entry of Array.isArray(loaded) ? loaded : [loaded]) {
        if (validEntry(entry)) entries.push(entry);
        else log.warn("form_pipeline_catalog_entry_invalid", { file: name });
      }
    } catch (error) {
      log.warn("form_pipeline_catalog_entry_failed", { file: name, error: String(error?.message || error).slice(0, 160) });
    }
  }
  return [...entries.filter((entry) => entry.id !== "generic"), ...entries.filter((entry) => entry.id === "generic")];
}

module.exports = { loadCatalog, validEntry };
