// Persistence of the news synchronisation, kept behind one small interface so NewsSyncService can be tested without a database (an in-memory twin lives in the tests).
// Every write is an upsert / targeted update; the unique indexes on canonicalUrl and slug make a duplicate article impossible even if two instances raced.
const NewsArticle = require("../../models/NewsArticle");
const NewsSyncRun = require("../../models/NewsSyncRun");

const eligible = (now) => ({ $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] });

const FIELDS_FOR_WORK = "canonicalUrl slug title publishedAt syncStatus attempts contentHtml contentHash syncWarnings etag lastModified needsRefresh feedDigest pendingFeedDigest";

function createMongoRepository() {
  return {
    async feedState() {
      const run = await NewsSyncRun.findOne({ "feed.etag": { $ne: "" }, "feed.error": "" }).sort({ startedAt: -1 }).select("feed").lean();
      return run ? { etag: run.feed.etag || "", lastModified: run.feed.lastModified || "" } : {};
    },

    async known(canonicalUrls) {
      const rows = await NewsArticle.find({ canonicalUrl: { $in: canonicalUrls } }).select("canonicalUrl slug syncStatus feedDigest pendingFeedDigest").lean();
      return new Map(rows.map((row) => [row.canonicalUrl, row]));
    },

    async slugsTaken(slugs) {
      const rows = await NewsArticle.find({ slug: { $in: slugs } }).select("slug").lean();
      return new Set(rows.map((row) => row.slug));
    },

    async insertStubs(stubs) {
      if (!stubs.length) return 0;
      try {
        const result = await NewsArticle.insertMany(stubs, { ordered: false });
        return result.length;
      } catch (error) {
        // a concurrent insert of the same article is not an error: the unique index kept the first one
        if (error?.code === 11000 || error?.writeErrors) return Array.isArray(error.insertedDocs) ? error.insertedDocs.length : 0;
        throw error;
      }
    },

    async flagFeedChanges(changes) {
      if (!changes.length) return;
      await NewsArticle.bulkWrite(
        changes.map(({ canonicalUrl, digest, needsRefresh }) => ({ updateOne: { filter: { canonicalUrl }, update: { $set: { pendingFeedDigest: digest, ...(needsRefresh ? { needsRefresh: true, nextAttemptAt: null } : {}) } } } })),
        { ordered: false }
      );
    },

    /** Work for one run, most valuable first: new articles, changed articles, failed ones, then the oldest unchanged ones (periodic re-check). */
    async selectWork(limit, now, refreshAfterMs) {
      const picked = [];
      const seen = new Set();
      const add = (rows) => rows.forEach((row) => { if (picked.length < limit && !seen.has(String(row._id))) { seen.add(String(row._id)); picked.push(row); } });
      const take = () => limit - picked.length;
      add(await NewsArticle.find({ syncStatus: "pending", ...eligible(now) }).sort({ publishedAt: -1 }).limit(take()).select(FIELDS_FOR_WORK).lean());
      if (take() > 0) add(await NewsArticle.find({ needsRefresh: true, syncStatus: { $in: ["complete", "incomplete", "failed"] }, ...eligible(now) }).sort({ publishedAt: -1 }).limit(take()).select(FIELDS_FOR_WORK).lean());
      if (take() > 0) add(await NewsArticle.find({ syncStatus: "failed", ...eligible(now) }).sort({ publishedAt: -1 }).limit(take()).select(FIELDS_FOR_WORK).lean());
      if (take() > 0) add(await NewsArticle.find({ syncStatus: { $in: ["complete", "incomplete"] }, lastCheckedAt: { $lt: new Date(now.getTime() - refreshAfterMs) }, ...eligible(now) }).sort({ lastCheckedAt: 1 }).limit(take()).select(FIELDS_FOR_WORK).lean());
      return picked;
    },

    async backlog(now) {
      return NewsArticle.countDocuments({ $and: [{ $or: [{ syncStatus: "pending" }, { needsRefresh: true }] }, eligible(now)] });
    },

    async findByCanonical(canonicalUrl) {
      return NewsArticle.findOne({ canonicalUrl }).select("_id").lean();
    },

    async update(id, patch) {
      await NewsArticle.updateOne({ _id: id }, { $set: patch });
    },

    async createRun(data) {
      const run = await NewsSyncRun.create(data);
      return String(run._id);
    },

    async finishRun(id, patch) {
      await NewsSyncRun.updateOne({ _id: id }, { $set: patch });
    },

    // any run still marked running when the lock is ours belongs to a process that died
    async failInterruptedRuns(now) {
      await NewsSyncRun.updateMany({ status: "running" }, { $set: { status: "failed", finishedAt: now, "feed.error": "interrupted (the process stopped before the run finished)" } });
    },

    async resetFailed() {
      const result = await NewsArticle.updateMany({ syncStatus: { $in: ["failed", "pending"] } }, { $set: { attempts: 0, nextAttemptAt: null } });
      return result.modifiedCount ?? 0;
    },
  };
}

module.exports = { createMongoRepository };
