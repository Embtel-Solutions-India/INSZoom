const MappingResolver = require("./MappingResolver");

class ValidationService {
  static normalizeOptions(options = []) {
    return options.map((option) => (typeof option === "object" ? option.value ?? option.label : option)).filter((option) => option !== undefined);
  }

  static getRules(field = {}) {
    return {
      ...(field.validationRules || {}),
      ...(field.validation || {}),
      required: Boolean(field.required || field.validation?.required || field.validationRules?.required),
    };
  }

  static validateField(field, value, metadata = {}) {
    const fieldId = field.fieldId || field.fieldName;
    const label = field.fieldLabel || field.label || fieldId;
    const type = field.fieldType || field.type || "text";
    const rules = this.getRules(field);
    const errors = [];
    const warnings = [];

    if (rules.required && MappingResolver.isEmpty(value)) {
      errors.push({ fieldId, code: "REQUIRED", message: `${label} is required` });
    }
    if (MappingResolver.isEmpty(value)) {
      if (!metadata.sourceField && (field.mappings?.length || field.mapping)) warnings.push({ fieldId, code: "MISSING_VALUE", message: `${label} did not resolve from mapped data` });
      return { errors, warnings };
    }

    const stringValue = String(value);
    if (rules.minLength && stringValue.length < rules.minLength) errors.push({ fieldId, code: "MIN_LENGTH", message: `${label} must be at least ${rules.minLength} characters` });
    if (rules.maxLength && stringValue.length > rules.maxLength) errors.push({ fieldId, code: "MAX_LENGTH", message: `${label} must be no more than ${rules.maxLength} characters` });
    if (rules.regex && !new RegExp(rules.regex).test(stringValue)) errors.push({ fieldId, code: "REGEX", message: `${label} format is invalid` });
    if (["date", "dob"].includes(type) || rules.date) {
      if (Number.isNaN(new Date(value).getTime())) errors.push({ fieldId, code: "DATE", message: `${label} must be a valid date` });
    }
    if (type === "number" || rules.number) {
      if (Number.isNaN(Number(value))) errors.push({ fieldId, code: "NUMBER", message: `${label} must be numeric` });
    }
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue)) errors.push({ fieldId, code: "EMAIL", message: `${label} must be a valid email` });
    if (type === "phone" && !/^[+()\-\d\s.]{7,}$/.test(stringValue)) errors.push({ fieldId, code: "PHONE", message: `${label} must be a valid phone number` });
    if (["dropdown", "radio"].includes(type) && field.options?.length) {
      const options = this.normalizeOptions(field.options);
      if (!options.includes(value)) errors.push({ fieldId, code: "OPTION", message: `${label} must match an allowed option` });
    }
    if (type === "multiselect" && field.options?.length) {
      const options = this.normalizeOptions(field.options);
      const values = Array.isArray(value) ? value : [value];
      const invalid = values.filter((item) => !options.includes(item));
      if (invalid.length) errors.push({ fieldId, code: "OPTION", message: `${label} contains unsupported selections` });
    }
    if (rules.uscisPattern && !new RegExp(rules.uscisPattern).test(stringValue)) errors.push({ fieldId, code: "USCIS_RULE", message: `${label} fails USCIS field rules` });

    return { errors, warnings };
  }

  static validateTemplateOutput(template, filledData = {}, sourceAttribution = {}) {
    const errors = [];
    const warnings = [];
    (template.formFields || []).forEach((field) => {
      const fieldId = field.fieldId || field.fieldName;
      const value = MappingResolver.resolvePath(filledData, fieldId);
      const result = this.validateField(field, value, sourceAttribution[fieldId]);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (!field.mappings?.length && !field.mapping && !field.defaultValue && !field.required) {
        warnings.push({ fieldId, code: "MISSING_MAPPING", message: `${fieldId} has no mapping metadata` });
      }
    });
    return { errors, warnings, isValid: errors.length === 0 };
  }
}

module.exports = ValidationService;
