// Phase 7.E assembly: the default resolver (catalog loaded from catalog/, MongoDB solution store) and the pieces for tests.
const { diagnose, signatureOf, normalizeMessage, CAUSES, REASON_CODES, RETRY_FIRST_CAUSES } = require("./Diagnoser");
const { createResolver } = require("./Resolver");
const { createDiscovery } = require("./Discovery");
const { createMemoryStore, createMongoStore } = require("./solutionStore");
const { loadCatalog } = require("./catalog");

let defaultResolver = null;

/** The application's resolver; built once. `log` defaults to the app logger. Tests build their own with createResolver. */
function createDefaultResolver({ log = require("../../../utils/logger") } = {}) {
  if (!defaultResolver) {
    defaultResolver = createResolver({
      catalog: loadCatalog({ log }),
      store: createMongoStore(),
      log,
      // the diagnosis of a missing tool checks the configured path and runs the tool once; tests inject their own
      diagnoseDeps: { configuredToolPath: () => require("../../../config/env").qpdfPath },
    });
  }
  return defaultResolver;
}

module.exports = { createDefaultResolver, createResolver, createDiscovery, createMemoryStore, createMongoStore, loadCatalog, diagnose, signatureOf, normalizeMessage, CAUSES, REASON_CODES, RETRY_FIRST_CAUSES };
