// Phase H3 acceptance tests that need a real, mapped I-129 CaseForm: AC1
// (renders & stores), AC2 (values actually reach the PDF, not just the
// CaseForm object), AC4 (review-status gating), AC6 (fill warnings, no
// crash), AC7 (idempotent + versioned regeneration), and the data-fetch half
// of AC8 (download/preview). Reuses Phase H1's golden H-1B case + active
// mapping - like h0-i129-seed.test.js and h1-i129-mapping.test.js, this
// connects to the real configured MongoDB; the acceptance criteria here
// (exact rendered PDF field values, real versioning across real Document
// records) are inherently integration-level.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const AuditLog = require("../../../models/AuditLog");
const storageService = require("../../uploads/storage.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const seedI129H1bMapping = require("../../form-mapping/seeds/i129-h1b-mapping.seed");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");
const PDFGenerationService = require("../services/PDFGenerationService");
const PDFRenderer = require("../services/PDFRenderer");

const FORM_CODE = "I-129";
const VERSION = "2026-02-27";

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
  await seedI129H1bMapping({});
});

test.after(async () => {
  await mongoose.disconnect();
});

test("H3 acceptance suite: AC1, AC2, AC4, AC6, AC7, AC8 against a real, mapped I-129 CaseForm", async () => {
  const golden = await buildGoldenH1bCase();
  // PDFGenerationService.assertCanGenerate only allows staff roles
  // (super_admin/admin/team_lead/case_manager) to generate official PDFs -
  // the golden case's own `sysUser` is role "client" (correct for driving
  // AutoFillService, which has no such restriction). A separate staff actor
  // is needed for every PDFGenerationService call in this test.
  const staffUser = { _id: golden.user._id, role: "case_manager" };
  try {
    const { caseForm: aiFilled } = await AutoFillService.generate(golden.caseId, FORM_CODE, golden.user, {});
    const caseFormId = aiFilled._id;
    const templateBefore = await USCISFormTemplate.findById(aiFilled.formTemplateId).select("_id formFields updatedAt").lean();

    // --- AC4 (refusal half): generation on a non-approved CaseForm is refused ---
    await assert.rejects(
      () => PDFGenerationService.generate(caseFormId, staffUser, {}, {}),
      (error) => error.status === 422,
      "generation must refuse a CaseForm that hasn't cleared review"
    );

    // Test-setup shortcut: stamp the status the real review workflow
    // (interactive-form-review.service.js's formDecision, out of scope to
    // touch or re-drive here) would eventually set. Only
    // PDFGenerationService's OWN status gate is under test in this suite.
    await CaseForm.updateOne({ _id: caseFormId }, { $set: { status: "approved" } });

    // --- AC1 + AC4 (success half) ---
    const first = await PDFGenerationService.generate(caseFormId, staffUser, {}, {});
    assert.equal(first.caseForm.status, "generated");
    assert.ok(first.caseForm.generatedAt, "generatedAt must be stamped on the CaseForm");
    assert.equal(first.caseForm.generatedPdfVersions.length, 1);
    const firstDocumentId = String(first.caseForm.generatedPdfDocument);

    const buffer1 = await storageService.readBuffer(first.document.storageKey);
    const pdf1 = await PDFDocument.load(buffer1, { ignoreEncryption: true, updateMetadata: false });
    assert.equal(pdf1.getPageCount(), 38, "I-129 has 38 pages once normalized");

    // --- AC2: >=20 exact field values actually reached the rendered PDF (not just CaseForm.filledData) ---
    const form1 = pdf1.getForm();
    const text = (fieldName) => form1.getTextField(fieldName).getText();
    const checked = (fieldName) => form1.getCheckBox(fieldName).isChecked();
    // Line11g_CurrentNon is a dropdown widget on the real template, not a
    // text field (confirmed empirically via pdf-lib) - selection, not text.
    const selected = (fieldName) => form1.getDropdown(fieldName).getSelected()[0];

    assert.equal(text("form1[0].#subform[1].Part3_Line2_FamilyName[0]"), "Lovelace");
    assert.equal(text("form1[0].#subform[1].Part3_Line2_GivenName[0]"), "Ada");
    assert.equal(text("form1[0].#subform[1].Part3_Line2_MiddleName[0]"), "Kingsley");
    assert.equal(text("form1[0].#subform[2].Line6_DateOfBirth[0]"), "03/15/1990");
    assert.equal(text("form1[0].#subform[2].Part3Line4_CountryOfBirth[0]"), "United Kingdom");
    assert.equal(text("form1[0].#subform[2].Part3Line4_CountryOfCitizenship[0]"), "United Kingdom");
    assert.equal(text("form1[0].#subform[2].Part3Line5_PassportorTravDoc[0]"), "X1234567");
    assert.equal(text("form1[0].#subform[2].Line5_SSN[0]"), "123456789");
    assert.equal(text("form1[0].#subform[2].Line5_SEVIS[0]"), "N0012345678");
    assert.equal(text("form1[0].#subform[2].Part3Line5_ArrivalDeparture[0]"), "11223344556");
    assert.equal(selected("form1[0].#subform[2].Line11g_CurrentNon[0]"), "F-1");
    assert.equal(text("form1[0].#subform[2].Line11h_DateStatusExpires[0]"), "05/31/2027");
    assert.equal(text("form1[0].#subform[2].Line8a_StreetNumberName[0]"), "221B Baker Street");
    assert.equal(text("form1[0].#subform[2].Line8d_CityTown[0]"), "New York");
    assert.equal(selected("form1[0].#subform[2].Line8e_State[0]"), "NY");
    assert.equal(text("form1[0].#subform[2].Line8f_ZipCode[0]"), "10001");
    assert.equal(text("form1[0].#subform[1].Part2_ClassificationSymbol[0]"), "H-1B");
    assert.equal(text("form1[0].#subform[0].Line3_CompanyorOrgName[0]"), "Acme Analytics Inc");
    assert.equal(text("form1[0].#subform[0].Line7b_StreetNumberName[0]"), "500 Market Street");
    assert.equal(text("form1[0].#subform[13].Line1_PetitionerName[0]"), "Acme Analytics Inc");
    assert.equal(text("form1[0].#subform[13].Line2_BeneficiaryName[0]"), "Ada Kingsley Lovelace");
    assert.equal(text("form1[0].#subform[4].Part5_Q1_JobTitle[0]"), "Senior Software Engineer");
    assert.equal(text("form1[0].#subform[4].Line8_Wages[0]"), "135000");
    // Checkbox values prove the crosswalk's condition+boolean resolution
    // (resolved into CaseForm.filledData at autofill time) survives all the
    // way into the actual rendered widget state, not just the data object.
    assert.equal(checked("form1[0].#subform[1].new[0]"), true, "New H1B filing type must check the 'new' widget");
    assert.equal(checked("form1[0].#subform[1].concurrent[0]"), false, "mutually-exclusive filing-type widgets must not both be checked");
    assert.equal(checked("form1[0].#subform[2].Line1_Gender_P3[1]"), true, "Female gender must check the female widget");
    assert.equal(checked("form1[0].#subform[2].Line1_Gender_P3[0]"), false, "male widget must not be checked for a female beneficiary");

    // --- AC8 (data-fetch half): the download/preview controllers' underlying fetch works ---
    const fetched = await PDFGenerationService.getPdfDocument(caseFormId);
    assert.equal(String(fetched.document._id), firstDocumentId);
    assert.equal(fetched.buffer.subarray(0, 5).toString("latin1"), "%PDF-");

    // --- AC6: a field that can't be applied is a warning, not a crash ---
    // Monkey-patches the SAME PDFRenderer module object PDFGenerationService
    // already holds via require() (require-cache identity - no dependency
    // injection needed), calling through to the real implementation and
    // splicing in one synthetic failure so the rest of the render is
    // untouched real output, not a fully mocked PDF.
    const realRender = PDFRenderer.render;
    PDFRenderer.render = async (args) => {
      const result = await realRender.call(PDFRenderer, args);
      result.renderReport.failedFieldWrites = [
        ...result.renderReport.failedFieldWrites,
        { pdfField: "form1[0].#subform[1].Part3_Line2_FamilyName[0]", caseField: "employee_personal_lastName", message: "Injected for AC6: simulated malformed value" },
      ];
      result.renderReport.unmappedPdfFields = [...result.renderReport.unmappedPdfFields, "form1[0].#subform[1].Part3_Line2_FamilyName[0]"];
      return result;
    };
    let second;
    try {
      second = await PDFGenerationService.generate(caseFormId, staffUser, {}, { regenerate: true });
    } finally {
      PDFRenderer.render = realRender;
    }
    assert.equal(second.caseForm.status, "generated", "a per-field write failure must not block the whole generation");
    assert.ok(second.caseForm.fillWarnings.length >= 1, "the injected failure must be recorded as a fillWarning");
    assert.ok(
      second.caseForm.fillWarnings.some((warning) => warning.pdfField === "form1[0].#subform[1].Part3_Line2_FamilyName[0]"),
      "fillWarnings must reference the specific field that failed"
    );
    // The rest of the PDF is still filled correctly despite the injected warning.
    const buffer2 = await storageService.readBuffer(second.document.storageKey);
    const pdf2 = await PDFDocument.load(buffer2, { ignoreEncryption: true, updateMetadata: false });
    assert.equal(pdf2.getForm().getTextField("form1[0].#subform[1].Part3_Line2_GivenName[0]").getText(), "Ada");

    // --- AC7: regenerate again (2nd regenerate = 3rd generation overall); idempotent + versioned ---
    const third = await PDFGenerationService.generate(caseFormId, staffUser, {}, { regenerate: true });
    assert.equal(third.caseForm.generatedPdfVersions.length, 3, "every generation retains a version history entry - none orphaned or overwritten");
    assert.equal(String(third.caseForm.generatedPdfDocument), String(third.document._id), "exactly one CURRENT generatedPdfDocument pointer");
    assert.notEqual(String(third.caseForm.generatedPdfDocument), firstDocumentId, "the current pointer must have moved to the latest render");
    const stillFetchable = await PDFGenerationService.getPdfDocument(caseFormId);
    assert.equal(String(stillFetchable.document._id), String(third.document._id));

    const templateAfter = await USCISFormTemplate.findById(aiFilled.formTemplateId).select("_id formFields updatedAt").lean();
    assert.equal(String(templateAfter._id), String(templateBefore._id));
    assert.equal(templateAfter.formFields.length, templateBefore.formFields.length, "three generations must make zero changes to the template's own field metadata");
  } finally {
    const generatedDocuments = await Document.find({ caseId: golden.caseId }).select("storageKey").lean();
    await Promise.all(generatedDocuments.map((doc) => storageService.deleteObject(doc.storageKey).catch(() => null)));
    await Document.deleteMany({ caseId: golden.caseId });
    await AuditLog.deleteMany({ entityType: "CaseForm", entityId: { $in: await CaseForm.find({ caseId: golden.caseId }).distinct("_id") } });
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await golden.cleanup();
  }
});
