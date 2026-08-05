const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const PDFFieldScannerService = require("../services/PDFFieldScannerService");
const FormMetadataService = require("../services/FormMetadataService");

async function buildPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const form = pdfDoc.getForm();
  const lastName = form.createTextField("Pt1Line1a_LastName");
  lastName.addToPage(page, { x: 50, y: 700, width: 180, height: 20 });
  const newsletter = form.createCheckBox("Part2_Agree");
  newsletter.addToPage(page, { x: 50, y: 650, width: 12, height: 12 });
  const category = form.createDropdown("Part3_Category");
  category.addOptions(["H-1B", "L-1A"]);
  category.addToPage(page, { x: 50, y: 600, width: 120, height: 20 });
  return Buffer.from(await pdfDoc.save());
}

test("PDFFieldScannerService extracts and normalizes fillable PDF fields", async () => {
  const buffer = await buildPdf();
  const scanner = new PDFFieldScannerService();
  const result = await scanner.scan(buffer);

  assert.equal(result.pageCount, 1);
  assert.equal(result.fieldCount, 3);
  assert.deepEqual(result.fields.map((field) => field.type), ["text", "checkbox", "dropdown"]);
  assert.equal(result.fields[0].fieldId, "part1.lastName");
  assert.equal(result.fields[0].pageNumber, 1);
  assert.ok(result.fields[0].position.width >= 180);
  assert.ok(result.fieldFingerprint);
  assert.equal(result.usedOcr, false);
  assert.equal(result.parserStatus, "parsed");
  assert.equal(result.fields[0].optional, true);
  assert.equal(result.fields[0].extraction.source, "pdf_acroform");
  assert.equal(result.structure.questions.length, 3);
  assert.equal(result.structure.questions[0].fieldId, "part1.lastName");
  assert.equal(result.structure.questions[1].fieldType, "checkbox");
  assert.deepEqual(result.structure.questions[2].options.map((option) => option.value), ["H-1B", "L-1A"]);
});

test("PDFFieldScannerService flags non-fillable PDFs for review without OCR or guessing", async () => {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([612, 792]);
  const scanner = new PDFFieldScannerService();
  const result = await scanner.scan(Buffer.from(await pdfDoc.save()));

  assert.equal(result.fieldCount, 0);
  assert.equal(result.usedOcr, false);
  assert.equal(result.parserStatus, "needs_review");
  assert.ok(result.reviewItems.some((item) => item.code === "NO_ACROFORM_FIELDS"));
});

test("FormMetadataService builds provider metadata and form structure", async () => {
  const buffer = await buildPdf();
  const scanner = new PDFFieldScannerService();
  const scan = await scanner.scan(buffer);
  const metadata = await new FormMetadataService().extract(buffer, { formType: "I-129", editionDate: "2025-01-17" }, scan);

  assert.equal(metadata.formCode, "I-129");
  assert.equal(metadata.version, "01/17/2025");
  assert.equal(metadata.pageCount, 1);
  assert.ok(metadata.sections.some((section) => section.sectionId === "part1"));
  assert.equal(metadata.formStructure.pages[0].pageNumber, 1);
});
