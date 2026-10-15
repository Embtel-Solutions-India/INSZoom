// Plan Rule H: the redirect-safe official-source fetcher + the HTML text extractor. Network-free: fetch is scripted.
const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchOfficialSource, readCapped } = require("../OfficialSourceFetcher");
const { htmlToText, collapseWhitespace, decodeEntities } = require("../htmlText");
const { checkUrl } = require("../officialUrl");

function fakeFetch(routes) {
  const requests = [];
  const impl = async (url, options = {}) => {
    requests.push({ url, options });
    const route = routes[url];
    if (!route) throw new Error(`no route for ${url}`);
    if (route.throws) throw route.throws;
    const body = route.body === undefined ? "" : route.body;
    return {
      status: route.status ?? 200,
      headers: new Headers(route.headers || {}),
      body: route.stream ? route.stream() : undefined,
      arrayBuffer: async () => Buffer.from(body),
    };
  };
  return { impl, requests };
}
const redirect = (to, status = 302) => ({ status, headers: { location: to } });
const html = (body = "<p>hello</p>", extra = {}) => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8", ...extra }, body });

test("a direct 200 html page is returned with its chain; the request is manual-redirect, no cookies or credentials", async () => {
  const f = fakeFetch({ "https://www.uscis.gov/a": html("<p>x</p>") });
  const result = await fetchOfficialSource("https://www.uscis.gov/a", { fetchImpl: f.impl });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, "https://www.uscis.gov/a");
  assert.equal(result.bytes.toString(), "<p>x</p>");
  assert.deepEqual(result.chain, [{ url: "https://www.uscis.gov/a", status: 200, location: null }]);
  assert.equal(f.requests[0].options.redirect, "manual");
  assert.equal(f.requests[0].options.credentials, "omit");
  assert.equal("cookie" in f.requests[0].options.headers, false);
});

test("apex -> www within uscis.gov is followed and the whole chain is returned", async () => {
  const f = fakeFetch({ "https://uscis.gov/n": redirect("https://www.uscis.gov/n", 301), "https://www.uscis.gov/n": html() });
  const result = await fetchOfficialSource("https://uscis.gov/n", { fetchImpl: f.impl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.chain.map((hop) => hop.status), [301, 200]);
  assert.equal(result.finalUrl, "https://www.uscis.gov/n");
});

test("off-host, http, loop, too-many-hops, credentials, IP and port are all rejected before the bad hop is requested", async () => {
  const routes = {
    "https://www.uscis.gov/off": redirect("https://evil.example.com/x"),
    "https://www.uscis.gov/down": redirect("http://www.uscis.gov/x"),
    "https://www.uscis.gov/l1": redirect("https://www.uscis.gov/l2"),
    "https://www.uscis.gov/l2": redirect("https://www.uscis.gov/l1"),
    "https://www.uscis.gov/cred": redirect("https://u:p@www.uscis.gov/x"),
    "https://www.uscis.gov/ip": redirect("https://93.184.216.34/x"),
    "https://www.uscis.gov/port": redirect("https://www.uscis.gov:8443/x"),
    "https://www.uscis.gov/nl": { status: 302 },
  };
  for (let i = 0; i < 9; i += 1) routes[`https://www.uscis.gov/h${i}`] = redirect(`https://www.uscis.gov/h${i + 1}`);
  const f = fakeFetch(routes);
  const types = async (url, options = {}) => (await fetchOfficialSource(url, { fetchImpl: f.impl, ...options })).violations.map((violation) => violation.type);
  assert.deepEqual(await types("https://www.uscis.gov/off"), ["host_not_uscis"]);
  assert.deepEqual(await types("https://www.uscis.gov/down"), ["not_https"]);
  assert.deepEqual(await types("https://www.uscis.gov/l1"), ["redirect_loop"]);
  assert.deepEqual(await types("https://www.uscis.gov/cred"), ["credentials_in_url"]);
  assert.ok((await types("https://www.uscis.gov/ip")).includes("ip_literal"), "an IP literal is also not a uscis.gov host");
  assert.deepEqual(await types("https://www.uscis.gov/port"), ["non_default_port"]);
  assert.deepEqual(await types("https://www.uscis.gov/nl"), ["redirect_without_location"]);
  assert.deepEqual(await types("https://www.uscis.gov/h0", { maxHops: 3 }), ["too_many_hops"]);
  const requested = f.requests.map((request) => request.url);
  for (const bad of ["https://evil.example.com/x", "http://www.uscis.gov/x", "https://u:p@www.uscis.gov/x", "https://93.184.216.34/x", "https://www.uscis.gov:8443/x"]) assert.equal(requested.includes(bad), false, `${bad} must never be requested`);
});

test("an unsafe starting url is rejected without any request; result is never ok", async () => {
  const f = fakeFetch({});
  const result = await fetchOfficialSource("http://www.uscis.gov/x", { fetchImpl: f.impl });
  assert.equal(result.ok, false);
  assert.equal(f.requests.length, 0);
  assert.ok(result.violations.some((violation) => violation.type === "not_https"));
});

test("content type: html is accepted for html, pdf for pdf, anything else is refused", async () => {
  const f = fakeFetch({
    "https://www.uscis.gov/p": { status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF" },
    "https://www.uscis.gov/z": { status: 200, headers: { "content-type": "application/zip" }, body: "PK" },
    "https://www.uscis.gov/h": html(),
  });
  assert.equal((await fetchOfficialSource("https://www.uscis.gov/p", { fetchImpl: f.impl, accept: "pdf" })).ok, true);
  assert.equal((await fetchOfficialSource("https://www.uscis.gov/p", { fetchImpl: f.impl, accept: "html" })).ok, false, "a pdf is not html");
  assert.equal((await fetchOfficialSource("https://www.uscis.gov/h", { fetchImpl: f.impl, accept: "pdf" })).ok, false, "html is not a pdf");
  const zip = await fetchOfficialSource("https://www.uscis.gov/z", { fetchImpl: f.impl });
  assert.equal(zip.ok, false);
  assert.ok(zip.violations.some((violation) => violation.type === "content_type_not_allowed"));
});

test("a declared or actual body over the cap is refused, and a streaming body is cut off at the cap", async () => {
  const f = fakeFetch({
    "https://www.uscis.gov/declared": html("x", { "content-length": "999999" }),
    "https://www.uscis.gov/actual": html("x".repeat(500)),
  });
  const declared = await fetchOfficialSource("https://www.uscis.gov/declared", { fetchImpl: f.impl, maxBytes: 1000 });
  assert.equal(declared.ok, false);
  assert.ok(declared.violations.some((violation) => violation.type === "size_over_cap"));
  const actual = await fetchOfficialSource("https://www.uscis.gov/actual", { fetchImpl: f.impl, maxBytes: 100 });
  assert.equal(actual.ok, false);
  assert.ok(actual.violations.some((violation) => violation.type === "size_over_cap"));

  let cancelled = false;
  let reads = 0;
  const stream = { getReader: () => ({ read: async () => { reads += 1; return { done: false, value: new Uint8Array(60) }; }, cancel: async () => { cancelled = true; } }) };
  const capped = await readCapped({ body: stream }, 100);
  assert.equal(capped.tooLarge, true);
  assert.equal(cancelled, true);
  assert.equal(reads, 2, "stopped as soon as the cap was passed");
});

test("http errors, network errors and timeouts come back as not ok with a message, never thrown", async () => {
  const f = fakeFetch({
    "https://www.uscis.gov/404": { status: 404, headers: { "content-type": "text/html" } },
    "https://www.uscis.gov/net": { throws: new Error("ECONNRESET") },
    "https://www.uscis.gov/slow": { throws: Object.assign(new Error("aborted"), { name: "AbortError" }) },
  });
  assert.match((await fetchOfficialSource("https://www.uscis.gov/404", { fetchImpl: f.impl })).error, /HTTP 404/);
  assert.match((await fetchOfficialSource("https://www.uscis.gov/net", { fetchImpl: f.impl })).error, /ECONNRESET/);
  assert.match((await fetchOfficialSource("https://www.uscis.gov/slow", { fetchImpl: f.impl, timeoutMs: 25 })).error, /no response within 25 ms/);
});

test("the shared url check is the same one the Release 0a crawl uses", () => {
  assert.equal(require("../../../scripts/formSourceRedirectCrawl").checkUrl, checkUrl);
});

// ---- html text ----
test("htmlToText drops scripts / styles / comments / tags, decodes entities and collapses whitespace", () => {
  const text = htmlToText("<html><head><style>.a{}</style><script>alert(1)</script></head><body><!-- hidden --><h1>Title</h1><p>USCIS&nbsp;will   accept&nbsp;the&nbsp;01/20/25 edition &amp; it&rsquo;s fine.</p><ul><li>one</li><li>two</li></ul></body></html>");
  assert.equal(text, "Title USCIS will accept the 01/20/25 edition & it’s fine. one two");
  assert.equal(text.includes("alert"), false);
  assert.equal(text.includes("hidden"), false);
});

test("block elements never fuse words; numeric and named entities decode; bad code points do not throw", () => {
  assert.equal(htmlToText("<p>alpha</p><p>beta</p>"), "alpha beta");
  assert.equal(decodeEntities("&#8217; &#x2014; &ndash; &unknown; &#xD800; &#99999999;"), "’ — – &unknown;    ", "unknown entities stay as typed; invalid code points become a space");
  assert.equal(collapseWhitespace("  a \n\t b c  "), "a b c");
  assert.equal(htmlToText(null), "");
});

test("the extraction is stable: the same html always gives the same text (it is hashed as evidence)", () => {
  const input = "<div><p>Edition 01/20/25</p></div>";
  assert.equal(htmlToText(input), htmlToText(input));
});
