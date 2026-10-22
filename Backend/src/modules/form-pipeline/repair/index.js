// Phase 4: the concrete repair strategies the runner's repair framework (repair -> VERIFY -> retry once, one try per strategy per job) was built for, and the inspector that
// lets the runner see a failed certification. Registered by FormPipeline.services(); see guard.js for what is never repaired automatically.
const { createRenormalizePdfStrategy } = require("./renormalizePdf");
const { createRediscoverComponentsStrategy } = require("./rediscoverComponents");
const { createClearTemplateCacheStrategy } = require("./clearTemplateCache");
const { createCertificationInspector } = require("./certificationInspector");
const guard = require("./guard");

/** The registered strategies, in the order they are tried. deps (tests): { renormalize, rediscover, cache } dependency bags. */
function defaultStrategies(deps = {}) {
  return [createRenormalizePdfStrategy(deps.renormalize), createRediscoverComponentsStrategy(deps.rediscover), createClearTemplateCacheStrategy(deps.cache)];
}

module.exports = { defaultStrategies, createCertificationInspector, createRenormalizePdfStrategy, createRediscoverComponentsStrategy, createClearTemplateCacheStrategy, ...guard };
