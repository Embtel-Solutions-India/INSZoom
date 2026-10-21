const PDFGenerationService = require("../services/PDFGenerationService");
const FilingPackageService = require("../services/FilingPackageService");
const { sendFile } = require("../../../utils/fileResponse");

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
    sendFile(res, { buffer, fileName: document.originalName || "uscis-form.pdf", mimeType: "application/pdf", disposition: "inline" });
  } catch (error) {
    handle(res, error);
  }
};

exports.download = async (req, res) => {
  try {
    const { caseForm, document, buffer } = await PDFGenerationService.getPdfDocument(req.params.caseFormId);
    await PDFGenerationService.audit("PDF_DOWNLOADED", caseForm, req.user, req, { documentId: document._id });
    sendFile(res, { buffer, fileName: document.originalName || "uscis-form.pdf", mimeType: "application/pdf", disposition: "attachment" });
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
    const { prepareOfficialDownload, withTimeout } = require("../services/OfficialFormDownloadService");
    // A form whose template is not (yet) active in the system - G-28 and the like - is checked against uscis.gov on EVERY download, so a newly
    // published edition is never missed. The case keeps its edition (an edition-locked form is not swapped silently); the user is told.
    let freshnessNote = null;
    try {
      const current = await require("../../../models/CaseForm").findById(req.params.caseFormId).populate({ path: "formTemplateId", select: "status version formCode" });
      if (current?.formTemplateId && current.formTemplateId.status !== "active") {
        const check = await withTimeout(require("../../uscis-form-import/services/OnDemandFormAcquisitionService").ensureCurrentUSCISForm(current.formCode, req.user, req, { forceCheck: true }), 25000, "USCIS edition check");
        if (check?.template && String(check.template._id) !== String(current.formTemplateId._id)) {
          freshnessNote = `USCIS now publishes a newer edition of ${current.formCode} (${check.template.version || "new"}); this copy is the edition already on the case (${current.formTemplateId.version || "current"}).`;
        } else if (check?.checkError) {
          freshnessNote = `Could not reach uscis.gov to check for a newer edition (${check.checkError}); this is the edition stored on the case.`;
        }
      }
    } catch (checkError) {
      freshnessNote = `Could not check uscis.gov for a newer edition (${checkError.message}); this is the edition stored on the case.`;
    }
    const { buffer, caseForm, mode, warnings, bookkeeping } = await prepareOfficialDownload({ caseFormId: req.params.caseFormId, user: req.user, req, deferBookkeeping: true });

    // Anything that was adjusted, left blank or degraded is reported to the
    // user (the Admin UI shows it after the file downloads).
    res.setHeader("X-Form-Render-Mode", mode);
    const allWarnings = freshnessNote ? [...warnings, freshnessNote] : warnings;
    if (allWarnings.length) res.setHeader("X-Form-Warnings", encodeURIComponent(JSON.stringify(allWarnings.slice(0, 20))));
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
    // the package is built for the case named in the body: the caller must be allowed to work on that case
    const Case = require("../../../models/Case");
    const caseService = require("../../cases/case.service");
    const caseData = req.body?.caseId ? await Case.findById(req.body.caseId).select("-canonicalHistory") : null;
    if (!caseData) return res.status(404).json({ success: false, message: "Case not found" });
    if (!caseService.canAccessCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to build a filing package for this case" });
    const data = await FilingPackageService.assemble(req.body || {}, req.user, req);
    res.status(201).json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};
