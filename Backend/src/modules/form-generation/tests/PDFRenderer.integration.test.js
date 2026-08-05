const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const PDFRenderer = require("../services/PDFRenderer");

test("PDFRenderer fills official PDF fields through metadata mappings", async (t) => {
  let pdfLib;
  try {
    pdfLib = require("pdf-lib");
  } catch (error) {
    t.skip("pdf-lib is not installed");
    return;
  }

  const { PDFDocument } = pdfLib;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 400]);
  const form = pdf.getForm();
  const field = form.createTextField("Pt1Line1FamilyName");
  field.addToPage(page, { x: 50, y: 300, width: 200, height: 24 });
  const templatePath = path.join(os.tmpdir(), `uscis-template-${Date.now()}.pdf`);
  await fs.writeFile(templatePath, Buffer.from(await pdf.save()));

  const result = await PDFRenderer.render({
    caseForm: { filledData: { beneficiary: { lastName: "Doe" } } },
    template: {
      pdfTemplatePath: templatePath,
      pdfFieldMappings: [{ caseField: "beneficiary.lastName", pdfField: "Pt1Line1FamilyName", type: "text" }],
    },
    flatten: false,
  });

  const output = await PDFDocument.load(result.buffer);
  assert.equal(output.getForm().getTextField("Pt1Line1FamilyName").getText(), "Doe");
  assert.equal(result.renderReport.mappedFieldCount, 1);
  await fs.unlink(templatePath).catch(() => {});
});
