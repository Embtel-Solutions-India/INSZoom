// Phase 7.2: the hardened PDF download (services/PdfDownload.js) and how the importer switches to it. No network, no database: the fetcher is injected, or global fetch is stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const PdfDownload = require("../services/PdfDownload");

async function makePdf(fieldName = "Name[0]") {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  const field = pdf.getForm().createTextField(fieldName);
  field.addToPage(page, { x: 10, y: 200, width: 100, height: 20 });
  return Buffer.from(await pdf.save());
}
const okResult = (bytes) => ({ ok: true, bytes, status: 200, contentType: "application/pdf", violations: [], chain: [] });
const sequence = (...results) => { const calls = []; const fn = async (url, options) => { calls.push({ url, options }); return results[Math.min(calls.length - 1, results.length - 1)]; }; fn.calls = calls; return fn; };

test("a complete PDF is returned as it is, through the hardened fetcher with a size cap and a timeout", async () => {
  const pdf = await makePdf();
  const fetcher = sequence(okResult(pdf));
  const out = await PdfDownload.fetchPdf("https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf", { fetcher, env: { USCIS_PDF_MAX_BYTES: "1000000", USCIS_PDF_TIMEOUT_MS: "5000" } });
  assert.ok(out.buffer.equals(pdf));
  assert.equal(fetcher.calls.length, 1);
  assert.deepEqual([fetcher.calls[0].options.accept, fetcher.calls[0].options.maxBytes, fetcher.calls[0].options.timeoutMs], ["pdf", 1000000, 5000]);
  assert.deepEqual(Object.keys(out).sort(), ["buffer", "contentLength", "contentType", "downloadedAt", "notes"]);
});

test("junk before the %PDF- header is trimmed, and the result starts with the header", async () => {
  const pdf = await makePdf();
  const out = await PdfDownload.fetchPdf("https://www.uscis.gov/x.pdf", { fetcher: sequence(okResult(Buffer.concat([Buffer.from("\r\n<!-- cache -->\r\n"), pdf]))) });
  assert.ok(out.buffer.equals(pdf));
  assert.match(out.notes.join(" "), /trimmed \d+ bytes/);
});

test("an HTML page in place of the PDF: the address is resolved once more through the supplied callback; without one the error is precise", async () => {
  const pdf = await makePdf();
  const html = { ok: false, violations: [{ type: "content_type_not_allowed" }], contentType: "text/html", status: 200 };
  const fetcher = sequence(html, okResult(pdf));
  const out = await PdfDownload.fetchPdf("https://www.uscis.gov/i-130", { fetcher, reresolve: async () => "https://www.uscis.gov/sites/default/files/document/forms/i-130.pdf" });
  assert.ok(out.buffer.equals(pdf));
  assert.equal(fetcher.calls[1].url, "https://www.uscis.gov/sites/default/files/document/forms/i-130.pdf");
  await assert.rejects(PdfDownload.fetchPdf("https://www.uscis.gov/i-130", { fetcher: sequence(html) }), (error) => error.code === "DOWNLOADED_RESOURCE_NOT_PDF" && error.status === 400 && error.sourceUrl === "https://www.uscis.gov/i-130");
  // the callback answering with the same address (or nothing) is not a second chance
  await assert.rejects(PdfDownload.fetchPdf("https://www.uscis.gov/i-130", { fetcher: sequence(html), reresolve: async () => "https://www.uscis.gov/i-130" }), { code: "DOWNLOADED_RESOURCE_NOT_PDF" });
});

test("a truncated download is repeated once: complete the second time = used; still cut and different = PDF_TRUNCATED; identical both times = the server really serves it, accepted", async () => {
  const pdf = await makePdf();
  const cut = pdf.subarray(0, pdf.length - 6000 > 100 ? pdf.length - 6000 : Math.floor(pdf.length / 2));
  const padded = Buffer.concat([pdf, Buffer.alloc(3000, 0x20)]); // a valid PDF with more than the 2 KB window after its last %%EOF
  assert.equal(PdfDownload.looksComplete(cut), false);
  const healed = await PdfDownload.fetchPdf("https://www.uscis.gov/x.pdf", { fetcher: sequence(okResult(cut), okResult(pdf)) });
  assert.ok(healed.buffer.equals(pdf));
  assert.match(healed.notes.join(" "), /downloaded again/);
  await assert.rejects(PdfDownload.fetchPdf("https://www.uscis.gov/x.pdf", { fetcher: sequence(okResult(cut), okResult(cut.subarray(0, cut.length - 10))) }), (error) => error.code === "PDF_TRUNCATED" && error.cause === "pdf_damaged" && error.status === 502);
  const same = await PdfDownload.fetchPdf("https://www.uscis.gov/x.pdf", { fetcher: sequence(okResult(padded), okResult(padded)) });
  assert.ok(same.buffer.equals(padded));
  assert.match(same.notes.join(" "), /identical/);
  // the second request carries a cache-busting query on the same official address
  const fetcher = sequence(okResult(cut), okResult(pdf));
  await PdfDownload.fetchPdf("https://www.uscis.gov/forms/x.pdf", { fetcher });
  assert.equal(fetcher.calls[1].url, "https://www.uscis.gov/forms/x.pdf?_dl=1");
});

test("errors keep the codes the importer already used, and name the address that failed", async () => {
  const bad = (result) => PdfDownload.fetchPdf("https://www.uscis.gov/x.pdf", { fetcher: sequence(result) });
  await assert.rejects(bad({ ok: false, status: 404, error: "HTTP 404", violations: [] }), (error) => error.code === "PDF_DOWNLOAD_FAILED" && error.status === 502 && /404/.test(error.message) && error.sourceUrl === "https://www.uscis.gov/x.pdf");
  await assert.rejects(bad({ ok: false, violations: [{ type: "size_over_cap" }], error: "too big" }), { code: "PDF_TOO_LARGE", status: 413 });
  await assert.rejects(bad({ ok: false, violations: [{ type: "host_not_uscis" }] }), { code: "UNSUPPORTED_PDF_SOURCE", status: 400 });
  await assert.rejects(bad({ ok: false, violations: [{ type: "not_https" }] }), { code: "INVALID_PDF_URL" });
  await assert.rejects(bad({ ok: false, violations: [], error: "no response within 60000 ms" }), { code: "PDF_DOWNLOAD_FAILED" });
});

test("a file labeled application/octet-stream (accepted by the original download) is answered by the original download and checked the same way", async () => {
  const pdf = await makePdf();
  const octet = { ok: false, violations: [{ type: "content_type_not_allowed" }], contentType: "application/octet-stream", status: 200 };
  let legacyCalls = 0;
  const out = await PdfDownload.fetchPdf("https://www.uscis.gov/x.pdf", { fetcher: sequence(octet), legacy: async () => { legacyCalls += 1; return { buffer: pdf, contentType: "application/octet-stream" }; } });
  assert.ok(out.buffer.equals(pdf));
  assert.equal(legacyCalls, 1);
  // and the same labeled file with junk in front is still trimmed
  const junky = await PdfDownload.fetchPdf("https://www.uscis.gov/x.pdf", { fetcher: sequence(octet), legacy: async () => ({ buffer: Buffer.concat([Buffer.from("xx"), pdf]), contentType: "" }) });
  assert.ok(junky.buffer.equals(pdf));
});

test("detectXfaOnly: an /XFA layer without AcroForm fields is XFA-only; a normal fillable form is not", async () => {
  const xfaOnly = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /AcroForm << /XFA [ (template) 5 0 R ] /Fields [] >> >> endobj\n%%EOF");
  assert.equal(PdfDownload.detectXfaOnly(xfaOnly).xfaOnly, true);
  const noAcro = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /XFA 5 0 R >> endobj\n%%EOF");
  const found = PdfDownload.detectXfaOnly(noAcro);
  assert.deepEqual([found.xfaOnly, found.hasAcroForm], [true, false]);
  assert.equal(PdfDownload.detectXfaOnly(await makePdf()).xfaOnly, false);
  assert.equal(PdfDownload.detectXfaOnly(Buffer.from("%PDF-1.7 /XFA /AcroForm /Fields [ 3 0 R ]")).xfaOnly, false);
  assert.equal(PdfDownload.detectXfaOnly(null).xfaOnly, false);
});

test("hints for the retry expire and the normalizer hint is used once", () => {
  PdfDownload.clearHints();
  PdfDownload.markFallbackNormalize("i-131", 1000);
  assert.equal(PdfDownload.consumeFallbackNormalize("I-131", 1000 + 60 * 1000), true);
  assert.equal(PdfDownload.consumeFallbackNormalize("I-131", 1000 + 60 * 1000), false);
  PdfDownload.markFallbackNormalize("I-131", 1000);
  assert.equal(PdfDownload.consumeFallbackNormalize("I-131", 1000 + 31 * 60 * 1000), false);
  PdfDownload.setUrlOverride("https://www.uscis.gov/a.pdf", "https://www.uscis.gov/b.pdf", 5000);
  assert.equal(PdfDownload.resolveUrlOverride("https://www.uscis.gov/a.pdf", 6000), "https://www.uscis.gov/b.pdf");
  assert.equal(PdfDownload.resolveUrlOverride("https://www.uscis.gov/other.pdf", 6000), "https://www.uscis.gov/other.pdf");
  assert.equal(PdfDownload.resolveUrlOverride("https://www.uscis.gov/a.pdf", 5000 + 31 * 60 * 1000), "https://www.uscis.gov/a.pdf");
  PdfDownload.clearHints();
});

// ---- the importer's switch: off = the original download, byte for byte; shadow = original + a log; on = hardened ----
function stubFetch(handler) {
  const original = global.fetch;
  global.fetch = async (url, init) => handler(url, init);
  return () => { global.fetch = original; };
}
const response = (body, contentType) => new Response(body, { status: 200, headers: contentType ? { "content-type": contentType } : {} });

test("importer: switch off keeps the original behavior (an HTML page with no content type is still handed on); switch on refuses it precisely", async (t) => {
  const importer = require("../services/USCISFormImporterService");
  const service = new (importer.constructor)();
  const html = Buffer.from("<html><body>Not found</body></html>");
  const restore = stubFetch(async () => response(html, null));
  const saved = process.env.FORM_PIPELINE_AUTONOMY;
  const savedDelay = process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS;
  process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS = "0";
  t.after(() => { restore(); if (saved === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = saved; if (savedDelay === undefined) delete process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS; else process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS = savedDelay; });
  delete process.env.FORM_PIPELINE_AUTONOMY;
  const off = await service.downloadOfficialPdf("https://www.uscis.gov/forms/x.pdf");
  assert.ok(off.buffer.equals(html), "off: today's behavior - the bytes are handed on as downloaded");
  process.env.FORM_PIPELINE_AUTONOMY = "shadow";
  const shadow = await service.downloadOfficialPdf("https://www.uscis.gov/forms/x.pdf");
  assert.ok(shadow.buffer.equals(html), "shadow changes nothing");
  process.env.FORM_PIPELINE_AUTONOMY = "on";
  await assert.rejects(service.downloadOfficialPdf("https://www.uscis.gov/forms/x.pdf"), (error) => error.code === "DOWNLOADED_RESOURCE_NOT_PDF" && Boolean(error.sourceUrl));
});

test("importer: switch on downloads a good PDF exactly like off does (same bytes, same fields)", async (t) => {
  const importer = require("../services/USCISFormImporterService");
  const service = new (importer.constructor)();
  const pdf = await makePdf();
  const restore = stubFetch(async () => response(pdf, "application/pdf"));
  const saved = process.env.FORM_PIPELINE_AUTONOMY;
  t.after(() => { restore(); if (saved === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = saved; });
  delete process.env.FORM_PIPELINE_AUTONOMY;
  const off = await service.downloadOfficialPdf("https://www.uscis.gov/forms/x.pdf");
  process.env.FORM_PIPELINE_AUTONOMY = "on";
  const on = await service.downloadOfficialPdf("https://www.uscis.gov/forms/x.pdf");
  assert.ok(off.buffer.equals(on.buffer));
  assert.equal(off.attempts, on.attempts);
  assert.equal(off.sourceUrl, on.sourceUrl);
  assert.equal(off.artifactType, on.artifactType);
});
