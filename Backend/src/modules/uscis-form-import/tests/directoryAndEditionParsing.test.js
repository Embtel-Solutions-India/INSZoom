// Phase 7.2a: detection parsing against REAL uscis.gov pages (fixtures captured 2026-10-22, see the header comment in each file). DB-free, network-free.
// Every behavior change is behind FORM_PIPELINE_AUTONOMY: off = today's behavior, shadow = today's behavior plus a log line, on = the new behavior.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const S = require("../../uscis-lifecycle/services/USCISScannerService");
const patterns = require("../config/formCodePattern");

const FIX = path.join(__dirname, "fixtures", "uscis-pages");
const read = (name) => fs.readFileSync(path.join(FIX, name), "utf8");

async function withMode(mode, fn) {
  const previous = process.env.FORM_PIPELINE_AUTONOMY;
  process.env.FORM_PIPELINE_AUTONOMY = mode;
  try { return await fn(); } finally { if (previous === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = previous; }
}
const day = (date) => (date ? date.toISOString().slice(0, 10) : null);
const strip = (forms) => forms.map(({ detectedAt, ...rest }) => rest);

// ---- one form-code pattern ------------------------------------------------------------------------------------------------------------------------------------------
const codesIn = (text, mode) => [...text.matchAll(patterns.scanPattern(mode))].map((match) => S.normalizeFormCode(match[1]));

test("the shared pattern finds the forms the three old patterns missed, and still ignores visa classes and EOIR forms", () => {
  const text = "I-9 I-90 I-129 I-129F I-129CWR I-864EZ G-1145 AR-11 N-648 G-28I and I-485 Supplement A; not EOIR-29, H-1B, L-1, E-2";
  assert.deepEqual(codesIn(text, "on"), ["I-9", "I-90", "I-129", "I-129F", "I-129CWR", "I-864EZ", "G-1145", "AR-11", "N-648", "G-28I", "I-485 SUPPLEMENT A"]);
  // the old scanner pattern: no I-9, no I-864EZ, no I-129CWR (these were never detected)
  const legacy = codesIn(text, "off");
  for (const missed of ["I-9", "I-864EZ", "I-129CWR"]) assert.equal(legacy.includes(missed), false, `${missed} was missed by the old pattern`);
  assert.equal(codesIn("I-90 Application", "on").includes("I-9"), false, "I-90 is not I-9");
});

test("scanPattern follows the switch: shadow and off keep the old pattern, on uses the shared one", () => {
  assert.equal(patterns.scanPattern("off").source, patterns.scanPattern("shadow").source);
  assert.notEqual(patterns.scanPattern("on").source, patterns.scanPattern("off").source);
});

test("standalone check: off keeps each old pattern, on accepts the shared pattern OR the old one (it can only add forms)", () => {
  for (const code of ["I-129", "I-864EZ", "I-9", "I-129CWR", "N-648", "AR-11", "G-1145"]) assert.equal(patterns.isStandaloneFormCode(code, "sync", "on"), true, code);
  assert.equal(patterns.isStandaloneFormCode("I-864EZ", "sync", "off"), false, "the old sync pattern rejected I-864EZ");
  assert.equal(patterns.isStandaloneFormCode("I-129CWR", "importer", "off"), false, "the old importer pattern rejected 3 trailing letters");
  assert.equal(patterns.isStandaloneFormCode("I-1", "sync", "off"), true, "old sync pattern accepted one digit");
  assert.equal(patterns.isStandaloneFormCode("I-1", "sync", "on"), true, "on never rejects what was accepted before");
  for (const code of ["EOIR-29", "I-485 SUPPLEMENT A", "G-845SUPPLEMENT"]) assert.equal(patterns.isStandaloneFormCode(code, "sync", "on"), false, code);
});

// ---- directory parsing: one entry per ROW ----------------------------------------------------------------------------------------------------------------------------
const EXPECTED_ROWS = {
  "AR-11": "/ar-11", "EOIR-29": "/eoir-29", "G-28": "/g-28", "G-639": "/about-us/freedom-information-and-privacy-act-foia", "G-845": "/g-845", "G-845SUPPLEMENT": "/g-845-supplement", "G-1145": "/g-1145",
  "I-9": "/i-9", "I-90": "/i-90", "I-129": "/i-129", "I-129CW": "/i-129cw", "I-129CWR": "/i-129cwr", "I-129F": "/i-129f", "I-130": "/i-130", "I-131": "/i-131", "I-485": "/i-485",
  "I-485 SUPPLEMENT A": "/i-485supa", "I-485 SUPPLEMENT J": "/i-485supj", "I-539": "/i-539", "I-864": "/i-864", "I-864A": "/i-864a", "I-864EZ": "/i-864ez", "I-865": "/i-865", "N-648": "/n-648",
};

test("on: the real directory yields exactly one entry per row, each with ITS OWN code and address (nothing bleeds in from neighbours, the menu or descriptions)", async () => {
  const forms = await withMode("on", () => S.extractDirectoryForms(read("all-forms-directory.html")));
  assert.equal(forms.length, Object.keys(EXPECTED_ROWS).length);
  for (const [code, page] of Object.entries(EXPECTED_ROWS)) {
    const entries = forms.filter((item) => item.formCode === code);
    assert.equal(entries.length, 1, `${code} appears once`);
    assert.equal(entries[0].pageUrl.replace("https://www.uscis.gov", ""), page, `${code} address`);
  }
  assert.equal(forms.some((item) => /File Online|Form Details/.test(item.formName)), false, "button links are not forms");
  // EOIR-29's description mentions I-130 and I-360: the old parser listed EOIR-29's address under I-130 and G-28 as well
  assert.deepEqual(forms.filter((item) => item.pageUrl.endsWith("/eoir-29")).map((item) => item.formCode), ["EOIR-29"]);
  // the titles lose their "CODE | " prefix
  assert.equal(forms.find((item) => item.formCode === "I-129").formName, "Petition for a Nonimmigrant Worker");
  // I-9, I-864EZ and I-129CWR are now detected
  for (const code of ["I-9", "I-864EZ", "I-129CWR"]) assert.ok(forms.some((item) => item.formCode === code && item.pageUrl.endsWith(`/${code.toLowerCase()}`)), code);
});

test("the old parser mis-assigns rows on the same real page (documents what the row parser fixes)", async () => {
  const legacy = await withMode("off", () => S.extractDirectoryForms(read("all-forms-directory.html")));
  const eoirUnder = legacy.filter((item) => item.pageUrl.endsWith("/eoir-29")).map((item) => item.formCode);
  assert.ok(eoirUnder.some((code) => code !== "EOIR-29"), "the EOIR-29 page was listed under another form's code");
  assert.equal(legacy.some((item) => item.formCode === "I-9"), false, "I-9 was never detected");
  assert.equal(legacy.some((item) => item.formCode === "I-864EZ" && item.pageUrl.endsWith("/i-864ez")), false, "I-864EZ was never detected under its own code");
});

const DATED = { "AR-11": "2022-11-02", "EOIR-29": "2026-02-01", "G-28": "2018-09-17", "G-639": "2020-10-01", "G-845": "2022-04-10", "G-845SUPPLEMENT": "2022-04-10", "G-1145": "2014-09-26", "I-9": "2025-01-20", "I-90": "2025-01-20", "I-129": "2026-09-09", "I-129CW": "2024-08-12", "I-129CWR": "2024-05-30", "I-129F": "2025-01-20", "I-130": "2024-04-01", "I-131": "2025-01-20", "I-485": "2026-09-18", "I-485 SUPPLEMENT A": "2026-09-18", "I-485 SUPPLEMENT J": "2026-09-18", "I-539": "2024-08-28", "I-864": "2026-08-24", "I-864A": "2026-08-24", "I-864EZ": "2026-08-24", "I-865": "2021-11-30", "N-648": "2024-04-01" };

test("on: adjacent rows with DIFFERENT edition dates each keep their own date", async () => {
  const forms = await withMode("on", () => S.extractDirectoryForms(read("all-forms-directory-dated.html")));
  for (const [code, date] of Object.entries(DATED)) assert.equal(day(forms.find((item) => item.formCode === code)?.editionDate), date, code);
});

test("off: the old parser let a neighbouring row's date bleed (same fixture)", async () => {
  const legacy = await withMode("off", () => S.extractDirectoryForms(read("all-forms-directory-dated.html")));
  const wrong = Object.entries(DATED).filter(([code, date]) => legacy.filter((item) => item.formCode === code).some((item) => item.editionDate && day(item.editionDate) !== date));
  assert.ok(wrong.length >= 5, `expected several mis-dated forms, got ${wrong.map(([code]) => code)}`);
});

test("off and shadow return exactly the old parser's result; a page with no rows falls back to it even when on", async () => {
  const html = read("all-forms-directory.html");
  const legacy = strip(S.extractDirectoryFormsLegacy(html));
  assert.deepEqual(strip(await withMode("off", () => S.extractDirectoryForms(html))), legacy);
  assert.deepEqual(strip(await withMode("shadow", () => S.extractDirectoryForms(html))), legacy);
  const noRows = '<article><a href="/i-129">I-129, Petition for a Nonimmigrant Worker</a> <p>Edition Date: 10/01/2026</p></article>';
  assert.deepEqual(strip(await withMode("on", () => S.extractDirectoryForms(noRows))), strip(S.extractDirectoryFormsLegacy(noRows)));
});

test("the existing hand-written directory sample still parses the same way when on (rows absent -> old parser)", async () => {
  const html = '<article><a href="/i-129">I-129, Petition for a Nonimmigrant Worker</a><p>Edition Date: 10/01/2026</p><a href="/sites/default/files/document/forms/i-129.pdf">Download I-129 PDF</a></article>';
  const forms = await withMode("on", () => S.extractDirectoryForms(html, S.OFFICIAL_SOURCES.formsDirectoryUrl));
  assert.equal(forms.find((item) => item.formCode === "I-129" && item.pdfUrl).version, "2026-10-01");
});

// ---- form pages: which PDF is the form, which edition --------------------------------------------------------------------------------------------------------------
const PAGES = [["i-129.html", "I-129", "2026-09-09", "i-129.pdf"], ["i-131.html", "I-131", "2025-01-20", "i-131.pdf"], ["i-485.html", "I-485", "2026-09-18", "i-485.pdf"], ["i-864ez.html", "I-864EZ", "2026-08-24", "i-864ez.pdf"], ["i-539.html", "I-539", "2024-08-28", "i-539.pdf"], ["i-485supj.html", "I-485 SUPPLEMENT J", "2026-09-18", "i-485supj.pdf"]];

test("the real form pages give the same edition and PDF in every mode (the cases that already worked do not change)", async () => {
  for (const mode of ["off", "shadow", "on"]) {
    for (const [file, code, edition, pdf] of PAGES) {
      const meta = await withMode(mode, () => S.extractFormPageMetadata(read(file), `https://www.uscis.gov/${file.replace(".html", "")}`, code));
      assert.equal(day(meta.editionDate), edition, `${mode} ${code} edition`);
      assert.ok(String(meta.pdfUrl).endsWith(`/forms/${pdf}`), `${mode} ${code} pdf ${meta.pdfUrl}`);
    }
  }
});

test("I-9: the form PDF was missed (its link text says 'Download Instructions tab'); on finds it, off keeps the old answer", async () => {
  const off = await withMode("off", () => S.extractFormPageMetadata(read("i-9.html"), "https://www.uscis.gov/i-9", "I-9"));
  assert.equal(off.pdfUrl, null);
  const on = await withMode("on", () => S.extractFormPageMetadata(read("i-9.html"), "https://www.uscis.gov/i-9", "I-9"));
  assert.equal(on.pdfUrl, "https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf");
  assert.equal(on.instructionsPdfUrl, "https://www.uscis.gov/sites/default/files/document/forms/i-9instr.pdf");
  assert.equal(day(on.editionDate), "2025-01-20");
});

test("I-539 extractFormInfo picked the INSTRUCTIONS pdf; on picks the form, shadow keeps the old answer", async () => {
  const html = read("i-539.html");
  assert.ok((await withMode("off", () => S.extractFormInfo(html, "I-539"))).pdfUrl.endsWith("/i-539instr.pdf"));
  assert.ok((await withMode("shadow", () => S.extractFormInfo(html, "I-539"))).pdfUrl.endsWith("/i-539instr.pdf"));
  assert.ok((await withMode("on", () => S.extractFormInfo(html, "I-539"))).pdfUrl.endsWith("/i-539.pdf"));
});

test("I-485J is recognised by its alias file name (i-485supj.pdf) whichever spelling the caller uses", async () => {
  for (const code of ["I-485J", "I-485 Supplement J", "I-485 SUPPLEMENT J"]) {
    const meta = await withMode("on", () => S.extractFormPageMetadata(read("i-485supj.html"), "https://www.uscis.gov/i-485supj", code));
    assert.ok(meta.pdfUrl.endsWith("/forms/i-485supj.pdf"), `${code}: ${meta.pdfUrl}`);
    assert.ok(meta.instructionsPdfUrl.includes("i-485supjinstr"), code);
  }
});

test("a future edition date is not the edition in force: on ignores it, off keeps it", async () => {
  const text = "Form Details Edition Date 12/31/2099 . You can find the edition date at the bottom";
  assert.equal(day(await withMode("off", () => S.editionDateOf(text))), "2099-12-31");
  assert.equal(day(await withMode("shadow", () => S.editionDateOf(text))), "2099-12-31");
  assert.equal(await withMode("on", () => S.editionDateOf(text)), null);
  // the labelled value wins over an earlier looser mention
  const loose = "Edition: 01/01/2010 was retired. Form Details Edition Date 01/20/25 .";
  assert.equal(day(await withMode("on", () => S.editionDateOf(loose))), "2025-01-20");
  assert.equal(day(await withMode("off", () => S.editionDateOf(loose))), "2010-01-01");
});
