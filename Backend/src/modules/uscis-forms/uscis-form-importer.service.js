const crypto = require("crypto");
const AuditLog = require("../../models/AuditLog");
const USCISFormTemplate = require("../../models/USCISFormTemplate");

const SUPPORTED_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "date",
  "number",
  "email",
  "phone",
  "dropdown",
  "select",
  "radio",
  "checkbox",
  "multiselect",
  "multi_select",
  "address",
  "table",
  "repeatable_group",
  "repeatable group",
]);

const MAPPING_SOURCES = new Set(["beneficiary", "petitioner", "company", "questionnaire", "case", "ocr", "client", "static"]);

function checksumFor(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function normalizeFormNumber(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeFieldType(type) {
  const normalized = String(type || "text").trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "dropdown") return "select";
  if (normalized === "multi_select") return "multiselect";
  if (normalized === "repeatable_group") return "repeatable_group";
  return normalized;
}

function normalizeSection(section = {}, index = 0) {
  const sectionId = section.sectionId || section.key || `section_${index + 1}`;
  return {
    sectionId,
    key: section.key || sectionId,
    title: section.title || sectionId,
    description: section.description,
    order: section.order ?? index,
    repeatable: Boolean(section.repeatable),
    repeatableConfig: section.repeatableConfig || section.repeat || {},
    parentKey: section.parentKey,
    conditionalLogic: section.conditionalLogic || section.showWhen,
    showWhen: section.showWhen || section.conditionalLogic,
  };
}

function normalizeMappings(field = {}) {
  const mappings = Array.isArray(field.mappings) ? field.mappings : [];
  const legacy = field.mapping || {};
  const normalized = mappings.map((mapping) => ({
    source: mapping.source || Object.keys(mapping).find((key) => MAPPING_SOURCES.has(key)),
    path: mapping.path || mapping.sourceField || mapping.field || mapping.value,
    transform: mapping.transform,
    fallback: mapping.fallback,
    priority: mapping.priority ?? 0,
  })).filter((mapping) => mapping.source);

  [
    ["beneficiary", legacy.beneficiaryField || legacy.beneficiary],
    ["case", legacy.caseField || legacy.case],
    ["company", legacy.companyField || legacy.company || legacy.petitioner],
    ["client", legacy.clientField || legacy.client],
    ["questionnaire", legacy.questionnaireField || legacy.questionnaire],
    ["ocr", legacy.ocrField || legacy.ocr],
    ["static", legacy.staticValue],
  ].forEach(([source, path]) => {
    if (path !== undefined && path !== null && path !== "") normalized.push({ source, path, priority: normalized.length });
  });

  return normalized;
}

function legacyMappingFromMappings(mappings = []) {
  return mappings.reduce((legacy, mapping) => {
    if (mapping.source === "beneficiary") legacy.beneficiaryField = mapping.path;
    if (mapping.source === "case") legacy.caseField = mapping.path;
    if (mapping.source === "company" || mapping.source === "petitioner") legacy.companyField = mapping.path;
    if (mapping.source === "client") legacy.clientField = mapping.path;
    if (mapping.source === "questionnaire") legacy.questionnaireField = mapping.path;
    if (mapping.source === "ocr") legacy.ocrField = mapping.path;
    if (mapping.source === "static") legacy.staticValue = mapping.path;
    return legacy;
  }, {});
}

function normalizeField(field = {}, index = 0) {
  const fieldId = field.fieldId || field.fieldName || field.name || field.key || `field_${index + 1}`;
  const sectionId = field.sectionId || field.sectionKey || "general";
  const fieldType = normalizeFieldType(field.type || field.fieldType);
  const mappings = normalizeMappings(field);
  const validation = field.validation || field.validationRules || {};
  return {
    fieldId,
    fieldName: field.fieldName || fieldId,
    fieldType,
    type: fieldType,
    fieldLabel: field.label || field.fieldLabel || fieldId,
    label: field.label || field.fieldLabel || fieldId,
    sectionId,
    sectionKey: field.sectionKey || sectionId,
    sectionTitle: field.sectionTitle,
    order: field.order ?? index,
    required: Boolean(field.required || validation.required),
    defaultValue: field.defaultValue,
    options: field.options || [],
    repeatable: Boolean(field.repeatable || fieldType === "repeatable_group"),
    repeatableConfig: field.repeatableConfig || {},
    helpText: field.helpText,
    placeholder: field.placeholder,
    validation,
    validationRules: validation,
    conditionalLogic: field.conditionalLogic || field.showWhen,
    showWhen: field.showWhen || field.conditionalLogic,
    mappings,
    mapping: legacyMappingFromMappings(mappings),
    pageNumber: field.pageNumber,
    coordinates: field.coordinates,
  };
}

function definitionPayload(definition = {}) {
  const metadata = definition.metadata || definition.formMetadata || definition;
  const formNumber = normalizeFormNumber(metadata.formNumber || metadata.formCode);
  const version = String(metadata.version || metadata.edition || metadata.editionDate || "").trim();
  const sections = (definition.sections || []).map(normalizeSection);
  const sectionIds = new Set(sections.map((section) => section.sectionId));
  const fields = (definition.fields || definition.formFields || []).map((field, index) => normalizeField(field, index));
  if (!sections.length && fields.length) {
    [...new Set(fields.map((field) => field.sectionId || "general"))].forEach((sectionId, index) => {
      sections.push(normalizeSection({ sectionId, title: sectionId }, index));
      sectionIds.add(sectionId);
    });
  }
  return {
    formCode: formNumber,
    formNumber,
    formName: metadata.formName || metadata.title || metadata.name,
    title: metadata.formName || metadata.title || metadata.name || formNumber,
    description: metadata.description,
    visaCategory: metadata.visaCategory,
    visaTypes: metadata.visaTypes || metadata.visaType ? [].concat(metadata.visaTypes || metadata.visaType).filter(Boolean) : [],
    editionDate: metadata.editionDate,
    effectiveDate: metadata.effectiveDate,
    officialPdfUrl: metadata.officialPdfUrl,
    localPdfPath: metadata.localPdfPath,
    version,
    status: metadata.status || "pending_review",
    sections,
    formFields: fields,
    assignmentRules: definition.assignmentRules || metadata.assignmentRules || {},
    instructions: definition.instructions || metadata.instructions,
    definition,
    _sectionIds: sectionIds,
  };
}

function validateCondition(condition, fieldIds, path, errors) {
  if (!condition) return;
  const rules = condition.rules || (condition.field ? [condition] : []);
  rules.forEach((rule, index) => {
    if (rule.field && !fieldIds.has(rule.field)) errors.push(`${path}.rules[${index}].field references unknown field ${rule.field}`);
  });
  (condition.groups || []).forEach((group, index) => validateCondition(group, fieldIds, `${path}.groups[${index}]`, errors));
}

function validateDefinition(definition = {}) {
  const payload = definitionPayload(definition);
  const errors = [];
  if (!payload.formCode) errors.push("metadata.formNumber is required");
  if (!payload.title) errors.push("metadata.formName is required");
  if (!payload.version) errors.push("metadata.version is required");
  if (!payload.sections.length) errors.push("At least one section is required");
  if (!payload.formFields.length) errors.push("At least one field is required");

  const sectionIds = new Set();
  payload.sections.forEach((section, index) => {
    if (!section.sectionId) errors.push(`sections[${index}].sectionId is required`);
    if (sectionIds.has(section.sectionId)) errors.push(`Duplicate sectionId ${section.sectionId}`);
    sectionIds.add(section.sectionId);
  });

  const fieldIds = new Set();
  payload.formFields.forEach((field, index) => {
    if (!field.fieldId) errors.push(`fields[${index}].fieldId is required`);
    if (fieldIds.has(field.fieldId)) errors.push(`Duplicate fieldId ${field.fieldId}`);
    fieldIds.add(field.fieldId);
    if (!SUPPORTED_FIELD_TYPES.has(field.type)) errors.push(`Unsupported field type ${field.type} for ${field.fieldId}`);
    if (!sectionIds.has(field.sectionId)) errors.push(`Field ${field.fieldId} references unknown section ${field.sectionId}`);
    (field.mappings || []).forEach((mapping, mappingIndex) => {
      if (!MAPPING_SOURCES.has(mapping.source)) errors.push(`Field ${field.fieldId} mapping[${mappingIndex}] has unsupported source ${mapping.source}`);
      if (mapping.source !== "static" && !mapping.path) errors.push(`Field ${field.fieldId} mapping[${mappingIndex}] requires path`);
    });
    if (field.validation?.regex) {
      try {
        new RegExp(field.validation.regex);
      } catch {
        errors.push(`Field ${field.fieldId} has invalid validation regex`);
      }
    }
  });

  payload.sections.forEach((section, index) => validateCondition(section.conditionalLogic, fieldIds, `sections[${index}].conditionalLogic`, errors));
  payload.formFields.forEach((field, index) => validateCondition(field.conditionalLogic, fieldIds, `fields[${index}].conditionalLogic`, errors));

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      formNumber: payload.formNumber,
      version: payload.version,
      sections: payload.sections.length,
      fields: payload.formFields.length,
      mappings: payload.formFields.reduce((count, field) => count + (field.mappings || []).length, 0),
    },
    payload,
  };
}

async function writeAuditLog(action, template, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "uscis_form_template",
    entityId: template?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} ${template?.formCode || changes?.formNumber || ""}`,
  }).catch(() => {});
}

async function importDefinition(definition, user, req) {
  const validation = validateDefinition(definition);
  if (!validation.valid) {
    const error = new Error("Invalid USCIS form definition");
    error.statusCode = 400;
    error.details = validation.errors;
    throw error;
  }
  const { payload } = validation;
  delete payload._sectionIds;
  const checksum = checksumFor(definition);
  const existing = await USCISFormTemplate.findOne({ formCode: payload.formCode, version: payload.version });
  const templatePayload = {
    ...payload,
    importMetadata: {
      source: "json_definition",
      importedBy: user?._id,
      importedAt: new Date(),
      checksum,
      validationSummary: validation.summary,
    },
  };
  const template = existing
    ? await USCISFormTemplate.findByIdAndUpdate(existing._id, templatePayload, { new: true, runValidators: true })
    : await USCISFormTemplate.create({ ...templatePayload, createdBy: user?._id });
  await writeAuditLog(existing ? "import_definition_update" : "import_definition_create", template, user, validation.summary, req);
  return { template, validation: validation.summary, updatedExisting: Boolean(existing) };
}

async function activateVersion(templateId, user, req) {
  const template = await USCISFormTemplate.findById(templateId);
  if (!template) {
    const error = new Error("USCIS form template not found");
    error.statusCode = 404;
    throw error;
  }
  await USCISFormTemplate.updateMany({ formCode: template.formCode, _id: { $ne: template._id }, status: "active" }, { status: "archived" });
  template.status = "active";
  template.approvedBy = user?._id;
  template.approvedAt = new Date();
  await template.save();
  await writeAuditLog("activate_version", template, user, { formCode: template.formCode, version: template.version }, req);
  return template;
}

async function archiveVersion(templateId, user, req) {
  const template = await USCISFormTemplate.findByIdAndUpdate(templateId, { status: "archived" }, { new: true });
  if (!template) {
    const error = new Error("USCIS form template not found");
    error.statusCode = 404;
    throw error;
  }
  await writeAuditLog("archive_version", template, user, { formCode: template.formCode, version: template.version }, req);
  return template;
}

module.exports = {
  activateVersion,
  archiveVersion,
  importDefinition,
  validateDefinition,
};
