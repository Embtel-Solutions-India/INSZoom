// DB-free: the public / staff HTTP layer of the news module (services injected), and the pure read-side helpers.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createRouter } = require("../news.routes");
const { parseListParams, toDetail, toListItem, list, getBySlug } = require("../news.service");

async function withServer(services, fn) {
  const app = express();
  app.use(express.json());
  app.use("/api/news", createRouter(services));
  app.use((error, req, res, next) => res.status(500).json({ success: false, message: error.message })); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/api/news`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null), headers: response.headers });

test("list parameters are validated and bounded: page 1..1000, limit 1..50, search trimmed to 100 characters, unknown categories ignored", () => {
  assert.deepEqual(parseListParams({}), { q: "", category: "", page: 1, limit: 12 });
  assert.deepEqual(parseListParams({ page: "-4", limit: "9999", q: "  h-1b   fees ", category: "alert" }), { q: "h-1b fees", category: "alert", page: 1, limit: 50 });
  assert.equal(parseListParams({ page: "99999" }).page, 1000);
  assert.equal(parseListParams({ limit: "0" }).limit, 1);
  assert.equal(parseListParams({ page: "abc", limit: "x" }).page, 1);
  assert.equal(parseListParams({ q: "x".repeat(500) }).q.length, 100);
  assert.equal(parseListParams({ category: "'; drop" }).category, "");
  assert.equal(parseListParams({ q: { $ne: "" }, category: ["alert"] }).q, "", "an operator object is not a search string");
});

test("the list is built database-side: only listed articles, newest first, paginated; a search uses the text index and relevance", async () => {
  const calls = [];
  const rows = [{ slug: "a", title: "A", category: "alert", publishedAt: new Date("2026-10-20"), excerpt: "e", syncStatus: "complete", canonicalUrl: "https://www.uscis.gov/newsroom/alerts/a" }];
  const chain = { select() { return chain; }, sort(sort) { calls.push({ sort }); return chain; }, skip(n) { calls.push({ skip: n }); return chain; }, limit(n) { calls.push({ limit: n }); return chain; }, lean: async () => rows };
  const articles = { find(filter, projection) { calls.push({ filter, projection }); return chain; }, countDocuments: async (filter) => { calls.push({ count: filter }); return 41; } };

  const plain = await list({ page: "3", limit: "10", category: "alert" }, { articles });
  assert.deepEqual(calls.find((call) => call.filter).filter, { listed: true, category: "alert" });
  assert.deepEqual(calls.find((call) => call.sort).sort, { publishedAt: -1, _id: -1 });
  assert.equal(calls.find((call) => "skip" in call).skip, 20);
  assert.equal(calls.find((call) => "limit" in call).limit, 10);
  assert.equal(plain.total, 41);
  assert.equal(plain.totalPages, 5);
  assert.equal(plain.hasMore, true);
  assert.equal(plain.items[0].categoryLabel, "Alert");

  calls.length = 0;
  await list({ q: "work permit" }, { articles });
  assert.deepEqual(calls.find((call) => call.filter).filter, { listed: true, $text: { $search: "work permit" } });
  assert.deepEqual(calls.find((call) => call.filter).projection, { score: { $meta: "textScore" } });
  assert.deepEqual(calls.find((call) => call.sort).sort, { score: { $meta: "textScore" }, publishedAt: -1 });
});

test("an article's detail carries an explicit content status: complete, incomplete (with the reason) or unavailable (excerpt only)", () => {
  const base = { slug: "s", title: "T", category: "news-release", excerpt: "x", canonicalUrl: "https://www.uscis.gov/newsroom/news-releases/s", images: [] };
  const complete = toDetail({ ...base, contentHtml: "<p>Body</p>", syncStatus: "complete", syncWarnings: ["notice: informational"] });
  assert.equal(complete.contentStatus, "complete");
  assert.deepEqual(complete.warnings, [], "informational notices are not shown as problems");
  const incomplete = toDetail({ ...base, contentHtml: "<p>Body</p>", syncStatus: "incomplete", syncWarnings: ["image 1 was not reproduced (it is not hosted on uscis.gov); see the original article"] });
  assert.equal(incomplete.contentStatus, "incomplete");
  assert.equal(incomplete.warnings.length, 1);
  const failed = toDetail({ ...base, contentHtml: "", syncStatus: "failed" });
  assert.equal(failed.contentStatus, "unavailable");
  assert.equal(failed.fullTextAvailable, false);
  assert.equal(failed.sourceUrl, base.canonicalUrl);
  assert.match(failed.source.name, /USCIS/);
  assert.equal(toListItem({ ...base, syncStatus: "failed" }).fullTextAvailable, false);
  assert.equal(toListItem({ ...base, syncStatus: "complete" }).complete, true);
});

test("an invalid or unknown slug is a not-found, never a query with the raw value", async () => {
  const articles = { findOne() { throw new Error("must not be queried for an invalid slug"); } };
  for (const slug of ["../etc/passwd", "UPPER space", "", "a".repeat(300), "-leading", { $ne: null }]) assert.equal(await getBySlug(slug, { articles }), null);
  assert.equal(await getBySlug("fine-slug", { articles: { findOne: () => ({ lean: async () => null }) } }), null);
});

test("public endpoints: list, article, 404 for an unknown slug, short public cache, no authentication needed", async () => {
  const services = {
    list: async (query) => ({ items: [{ slug: "a" }], echo: query }),
    getBySlug: async (slug) => (slug === "exists" ? { slug: "exists", title: "T" } : null),
    latest: async () => ({ slug: "a" }),
  };
  await withServer(services, async (base) => {
    const listed = await json(await fetch(`${base}?page=2&q=visa`));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.success, true);
    assert.deepEqual(listed.body.data.echo, { page: "2", q: "visa" });
    assert.match(listed.headers.get("cache-control"), /public, max-age=\d+/);
    assert.equal((await json(await fetch(`${base}/latest`))).body.data.slug, "a");
    const found = await json(await fetch(`${base}/exists`));
    assert.equal(found.status, 200);
    assert.equal(found.body.data.title, "T");
    const missing = await json(await fetch(`${base}/nope`));
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);
  });
});

test("a failing database turns into a controlled error response, not a crash", async () => {
  await withServer({ list: async () => { throw new Error("db down"); } }, async (base) => {
    const result = await json(await fetch(base));
    assert.equal(result.status, 500);
  });
});

test("staff endpoints are never public: no token, no access - not for status, failures, sync or retry", async () => {
  const touched = [];
  const services = {
    status: async () => { touched.push("status"); return {}; },
    failures: async () => { touched.push("failures"); return []; },
    startSync: async () => { touched.push("sync"); },
    resetFailed: async () => { touched.push("reset"); return 0; },
    isRunning: async () => false,
  };
  await withServer(services, async (base) => {
    for (const [method, path] of [["GET", "/admin/status"], ["GET", "/admin/failures"], ["POST", "/admin/sync"], ["POST", "/admin/retry-failed"]]) {
      const result = await json(await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined }));
      assert.equal(result.status, 401, `${method} ${path}`);
    }
    const forged = await json(await fetch(`${base}/admin/status`, { headers: { Authorization: "Bearer not-a-real-token" } }));
    assert.equal(forged.status, 401);
  });
  assert.deepEqual(touched, []);
});

test("'admin' can never be read as an article slug", async () => {
  await withServer({ getBySlug: async () => ({ slug: "admin" }) }, async (base) => {
    assert.equal((await json(await fetch(`${base}/admin`))).status, 401, "it falls into the staff guard, not the public article route");
  });
});

test("a signed-in staff member can read status and failures, start a sync (202, in the background) and retry failures; a sync already running is a 409", async () => {
  const calls = [];
  let running = false;
  const services = {
    adminGuard: [(req, res, next) => { req.user = { email: "staff@example.com" }; next(); }],
    status: async () => ({ enabled: true }),
    failures: async (limit) => [{ slug: "f", limit }],
    isRunning: async () => running,
    startSync: async (options) => { calls.push(options); },
    resetFailed: async () => 3,
  };
  await withServer(services, async (base) => {
    assert.equal((await json(await fetch(`${base}/admin/status`))).body.data.enabled, true);
    assert.equal((await json(await fetch(`${base}/admin/failures?limit=5`))).body.data[0].limit, "5");
    const started = await json(await fetch(`${base}/admin/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) }));
    assert.equal(started.status, 202);
    assert.deepEqual(calls[0], { trigger: "manual", force: true, requestedBy: "staff@example.com" });
    const retried = await json(await fetch(`${base}/admin/retry-failed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    assert.equal(retried.status, 202);
    assert.equal(retried.body.data.reset, 3);
    running = true;
    const busy = await json(await fetch(`${base}/admin/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    assert.equal(busy.status, 409);
    assert.equal(calls.length, 2, "nothing was started while a run was active");
  });
});
