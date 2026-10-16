const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { liftTextLengthLimits, shrinkLongTextToFit } = require("../services/FullTextFieldGuard");
const PDFRenderer = require("../services/PDFRenderer");

const STREET = "form1[0].Pt3_Line3_StreetNumberName[0]";
const COMB = "form1[0].Pt1_ReceiptNumber[0]";
const PHONE = "form1[0].Pt3_Line4_DaytimeTelephone[0]";
const NOTES = "form1[0].Pt5_AdditionalInfo[0]";

async function build() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const add = (name, { maxLength, comb, multiline, width = 200, height = 20, y = 10 }) => {
    const field = form.createTextField(name);
    if (multiline) field.enableMultiline();
    if (maxLength) field.setMaxLength(maxLength);
    if (comb) field.enableCombing();
    field.addToPage(page, { x: 10, y, width, height, font });
    field.setFontSize(10);
  };
  add(STREET, { maxLength: 20, y: 700 });
  add(COMB, { maxLength: 5, comb: true, y: 650 });
  add(PHONE, { maxLength: 10, y: 600 });
  add(NOTES, { multiline: true, height: 60, y: 500 });
  return { pdf, form };
}

const write = (form, pdfField, value) => {
  const mapped = { pdfField, caseField: pdfField, value };
  assert.equal(PDFRenderer.setFormField(form, mapped, "I-129"), true);
  return mapped;
};

test("no text field keeps a character limit - comb, phone and ordinary fields alike", async () => {
  const { form } = await build();
  assert.equal(liftTextLengthLimits(form), 3);
  for (const name of [STREET, COMB, PHONE]) assert.equal(form.getTextField(name).getMaxLength(), undefined);
  assert.equal(form.getTextField(COMB).isCombed(), false);
});

test("entries longer than the original limits are written in full, with nothing cut or reported", async () => {
  const { form } = await build();
  liftTextLengthLimits(form);
  const long = "w".repeat(120);
  for (const name of [STREET, COMB, PHONE]) {
    const mapped = write(form, name, long);
    assert.equal(mapped.adjustment, undefined);
    assert.equal(mapped.renderError, undefined);
    assert.equal(form.getTextField(name).getText(), long);
  }
});

test("a long entry gets a smaller font so the whole text fits its box; a short one keeps the form's size", async () => {
  const { pdf, form } = await build();
  liftTextLengthLimits(form);
  write(form, STREET, "w".repeat(120));
  write(form, PHONE, "9354596545");
  const shrunk = await shrinkLongTextToFit(pdf, form);

  assert.deepEqual(shrunk.map((item) => item.pdfField), [STREET]);
  assert.ok(shrunk[0].to < shrunk[0].from && shrunk[0].to >= 1);
  // measured with the same font: the shrunk text really fits the widget
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  assert.ok(font.widthOfTextAtSize("w".repeat(120), shrunk[0].to) <= 200);
});

test("long multi-line text is shrunk until its wrapped lines fit the box height", async () => {
  const { pdf, form } = await build();
  liftTextLengthLimits(form);
  write(form, NOTES, "The beneficiary will be employed at multiple worksites across several states. ".repeat(12));
  const shrunk = await shrinkLongTextToFit(pdf, form);
  assert.equal(shrunk.length, 1);
  assert.equal(shrunk[0].pdfField, NOTES);
  assert.ok(shrunk[0].to < 10);
});

test("the document still saves and reloads with the full text and the reduced font size", async () => {
  const { pdf, form } = await build();
  liftTextLengthLimits(form);
  const long = "Q".repeat(150);
  write(form, STREET, long);
  const [change] = await shrinkLongTextToFit(pdf, form);
  const reloaded = await PDFDocument.load(await pdf.save());
  const field = reloaded.getForm().getTextField(STREET);
  assert.equal(field.getText(), long);
  assert.match(field.acroField.getDefaultAppearance(), new RegExp(`${change.to} Tf`));
});

test("the guard never throws, even for a form it cannot read", async () => {
  const broken = { getFields() { throw new Error("boom"); } };
  assert.equal(liftTextLengthLimits(broken), 0);
  assert.deepEqual(await shrinkLongTextToFit({}, broken), []);
});
