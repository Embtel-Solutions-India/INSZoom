const assert = require("node:assert/strict");
const test = require("node:test");
const AdobePdfService = require("./AdobePdfService");
const env = require("../../config/env");

// T1 (Adobe-native form slicing task): verifies slicePdf's combinepdf
// request shape against the REAL Adobe API - a minimal, real 3-page PDF is
// built with pdf-lib, sliced to pages {1} and {3}, and the result is loaded
// back with pdf-lib to confirm exactly 2 pages survive. Skips gracefully
// (never fails CI) if Adobe credentials are not configured.

test("AdobePdfService.slicePdf: extracts exactly the requested pages from a real 3-page PDF via the real Adobe API", async (t) => {
  if (!env.adobe.clientId || !env.adobe.clientSecret) {
    t.diagnostic("SKIPPED: ADOBE_PDF_SERVICES_CLIENT_ID/SECRET not configured - cannot exercise the real Adobe API.");
    return;
  }

  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (const label of ["PAGE ONE", "PAGE TWO", "PAGE THREE"]) {
    const page = source.addPage([300, 300]);
    page.drawText(label, { x: 50, y: 150, size: 20, font });
  }
  const sourceBuffer = Buffer.from(await source.save());

  const slicedBuffer = await AdobePdfService.slicePdf(sourceBuffer, [{ start: 1, end: 1 }, { start: 3, end: 3 }]);
  const sliced = await PDFDocument.load(slicedBuffer);
  assert.equal(sliced.getPageCount(), 2, "combinepdf must return exactly the 2 requested pages (1 and 3), not all 3");
});

test("AdobePdfService.slicePdf: rejects an empty pageRanges array without calling Adobe", async () => {
  await assert.rejects(
    () => AdobePdfService.slicePdf(Buffer.from("fake"), []),
    (error) => error.code === "ADOBE_SLICE_INVALID_RANGES"
  );
});
