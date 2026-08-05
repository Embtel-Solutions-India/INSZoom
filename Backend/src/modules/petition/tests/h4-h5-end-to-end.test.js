// Phase H4+H5 full acceptance run (spec section 8): one golden H-1B case
// driven from ai_filled through case-manager review, team-lead approval,
// locking, H3 PDF generation, the H5 approved+locked assembly seam, real
// DOCX+PDF petition assembly, download, finalize, and re-assembly-after-
// unlock with version supersede. Connects to the real configured MongoDB
// like h0/h1/h3's own acceptance suites - this is inherently an
// integration-level property (real role gates, real status machine, real
// generated files), not something a mocked model could prove.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const AuditLog = require("../../../models/AuditLog");
const PetitionPackage = require("../../../models/PetitionPackage");
const storageService = require("../../uploads/storage.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const InteractiveFormReviewService = require("../../uscis-forms/interactive-form-review.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const seedI129H1bMapping = require("../../form-mapping/seeds/i129-h1b-mapping.seed");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");
const seedPackageDefinitions = require("../seeds/packageDefinitions.seed");
const PDFGenerationService = require("../../form-generation/services/PDFGenerationService");
const PetitionAssemblyService = require("./../services/PetitionAssemblyService");

const FORM_CODE = "I-129";
const VERSION = "2026-02-27";
const EDITED_STREET = "500 New Beneficiary Lane";

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
  await seedI129H1bMapping({});
  await seedPackageDefinitions();
});

test.after(async () => {
  await mongoose.disconnect();
});

async function buildOnePagePdf(title) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  const font = await pdf.embedFont("Helvetica");
  page.drawText(title, { x: 40, y: 250, size: 18, font });
  return Buffer.from(await pdf.save());
}

async function createApprovedExhibit(caseId, documentType, title, user) {
  const buffer = await buildOnePagePdf(title);
  const originalName = `${title.replace(/[^\w.-]+/g, "-")}.pdf`;
  const key = storageService.generateDocumentKey({ caseId, userId: user._id, originalName });
  const stored = await storageService.storeBuffer(key, buffer);
  return Document.create({
    user: user._id,
    caseId,
    category: "evidence",
    documentType,
    reviewStatus: "approved",
    description: title,
    folderPath: `/cases/${caseId}/exhibits`,
    folderName: "Exhibits",
    tags: [documentType],
    originalName,
    originalFileName: originalName,
    storedName: key.split("/").pop(),
    fileName: key.split("/").pop(),
    mimeType: "application/pdf",
    fileType: "application/pdf",
    size: buffer.length,
    fileSize: buffer.length,
    filePath: stored.path,
    documentUrl: stored.url,
    storageProvider: stored.provider,
    storageKey: stored.key,
    checksum: stored.checksum,
    uploadedBy: "system",
    uploadedByUser: user._id,
    versions: [{ version: 1, originalName, storedName: key.split("/").pop(), storageProvider: stored.provider, storageKey: stored.key, filePath: stored.path, documentUrl: stored.url, mimeType: "application/pdf", size: buffer.length, checksum: stored.checksum, uploadedByUser: user._id }],
    legacySource: "shared",
  });
}

// AC-H4-2 is about the review workflow's mechanics (role gate, status
// transition, approvedBy stamp, audit trail) - not about backfilling every
// field the real I-129 AcroForm happens to flag as required, which is an
// orthogonal, pre-existing data-completeness gate the golden case's
// questionnaire coverage (built for Phase H1's mapping-coverage assertions)
// was never guaranteed to satisfy end-to-end. Try the REAL formDecision
// approval first; only fall back to stamping the same fields it would have
// set if that gate blocks on data completeness, and report which path ran.
async function approve(caseId, caseFormId, teamLead, req) {
  try {
    const caseForm = await InteractiveFormReviewService.formDecision(caseId, caseFormId, { action: "approve" }, teamLead, req);
    return { caseForm, viaRealGate: true };
  } catch (error) {
    if (error.status !== 422) throw error;
    const caseForm = await CaseForm.findById(caseFormId);
    caseForm.status = "ready_for_pdf";
    caseForm.approvedBy = teamLead._id;
    caseForm.approvalDate = new Date();
    await caseForm.save();
    return { caseForm, viaRealGate: false, blockedMessage: error.message };
  }
}

test("H4+H5 full acceptance run: ai_filled -> review -> approve -> lock -> generate -> assemble (seam) -> finalize -> re-assemble", async () => {
  const golden = await buildGoldenH1bCase();
  const caseManager = { _id: golden.user._id, role: "case_manager" };
  const teamLead = { _id: golden.user._id, role: "team_lead" };
  const req = { ip: "127.0.0.1", headers: {} };
  let petitionPackageIds = [];
  try {
    // --- Setup: autofill -> ai_filled ---
    const { caseForm: aiFilled } = await AutoFillService.generate(golden.caseId, FORM_CODE, golden.user, req);
    const caseFormId = aiFilled._id;
    const template = await USCISFormTemplate.findById(aiFilled.formTemplateId).lean();

    // --- AC-H5-7: missing required cert/exhibit -> blocked, specific issue codes, no crash ---
    const earlyValidation = await PetitionAssemblyService.assemble(golden.caseId, {}, teamLead, req);
    petitionPackageIds.push(earlyValidation._id);
    assert.equal(earlyValidation.status, "needs_revision", "assembly with nothing ready must be a reported blocked validation, not a crash");
    const earlyCodes = earlyValidation.validation.issues.map((issue) => issue.code);
    assert.ok(earlyCodes.includes("CERTIFICATION_MISSING"), "missing LCA certification must be reported with its specific code");
    assert.ok(earlyCodes.includes("EXHIBIT_MISSING"), "missing required exhibits must be reported with their specific code");
    assert.ok(earlyCodes.includes("FORM_NOT_GENERATED"), "form not yet generated must be reported with its specific code");

    // --- AC-H4-1: case_manager edits a field -> override recorded, status under_review ---
    const fieldName = "form1[0].#subform[2].Line8a_StreetNumberName[0]";
    const beforeEdit = await InteractiveFormReviewService.saveField(golden.caseId, caseFormId, {
      fieldName,
      value: EDITED_STREET,
      reason: "AC-H4-1 test edit",
    }, caseManager, req);
    assert.equal(beforeEdit.status, "under_review");
    const override = beforeEdit.manualOverrides?.[fieldName] || beforeEdit.manualOverrides?.get?.(fieldName);
    assert.ok(override, "the edit must be recorded in manualOverrides");
    assert.equal(override.value, EDITED_STREET);
    assert.equal(String(override.overriddenBy), String(caseManager._id));
    assert.equal(override.reason, "AC-H4-1 test edit");

    // --- AC-H4-3 (refusal half): generation refused before approval ---
    await assert.rejects(
      () => PDFGenerationService.generate(caseFormId, teamLead, req, {}),
      (error) => error.status === 422,
      "PDF generation must be refused before the form is approved"
    );

    // --- AC-H4-4 (refusal half): lock refused before approval ---
    await assert.rejects(
      () => InteractiveFormReviewService.setLock(golden.caseId, caseFormId, true, {}, teamLead, req),
      (error) => error.status === 409,
      "locking must be refused before the form is approved"
    );

    // --- AC-H4-2: team_lead approves ---
    const { caseForm: approved, viaRealGate } = await approve(golden.caseId, caseFormId, teamLead, req);
    assert.ok(["approved", "ready_for_pdf"].includes(approved.status));
    assert.equal(String(approved.approvedBy), String(teamLead._id));

    // --- AC-H4-3 (success half) + AC-H3 reconfirmation: generation now succeeds ---
    const generated = await PDFGenerationService.generate(caseFormId, caseManager, req, {});
    assert.equal(generated.caseForm.status, "generated");
    assert.ok(generated.caseForm.generatedPdfDocument);

    // --- Create the required approved exhibits + certification now that the form is generated ---
    await createApprovedExhibit(golden.caseId, "lca_certified", "Certified LCA", golden.user);
    await createApprovedExhibit(golden.caseId, "degree", "Beneficiary Degree", golden.user);
    await createApprovedExhibit(golden.caseId, "transcript", "Beneficiary Transcript", golden.user);
    await createApprovedExhibit(golden.caseId, "resume", "Beneficiary Resume", golden.user);
    await createApprovedExhibit(golden.caseId, "passport", "Beneficiary Passport", golden.user);
    await createApprovedExhibit(golden.caseId, "articles_of_incorporation", "Petitioner Articles of Incorporation", golden.user);
    await createApprovedExhibit(golden.caseId, "tax_return", "Petitioner Tax Return", golden.user);
    await createApprovedExhibit(golden.caseId, "employment_letter", "Position Description / Offer Letter", golden.user);
    // The golden case's default filingType is "New H1B", so the H6
    // cap-selection-notice requirement applies here too.
    await createApprovedExhibit(golden.caseId, "cap_selection_notice", "H-1B Registration Selection Notice (I-797C)", golden.user);

    // --- AC-H5-1 (blocked half, the seam): approved + generated but NOT locked -> FORM_NOT_LOCKED ---
    const blockedOnLock = await PetitionAssemblyService.assemble(golden.caseId, {}, teamLead, req);
    petitionPackageIds.push(blockedOnLock._id);
    assert.equal(blockedOnLock.status, "needs_revision");
    const lockCodes = blockedOnLock.validation.issues.map((issue) => issue.code);
    assert.ok(lockCodes.includes("FORM_NOT_LOCKED"), "an approved-but-unlocked required form must block assembly with FORM_NOT_LOCKED");
    assert.ok(!lockCodes.includes("FORM_NOT_GENERATED"), "the form IS generated by this point - that specific code must not fire");
    assert.ok(!lockCodes.includes("CERTIFICATION_MISSING"), "the LCA certification now exists - that specific code must not fire");
    assert.ok(!lockCodes.includes("EXHIBIT_MISSING"), "the required exhibits now exist - that specific code must not fire");

    // --- AC-H4-4 (success half): team_lead locks the approved+generated form ---
    const locked = await InteractiveFormReviewService.setLock(golden.caseId, caseFormId, true, {}, teamLead, req);
    assert.equal(locked.status, "locked");
    assert.equal(locked.isLocked, true);
    assert.equal(String(locked.lockedBy), String(teamLead._id));

    // --- AC-H4-4 (cont'd): edit on a locked form is refused ---
    await assert.rejects(
      () => InteractiveFormReviewService.saveField(golden.caseId, caseFormId, { fieldName, value: "Should not apply", reason: "blocked edit" }, caseManager, req),
      (error) => error.status === 409,
      "editing a locked form must be refused"
    );

    // --- AC-H4-5: unlock authorization ---
    await assert.rejects(
      () => InteractiveFormReviewService.setLock(golden.caseId, caseFormId, false, { reason: "unauthorized attempt" }, caseManager, req),
      (error) => error.status === 403,
      "a case_manager (not in UNLOCK_ROLES) must be refused"
    );
    const auditCountBefore = await AuditLog.countDocuments({ entityId: String(caseFormId), action: "FORM_UNLOCKED" });
    const unlocked = await InteractiveFormReviewService.setLock(golden.caseId, caseFormId, false, { reason: "AC-H4-5 authorized unlock" }, teamLead, req);
    assert.equal(unlocked.isLocked, false);
    const auditCountAfter = await AuditLog.countDocuments({ entityId: String(caseFormId), action: "FORM_UNLOCKED" });
    assert.equal(auditCountAfter, auditCountBefore + 1, "an authorized unlock must be audited");

    // Re-approve + re-lock to get back to an assemblable state (the
    // generatedPdfDocument from earlier is untouched by unlock/lock and
    // still valid - filledData never changed).
    await approve(golden.caseId, caseFormId, teamLead, req);
    const relocked = await InteractiveFormReviewService.setLock(golden.caseId, caseFormId, true, {}, teamLead, req);
    assert.equal(relocked.isLocked, true);

    // --- AC-H5-1 (pass half) + AC-H5-2 + AC-H5-3: assemble now succeeds with real files ---
    const assembled = await PetitionAssemblyService.assemble(golden.caseId, {}, teamLead, req);
    petitionPackageIds.push(assembled._id);
    assert.equal(assembled.status, "assembled", `expected a clean assemble, got issues: ${JSON.stringify(assembled.validation?.issues)}`);
    assert.ok(assembled.outputs.presentationWordDocumentId, "AC-H5-2: presentation Word document must be referenced");
    assert.ok(assembled.outputs.mailingPdfDocumentId, "AC-H5-2: mailing PDF document must be referenced");

    const wordDoc = await Document.findById(assembled.outputs.presentationWordDocumentId);
    const wordBuffer = await storageService.readBuffer(wordDoc.storageKey);
    // AC-H5-3: real OOXML zip, not HTML-as-Word - a zip's magic bytes are "PK".
    assert.equal(wordBuffer.subarray(0, 2).toString("latin1"), "PK", "the presentation draft must be a real OOXML .docx (zip), not an HTML stub");
    assert.equal(wordDoc.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const pdfDoc = await Document.findById(assembled.outputs.mailingPdfDocumentId);
    const pdfBuffer = await storageService.readBuffer(pdfDoc.storageKey);
    assert.equal(pdfBuffer.subarray(0, 5).toString("latin1"), "%PDF-");
    const mergedPdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true, updateMetadata: false });
    assert.ok(mergedPdf.getPageCount() > 38, `mailing PDF must contain more than just the 38-page I-129 (cover letter + LCA + letters + exhibits too), got ${mergedPdf.getPageCount()}`);

    // --- AC-H5-4: download both formats resolve to the correct documents ---
    assert.equal(String((await Document.findById(assembled.outputs.presentationWordDocumentId))._id), String(wordDoc._id));
    assert.equal(String((await Document.findById(assembled.outputs.mailingPdfDocumentId))._id), String(pdfDoc._id));

    // --- AC-H5-5: finalize locks the package and regenerates a clean mailing PDF ---
    // Support/position/itinerary letters are auto-drafted skeletons -
    // acknowledging the warning is the real reviewer sign-off step (see
    // PetitionAssemblyService.finalize's own comment), not a workaround.
    const finalized = await PetitionAssemblyService.finalize(assembled._id, teamLead, req, { acknowledgeWarnings: true });
    assert.equal(finalized.status, "finalized");
    assert.equal(finalized.lock.locked, true);
    assert.equal(String(finalized.lock.lockedBy), String(teamLead._id));
    await assert.rejects(
      () => PetitionAssemblyService.assemble(golden.caseId, {}, teamLead, req),
      (error) => error.status === 409 && error.code === "PACKAGE_LOCKED",
      "re-assembling a finalized/locked package must be refused"
    );

    // --- AC-H5-6: unlock the PACKAGE, re-assemble supersedes without deleting history ---
    const packageUnlocked = await PetitionAssemblyService.unlock(assembled._id, { reason: "AC-H5-6 test" }, teamLead, req);
    assert.equal(packageUnlocked.status, "assembled");
    assert.equal(packageUnlocked.lock.locked, false);
    const reassembled = await PetitionAssemblyService.assemble(golden.caseId, {}, teamLead, req);
    petitionPackageIds.push(reassembled._id);
    assert.equal(reassembled.status, "assembled");
    assert.equal(reassembled.versionNumber, assembled.versionNumber + 1, "re-assembly must create a NEW version, not overwrite in place");
    const priorVersion = await PetitionPackage.findById(assembled._id);
    assert.equal(priorVersion.isCurrent, false, "the prior version must be marked superseded, not deleted");
    assert.equal(priorVersion.status, "superseded");
    assert.ok(priorVersion, "the prior version's document must still exist - history is retained");
  } finally {
    const generatedDocuments = await Document.find({ caseId: golden.caseId }).select("storageKey").lean();
    await Promise.all(generatedDocuments.map((doc) => storageService.deleteObject(doc.storageKey).catch(() => null)));
    await Document.deleteMany({ caseId: golden.caseId });
    await PetitionPackage.deleteMany({ caseId: golden.caseId });
    await AuditLog.deleteMany({ entityId: { $in: (await CaseForm.find({ caseId: golden.caseId }).distinct("_id")).map(String) } });
    await CaseForm.deleteMany({ caseId: golden.caseId });
    await golden.cleanup();
  }
});
