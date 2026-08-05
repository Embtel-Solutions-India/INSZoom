// Phase H3 acceptance tests that don't need the real database: AC3
// (visible values in both editable/flattened modes), AC5 (on-demand
// normalization of an unnormalized template, and the qpdf-missing error
// path), and AC10 (form-agnostic - the identical render pipeline fills a
// completely unrelated, non-I-129 synthetic form with zero special-casing).
// AC1/AC2/AC4/AC6/AC7/AC8 need a real mapped I-129 CaseForm and live in
// h3-pdf-generation.test.js (DB-connected).
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const test = require("node:test");
const env = require("../../../config/env");
const PDFRenderer = require("../services/PDFRenderer");

const RAW_I539_ASSET = path.join(__dirname, "../../../../dev-assets/uscis/i-539_2024-08-28.pdf");

test("AC3 - editable render sets NeedAppearances and keeps fields; flatten removes fields and draws static text", async (t) => {
  let pdfLib;
  try {
    pdfLib = require("pdf-lib");
  } catch (error) {
    t.skip("pdf-lib is not installed");
    return;
  }
  let PDFParse;
  try {
    ({ PDFParse } = require("pdf-parse"));
  } catch (error) {
    PDFParse = null;
  }
  const { PDFDocument, PDFName } = pdfLib;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 400]);
  const form = pdf.getForm();
  const field = form.createTextField("ApplicantName");
  field.addToPage(page, { x: 50, y: 300, width: 200, height: 24 });
  const templatePath = path.join(require("os").tmpdir(), `h3-ac3-${Date.now()}.pdf`);
  await fs.writeFile(templatePath, Buffer.from(await pdf.save()));

  try {
    const template = {
      pdfTemplatePath: templatePath,
      pdfFieldMappings: [{ caseField: "applicant.fullName", pdfField: "ApplicantName", type: "text" }],
    };
    const caseForm = { filledData: { applicant: { fullName: "Grace Hopper" } } };

    const editable = await PDFRenderer.render({ caseForm, template, flatten: false });
    const editablePdf = await PDFDocument.load(editable.buffer);
    assert.equal(editablePdf.getForm().getTextField("ApplicantName").getText(), "Grace Hopper");
    const needAppearances = editablePdf.catalog.lookup(PDFName.of("AcroForm"))?.lookup(PDFName.of("NeedAppearances"));
    assert.equal(needAppearances?.toString(), "true", "editable render must set NeedAppearances so every viewer regenerates appearances");

    const flattened = await PDFRenderer.render({ caseForm, template, flatten: true });
    const flattenedPdf = await PDFDocument.load(flattened.buffer);
    assert.equal(flattenedPdf.getForm().getFields().length, 0, "flatten must remove editable fields");
    if (PDFParse) {
      const parser = new PDFParse({ data: flattened.buffer });
      const { text } = await parser.getText();
      await parser.destroy();
      assert.ok(text.includes("Grace Hopper"), "flattened PDF must still show the value as static drawn text");
    }
  } finally {
    await fs.unlink(templatePath).catch(() => {});
  }
});

test("AC5 - a raw, unnormalized real USCIS PDF is normalized on demand and renders successfully", async (t) => {
  let raw;
  try {
    raw = await fs.readFile(RAW_I539_ASSET);
  } catch (error) {
    t.skip(`raw I-539 dev asset not present at ${RAW_I539_ASSET}`);
    return;
  }
  const { PDFDocument } = require("pdf-lib");
  // Sanity: confirm this specific fixture really is unnormalized (pdf-lib
  // parses it without throwing, but exposes zero AcroForm fields) so the
  // fallback path in loadTemplatePdf is what's actually being exercised,
  // not a no-op.
  const rawLoaded = await PDFDocument.load(raw, { ignoreEncryption: true });
  assert.equal(rawLoaded.getForm().getFields().length, 0, "fixture must be unnormalized for this test to prove anything");

  const template = {
    pdfTemplatePath: RAW_I539_ASSET,
    // formFields only needs to be non-empty to trigger the mismatch check -
    // its contents don't have to match every real I-539 field for this test.
    formFields: [{ fieldId: "applicant.fullName", pdfField: "Pt1Line1a_FamilyName" }],
    pdfFieldMappings: [{ caseField: "applicant.fullName", pdfField: "Pt1Line1a_FamilyName", type: "text" }],
  };
  const caseForm = { filledData: { applicant: { fullName: "Doe" } } };
  const rendered = await PDFRenderer.render({ caseForm, template, flatten: false });
  const output = await PDFDocument.load(rendered.buffer, { ignoreEncryption: true, updateMetadata: false });
  assert.ok(output.getForm().getFields().length > 0, "render output must be a fillable, normalized PDF");
  assert.equal(rendered.renderReport.mappedFieldCount, 1);
});

test("AC5 - qpdf missing surfaces the clear install error instead of a silent unfilled PDF", async () => {
  let raw;
  try {
    raw = await fs.readFile(RAW_I539_ASSET);
  } catch (error) {
    return;
  }
  const template = {
    pdfTemplatePath: RAW_I539_ASSET,
    formFields: [{ fieldId: "applicant.fullName", pdfField: "Pt1Line1a_FamilyName" }],
    pdfFieldMappings: [{ caseField: "applicant.fullName", pdfField: "Pt1Line1a_FamilyName", type: "text" }],
  };
  const caseForm = { filledData: { applicant: { fullName: "Doe" } } };
  const previousPath = env.qpdfPath;
  env.qpdfPath = "C:/definitely/not/a/real/qpdf/binary-does-not-exist.exe";
  try {
    await assert.rejects(
      () => PDFRenderer.render({ caseForm, template, flatten: false }),
      (error) => error.code === "QPDF_NOT_FOUND"
    );
  } finally {
    env.qpdfPath = previousPath;
  }
});

test("AC10 - form-agnostic: the identical render pipeline fills a completely unrelated synthetic form", async () => {
  const { PDFDocument } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([500, 300]);
  const form = pdf.getForm();
  const nameField = form.createTextField("SponsorOrgName");
  nameField.addToPage(page, { x: 40, y: 220, width: 220, height: 24 });
  const ageField = form.createTextField("ApplicantAge");
  ageField.addToPage(page, { x: 40, y: 180, width: 100, height: 24 });
  const activeCheck = form.createCheckBox("IsActiveSponsor");
  activeCheck.addToPage(page, { x: 40, y: 140, width: 20, height: 20 });

  const templatePath = path.join(require("os").tmpdir(), `h3-ac10-${Date.now()}.pdf`);
  await fs.writeFile(templatePath, Buffer.from(await pdf.save()));

  try {
    // Deliberately made-up canonical namespace with no relation whatsoever
    // to person.*/beneficiary.*/company.* or any I-129 field name - proves
    // PDFGenerationService/PDFRenderer/PDFFieldMapper carry no hardcoded
    // USCIS-form-specific logic (confirmed by code inspection: grep for
    // "I-129"/"i129" across form-generation/ returns nothing outside tests).
    const template = {
      formCode: "ZZ-000",
      formFields: [
        { fieldId: "sponsor.orgName", pdfField: "SponsorOrgName", type: "text" },
        { fieldId: "applicant.age", pdfField: "ApplicantAge", type: "text" },
        { fieldId: "sponsor.isActive", pdfField: "IsActiveSponsor", type: "checkbox" },
      ],
      pdfTemplatePath: templatePath,
    };
    const caseForm = { filledData: { sponsor: { orgName: "Contoso Robotics", isActive: true }, applicant: { age: "29" } } };
    const rendered = await PDFRenderer.render({ caseForm, template, flatten: false });
    const output = await PDFDocument.load(rendered.buffer);
    assert.equal(output.getForm().getTextField("SponsorOrgName").getText(), "Contoso Robotics");
    assert.equal(output.getForm().getTextField("ApplicantAge").getText(), "29");
    assert.equal(output.getForm().getCheckBox("IsActiveSponsor").isChecked(), true);
    assert.equal(rendered.renderReport.mappedFieldCount, 3);
    assert.deepEqual(rendered.renderReport.unmappedPdfFields, []);
  } finally {
    await fs.unlink(templatePath).catch(() => {});
  }
});
