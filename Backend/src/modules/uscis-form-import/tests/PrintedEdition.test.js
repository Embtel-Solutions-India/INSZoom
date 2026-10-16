// The edition printed in the footer of every page of a USCIS PDF is read at import. DB-free: PDFs are generated in memory.
const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const FormMetadataService = require("../services/FormMetadataService");

const { extractEditionDate, readPdfText } = FormMetadataService;
const iso = (date) => (date ? date.toISOString().slice(0, 10) : undefined);

async function pdfWithFooters(footers, body = "Part 1. Information About You") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  footers.forEach((footer) => {
    const page = doc.addPage([612, 792]);
    page.drawText(body, { x: 50, y: 700, size: 12, font });
    page.drawText(footer, { x: 50, y: 30, size: 8, font });
  });
  return Buffer.from(await doc.save());
}

test("the footer edition is the date: every page repeats it and the most frequent wins", () => {
  assert.equal(iso(extractEditionDate("Form I-131  Edition 01/20/25  Page 1 of 14\nForm I-131  Edition 01/20/25  Page 2 of 14")), "2025-01-20");
  assert.equal(iso(extractEditionDate("Form I-131 Edition 01/20/25\nForm I-131 Edition 01/20/25\nForm I-131 Edition 09/09/24")), "2025-01-20");
});

test("OMB expiry, 'Rev.' and a tie are never mistaken for the edition", () => {
  assert.equal(extractEditionDate("OMB No. 1615-0013; Expires 06/30/2026"), undefined);
  assert.equal(extractEditionDate("Rev. 03/01/20"), undefined);
  assert.equal(extractEditionDate("Form G-28 Edition 01/20/25\nForm G-28 Edition 09/17/25"), undefined);
  assert.equal(extractEditionDate(""), undefined);
});

test("a real PDF is read with the installed pdf-parse and its footer edition is found", async () => {
  const buffer = await pdfWithFooters(["Form I-131  Edition 01/20/25  Page 1 of 3", "Form I-131  Edition 01/20/25  Page 2 of 3", "Form I-131  Edition 01/20/25  Page 3 of 3"]);
  const before = buffer.length;
  const text = await readPdfText(buffer);
  assert.equal(buffer.length, before, "the caller's buffer is left intact");
  assert.equal(iso(extractEditionDate(text)), "2025-01-20");
});

test("extract() takes the edition from the PDF footer, ahead of the date USCIS shows on its page", async () => {
  const buffer = await pdfWithFooters(["Form I-131  Edition 01/20/25  Page 1 of 2", "Form I-131  Edition 01/20/25  Page 2 of 2"]);
  const metadata = await new FormMetadataService().extract(buffer, { formType: "I-131", editionDate: "2026-07-28" }, { fields: [] });
  assert.equal(iso(metadata.editionDate), "2025-01-20");
  assert.equal(metadata.importMetadata?.editionDateSource ?? metadata.editionDateSource, "pdf");
  assert.equal(iso(metadata.publishedEditionDate ?? metadata.importMetadata?.publishedEditionDate), "2026-07-28");
});

test("a PDF with no footer edition falls back to the page date, as before", async () => {
  const buffer = await pdfWithFooters(["Page 1 of 1"]);
  const metadata = await new FormMetadataService().extract(buffer, { formType: "I-131", editionDate: "2026-07-28" }, { fields: [] });
  assert.equal(iso(metadata.editionDate), "2026-07-28");
});

test("older forms print the footer without the word Edition ('Form G-28 09/17/18  Page 1 of 4'); that shape is read too, OMB expiry and EOIR 'Rev.' are not", () => {
  assert.equal(iso(extractEditionDate("Form G-28 09/17/18 \tPage 1 of 4\nExpires 05/31/2021\nForm G-28 09/17/18 \tPage 2 of 4")), "2018-09-17");
  assert.equal(iso(extractEditionDate("Page 1 of 1\tForm G-1650 06/03/25")), "2025-06-03");
  assert.equal(iso(extractEditionDate("Form G-1256 08/10/15 \tPage 1 of 2\nForm G-1256 08/10/15 \tPage 2 of 2")), "2015-08-10");
  assert.equal(extractEditionDate("Form EOIR-29\nRev. 02/2026\nExp. 07/31/2028"), undefined);
  assert.equal(extractEditionDate("Form G-28 09/17/18 Page 1 of 4\nForm G-28 05/23/18 Page 2 of 4"), undefined, "a tie is ambiguous");
  // the word Edition, when the PDF uses it, always takes precedence
  assert.equal(iso(extractEditionDate("Form I-131 Edition 01/20/25 Page 1 of 2\nForm I-131 09/09/24 Page 2 of 2")), "2025-01-20");
});
