// Phase 7.E (B8): remembers the SET of stuck forms the developer was last told about, so the "forms stuck" e-mail is sent once per distinct set (and again as a daily reminder),
// and so a form that was resolved since can be listed once under "resolved" in the next e-mail and then dropped.
//   getLast()           -> { at: Date, entries: [{ jobId, formCode, signature }] } | null   (the last e-mail's set)
//   record({ at, entries })                                                            stores the set just sent
// Two interchangeable stores: createStuckStore({ model }) reuses models/FormPipelineDigest.js (one finished document per record, key "stuck:last", state "sent" - the digest
// flusher only ever claims OPEN windows, so it never touches these; the TTL index removes old ones); createMemoryStuckStore() for tests. Nothing here throws into the pipeline;
// the alerter wraps every call anyway.
const KEY = "stuck:last";
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;

function createStuckStore({ model = require("../../../models/FormPipelineDigest"), now = () => new Date() } = {}) {
  async function getLast() {
    const doc = await model.findOne({ key: KEY, state: "sent" }).sort({ sentAt: -1 }).select("entries sentAt").lean();
    if (!doc) return null;
    return { at: doc.sentAt ? new Date(doc.sentAt) : null, entries: (doc.entries || []).map((entry) => ({ jobId: String(entry.jobId || ""), formCode: entry.formCode || "", signature: entry.release || "" })) };
  }

  async function record({ at = now(), entries = [] } = {}) {
    await model.create({
      key: KEY, state: "sent", count: entries.length, sentAt: at, firstEntryAt: at, lastEntryAt: at, expiresAt: new Date(new Date(at).getTime() + KEPT_MS),
      entries: entries.map((entry) => ({ jobId: String(entry.jobId), formCode: entry.formCode, release: entry.signature, at })),
    });
    // keep only the newest record: older ones are of no use and would only grow the collection until their TTL
    await model.deleteMany({ key: KEY, state: "sent", sentAt: { $lt: at } });
    return true;
  }

  return { getLast, record };
}

function createMemoryStuckStore() {
  let last = null;
  return {
    get last() { return last; },
    async getLast() { return last ? { at: last.at, entries: last.entries.map((entry) => ({ ...entry })) } : null; },
    async record({ at = new Date(), entries = [] } = {}) { last = { at: new Date(at), entries: entries.map((entry) => ({ jobId: String(entry.jobId), formCode: entry.formCode, signature: entry.signature })) }; return true; },
  };
}

/** Stable text for a set of stuck jobs: the same set always gives the same string whatever order the jobs came in. */
const setSignature = (entries = []) => entries.map((entry) => `${entry.jobId}:${entry.signature}`).sort().join("|");

module.exports = { KEY, createStuckStore, createMemoryStuckStore, setSignature };
