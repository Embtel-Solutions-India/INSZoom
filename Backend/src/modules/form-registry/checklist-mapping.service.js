// Form Governance: edit which checklist(s) a (visa type -> form) registry row sends to the client, and under what condition.
//
//   AUTO          compulsory - assigned to every case of that visa type automatically
//   CONDITIONAL   assigned only while its condition (the registry trigger DSL, same whitelist as form triggers) is true for the case
//   EXPLICIT_CM   never automatic - a case manager adds it by hand
//
// This edits the SAME data the rest of the system already reads (VisaFormMapping.checklistMappings, consumed by
// visaFormMapping.service.resolveChecklistsForCase and CaseLifecycleOrchestrator.provisionChecklistAssignments), so new cases pick the change up with
// no other wiring. Cases already in progress get it through applyToExistingCases, which reuses that same orchestrator step (idempotent: a checklist a
// case already holds is never assigned twice) and is always previewed first.
//
// Removing a checklist from a row never takes it away from a case that already has it - the client's answers stay where they are; it only stops being
// sent to new cases.

const VisaFormMapping = require("../../models/VisaFormMapping");
const Questionnaire = require("../../models/Questionnaire");
const Case = require("../../models/Case");
const { recordAuditEvent } = require("../audit/audit.service");

const ASSIGNMENT_TYPES = VisaFormMapping.CHECKLIST_ASSIGNMENT_TYPES; // ["AUTO", "CONDITIONAL", "EXPLICIT_CM"]
const CLOSED_CASE_STATUSES = ["completed", "cancelled", "closed", "archived"];
const MAX_NOTES_LENGTH = 500;

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

// Pure. Normalises and validates a condition tree built by the Form Governance editor ({field,operator,value} | {all:[...]} | {any:[...]}).
function sanitizeCondition(node, path = "condition") {
  if (node === null || node === undefined) return null;
  if (typeof node !== "object" || Array.isArray(node)) throw httpError(400, `${path} must be an object`);
  if (Array.isArray(node.all) || Array.isArray(node.any)) {
    const mode = Array.isArray(node.all) ? "all" : "any";
    const children = node[mode].map((child, index) => sanitizeCondition(child, `${path}.${mode}[${index}]`)).filter(Boolean);
    if (!children.length) throw httpError(400, `${path} needs at least one rule`);
    return { [mode]: children };
  }
  const operator = node.operator;
  if (!["equals", "notEquals", "in", "notIn", "exists"].includes(operator)) throw httpError(400, `${path}: unsupported operator "${operator}"`);
  let value = node.value;
  if (operator === "in" || operator === "notIn") {
    value = (Array.isArray(value) ? value : String(value ?? "").split(","))
      .map((item) => String(item).trim())
      .filter(Boolean);
    if (!value.length) throw httpError(400, `${path}: give at least one value`);
  } else if (operator === "exists") {
    value = value === true || value === "true";
  } else {
    value = typeof value === "boolean" ? value : String(value ?? "").trim();
    if (value === "") throw httpError(400, `${path}: give a value to compare with`);
  }
  const clean = { field: node.field, operator, value };
  const problem = VisaFormMapping.validateTriggerNode(clean, path);
  if (problem) throw httpError(400, problem);
  return clean;
}

// Pure. `knownKeys`: Set of checklist keys that exist; `roles`: the allowed role vocabulary.
function sanitizeChecklistMappings(entries, { knownKeys, roles }) {
  if (!Array.isArray(entries)) throw httpError(400, "checklistMappings must be a list");
  const seen = new Set();
  return entries.map((entry, index) => {
    const checklistKey = String(entry?.checklistKey || "").trim();
    if (!checklistKey) throw httpError(400, `Checklist ${index + 1}: choose a checklist`);
    if (knownKeys && !knownKeys.has(checklistKey)) throw httpError(400, `Checklist "${checklistKey}" does not exist`);
    if (!ASSIGNMENT_TYPES.includes(entry.assignmentType)) throw httpError(400, `${checklistKey}: assignment must be one of ${ASSIGNMENT_TYPES.join(", ")}`);
    const role = String(entry.role || "").trim();
    if (role && roles && !roles.includes(role)) throw httpError(400, `${checklistKey}: unknown role "${role}"`);
    const identity = `${checklistKey}|${role}`;
    if (seen.has(identity)) throw httpError(400, `${checklistKey}${role ? ` (${role})` : ""} is listed twice`);
    seen.add(identity);
    const condition = entry.assignmentType === "CONDITIONAL" ? sanitizeCondition(entry.condition, `${checklistKey} condition`) : null;
    if (entry.assignmentType === "CONDITIONAL" && !condition) throw httpError(400, `${checklistKey}: a conditional checklist needs a condition`);
    const notes = String(entry.notes || "").trim().slice(0, MAX_NOTES_LENGTH);
    return { checklistKey, assignmentType: entry.assignmentType, role, condition, notes };
  });
}

// Checklists an admin can attach: real checklist templates only (never a per-case copy, a staff request or an archived one).
async function listChecklistOptions() {
  const rows = await Questionnaire.find({
    isTemplate: true,
    latestVersion: true,
    status: { $ne: "archived" },
    isActive: { $ne: false },
    tags: { $ne: "staff_request" },
    key: { $not: /__case_/ },
  }).select("key title checklistRole visaType visaTypes status").sort({ title: 1 }).lean();
  return rows.map((row) => ({ key: row.key, title: row.title, checklistRole: row.checklistRole || "", visaType: row.visaType || row.visaTypes?.[0] || "", status: row.status }));
}

// For the catalog: key -> title, for the checklists the registry rows name.
async function titlesForKeys(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await Questionnaire.find({ key: { $in: unique }, latestVersion: true }).select("key title").lean();
  return new Map(rows.map((row) => [row.key, row.title]));
}

async function loadRow(mappingId) {
  const row = await VisaFormMapping.findById(mappingId);
  if (!row) throw httpError(404, "Form mapping not found");
  return row;
}

async function setChecklistMappings(mappingId, { checklistMappings, provisioningType, triggerCondition } = {}, user, req) {
  const row = await loadRow(mappingId);
  const scope = require("./template-scope-sync.service");
  const wasQualifying = scope.qualifies(row);
  if (checklistMappings !== undefined) {
    const options = await listChecklistOptions();
    const knownKeys = new Set(options.map((option) => option.key));
    // a checklist that is already on the row stays valid even if it is no longer a listed template (never blocks saving the rest)
    (row.checklistMappings || []).forEach((entry) => knownKeys.add(entry.checklistKey));
    const roles = require("../../models/Questionnaire").CHECKLIST_ROLES;
    row.checklistMappings = sanitizeChecklistMappings(checklistMappings, { knownKeys, roles });
  }
  if (provisioningType !== undefined) {
    if (!VisaFormMapping.PROVISIONING_TYPES.includes(provisioningType)) throw httpError(400, `Assignment type must be one of: ${VisaFormMapping.PROVISIONING_TYPES.join(", ")}`);
    row.provisioningType = provisioningType;
  }
  if (triggerCondition !== undefined) row.triggerCondition = sanitizeCondition(triggerCondition, "triggerCondition");
  row.adminManaged = true;
  row.adminManagedAt = new Date();
  row.adminManagedBy = user?._id || null;
  await row.save();
  // the form template must name this visa type too, or a case of it reports "Configuration issue" instead of getting the form
  await scope.reconcileScopeAfterRowChange({ formCode: row.formTemplateFormCode || row.parentForm, visaType: row.visaType, wasQualifying, nowQualifying: scope.qualifies(row) });
  // the registry is cached by the form service: a change must be visible to the next case that is opened
  try { require("../uscis-forms/uscis-form.service").invalidateTemplateCache(); } catch (error) { /* cache only */ }
  await recordAuditEvent({
    req, action: "form_registry.checklist_mapping_updated", entityType: "visa_form_mapping", entityId: row._id,
    details: `${row.visaType} -> ${row.formNumber}: ${(row.checklistMappings || []).map((entry) => `${entry.checklistKey}:${entry.assignmentType}`).join(", ") || "no checklists"}; assignment ${row.provisioningType}`,
  }).catch(() => {});
  return row;
}

// How much of the form this checklist can actually fill: questions of the checklist that reach a field of this form's mapping.
async function autofillSummary(checklistKey, templateId) {
  if (!templateId) return { checked: false };
  try {
    const trace = await require("../form-mapping/services/ChecklistFieldTraceabilityService").traceQuestionsToFields(checklistKey, templateId);
    if (!trace.questionnaire) return { checked: true, found: false, questions: 0, fields: 0 };
    const fields = new Set();
    trace.results.forEach((question) => (question.fields || []).forEach((field) => fields.add(field.targetFieldId)));
    return { checked: true, found: true, questions: trace.results.length, fields: fields.size };
  } catch (error) {
    return { checked: false };
  }
}

function openCaseFilter(row) {
  return { visaType: row.visaType, status: { $nin: CLOSED_CASE_STATUSES }, parentCase: null };
}

// Puts the forms the registry now says apply onto this case (the same idempotent step case creation runs - a form the case already has is never touched
// or recreated), then autofills ONLY the forms that were just added from the case's canonical data. A form already on the case, and every field a person
// reviewed or edited, stays exactly as it is. A case with unresolved data conflicts gets the form but no autofill (the same safety rule "Generate USCIS
// Forms" applies); a failure on one form never stops the others.
async function provisionFormsForCase(caseData, user, req) {
  const uscisFormService = require("../uscis-forms/uscis-form.service");
  const AutoFillService = require("../form-mapping/services/AutoFillService");
  const logger = require("../../utils/logger");
  const targets = caseData.childCases?.length ? await Case.find({ _id: { $in: caseData.childCases } }) : [await Case.findById(caseData._id)];
  let added = 0;
  let autofilled = 0;
  for (const target of targets.filter(Boolean)) {
    let created = [];
    try {
      created = (await uscisFormService.ensureAssignedForms(target, user, req)) || [];
    } catch (error) {
      logger.error("apply_mapping_form_provisioning_failed", { caseId: String(target._id), error: error.message });
      continue;
    }
    added += created.length;
    const hasConflicts = (target.canonicalProfile?.conflicts || []).some((conflict) => conflict?.status === "pending_review");
    if (hasConflicts) continue;
    for (const form of created) {
      try {
        await AutoFillService.generate(target._id, form.formCode, user, req, { regenerate: false });
        autofilled += 1;
      } catch (error) {
        logger.error("apply_mapping_form_autofill_failed", { caseId: String(target._id), formCode: form.formCode, error: error.message });
      }
    }
  }
  return { added, autofilled };
}

// Cases already in progress. dryRun counts them; otherwise it provisions in pages (cursor = last case id) so one request never runs long.
async function applyToExistingCases(mappingId, { dryRun = true, cursor, limit = 20 } = {}, user, req) {
  const row = await loadRow(mappingId);
  const filter = openCaseFilter(row);
  if (dryRun) {
    const total = await Case.countDocuments(filter);
    const hasAuto = (row.checklistMappings || []).some((entry) => entry.assignmentType !== "EXPLICIT_CM");
    return { dryRun: true, visaType: row.visaType, formNumber: row.formNumber, total, hasAutomatic: hasAuto };
  }
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const pageFilter = cursor ? { ...filter, _id: { $gt: cursor } } : filter;
  const cases = await Case.find(pageFilter).sort({ _id: 1 }).limit(pageSize);
  const orchestrator = require("../cases/case-lifecycle-orchestrator.service");
  const Orchestrator = orchestrator.CaseLifecycleOrchestrator || orchestrator;
  const failed = [];
  let processed = 0;
  let formsAdded = 0;
  let formsAutofilled = 0;
  for (const caseData of cases) {
    try {
      // never throws by contract; it logs and skips what it cannot assign
      await Orchestrator.provisionChecklistAssignments(caseData, user, req);
      const forms = await provisionFormsForCase(caseData, user, req);
      formsAdded += forms.added;
      formsAutofilled += forms.autofilled;
      processed += 1;
    } catch (error) {
      failed.push({ caseId: String(caseData._id), caseNumber: caseData.caseNumber, error: error.message });
    }
  }
  const nextCursor = cases.length === pageSize ? String(cases[cases.length - 1]._id) : null;
  return { dryRun: false, visaType: row.visaType, processed, formsAdded, formsAutofilled, failed, nextCursor, done: !nextCursor };
}

module.exports = {
  ASSIGNMENT_TYPES,
  sanitizeCondition,
  sanitizeChecklistMappings,
  listChecklistOptions,
  titlesForKeys,
  setChecklistMappings,
  autofillSummary,
  applyToExistingCases,
};
