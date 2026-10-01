const PDFGenerationService = require("../services/PDFGenerationService");
const FilingPackageService = require("../services/FilingPackageService");

function handle(res, error) {
  return res.status(error.status || 500).json({ success: false, message: error.message, validationResults: error.validationResults });
}

exports.generate = async (req, res) => {
  try {
    const data = await PDFGenerationService.generate(req.params.caseFormId, req.user, req, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.validate = async (req, res) => {
  try {
    const data = await PDFGenerationService.validate(req.params.caseFormId, req.user, req);
    res.status(data.validationResults.valid ? 200 : 422).json({ success: data.validationResults.valid, data, validationResults: data.validationResults });
  } catch (error) {
    handle(res, error);
  }
};

exports.preview = async (req, res) => {
  try {
    const { document, buffer } = await PDFGenerationService.getPdfDocument(req.params.caseFormId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${document.originalName || "uscis-form.pdf"}"`);
    res.send(buffer);
  } catch (error) {
    handle(res, error);
  }
};

exports.download = async (req, res) => {
  try {
    const { caseForm, document, buffer } = await PDFGenerationService.getPdfDocument(req.params.caseFormId);
    await PDFGenerationService.audit("PDF_DOWNLOADED", caseForm, req.user, req, { documentId: document._id });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${document.originalName || "uscis-form.pdf"}"`);
    res.send(buffer);
  } catch (error) {
    handle(res, error);
  }
};

exports.approve = async (req, res) => {
  try {
    const data = await PDFGenerationService.approve(req.params.caseFormId, req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.regenerate = async (req, res) => {
  try {
    const data = await PDFGenerationService.generate(req.params.caseFormId, req.user, req, { ...(req.body || {}), regenerate: true });
    res.status(201).json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

// The single official download path (Forms Download overhaul). Always the
// real, authentic USCIS PDF with the latest filled values - no watermark,
// no status gate. Only a locked/filed form skips the pre-download refresh
// (it's a historical record; its values are final by definition).
// If canonical data has changed since the last autofill (syncState.stale)
// and the form is still editable, AutoFillService.generate(regenerate:true)
// runs first - its own isReviewedOrManual() check (unmodified) leaves every
// MANUAL_OVERRIDE field exactly as the case manager set it.
// Persists the served bytes as a Document, same as the filing-copy path it
// replaces - this is the one real, official copy of this form ever handed
// out, and the case record should keep it.
exports.downloadForm = async (req, res) => {
  try {
    const AutoFillService = require("../../form-mapping/services/AutoFillService");
    const PDFRenderer = require("../services/PDFRenderer");
    const env = require("../../../config/env");

    let caseForm = await PDFGenerationService.loadCaseForm(req.params.caseFormId, { readOnly: false });
    const isHistorical = caseForm.isLocked || ["locked", "filed"].includes(caseForm.status);
    // BUG (fixed): syncState.stale means "was filled once, then canonical
    // data changed since" - a CaseForm that has NEVER been through
    // AutoFillService even once (freshly provisioned, syncState.lastSyncedAt
    // unset) reports stale:false, the same as one that's genuinely current -
    // there's nothing to compare staleness against yet. That let this
    // official-download path skip the initial autofill entirely and render
    // straight from an empty filledData/fieldValues, confirmed live: a
    // never-synced H-1B supplement CaseForm downloaded with every field
    // blank despite its questionnaire answers already existing. "Never
    // synced" must trigger the same refresh "stale" does.
    const neverSynced = !caseForm.syncState?.lastSyncedAt;
    const wasStale = Boolean(caseForm.syncState?.stale) || neverSynced;

    if (!isHistorical && wasStale) {
      await AutoFillService.generate(caseForm.caseId, caseForm.formCode, req.user, req, { regenerate: true });
      caseForm = await PDFGenerationService.loadCaseForm(req.params.caseFormId, { readOnly: true });
    }

    // Adobe PDF Services is the default engine for this, the single official
    // download path (opt-out only, never an automatic silent fallback to
    // pdf-lib on an Adobe failure - that failure surfaces through the same
    // catch below as any other rendering error). PDFRenderer.js itself is
    // unmodified; AdobeFormRenderer mirrors its renderFiling() contract
    // exactly and reuses the same PDFFieldMapper/PDFFidelityService calls.
    const engine = env.adobe.fillEnabled ? "adobe" : "pdf-lib";
    const renderer = env.adobe.fillEnabled ? require("../services/AdobeFormRenderer") : PDFRenderer;

    const { buffer, renderReport, fidelityReport } = await renderer.renderFiling({
      caseForm,
      template: caseForm.formTemplateId.toObject(),
    });

    const document = await PDFGenerationService.createGeneratedDocument(caseForm, buffer, req.user, { valid: true }, renderReport, null);
    await PDFGenerationService.audit("PDF_OFFICIAL_DOWNLOADED", caseForm, req.user, req, {
      documentId: document._id,
      fidelityReport,
      staleRefreshed: !isHistorical && wasStale,
      status: caseForm.status,
      engine,
      adjustedFieldWrites: renderReport?.adjustedFieldWrites || [],
      blankedFieldWrites: renderReport?.failedFieldWrites || [],
    });

    // Fields whose value could not be written as-is (longer than the PDF
    // field allows): the download still succeeds, but the user is told which
    // ones to double-check instead of silently getting a blank/changed field.
    const warnings = [
      ...(renderReport?.failedFieldWrites || []).map((item) => `${item.pdfField.split(".").pop().replace(/\[\d+\]$/, "")}: ${item.message}`),
      ...(renderReport?.adjustedFieldWrites || []).map((item) => `${item.pdfField.split(".").pop().replace(/\[\d+\]$/, "")}: ${item.reason}`),
    ];
    if (warnings.length) {
      res.setHeader("X-Form-Warnings", encodeURIComponent(JSON.stringify(warnings.slice(0, 20))));
      res.setHeader("Access-Control-Expose-Headers", "X-Form-Warnings, Content-Disposition");
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `${caseForm.formCode || "uscis-form"}_${String(caseForm.caseId)}_${date}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error) {
    handle(res, error);
  }
};

exports.generatePackage = async (req, res) => {
  try {
    const data = await FilingPackageService.assemble(req.body || {}, req.user, req);
    res.status(201).json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};
