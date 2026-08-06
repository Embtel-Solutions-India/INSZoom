const AuditLog = require("../../models/AuditLog");
const Answer = require("../../models/Answer");
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const Company = require("../../models/Company");
const DocumentExtraction = require("../../models/DocumentExtraction");
const USCISFormTemplate = require("../../models/USCISFormTemplate");
const caseService = require("../cases/case.service");
const CanonicalProfileService = require("../canonical/services/CanonicalProfileService");
const FormMappingService = require("../form-mapping/services/FormMappingService");
const workflowService = require("../workflows/workflow.service");
const VersionManagementService = require("../uscis-lifecycle/services/VersionManagementService");
const { createPerfTimer } = require("../../utils/perfTimer");

const TEMPLATE_CACHE_TTL_MS = Number(process.env.USCIS_TEMPLATE_CACHE_TTL_MS || 5 * 60 * 1000);
const templateCache = {
  activeTemplates: null,
  activeTemplatesExpiresAt: 0,
  latestByCode: new Map(),
};

function cloneTemplate(template) {
  return template ? JSON.parse(JSON.stringify(template)) : template;
}

function invalidateTemplateCache() {
  templateCache.activeTemplates = null;
  templateCache.activeTemplatesExpiresAt = 0;
  templateCache.latestByCode.clear();
}

async function activeTemplatesCached() {
  const now = Date.now();
  if (templateCache.activeTemplates && templateCache.activeTemplatesExpiresAt > now) {
    return templateCache.activeTemplates.map(cloneTemplate);
  }
  const templates = await USCISFormTemplate.find({ status: "active", activeFlag: { $ne: false }, officialStatus: { $ne: "deprecated" } })
    .select("_id formCode formNumber version editionDate activeMappingVersion mappingVersion activeMappingVersionId latestMappingVersionId validationVersion renderingVersion visaTypes supportedVisaCategories assignmentRules activeFlag officialStatus status title")
    .lean();
  templateCache.activeTemplates = templates;
  templateCache.activeTemplatesExpiresAt = now + TEMPLATE_CACHE_TTL_MS;
  return templates.map(cloneTemplate);
}

const FIELD_TYPES = {
  text: "text",
  textarea: "textarea",
  date: "date",
  number: "number",
  dropdown: "select",
  select: "select",
  radio: "radio",
  checkbox: "checkbox",
  multiselect: "multiselect",
  multi_select: "multiselect",
  email: "email",
  phone: "phone",
  address: "address",
  table: "table",
  repeatable_group: "repeatable_group",
  "repeatable group": "repeatable_group",
};

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function normalizeFormCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeToken(value) {
  return String(value || "").trim().replace(/[-\s_]+/g, "").toUpperCase();
}

function normalizeKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function getByPath(source, path) {
  if (!source || !path) return undefined;
  return String(path).split(".").reduce((current, part) => (current == null ? undefined : current[part]), source);
}

function setByPath(target, path, value) {
  const parts = String(path).split(".");
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

function deleteByPath(target, path) {
  if (!target || !path) return;
  const parts = String(path).split(".");
  const last = parts.pop();
  const cursor = parts.reduce((current, part) => (current == null ? undefined : current[part]), target);
  if (cursor && Object.prototype.hasOwnProperty.call(cursor, last)) delete cursor[last];
}

function expandFlatValues(values = {}) {
  return Object.entries(values).reduce((output, [key, value]) => {
    if (key.includes(".")) setByPath(output, key, value);
    else output[key] = value;
    return output;
  }, {});
}

function deepMerge(left = {}, right = {}) {
  const output = { ...left };
  Object.entries(right || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  });
  return output;
}

function addAuditEntry(caseForm, action, user, changes = {}, req) {
  caseForm.auditHistory.push({
    action,
    changes,
    performedBy: user?._id,
    performedAt: new Date(),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

function userRole(user) {
  return String(user?.role || "").toLowerCase();
}

function renderPermissions(user, caseForm) {
  const role = userRole(user);
  const locked = Boolean(caseForm?.isLocked || ["locked", "filed", "finalized", "archived"].includes(caseForm?.status));
  const canConfigure = ["super_admin", "admin"].includes(role);
  const canApprove = ["super_admin", "admin", "team_lead"].includes(role);
  const canReview = canApprove || ["case_manager"].includes(role);
  const canEdit = !locked && (canApprove || role === "case_manager");
  return {
    role,
    mode: role === "client" || role === "user" ? "client_read_only" : role === "case_manager" ? "case_manager_review" : role === "team_lead" ? "team_lead_review" : canConfigure ? "administrator" : "read_only",
    locked,
    canEdit,
    canReview,
    canApprove,
    canConfigure,
    canSaveDraft: canEdit,
    canAutoSave: canEdit,
  };
}

function flattenObject(value, prefix = "", output = {}) {
  if (value === null || value === undefined || typeof value !== "object" || value instanceof Date) {
    if (prefix) output[prefix] = value;
    return output;
  }
  if (Array.isArray(value)) {
    if (prefix) output[prefix] = value;
    return output;
  }
  Object.entries(value).forEach(([key, item]) => flattenObject(item, prefix ? `${prefix}.${key}` : key, output));
  return output;
}

function mappingSourcesForField(field = {}) {
  const mapping = field.mapping || {};
  const sources = [];
  if (mapping.staticValue !== undefined) sources.push({ source: "static", path: "staticValue", value: mapping.staticValue });
  if (mapping.masterDataPath || field.masterDataPath) sources.push({ source: "masterData", path: mapping.masterDataPath || field.masterDataPath });
  if (mapping.canonicalPath || field.canonicalPath) sources.push({ source: "canonical", path: mapping.canonicalPath || field.canonicalPath });
  for (const item of field.mappings || []) {
    sources.push({ source: item.source || item.from || "canonical", path: item.path || item.sourceField || item.field });
  }
  return sources.filter((item) => item.path || item.value !== undefined);
}

function resolveMappedValue(field, context = {}) {
  const sources = mappingSourcesForField(field);
  if (!sources.length) return { value: undefined, source: "unmapped", sourceField: undefined, mappingUsed: null };
  for (const source of sources) {
    if (source.source === "static") return { value: source.value, source: "static", sourceField: source.path, mappingUsed: source };
    const value = getByPath(context[source.source], source.path);
    if (hasValue(value)) return { value, source: source.source, sourceField: source.path, mappingUsed: source };
  }
  return { value: undefined, source: sources[0]?.source || "unmapped", sourceField: sources[0]?.path, mappingUsed: sources[0] || null };
}

async function writeAuditLog(action, caseForm, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "case_form",
    entityId: idOf(caseForm),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} ${caseForm.formCode}`,
  }).catch(() => {});
}

async function getAccessibleCase(caseId, user) {
  const caseData = await Case.findById(caseId);
  if (!caseData) {
    const error = new Error("Case not found");
    error.statusCode = 404;
    throw error;
  }
  if (!caseService.canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to access forms for this case");
    error.statusCode = 403;
    throw error;
  }
  return caseData;
}

function latestTemplateSort(left, right) {
  const leftDate = left.effectiveDate || left.editionDate || left.updatedAt || left.createdAt || 0;
  const rightDate = right.effectiveDate || right.editionDate || right.updatedAt || right.createdAt || 0;
  return new Date(rightDate).getTime() - new Date(leftDate).getTime();
}

function ruleMatchesList(values = [], target) {
  if (!values?.length) return true;
  const normalizedTarget = normalizeToken(target);
  return values.map(normalizeToken).includes(normalizedTarget);
}

function hasAssignmentScope(template = {}) {
  const rules = template.assignmentRules || {};
  return Boolean(
    rules.visaTypes?.length
    || template.visaTypes?.length
    || rules.visaCategories?.length
    || template.supportedVisaCategories?.length
    || rules.caseTypes?.length
    || rules.petitionTypes?.length
    || rules.applicantTypes?.length
    || rules.organizationRules
    || rules.premiumProcessing !== undefined
  );
}

function templateAppliesToCase(template = {}, caseData = {}) {
  const rules = template.assignmentRules || {};
  if (!hasAssignmentScope(template)) return false;
  if (rules.required === false) return false;
  if (!ruleMatchesList(rules.visaTypes?.length ? rules.visaTypes : template.visaTypes, caseData.visaType)) return false;
  if (!ruleMatchesList(rules.visaCategories?.length ? rules.visaCategories : template.supportedVisaCategories, caseData.visaCategory)) return false;
  if (!ruleMatchesList(rules.caseTypes, caseData.caseType)) return false;
  if (!ruleMatchesList(rules.petitionTypes, caseData.petitionType)) return false;
  if (!ruleMatchesList(rules.applicantTypes, caseData.applicantType || caseData.assessmentAnswers?.applicantType)) return false;
  if (rules.organizationRules && typeof rules.organizationRules === "object") {
    const organizationContext = caseData.organizationProfile || caseData.company || caseData.employerProfile || caseData;
    const matchesOrganization = Object.entries(rules.organizationRules).every(([path, expected]) => {
      const actual = getByPath(organizationContext, path);
      return Array.isArray(expected)
        ? expected.map(normalizeToken).includes(normalizeToken(actual))
        : normalizeToken(actual) === normalizeToken(expected);
    });
    if (!matchesOrganization) return false;
  }
  if (rules.premiumProcessing !== undefined && Boolean(rules.premiumProcessing) !== Boolean(caseData.plan?.premiumProcessing || caseData.premiumProcessing)) return false;
  return true;
}

// --- Phase H6: condition-triggered forms, never attached by visa-type tag ---
// Each of I-907 (premium)/G-28 (attorney)/I-539+I-539A (H-4 dependents) is
// gated by a real per-case condition rather than templateAppliesToCase's
// visa-type matching, per §3e of the H6 spec - templateAppliesToCase itself
// is untouched.

function hasActivePremiumAddon(caseData) {
  return (caseData.addons || []).some((addon) => addon.key === "premium_processing_i907" && addon.status !== "cancelled");
}

function hasAttorneyOnRecord(caseData) {
  return Boolean(caseData.assignedAttorney || caseData.attorney);
}

// H-4 dependent presence lives in the H-1B questionnaire's own answers
// (employee_immigrationHistory_hasH4Dependents / employee_dependents), not
// on the Case model - queried directly from Answer rather than via
// caseData.questionnaireData.masterData, which is only ever populated by
// the OCR-autofill path (document-intelligence.service.js) and would be
// empty/stale for a case whose dependents were entered by hand.
async function resolveH1bDependents(caseData) {
  const answers = await Answer.find({
    caseId: caseData._id,
    questionKey: { $in: ["employee_immigrationHistory_hasH4Dependents", "employee_dependents"] },
  }).lean();
  const hasFlag = answers.find((item) => item.questionKey === "employee_immigrationHistory_hasH4Dependents")?.value;
  const dependentsValue = answers.find((item) => item.questionKey === "employee_dependents")?.value;
  const dependents = Array.isArray(dependentsValue) ? dependentsValue : [];
  return { hasDependents: hasFlag === "yes" && dependents.length > 0, dependents };
}

async function findLatestActiveTemplate(formCode) {
  const cacheKey = normalizeFormCode(formCode);
  const cached = templateCache.latestByCode.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cloneTemplate(cached.template);
  const templates = (await activeTemplatesCached()).filter((template) => normalizeFormCode(template.formCode) === cacheKey);
  if (!templates.length) return null;
  const template = [...templates].sort(latestTemplateSort)[0];
  templateCache.latestByCode.set(cacheKey, { template, expiresAt: Date.now() + TEMPLATE_CACHE_TTL_MS });
  return cloneTemplate(template);
}

// Resolves which condition-triggered templates currently apply. Silently
// omits a form whose template hasn't been imported yet (H0 dependency for
// I-907/G-28/I-539/I-539A) rather than crashing assignment - the base
// I-129 flow must never break because a conditional form's template is
// missing. Note: I-539A is modeled as ONE CaseForm per case (not one per
// co-applicant) - CaseForm's own unique index is {caseId, formTemplateId},
// so multiple instances of the SAME template for one case aren't
// supported by the current schema without a schema change (out of scope
// for H6's file allowlist); a case with 3+ total dependents needs the
// case manager to complete additional physical I-539A copies by hand from
// this one CaseForm's data until that schema work lands.
async function resolveConditionalTemplates(caseData) {
  const templates = [];
  const conditions = { premium: false, attorney: false, dependents: false, dependentsI539A: false };

  if (hasActivePremiumAddon(caseData)) {
    const template = await findLatestActiveTemplate("I-907");
    if (template) { templates.push(template); conditions.premium = true; }
  }

  if (hasAttorneyOnRecord(caseData)) {
    const template = await findLatestActiveTemplate("G-28");
    if (template) { templates.push(template); conditions.attorney = true; }
  }

  const dependentsInfo = await resolveH1bDependents(caseData);
  if (dependentsInfo.hasDependents) {
    const i539Template = await findLatestActiveTemplate("I-539");
    if (i539Template) { templates.push(i539Template); conditions.dependents = true; }
    if (dependentsInfo.dependents.length > 1) {
      const i539aTemplate = await findLatestActiveTemplate("I-539A");
      if (i539aTemplate) { templates.push(i539aTemplate); conditions.dependentsI539A = true; }
    }
  }

  return { templates, conditions, dependentsInfo };
}

const CONDITIONAL_FORM_CODES = ["I-907", "G-28", "I-539", "I-539A"];

// AC7 (idempotent & reversible): when a condition that used to be true
// (e.g. an active premium addon) becomes false, the corresponding
// CaseForm is archived (never deleted - master data is never destroyed)
// so it drops out of the packet on the next assembly; if the condition
// becomes true again later, the same archived CaseForm is reactivated
// rather than a duplicate being created (the create-loop below skips any
// formCode with an existing CaseForm regardless of status). A form that's
// already locked/filed is never touched - it's a historical record of an
// actual filing, not a live draft.
async function reconcileConditionalForms(caseData, user, req, conditions) {
  const conditionByFormCode = { "I-907": conditions.premium, "G-28": conditions.attorney, "I-539": conditions.dependents, "I-539A": conditions.dependentsI539A };
  const existingConditionalForms = await CaseForm.find({ caseId: caseData._id, formCode: { $in: CONDITIONAL_FORM_CODES } });
  for (const caseForm of existingConditionalForms) {
    const code = normalizeFormCode(caseForm.formCode);
    const conditionTrue = conditionByFormCode[caseForm.formCode] ?? conditionByFormCode[code];
    if (["locked", "filed"].includes(caseForm.status)) continue;
    if (!conditionTrue && caseForm.status !== "archived") {
      caseForm.status = "archived";
      addAuditEntry(caseForm, "form_condition_no_longer_met", user, { formCode: caseForm.formCode }, req);
      await caseForm.save();
    } else if (conditionTrue && caseForm.status === "archived") {
      caseForm.status = "pending";
      addAuditEntry(caseForm, "form_condition_met_again", user, { formCode: caseForm.formCode }, req);
      await caseForm.save();
    }
  }
}

// Return shape is unchanged (a plain array) - existing callers
// (immigration-knowledge-engine.service.js) destructure this directly and
// pass it straight through as ensureAssignedForms' options.templates.
// Condition-triggered forms (§3e) are merged in as a second, independent
// selection so the generic per-formCode create-loop in ensureAssignedForms
// picks them up with no changes of its own; reconciliation (archiving a
// form whose condition became false) happens separately in
// ensureAssignedForms itself, not here, so this function stays a pure read.
async function latestTemplatesByAssignmentRules(caseData) {
  const timer = createPerfTimer("uscis_template_resolution_performance", { caseId: caseData?._id, visaType: caseData?.visaType });
  const templates = await activeTemplatesCached();
  timer.mark("active_template_lookup", { count: templates.length });
  const grouped = new Map();
  templates.filter((template) => templateAppliesToCase(template, caseData)).forEach((template) => {
    const code = normalizeFormCode(template.formCode || template.formNumber);
    const existing = grouped.get(code);
    if (!existing || latestTemplateSort(template, existing) < 0) grouped.set(code, template);
  });
  const { templates: conditional } = await resolveConditionalTemplates(caseData);
  timer.mark("conditional_template_resolution", { count: conditional.length });
  conditional.forEach((template) => {
    const code = normalizeFormCode(template.formCode || template.formNumber);
    if (!grouped.has(code)) grouped.set(code, template);
  });
  timer.done({ selectedCount: grouped.size });
  return [...grouped.values()];
}

async function ensureAssignedForms(caseData, user, req, options = {}) {
  const templates = options.templates || await latestTemplatesByAssignmentRules(caseData);
  const { conditions } = await resolveConditionalTemplates(caseData);
  await reconcileConditionalForms(caseData, user, req, conditions);
  if (!templates.length) return [];
  const existing = await CaseForm.find({ caseId: caseData._id, formCode: { $in: templates.map((template) => template.formCode) } });
  const existingCodes = new Set(existing.map((form) => normalizeFormCode(form.formCode)));
  const created = [];

  for (const template of templates) {
    if (existingCodes.has(normalizeFormCode(template.formCode))) continue;
    const caseForm = await CaseForm.create({
      caseId: caseData._id,
      formTemplateId: template._id,
      formCode: template.formCode,
      formVersion: template.version,
      formEditionDate: template.editionDate,
      mappingVersion: template.activeMappingVersion || template.mappingVersion || 0,
      mappingVersionId: template.activeMappingVersionId || template.latestMappingVersionId,
      validationVersion: template.validationVersion || 0,
      renderingVersion: template.renderingVersion || 0,
      formVersionLock: {
        formType: template.formCode || template.formNumber,
        editionDate: template.editionDate,
        version: template.version,
        mappingVersion: template.activeMappingVersion || template.mappingVersion || 0,
        mappingVersionId: template.activeMappingVersionId || template.latestMappingVersionId,
        validationVersion: template.validationVersion || 0,
        renderingVersion: template.renderingVersion || 0,
        formTemplateId: template._id,
        lockedAt: new Date(),
        lockedBy: user?._id,
      },
      status: "pending",
      filledData: {},
      fieldValues: {},
      lastModifiedBy: user?._id,
      lastModifiedAt: new Date(),
    });
    addAuditEntry(caseForm, "form_assigned", user, { formCode: template.formCode, version: template.version }, req);
    await caseForm.save();
    caseService.addTimelineEvent(caseData, "uscis_form", "USCIS Form Assigned", `${template.formCode} ${template.version} assigned to case`, user, { caseFormId: caseForm._id, formTemplateId: template._id, editionDate: template.editionDate, mappingVersion: template.activeMappingVersion || template.mappingVersion || 0 });
    caseData.uscisFormReferences.push({
      refId: caseForm._id,
      refModel: "CaseForm",
      label: template.formCode,
      status: "pending",
      addedBy: user?._id,
      version: template.version,
      editionDate: template.editionDate,
      mappingVersion: template.activeMappingVersion || template.mappingVersion || 0,
      validationVersion: template.validationVersion || 0,
      renderingVersion: template.renderingVersion || 0,
    });
    created.push(caseForm);
  }
  if (created.length) {
    caseService.addAuditEntry(caseData, "uscis_forms_assigned", "USCIS forms assigned by visa category", user, { forms: created.map((form) => form.formCode) }, req);
    await caseData.save();
    await caseService.writeAuditLog("uscis_forms_assigned", caseData, user, { forms: created.map((form) => form.formCode) }, req);
  }
  return created;
}

function normalizeField(field = {}, index = 0) {
  const fieldName = field.fieldName || field.fieldId || field.name || field.key || `field_${index + 1}`;
  const sectionKey = field.sectionKey || field.sectionId || normalizeKey(field.sectionTitle || field.part || `page_${field.pageNumber || 1}`);
  return {
    ...field,
    fieldId: field.fieldId || fieldName,
    fieldName,
    fieldLabel: field.fieldLabel || field.label || fieldName,
    label: field.label || field.fieldLabel || fieldName,
    fieldType: FIELD_TYPES[field.fieldType] || FIELD_TYPES[field.type] || "text",
    type: FIELD_TYPES[field.fieldType] || FIELD_TYPES[field.type] || "text",
    sectionKey,
    sectionId: field.sectionId || sectionKey,
    sectionTitle: field.sectionTitle || field.part || `Section ${field.pageNumber || 1}`,
    order: field.order ?? index,
    required: Boolean(field.required || field.validation?.required),
    options: field.options || [],
    validation: field.validation || field.validationRules || {},
    validationRules: field.validationRules || field.validation || {},
    conditionalLogic: field.conditionalLogic || field.showWhen,
    showWhen: field.showWhen || field.conditionalLogic,
    mappings: field.mappings || [],
    repeatableConfig: field.repeatableConfig || {},
  };
}

function buildSections(template) {
  const fields = (template.formFields || []).map(normalizeField);
  if (template.sections?.length) {
    return template.sections
      .map((section, index) => ({
        key: section.key || normalizeKey(section.title || `section_${index + 1}`),
        title: section.title || `Section ${index + 1}`,
        description: section.description,
        order: section.order ?? index,
        sectionId: section.sectionId || section.key || normalizeKey(section.title || `section_${index + 1}`),
        repeatable: Boolean(section.repeatable),
        repeatableConfig: section.repeatableConfig || {},
        conditionalLogic: section.conditionalLogic || section.showWhen,
        showWhen: section.showWhen || section.conditionalLogic,
        parentKey: section.parentKey,
        fields: fields.filter((field) => field.sectionKey === (section.key || section.sectionId || normalizeKey(section.title))),
      }))
      .sort((left, right) => (left.order || 0) - (right.order || 0));
  }
  const grouped = fields.reduce((map, field) => {
    map[field.sectionKey] = map[field.sectionKey] || {
      key: field.sectionKey,
      title: field.sectionTitle,
      order: field.pageNumber || field.order || 0,
      fields: [],
    };
    map[field.sectionKey].fields.push(field);
    return map;
  }, {});
  return Object.values(grouped).map((section) => ({ ...section, fields: section.fields.sort((left, right) => (left.order || 0) - (right.order || 0)) })).sort((left, right) => (left.order || 0) - (right.order || 0));
}

async function buildBindingContext(caseData, user, req) {
  let canonicalState = null;
  try {
    canonicalState = await CanonicalProfileService.get(caseData._id, user, req);
  } catch (error) {
    canonicalState = null;
  }
  const masterData = caseData.questionnaireData?.masterData || {};
  const canonical = canonicalState?.profile || caseData.canonicalProfile?.profile || {};
  return {
    masterData,
    canonical,
    canonicalState,
    case: caseData.toObject ? caseData.toObject() : caseData,
    beneficiary: canonical.beneficiary || canonical.person || {},
    company: canonical.company || canonical.petitioner || {},
    petitioner: canonical.petitioner || canonical.company || {},
    documents: canonical.documents || [],
    ocr: canonical.ocr || canonical.extractedDocuments || {},
  };
}

function mappedValue(field, context) {
  const resolved = resolveMappedValue(field, context);
  if (hasValue(resolved.value)) return resolved.value;
  const inferred = getByPath(context.masterData, field.fieldName) ?? getByPath(context.canonical, field.fieldName);
  return hasValue(inferred) ? inferred : undefined;
}

function buildSourceAttribution(template, values, existingAttribution = {}, context = {}) {
  const attribution = { ...(existingAttribution || {}) };
  for (const field of (template.formFields || []).map(normalizeField)) {
    const fieldName = field.fieldName;
    const current = getByPath(values, fieldName);
    if (!hasValue(current) || attribution[fieldName]?.source === "ManualOverride" || attribution[fieldName]?.source === "Attorney") continue;
    const resolved = resolveMappedValue(field, context);
    attribution[fieldName] = {
      ...(attribution[fieldName] || {}),
      value: current,
      source: resolved.source === "masterData" ? "MasterCaseData" : resolved.source === "canonical" ? "CanonicalProfile" : resolved.source || "AutoPopulation",
      sourceField: resolved.sourceField || fieldName,
      confidence: attribution[fieldName]?.confidence ?? 100,
      mappingUsed: resolved.mappingUsed,
      verificationStatus: attribution[fieldName]?.verificationStatus || "auto_populated",
      populatedAt: attribution[fieldName]?.populatedAt || new Date(),
    };
  }
  return attribution;
}

function compareCondition(actual, operator, expected) {
  if (operator === "not_equals") return actual !== expected;
  if (operator === "exists") return hasValue(actual);
  if (operator === "missing") return !hasValue(actual);
  if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (operator === "not_in") return Array.isArray(expected) && !expected.includes(actual);
  return actual === expected;
}

function isVisible(definition, values) {
  const condition = definition?.conditionalLogic || definition?.showWhen;
  if (!condition) return true;
  const rules = condition.rules || (condition.field ? [condition] : []);
  const results = rules.map((rule) => compareCondition(getByPath(values, rule.field), rule.operator || "equals", rule.value));
  const nested = (condition.groups || []).map((group) => isVisible({ conditionalLogic: group }, values));
  const all = [...results, ...nested];
  if (!all.length) return true;
  return condition.mode === "any" ? all.some(Boolean) : all.every(Boolean);
}

function mergeFieldValues(template, caseForm, context) {
  const values = { ...(caseForm.fieldValues || {}), ...(caseForm.filledData || {}) };
  for (const field of (template.formFields || []).map(normalizeField)) {
    if (hasValue(getByPath(values, field.fieldName))) continue;
    const value = mappedValue(field, context);
    if (hasValue(value)) setByPath(values, field.fieldName, value);
  }
  return values;
}

function validateField(field, value) {
  const errors = [];
  const rules = field.validation || {};
  if ((field.required || rules.required) && !hasValue(value)) errors.push("Required field");
  if (hasValue(value) && field.fieldType === "date" && Number.isNaN(new Date(value).getTime())) errors.push("Invalid date");
  if (hasValue(value) && field.fieldType === "number" && Number.isNaN(Number(value))) errors.push("Invalid number");
  if (hasValue(value) && field.fieldType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push("Invalid email");
  if (hasValue(value) && field.fieldType === "phone" && !/^[0-9+().\-\s]{7,25}$/.test(String(value))) errors.push("Invalid phone number");
  if (hasValue(value) && (field.fieldName.toLowerCase().includes("passport") || rules.passport) && !/^[a-z0-9-]{5,20}$/i.test(String(value))) errors.push("Invalid passport format");
  if (hasValue(value) && rules.minLength && String(value).length < Number(rules.minLength)) errors.push(`Minimum length is ${rules.minLength}`);
  if (hasValue(value) && rules.maxLength && String(value).length > Number(rules.maxLength)) errors.push(`Maximum length is ${rules.maxLength}`);
  if (hasValue(value) && rules.min !== undefined && Number(value) < Number(rules.min)) errors.push(`Minimum value is ${rules.min}`);
  if (hasValue(value) && rules.max !== undefined && Number(value) > Number(rules.max)) errors.push(`Maximum value is ${rules.max}`);
  if (hasValue(value) && rules.pattern && !new RegExp(rules.pattern).test(String(value))) errors.push(rules.message || "Invalid format");
  if (hasValue(value) && rules.regex && !new RegExp(rules.regex).test(String(value))) errors.push(rules.message || "Invalid format");
  return errors;
}

function calculateCompletion(template, values) {
  const sections = buildSections(template);
  const validationErrors = {};
  let totalFields = 0;
  let completedFields = 0;
  let requiredFields = 0;
  let missingRequiredFields = 0;
  const sectionProgress = {};

  for (const section of sections) {
    if (!isVisible(section, values)) continue;
    let sectionCompleted = 0;
    let sectionRequired = 0;
    let sectionMissingRequired = 0;
    for (const field of section.fields) {
      if (field.hidden) continue;
      if (!isVisible(field, values)) continue;
      totalFields += 1;
      const value = getByPath(values, field.fieldName);
      const completed = hasValue(value);
      if (completed) {
        completedFields += 1;
        sectionCompleted += 1;
      }
      if (field.required) {
        requiredFields += 1;
        sectionRequired += 1;
        if (!completed) {
          missingRequiredFields += 1;
          sectionMissingRequired += 1;
        }
      }
      const errors = validateField(field, value);
      if (errors.length) validationErrors[field.fieldName] = errors;
    }
    const visibleFieldCount = section.fields.filter((field) => !field.hidden && isVisible(field, values)).length;
    sectionProgress[section.key] = {
      totalFields: visibleFieldCount,
      completedFields: sectionCompleted,
      requiredFields: sectionRequired,
      missingRequiredFields: sectionMissingRequired,
      percent: visibleFieldCount ? Math.round((sectionCompleted / visibleFieldCount) * 100) : 100,
    };
  }

  return {
    completion: {
      totalFields,
      completedFields,
      requiredFields,
      missingRequiredFields,
      percent: totalFields ? Math.round((completedFields / totalFields) * 100) : 0,
    },
    sectionProgress,
    validationErrors,
  };
}

function buildRenderModel(template, values, progress, user, caseForm) {
  const sections = buildSections(template);
  const pageMap = new Map();
  const fieldIndex = {};
  const flatValues = flattenObject(values);
  for (const section of sections) {
    const pageNumber = section.pageNumber || section.fields?.[0]?.pageNumber || section.order || 1;
    if (!pageMap.has(pageNumber)) {
      pageMap.set(pageNumber, { pageNumber, title: `Page ${pageNumber}`, sections: [], fieldCount: 0, completedFields: 0 });
    }
    const page = pageMap.get(pageNumber);
    const sectionProgress = progress.sectionProgress?.[section.key] || {};
    page.sections.push(section.key);
    page.fieldCount += sectionProgress.totalFields || section.fields?.length || 0;
    page.completedFields += sectionProgress.completedFields || 0;
    for (const field of section.fields || []) {
      fieldIndex[field.fieldName] = {
        fieldName: field.fieldName,
        label: field.label || field.fieldLabel,
        sectionKey: section.key,
        pageNumber: field.pageNumber || pageNumber,
        type: field.fieldType,
        required: Boolean(field.required),
        hasValue: hasValue(getByPath(values, field.fieldName)),
      };
    }
  }
  return {
    renderer: {
      mode: "browser_native",
      source: "USCISFormTemplate",
      layoutFidelity: "official_logical_layout",
      valuesSource: "MasterCaseData",
      permissions: renderPermissions(user, caseForm),
      autosave: { enabled: true, endpoint: "autosave", debounceMs: 800 },
      draftRecovery: { enabled: true, versionNumber: caseForm.versionNumber || 1, lastSavedAt: caseForm.lastModifiedAt },
      pages: [...pageMap.values()].map((page) => ({ ...page, percent: page.fieldCount ? Math.round((page.completedFields / page.fieldCount) * 100) : 100 })),
      fieldIndex,
      flatValues,
    },
    structure: {
      sections,
      pages: [...pageMap.values()],
      groups: template.formStructure?.groups || template.formLayout?.groups || [],
      layout: template.formLayout || template.renderingConfiguration?.layout || {},
    },
  };
}

async function renderCaseForm(caseId, caseFormId, user, req, options = {}) {
  const caseData = await getAccessibleCase(caseId, user);
  const caseForm = await CaseForm.findOne({ _id: caseFormId, caseId }).populate("formTemplateId");
  if (!caseForm) {
    const error = new Error("Case form not found");
    error.statusCode = 404;
    throw error;
  }
  let template = caseForm.formTemplateId.toObject();
  const lockedMapping = await FormMappingService.loadMappingVersion(
    template,
    caseForm.formVersionLock?.mappingVersionId || caseForm.mappingVersionId,
  );
  template = FormMappingService.applyMappingGraph(template, lockedMapping);
  const context = options.caseFormOnly ? null : await buildBindingContext(caseData, user, req);
  const values = options.caseFormOnly
    ? deepMerge(caseForm.filledData || {}, expandFlatValues(caseForm.fieldValues || {}))
    : mergeFieldValues(template, caseForm, context);
  const progress = calculateCompletion(template, values);
  if (!options.caseFormOnly) caseForm.sourceAttribution = buildSourceAttribution(template, values, caseForm.sourceAttribution, context);
  const renderModel = buildRenderModel(template, values, progress, user, caseForm);
  caseForm.fieldValues = values;
  caseForm.filledData = values;
  caseForm.completion = progress.completion;
  caseForm.sectionProgress = progress.sectionProgress;
  caseForm.validationErrors = progress.validationErrors;
  if (context?.canonicalState?.version) {
    caseForm.syncState = {
      ...(caseForm.syncState?.toObject?.() || caseForm.syncState || {}),
      canonicalVersion: context.canonicalState.version,
      stale: false,
      requiresRegeneration: false,
      lastSyncedAt: new Date(),
    };
  }
  addAuditEntry(caseForm, "form_opened", user, { caseId, formCode: caseForm.formCode }, req);
  await caseForm.save();
  await writeAuditLog("form_opened", caseForm, user, { caseId, formCode: caseForm.formCode }, req);
  return {
    caseForm,
    template: {
      _id: template._id,
      formCode: template.formCode,
      title: template.title,
      description: template.description,
      version: template.version,
      editionDate: template.editionDate,
      instructions: template.instructions,
      sections: buildSections(template),
      pages: renderModel.renderer.pages,
      fieldIndex: renderModel.renderer.fieldIndex,
      structure: renderModel.structure,
      renderingConfiguration: template.renderingConfiguration || {},
      validationConfiguration: template.validationConfiguration || {},
      mappingConfiguration: template.mappingConfiguration || {},
    },
    values,
    renderer: renderModel.renderer,
    structure: renderModel.structure,
    completion: progress.completion,
    sectionProgress: progress.sectionProgress,
    validationErrors: progress.validationErrors,
  };
}

async function validateCaseForm(caseId, caseFormId, user) {
  await getAccessibleCase(caseId, user);
  const caseForm = await CaseForm.findOne({ _id: caseFormId, caseId }).populate("formTemplateId");
  if (!caseForm) throw Object.assign(new Error("Case form not found"), { statusCode: 404 });
  const progress = calculateCompletion(caseForm.formTemplateId, caseForm.fieldValues || caseForm.filledData || {});
  caseForm.completion = progress.completion;
  caseForm.sectionProgress = progress.sectionProgress;
  caseForm.validationErrors = progress.validationErrors;
  await caseForm.save();
  return { valid: Object.keys(progress.validationErrors || {}).length === 0, ...progress };
}

async function compareCaseForm(caseId, caseFormId, user) {
  await getAccessibleCase(caseId, user);
  const caseForm = await CaseForm.findOne({ _id: caseFormId, caseId }).lean();
  if (!caseForm) throw Object.assign(new Error("Case form not found"), { statusCode: 404 });
  const baseline = caseForm.comparisonBaseline?.fieldValues || caseForm.versions?.[caseForm.versions.length - 1]?.fieldValues || {};
  const current = caseForm.fieldValues || {};
  const fields = new Set([...Object.keys(baseline || {}), ...Object.keys(current || {})]);
  const modifiedFields = [];
  fields.forEach((fieldId) => {
    if (JSON.stringify(baseline[fieldId]) !== JSON.stringify(current[fieldId])) {
      modifiedFields.push({ fieldId, previousValue: baseline[fieldId], currentValue: current[fieldId] });
    }
  });
  return {
    baselineVersion: caseForm.comparisonBaseline?.versionNumber || caseForm.versions?.[caseForm.versions.length - 1]?.versionNumber || null,
    currentVersion: caseForm.versionNumber,
    modifiedFields,
    modifiedFieldCount: modifiedFields.length,
  };
}

async function markCaseFormsStale(caseId, reason = "master_case_data_changed", changedFields = []) {
  await CaseForm.updateMany(
    {
      caseId,
      status: { $nin: ["finalized", "filed", "archived"] },
    },
    {
      $set: {
        "syncState.stale": true,
        "syncState.requiresRegeneration": true,
        "syncState.staleReason": reason,
        "syncState.affectedFields": changedFields,
      },
    }
  );
}

async function listCaseForms(caseId, user, req) {
  const caseData = await getAccessibleCase(caseId, user);
  await ensureAssignedForms(caseData, user, req, { metadataOnly: true });
  const forms = await CaseForm.find({ caseId }).populate("formTemplateId").sort({ updatedAt: -1 }).lean();
  return forms;
}

async function listRegistry(query = {}) {
  const filter = {};
  if (query.formCode || query.formNumber) filter.formCode = normalizeFormCode(query.formCode || query.formNumber);
  if (query.status) filter.status = query.status;
  if (query.officialStatus) filter.officialStatus = query.officialStatus;
  if (query.status === "active" && !query.officialStatus) filter.officialStatus = { $ne: "deprecated" };
  if (query.active !== undefined) filter.activeFlag = String(query.active) === "true";
  if (query.visaType) filter.$or = [{ visaTypes: query.visaType }, { "assignmentRules.visaTypes": query.visaType }];
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const [total, forms] = await Promise.all([
    USCISFormTemplate.countDocuments(filter),
    USCISFormTemplate.find(filter).sort({ formCode: 1, editionDate: -1, version: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return { total, page, pages: Math.ceil(total / limit), forms };
}

async function getVersions(formCode) {
  const versions = await USCISFormTemplate.find({ formCode: normalizeFormCode(formCode) }).sort({ editionDate: -1, version: -1 }).lean();
  return {
    formCode: normalizeFormCode(formCode),
    active: versions.find((template) => template.status === "active" && template.officialStatus !== "deprecated"),
    versions,
    archived: versions.filter((template) => ["retired", "archived"].includes(template.status)),
    pending: versions.filter((template) => ["draft", "review"].includes(template.status)),
  };
}

async function activateTemplate(templateId, user, req) {
  const result = await VersionManagementService.activate(templateId, user, req);
  invalidateTemplateCache();
  return result.template;
}

async function retireTemplate(templateId, user, req) {
  const template = await USCISFormTemplate.findById(templateId);
  if (!template) throw Object.assign(new Error("USCIS form template not found"), { statusCode: 404 });
  template.status = "retired";
  template.currentStatus = "retired";
  template.activeFlag = false;
  template.retiredAt = new Date();
  template.lifecycle = { ...(template.lifecycle?.toObject?.() || template.lifecycle || {}), retiredBy: user?._id };
  await template.save();
  await AuditLog.create({
    userId: user?._id,
    action: "uscis_form_template_retired",
    entityType: "uscis_form_template",
    entityId: idOf(template),
    changes: { formCode: template.formCode, version: template.version },
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `Retired ${template.formCode} ${template.version}`,
  }).catch(() => null);
  invalidateTemplateCache();
  return template;
}

async function createCaseForm(caseId, payload, user, req) {
  const caseData = await getAccessibleCase(caseId, user);
  const template = await USCISFormTemplate.findById(payload.formTemplateId);
  if (!template) {
    const error = new Error("USCIS form template not found");
    error.statusCode = 404;
    throw error;
  }
  const initialValues = expandFlatValues(payload.fieldValues || payload.filledData || {});
  const caseForm = await CaseForm.findOneAndUpdate(
    { caseId, formTemplateId: template._id },
    {
      $setOnInsert: {
        caseId,
        formTemplateId: template._id,
        formCode: template.formCode,
        formVersion: template.version,
        formEditionDate: template.editionDate,
        mappingVersion: template.activeMappingVersion || template.mappingVersion || 0,
        mappingVersionId: template.activeMappingVersionId || template.latestMappingVersionId,
        validationVersion: template.validationVersion || 0,
        renderingVersion: template.renderingVersion || 0,
        formVersionLock: {
          formType: template.formCode,
          editionDate: template.editionDate,
          version: template.version,
          mappingVersion: template.activeMappingVersion || template.mappingVersion || 0,
          mappingVersionId: template.activeMappingVersionId || template.latestMappingVersionId,
          validationVersion: template.validationVersion || 0,
          renderingVersion: template.renderingVersion || 0,
          formTemplateId: template._id,
          lockedAt: new Date(),
          lockedBy: user?._id,
        },
      },
      $set: {
        fieldValues: initialValues,
        filledData: initialValues,
        lastModifiedBy: user?._id,
        lastModifiedAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  addAuditEntry(caseForm, "form_created", user, { formTemplateId: template._id }, req);
  caseService.addTimelineEvent(caseData, "uscis_form", "USCIS Form Created", `${template.formCode} created`, user, { caseFormId: caseForm._id });
  await Promise.all([caseForm.save(), caseData.save()]);
  await writeAuditLog("form_created", caseForm, user, { formTemplateId: template._id }, req);
  return caseForm;
}

async function saveCaseForm(caseId, caseFormId, payload, user, req, action = "save_draft") {
  await getAccessibleCase(caseId, user);
  const caseForm = await CaseForm.findOne({ _id: caseFormId, caseId }).populate("formTemplateId");
  if (!caseForm) {
    const error = new Error("Case form not found");
    error.statusCode = 404;
    throw error;
  }
  if (caseForm.isLocked) {
    const error = new Error("Case form is locked");
    error.statusCode = 409;
    throw error;
  }
  const incomingValues = expandFlatValues(payload.fieldValues || payload.filledData || {});
  const values = deepMerge(caseForm.fieldValues || {}, incomingValues);
  const progress = calculateCompletion(caseForm.formTemplateId, values);
  caseForm.fieldValues = values;
  caseForm.filledData = values;
  caseForm.completion = progress.completion;
  caseForm.sectionProgress = progress.sectionProgress;
  caseForm.validationErrors = progress.validationErrors;
  caseForm.status = payload.status || (action === "auto_save" ? "draft" : "draft");
  caseForm.lastModifiedBy = user?._id;
  caseForm.lastModifiedAt = new Date();
  addAuditEntry(caseForm, action === "save_section" ? "section_saved" : action, user, { sectionKey: payload.sectionKey, fields: Object.keys(payload.fieldValues || payload.filledData || {}) }, req);
  await caseForm.save();
  await writeAuditLog(action === "save_section" ? "section_saved" : action, caseForm, user, { sectionKey: payload.sectionKey }, req);
  return caseForm;
}

async function reviewCaseForm(caseId, caseFormId, payload, user, req) {
  await getAccessibleCase(caseId, user);
  const caseForm = await CaseForm.findOne({ _id: caseFormId, caseId }).populate("formTemplateId");
  if (!caseForm) {
    const error = new Error("Case form not found");
    error.statusCode = 404;
    throw error;
  }
  const fieldReviews = { ...(caseForm.fieldReviews || {}) };
  for (const review of payload.fieldReviews || []) {
    fieldReviews[review.fieldName] = {
      status: review.status,
      comment: review.comment,
      reviewedBy: user?._id,
      reviewedAt: new Date(),
    };
    if (review.comment) {
      caseForm.comments.push({ fieldName: review.fieldName, sectionKey: review.sectionKey, comment: review.comment, createdBy: user?._id });
    }
  }
  caseForm.fieldReviews = fieldReviews;
  caseForm.reviewedBy = user?._id;
  caseForm.reviewDate = new Date();
  caseForm.reviewComments = payload.reviewComments || caseForm.reviewComments;
  if (payload.status) caseForm.status = payload.status === "approved" ? "approved" : payload.status;
  if (payload.markComplete) {
    const progress = calculateCompletion(caseForm.formTemplateId, caseForm.fieldValues || {});
    if (Object.keys(progress.validationErrors).length) {
      addAuditEntry(caseForm, "validation_failed", user, progress.validationErrors, req);
      await caseForm.save();
      const error = new Error("Form has validation errors");
      error.statusCode = 400;
      error.validationErrors = progress.validationErrors;
      throw error;
    }
    caseForm.status = "approved";
    caseForm.approvedBy = user?._id;
    caseForm.approvalDate = new Date();
  }
  addAuditEntry(caseForm, "review_completed", user, payload, req);
  await caseForm.save();
  await writeAuditLog("review_completed", caseForm, user, payload, req);
  if (caseForm.status === "approved") {
    await workflowService.triggerWorkflow("uscis.form.approved", {
      entityType: "case",
      entityId: caseForm.caseId,
      caseId: caseForm.caseId,
      caseFormId: caseForm._id,
      formCode: caseForm.formCode,
      formVersion: caseForm.formVersion,
      formEditionDate: caseForm.formEditionDate,
    }, user, req).catch(() => null);
  }
  return caseForm;
}

module.exports = {
  buildSections,
  calculateCompletion,
  compareCaseForm,
  createCaseForm,
  ensureAssignedForms,
  hasAssignmentScope,
  latestTemplatesByAssignmentRules,
  getVersions,
  listCaseForms,
  listRegistry,
  markCaseFormsStale,
  activateTemplate,
  retireTemplate,
  renderCaseForm,
  saveCaseForm,
  validateCaseForm,
  reviewCaseForm,
  templateAppliesToCase,
  hasActivePremiumAddon,
  hasAttorneyOnRecord,
  resolveH1bDependents,
  resolveConditionalTemplates,
  invalidateTemplateCache,
};
