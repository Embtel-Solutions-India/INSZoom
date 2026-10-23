// Phase 7.E catalog entry "source_not_found": contract shape, matching, and each strategy against an injected fake uscis.gov (no network, no database).
const test = require("node:test");
const assert = require("node:assert/strict");
const entry = require("../resolution/catalog/sourceNotFound");

const BASE = "https://www.uscis.gov";
const PDF = (slug) => `${BASE}/sites/default/files/document/forms/${slug}.pdf`;
const site = (pages) => async (url, { accept = "html" } = {}) => {
  const hit = pages[url];
  if (!hit) return { ok: false, status: 404, error: "HTTP 404" };
  if (hit.pdf) return accept === "pdf" ? { ok: true, status: 200, finalUrl: url, bytes: Buffer.from("%PDF-1.7") } : { ok: false, status: 200 };
  return accept === "html" ? { ok: true, status: 200, finalUrl: url, bytes: Buffer.from(hit.html) } : { ok: false, status: 200 };
};
const ctxFor = (formCode, pages, extra = {}) => ({ job: {}, stage: "detect", formCode, error: new Error("USCIS page fetch failed: 404"), diagnosis: { cause: "source_not_found" }, attempt: 1, deps: { fetch: site(pages), directory: async () => [], ...extra } });

const pages = {
  [`${BASE}/i-485supj`]: { html: "<h1>Form I-485 Supplement J</h1><a href=\"/sites/default/files/document/forms/i-485supj.pdf\">PDF</a>" },
  [PDF("i-485supj")]: { pdf: true },
  [`${BASE}/i-539`]: { html: "<h1>Form I-539</h1><a href=\"/sites/default/files/document/forms/i-539a.pdf\">I-539A</a>" },
  [PDF("i-539a")]: { pdf: true },
};

test("the entry follows the catalog contract exactly", () => {
  assert.equal(typeof entry.id, "string");
  assert.equal(typeof entry.description, "string");
  assert.equal(typeof entry.matches, "function");
  assert.ok(entry.strategies.length >= 5);
  for (const strategy of entry.strategies) {
    assert.ok(strategy.id && strategy.description);
    assert.equal(strategy.safe, true);
    assert.equal(typeof strategy.run, "function");
    assert.equal(typeof strategy.verify, "function");
  }
  assert.deepEqual(entry.strategies.map((s) => s.id), ["stored_source_recheck", "alias_slugs", "parent_page_scan", "stable_pdf_url", "directory_entry"]);
});

test("it matches the diagnosis, and the raw 404 / unresolved messages when no diagnosis exists", () => {
  assert.equal(entry.matches({ cause: "source_not_found" }, null), true);
  assert.equal(entry.matches({ cause: "tool_missing" }, new Error("USCIS page fetch failed: 404")), false);
  assert.equal(entry.matches(null, new Error("USCIS page fetch failed: 404")), true);
  assert.equal(entry.matches(null, Object.assign(new Error("x"), { code: "USCIS_PDF_UNRESOLVED" })), true);
  assert.equal(entry.matches(null, new Error("USCIS page fetch failed: 503")), false);
});

test("alias_slugs fixes I-485J and asks for a retry; evidence names only the URL and status", async () => {
  const strategy = entry.strategies.find((s) => s.id === "alias_slugs");
  const ctx = ctxFor("I-485J", pages);
  const result = await strategy.run(ctx);
  assert.equal(result.ok, true);
  assert.equal(result.retry, true);
  assert.match(result.evidence, /alias: https:\/\/www\.uscis\.gov\/sites\/default\/files\/document\/forms\/i-485supj\.pdf \(200\)/);
  assert.equal(await strategy.verify(ctx, result), true);
});

test("parent_page_scan fixes I-539A where alias_slugs cannot", async () => {
  const ctx = ctxFor("I-539A", pages);
  const alias = await entry.strategies.find((s) => s.id === "alias_slugs").run(ctx);
  assert.equal(alias.ok, false);
  const parent = entry.strategies.find((s) => s.id === "parent_page_scan");
  const result = await parent.run(ctx);
  assert.equal(result.ok, true);
  assert.equal(result.resolved.pageUrl, `${BASE}/i-539`);
  assert.equal(await parent.verify(ctx, result), true);
});

test("stable_pdf_url, directory_entry and stored_source_recheck each work on their own", async () => {
  const stable = await entry.strategies.find((s) => s.id === "stable_pdf_url").run(ctxFor("I-130A", { [PDF("i-130a")]: { pdf: true } }));
  assert.equal(stable.ok, true);
  const dir = await entry.strategies.find((s) => s.id === "directory_entry").run(ctxFor("I-485J", { [PDF("i-485supj")]: { pdf: true } }, { directory: async () => [{ formCode: "I-485J", pdfUrl: PDF("i-485supj") }] }));
  assert.equal(dir.ok, true);
  const stored = await entry.strategies.find((s) => s.id === "stored_source_recheck").run(ctxFor("I-485J", pages, { template: { officialPdfUrl: PDF("i-485supj") } }));
  assert.equal(stored.ok, true);
});

test("a strategy that finds nothing reports not-ok with a count and the last address, and verify refuses it", async () => {
  const strategy = entry.strategies.find((s) => s.id === "alias_slugs");
  const ctx = ctxFor("I-485J", {});
  const result = await strategy.run(ctx);
  assert.equal(result.ok, false);
  assert.match(result.evidence, /address\(es\) tried, last https:\/\/www\.uscis\.gov\/\S+ -> 404/);
  assert.equal(await strategy.verify(ctx, result), false);
});

test("the strategies never write (nothing to save is exposed to the engine) and never request outside uscis.gov", async () => {
  const requested = [];
  const fetch = async (url, options) => { requested.push(url); return site(pages)(url, options); };
  for (const strategy of entry.strategies) await strategy.run({ ...ctxFor("I-485J", pages), deps: { fetch, directory: async () => [], template: { officialPdfUrl: "https://elsewhere.example/x.pdf" } } });
  assert.ok(requested.length > 0);
  assert.ok(requested.every((url) => url.startsWith("https://www.uscis.gov/")));
});
