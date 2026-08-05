const { PDFDocument } = require("pdf-lib");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");

const MAX_IMPORT_SIZE = Number(process.env.USCIS_FORM_IMPORT_MAX_BYTES || 50 * 1024 * 1024);

function enterpriseError(message, status = 400, code = "USCIS_FORM_IMPORT_ERROR", details = []) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  error.details = details;
  return error;
}

class FormValidationService {
  async validatePdfBuffer(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) throw enterpriseError("PDF file is required", 400, "PDF_REQUIRED");
    if (buffer.length === 0) throw enterpriseError("PDF file is empty", 400, "PDF_EMPTY");
    if (buffer.length > MAX_IMPORT_SIZE) throw enterpriseError(`PDF file exceeds ${MAX_IMPORT_SIZE} bytes`, 413, "PDF_TOO_LARGE");
    const signature = buffer.subarray(0, 5).toString("utf8");
    if (signature !== "%PDF-") throw enterpriseError("Uploaded file is not a valid PDF", 400, "INVALID_PDF_SIGNATURE");
    try {
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      if (pdf.getPageCount() < 1) throw enterpriseError("PDF has no pages", 400, "PDF_NO_PAGES");
      return { valid: true, pageCount: pdf.getPageCount() };
    } catch (error) {
      if (error.code) throw error;
      throw enterpriseError("PDF is corrupted or unreadable", 400, "PDF_CORRUPTED", [error.message]);
    }
  }

  validateMetadata(metadata = {}) {
    const errors = [];
    if (!metadata.formCode) errors.push("Unable to detect form number. Provide formType or formNumber.");
    if (!metadata.version) errors.push("Unable to determine form version or edition date.");
    if (!metadata.pageCount) errors.push("Unable to determine page count.");
    if (metadata.provider && !/^[a-z0-9_-]+$/i.test(metadata.provider)) errors.push("Provider contains unsupported characters.");
    if (errors.length) throw enterpriseError("Invalid USCIS form metadata", 400, "INVALID_FORM_METADATA", errors);
    return { valid: true };
  }

  validateFields(scanResult = {}, options = {}) {
    if (!Array.isArray(scanResult.fields)) throw enterpriseError("Field scanner did not return a field list", 422, "FIELD_SCAN_FAILED");
    if (!scanResult.fields.length && !options.allowEmpty) throw enterpriseError("No fillable PDF fields found. Import requires an official fillable USCIS PDF.", 422, "NO_FIELDS_FOUND");
    const duplicateNames = scanResult.fields
      .map((field) => field.fieldName)
      .filter((name, index, names) => name && names.indexOf(name) !== index);
    return { valid: true, requiresReview: !scanResult.fields.length, duplicateNames: [...new Set(duplicateNames)] };
  }

  async detectDuplicate({ formCode, version, checksum, fieldFingerprint }) {
    const query = {
      $or: [
        { formCode, version },
        { formCode, "importMetadata.checksum": checksum },
      ].filter((item) => Object.values(item).every(Boolean)),
    };
    if (!query.$or.length) return null;
    return USCISFormTemplate.findOne(query).sort({ updatedAt: -1 });
  }
}

module.exports = {
  FormValidationService,
  enterpriseError,
};
