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

// Streams a fillable (non-flattened) draft PDF directly to the caller.
// Does NOT require approved/locked status - usable at any editable stage.
// Does NOT write a Document record - draft working copies are not stored.
// The PDF is still a real AcroForm: values are pre-filled but the fields
// remain interactive so an attorney can make final adjustments and sign.
exports.draftPdf = async (req, res) => {
  try {
    const caseForm = await PDFGenerationService.loadCaseForm(req.params.caseFormId, { readOnly: true });

    const PDFRenderer = require("../services/PDFRenderer");
    const rendered = await PDFRenderer.render({
      caseForm,
      template: caseForm.formTemplateId.toObject(),
      watermark: "DRAFT",
      flatten: false,
    });

    const filename = `${caseForm.formCode || "uscis-form"}-DRAFT-${caseForm._id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", rendered.buffer.length);
    res.send(rendered.buffer);
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
