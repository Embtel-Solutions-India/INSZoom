// Phase 5 (§I.1) - unit tests for PDFFidelityService. No DB, no template/CaseForm documents -
// builds minimal pdf-lib PDFs directly so each test is deterministic and fast. Test 3 (field
// mismatch caught) is the critical proof per §K-G2: a verifier that only ever passes is not a
// verifier.
const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const PDFFidelityService = require("../services/PDFFidelityService");

async function buildMinimalPdf({ fieldName = "TestField[0]", value = "" } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  const field = form.createTextField(fieldName);
  field.setText(value);
  field.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  return Buffer.from(await pdf.save());
}

function makeTemplate(overrides = {}) {
  return {
    pdfMetadata: { pageCount: 1 },
    formFields: [{ fieldName: "TestField[0]", pdfFieldType: "text", semanticType: "name" }],
    ...overrides,
  };
}

function makeCaseForm(fieldValues = {}) {
  return { fieldValues, filledData: {} };
}

test("PDFFidelityService.verify - structural pass: correct page count, correct field count, matching value", async () => {
  const buffer = await buildMinimalPdf({ fieldName: "TestField[0]", value: "Smith" });
  const result = await PDFFidelityService.verify(buffer, makeCaseForm({ "TestField[0]": "Smith" }), makeTemplate());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.report.pageCount, 1);
  assert.equal(result.report.fieldCount, 1);
  assert.equal(result.report.matchedFields, 1);
});

test("PDFFidelityService.verify - not a PDF: returns valid:false without throwing", async () => {
  const result = await PDFFidelityService.verify(Buffer.from("not a pdf"), makeCaseForm(), makeTemplate());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Not a PDF")), `expected a "Not a PDF" error, got: ${JSON.stringify(result.errors)}`);
});

test("PDFFidelityService.verify - field mismatch is caught (the critical correctness proof)", async () => {
  const buffer = await buildMinimalPdf({ fieldName: "Pt2Line4a_FamilyName[0]", value: "Smith" });
  const template = makeTemplate({ formFields: [{ fieldName: "Pt2Line4a_FamilyName[0]", pdfFieldType: "text", semanticType: "name" }] });
  const result = await PDFFidelityService.verify(buffer, makeCaseForm({ "Pt2Line4a_FamilyName[0]": "Jones" }), template);
  assert.equal(result.valid, false);
  const mismatchError = result.errors.find((e) => e.includes("Pt2Line4a_FamilyName[0]"));
  assert.ok(mismatchError, `expected an error naming the mismatched field, got: ${JSON.stringify(result.errors)}`);
  assert.ok(mismatchError.includes("Jones"), "error must include the expected value");
  assert.ok(mismatchError.includes("Smith"), "error must include the actual (wrong) value");
});

test("PDFFidelityService.verify - a field present in fieldValues but absent from the PDF is a warning, not a block", async () => {
  // Uses 10 unrelated "filler" fields (present in both the template's formFields metadata and the
  // real PDF, but with no value in caseForm.fieldValues so they're never sampled) purely to keep
  // the structural field-COUNT ratio check (independent of this test's actual concern) within its
  // +/-10% tolerance: 11 real PDF fields vs 12 expected template fields is a ~92% ratio, which
  // passes - isolating the one behavior this test actually wants to prove.
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  form.createTextField("TestField[0]").setText("Smith");
  form.getTextField("TestField[0]").addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  const fillerFormFields = [];
  for (let i = 0; i < 10; i += 1) {
    const name = `Filler${i}[0]`;
    form.createTextField(name).addToPage(page, { x: 50, y: 600 - i * 20, width: 200, height: 20 });
    fillerFormFields.push({ fieldName: name, pdfFieldType: "text", semanticType: "name" });
  }
  const buffer = Buffer.from(await pdf.save());
  const template = makeTemplate({
    formFields: [
      { fieldName: "TestField[0]", pdfFieldType: "text", semanticType: "name" },
      { fieldName: "MissingField[0]", pdfFieldType: "text", semanticType: "name" },
      ...fillerFormFields,
    ],
  });
  const result = await PDFFidelityService.verify(buffer, makeCaseForm({ "TestField[0]": "Smith", "MissingField[0]": "Whatever" }), template);
  assert.equal(result.valid, true, `expected valid:true (missing field is a warning, not a block), got errors: ${JSON.stringify(result.errors)}`);
  assert.ok(result.warnings.some((w) => w.includes("MissingField[0]")), `expected a warning naming the missing field, got: ${JSON.stringify(result.warnings)}`);
});

test("PDFFidelityService.verify - empty caseForm.fieldValues: valid with zero sampled fields", async () => {
  const buffer = await buildMinimalPdf({ fieldName: "TestField[0]", value: "" });
  const result = await PDFFidelityService.verify(buffer, makeCaseForm({}), makeTemplate());
  assert.equal(result.valid, true);
  assert.equal(result.report.sampledFields, 0);
});

test("PDFFidelityService.verify - signature fields are skipped regardless of value", async () => {
  const buffer = await buildMinimalPdf({ fieldName: "SignatureField[0]", value: "" });
  const template = makeTemplate({ formFields: [{ fieldName: "SignatureField[0]", pdfFieldType: "text", semanticType: "signature" }] });
  const result = await PDFFidelityService.verify(buffer, makeCaseForm({ "SignatureField[0]": "John Hancock" }), template);
  assert.equal(result.valid, true);
  assert.equal(result.report.sampledFields, 0);
});
