// Phase 7.2: the real dependencies of the generic error-resolution catalog (resolution/importDeps.js). Fetcher, template lookup and source resolver are injected: no network, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { createImportDeps } = require("../resolution/importDeps");
const PdfDownload = require("../../uscis-form-import/services/PdfDownload");

async function makePdf({ fields = ["Name[0]"] } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  fields.forEach((name, index) => pdf.getForm().createTextField(name).addToPage(page, { x: 10, y: 250 - index * 25, width: 100, height: 20 }));
  return Buffer.from(await pdf.save());
}
const pdfResult = (bytes) => ({ ok: true, bytes, status: 200, contentType: "application/pdf", violations: [] });
const htmlResult = (html) => ({ ok: true, bytes: Buffer.from(html), status: 200, contentType: "text/html", violations: [] });
const failure = (error = "HTTP 503") => ({ ok: false, error, violations: [], status: 503 });
const byUrl = (map) => { const calls = []; const fn = async (url, options) => { calls.push({ url, options }); return map[url] || failure("HTTP 404"); }; fn.calls = calls; return fn; };
const ctxFor = (extra = {}) => ({ formCode: "I-131", error: { sourceUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf" }, ...extra });
const make = (fetcher, extra = {}) => createImportDeps({ fetcher, loadTemplate: async () => ({ officialPdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf", lifecycle: { sourcePageUrl: "https://www.uscis.gov/i-131" } }), ...extra });
test.beforeEach(() => PdfDownload.clearHints());
test.after(() => PdfDownload.clearHints());

test("fetchVariant: the other host form of the same address, used only when it gives a complete PDF; the retry then uses it", async () => {
  const pdf = await makePdf();
  const fetcher = byUrl({ "https://uscis.gov/sites/default/files/document/forms/i-131.pdf": pdfResult(pdf) });
  const out = await make(fetcher).fetchVariant(ctxFor());
  assert.equal(out.ok, true);
  assert.equal(out.retry, true);
  assert.equal(PdfDownload.resolveUrlOverride("https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf"), "https://uscis.gov/sites/default/files/document/forms/i-131.pdf");
  const none = await make(byUrl({})).fetchVariant(ctxFor());
  assert.equal(none.ok, false);
  assert.match(none.evidence, /404/);
});

test("retryWithTimeout and redownload: verify a complete PDF; redownload uses a cache-busting query on the same official address and leaves a hint for the retry", async () => {
  const pdf = await makePdf();
  const url = "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf";
  const slow = byUrl({ [url]: pdfResult(pdf) });
  const t = await make(slow).retryWithTimeout(ctxFor({ error: { message: "Failed to download USCIS PDF: no response within 150 ms", sourceUrl: url } }));
  assert.equal(t.ok, true);
  assert.ok(slow.calls[0].options.timeoutMs >= 3 * PdfDownload.timeoutMs(), "three times the normal timeout");
  const busted = `${url}?_dl=2`;
  const fetcher = byUrl({ [busted]: pdfResult(pdf) });
  const r = await make(fetcher).redownload(ctxFor());
  assert.equal(r.ok, true);
  assert.equal(PdfDownload.resolveUrlOverride(url), busted);
  const cut = pdf.subarray(0, Math.floor(pdf.length / 2));
  const bad = await make(byUrl({ [busted]: pdfResult(cut) })).redownload(ctxFor());
  assert.equal(bad.ok, false);
  assert.match(bad.evidence, /cut off/);
  const html = await make(byUrl({ [busted]: htmlResult("<html></html>") })).redownload(ctxFor());
  assert.equal(html.ok, false);
});

test("the address of the failed download is needed: without one nothing is guessed", async () => {
  const deps = createImportDeps({ fetcher: byUrl({}), loadTemplate: async () => null });
  for (const name of ["fetchVariant", "retryWithTimeout", "redownload", "alternateNormalize"]) {
    const out = await deps[name]({ formCode: "I-999", error: name === "retryWithTimeout" ? { message: "timed out" } : {} }); // a longer wait only applies to a timeout
    assert.equal(out.ok, false, name);
    assert.match(out.evidence, /not known/);
  }
});

test("reresolvePdfLink: a different verified official PDF link is used; the same address, or none, is not a fix", async () => {
  const url = "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf";
  const other = "https://www.uscis.gov/sites/default/files/document/forms/i-131-new.pdf";
  const ok = await make(byUrl({}), { resolveSource: async () => ({ ok: true, pdfUrl: other, via: "parent_page", tried: [] }) }).reresolvePdfLink(ctxFor());
  assert.deepEqual([ok.ok, ok.retry], [true, true]);
  assert.equal(PdfDownload.resolveUrlOverride(url), other);
  PdfDownload.clearHints();
  const same = await make(byUrl({}), { resolveSource: async () => ({ ok: true, pdfUrl: url, via: "stored", tried: [] }) }).reresolvePdfLink(ctxFor());
  assert.equal(same.ok, false);
  const none = await make(byUrl({}), { resolveSource: async () => ({ ok: false, tried: [{}, {}] }) }).reresolvePdfLink(ctxFor());
  assert.equal(none.ok, false);
  assert.match(none.evidence, /2 addresses tried/);
});

test("alternateNormalize: only when the JavaScript normalizer keeps pages and field names; then the retry of that form's import uses it once", async () => {
  const pdf = await makePdf({ fields: ["A[0]", "B[0]", "C[0]"] });
  const url = "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf";
  const out = await make(byUrl({ [url]: pdfResult(pdf) })).alternateNormalize(ctxFor());
  assert.equal(out.ok, true);
  assert.match(out.evidence, /1 pages and 3 fields/);
  assert.equal(PdfDownload.consumeFallbackNormalize("I-131"), true);
  assert.equal(PdfDownload.consumeFallbackNormalize("I-131"), false, "used once");
  const refused = await make(byUrl({ [url]: pdfResult(pdf) }), { normalizeFallback: { normalizeVerified: async () => { throw new Error("changed the form structure (field count 3 -> 2)"); } } }).alternateNormalize(ctxFor());
  assert.equal(refused.ok, false);
  assert.equal(PdfDownload.consumeFallbackNormalize("I-131"), false, "a refused normalizer leaves no hint");
});

test("findCompanionPdf: a fillable companion PDF linked on the official page, verified to have fields; instructions and the failed address are never taken", async () => {
  const url = "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf";
  const page = "https://www.uscis.gov/i-131";
  const fillable = await makePdf({ fields: ["Name[0]", "Date[0]"] });
  const empty = await makePdf({ fields: [] });
  const html = `<a href="/sites/default/files/document/forms/i-131-instr.pdf">instructions</a><a href="${url}">same</a><a href="/sites/default/files/document/forms/i-131-static.pdf">static</a><a href="/sites/default/files/document/forms/i-131-fillable.pdf">fillable</a>`;
  const fetcher = byUrl({
    [page]: htmlResult(html),
    "https://www.uscis.gov/sites/default/files/document/forms/i-131-static.pdf": pdfResult(empty),
    "https://www.uscis.gov/sites/default/files/document/forms/i-131-fillable.pdf": pdfResult(fillable),
  });
  const deps = make(fetcher);
  const out = await deps.findCompanionPdf(ctxFor());
  assert.equal(out.ok, true);
  assert.match(out.evidence, /i-131-fillable\.pdf \(2 fields\)/);
  assert.equal(PdfDownload.resolveUrlOverride(url), "https://www.uscis.gov/sites/default/files/document/forms/i-131-fillable.pdf");
  assert.ok(!fetcher.calls.some((call) => /instr/.test(call.url)), "instructions are not downloaded");
  assert.equal(deps.acroformCompanion, deps.findCompanionPdf, "the name used in the plan is the same function");
  PdfDownload.clearHints();
  const nothing = await make(byUrl({ [page]: htmlResult("<p>no links</p>") })).findCompanionPdf(ctxFor());
  assert.equal(nothing.ok, false);
  assert.match(nothing.evidence, /no fillable companion/);
  const noPage = await make(byUrl({}), { loadTemplate: async () => ({}), resolveSource: async () => ({ ok: false }) }).findCompanionPdf({ formCode: "I-131", error: { sourceUrl: url } });
  assert.equal(noPage.ok, false);
  assert.match(noPage.evidence, /not known/);
});

test("shrinkTemplate never removes anything it cannot prove: it reports the sizes, honestly, as not fixed", async () => {
  const out = await make(byUrl({})).shrinkTemplate({ error: { sizes: { definition: 8 * 1048576, formFields: 3 * 1048576, tiny: 10 } } });
  assert.equal(out.ok, false);
  assert.match(out.evidence, /definition 8\.00 MB, formFields 3\.00 MB/);
  assert.match(out.evidence, /already stored once/);
});

test("trimLeadingJunk (pure) and the catalog contract: every name the generic catalog calls exists or is honestly absent", async () => {
  const deps = make(byUrl({}));
  const pdf = await makePdf();
  assert.ok(deps.trimLeadingJunk(Buffer.concat([Buffer.from("zz"), pdf])).equals(pdf));
  assert.equal(deps.trimLeadingJunk(pdf), null);
  for (const name of ["fetchVariant", "retryWithTimeout", "redownload", "reresolvePdfLink", "alternateNormalize", "findCompanionPdf", "shrinkTemplate"]) assert.equal(typeof deps[name], "function", name);
  // the catalog strategies that need something this module does not provide report "dependency not provided" instead of pretending
  const catalogEntry = require("../resolution/catalog/xfaNoFields");
  const results = [];
  for (const strategy of catalogEntry.strategies) results.push(await strategy.run({ formCode: "I-131", deps, error: { sourceUrl: "https://www.uscis.gov/x.pdf" } }));
  assert.match(results[1].evidence, /dependency not provided/);
  assert.match(results[2].evidence, /dependency not provided/);
});

test("the pipeline hands these dependencies to its runner", () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "..", "FormPipeline.js"), "utf8");
  assert.match(source, /resolverDeps: require\("\.\/resolution\/importDeps"\)\.createImportDeps\(\)/);
});
