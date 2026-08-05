const PDFFieldMapper = require("./PDFFieldMapper");
const MappingResolver = require("../../form-mapping/services/MappingResolver");

class PDFValidationService {
  static addIssue(collection, severity, code, message, details = {}) {
    collection.push({ severity, code, message, ...details });
  }

  static value(caseForm, fieldId) {
    return MappingResolver.resolvePath(caseForm.filledData || caseForm.fieldValues || {}, fieldId);
  }

  static configuredRules(template = {}) {
    return {
      ...(template.validationRules || {}),
      ...(template.validationConfiguration || {}),
    };
  }

  // Format checks run against field.fieldType/semanticType/rules.date etc,
  // which are auto-inferred at H0 import/scan time from the field's own
  // name and PDF-widget context - confirmed empirically (against the real
  // I-129 template) to sometimes mis-tag a field (e.g. "CountryOfBirth",
  // "Line8d_CityTown" both mis-tagged fieldType:"date"/semanticType:"date").
  // A required field failing its format check is very likely a genuine
  // data problem worth blocking generation over; a NON-required field is
  // just as likely a scanner mis-tag as a real error, so those go to
  // warnings (visible for review) instead of hard-blocking - never
  // silently dropped either way.
  static validateFormat(field, value, rules, errors, warnings) {
    const fieldId = field.fieldId || field.fieldName;
    const label = field.label || field.fieldLabel || fieldId;
    const fieldType = field.type || field.fieldType || "";
    const normalizedName = String(`${fieldId} ${label}`).toLowerCase();
    const isRequired = Boolean(field.required || rules.required);
    const target = isRequired ? errors : warnings;
    const severity = isRequired ? "error" : "warning";
    if (MappingResolver.isEmpty(value)) return;
    if (rules.maxLength && String(value).length > Number(rules.maxLength)) this.addIssue(target, severity, "FIELD_TOO_LONG", `${label} exceeds ${rules.maxLength} characters`, { fieldId });
    if (rules.minLength && String(value).length < Number(rules.minLength)) this.addIssue(target, severity, "FIELD_TOO_SHORT", `${label} must be at least ${rules.minLength} characters`, { fieldId });
    if ((fieldType === "date" || rules.date || normalizedName.includes("date")) && Number.isNaN(new Date(value).getTime())) this.addIssue(target, severity, "INVALID_DATE", `${label} must be a valid date`, { fieldId });
    if ((fieldType === "email" || rules.email || normalizedName.includes("email")) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) this.addIssue(target, severity, "INVALID_EMAIL", `${label} must be a valid email address`, { fieldId });
    if ((fieldType === "phone" || rules.phone || normalizedName.includes("phone")) && !/^[0-9+().\-\s]{7,25}$/.test(String(value))) this.addIssue(target, severity, "INVALID_PHONE", `${label} must be a valid phone number`, { fieldId });
    if ((rules.zip || normalizedName.includes("zip")) && !/^\d{5}(-\d{4})?$/.test(String(value))) this.addIssue(target, severity, "INVALID_ZIP", `${label} must be a valid ZIP code`, { fieldId });
    if ((rules.passport || normalizedName.includes("passport")) && !/^[a-z0-9-]{5,20}$/i.test(String(value))) this.addIssue(target, severity, "INVALID_PASSPORT", `${label} must be a valid passport number`, { fieldId });
    if ((rules.alienNumber || normalizedName.includes("alien") || normalizedName.includes("a-number")) && !/^A?\d{7,9}$/i.test(String(value).replace(/\s+/g, ""))) this.addIssue(target, severity, "INVALID_ALIEN_NUMBER", `${label} must be a valid Alien Number`, { fieldId });
    if ((rules.receiptNumber || normalizedName.includes("receipt")) && !/^(EAC|WAC|LIN|SRC|NBC|MSC|IOE|YSC)\d{10}$/i.test(String(value).replace(/[-\s]/g, ""))) this.addIssue(warnings, "warning", "INVALID_RECEIPT_NUMBER", `${label} does not look like a standard USCIS receipt number`, { fieldId });
    if (rules.regex && !new RegExp(rules.regex).test(String(value))) this.addIssue(target, severity, "INVALID_FORMAT", rules.message || `${label} format is invalid`, { fieldId });
  }

  static validateSelections(field, value, errors, warnings) {
    const fieldId = field.fieldId || field.fieldName;
    const label = field.label || field.fieldLabel || fieldId;
    const options = (field.options || []).map((option) => String(option.value ?? option.exportValue ?? option));
    if (!options.length || MappingResolver.isEmpty(value)) return;
    const isRequired = Boolean(field.required);
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      if (!options.includes(String(item))) this.addIssue(isRequired ? errors : warnings, isRequired ? "error" : "warning", "UNSUPPORTED_SELECTION", `${label} contains an unsupported selection`, { fieldId, value: item });
    });
  }

  static validateCrossFieldRules(caseForm, rules = {}, errors, warnings, information) {
    for (const rule of rules.crossFieldRules || []) {
      const left = MappingResolver.resolvePath(caseForm.filledData || caseForm.fieldValues || {}, rule.field);
      const right = rule.compareTo ? MappingResolver.resolvePath(caseForm.filledData || caseForm.fieldValues || {}, rule.compareTo) : rule.value;
      const severity = rule.severity || "error";
      let failed = false;
      if (rule.operator === "equals") failed = left !== right;
      else if (rule.operator === "not_equals") failed = left === right;
      else if (rule.operator === "required_when") failed = right === rule.whenValue && MappingResolver.isEmpty(left);
      else if (rule.operator === "before") failed = new Date(left).getTime() >= new Date(right).getTime();
      else if (rule.operator === "after") failed = new Date(left).getTime() <= new Date(right).getTime();
      if (!failed) continue;
      const target = severity === "warning" ? warnings : severity === "information" ? information : errors;
      this.addIssue(target, severity, rule.code || "CROSS_FIELD_VALIDATION_FAILED", rule.message || "Cross-field validation failed", { fieldId: rule.field, compareTo: rule.compareTo });
    }
  }

  static validateDuplicateRules(caseForm, rules = {}, warnings) {
    for (const group of rules.duplicateGroups || []) {
      const values = (group.fields || []).map((fieldId) => ({ fieldId, value: MappingResolver.resolvePath(caseForm.filledData || caseForm.fieldValues || {}, fieldId) })).filter((item) => !MappingResolver.isEmpty(item.value));
      const seen = new Map();
      values.forEach((item) => {
        const key = String(item.value).trim().toLowerCase();
        if (seen.has(key)) this.addIssue(warnings, "warning", "DUPLICATE_VALUE", group.message || "Duplicate value detected", { fieldId: item.fieldId, duplicateOf: seen.get(key) });
        else seen.set(key, item.fieldId);
      });
    }
  }

  static validateAttachments(rules = {}, documents = [], errors, warnings) {
    for (const required of rules.requiredAttachments || []) {
      const types = Array.isArray(required) ? required : [required.documentType || required.category || required.type || required];
      const found = documents.some((document) => types.includes(document.documentType) || types.includes(document.category) || types.includes(document.documentCategory));
      if (!found) {
        const severity = required.severity || "error";
        const target = severity === "warning" ? warnings : errors;
        this.addIssue(target, severity, "REQUIRED_ATTACHMENT_MISSING", required.message || `Required attachment missing: ${types.join(", ")}`, { documentTypes: types });
      }
    }
  }

  static validate(caseForm, template, options = {}) {
    const errors = [];
    const warnings = [];
    const information = [];
    if (!template?.pdfTemplatePath && !template?.localPdfPath && !template?.pdfStorageKey) {
      this.addIssue(errors, "error", "PDF_TEMPLATE_MISSING", "USCIS PDF template is not configured");
    }

    const fieldMappings = PDFFieldMapper.normalizeTemplateMappings(template);
    if (!fieldMappings.length) this.addIssue(errors, "error", "PDF_MAPPINGS_MISSING", "No PDF field mappings are configured for this form template");

    const mapped = PDFFieldMapper.mapFields(caseForm, template);
    mapped.missingMappings.forEach((item) => this.addIssue(warnings, "warning", "PDF_FIELD_VALUE_MISSING", "Mapped PDF field has no source value", item));
    const rulesConfig = this.configuredRules(template);
    if (caseForm.syncState?.stale || caseForm.syncState?.requiresRegeneration) this.addIssue(warnings, "warning", "FORM_OUT_OF_DATE", "Canonical case data changed after this form was generated or reviewed", { affectedFields: caseForm.syncState?.affectedFields || caseForm.syncState?.changedFields || [] });

    (template.formFields || []).forEach((field) => {
      const fieldId = field.fieldId || field.fieldName;
      const label = field.label || field.fieldLabel || fieldId;
      const value = this.value(caseForm, fieldId);
      const rules = { ...(field.validationRules || {}), ...(field.validation || {}) };
      const pdfMapped = fieldMappings.some((mapping) => mapping.caseField === fieldId);
      if ((field.required || rules.required) && MappingResolver.isEmpty(value)) this.addIssue(errors, "error", "REQUIRED_FIELD_MISSING", `${label} is required before PDF generation`, { fieldId });
      if ((field.required || rules.required) && !pdfMapped) this.addIssue(errors, "error", "REQUIRED_PDF_MAPPING_MISSING", `${label} has no PDF field mapping`, { fieldId });
      // A physical wet/e-signature genuinely can't exist before the human
      // filing act - it must never block generating a DRAFT copy for
      // case-manager/attorney review (options.draft, set by
      // PDFGenerationService based on the same status check it already
      // uses to pick the "ATTORNEY REVIEW" vs "FINAL" watermark). Only the
      // final, post-lock generation treats a missing signature as blocking.
      if (field.semanticType === "signature" || field.fieldType === "signature" || rules.signatureRequired) {
        if (MappingResolver.isEmpty(value)) {
          if (options.draft) this.addIssue(warnings, "warning", "SIGNATURE_MISSING", `${label} signature will be required before finalization`, { fieldId });
          else this.addIssue(errors, "error", "SIGNATURE_MISSING", `${label} signature is required before finalization`, { fieldId });
        }
      }
      this.validateFormat(field, value, rules, errors, warnings);
      this.validateSelections(field, value, errors, warnings);
    });

    (rulesConfig.mandatorySections || []).forEach((section) => {
      const sectionKey = section.sectionKey || section.key || section;
      const progress = caseForm.sectionProgress?.[sectionKey] || {};
      if (progress.missingRequiredFields > 0) this.addIssue(errors, "error", "MANDATORY_SECTION_INCOMPLETE", section.message || `${sectionKey} has missing required USCIS fields`, { sectionKey });
      if (progress.totalFields && progress.completedFields === 0) this.addIssue(warnings, "warning", "MANDATORY_SECTION_EMPTY", section.message || `${sectionKey} appears empty`, { sectionKey });
    });
    this.validateCrossFieldRules(caseForm, rulesConfig, errors, warnings, information);
    this.validateDuplicateRules(caseForm, rulesConfig, warnings);
    this.validateAttachments(rulesConfig, options.documents || [], errors, warnings);
    return {
      valid: errors.length === 0,
      status: errors.length ? "blocked" : warnings.length ? "review_recommended" : "valid",
      errors,
      warnings,
      information,
      categories: { errors: errors.length, warnings: warnings.length, information: information.length },
      blockingErrorCount: errors.length,
      issueCount: errors.length + warnings.length + information.length,
      mappedFieldCount: Object.keys(mapped.mappedFields).length,
      missingMappedFieldCount: mapped.missingMappings.length,
      generatedAt: new Date(),
    };
  }
}

module.exports = PDFValidationService;
