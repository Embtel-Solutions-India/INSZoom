// Phase 7.E - alternative discovery. For an error no catalog entry solved (or none matched) there is still a generic portfolio of SAFE alternatives per stage
// (catalog/generic.js): retry with a longer timeout, a fresh temp dir, re-resolve the source, an alternate parser. They are tried in order of PAST SUCCESS for the stage,
// each one verified like any strategy, and the first one that verifies becomes the stored solution for that error signature (the resolver records it).
// Discovery only orders and filters; it runs nothing itself.

/** `generic` is the catalog entry with id "generic" ({ stages: { <stage>: [strategyId...], default: [...] }, strategies: [...] }). */
function createDiscovery({ generic, store } = {}) {
  const byId = new Map((generic?.strategies || []).map((strategy) => [strategy.id, strategy]));

  /** The generic strategies to try for a stage, best past performer first, skipping any id in `exclude`. */
  async function strategiesFor(stage, exclude = []) {
    if (!generic) return [];
    const wanted = (generic.stages && (generic.stages[stage] || generic.stages.default)) || [...byId.keys()];
    const skip = new Set(exclude);
    const ranking = (await Promise.resolve(store?.ranking?.(stage)).catch(() => ({}))) || {};
    return wanted
      .map((id, index) => ({ id, index, score: ranking[id] || 0 }))
      .filter((item) => byId.has(item.id) && !skip.has(item.id))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => byId.get(item.id));
  }

  return { strategiesFor };
}

module.exports = { createDiscovery };
