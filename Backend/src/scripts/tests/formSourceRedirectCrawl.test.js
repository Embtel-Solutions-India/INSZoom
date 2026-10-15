// Release 0a redirect-chain crawl (Rule H). DB-free and network-free: fetch is a scripted fake.
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkUrl, crawlUrl, crawlAll, collectTrackedUrls, summarizeCrawl, parseArgs } = require("../formSourceRedirectCrawl");

// scripted fake: routes[url] = { status, headers, throws }; records every request and every body cancel
function fakeFetch(routes) {
  const requests = [];
  const cancelled = [];
  const impl = async (url, options = {}) => {
    requests.push({ url, options });
    const route = routes[url];
    if (!route) throw Object.assign(new Error(`no route for ${url}`), { name: "TypeError" });
    if (route.throws) throw route.throws;
    return {
      status: route.status ?? 200,
      headers: new Headers(route.headers || {}),
      body: { cancel: async () => { cancelled.push(url); } },
      text: async () => { throw new Error("the body must never be read"); },
      arrayBuffer: async () => { throw new Error("the body must never be read"); },
    };
  };
  return { impl, requests, cancelled };
}
const redirect = (to, status = 302) => ({ status, headers: { location: to } });
const page = (type = "text/html; charset=utf-8", extra = {}) => ({ status: 200, headers: { "content-type": type, ...extra } });

test("checkUrl accepts https uscis.gov and subdomains only", () => {
  for (const ok of ["https://uscis.gov/x", "https://www.uscis.gov/forms/i-131", "https://sub.deep.uscis.gov/a.pdf"]) assert.equal(checkUrl(ok).ok, true, ok);
  const cases = {
    "http://www.uscis.gov/x": "not_https",
    "https://evil.example.com/x": "host_not_uscis",
    "https://uscis.gov.evil.com/x": "host_not_uscis",
    "https://notuscis.gov/x": "host_not_uscis",
    "https://user:pw@www.uscis.gov/x": "credentials_in_url",
    "https://93.184.216.34/x": "ip_literal",
    "https://[::1]/x": "ip_literal",
    "https://www.uscis.gov:8443/x": "non_default_port",
    "not a url": "invalid_url",
  };
  for (const [url, violation] of Object.entries(cases)) {
    const result = checkUrl(url);
    assert.equal(result.ok, false, url);
    assert.ok(result.violations.includes(violation), `${url} -> ${result.violations}`);
  }
});

test("a direct 200 is ok_direct; the body is cancelled, never read; redirects are never followed automatically", async () => {
  const fetch = fakeFetch({ "https://www.uscis.gov/a.pdf": page("application/pdf", { "content-length": "1234" }) });
  const result = await crawlUrl("https://www.uscis.gov/a.pdf", { fetchImpl: fetch.impl });
  assert.equal(result.outcome, "ok_direct");
  assert.equal(result.finalStatus, 200);
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.contentLength, 1234);
  assert.deepEqual(fetch.cancelled, ["https://www.uscis.gov/a.pdf"]);
  assert.equal(fetch.requests[0].options.redirect, "manual");
  assert.equal(fetch.requests[0].options.credentials, "omit");
  assert.equal(fetch.requests[0].options.method, "GET");
  assert.equal("cookie" in (fetch.requests[0].options.headers || {}), false, "no cookies are sent");
});

test("apex -> www within uscis.gov is accepted and the chain is recorded", async () => {
  const fetch = fakeFetch({ "https://uscis.gov/i-131": redirect("https://www.uscis.gov/i-131", 301), "https://www.uscis.gov/i-131": page() });
  const result = await crawlUrl("https://uscis.gov/i-131", { fetchImpl: fetch.impl });
  assert.equal(result.outcome, "ok_redirected");
  assert.deepEqual(result.hops.map((hop) => hop.status), [301, 200]);
  assert.equal(result.finalUrl, "https://www.uscis.gov/i-131");
  assert.equal(result.leavesUscis, false);
  assert.deepEqual(result.violations, []);
});

test("a relative Location is resolved against the current url", async () => {
  const fetch = fakeFetch({ "https://www.uscis.gov/old": redirect("/new/path", 308), "https://www.uscis.gov/new/path": page() });
  const result = await crawlUrl("https://www.uscis.gov/old", { fetchImpl: fetch.impl });
  assert.equal(result.outcome, "ok_redirected");
  assert.equal(result.finalUrl, "https://www.uscis.gov/new/path");
});

test("a redirect to another host is rejected BEFORE that host is requested", async () => {
  const fetch = fakeFetch({ "https://www.uscis.gov/a": redirect("https://evil.example.com/steal"), "https://evil.example.com/steal": page() });
  const result = await crawlUrl("https://www.uscis.gov/a", { fetchImpl: fetch.impl });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.leavesUscis, true);
  assert.ok(result.violations.some((violation) => violation.type === "host_not_uscis" && violation.hop === 1));
  assert.deepEqual(fetch.requests.map((request) => request.url), ["https://www.uscis.gov/a"], "the off-host url was never requested");
});

test("a redirect down to http is rejected before it is requested", async () => {
  const fetch = fakeFetch({ "https://www.uscis.gov/a": redirect("http://www.uscis.gov/a"), "http://www.uscis.gov/a": page() });
  const result = await crawlUrl("https://www.uscis.gov/a", { fetchImpl: fetch.impl });
  assert.equal(result.outcome, "blocked");
  assert.ok(result.violations.some((violation) => violation.type === "not_https"));
  assert.equal(fetch.requests.length, 1);
});

test("a redirect loop is rejected", async () => {
  const fetch = fakeFetch({ "https://www.uscis.gov/a": redirect("https://www.uscis.gov/b"), "https://www.uscis.gov/b": redirect("https://www.uscis.gov/a") });
  const result = await crawlUrl("https://www.uscis.gov/a", { fetchImpl: fetch.impl });
  assert.equal(result.outcome, "blocked");
  assert.ok(result.violations.some((violation) => violation.type === "redirect_loop"));
  assert.equal(fetch.requests.length, 2);
});

test("too many hops is rejected at the limit", async () => {
  const routes = {};
  for (let index = 0; index < 10; index += 1) routes[`https://www.uscis.gov/${index}`] = redirect(`https://www.uscis.gov/${index + 1}`);
  const fetch = fakeFetch(routes);
  const result = await crawlUrl("https://www.uscis.gov/0", { fetchImpl: fetch.impl, maxHops: 3 });
  assert.equal(result.outcome, "blocked");
  assert.ok(result.violations.some((violation) => violation.type === "too_many_hops"));
  assert.equal(fetch.requests.length, 4, "the first url plus three hops, then stop");
});

test("redirect without Location, credentials, IP literal and non-default port are all rejected", async () => {
  const fetch = fakeFetch({
    "https://www.uscis.gov/nolocation": { status: 302 },
    "https://www.uscis.gov/c": redirect("https://user:pw@www.uscis.gov/d"),
    "https://www.uscis.gov/i": redirect("https://93.184.216.34/x"),
    "https://www.uscis.gov/p": redirect("https://www.uscis.gov:8443/x"),
  });
  const types = async (url) => (await crawlUrl(url, { fetchImpl: fetch.impl })).violations.map((violation) => violation.type);
  assert.ok((await types("https://www.uscis.gov/nolocation")).includes("redirect_without_location"));
  assert.ok((await types("https://www.uscis.gov/c")).includes("credentials_in_url"));
  assert.ok((await types("https://www.uscis.gov/i")).includes("ip_literal"));
  assert.ok((await types("https://www.uscis.gov/p")).includes("non_default_port"));
  assert.equal(fetch.requests.length, 4, "none of the unsafe targets was requested");
});

test("an unsafe starting url is not requested at all", async () => {
  const fetch = fakeFetch({});
  const result = await crawlUrl("http://www.uscis.gov/form", { fetchImpl: fetch.impl });
  assert.equal(result.outcome, "blocked");
  assert.equal(fetch.requests.length, 0);
});

test("http errors, content types and size are reported without failing the crawl", async () => {
  const fetch = fakeFetch({
    "https://www.uscis.gov/gone": { status: 404 },
    "https://www.uscis.gov/zip": page("application/zip"),
    "https://www.uscis.gov/huge": page("application/pdf", { "content-length": String(60 * 1024 * 1024) }),
  });
  const gone = await crawlUrl("https://www.uscis.gov/gone", { fetchImpl: fetch.impl });
  assert.equal(gone.outcome, "http_error");
  assert.equal(gone.finalStatus, 404);
  const zip = await crawlUrl("https://www.uscis.gov/zip", { fetchImpl: fetch.impl });
  assert.ok(zip.violations.some((violation) => violation.type === "content_type_not_allowed"));
  const huge = await crawlUrl("https://www.uscis.gov/huge", { fetchImpl: fetch.impl });
  assert.ok(huge.violations.some((violation) => violation.type === "size_over_cap"));
});

test("a network error or timeout is recorded as an error, never thrown", async () => {
  const fetch = fakeFetch({
    "https://www.uscis.gov/slow": { throws: Object.assign(new Error("aborted"), { name: "AbortError" }) },
    "https://www.uscis.gov/down": { throws: new Error("ECONNRESET") },
  });
  const slow = await crawlUrl("https://www.uscis.gov/slow", { fetchImpl: fetch.impl, timeoutMs: 50 });
  assert.equal(slow.outcome, "error");
  assert.match(slow.error.message, /no response within 50 ms/);
  const down = await crawlUrl("https://www.uscis.gov/down", { fetchImpl: fetch.impl });
  assert.equal(down.outcome, "error");
  assert.match(down.error.message, /ECONNRESET/);
});

test("a request that never answers is aborted by the timeout", async () => {
  const impl = (url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
  const result = await crawlUrl("https://www.uscis.gov/hang", { fetchImpl: impl, timeoutMs: 20 });
  assert.equal(result.outcome, "error");
  assert.match(result.error.message, /no response within 20 ms/);
});

test("collectTrackedUrls dedupes and keeps which forms / editions / fields use each url", () => {
  const templates = [
    { formCode: "I-131", version: "2026-09-18", status: "active", officialPdfUrl: "https://www.uscis.gov/i-131.pdf", artifacts: { form: { sourceUrl: "https://www.uscis.gov/i-131.pdf" } }, lifecycle: { sourcePageUrl: "https://www.uscis.gov/i-131" }, instructionsPdfUrl: "https://www.uscis.gov/i-131instr.pdf" },
    { formCode: "I-131", version: "2025-01-20", status: "retired", officialPdfUrl: "https://www.uscis.gov/i-131.pdf" },
    { formCode: "G-28", version: "x", status: "active" },
  ];
  const urls = collectTrackedUrls(templates);
  assert.deepEqual(urls.map((entry) => entry.url), ["https://www.uscis.gov/i-131", "https://www.uscis.gov/i-131.pdf", "https://www.uscis.gov/i-131instr.pdf"]);
  const pdf = urls.find((entry) => entry.url.endsWith("i-131.pdf"));
  assert.deepEqual(pdf.kinds, ["form_pdf"]);
  assert.equal(pdf.forms.length, 2, "two editions use the same pdf url");
  assert.deepEqual(urls.find((entry) => entry.url.endsWith("instr.pdf")).kinds, ["instructions_pdf"]);
});

test("crawlAll keeps the input order, respects concurrency and reports progress", async () => {
  let inFlight = 0;
  let peak = 0;
  const impl = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return { status: 200, headers: new Headers({ "content-type": "text/html" }), body: { cancel: async () => {} } };
  };
  const entries = Array.from({ length: 7 }, (_, index) => ({ url: `https://www.uscis.gov/${index}`, kinds: ["form_page"], forms: [{ formCode: `F${index}` }] }));
  const progress = [];
  const results = await crawlAll(entries, { fetchImpl: impl, concurrency: 2, delayMs: 0, onProgress: (done) => progress.push(done) });
  assert.deepEqual(results.map((result) => result.url), entries.map((entry) => entry.url));
  assert.ok(peak <= 2, `peak concurrency ${peak}`);
  assert.equal(progress.length, 7);
  assert.equal(results[3].forms[0].formCode, "F3");
});

test("summarizeCrawl: a clean crawl does not block hardening; a chain leaving uscis.gov does", async () => {
  const good = fakeFetch({ "https://uscis.gov/a": redirect("https://www.uscis.gov/a", 301), "https://www.uscis.gov/a": page(), "https://www.uscis.gov/b": page("application/pdf") });
  const goodResults = await crawlAll([
    { url: "https://uscis.gov/a", kinds: [], forms: [{ formCode: "A" }] },
    { url: "https://www.uscis.gov/b", kinds: [], forms: [{ formCode: "B" }] },
  ], { fetchImpl: good.impl, delayMs: 0 });
  const clean = summarizeCrawl(goodResults);
  assert.equal(clean.blocksHardening, false);
  assert.equal(clean.redirectedCount, 1);
  assert.deepEqual(clean.outcomes, { ok_redirected: 1, ok_direct: 1 });
  assert.match(clean.verdict, /will not break/);

  const bad = fakeFetch({ "https://www.uscis.gov/c": redirect("https://cdn.example.com/c.pdf") });
  const badResults = await crawlAll([{ url: "https://www.uscis.gov/c", kinds: [], forms: [{ formCode: "C" }] }], { fetchImpl: bad.impl, delayMs: 0 });
  const blocked = summarizeCrawl(badResults);
  assert.equal(blocked.blocksHardening, true);
  assert.equal(blocked.chainsLeavingUscis.length, 1);
  assert.deepEqual(blocked.chainsLeavingUscis[0].forms, ["C"]);
  assert.match(blocked.verdict, /BLOCKED/);
});

test("a plain network failure does not by itself block hardening", async () => {
  const fetch = fakeFetch({ "https://www.uscis.gov/x": { throws: new Error("ECONNRESET") } });
  const summary = summarizeCrawl(await crawlAll([{ url: "https://www.uscis.gov/x", kinds: [], forms: [] }], { fetchImpl: fetch.impl, delayMs: 0 }));
  assert.equal(summary.blocksHardening, false);
  assert.equal(summary.failures.length, 1);
});

test("parseArgs reads the options and ignores bad numbers", () => {
  const args = parseArgs(["--json", "--out", "x.json", "--concurrency", "3", "--delay-ms", "oops", "--limit", "5", "--url", "https://www.uscis.gov/x"]);
  assert.equal(args.json, true);
  assert.equal(args.out, "x.json");
  assert.equal(args.concurrency, 3);
  assert.equal(args.delayMs, 250, "a bad number keeps the default");
  assert.equal(args.limit, 5);
  assert.equal(args.url, "https://www.uscis.gov/x");
});
