// Phase 5 (§G) - verifies that a GENERATED PDF's actual bytes reflect the CaseForm's field
// values. Deliberately separate from PDFValidationService, which validates the CaseForm's INPUT
// data (required fields, types, maxLength) before rendering - this service reads the rendered
// OUTPUT bytes back and checks them against that same input, closing the gap ARCHITECTURE.md's own
// guardrail names: "Do not claim PDF correctness from JSON responses."
class PDFFidelityService {
  static loadPdfLib() {
    try {
      return require("pdf-lib");
    } catch (error) {
      const missing = new Error("pdf-lib dependency is required for PDF fidelity verification");
      missing.status = 501;
      throw missing;
    }
  }

  // caseForm.fieldValues is a FLAT map keyed by each field's `fieldId` (per AutoFillService's own
  // header comment: "fieldId is very often a raw AcroForm name... but is a distinct namespace from
  // fieldName"), NOT by the PDF's own field NAME - the two happen to be equal for most fields but
  // are not guaranteed to be, so this reads through template.formFields (which carries both) rather
  // than assuming caseForm.fieldValues' own keys are ready-to-use pdfField names.
  static sampleFieldNames(caseForm, template, limit = 20) {
    const fieldValues = caseForm.fieldValues?.toObject?.() || caseForm.fieldValues || {};
    const sampled = [];
    for (const field of template.formFields || []) {
      if (sampled.length >= limit) break;
      if (field.semanticType === "signature") continue;
      if (field.pdfFieldType !== "text") continue;
      const fieldId = field.fieldId || field.fieldName;
      const rawValue = fieldValues[fieldId];
      if (rawValue === undefined || rawValue === null || rawValue === "") continue;
      sampled.push({ fieldName: field.fieldName, expected: String(rawValue) });
    }
    return sampled;
  }

  /**
   * Verifies that a generated PDF buffer correctly reflects CaseForm field values.
   * Does NOT call PDFValidationService (that validates input data, not output bytes).
   *
   * @param {Buffer} buffer - The generated PDF bytes
   * @param {object} caseForm - The CaseForm document (with fieldValues/filledData)
   * @param {object} template - The USCISFormTemplate (with formFields, pdfMetadata)
   * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[], report: object }>}
   */
  static async verify(buffer, caseForm, template) {
    const errors = [];
    const warnings = [];

    if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      errors.push("Not a PDF: buffer does not start with the %PDF- magic bytes");
      return { valid: false, errors, warnings, report: { verifiedAt: new Date().toISOString() } };
    }

    const { PDFDocument } = this.loadPdfLib();
    let pdf;
    try {
      pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    } catch (error) {
      errors.push(`Not a PDF: pdf-lib failed to load the buffer (${error.message})`);
      return { valid: false, errors, warnings, report: { verifiedAt: new Date().toISOString() } };
    }

    const pageCount = pdf.getPageCount();
    const expectedPageCount = template.pdfMetadata?.pageCount;
    if (expectedPageCount && pageCount !== expectedPageCount) {
      errors.push(`Page count mismatch: expected ${expectedPageCount} (from template.pdfMetadata.pageCount), got ${pageCount}`);
    }

    const form = pdf.getForm();
    const fieldCount = form.getFields().length;
    if (fieldCount === 0) {
      errors.push("Generated PDF has 0 AcroForm fields - refusing to treat this as a valid filled form");
    }
    const expectedFieldCount = (template.formFields || []).length;
    if (expectedFieldCount > 0 && fieldCount > 0) {
      const ratio = fieldCount / expectedFieldCount;
      if (ratio < 0.9 || ratio > 1.1) {
        errors.push(`Field count mismatch: expected ~${expectedFieldCount} (±10%) from template.formFields, got ${fieldCount}`);
      }
    }

    const sampledFields = this.sampleFieldNames(caseForm, template);
    let matchedFields = 0;
    const mismatchedFields = [];
    for (const { fieldName, expected } of sampledFields) {
      let pdfField;
      try {
        pdfField = form.getTextField(fieldName);
      } catch (error) {
        pdfField = null;
      }
      if (!pdfField) {
        warnings.push(`field not found in generated PDF: ${fieldName}`);
        continue;
      }
      let actual;
      try {
        actual = pdfField.getText() || "";
      } catch (error) {
        warnings.push(`field ${fieldName}: could not read embedded value (${error.message})`);
        continue;
      }
      if (actual !== expected) {
        errors.push(`field ${fieldName}: expected '${expected}', got '${actual}'`);
        mismatchedFields.push({ fieldName, expected, actual });
      } else {
        matchedFields += 1;
      }
    }

    const report = {
      pageCount,
      fieldCount,
      sampledFields: sampledFields.length,
      matchedFields,
      mismatchedFields,
      verifiedAt: new Date().toISOString(),
    };

    return { valid: errors.length === 0, errors, warnings, report };
  }
}

module.exports = PDFFidelityService;
