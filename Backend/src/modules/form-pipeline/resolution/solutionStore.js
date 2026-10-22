// Phase 7.E: the store of learned solutions (signature -> the strategy that worked). A memory store for tests and a MongoDB store (models/ErrorSolution.js) for the app.
// Every method resolves and never throws into the pipeline: a store that cannot be read simply learns nothing.
const DEMOTE_AFTER = 2; // consecutive failures of a stored solution before it stops being tried first

function createMemoryStore() {
  const rows = new Map();
  const key = (signature, strategyId) => `${signature}|${strategyId}`;
  return {
    rows,
    async best(signature) {
      const found = [...rows.values()].filter((row) => row.signature === signature && !row.demoted).sort((a, b) => b.successes - a.successes);
      return found[0] ? { ...found[0] } : null;
    },
    async recordSuccess({ signature, strategyId, stage = null, cause = null, formCode = null }) {
      const row = rows.get(key(signature, strategyId)) || { signature, strategyId, stage, cause, successes: 0, failures: 0, consecutiveFailures: 0, demoted: false };
      Object.assign(row, { successes: row.successes + 1, consecutiveFailures: 0, demoted: false, lastUsedAt: new Date(), lastSucceededAt: new Date(), lastFormCode: formCode });
      rows.set(key(signature, strategyId), row);
    },
    async recordFailure({ signature, strategyId }) {
      const row = rows.get(key(signature, strategyId));
      if (!row) return;
      row.failures += 1;
      row.consecutiveFailures += 1;
      row.lastUsedAt = new Date();
      if (row.consecutiveFailures >= DEMOTE_AFTER) row.demoted = true;
    },
    /** { strategyId: successes } for a stage, used to order the generic portfolio by past success. */
    async ranking(stage) {
      const out = {};
      for (const row of rows.values()) if (!stage || row.stage === stage) out[row.strategyId] = (out[row.strategyId] || 0) + row.successes;
      return out;
    },
  };
}

function createMongoStore(model = null) {
  const getModel = () => model || require("../../../models/ErrorSolution");
  return {
    async best(signature) {
      try { return await getModel().findOne({ signature, demoted: false, successes: { $gt: 0 } }).sort({ successes: -1 }).lean(); } catch { return null; }
    },
    async recordSuccess({ signature, strategyId, stage = null, cause = null, formCode = null }) {
      try {
        await getModel().updateOne({ signature, strategyId }, { $inc: { successes: 1 }, $set: { consecutiveFailures: 0, demoted: false, lastUsedAt: new Date(), lastSucceededAt: new Date(), stage, cause, lastFormCode: formCode } }, { upsert: true });
      } catch { /* learning is best effort */ }
    },
    async recordFailure({ signature, strategyId }) {
      try {
        const updated = await getModel().findOneAndUpdate({ signature, strategyId }, { $inc: { failures: 1, consecutiveFailures: 1 }, $set: { lastUsedAt: new Date() } }, { new: true }).lean();
        if (updated && updated.consecutiveFailures >= DEMOTE_AFTER && !updated.demoted) await getModel().updateOne({ _id: updated._id }, { $set: { demoted: true } });
      } catch { /* best effort */ }
    },
    async ranking(stage) {
      try {
        const rows = await getModel().find(stage ? { stage } : {}).select("strategyId successes").lean();
        const out = {};
        for (const row of rows) out[row.strategyId] = (out[row.strategyId] || 0) + (row.successes || 0);
        return out;
      } catch { return {}; }
    },
  };
}

module.exports = { createMemoryStore, createMongoStore, DEMOTE_AFTER };
