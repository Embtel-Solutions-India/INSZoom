// Phase 7.E: an unchanged form must NOT look new (the old check compared a page-metadata signature with the downloaded file's hash, which never match, so every
// forced check re-imported every live form), and a failure after the page fetch must not be reported as "USCIS unreachable".
const assert = require("node:assert/strict");
const test = require("node:test");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const FormImportService = require("../services/FormImportService");
const USCISScannerService = require("../services/USCISScannerService");

const date = (iso) => new Date(`${iso}T00:00:00.000Z`);
const installed = (extra = {}) => ({ editionDate: date("2025-01-20"), officialPdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf", lifecycle: { sourceChecksum: "a".repeat(64) }, importMetadata: { checksum: "b".repeat(64) }, ...extra });
const seen = (extra = {}) => ({ editionDate: date("2025-01-20"), pdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf", checksum: "c".repeat(64), ...extra });

test("the audit claim: same edition date, same PDF address, and a metadata signature that differs in KIND from the stored file hash is NOT a new edition", () => {
  assert.equal(USCISScannerService.hasNewEdition(installed(), seen()), false);
});

const table = [
  ["no installed template", null, seen(), true],
  ["later edition date", installed(), seen({ editionDate: date("2026-01-01") }), true],
  ["earlier edition date is not new", installed(), seen({ editionDate: date("2024-01-01") }), false],
  ["different official PDF address", installed(), seen({ pdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-131-new.pdf" }), true],
  ["same address, different case / query / trailing slash", installed(), seen({ pdfUrl: "https://WWW.uscis.gov/sites/default/files/document/forms/I-131.pdf?download=1#x" }), false],
  ["installed template never stored an address (unknown is not different)", installed({ officialPdfUrl: undefined }), seen(), false],
  ["page shows no address", installed(), seen({ pdfUrl: undefined }), false],
  ["same-kind signature unchanged", installed({ lifecycle: { scanSignature: "c".repeat(64) } }), seen(), false],
  ["same-kind signature changed", installed({ lifecycle: { scanSignature: "d".repeat(64) } }), seen(), true],
  ["no date on either side and nothing comparable", installed({ editionDate: undefined }), seen({ editionDate: undefined }), false],
];
for (const [name, template, info, expected] of table) {
  test(`hasNewEdition: ${name} -> ${expected}`, () => {
    assert.equal(USCISScannerService.hasNewEdition(template, info), expected);
  });
}

function stubScan({ html = "<html>Edition Date: 02/01/2026 <a href=\"/sites/default/files/document/forms/i-131.pdf\">pdf</a></html>", template = null, importer } = {}) {
  const originals = { fetchPage: USCISScannerService.fetchPage, findOne: USCISFormTemplate.findOne, importOfficialForm: FormImportService.importOfficialForm };
  USCISScannerService.fetchPage = async () => { if (html instanceof Error) throw html; return html; };
  USCISFormTemplate.findOne = () => ({ sort: async () => template });
  if (importer) FormImportService.importOfficialForm = importer;
  return () => { USCISScannerService.fetchPage = originals.fetchPage; USCISFormTemplate.findOne = originals.findOne; FormImportService.importOfficialForm = originals.importOfficialForm; };
}

test("a page fetch failure is tagged page_fetch with its HTTP status (the only failure that means uscis.gov could not be reached)", async () => {
  const error = Object.assign(new Error("USCIS page fetch failed: 404"), { status: 404, code: "USCIS_PAGE_FETCH_FAILED", stage: "page_fetch" });
  const restore = stubScan({ html: error });
  try {
    const result = await USCISScannerService.scanForm({ formType: "I-485J", pageUrl: "https://www.uscis.gov/i-485j" });
    assert.equal(result.action, "scan_failed");
    assert.equal(result.stage, "page_fetch");
    assert.equal(result.status, 404);
    assert.equal(result.code, "USCIS_PAGE_FETCH_FAILED");
  } finally { restore(); }
});

test("a normalize / import failure after a successful fetch is tagged import with its own code - never page_fetch", async () => {
  const failure = Object.assign(new Error("qpdf could not be started"), { code: "QPDF_NOT_FOUND", cause: "tool_spawn" });
  const restore = stubScan({ importer: async () => { throw failure; } });
  try {
    const result = await USCISScannerService.scanForm({ formType: "I-131", pageUrl: "https://www.uscis.gov/i-131" });
    assert.equal(result.action, "scan_failed");
    assert.equal(result.stage, "import");
    assert.equal(result.code, "QPDF_NOT_FOUND");
    assert.equal(result.cause, "tool_spawn");
  } finally { restore(); }
});

test("an unchanged form is never re-imported: no_change_detected and the importer is not called", async () => {
  let imports = 0;
  const saved = [];
  const template = { editionDate: date("2026-02-01"), officialPdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf", lifecycle: { sourceChecksum: "f".repeat(64) }, save: async function save() { saved.push(this.lifecycle); } };
  const restore = stubScan({ template, importer: async () => { imports += 1; return {}; } });
  try {
    const result = await USCISScannerService.scanForm({ formType: "I-131", pageUrl: "https://www.uscis.gov/i-131" });
    assert.equal(result.action, "no_change_detected");
    assert.equal(imports, 0);
    assert.ok(saved[0].scanSignature, "the unchanged scan records its same-kind signature");
  } finally { restore(); }
});
