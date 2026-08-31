const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const MappingResolver = require("./MappingResolver");
const ValidationService = require("./ValidationService");

class FormMappingService {
  static normalizeFormType(formType = "") {
    return String(formType).trim().toUpperCase();
  }

  static applyMappingGraph(template, mappingVersion) {
    if (!mappingVersion?.graph?.edges) return template;
    const mappingsByTarget = new Map();
    mappingVersion.graph.edges.forEach((edge) => {
      if (!mappingsByTarget.has(edge.targetFieldId)) mappingsByTarget.set(edge.targetFieldId, []);
      mappingsByTarget.get(edge.targetFieldId).push({
        mappingId: edge.mappingId,
        source: "canonical",
        path: edge.sourcePath,
        sourceField: edge.sourcePath,
        mappingType: edge.mappingType,
        transform: edge.transform,
        condition: edge.condition,
        repeatable: edge.repeatable,
        profileOwner: edge.profileOwner,
        allowsOccurrenceOverride: edge.allowsOccurrenceOverride === true,
        confidence: edge.confidence,
        status: edge.status,
      });
    });
    template.formFields = (template.formFields || []).map((field) => ({
      ...field,
      mappings: mappingsByTarget.get(field.fieldId || field.id || field.fieldName) || [],
    }));
    template.mappingGraph = mappingVersion.graph;
    template.mappingVersion = mappingVersion.mappingVersion;
    template.mappingVersionId = mappingVersion._id;
    return template;
  }

  static async loadMappingVersion(template, mappingVersionId) {
    if (mappingVersionId) return USCISMappingVersion.findById(mappingVersionId).lean();
    if (template.activeMappingVersionId) return USCISMappingVersion.findById(template.activeMappingVersionId).lean();
    return USCISMappingVersion.findOne({ template: template._id, status: "active" }).sort({ mappingVersion: -1 }).lean();
  }

  static async loadTemplate(formType, version) {
    const normalizedFormType = this.normalizeFormType(formType);
    const query = {
      $or: [{ formCode: normalizedFormType }, { formNumber: normalizedFormType }],
    };
    if (version) query.version = version;
    else query.status = "active";
    // -definition excludes the raw-import blob (7.36MB of a 15.10MB live
    // I-129 template) that duplicates the normalized formFields/
    // formStructure/formLayout/sections/validationRules this mapper actually
    // uses. Nothing in the mapping, render or generation path reads it - see
    // uscis-form.service.js's TEMPLATE_RENDER_EXCLUDE for the measurements.
    const template = await USCISFormTemplate.findOne(query)
      .select("-definition")
      .sort({ activeFlag: -1, editionDate: -1, effectiveDate: -1, updatedAt: -1 })
      .lean();
    if (!template) {
      const error = new Error(`USCIS form template not found for ${formType}`);
      error.status = 404;
      throw error;
    }
    const mappingVersion = await this.loadMappingVersion(template);
    return this.applyMappingGraph(template, mappingVersion);
  }

  static normalizeMappings(field = {}) {
    const mappings = [];
    if (Array.isArray(field.mappings) && field.mappings.length) mappings.push(...field.mappings);
    if (field.mapping) {
      if (field.mapping.masterDataPath) mappings.push({ source: "canonical", path: field.mapping.masterDataPath });
      if (field.mapping.canonicalPath) mappings.push({ source: "canonical", path: field.mapping.canonicalPath });
      if (field.mapping.beneficiaryField) mappings.push({ source: "beneficiary", path: field.mapping.beneficiaryField });
      if (field.mapping.caseField) mappings.push({ source: "case", path: field.mapping.caseField });
      if (field.mapping.companyField) mappings.push({ source: "company", path: field.mapping.companyField });
      if (field.mapping.questionnaireField) mappings.push({ source: "questionnaire", path: field.mapping.questionnaireField });
      if (field.mapping.ocrField) mappings.push({ source: "ocr", path: field.mapping.ocrField });
      if (field.mapping.staticValue !== undefined) mappings.push({ source: "static", staticValue: field.mapping.staticValue });
    }
    if (!mappings.length && field.defaultValue !== undefined) mappings.push({ source: "default", defaultValue: field.defaultValue });
    return mappings;
  }

  static resolveField(field, canonicalData, filledData) {
    const mappings = this.normalizeMappings(field);
    if (!mappings.length) return { value: undefined, source: "unmapped", sourceField: "", confidence: 0, warnings: [{ code: "MISSING_MAPPING", fieldId: field.fieldId || field.fieldName }] };

    const warnings = [];
    for (const mapping of mappings) {
      const result = MappingResolver.resolveMapping(mapping, canonicalData, { filledData });
      warnings.push(...result.warnings);
      if (!result.skipped && !MappingResolver.isEmpty(result.value)) return { ...result, warnings };
    }
    const fallback = MappingResolver.resolveMapping(mappings[mappings.length - 1], canonicalData, { filledData });
    return { ...fallback, warnings: [...warnings, ...fallback.warnings] };
  }

  static isFieldVisible(field, canonicalData, filledData) {
    return MappingResolver.resolveConditionalRule(field.showWhen || field.conditionalLogic, canonicalData, filledData);
  }

  static calculateCompletion(template, filledData, canonicalData = {}) {
    const visibleFields = (template.formFields || []).filter((field) => MappingResolver.resolveConditionalRule(field.showWhen || field.conditionalLogic, canonicalData, filledData));
    const totalFields = visibleFields.length;
    const requiredFields = visibleFields.filter((field) => field.required || field.validation?.required || field.validationRules?.required);
    const completedFields = visibleFields.filter((field) => !MappingResolver.isEmpty(MappingResolver.resolvePath(filledData, field.fieldId || field.fieldName))).length;
    const missingRequiredFields = requiredFields.filter((field) => MappingResolver.isEmpty(MappingResolver.resolvePath(filledData, field.fieldId || field.fieldName))).length;
    return {
      totalFields,
      completedFields,
      requiredFields: requiredFields.length,
      missingRequiredFields,
      percent: totalFields ? Math.round((completedFields / totalFields) * 100) : 0,
    };
  }

  static mapTemplate(template, canonicalData) {
    const filledData = {};
    const sourceAttribution = {};
    const fieldValues = {};
    const mappingWarnings = [];

    (template.formFields || []).forEach((field) => {
      const fieldId = field.fieldId || field.fieldName;
      if (!fieldId || !this.isFieldVisible(field, canonicalData, filledData)) return;
      const result = this.resolveField(field, canonicalData, filledData);
      if (!MappingResolver.isEmpty(result.value)) {
        MappingResolver.setPath(filledData, fieldId, result.value);
        fieldValues[fieldId] = result.value;
      }
      sourceAttribution[fieldId] = {
        value: result.value,
        source: result.source,
        sourceField: result.sourceField,
        profileOwner: result.profileOwner,
        allowsOccurrenceOverride: result.allowsOccurrenceOverride === true,
        confidence: result.confidence,
        generatedAt: new Date(),
        validationStatus: "not_validated",
      };
      mappingWarnings.push(...result.warnings.map((warning) => ({ fieldId, ...warning })));
    });

    const validation = ValidationService.validateTemplateOutput(template, filledData, sourceAttribution);
    validation.errors.forEach((error) => {
      if (sourceAttribution[error.fieldId]) sourceAttribution[error.fieldId].validationStatus = "error";
    });
    validation.warnings.forEach((warning) => {
      if (sourceAttribution[warning.fieldId] && sourceAttribution[warning.fieldId].validationStatus !== "error") sourceAttribution[warning.fieldId].validationStatus = "warning";
    });

    return {
      template,
      filledData,
      fieldValues,
      sourceAttribution,
      validation: {
        errors: validation.errors,
        warnings: [...mappingWarnings, ...validation.warnings],
        isValid: validation.errors.length === 0,
      },
      completion: this.calculateCompletion(template, filledData, canonicalData),
    };
  }
}

module.exports = FormMappingService;
