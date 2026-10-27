// In-memory twin of NewsRepository for the sync tests: same contract (unique canonicalUrl and slug, eligibility by nextAttemptAt, the same work order), no database.
let counter = 0;

function createMemoryRepository() {
  const articles = [];
  const runs = [];
  const eligible = (doc, now) => !doc.nextAttemptAt || doc.nextAttemptAt <= now;
  const copy = (doc) => ({ ...doc });
  const byPublished = (a, b) => (b.publishedAt || 0) - (a.publishedAt || 0);

  return {
    articles,
    runs,
    async feedState() {
      const run = [...runs].reverse().find((entry) => entry.feed?.etag && !entry.feed?.error);
      return run ? { etag: run.feed.etag, lastModified: run.feed.lastModified || "" } : {};
    },
    async known(urls) {
      return new Map(articles.filter((doc) => urls.includes(doc.canonicalUrl)).map((doc) => [doc.canonicalUrl, copy(doc)]));
    },
    async slugsTaken(slugs) {
      return new Set(articles.filter((doc) => slugs.includes(doc.slug)).map((doc) => doc.slug));
    },
    async insertStubs(stubs) {
      let inserted = 0;
      for (const stub of stubs) {
        if (articles.some((doc) => doc.canonicalUrl === stub.canonicalUrl || doc.slug === stub.slug)) continue; // the unique indexes
        articles.push({ _id: `a${++counter}`, attempts: 0, contentHtml: "", contentHash: "", syncWarnings: [], needsRefresh: false, feedDigest: "", nextAttemptAt: null, lastCheckedAt: null, etag: "", lastModified: "", ...stub });
        inserted += 1;
      }
      return inserted;
    },
    async flagFeedChanges(changes) {
      for (const change of changes) {
        const doc = articles.find((entry) => entry.canonicalUrl === change.canonicalUrl);
        if (!doc) continue;
        doc.pendingFeedDigest = change.digest;
        if (change.needsRefresh) { doc.needsRefresh = true; doc.nextAttemptAt = null; }
      }
    },
    async selectWork(limit, now, refreshAfterMs) {
      const groups = [
        articles.filter((doc) => doc.syncStatus === "pending" && eligible(doc, now)).sort(byPublished),
        articles.filter((doc) => doc.needsRefresh && ["complete", "incomplete", "failed"].includes(doc.syncStatus) && eligible(doc, now)).sort(byPublished),
        articles.filter((doc) => doc.syncStatus === "failed" && eligible(doc, now)).sort(byPublished),
        articles.filter((doc) => ["complete", "incomplete"].includes(doc.syncStatus) && doc.lastCheckedAt && doc.lastCheckedAt < new Date(now.getTime() - refreshAfterMs) && eligible(doc, now)).sort((a, b) => a.lastCheckedAt - b.lastCheckedAt),
      ];
      const picked = [];
      for (const group of groups) for (const doc of group) if (picked.length < limit && !picked.includes(doc)) picked.push(doc);
      return picked.map(copy);
    },
    async backlog(now) {
      return articles.filter((doc) => (doc.syncStatus === "pending" || doc.needsRefresh) && eligible(doc, now)).length;
    },
    async findByCanonical(canonicalUrl) {
      const doc = articles.find((entry) => entry.canonicalUrl === canonicalUrl);
      return doc ? { _id: doc._id } : null;
    },
    async update(id, patch) {
      const doc = articles.find((entry) => entry._id === id);
      if (!doc) throw new Error(`no article ${id}`);
      if (patch.canonicalUrl && articles.some((entry) => entry !== doc && entry.canonicalUrl === patch.canonicalUrl)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      Object.assign(doc, patch);
    },
    async createRun(data) {
      const run = { _id: `r${++counter}`, ...data };
      runs.push(run);
      return run._id;
    },
    async finishRun(id, patch) {
      Object.assign(runs.find((run) => run._id === id), patch);
    },
    async failInterruptedRuns(now) {
      runs.filter((run) => run.status === "running").forEach((run) => Object.assign(run, { status: "failed", finishedAt: now, feed: { ...run.feed, error: "interrupted" } }));
    },
    async resetFailed() {
      let modified = 0;
      articles.filter((doc) => ["failed", "pending"].includes(doc.syncStatus)).forEach((doc) => { doc.attempts = 0; doc.nextAttemptAt = null; modified += 1; });
      return modified;
    },
  };
}

module.exports = { createMemoryRepository };
