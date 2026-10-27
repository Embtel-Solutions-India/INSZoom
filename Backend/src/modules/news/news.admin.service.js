// Operational view of the news synchronisation for staff: how the last runs went, what is waiting, which articles failed or could not be preserved completely.
const { getConfig } = require("./news.config");

const articles = () => require("../../models/NewsArticle");
const runs = () => require("../../models/NewsSyncRun");

async function status() {
  const config = getConfig();
  const [recentRuns, byStatus, listed, waiting] = await Promise.all([
    runs().find().sort({ startedAt: -1 }).limit(10).lean(),
    articles().aggregate([{ $group: { _id: "$syncStatus", count: { $sum: 1 } } }]),
    articles().countDocuments({ listed: true }),
    articles().countDocuments({ $or: [{ syncStatus: "pending" }, { needsRefresh: true }] }),
  ]);
  return {
    enabled: config.enabled,
    settings: { feedUrl: config.feedUrl, intervalMs: config.intervalMs, requestDelayMs: config.requestDelayMs, maxArticlesPerRun: config.maxArticlesPerRun, imageMode: config.imageMode },
    articles: { listed, waiting, byStatus: Object.fromEntries(byStatus.map((row) => [row._id, row.count])) },
    lastRun: recentRuns[0] || null,
    recentRuns,
  };
}

async function failures(limit = 50) {
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return articles()
    .find({ $or: [{ syncStatus: { $in: ["failed", "incomplete"] } }, { lastError: { $ne: "" } }] })
    .sort({ lastCheckedAt: -1 })
    .limit(max)
    .select("slug title canonicalUrl category syncStatus syncWarnings attempts lastError lastErrorPermanent nextAttemptAt lastCheckedAt listed")
    .lean();
}

module.exports = { status, failures };
