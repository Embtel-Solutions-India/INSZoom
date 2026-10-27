const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { liftTextLengthLimits, shrinkLongTextToFit, unlockReadOnlyFields } = require("../services/FullTextFieldGuard");
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

test("a comb field whose text fits its boxes keeps its one-character-per-box layout in the PDF; a longer text is still written in full", async () => {
  const { form } = await build();
  // COMB has 5 boxes: "12345" fits, so combing and MaxLen stay; the other limits are lifted as before
  const lifted = liftTextLengthLimits(form, (name) => (name === COMB ? "12345" : undefined));
  assert.equal(lifted, 2);
  const comb = form.getTextField(COMB);
  assert.equal(comb.isCombed(), true);
  assert.equal(comb.getMaxLength(), 5);
  const mapped = write(form, COMB, "12345");
  assert.equal(mapped.renderError, undefined);
  assert.equal(comb.getText(), "12345");

  const { form: second } = await build();
  liftTextLengthLimits(second, (name) => (name === COMB ? "123456789" : undefined));
  const longComb = second.getTextField(COMB);
  assert.equal(longComb.isCombed(), false);
  assert.equal(longComb.getMaxLength(), undefined);
  write(second, COMB, "123456789");
  assert.equal(longComb.getText(), "123456789");
});

test("a read-only drop-down (State), list box and radio group are made writable too, so a value can be chosen and written", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const form = pdf.getForm();
  const state = form.createDropdown("bform[1].Part1_Line7_PhysicalAddress_State[0]");
  state.addOptions(["CA", "NY", "TX"]);
  state.addToPage(page, { x: 10, y: 700, width: 80, height: 18 });
  state.enableReadOnly();
  const radio = form.createRadioGroup("form1[0].#subform[1].Part2_Choice[0]");
  radio.addOptionToPage("Yes", page, { x: 10, y: 660, width: 14, height: 14 });
  radio.addOptionToPage("No", page, { x: 40, y: 660, width: 14, height: 14 });
  radio.enableReadOnly();
  const list = form.createOptionList("form1[0].#subform[1].Part2_List[0]");
  list.addOptions(["A", "B"]);
  list.addToPage(page, { x: 10, y: 600, width: 80, height: 40 });
  list.enableReadOnly();
  // a drop-down that is a computed field is writable too (only signatures and barcodes stay locked)
  const computed = form.createDropdown("form1[0].#subform[1].Computed[0]");
  computed.addOptions(["X"]);
  computed.addToPage(page, { x: 10, y: 560, width: 80, height: 18 });
  computed.enableReadOnly();

  const meta = new Map([["form1[0].#subform[1].Computed[0]", { fieldType: "dropdown", calculated: true }]]);
  assert.equal(unlockReadOnlyFields(form, meta), 4);
  assert.equal(state.isReadOnly(), false);
  assert.equal(radio.isReadOnly(), false);
  assert.equal(list.isReadOnly(), false);
  assert.equal(computed.isReadOnly(), false);

  state.select("NY");
  assert.deepEqual(state.getSelected(), ["NY"]);
  radio.select("Yes");
  assert.equal(radio.getSelected(), "Yes");
  assert.equal(unlockReadOnlyFields(form, meta), 0); // idempotent
});

test("read-only boxes a person may fill in are made writable on the working copy; signatures and barcodes stay locked", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 700;
  const addText = (name) => { const f = form.createTextField(name); f.addToPage(page, { x: 10, y, width: 150, height: 18, font }); f.enableReadOnly(); y -= 30; return f; };
  const city = addText("form1[0].#subform[1].Line1a_CityorTown[0]");
  const dateOfSignature = addText("form1[0].#subform[5].Pt6_DateofSignature[0]");
  const signature = addText("form1[0].#subform[5].Line1a_SignatureofPetitioner[0]");
  const barcode = addText("form1[0].Page1[0].PDF417BarCode1[0]");
  const box = form.createCheckBox("form1[0].#subform[2].Line4_Form485[0]");
  box.addToPage(page, { x: 10, y, width: 14, height: 14 });
  box.enableReadOnly();
  // the widget's own ReadOnly annotation flag locks a box too
  city.acroField.getWidgets()[0].setFlag(64);

  assert.equal(unlockReadOnlyFields(form, new Map([["form1[0].#subform[5].Line1a_SignatureofPetitioner[0]", { fieldType: "signature" }]])), 3);
  assert.equal(city.isReadOnly(), false);
  assert.equal(city.acroField.getWidgets()[0].hasFlag(64), false);
  assert.equal(dateOfSignature.isReadOnly(), false);
  assert.equal(box.isReadOnly(), false);
  assert.equal(signature.isReadOnly(), true);
  assert.equal(barcode.isReadOnly(), true);

  city.setText("Sydney");
  assert.equal(city.getText(), "Sydney");
  // idempotent, and a form with nothing read-only is untouched
  assert.equal(unlockReadOnlyFields(form), 0);
});
