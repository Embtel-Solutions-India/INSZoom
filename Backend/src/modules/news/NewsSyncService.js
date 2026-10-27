// The USCIS news synchronisation: feed -> stubs -> article pages -> sanitised content, one run at a time.
//
//   1. the RSS feed is read (conditional request; a 304 simply means "nothing new in the feed") and every valid entry is remembered as a stub the first time it is seen;
//      an entry whose title / excerpt / date changed flags its article for a refresh (an article is never identified by its date alone)
//   2. a bounded batch of waiting articles is imported, one request at a time at the crawl-delay pace: new ones first, then changed ones, then failed ones, then the
//      oldest unchanged ones (a periodic re-check that also catches body-only edits); a 304 from the article page just records "checked"
//   3. one article failing never stops the others; a transient failure is retried on later runs with exponential back-off, a permanent one is recorded and kept visible
//      to staff; an article that was imported before keeps its stored content when a refresh fails
//
// The public news pages read only what is stored, so a USCIS outage changes nothing for visitors. runSync() takes a MongoDB lease, so two runs can never overlap, whether
// they come from the schedule, an admin's "sync now" or another server instance. Nothing here throws: the result says what happened.
const crypto = require("crypto");
const { getConfig } = require("./news.config");
const { createClient } = require("./uscisHttp");
const { parseFeed } = require("./feedParser");
const { extractArticle } = require("./articleExtractor");
const { createMongoRepository } = require("./NewsRepository");

const LOCK_NAME = "news-sync";
const LOCK_TTL_MS = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const backoffMs = (attempts) => Math.min(6 * HOUR, 15 * 60 * 1000 * 2 ** Math.max(attempts - 1, 0));

const slugFrom = (source) => String(source || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 190) || "article";

function createSyncService(deps = {}) {
  const config = { ...getConfig(), ...(deps.config || {}) };
  const repo = deps.repo || createMongoRepository();
  const client = deps.client || createClient({ config });
  const now = deps.now || (() => new Date());
  const log = deps.logger || require("../../utils/logger");
  let running = false;

  async function ingestFeed(items, counts) {
    const known = await repo.known(items.map((item) => item.canonicalUrl));
    const fresh = items.filter((item) => !known.has(item.canonicalUrl));
    const changes = [];
    for (const item of items) {
      const existing = known.get(item.canonicalUrl);
      if (!existing) continue;
      if (existing.feedDigest !== item.digest && existing.pendingFeedDigest !== item.digest) {
        changes.push({ canonicalUrl: item.canonicalUrl, digest: item.digest, needsRefresh: existing.syncStatus !== "pending" && existing.syncStatus !== "duplicate" });
      }
    }
    await repo.flagFeedChanges(changes);

    if (fresh.length) {
      const wanted = fresh.map((item) => slugFrom(item.slugSource));
      const taken = await repo.slugsTaken(wanted);
      const used = new Set();
      const stubs = fresh.map((item, index) => {
        let slug = wanted[index];
        if (taken.has(slug) || used.has(slug)) slug = `${slug.slice(0, 180)}-${crypto.createHash("sha1").update(item.canonicalUrl).digest("hex").slice(0, 8)}`;
        used.add(slug);
        return {
          source: "uscis",
          sourceUrl: item.sourceUrl,
          canonicalUrl: item.canonicalUrl,
          sourceGuid: item.sourceGuid,
          slug,
          category: item.category,
          title: item.title,
          excerpt: item.excerpt,
          publishedAt: item.feedDate,
          syncStatus: "pending",
          listed: false,
          pendingFeedDigest: item.digest,
        };
      });
      counts.newStubs += await repo.insertStubs(stubs);
    }
  }

  async function importOne(doc, { force }, counts, errors) {
    const at = now();
    const conditional = !force && doc.etag && !doc.needsRefresh && ["complete", "incomplete"].includes(doc.syncStatus) ? { etag: doc.etag, lastModified: doc.lastModified } : {};
    try {
      const response = await client.get(doc.canonicalUrl, conditional);
      if (response.notModified) {
        await repo.update(doc._id, { lastCheckedAt: at, needsRefresh: false, attempts: 0, nextAttemptAt: null, lastError: "", lastErrorPermanent: false, feedDigest: doc.pendingFeedDigest || doc.feedDigest });
        counts.unchanged += 1;
        return;
      }
      const article = extractArticle(response.text, { requestUrl: response.url, imageMode: config.imageMode });

      if (article.canonicalUrl !== doc.canonicalUrl) {
        const other = await repo.findByCanonical(article.canonicalUrl);
        if (other && String(other._id) !== String(doc._id)) {
          await repo.update(doc._id, { syncStatus: "duplicate", listed: false, lastCheckedAt: at, needsRefresh: false, nextAttemptAt: null, lastError: `The page is a second address of ${article.canonicalUrl}` });
          counts.unchanged += 1;
          return;
        }
      }

      const status = article.complete ? "complete" : "incomplete";
      const created = !doc.contentHash; // first successful import (also after the article had only ever failed)
      const changed = created || article.contentHash !== doc.contentHash;
      const patch = {
        canonicalUrl: article.canonicalUrl,
        lastCheckedAt: at,
        attempts: 0,
        lastError: "",
        lastErrorPermanent: false,
        nextAttemptAt: null,
        needsRefresh: false,
        feedDigest: doc.pendingFeedDigest || doc.feedDigest,
        etag: response.etag || "",
        lastModified: response.lastModified || "",
        syncStatus: status,
        syncWarnings: article.warnings,
        listed: true,
      };
      if (changed) {
        Object.assign(patch, {
          title: article.title,
          ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
          updatedAtSource: article.updatedAtSource,
          contentHtml: article.contentHtml,
          bodyText: article.bodyText,
          images: article.images,
          contentHash: article.contentHash,
          lastSyncedAt: at,
        });
      }
      await repo.update(doc._id, patch);
      if (created) counts.created += 1;
      else if (changed) counts.updated += 1;
      else counts.unchanged += 1;
      if (status === "incomplete") counts.incomplete += 1;
    } catch (error) {
      await recordFailure(doc, error, counts, errors);
    }
  }

  async function recordFailure(doc, error, counts, errors) {
    const at = now();
    const attempts = (doc.attempts || 0) + 1;
    const permanent = Boolean(error?.permanent) || error?.name === "ExtractionError" && attempts >= config.maxArticleAttempts;
    const exhausted = permanent || attempts >= config.maxArticleAttempts;
    const hasContent = Boolean(doc.contentHtml);
    const message = String(error?.message || "Import failed").slice(0, 300);
    const patch = { attempts, lastError: message, lastErrorPermanent: Boolean(error?.permanent), lastCheckedAt: at };
    if (hasContent) {
      // a refresh failed: the stored article stays exactly as it is
      patch.nextAttemptAt = new Date(at.getTime() + (exhausted ? 24 * HOUR : backoffMs(attempts)));
      if (error?.permanent && (error.status === 404 || error.status === 410)) {
        patch.syncWarnings = [...new Set([...(doc.syncWarnings || []), "the source article is no longer available on uscis.gov"])];
      }
    } else if (exhausted) {
      // never imported: show the excerpt with the official link while that link is known to work; a link USCIS no longer serves is not offered
      patch.syncStatus = "failed";
      patch.listed = !(error?.permanent && [404, 410, 403, 401].includes(error.status));
      patch.nextAttemptAt = new Date(at.getTime() + (permanent ? 7 * 24 * HOUR : 24 * HOUR));
    } else {
      patch.syncStatus = "pending";
      patch.nextAttemptAt = new Date(at.getTime() + backoffMs(attempts));
    }
    try {
      await repo.update(doc._id, patch);
    } catch (updateError) {
      log.error?.("news_sync_failure_not_recorded", { canonicalUrl: doc.canonicalUrl, error: updateError.message });
    }
    counts.failed += 1;
    if (errors.length < 50) errors.push({ canonicalUrl: doc.canonicalUrl, message, permanent: Boolean(error?.permanent) });
    log.warn?.("news_sync_article_failed", { canonicalUrl: doc.canonicalUrl, message, attempts });
  }

  /** One run, no lock (runSync adds it). Resolves with the stored run summary; never rejects. */
  async function runOnce({ trigger = "schedule", force = false, requestedBy = "" } = {}) {
    const startedAt = now();
    const counts = { created: 0, updated: 0, unchanged: 0, failed: 0, incomplete: 0, newStubs: 0 };
    const errors = [];
    const feed = { url: config.feedUrl, httpStatus: 0, notModified: false, etag: "", lastModified: "", items: 0, invalidItems: 0, error: "" };
    let runId = null;
    let feedUnreachable = false;
    try {
      await repo.failInterruptedRuns(startedAt);
      runId = await repo.createRun({ trigger, status: "running", startedAt, requestedBy, feed });

      const state = force ? {} : await repo.feedState();
      try {
        const response = await client.get(config.feedUrl, { ...state, accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" });
        feed.httpStatus = response.status;
        feed.etag = response.etag || state.etag || "";
        feed.lastModified = response.lastModified || state.lastModified || "";
        if (response.notModified) feed.notModified = true;
        else {
          const parsed = parseFeed(response.text);
          feed.items = parsed.items.length;
          feed.invalidItems = parsed.invalid;
          await ingestFeed(parsed.items, counts);
        }
      } catch (error) {
        feed.error = String(error?.message || "The feed could not be read").slice(0, 300);
        feed.httpStatus = error?.status || 0;
        feedUnreachable = Boolean(error?.retryable);
        log.warn?.("news_sync_feed_failed", { message: feed.error });
      }

      // when USCIS itself cannot be reached there is no point in asking it for each article as well
      if (!feedUnreachable) {
        const work = await repo.selectWork(config.maxArticlesPerRun, now(), config.refreshAfterMs);
        for (const doc of work) await importOne(doc, { force }, counts, errors);
      }

      const backlog = await repo.backlog(now());
      const processed = counts.created + counts.updated + counts.unchanged + counts.failed;
      const status = feed.error && !processed ? "failed" : counts.failed || feed.error ? "partial" : "success";
      await repo.finishRun(runId, { status, finishedAt: now(), feed, counts, failures: errors, backlog });
      log.info?.("news_sync_finished", { status, ...counts, backlog });
      return { runId, status, counts, backlog, feedError: feed.error };
    } catch (error) {
      log.error?.("news_sync_crashed", { error: error?.message });
      if (runId) await repo.finishRun(runId, { status: "failed", finishedAt: now(), feed: { ...feed, error: feed.error || String(error?.message || "unexpected error").slice(0, 300) }, counts, failures: errors }).catch(() => {});
      return { runId, status: "failed", counts, backlog: 0, feedError: String(error?.message || "unexpected error") };
    }
  }

  /** The guarded entry point: a MongoDB lease plus an in-process flag. Resolves { skipped: "already_running" } when another run holds the lease. */
  async function runSync(options = {}) {
    if (running) return { skipped: "already_running" };
    running = true;
    try {
      const withJobLock = deps.withJobLock || require("../../utils/jobLock").withJobLock;
      let result = { skipped: "already_running" };
      await withJobLock(LOCK_NAME, LOCK_TTL_MS, async () => {
        result = await runOnce(options);
      });
      return result;
    } catch (error) {
      log.error?.("news_sync_not_started", { error: error?.message });
      return { status: "failed", feedError: String(error?.message || "not started") };
    } finally {
      running = false;
    }
  }

  return { runSync, runOnce, config, repo };
}

module.exports = { createSyncService, LOCK_NAME, backoffMs, slugFrom };
