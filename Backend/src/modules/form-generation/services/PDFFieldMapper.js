const MappingResolver = require("../../form-mapping/services/MappingResolver");
const { isProtectedField } = require("./ProtectedFieldPolicy");

class PDFFieldMapper {
  static normalizeTemplateMappings(template = {}) {
    const templateMappings = Array.isArray(template.pdfFieldMappings) ? template.pdfFieldMappings : [];
    const fieldMappings = (template.formFields || []).flatMap((field) => {
      const fieldId = field.fieldId || field.fieldName;
      const directPdfField = field.pdfField || field.pdfFieldName || field.pdfMapping?.pdfField;
      // templateField carries the full scanned field record through to
      // mapFields()'s protected-field check below (uscisUseOnly/pdfFieldType) -
      // the richest signal available, since this is where the original
      // template.formFields entry is still in scope.
      const mappingPdfFields = (field.mappings || []).filter((mapping) => mapping.pdfField).map((mapping) => ({
        caseField: fieldId,
        pdfField: mapping.pdfField,
        type: field.fieldType || field.type,
        valueMap: mapping.valueMap,
        condition: field.showWhen || field.conditionalLogic || mapping.condition,
        templateField: field,
      }));
      if (directPdfField) {
        mappingPdfFields.unshift({
          caseField: fieldId,
          pdfField: directPdfField,
          type: field.fieldType || field.type,
          valueMap: field.pdfMapping?.valueMap,
          condition: field.showWhen || field.conditionalLogic,
          templateField: field,
        });
      }
      return mappingPdfFields;
    });
    return [...templateMappings, ...fieldMappings].filter((mapping) => mapping.caseField && mapping.pdfField);
  }

  static mapValue(mapping, value) {
    if (value === undefined || value === null) return value;
    if (mapping.valueMap && Object.prototype.hasOwnProperty.call(mapping.valueMap, value)) return mapping.valueMap[value];
    if (mapping.type === "date" && mapping.format) return MappingResolver.formatDate(value, mapping.format);
    if (mapping.type === "checkbox" && typeof value === "boolean") return value ? mapping.checkedValue || true : mapping.uncheckedValue || false;
    return value;
  }

  // true when a person typed a real (non-empty) value into this box - recorded in CaseForm.manualOverrides
  static hasStaffValue(caseForm, caseField) {
    try {
      let overrides = caseForm?.manualOverrides;
      if (!overrides) return false;
      if (typeof overrides.toObject === "function") overrides = overrides.toObject();
      if (overrides instanceof Map) overrides = Object.fromEntries(overrides);
      const meta = overrides[caseField] || MappingResolver.resolvePath(overrides, caseField);
      const value = meta && typeof meta === "object" ? meta.value : undefined;
      return value !== undefined && value !== null && value !== false && String(value).trim() !== "" && String(value).trim().toLowerCase() !== "false";
    } catch (_error) {
      return false;
    }
  }

  static mapFields(caseForm, template) {
    const filledData = caseForm.filledData || {};
    const mappedFields = {};
    const missingMappings = [];
    const skippedFields = [];
    const protectedFields = [];
    const collisions = [];

    this.normalizeTemplateMappings(template).forEach((mapping) => {
      // Protected fields (USCIS-internal barcodes, signature fields) must
      // never enter mappedFields at all - this is the first line of defense
      // (see ProtectedFieldPolicy.js for the full root-cause explanation and
      // signal priority). Checked before condition/value resolution so a
      // protected field is never even evaluated as a mapping candidate.
      if (isProtectedField(mapping.pdfField, template.formCode, mapping.templateField)) {
        // the saved value is carried along (read-only) so a value saved for a protected box is shown on the recovery page instead of being silently dropped
        protectedFields.push({ pdfField: mapping.pdfField, caseField: mapping.caseField, fieldType: mapping.type, reason: "protected field — never auto-populated", value: MappingResolver.resolvePath(filledData, mapping.caseField) });
        return;
      }
      // A value a PERSON typed in this box (a real manual override) is always written: the form's own "only if ..." rule never keeps staff-entered data out of the file.
      // (An auto-filled value still follows the rule; if the rule holds it back it is listed on the recovery page - FormDataGuard.)
      if (mapping.condition && !this.hasStaffValue(caseForm, mapping.caseField) && !MappingResolver.resolveConditionalRule(mapping.condition, { caseForm, filledData }, filledData)) {
        // the saved value is carried along (read-only) so the download's data-completeness check can show an answer the form's own rule kept out
        skippedFields.push({ caseField: mapping.caseField, pdfField: mapping.pdfField, reason: "condition_not_met", value: MappingResolver.resolvePath(filledData, mapping.caseField) });
        return;
      }
      const value = MappingResolver.resolvePath(filledData, mapping.caseField);
      if (MappingResolver.isEmpty(value)) {
        missingMappings.push({ caseField: mapping.caseField, pdfField: mapping.pdfField, reason: "missing_value" });
        return;
      }
      const mappedValue = this.mapValue(mapping, value);
      // Two answers mapped to one PDF box: the later one still wins (unchanged behaviour), but the replaced answer is recorded so it is never silently lost.
      const previous = mappedFields[mapping.pdfField];
      if (previous && previous.caseField !== mapping.caseField && String(previous.value) !== String(mappedValue)) {
        collisions.push({ pdfField: mapping.pdfField, keptCaseField: mapping.caseField, lostCaseField: previous.caseField, lostValue: previous.value });
      }
      mappedFields[mapping.pdfField] = {
        value: mappedValue,
        caseField: mapping.caseField,
        pdfField: mapping.pdfField,
        type: mapping.type || "text",
      };
    });

    return { mappedFields, missingMappings, skippedFields, protectedFields, collisions };
  }
}

module.exports = PDFFieldMapper;
