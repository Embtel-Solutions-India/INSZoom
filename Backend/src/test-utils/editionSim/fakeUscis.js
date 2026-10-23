// Phase 7.8 simulation: a fake uscis.gov. It is a `fetch` implementation (Response objects) handed to the REAL hardened fetcher (form-edition-policy/OfficialSourceFetcher), so
// the https / host / redirect / content-type / size checks of production run for real; only the network is replaced. No request ever leaves the machine.
//
//   const site = createFakeUscis({
//     "https://www.uscis.gov/i-485supj": { html: "<a href='/sites/default/files/document/forms/i-485supj.pdf'>Form I-485J</a>" },
//     "https://www.uscis.gov/sites/default/files/document/forms/i-485supj.pdf": { pdf: buffer },
//     "https://www.uscis.gov/i-485j": { status: 404 },
//     "https://www.uscis.gov/flaky.pdf": [{ status: 503 }, { status: 503 }, { pdf: buffer }],   // a sequence: answers in order, the last one repeats
//   });
//   site.fetchImpl, site.fetcher(url, options) (the real fetcher bound to the fake), site.hits (url -> count), site.log
const { fetchOfficialSource } = require("../../modules/form-edition-policy/OfficialSourceFetcher");

const normalize = (url) => String(url).split("#")[0].replace(/\/+$/, "").toLowerCase();

function toResponse(spec) {
  if (spec instanceof Error) throw spec;
  const status = spec.status ?? 200;
  if (spec.pdf) return new Response(spec.pdf, { status, headers: { "content-type": spec.contentType || "application/pdf" } });
  if (spec.html !== undefined) return new Response(spec.html, { status, headers: { "content-type": spec.contentType || "text/html; charset=utf-8" } });
  if (spec.body !== undefined) return new Response(spec.body, { status, headers: { "content-type": spec.contentType || "application/octet-stream" } });
  return new Response("", { status, headers: spec.headers || {} });
}

function createFakeUscis(routes = {}) {
  const table = new Map(Object.entries(routes).map(([url, spec]) => [normalize(url), spec]));
  const hits = new Map();
  const log = [];
  const served = new Map(); // answers given per ROUTE (a cache-busting query on a known address reaches the same route, like the real site)
  const sleep = (ms, signal) => new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true }); });
  const fetchImpl = async (url, init = {}) => {
    const key = normalize(url);
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);
    log.push(key);
    const route = table.has(key) ? key : key.split("?")[0];
    if (!table.has(route)) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    const nth = (served.get(route) || 0) + 1;
    served.set(route, nth);
    let spec = table.get(route);
    if (Array.isArray(spec)) spec = spec[Math.min(nth - 1, spec.length - 1)];
    if (typeof spec === "function") spec = spec({ url, count: nth });
    if (spec && spec.delayMs) await sleep(spec.delayMs, init.signal); // a slow server: the real fetcher's timeout aborts the request
    return toResponse(spec);
  };
  return {
    fetchImpl,
    hits: Object.assign((url) => hits.get(normalize(url)) || 0, { all: () => Object.fromEntries(hits) }),
    log,
    set(url, spec) { table.set(normalize(url), spec); },
    fetcher: (url, options = {}) => fetchOfficialSource(url, { ...options, fetchImpl }),
  };
}

module.exports = { createFakeUscis };
