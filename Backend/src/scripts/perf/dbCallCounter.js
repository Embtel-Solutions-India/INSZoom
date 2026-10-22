// Counts the database round-trips a piece of code makes through Mongoose, for the plan's HARD check "zero added hot-path DB calls" (autofill / form load / case read).
// It wraps Query#exec, Aggregate#exec, Model#save, Model.bulkWrite and Model.insertMany for the duration of one measure() and ALWAYS restores them. Counting is by collection
// name where known. It never touches a connection itself: with no database, code that reaches Mongoose simply fails as it normally would - tests stub the underlying methods.
function createDbCallCounter(mongoose) {
  const targets = [
    [mongoose.Query.prototype, "exec", (self) => self.model?.collection?.name || self.mongooseCollection?.name],
    [mongoose.Aggregate.prototype, "exec", (self) => self._model?.collection?.name],
    [mongoose.Model.prototype, "save", (self) => self.constructor?.collection?.name],
    [mongoose.Model, "bulkWrite", (self) => self.collection?.name],
    [mongoose.Model, "insertMany", (self) => self.collection?.name],
  ];

  /** Runs fn and returns { result, calls, byCollection }. Throws whatever fn throws (after restoring). */
  async function measure(fn) {
    const counts = { total: 0, byCollection: {} };
    const originals = [];
    for (const [owner, method, collectionOf] of targets) {
      const original = owner[method];
      if (typeof original !== "function") continue;
      originals.push([owner, method, original]);
      owner[method] = function counted(...args) {
        counts.total += 1;
        let name = "unknown";
        try { name = collectionOf(this) || "unknown"; } catch { /* counting never breaks the call */ }
        counts.byCollection[name] = (counts.byCollection[name] || 0) + 1;
        return original.apply(this, args);
      };
    }
    try {
      const result = await fn();
      return { result, calls: counts.total, byCollection: counts.byCollection };
    } finally {
      for (const [owner, method, original] of originals) owner[method] = original;
    }
  }
  return { measure };
}

/** The hard check itself: a hot path may make no more DB calls than its recorded baseline. */
function assertNoAddedDbCalls(name, baselineCalls, measuredCalls) {
  if (measuredCalls > baselineCalls) {
    const error = new Error(`${name}: ${measuredCalls} database calls, baseline is ${baselineCalls} (added ${measuredCalls - baselineCalls})`);
    error.code = "ADDED_HOT_PATH_DB_CALLS";
    throw error;
  }
  return true;
}

module.exports = { createDbCallCounter, assertNoAddedDbCalls };
