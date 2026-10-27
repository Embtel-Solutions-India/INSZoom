// DB-free and network-free: the only HTTP client the news module has - SSRF allowlist, crawl-delay pacing, retries with back-off, conditional requests, size cap.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient, safeUscisUrl, UscisHttpError } = require("../uscisHttp");
const { getConfig, MIN_REQUEST_DELAY_MS } = require("../news.config");

const response = (status, body = "", headers = {}) => new Response(status === 304 ? null : body, { status, headers });
const FEED = "https://www.uscis.gov/news/rss-feed/59144";

function harness(script, config = {}) {
  const calls = [];
  const sleeps = [];
  let clock = 1_000_000;
  const client = createClient({
    config: { requestDelayMs: 10000, maxRetries: 3, requestTimeoutMs: 5000, maxBytes: 1024 * 1024, ...config },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = script.shift();
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(url, init) : next;
    },
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock,
  });
  return { client, calls, sleeps };
}

test("only https uscis.gov addresses pass: other hosts, look-alikes, internal addresses, credentials, ports and other schemes are refused", () => {
  assert.equal(safeUscisUrl("https://www.uscis.gov/newsroom/alerts/x"), "https://www.uscis.gov/newsroom/alerts/x");
  assert.equal(safeUscisUrl("/newsroom/alerts/x", "https://www.uscis.gov/a/b"), "https://www.uscis.gov/newsroom/alerts/x");
  assert.equal(safeUscisUrl("https://WWW.USCIS.GOV/x"), "https://www.uscis.gov/x");
  for (const bad of ["http://www.uscis.gov/x", "https://example.com/x", "https://www.uscis.gov.evil.example/x", "https://evil.example/www.uscis.gov", "https://uscis.gov@evil.example/x",
    "https://user:pw@www.uscis.gov/x", "https://www.uscis.gov:8080/x", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x",
    "file:///etc/passwd", "ftp://www.uscis.gov/x", "javascript:alert(1)", "", null, undefined]) assert.equal(safeUscisUrl(bad), null, String(bad));
});

test("the request pace never drops below the crawl-delay robots.txt asks for, whatever the environment says", () => {
  const previous = process.env.NEWS_SYNC_REQUEST_DELAY_MS;
  try {
    process.env.NEWS_SYNC_REQUEST_DELAY_MS = "1";
    assert.equal(getConfig().requestDelayMs, MIN_REQUEST_DELAY_MS);
    process.env.NEWS_SYNC_REQUEST_DELAY_MS = "30000";
    assert.equal(getConfig().requestDelayMs, 30000);
  } finally {
    if (previous === undefined) delete process.env.NEWS_SYNC_REQUEST_DELAY_MS; else process.env.NEWS_SYNC_REQUEST_DELAY_MS = previous;
  }
});

test("a request to a refused address never reaches the network", async () => {
  const { client, calls } = harness([]);
  await assert.rejects(client.get("https://169.254.169.254/latest"), (error) => error instanceof UscisHttpError && error.permanent);
  assert.equal(calls.length, 0);
});

test("requests are spaced by the crawl-delay and identify the importer; the first needs no wait", async () => {
  const { client, calls, sleeps } = harness([response(200, "<a/>"), response(200, "<b/>"), response(200, "<c/>")]);
  await client.get(FEED);
  await client.get(FEED);
  await client.get(FEED);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps.every((ms) => ms >= 9999 && ms <= 10000));
  assert.match(calls[0].init.headers["User-Agent"], /^ImmiglanceNewsSync\/1\.0/);
  assert.equal(calls[0].init.redirect, "manual", "redirects are checked hop by hop, never followed blindly");
});

test("conditional requests send the stored validators and a 304 is reported as not modified", async () => {
  const { client, calls } = harness([response(304)]);
  const result = await client.get(FEED, { etag: '"abc"', lastModified: "Tue, 27 Oct 2026 22:24:12 GMT" });
  assert.equal(result.notModified, true);
  assert.equal(calls[0].init.headers["If-None-Match"], '"abc"');
  assert.equal(calls[0].init.headers["If-Modified-Since"], "Tue, 27 Oct 2026 22:24:12 GMT");
});

test("transient failures (network error, 503, 429) are retried with growing back-off and then succeed; 404 and 403 are not retried", async () => {
  const flaky = harness([new TypeError("fetch failed"), response(503), response(429, "", { "retry-after": "7" }), response(200, "ok")]);
  const result = await flaky.client.get(FEED);
  assert.equal(result.text, "ok");
  assert.equal(flaky.calls.length, 4);
  const backoffs = flaky.sleeps.filter((ms) => ms !== 10000 && !(ms > 9000 && ms <= 10000));
  assert.ok(backoffs.includes(2000) && backoffs.includes(4000) && backoffs.includes(7000), `retry waits ${backoffs}`);

  const missing = harness([response(404), response(200, "never")]);
  await assert.rejects(missing.client.get(FEED), (error) => error.permanent && error.status === 404);
  assert.equal(missing.calls.length, 1);
  const denied = harness([response(403)]);
  await assert.rejects(denied.client.get(FEED), (error) => error.permanent && error.status === 403, "an access restriction is respected, not worked around");
  assert.equal(denied.calls.length, 1);
});

test("retries are bounded: a source that keeps failing stops after maxRetries and the error says it is retryable", async () => {
  const { client, calls } = harness([response(500), response(500), response(500), response(500), response(200, "late")], { maxRetries: 3 });
  await assert.rejects(client.get(FEED), (error) => error.retryable && error.status === 500);
  assert.equal(calls.length, 4);
});

test("a redirect is followed only to another allowed uscis.gov address; a redirect to an internal or foreign host is refused", async () => {
  const ok = harness([response(301, "", { location: "/news/rss-feed/59144?x=1" }), response(200, "moved")]);
  const result = await ok.client.get("https://www.uscis.gov/old");
  assert.equal(result.text, "moved");
  assert.equal(ok.calls[1].url, "https://www.uscis.gov/news/rss-feed/59144?x=1");
  assert.equal(ok.calls[1].init.headers["If-None-Match"], undefined, "validators are not sent to a redirect target");

  for (const location of ["http://169.254.169.254/latest", "https://evil.example/x", "https://localhost:3000/admin"]) {
    const bad = harness([response(302, "", { location }), response(200, "should not be fetched")]);
    await assert.rejects(bad.client.get(FEED), (error) => error.permanent && /not allowed/.test(error.message), location);
    assert.equal(bad.calls.length, 1, location);
  }
  const loop = harness(Array.from({ length: 6 }, () => response(302, "", { location: "/again" })));
  await assert.rejects(loop.client.get(FEED), /Too many redirects/);
});

test("a response larger than the cap is rejected, declared or streamed", async () => {
  const declared = harness([response(200, "x", { "content-length": String(50 * 1024 * 1024) })], { maxBytes: 1024 * 1024 });
  await assert.rejects(declared.client.get(FEED), (error) => error.permanent && /larger/.test(error.message));
  const streamed = harness([response(200, "y".repeat(200 * 1024))], { maxBytes: 100 * 1024 });
  await assert.rejects(streamed.client.get(FEED), /larger/);
});

test("a timeout is a retryable network error, not a hang", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const { client } = harness([timeout, timeout, timeout, timeout], { maxRetries: 3 });
  await assert.rejects(client.get(FEED), (error) => error.retryable && /timed out/.test(error.message));
});
