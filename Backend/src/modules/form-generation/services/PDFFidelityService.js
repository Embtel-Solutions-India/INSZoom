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
    // A FORM_COMPONENT CaseForm's generated PDF is a deliberate page-range
    // SLICE of its parent template (see ComponentPageResolver) - its real
    // expected PAGE count is the component's own resolved page range, never
    // the parent template's full pdfMetadata.pageCount. Resolved fresh here
    // (rather than trusting the caller) so fidelity verification
    // independently confirms the slice matches the component's own
    // metadata, not just that render() ran without error.
    //
    // Field COUNT is deliberately NOT re-scoped to the component's own
    // fieldIds, even though that sounds symmetric with the page-count fix -
    // confirmed empirically that pdf-lib's removePage() does not prune the
    // AcroForm's field definitions for fields whose only widget lived on a
    // removed page (they become invisible/inert, not deleted), so
    // form.getFields().length on a sliced component PDF still reports
    // essentially the FULL parent's field count (~942 for an 8-page H
    // slice out of 38 pages, not ~167). Comparing against the component's
    // own small fieldIds count would make this check always fail on a
    // correctly-sliced PDF - template.formFields.length remains correct
    // for both independent forms and components.
    // Bounds-check against the PARENT's original page count
    // (template.pdfMetadata.pageCount), never the already-sliced buffer's
    // own pageCount - by this point `buffer`/`pdf` IS the sliced output
    // (this verify() runs on the final bytes, after ComponentPageResolver
    // already removed the other pages), so re-validating a range like
    // 13-20 against an already-8-page-sliced document would wrongly reject
    // its own correct output as "page 20 doesn't exist." Applies to both a
    // component (its own pageRanges) and a core form (Phase 2 add-on: its
    // pages minus every active sibling component's pages) - both are now
    // deliberately sliced, not just components.
    const ComponentPageResolver = require("./ComponentPageResolver");
    const parentTotalPages = template.pdfMetadata?.pageCount || pageCount;
    let expectedPageCount;
    let pageCountBasis;
    // AdobeFormRenderer.js's Adobe-native slicing (combinepdf) now correctly
    // rebuilds the AcroForm's /Fields index to exactly the widgets that
    // survive on the kept pages (see AcroFormRepairGuard.js) - this
    // superseded the OLD pdf-lib removePage() behavior the comment below
    // used to describe, where a sliced document's field COUNT stayed at
    // essentially the full parent's ~942, since removePage() never pruned
    // orphaned AcroForm field definitions. Confirmed empirically against the
    // real I-129 H Classification Supplement: a correctly-sliced 8-page
    // component now has exactly 159 real fields, not ~942 - comparing that
    // against ±10% of the full template's ~980 fields would reject every
    // correctly-sliced component/core PDF as a false "mismatch". The
    // expected count must be scoped to the SAME page set the PDF was
    // actually sliced to, for both a component (its own fieldIds, already
    // computed by findActiveComponentDefinition/discovery) and a core form
    // (fields whose own pageNumber falls in the core's resolved page list).
    let expectedFieldCount;
    if (caseForm?.componentCode) {
      const componentDef = await ComponentPageResolver.findActiveComponentDefinition(caseForm, template);
      const context = { parentFormCode: caseForm.parentFormCode || template.formCode, componentCode: caseForm.componentCode };
      expectedPageCount = ComponentPageResolver.expandPageRanges(componentDef.pageRanges, parentTotalPages, context).length;
      pageCountBasis = "from the component's resolved page range";
      expectedFieldCount = (componentDef.fieldIds || []).length;
    } else {
      const corePages = await ComponentPageResolver.resolveCorePages(template, parentTotalPages);
      expectedPageCount = corePages ? corePages.length : template.pdfMetadata?.pageCount;
      pageCountBasis = corePages ? "from the core form's resolved page range (excluding active sibling components)" : "from template.pdfMetadata.pageCount";
      expectedFieldCount = corePages
        ? (template.formFields || []).filter((f) => f.pageNumber != null && corePages.includes(f.pageNumber)).length
        : (template.formFields || []).length;
    }
    if (expectedPageCount && pageCount !== expectedPageCount) {
      errors.push(`Page count mismatch: expected ${expectedPageCount} (${pageCountBasis}), got ${pageCount}`);
    }

    const form = pdf.getForm();
    const fieldCount = form.getFields().length;
    if (fieldCount === 0) {
      errors.push("Generated PDF has 0 AcroForm fields - refusing to treat this as a valid filled form");
    }
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
