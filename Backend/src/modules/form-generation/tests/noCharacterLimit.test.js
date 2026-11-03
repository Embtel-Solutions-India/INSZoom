// Owner rule (2026-11-04): no character limit on any form, ever, and numbers go into their own boxes. DB-free, the REAL PDFRenderer on a synthetic form:
//   - a long entry in a box with /MaxLen is written IN FULL (never cut);
//   - a comb box (one character per printed box) keeps its boxes for a number that fits once its separators are removed;
//   - an entry too long even for its boxes is still written in full.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const PDFRenderer = require("../services/PDFRenderer");
const { useLocalTemplateStorage, storedTemplate } = require("./fixtures/localTemplateStorage");

useLocalTemplateStorage(test);

async function syntheticForm() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 400]);
  const form = pdf.getForm();
  const street = form.createTextField("StreetLine");
  street.setMaxLength(10);
  street.addToPage(page, { x: 20, y: 340, width: 200, height: 20 });
  const phone = form.createTextField("PhoneBoxes");
  phone.setMaxLength(10);
  phone.enableCombing();
  phone.addToPage(page, { x: 20, y: 300, width: 200, height: 20 });
  const aNumber = form.createTextField("ANumberBoxes");
  aNumber.setMaxLength(9);
  aNumber.enableCombing();
  aNumber.addToPage(page, { x: 20, y: 260, width: 180, height: 20 });
  const file = path.join(os.tmpdir(), `no-limit-${process.pid}-${Date.now()}.pdf`);
  await fs.writeFile(file, Buffer.from(await pdf.save()));
  return file;
}

test("no character limit: long text is written in full, separated numbers stay one per box, too-long box entries are kept whole", async () => {
  const file = await syntheticForm();
  const fields = ["StreetLine", "PhoneBoxes", "ANumberBoxes"];
  const template = {
    ...storedTemplate(file),
    formCode: "X-NOLIMIT",
    formFields: fields.map((name) => ({ fieldId: name, pdfField: name })),
    pdfFieldMappings: fields.map((name) => ({ caseField: `case.${name}`, pdfField: name, type: "text" })),
  };
  const caseForm = { filledData: { case: { StreetLine: "1234 North Maple Avenue Apt 56", PhoneBoxes: "(935) 459-6545", ANumberBoxes: "A-1234-5678-901234" } } };
  try {
    const rendered = await PDFRenderer.render({ caseForm, template, flatten: false });
    const out = (await PDFDocument.load(rendered.buffer)).getForm();
    const street = out.getTextField("StreetLine");
    assert.equal(street.getText(), "1234 North Maple Avenue Apt 56", "never cut");
    const phone = out.getTextField("PhoneBoxes");
    assert.equal(phone.getText(), "9354596545", "digits, one per box");
    assert.equal(phone.isCombed(), true, "the boxes are kept");
    assert.equal(phone.getMaxLength(), 10);
    const aNumber = out.getTextField("ANumberBoxes");
    assert.equal(aNumber.getText(), "A-1234-5678-901234", "too long even for its boxes: written whole, not cut");
    assert.deepEqual(rendered.renderReport.failedFieldWrites || [], []);
  } finally {
    await fs.unlink(file).catch(() => null);
  }
});
