const MappingResolver = require("../../form-mapping/services/MappingResolver");

class PDFFieldMapper {
  static normalizeTemplateMappings(template = {}) {
    const templateMappings = Array.isArray(template.pdfFieldMappings) ? template.pdfFieldMappings : [];
    const fieldMappings = (template.formFields || []).flatMap((field) => {
      const fieldId = field.fieldId || field.fieldName;
      const directPdfField = field.pdfField || field.pdfFieldName || field.pdfMapping?.pdfField;
      const mappingPdfFields = (field.mappings || []).filter((mapping) => mapping.pdfField).map((mapping) => ({
        caseField: fieldId,
        pdfField: mapping.pdfField,
        type: field.fieldType || field.type,
        valueMap: mapping.valueMap,
        condition: field.showWhen || field.conditionalLogic || mapping.condition,
      }));
      if (directPdfField) {
        mappingPdfFields.unshift({
          caseField: fieldId,
          pdfField: directPdfField,
          type: field.fieldType || field.type,
          valueMap: field.pdfMapping?.valueMap,
          condition: field.showWhen || field.conditionalLogic,
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

  static mapFields(caseForm, template) {
    const filledData = caseForm.filledData || {};
    const mappedFields = {};
    const missingMappings = [];
    const skippedFields = [];

    this.normalizeTemplateMappings(template).forEach((mapping) => {
      if (mapping.condition && !MappingResolver.resolveConditionalRule(mapping.condition, { caseForm, filledData }, filledData)) {
        skippedFields.push({ caseField: mapping.caseField, pdfField: mapping.pdfField, reason: "condition_not_met" });
        return;
      }
      const value = MappingResolver.resolvePath(filledData, mapping.caseField);
      if (MappingResolver.isEmpty(value)) {
        missingMappings.push({ caseField: mapping.caseField, pdfField: mapping.pdfField, reason: "missing_value" });
        return;
      }
      mappedFields[mapping.pdfField] = {
        value: this.mapValue(mapping, value),
        caseField: mapping.caseField,
        pdfField: mapping.pdfField,
        type: mapping.type || "text",
      };
    });

    return { mappedFields, missingMappings, skippedFields };
  }
}

module.exports = PDFFieldMapper;
