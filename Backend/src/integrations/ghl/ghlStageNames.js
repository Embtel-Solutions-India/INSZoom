const env = require("../../config/env");
const GHLIntegration = require("../../models/GHLIntegration");

// The Pipeline stage a case sits in, by name, so the Cases list and the case Overview show the SAME stage the Pipeline board and
// GoHighLevel show (and the Update Stage button changes). Cases without a GHL card keep showing their CRM stage.

const CACHE_MS = 60 * 1000;
let cache = { at: 0, names: new Map() };

async function nameMap() {
  if (!env.ghl.enabled || !env.ghl.locationId) return new Map();
  if (Date.now() - cache.at < CACHE_MS) return cache.names;
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId }).select("pipelines").lean().catch(() => null);
  const names = new Map();
  (config?.pipelines || []).forEach((pipeline) => (pipeline.stages || []).forEach((stage) => names.set(`${pipeline.ghlPipelineId}:${stage.key}`, stage.name)));
  cache = { at: Date.now(), names };
  return names;
}

/** Adds `pipelineStage` (name) and `pipelineCategory` to each serialized case, from the matching source documents. Never throws. */
async function attachStageNames(sources, serialized) {
  try {
    const names = await nameMap();
    serialized.forEach((out, index) => {
      const source = sources[index];
      const ghl = source?.integrations?.ghl;
      const category = ghl?.category || source?.pipelineCategory;
      if (out && category) out.pipelineCategory = category;
      if (!out || !ghl?.opportunityId || !ghl.unifiedStageKey) return;
      const name = names.get(`${ghl.pipelineId}:${ghl.unifiedStageKey}`);
      if (name) out.pipelineStage = name;
    });
  } catch {
    /* display only */
  }
  return serialized;
}

module.exports = { attachStageNames };
