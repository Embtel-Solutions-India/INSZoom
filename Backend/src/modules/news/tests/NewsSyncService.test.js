// DB-free and network-free: the synchronisation end to end (feed -> stubs -> article pages -> stored, listable articles) against a scripted "USCIS" and an in-memory repository.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSyncService, backoffMs, slugFrom } = require("../NewsSyncService");
const { UscisHttpError } = require("../uscisHttp");
const { createMemoryRepository } = require("./memoryRepository");

const BASE = "https://www.uscis.gov/newsroom";
const url = (slug, section = "news-releases") => `${BASE}/${section}/${slug}`;

const feedXml = (entries) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${entries.map((entry) => `<item><title>${entry.title}</title><link>${entry.link}</link><description>${entry.desc || "An excerpt."}</description><pubDate>${entry.date || "Mon, 26 Oct 26 11:44:18 -0400"}</pubDate><guid isPermaLink="false">${entry.guid || entry.link}</guid></item>`).join("")}</channel></rss>`;
const articleHtml = (link, title, body, date = "2026-10-20T15:00:00Z") => `<html><head><link rel="canonical" href="${link}"></head><body><article class="node node--type-news-item"><h1 class="page-title"><span>${title}</span></h1><div class="field field--name-field-display-date"><div class="field__item"><time datetime="${date}">d</time></div></div><div class="field field--name-body field__item">${body}</div></article></body></html>`;

/** A scripted USCIS: pages is a Map(url -> string | Error | {status}), the feed is `site.feed`. Records every request. */
function scriptedSite() {
  const site = { feed: "", feedEtag: '"f1"', pages: new Map(), requests: [], feedError: null };
  site.client = {
    async get(address, options = {}) {
      site.requests.push({ address, options });
      if (address.endsWith("/news/rss-feed/59144")) {
        if (site.feedError) throw site.feedError;
        if (options.etag && options.etag === site.feedEtag) return { status: 304, notModified: true, text: "", url: address, etag: options.etag, lastModified: "" };
        return { status: 200, notModified: false, text: site.feed, url: address, etag: site.feedEtag, lastModified: "Tue, 27 Oct 2026 22:24:12 GMT" };
      }
      const page = site.pages.get(address);
      if (page === undefined) throw new UscisHttpError("USCIS answered HTTP 404", { status: 404, permanent: true });
      if (page instanceof Error) throw page;
      if (typeof page === "object" && page.etag && options.etag === page.etag) return { status: 304, notModified: true, text: "", url: address, etag: page.etag, lastModified: "" };
      if (typeof page === "object") return { status: 200, notModified: false, text: page.html, url: address, etag: page.etag || "", lastModified: "" };
      return { status: 200, notModified: false, text: page, url: address, etag: "", lastModified: "" };
    },
  };
  return site;
}

function setup(overrides = {}) {
  const site = scriptedSite();
  const repo = createMemoryRepository();
  let clock = new Date("2026-10-28T10:00:00Z");
  const withJobLock = overrides.withJobLock || (async (name, ttl, fn) => { await fn(); });
  const logger = { info() {}, warn() {}, error() {} };
  const service = createSyncService({ client: site.client, repo, now: () => new Date(clock), withJobLock, logger, config: { feedUrl: "https://www.uscis.gov/news/rss-feed/59144", maxArticlesPerRun: 20, maxArticleAttempts: 3, refreshAfterMs: 7 * 24 * 3600 * 1000, imageMode: "link", ...(overrides.config || {}) } });
  return { site, repo, service, advance: (ms) => { clock = new Date(clock.getTime() + ms); }, now: () => new Date(clock) };
}

const publish = (site, slug, title, body = "<p>The complete text of the announcement.</p>", section = "news-releases", extra = {}) => {
  const link = url(slug, section);
  site.pages.set(link, articleHtml(link, title, body));
  return { title, link, ...extra };
};

test("a newly published USCIS article appears: feed -> stub -> imported -> listed with source dates and the exact title", async () => {
  const { site, repo, service } = setup();
  site.feed = feedXml([publish(site, "new-rule", "New Rule Announced", "<p>First paragraph.</p><p>Second paragraph.</p>")]);
  const result = await service.runSync();
  assert.equal(result.status, "success");
  assert.equal(result.counts.newStubs, 1);
  assert.equal(result.counts.created, 1);
  assert.equal(repo.articles.length, 1);
  const article = repo.articles[0];
  assert.equal(article.title, "New Rule Announced");
  assert.equal(article.syncStatus, "complete");
  assert.equal(article.listed, true);
  assert.equal(article.slug, "new-rule");
  assert.equal(article.category, "news-release");
  assert.equal(article.publishedAt.toISOString(), "2026-10-20T15:00:00.000Z", "the source's own release date, not the import time");
  assert.equal(article.contentHtml, "<p>First paragraph.</p><p>Second paragraph.</p>");
  assert.equal(article.excerpt, "An excerpt.");
  assert.match(article.contentHash, /^[0-9a-f]{64}$/);
});

test("an already imported article does not appear twice, however many runs see it; nothing is fetched again", async () => {
  const { site, repo, service } = setup();
  site.feedEtag = '"gone"'; // the feed always answers 200, to make every run re-offer the same entry
  site.feed = feedXml([publish(site, "once", "Only Once")]);
  await service.runSync();
  const pageRequests = () => site.requests.filter((request) => !request.address.endsWith("59144")).length;
  assert.equal(pageRequests(), 1);
  for (let run = 0; run < 3; run += 1) {
    const result = await service.runSync();
    assert.equal(result.counts.newStubs, 0);
    assert.equal(result.counts.created, 0);
  }
  assert.equal(repo.articles.length, 1);
  assert.equal(pageRequests(), 1, "an unchanged article is not requested again");
});

test("a 304 from the feed means nothing is new: no parsing, no article requests, and the run still reports success", async () => {
  const { site, service } = setup();
  site.feed = feedXml([publish(site, "a", "A")]);
  await service.runSync();
  const before = site.requests.length;
  const result = await service.runSync();
  assert.equal(result.status, "success");
  assert.equal(site.requests.length, before + 1, "only the (conditional) feed request");
  assert.equal(site.requests.at(-1).options.etag, '"f1"');
});

test("an updated source article is detected through the feed entry and refreshed in place - same slug, one row, new content", async () => {
  const { site, repo, service, advance } = setup();
  const first = publish(site, "policy", "Policy Update", "<p>The old wording of the announcement.</p>");
  site.feed = feedXml([first]);
  await service.runSync();
  const original = { ...repo.articles[0] };

  // USCIS edits the article and the feed entry's date moves
  site.pages.set(first.link, articleHtml(first.link, "Policy Update", "<p>The corrected wording of the announcement.</p>"));
  site.feed = feedXml([{ ...first, date: "Tue, 27 Oct 26 09:00:00 -0400" }]);
  site.feedEtag = '"f2"';
  advance(30 * 60 * 1000);
  const result = await service.runSync();
  assert.equal(result.counts.updated, 1);
  assert.equal(repo.articles.length, 1);
  assert.equal(repo.articles[0].slug, original.slug);
  assert.match(repo.articles[0].contentHtml, /corrected wording/);
  assert.notEqual(repo.articles[0].contentHash, original.contentHash);
  assert.equal(repo.articles[0].needsRefresh, false);
});

test("a body-only edit with an unchanged feed entry is caught by the periodic re-check, using the stored validators (304 when truly unchanged)", async () => {
  const { site, repo, service, advance } = setup({ config: { refreshAfterMs: 24 * 3600 * 1000 } });
  const link = url("quiet");
  site.pages.set(link, { html: articleHtml(link, "Quiet", "<p>Version one of the text body.</p>"), etag: '"p1"' });
  site.feed = feedXml([{ title: "Quiet", link }]);
  await service.runSync();
  assert.equal(repo.articles[0].etag, '"p1"');

  advance(25 * 3600 * 1000);
  let result = await service.runSync();
  assert.equal(result.counts.unchanged, 1, "validators matched: 304, nothing re-imported");
  assert.equal(site.requests.at(-1).options.etag, '"p1"');

  site.pages.set(link, { html: articleHtml(link, "Quiet", "<p>Version two of the text body.</p>"), etag: '"p2"' });
  advance(25 * 3600 * 1000);
  result = await service.runSync();
  assert.equal(result.counts.updated, 1);
  assert.match(repo.articles[0].contentHtml, /Version two/);
});

test("work is bounded per run and newest first; the backlog is reported and the next run continues without duplicates", async () => {
  const { site, repo, service } = setup({ config: { maxArticlesPerRun: 2 } });
  const entries = ["e", "d", "c", "b", "a"].map((slug, index) => publish(site, slug, `Article ${slug}`, `<p>Body of article ${slug}.</p>`, "news-releases", { date: `Mon, ${20 - index} Oct 26 11:00:00 -0400` }));
  site.feed = feedXml(entries);
  const first = await service.runSync();
  assert.equal(first.counts.created, 2);
  assert.equal(first.backlog, 3);
  assert.deepEqual(repo.articles.filter((doc) => doc.listed).map((doc) => doc.slug).sort(), ["d", "e"], "the two newest were imported first");
  await service.runSync();
  const third = await service.runSync();
  assert.equal(third.backlog, 0);
  assert.equal(repo.articles.filter((doc) => doc.listed).length, 5);
  assert.equal(new Set(repo.articles.map((doc) => doc.canonicalUrl)).size, 5);
});

test("one failing article does not stop the others, and a malformed page is recorded with its error instead of being listed", async () => {
  const { site, repo, service } = setup();
  const good = publish(site, "good", "Good One");
  const broken = { title: "Broken Page", link: url("broken") };
  site.pages.set(broken.link, "<html><body><h1>Service temporarily unavailable</h1></body></html>");
  const good2 = publish(site, "good-two", "Good Two");
  site.feed = feedXml([good, broken, good2]);
  const result = await service.runSync();
  assert.equal(result.status, "partial");
  assert.equal(result.counts.created, 2);
  assert.equal(result.counts.failed, 1);
  const stored = repo.articles.find((doc) => doc.slug === "broken");
  assert.equal(stored.syncStatus, "pending", "retried on a later run");
  assert.equal(stored.listed, false);
  assert.equal(stored.attempts, 1);
  assert.match(stored.lastError, /article container/);
  assert.ok(stored.nextAttemptAt > new Date("2026-10-28T10:00:00Z"));
  assert.equal(repo.runs.at(-1).failures.length, 1);
});

test("retry with back-off: not asked again before the delay, asked again after it; once the page works it is imported without duplicating anything", async () => {
  const { site, repo, service, advance } = setup();
  const link = url("flaky");
  site.pages.set(link, new UscisHttpError("USCIS answered HTTP 503", { status: 503, retryable: true }));
  site.feed = feedXml([{ title: "Flaky", link }]);
  await service.runSync();
  const requestsFor = () => site.requests.filter((request) => request.address === link).length;
  assert.equal(requestsFor(), 1);
  await service.runSync(); // immediately: still backing off
  assert.equal(requestsFor(), 1, "no request inside the back-off window");

  site.pages.set(link, articleHtml(link, "Flaky", "<p>Finally available article text.</p>"));
  advance(backoffMs(1) + 1000);
  const result = await service.runSync();
  assert.equal(result.counts.created, 1);
  assert.equal(repo.articles.length, 1);
  assert.equal(repo.articles[0].attempts, 0);
  assert.equal(repo.articles[0].lastError, "");
});

test("back-off grows and is capped", () => {
  assert.deepEqual([1, 2, 3, 4].map(backoffMs), [15, 30, 60, 120].map((minutes) => minutes * 60000));
  assert.equal(backoffMs(20), 6 * 3600 * 1000);
});

test("after the allowed attempts a never-imported article is shown as 'failed' with its excerpt and the official link; a 404 is not offered as a link", async () => {
  const { site, repo, service, advance } = setup({ config: { maxArticleAttempts: 2 } });
  const flaky = { title: "Flaky Forever", link: url("flaky-forever") };
  site.pages.set(flaky.link, new UscisHttpError("USCIS answered HTTP 503", { status: 503, retryable: true }));
  const gone = { title: "Gone Article", link: url("gone-article") }; // no page registered: 404
  site.feed = feedXml([flaky, gone]);
  await service.runSync();
  advance(backoffMs(1) + 1000);
  await service.runSync();
  const a = repo.articles.find((doc) => doc.slug === "flaky-forever");
  const b = repo.articles.find((doc) => doc.slug === "gone-article");
  assert.equal(a.syncStatus, "failed");
  assert.equal(a.listed, true, "the link works, so the excerpt + official link are shown");
  assert.equal(a.contentHtml, "");
  assert.equal(b.syncStatus, "failed");
  assert.equal(b.listed, false, "a link USCIS no longer serves is not offered");
  assert.equal(b.lastErrorPermanent, true);
});

test("a failed refresh never damages what was imported: the stored article keeps its text, status and visibility", async () => {
  const { site, repo, service, advance } = setup();
  const first = publish(site, "keeper", "Keeper", "<p>Text that must survive a failed refresh.</p>");
  site.feed = feedXml([first]);
  await service.runSync();
  const before = { ...repo.articles[0] };

  site.pages.set(first.link, new UscisHttpError("USCIS answered HTTP 500", { status: 500, retryable: true }));
  site.feed = feedXml([{ ...first, desc: "A changed excerpt." }]);
  site.feedEtag = '"f2"';
  advance(60 * 1000);
  const result = await service.runSync();
  assert.equal(result.counts.failed, 1);
  const after = repo.articles[0];
  assert.equal(after.contentHtml, before.contentHtml);
  assert.equal(after.syncStatus, "complete");
  assert.equal(after.listed, true);
  assert.equal(after.contentHash, before.contentHash);
  assert.match(after.lastError, /500/);
});

test("an article that disappears from USCIS later keeps its stored text and gets a visible warning", async () => {
  const { site, repo, service, advance } = setup({ config: { refreshAfterMs: 3600 * 1000 } });
  const first = publish(site, "withdrawn", "Withdrawn", "<p>Text we hold from the original publication.</p>");
  site.feed = feedXml([first]);
  await service.runSync();
  site.pages.delete(first.link);
  advance(2 * 3600 * 1000);
  await service.runSync();
  assert.match(repo.articles[0].contentHtml, /Text we hold/);
  assert.equal(repo.articles[0].listed, true);
  assert.ok(repo.articles[0].syncWarnings.some((warning) => /no longer available/.test(warning)));
});

test("an incomplete import (an image that cannot be reproduced) is stored but never marked complete", async () => {
  const { site, repo, service } = setup();
  const link = url("with-photo");
  site.pages.set(link, articleHtml(link, "With Photo", `<p>Text around the photo of the event.</p><figure><img src="https://cdn.example.com/p.jpg" alt=""><figcaption>Photo credit</figcaption></figure>`));
  site.feed = feedXml([{ title: "With Photo", link }]);
  const result = await service.runSync();
  assert.equal(result.counts.incomplete, 1);
  assert.equal(repo.articles[0].syncStatus, "incomplete");
  assert.equal(repo.articles[0].listed, true);
  assert.ok(repo.articles[0].syncWarnings.some((warning) => /not reproduced/.test(warning)));
  assert.equal(repo.articles[0].images[0].rights, "not-reproduced");
  assert.doesNotMatch(repo.articles[0].contentHtml, /cdn\.example\.com/);
});

test("a USCIS outage leaves everything stored untouched, asks for no articles, and is recorded as a failed run", async () => {
  const { site, repo, service } = setup();
  const first = publish(site, "stored", "Stored Earlier");
  site.feed = feedXml([first]);
  await service.runSync();
  const snapshot = JSON.stringify(repo.articles);

  site.feedError = new UscisHttpError("Network error: request timed out", { retryable: true });
  site.feedEtag = '"other"';
  const before = site.requests.length;
  const result = await service.runSync();
  assert.equal(result.status, "failed");
  assert.match(result.feedError, /timed out/);
  assert.equal(site.requests.length, before + 1, "only the feed was tried");
  assert.equal(JSON.stringify(repo.articles), snapshot);
  assert.equal(repo.runs.at(-1).status, "failed");
  assert.equal(repo.articles[0].listed, true);
});

test("a feed that is not RSS (an error page) is a recorded failure, never an import", async () => {
  const { site, repo, service } = setup();
  site.feed = "<html><body>We'll be right back</body></html>";
  const result = await service.runSync();
  assert.equal(result.status, "failed");
  assert.match(result.feedError, /not an RSS/);
  assert.equal(repo.articles.length, 0);
});

test("a feed entry pointing anywhere but a uscis.gov newsroom article is ignored and nothing is requested for it", async () => {
  const { site, repo, service } = setup();
  const ok = publish(site, "fine", "Fine");
  site.feed = feedXml([ok, { title: "SSRF", link: "https://169.254.169.254/newsroom/alerts/meta" }, { title: "Other host", link: "https://evil.example/newsroom/alerts/x" }]);
  await service.runSync();
  assert.deepEqual(repo.articles.map((doc) => doc.slug), ["fine"]);
  assert.ok(site.requests.every((request) => request.address.startsWith("https://www.uscis.gov/")));
});

test("two articles whose addresses end in the same words get distinct slugs (and distinct rows)", async () => {
  const { site, repo, service } = setup();
  const a = publish(site, "same-name", "Same Name", "<p>The release version of the text.</p>", "news-releases");
  const b = publish(site, "same-name", "Same Name", "<p>The alert version of the text.</p>", "alerts");
  site.feed = feedXml([a, b]);
  await service.runSync();
  assert.equal(repo.articles.length, 2);
  assert.equal(new Set(repo.articles.map((doc) => doc.slug)).size, 2);
  assert.ok(repo.articles.every((doc) => /^[a-z0-9-]+$/.test(doc.slug)));
  assert.deepEqual(repo.articles.map((doc) => doc.category).sort(), ["alert", "news-release"]);
});

test("a page whose canonical address is an article we already hold becomes a hidden duplicate instead of a second listing", async () => {
  const { site, repo, service } = setup();
  const real = publish(site, "the-original", "The Original");
  const alias = { title: "The Original", link: url("alias-address") };
  site.pages.set(alias.link, articleHtml(real.link, "The Original", "<p>The complete text of the announcement.</p>"));
  site.feed = feedXml([real, alias]);
  await service.runSync();
  const listed = repo.articles.filter((doc) => doc.listed);
  assert.equal(listed.length, 1);
  assert.equal(repo.articles.find((doc) => doc.slug === "alias-address").syncStatus, "duplicate");
});

test("two runs can never overlap: the in-process guard and the lock both refuse", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const held = setup({ withJobLock: async (name, ttl, fn) => { await gate; await fn(); } });
  held.site.feed = feedXml([publish(held.site, "x", "X")]);
  const first = held.service.runSync();
  const second = await held.service.runSync();
  assert.deepEqual(second, { skipped: "already_running" });
  release();
  assert.equal((await first).status, "success");

  const locked = setup({ withJobLock: async () => undefined }); // another instance holds the lease: the lock helper just returns
  assert.deepEqual(await locked.service.runSync(), { skipped: "already_running" });
  assert.equal(locked.site.requests.length, 0);
});

test("the guard is released after a run, so the next scheduled run goes ahead", async () => {
  const { site, service } = setup();
  site.feed = feedXml([publish(site, "y", "Y")]);
  assert.equal((await service.runSync()).status, "success");
  assert.equal((await service.runSync()).status, "success");
});

test("a run that was killed half-way is marked failed by the next run; the retry button clears back-off so failed articles are tried again", async () => {
  const { site, repo, service } = setup({ config: { maxArticleAttempts: 1 } });
  repo.runs.push({ _id: "stale", status: "running", feed: {}, startedAt: new Date("2026-10-27T00:00:00Z") });
  const link = url("hard");
  site.pages.set(link, new UscisHttpError("USCIS answered HTTP 503", { status: 503, retryable: true }));
  site.feed = feedXml([{ title: "Hard", link }]);
  await service.runSync();
  assert.equal(repo.runs.find((run) => run._id === "stale").status, "failed");
  assert.equal(repo.articles[0].syncStatus, "failed");

  site.pages.set(link, articleHtml(link, "Hard", "<p>Works now, the article text is here.</p>"));
  assert.equal(await repo.resetFailed(), 1);
  const result = await service.runSync();
  assert.equal(result.counts.created, 1);
  assert.equal(repo.articles.length, 1);
  assert.equal(repo.articles[0].listed, true);
});

test("slugs come from the address only and are always URL-safe", () => {
  assert.equal(slugFrom("Some_Weird Slug!!"), "some-weird-slug");
  assert.equal(slugFrom(""), "article");
  assert.ok(slugFrom("x".repeat(500)).length <= 190);
});
