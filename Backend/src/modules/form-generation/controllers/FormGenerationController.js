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
    const { prepareOfficialDownload } = require("../services/OfficialFormDownloadService");
    const { buffer, caseForm, mode, warnings, bookkeeping } = await prepareOfficialDownload({ caseFormId: req.params.caseFormId, user: req.user, req, deferBookkeeping: true });

    // Anything that was adjusted, left blank or degraded is reported to the
    // user (the Admin UI shows it after the file downloads).
    res.setHeader("X-Form-Render-Mode", mode);
    if (warnings.length) res.setHeader("X-Form-Warnings", encodeURIComponent(JSON.stringify(warnings.slice(0, 20))));
    res.setHeader("Access-Control-Expose-Headers", "X-Form-Warnings, X-Form-Render-Mode, Content-Disposition");

    const date = new Date().toISOString().slice(0, 10);
    const filename = `${caseForm.formCode || "uscis-form"}_${String(caseForm.caseId)}_${date}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
    // Saving the copy and the audit entry happen after the file is on its way.
    if (bookkeeping) bookkeeping().catch(() => {});
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
