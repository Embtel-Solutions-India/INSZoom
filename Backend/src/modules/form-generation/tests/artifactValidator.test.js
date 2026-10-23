// Phase 7.6a: the final-PDF validator, on small PDFs built in memory (no database, no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const pdfLib = require("pdf-lib");
const { PDFDocument, PDFName, StandardFonts } = pdfLib;
const { validate, textFits, DEFAULT_WATERMARK_LABELS } = require("../services/ArtifactValidator");
const WatermarkService = require("../services/WatermarkService");

async function build({ text = "Smith", width = 200, fontSize, tick = true, extraPages = 0, textName = "form1[0].#subform[0].Name[0]", multiline = false, height = 20 } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  for (let i = 0; i < extraPages; i += 1) pdf.addPage([612, 792]);
  const form = pdf.getForm();
  const field = form.createTextField(textName);
  if (multiline) field.enableMultiline();
  field.setText(text);
  field.addToPage(page, { x: 50, y: 700, width, height });
  if (fontSize !== undefined) field.setFontSize(fontSize);
  const box = form.createCheckBox("form1[0].#subform[0].Check[0]");
  box.addToPage(page, { x: 50, y: 650, width: 14, height: 14 });
  if (tick) box.check();
  return { pdf, bytes: Buffer.from(await pdf.save({ updateFieldAppearances: false })), form }; // appearances are not regenerated: the test sets the font size it wants to see
}

const expected = (text = "Smith") => [
  { pdfField: "form1[0].#subform[0].Name[0]", kind: "text", value: text },
  { pdfField: "form1[0].#subform[0].Check[0]", kind: "checkbox", value: true },
];
const template = { formCode: "ZZ-TEST", formFields: [] };

test("a good form passes: the text is read back in full, the tick is visible, the page count is right", async () => {
  const { bytes } = await build();
  const result = await validate(bytes, { template, expected: expected(), expectedPageCount: 1, expectedFieldCount: 2 });
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(result.stats.ticks, 1);
});

test("a value that reads back different is a failure (the full text must survive)", async () => {
  const { bytes } = await build({ text: "Smith" });
  const result = await validate(bytes, { template, expected: expected("Smithson"), expectedPageCount: 1 });
  assert.ok(result.failures.some((failure) => failure.check === "VALUE_MISMATCH"));
});

test("text that does not fit its box at the font size in the file is TEXT_OVERFLOW; the same text in an auto-size box is not measured", async () => {
  const long = "A very long family name that cannot possibly fit inside a narrow fixed-size box";
  const fixed = await build({ text: long, width: 60, fontSize: 12 });
  const overflow = await validate(fixed.bytes, { template, expected: expected(long) });
  assert.ok(overflow.failures.some((failure) => failure.check === "TEXT_OVERFLOW"), JSON.stringify(overflow.failures));
  const auto = await build({ text: long, width: 60, fontSize: 0 });
  const fine = await validate(auto.bytes, { template, expected: expected(long) });
  assert.equal(fine.failures.filter((failure) => failure.check === "TEXT_OVERFLOW").length, 0);
  assert.equal(fine.stats.autoSize, 1);
  const shrunk = await build({ text: long, width: 60, fontSize: 1 });
  assert.equal((await validate(shrunk.bytes, { template, expected: expected(long) })).failures.filter((failure) => failure.check === "TEXT_OVERFLOW").length, 0, "a shrunk font that fits is fine");
});

test("multi-line text is measured by its wrapped height", () => {
  const font = { widthOfTextAtSize: (text, size) => text.length * size * 0.5 };
  assert.equal(textFits({ font, text: "word ".repeat(40), size: 10, rect: { width: 100, height: 20 }, multiline: true }).fits, false);
  assert.equal(textFits({ font, text: "word ".repeat(40), size: 10, rect: { width: 100, height: 400 }, multiline: true }).fits, true);
  const throwing = { widthOfTextAtSize: () => { throw new Error("cannot encode"); } };
  assert.deepEqual(textFits({ font: throwing, text: "李", size: 10, rect: { width: 10, height: 10 } }), { fits: true, measurable: false });
});

test("a ticked box with no appearance is TICK_NOT_VISIBLE", async () => {
  const { pdf, form } = await build();
  const widget = form.getCheckBox("form1[0].#subform[0].Check[0]").acroField.getWidgets()[0];
  widget.dict.set(PDFName.of("AS"), PDFName.of("Off")); // the value says ticked (/V) but the widget shows no tick
  const bytes = Buffer.from(await pdf.save({ updateFieldAppearances: false }));
  const result = await validate(bytes, { template, expected: expected() });
  assert.ok(result.failures.some((failure) => failure.check === "TICK_NOT_VISIBLE"), JSON.stringify(result.failures));
});

test("an unticked box that should be ticked is a value mismatch", async () => {
  const { bytes } = await build({ tick: false });
  const result = await validate(bytes, { template, expected: expected() });
  assert.ok(result.failures.some((failure) => failure.check === "VALUE_MISMATCH" && /ticked/.test(failure.detail)));
});

test("a wrong page count and out-of-order pages are reported; a different count than the previous edition is only an advisory", async () => {
  const { bytes } = await build({ extraPages: 1 });
  assert.ok((await validate(bytes, { template, expected: [], expectedPageCount: 1 })).failures.some((failure) => failure.check === "PAGE_COUNT"));
  const swapped = await validate(bytes, { template, expected: [], sourcePageSizes: [{ width: 612, height: 792 }, { width: 300, height: 400 }] });
  assert.ok(swapped.failures.some((failure) => failure.check === "PAGE_ORDER"));
  const advisory = await validate(bytes, { template, expected: [], previous: { pageCount: 5 } });
  assert.equal(advisory.ok, true);
  assert.ok(advisory.advisories.some((item) => item.check === "PAGE_COUNT_CHANGED"));
});

test("leftover XFA data is an integrity failure", async () => {
  const { pdf } = await build();
  const acro = pdf.catalog.lookup(PDFName.of("AcroForm"));
  acro.set(PDFName.of("XFA"), pdf.context.obj([]));
  const bytes = Buffer.from(await pdf.save({ updateFieldAppearances: false }));
  const result = await validate(bytes, { template, expected: [] });
  assert.ok(result.failures.some((failure) => failure.check === "INTEGRITY" && /XFA/.test(failure.detail)));
});

test("too few fields is FIELD_COUNT_LOW; a file that does not reopen is INTEGRITY", async () => {
  const { bytes } = await build();
  assert.ok((await validate(bytes, { template, expected: [], expectedFieldCount: 99 })).failures.some((failure) => failure.check === "FIELD_COUNT_LOW"));
  const broken = await validate(Buffer.from("not a pdf at all"), { template, expected: [] });
  assert.equal(broken.ok, false);
  assert.equal(broken.failures[0].check, "INTEGRITY");
});

test("a barcode / signature box that holds text is PROTECTED_WRITTEN", async () => {
  const { bytes } = await build({ text: "SHOULD NOT BE HERE", textName: "form1[0].#subform[0].PDF417BarCode1[0]" });
  const result = await validate(bytes, { template: { formCode: "ZZ-TEST", formFields: [{ pdfFieldName: "form1[0].#subform[0].PDF417BarCode1[0]", fieldName: "form1[0].#subform[0].PDF417BarCode1[0]" }] }, expected: [] });
  assert.ok(result.failures.some((failure) => failure.check === "PROTECTED_WRITTEN"), JSON.stringify(result.failures));
});

test("a filing copy must be clean: the watermark is found, a clean copy passes, and the source checksum is compared", async () => {
  const { bytes } = await build();
  const marked = await WatermarkService.apply(bytes, "Attorney Review");
  assert.ok(DEFAULT_WATERMARK_LABELS.includes("ATTORNEY REVIEW"));
  const dirty = await validate(marked, { template, expected: [], filing: true });
  assert.ok(dirty.failures.some((failure) => failure.check === "WATERMARK_PRESENT"), JSON.stringify(dirty.failures));
  const clean = await validate(bytes, { template, expected: [], filing: true });
  assert.equal(clean.failures.filter((failure) => failure.check === "WATERMARK_PRESENT").length, 0);
  assert.ok(clean.advisories.some((item) => item.check === "SOURCE_CHECKSUM_NOT_CHECKED"));
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal((await validate(bytes, { template, expected: [], filing: true, sourceBytes: bytes, storedChecksum: sha })).ok, true);
  assert.ok((await validate(bytes, { template, expected: [], filing: true, sourceBytes: bytes, storedChecksum: "0".repeat(64) })).failures.some((failure) => failure.check === "SOURCE_CHECKSUM_MISMATCH"));
});

test("the validator never writes anything (pure)", () => {
  const source = require("fs").readFileSync(require.resolve("../services/ArtifactValidator"), "utf8");
  for (const token of ["writeFile", "insertOne", "updateOne", ".save(", "fetch("]) assert.equal(source.includes(token), false, token);
  assert.ok(StandardFonts.Helvetica);
});
