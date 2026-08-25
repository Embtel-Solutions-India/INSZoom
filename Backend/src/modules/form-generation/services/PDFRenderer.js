const fs = require("fs").promises;
const path = require("path");
const storageService = require("../../uploads/storage.service");
const { normalizePdf } = require("../../../utils/normalizePdf");
const PDFFieldMapper = require("./PDFFieldMapper");
const WatermarkService = require("./WatermarkService");

class PDFRenderer {
  static loadPdfLib() {
    try {
      return require("pdf-lib");
    } catch (error) {
      const missing = new Error("pdf-lib dependency is required for USCIS PDF rendering. Install backend dependencies before generating official PDFs.");
      missing.status = 501;
      throw missing;
    }
  }

  static async loadTemplateBuffer(template) {
    if (template.pdfStorageKey) return storageService.readBuffer(template.pdfStorageKey);
    const templatePath = template.pdfTemplatePath || template.localPdfPath;
    if (!templatePath) {
      const error = new Error("PDF template path is not configured");
      error.status = 422;
      throw error;
    }
    const absolutePath = path.isAbsolute(templatePath) ? templatePath : path.join(process.cwd(), templatePath);
    return fs.readFile(absolutePath);
  }

  // Loads the template's stored PDF and hands back a pdf-lib document that is
  // actually fillable. A hybrid XFA+AcroForm USCIS PDF doesn't throw when
  // pdf-lib loads it - it parses "successfully" but exposes zero AcroForm
  // fields (confirmed empirically against the raw I-129 and I-539 dev
  // assets), so a template imported before H0's qpdf normalizer existed (or
  // whose stored bytes were otherwise never normalized) is detected by a
  // field-count mismatch against the template's own formFields metadata, not
  // by a try/catch. On mismatch, normalize on demand (reusing H0's
  // normalizePdf - never a second PDF engine) and cache the fillable bytes
  // back to the same storage key so this only pays the qpdf cost once. If
  // qpdf itself is missing, normalizePdf's own clear QPDF_NOT_FOUND error
  // propagates unchanged - never a silently-empty unfilled PDF.
  static async loadTemplatePdf(template, PDFDocument) {
    const templateBuffer = await this.loadTemplateBuffer(template);
    const loadOptions = { ignoreEncryption: true, updateMetadata: false };
    let pdf = await PDFDocument.load(templateBuffer, loadOptions);
    const expectedFieldCount = (template.formFields || []).length;
    if (expectedFieldCount > 0 && pdf.getForm().getFields().length === 0) {
      const normalized = await normalizePdf(templateBuffer);
      if (template.pdfStorageKey) {
        await storageService.storeBuffer(template.pdfStorageKey, normalized).catch(() => null);
      }
      pdf = await PDFDocument.load(normalized, loadOptions);
    }
    return pdf;
  }

  static setFormField(form, mappedField) {
    let field;
    try {
      field = form.getField(mappedField.pdfField);
    } catch (error) {
      field = null;
    }
    if (!field) return false;
    const value = mappedField.value;
    const constructorName = field.constructor?.name || "";
    try {
      if (constructorName.includes("CheckBox")) {
        value ? field.check() : field.uncheck();
        return true;
      }
      if (constructorName.includes("RadioGroup")) {
        field.select(String(value));
        return true;
      }
      if (constructorName.includes("Dropdown")) {
        field.select(String(value));
        return true;
      }
      if (constructorName.includes("OptionList")) {
        field.select(Array.isArray(value) ? value.map(String) : [String(value)]);
        return true;
      }
      field.setText(String(value));
      return true;
    } catch (error) {
      mappedField.renderError = error.message;
      return false;
    }
  }

  static async render({ caseForm, template, watermark, flatten = false }) {
    const { PDFDocument, PDFName, PDFBool } = this.loadPdfLib();
    const pdf = await this.loadTemplatePdf(template, PDFDocument);
    const form = pdf.getForm();
    // Confirmed root cause of 2 historical "generated" CaseForm records that
    // turned out to be 883-byte, 1-page, 0-field stubs: the template asset
    // they were rendered from (since deleted/replaced) apparently exposed no
    // real AcroForm fields, and nothing here treated that as fatal - the
    // render "succeeded" against a template that was never actually usable.
    // loadTemplatePdf() already re-normalizes via qpdf when a freshly-loaded
    // template exposes 0 fields but formFields metadata says it should have
    // some; this is the backstop for when even that doesn't recover a real,
    // fillable template - fail loudly instead of persisting a blank stub.
    const expectedFieldCount = (template.formFields || []).length;
    if (expectedFieldCount > 0 && form.getFields().length === 0) {
      const error = new Error(
        `Template PDF for ${template.formCode || template.formNumber || "this form"} exposes 0 AcroForm fields after normalization, but ${expectedFieldCount} were expected from its formFields metadata - refusing to render a blank/broken PDF. Re-import or repair this template's PDF asset.`
      );
      error.status = 422;
      error.code = "TEMPLATE_PDF_NO_FIELDS";
      throw error;
    }
    const { mappedFields, missingMappings } = PDFFieldMapper.mapFields(caseForm, template);
    const unmappedPdfFields = [];
    const failedFieldWrites = [];

    Object.values(mappedFields).forEach((mappedField) => {
      if (!this.setFormField(form, mappedField)) {
        unmappedPdfFields.push(mappedField.pdfField);
        if (mappedField.renderError) failedFieldWrites.push({ pdfField: mappedField.pdfField, caseField: mappedField.caseField, message: mappedField.renderError });
      }
    });
    if (flatten) {
      form.flatten();
    } else {
      // Guarantees filled values are visible in Acrobat/Chrome/Preview - not
      // just in the field's own data - by asking every viewer to regenerate
      // appearance streams itself rather than trusting pdf-lib's generated
      // ones (verified empirically: reload -> NeedAppearances round-trips as
      // true, see PDFRenderer.appearance.test.js).
      form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    }

    let output = Buffer.from(await pdf.save());
    output = await WatermarkService.apply(output, watermark);
    return {
      buffer: output,
      renderReport: {
        mappedFieldCount: Object.keys(mappedFields).length,
        missingMappings,
        unmappedPdfFields,
        failedFieldWrites,
        flattened: Boolean(flatten),
        watermark: WatermarkService.normalize(watermark),
      },
    };
  }

  // Phase 5 (§D.1/§G) - the clean, watermark-free filing-copy path. Always renders with
  // `watermark: null` (WatermarkService.apply's own `if (!label) return buffer` short-circuit means
  // this file never needs to change), then runs PDFFidelityService against the real output bytes
  // before handing them back - the caller (FormGenerationController.filingPdf) must never store or
  // serve a buffer this rejects. Deliberately bypasses PDFGenerationService.generate entirely: that
  // function's stale-gate (§A.3) is irrelevant here because Phase 2's canonical write-back keeps
  // CaseForm data current by design, and its own status gate is enforced by the controller before
  // this is ever called.
  static async renderFiling({ caseForm, template }) {
    const rendered = await this.render({ caseForm, template, watermark: null, flatten: false });
    const PDFFidelityService = require("./PDFFidelityService");
    const fidelityResult = await PDFFidelityService.verify(rendered.buffer, caseForm, template);
    if (!fidelityResult.valid) {
      const error = new Error(`PDF fidelity check failed: ${fidelityResult.errors.join("; ")}`);
      error.status = 422;
      error.code = "PDF_FIDELITY_FAILURE";
      error.report = fidelityResult.report;
      throw error;
    }
    return { buffer: rendered.buffer, renderReport: rendered.renderReport, fidelityReport: fidelityResult.report };
  }
}

module.exports = PDFRenderer;
