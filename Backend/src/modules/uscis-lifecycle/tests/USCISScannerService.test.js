const assert = require("node:assert/strict");
const test = require("node:test");
const USCISFormSyncRun = require("../../../models/USCISFormSyncRun");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISScannerService = require("../services/USCISScannerService");

test("USCISScannerService extracts PDF URL and edition date from USCIS page HTML", () => {
  const html = '<html><body>Edition Date: 10/01/2026 <a href="/sites/default/files/document/forms/i-129.pdf">PDF</a></body></html>';
  const info = USCISScannerService.extractFormInfo(html, "I-129");
  assert.equal(info.formType, "I-129");
  assert.equal(info.pdfUrl, "https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf");
  assert.equal(info.editionDate.getUTCFullYear(), 2026);
});

test("USCISScannerService discovers forms from official directory HTML", () => {
  const html = `
    <article>
      <a href="/i-129">I-129, Petition for a Nonimmigrant Worker</a>
      <p>Edition Date: 10/01/2026</p>
      <a href="/sites/default/files/document/forms/i-129.pdf">Download I-129 PDF</a>
      <a href="https://www.uscis.gov/sites/default/files/document/forms/g-28.pdf">G-28 Notice of Entry of Appearance</a>
    </article>`;
  const forms = USCISScannerService.extractDirectoryForms(html, USCISScannerService.OFFICIAL_SOURCES.formsDirectoryUrl);
  const i129 = forms.find((item) => item.formCode === "I-129" && item.pdfUrl);
  const g28 = forms.find((item) => item.formCode === "G-28");
  assert.equal(i129.pdfUrl, "https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf");
  assert.equal(i129.version, "2026-10-01");
  assert.equal(g28.pdfUrl, "https://www.uscis.gov/sites/default/files/document/forms/g-28.pdf");
});

test("USCISScannerService rejects non-USCIS synchronization sources", () => {
  assert.throws(() => USCISScannerService.absoluteUrl("https://example.com/i-129.pdf"), /official USCIS/);
  assert.throws(() => USCISScannerService.absoluteUrl("https://notuscis.gov/i-129.pdf"), /official USCIS/);
});

test("USCISScannerService extracts authoritative form-page registry metadata", () => {
  const html = `
    <html>
      <head>
        <meta name="description" content="Use this form to petition for a nonimmigrant worker.">
        <meta property="article:section" content="Employment-Based Forms">
      </head>
      <body>
        <h1>I-129, Petition for a Nonimmigrant Worker</h1>
        <a href="/sites/default/files/document/forms/i-129.pdf">Form I-129</a>
        <a href="/sites/default/files/document/forms/i-129instr.pdf">Instructions for Form I-129</a>
        <a href="/g-28">Form G-28</a>
        <div>Edition Date: 01/17/25</div>
        <div>Last Reviewed/Updated: 06/20/2026</div>
      </body>
    </html>`;
  const info = USCISScannerService.extractFormPageMetadata(html, "https://www.uscis.gov/i-129", "I-129");
  assert.equal(info.formName, "I-129, Petition for a Nonimmigrant Worker");
  assert.equal(info.pdfUrl, "https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf");
  assert.equal(info.instructionsPdfUrl, "https://www.uscis.gov/sites/default/files/document/forms/i-129instr.pdf");
  assert.equal(info.editionDate.toISOString().slice(0, 10), "2025-01-17");
  assert.equal(info.revisionDate.toISOString().slice(0, 10), "2026-06-20");
  assert.equal(info.category, "Employment-Based Forms");
  assert.deepEqual(info.relatedForms, ["G-28"]);
  assert.equal(info.officialStatus, "current");
});

test("USCIS registry and sync-run schemas persist authoritative metadata and reports", () => {
  assert.ok(USCISFormTemplate.schema.path("revisionDate"));
  assert.ok(USCISFormTemplate.schema.path("instructionsPdfUrl"));
  assert.ok(USCISFormTemplate.schema.path("relatedForms"));
  assert.ok(USCISFormTemplate.schema.path("officialStatus"));
  assert.ok(USCISFormSyncRun.schema.path("summary.newForms"));
  assert.ok(USCISFormSyncRun.schema.path("updatedEditions"));
  assert.ok(USCISFormSyncRun.schema.path("deprecatedForms"));
  assert.ok(USCISFormSyncRun.schema.path("missingMappings"));
});

test("USCISScannerService consolidates duplicate directory and PDF discoveries", () => {
  const forms = USCISScannerService.consolidateDetectedForms([
    {
      formCode: "I-129",
      version: "2025-01-17",
      pageUrl: "https://www.uscis.gov/i-129",
      sourceUrl: USCISScannerService.OFFICIAL_SOURCES.formsDirectoryUrl,
      editionDate: new Date("2025-01-17"),
      instructionsPdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-129instr.pdf",
    },
    {
      formCode: "I-129",
      version: "2025-01-17",
      pageUrl: USCISScannerService.OFFICIAL_SOURCES.formsDirectoryUrl,
      sourceUrl: USCISScannerService.OFFICIAL_SOURCES.formsDirectoryUrl,
      pdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf",
      editionDate: new Date("2025-01-17"),
    },
  ]);
  assert.equal(forms.length, 1);
  assert.ok(forms[0].pdfUrl);
  assert.ok(forms[0].instructionsPdfUrl);
});
