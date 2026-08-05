const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizePdf } = require("../../../utils/normalizePdf");
const PDFFieldScannerService = require("../services/PDFFieldScannerService");

const I129_PATH = path.resolve(__dirname, "../../../../dev-assets/uscis/i-129_2026-02-27.pdf");

// The raw official I-129 ships with compressed object/xref streams plus a
// hidden XFA layer that make pdf-lib's PDFDocument.load() throw — this is
// exactly the case normalizePdf() exists to fix (see USCISFormImporterService's
// importFromBuffer). Skips gracefully if the committed dev asset isn't
// present, rather than failing the whole suite on an environment that
// hasn't pulled it.
test("scanner.scan() on the raw I-129 throws or finds no fields, but succeeds with hundreds of fields once normalized", async (t) => {
  let rawBuffer;
  try {
    rawBuffer = await fs.readFile(I129_PATH);
  } catch {
    t.skip(`dev asset not present at ${I129_PATH}`);
    return;
  }

  const scanner = new PDFFieldScannerService();

  let rawFieldCount = 0;
  let rawThrew = false;
  try {
    const rawResult = await scanner.scan(rawBuffer);
    rawFieldCount = rawResult.fieldCount;
  } catch {
    rawThrew = true;
  }
  assert.ok(rawThrew || rawFieldCount === 0, "raw I-129 should either fail to scan or yield zero fields");

  const normalizedBuffer = await normalizePdf(rawBuffer);
  const normalizedResult = await scanner.scan(normalizedBuffer);
  assert.ok(normalizedResult.fieldCount > 500, `expected hundreds of fields, got ${normalizedResult.fieldCount}`);
  assert.equal(normalizedResult.errors.length, 0);
});
