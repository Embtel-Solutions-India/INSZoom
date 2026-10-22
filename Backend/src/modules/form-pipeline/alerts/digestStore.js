// Phase 5E: where the digest of a run window is collected. Two interchangeable stores with the same small API:
//   createDigestStore({ model })     MongoDB (models/FormPipelineDigest.js) - atomic, safe with several processes (API + worker);
//   createMemoryDigestStore()        in memory, for tests.
//   reserveIndividual(key, cap)      true when this success may still be e-mailed on its own (the per-run cap is counted atomically);
//   addEntry(key, entry)             adds a success to the window's digest;
//   claimDue({ quietMs, now })       atomically takes every window that has been quiet long enough (open -> sending) and returns it;
//   markSent(id) / release(id)       finished / put back after a failed send so a later tick tries again.
// Nothing here throws into the pipeline; the alerter wraps every call anyway.
const FINISHED_KEPT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200; // a window never grows without bound; the counter keeps counting

function createDigestStore({ model = require("../../../models/FormPipelineDigest"), now = () => new Date() } = {}) {
  async function ensureOpen(key) {
    const filter = { key, state: "open" };
    const insert = { count: 0, individualSent: 0, entries: [], firstEntryAt: now(), lastEntryAt: now() };
    try {
      await model.updateOne(filter, { $setOnInsert: insert }, { upsert: true });
    } catch (error) {
      if (error?.code !== 11000) throw error; // another process created the open window first - that is fine
    }
  }

  async function reserveIndividual(key, cap) {
    if (!(cap > 0)) return false;
    await ensureOpen(key);
    const reserved = await model.findOneAndUpdate({ key, state: "open", individualSent: { $lt: cap } }, { $inc: { individualSent: 1 }, $set: { lastEntryAt: now() } }, { new: true }).lean();
    return Boolean(reserved);
  }

  async function addEntry(key, entry) {
    await ensureOpen(key);
    const stamp = now();
    const doc = await model.findOneAndUpdate({ key, state: "open" }, { $inc: { count: 1 }, $set: { lastEntryAt: stamp } }, { new: true }).select("count entries").lean();
    if (doc && (doc.entries || []).length < MAX_ENTRIES) await model.updateOne({ _id: doc._id, state: "open" }, { $push: { entries: { ...entry, at: stamp } } });
    return true;
  }

  async function claimDue({ quietMs, now: at = now() } = {}) {
    const cutoff = new Date(new Date(at).getTime() - quietMs);
    const claimed = [];
    const due = await model.find({ state: "open", count: { $gt: 0 }, lastEntryAt: { $lte: cutoff } }).select("_id").limit(25).lean();
    for (const { _id } of due) {
      const doc = await model.findOneAndUpdate({ _id, state: "open" }, { $set: { state: "sending" } }, { new: true }).lean();
      if (doc) claimed.push(doc);
    }
    // an empty window that only counted individual e-mails has nothing to summarize: closed quietly once it has been quiet
    await model.updateMany({ state: "open", count: 0, lastEntryAt: { $lte: cutoff } }, { $set: { state: "sent", sentAt: new Date(at), expiresAt: new Date(new Date(at).getTime() + FINISHED_KEPT_MS) } });
    return claimed;
  }

  const markSent = (id) => model.updateOne({ _id: id }, { $set: { state: "sent", sentAt: now(), expiresAt: new Date(now().getTime() + FINISHED_KEPT_MS) } });
  const release = (id) => model.updateOne({ _id: id, state: "sending" }, { $set: { state: "open" } });

  return { reserveIndividual, addEntry, claimDue, markSent, release };
}

/** Same behavior in memory (tests). `windows` is exposed so a test can look at what was collected. */
function createMemoryDigestStore({ now = () => new Date() } = {}) {
  const windows = [];
  let nextId = 1;
  const open = (key) => {
    let window = windows.find((item) => item.key === key && item.state === "open");
    if (!window) { window = { _id: `mem-${nextId++}`, key, state: "open", count: 0, individualSent: 0, entries: [], firstEntryAt: now(), lastEntryAt: now() }; windows.push(window); }
    return window;
  };
  return {
    windows,
    async reserveIndividual(key, cap) {
      const window = open(key);
      if (!(cap > 0) || window.individualSent >= cap) return false;
      window.individualSent += 1;
      window.lastEntryAt = now();
      return true;
    },
    async addEntry(key, entry) {
      const window = open(key);
      window.count += 1;
      window.lastEntryAt = now();
      if (window.entries.length < MAX_ENTRIES) window.entries.push({ ...entry, at: now() });
      return true;
    },
    async claimDue({ quietMs, now: at = now() } = {}) {
      const cutoff = new Date(at).getTime() - quietMs;
      const due = windows.filter((item) => item.state === "open" && item.count > 0 && item.lastEntryAt.getTime() <= cutoff);
      due.forEach((item) => { item.state = "sending"; });
      windows.filter((item) => item.state === "open" && item.count === 0 && item.lastEntryAt.getTime() <= cutoff).forEach((item) => { item.state = "sent"; });
      return due.map((item) => ({ ...item, entries: [...item.entries] }));
    },
    async markSent(id) { const window = windows.find((item) => item._id === id); if (window) { window.state = "sent"; window.sentAt = now(); } },
    async release(id) { const window = windows.find((item) => item._id === id && item.state === "sending"); if (window) window.state = "open"; },
  };
}

module.exports = { createDigestStore, createMemoryDigestStore, MAX_ENTRIES };
