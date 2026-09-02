// Adobe-backed sibling to PDFRenderer.js's renderFiling(). Same contract,
// same inputs, same reused building blocks (PDFRenderer.loadTemplateBuffer/
// loadTemplatePdf, PDFFieldMapper.mapFields, PDFFidelityService.verify) -
// PDFRenderer.js itself is not modified. Adobe (via AdobePdfService) only
// transforms a PDF buffer given a field/value map it did not compute; it
// never decides which canonical field maps to which physical AcroForm field
// and never touches CaseForm.
//
// Field-type handling and the nested jsonFormFieldsData construction are
// carried over unchanged from the proven POC (Backend/src/scripts/
// adobeFormFillPoc.js, passing against the real Adobe API and the real
// I-129 - 980/980 field-name parity, checkbox on-value handling, mutual
// exclusion across the I-129's checkbox-based choice groups, repeated
// physical fields, special characters).
const crypto = require("crypto");
const PDFRenderer = require("./PDFRenderer");
const PDFFieldMapper = require("./PDFFieldMapper");
const AdobePdfService = require("../../pdf-services/AdobePdfService");

function classifyField(field) {
  const ctor = field.constructor?.name || "";
  if (ctor.includes("CheckBox")) return "checkbox";
  if (ctor.includes("RadioGroup")) return "radio";
  if (ctor.includes("Dropdown")) return "dropdown";
  if (ctor.includes("OptionList")) return "optionlist";
  return "text";
}

// Splits a raw LiveCycle-style AcroForm field name on "." and deep-merges it
// into the nested-JSON shape Adobe's jsonFormFieldsData requires - proven
// against the real I-129 (980/980 field-name parity) in the POC.
function setNested(root, dottedName, value) {
  const segments = dottedName.split(".");
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof node[seg] !== "object" || node[seg] === null || Array.isArray(node[seg])) node[seg] = {};
    node = node[seg];
  }
  node[segments[segments.length - 1]] = value;
}

class AdobeFormRenderer {
  // Brief section 7 - refuse to send an unverified template to Adobe at all.
  // Reuses the same artifacts.form.checksum field USCISFormImporterService
  // already populates at import time - no new checksum field.
  static async verifyTemplateChecksum(template) {
    const registeredChecksum = template.artifacts?.form?.checksum;
    if (!registeredChecksum) return { verified: false, reason: "artifacts.form.checksum is not populated for this template record" };
    const rawBuffer = await PDFRenderer.loadTemplateBuffer(template);
    const actualChecksum = crypto.createHash("sha256").update(rawBuffer).digest("hex");
    if (actualChecksum !== registeredChecksum) {
      const error = new Error(`Template checksum mismatch for ${template.formCode || template.formNumber}: computed ${actualChecksum}, registered ${registeredChecksum}. Refusing to send an unverified source PDF to Adobe.`);
      error.status = 422;
      error.code = "TEMPLATE_CHECKSUM_MISMATCH";
      throw error;
    }
    return { verified: true, checksum: actualChecksum };
  }

  static async renderFiling({ caseForm, template }) {
    const checksumResult = await this.verifyTemplateChecksum(template);

    const { PDFDocument } = PDFRenderer.loadPdfLib();
    const sourcePdf = await PDFRenderer.loadTemplatePdf(template, PDFDocument);
    const sourceForm = sourcePdf.getForm();
    const sourceFields = sourceForm.getFields();
    const sourceFieldNames = new Set(sourceFields.map((f) => f.getName()));
    const fieldByName = new Map(sourceFields.map((f) => [f.getName(), f]));

    // Same mapping call PDFRenderer.render() uses for the pdf-lib path - not
    // a second mapping system. Adobe receives exactly what pdf-lib would
    // have received for the same CaseForm/template.
    const { mappedFields, missingMappings } = PDFFieldMapper.mapFields(caseForm, template);

    const jsonFormFieldsData = {};
    const skippedFields = [];
    const includedFields = [];
    const unmappedPdfFields = [];
    const failedFieldWrites = [];

    Object.values(mappedFields).forEach((mapped) => {
      const field = fieldByName.get(mapped.pdfField);
      if (!field) {
        unmappedPdfFields.push(mapped.pdfField);
        return;
      }
      const kind = classifyField(field);
      if (kind === "text") {
        setNested(jsonFormFieldsData, mapped.pdfField, String(mapped.value));
        includedFields.push(mapped.pdfField);
        return;
      }
      if (kind === "checkbox") {
        // Never a blind boolean/string conversion. Only send a value when
        // truthy, translated to the field's real on-value name (proven in
        // the POC: pdf-lib's PDFAcroCheckBox.getOnValue() - singular,
        // getOnValues() does not exist on this class - then decodeText(),
        // since a checkbox's real on-value is itself a PDF name that can be
        // escaped, e.g. "STE" is literally encoded as "#20STE#20"). A falsy
        // mapped value is omitted entirely - sending an explicit "Off" was
        // never verified against Adobe and is not assumed to behave the
        // same as omission.
        if (!mapped.value) return;
        let onValue;
        try {
          onValue = field.acroField.getOnValue()?.decodeText();
        } catch (error) {
          failedFieldWrites.push({ pdfField: mapped.pdfField, caseField: mapped.caseField, message: `could not resolve checkbox on-value: ${error.message}` });
          return;
        }
        if (!onValue) {
          failedFieldWrites.push({ pdfField: mapped.pdfField, caseField: mapped.caseField, message: "checkbox has no resolvable on-value" });
          return;
        }
        setNested(jsonFormFieldsData, mapped.pdfField, onValue);
        includedFields.push(mapped.pdfField);
        return;
      }
      // Dropdown/OptionList/radio (this template has 0 radio groups, but
      // handled the same way for any future template that does): not yet
      // verified against Adobe's setformdata - excluded rather than
      // guessed at, per the explicit decision for this phase. Left at
      // whatever the template's own default state already is.
      skippedFields.push({ pdfField: mapped.pdfField, caseField: mapped.caseField, type: kind, reason: "not yet verified against Adobe setformdata for this field type" });
    });

    const uploadBuffer = Buffer.from(await sourcePdf.save());
    const buffer = await AdobePdfService.fillPdf(uploadBuffer, jsonFormFieldsData);

    const PDFFidelityService = require("./PDFFidelityService");
    const fidelityResult = await PDFFidelityService.verify(buffer, caseForm, template);
    if (!fidelityResult.valid) {
      const error = new Error(`PDF fidelity check failed: ${fidelityResult.errors.join("; ")}`);
      error.status = 422;
      error.code = "PDF_FIDELITY_FAILURE";
      error.report = fidelityResult.report;
      throw error;
    }

    return {
      buffer,
      renderReport: {
        engine: "adobe",
        mappedFieldCount: includedFields.length,
        missingMappings,
        unmappedPdfFields,
        failedFieldWrites,
        skippedFields,
        sourceFieldCount: sourceFieldNames.size,
        checksumVerified: checksumResult.verified,
        flattened: false,
        watermark: null,
      },
      fidelityReport: fidelityResult.report,
    };
  }
}

module.exports = AdobeFormRenderer;
