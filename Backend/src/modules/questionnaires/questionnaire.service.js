const crypto = require("crypto");
const Answer = require("../../models/Answer");
const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const Question = require("../../models/Question");
const QuestionLibraryItem = require("../../models/QuestionLibraryItem");
const Questionnaire = require("../../models/Questionnaire");
const caseService = require("../cases/case.service");
const participantService = require("../cases/case-participant.service");
const canonicalSyncService = require("../canonical/services/CanonicalSyncService");
const IntelligentQuestionnaireService = require("./intelligent-questionnaire.service");
const notificationService = require("../notifications/notification.service");
const storageService = require("../uploads/storage.service");
const workflowService = require("../workflows/workflow.service");
const logger = require("../../utils/logger");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("./employmentChecklists");
const { FAMILY_CHECKLIST_DEFINITIONS } = require("./familyChecklists");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("./singlePartyChecklists");
const { getAnswerValue, compareRule, evaluateConditionGroup } = require("./condition-evaluator");

const DESIGNER_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const REVIEW_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "paralegal", "reviewer"];
const READ_ROLES = [...REVIEW_ROLES, "client", "employer"];

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function createStageTimer() {
  const startedAt = Date.now();
  let lastAt = startedAt;
  const stages = [];
  return {
    mark(stage, meta = {}) {
      const now = Date.now();
      stages.push({ stage, durationMs: now - lastAt, ...meta });
      lastAt = now;
    },
    done() {
      return { durationMs: Date.now() - startedAt, stages };
    },
  };
}

function operationIdFor(req, payload = {}, status = "") {
  const explicit = req?.headers?.["idempotency-key"] || req?.headers?.["x-operation-id"] || payload.operationId;
  if (explicit) return String(explicit);
  const stablePayload = {
    questionnaireId: payload.questionnaireId,
    caseId: payload.caseId,
    responseId: payload.responseId,
    status,
    answers: (payload.answers || (payload.questionKey ? [{ questionKey: payload.questionKey, value: payload.value }] : []))
      .map((answer) => ({ questionKey: answer.questionKey, value: answer.value })),
  };
  return crypto.createHash("sha1").update(JSON.stringify(stablePayload)).digest("hex");
}

function sameId(left, right) {
  return Boolean(left && right && idOf(left) === idOf(right));
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function canDesign(user) {
  return DESIGNER_ROLES.includes(roleOf(user));
}

function canReview(user) {
  return REVIEW_ROLES.includes(roleOf(user));
}

function canReadQuestionnaires(user) {
  return READ_ROLES.includes(roleOf(user));
}

async function canAccessResponse(user, responseId) {
  if (!user || !responseId) return false;
  if (REVIEW_ROLES.includes(roleOf(user))) return true;
  const sample = await Answer.findOne({ responseId });
  if (!sample) return false;
  if (sameId(sample.user, user._id) || sameId(sample.clientId, user._id) || sameId(sample.assignedTo, user._id)) return true;
  if (sample.caseId) {
    const caseData = await Case.findById(sample.caseId);
    return caseService.canAccessCase(user, caseData);
  }
  return false;
}

function responseIdFor(questionnaireId, caseId, userId) {
  const raw = `${questionnaireId}:${caseId || "none"}:${userId || "anonymous"}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function normalizeQuestionType(type) {
  if (type === "multiselect") return "multi_select";
  if (type === "file-multiple") return "file";
  return type || "text";
}

function normalizeShowIf(showIf) {
  if (!showIf?.field) return undefined;
  const operatorMap = {
    greater_than: "gt",
    less_than: "lt",
    not_exists: "missing",
  };
  return {
    mode: "all",
    rules: [{
      questionKey: showIf.field,
      operator: operatorMap[showIf.operator] || showIf.operator || "equals",
      value: showIf.value,
    }],
    groups: [],
  };
}

function normalizeQuestionPayload(payload = {}) {
  const normalized = { ...payload };
  normalized.type = normalizeQuestionType(payload.type);
  if (payload.type && payload.type !== normalized.type) {
    normalized.metadata = { ...(payload.metadata || {}), requestedType: payload.type };
  }
  if (payload.description && !payload.helpText) normalized.helpText = payload.description;
  if (payload.showIf?.field) normalized.conditionalLogic = normalizeShowIf(payload.showIf);
  if (payload.isActive !== undefined) normalized.active = payload.isActive;
  if (payload.uscisMappings?.length && !payload.mapping?.uscisFieldPath) {
    const [firstMapping] = payload.uscisMappings;
    const [formNumber, ...pathParts] = String(firstMapping).split(".");
    normalized.mapping = {
      ...(payload.mapping || {}),
      uscisFormNumber: formNumber,
      uscisFieldPath: pathParts.join("."),
    };
  }
  return normalized;
}

function hasAnsweredValue(value) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function answerTriggersEvidenceRequest(question, value) {
  if (!question.evidenceCategory || !hasAnsweredValue(value)) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (Array.isArray(value)) return value.length > 0;
  return !["no", "false", "0", "none", "n/a"].includes(String(value).trim().toLowerCase());
}

function documentRequestName(question) {
  const label = question.evidenceCategory || question.label || "Evidence";
  return `${label} Evidence`.replace(/\s+Evidence Evidence$/i, " Evidence");
}

function getAnswerMapFromAnswers(answers = []) {
  return answers.reduce((map, answer) => {
    map[answer.questionKey] = answer;
    return map;
  }, {});
}

function addQuestionnaireAudit(questionnaire, action, user, changes = {}, req) {
  questionnaire.auditHistory.push({
    action,
    changes,
    performedBy: user?._id,
    performedAt: new Date(),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

async function writeAuditLog(action, entityType, entity, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType,
    entityId: entity?._id?.toString() || entity?.responseId || entity?.id,
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} ${entityType}`,
  }).catch(() => {});
}

function assertCanDesign(user, action = "manage questionnaires") {
  if (!canDesign(user)) {
    const error = new Error(`Not authorized to ${action}`);
    error.status = 403;
    throw error;
  }
}

function assertDraft(questionnaire) {
  if (questionnaire.status === "published") {
    const error = new Error("Published questionnaire content is immutable. Create a new version instead.");
    error.status = 409;
    throw error;
  }
}

function normalizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function setPath(target, path, value) {
  if (!path || value === undefined) return target;
  const parts = String(path).split(".").map((part) => part.trim()).filter(Boolean);
  let cursor = target;
  parts.forEach((part, index) => {
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
    const key = arrayMatch ? arrayMatch[1] : part;
    const isLast = index === parts.length - 1;
    if (arrayMatch) {
      const arrayIndex = Number(arrayMatch[2]);
      cursor[key] = Array.isArray(cursor[key]) ? cursor[key] : [];
      cursor[key][arrayIndex] = cursor[key][arrayIndex] || {};
      if (isLast) cursor[key][arrayIndex] = value;
      else cursor = cursor[key][arrayIndex];
      return;
    }
    if (isLast) {
      cursor[key] = value;
      return;
    }
    cursor[key] = cursor[key] && typeof cursor[key] === "object" && !Array.isArray(cursor[key]) ? cursor[key] : {};
    cursor = cursor[key];
  });
  return target;
}

function normalizeAnswerValue(question, value) {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeAnswerValue(question, item));
  if (typeof value === "object") return value;
  const stringValue = String(value).trim();
  switch (question.type) {
    case "email":
      return stringValue.toLowerCase();
    case "phone":
      return stringValue.replace(/[^\d+]/g, "");
    case "date":
    case "datetime": {
      const date = new Date(stringValue);
      return Number.isNaN(date.getTime()) ? stringValue : date.toISOString().slice(0, 10);
    }
    case "number":
    case "currency":
    case "percent":
      return stringValue === "" ? undefined : Number(stringValue);
    case "checkbox":
    case "boolean":
      if (typeof value === "boolean") return value;
      return ["yes", "true", "1", "on"].includes(stringValue.toLowerCase());
    default:
      return stringValue;
  }
}

function inferMasterDataPath(question) {
  if (question.mapping?.masterDataPath) return question.mapping.masterDataPath;
  if (question.mapping?.canonicalPath) return question.mapping.canonicalPath;
  if (question.metadata?.masterDataPath) return question.metadata.masterDataPath;
  const section = normalizePathSegment(question.sectionKey || "general");
  const key = normalizePathSegment(question.key);
  const sectionMap = {
    personal_information: "person",
    passport_information: "person.passport",
    passport: "person.passport",
    contact_information: "contact",
    address_history: "addresses",
    employment: "employment",
    employment_history: "employment",
    employer_information: "company",
    position_information: "employment[0]",
    education: "education",
    education_history: "education",
    immigration_history: "immigrationHistory",
    travel_history: "travelHistory",
    family: "family",
    family_information: "family",
    dependents: "dependents",
    criminal_history: "immigrationHistory.criminalHistory",
    security_questions: "immigrationHistory.security",
    previous_uscis_filings: "immigrationHistory.previousFilings",
    supporting_documents: "documents",
    declarations: "declarations",
    signatures: "signatures",
    evidence_uploads: "documents",
  };
  const root = sectionMap[section] || `questionnaire.${section}`;
  return `${root}.${key}`;
}

function buildMasterCaseData(questionnaire, questions, answerMap, user) {
  const masterData = {
    person: {},
    contact: {},
    employment: [],
    education: [],
    addresses: [],
    immigrationHistory: {},
    travelHistory: [],
    family: [],
    dependents: [],
    documents: [],
    questionnaire: {},
    metadata: {
      questionnaireId: questionnaire._id,
      questionnaireKey: questionnaire.key,
      questionnaireVersion: questionnaire.version,
      syncedAt: new Date(),
      syncedBy: user?._id,
    },
  };
  const fieldMetadata = {};
  questions.forEach((question) => {
    if (!isQuestionVisible(question, answerMap, user)) return;
    const rawValue = getAnswerValue(answerMap, question.key);
    if (!hasAnsweredValue(rawValue)) return;
    const normalizedValue = normalizeAnswerValue(question, rawValue);
    const path = inferMasterDataPath(question);
    setPath(masterData, path, normalizedValue);
    fieldMetadata[path] = {
      questionKey: question.key,
      questionId: question._id,
      libraryItemId: question.libraryItem,
      libraryKey: question.libraryKey,
      label: question.label,
      sectionKey: question.sectionKey,
      type: question.type,
      source: "questionnaire",
      confidence: 100,
      updatedAt: new Date(),
    };
  });
  return { masterData, fieldMetadata };
}

function isQuestionVisible(question, answerMap = {}, user) {
  const role = roleOf(user);
  const roles = question.visibility?.roles;
  if (roles?.length && !roles.includes(role)) {
    // A generic "client" portal account is the umbrella role for any
    // external signup - which persona (employer/employee) it's acting as
    // for a given case is already decided by which questionnaire got
    // resolved (checklistRole/targetRole in getQuestionnaireForCase), not
    // by the account's literal role. Only reject here when the question is
    // genuinely staff/internal-only (roles doesn't include any external
    // persona at all) - otherwise a "client" account would be locked out of
    // every employer/employee checklist question it was legitimately
    // assigned, which is exactly the workflow this is meant to support.
    // "petitioner"/"beneficiary" added for the family/sponsor visa (K-1/K-3)
    // path — same reasoning: a family petitioner is a plain "client" account
    // too, and must not be locked out of the petitioner checklist it was
    // legitimately assigned.
    const externalRoles = ["client", "employer", "employee", "petitioner", "beneficiary"];
    const isInternalOnly = !roles.some((value) => externalRoles.includes(value));
    if (isInternalOnly || role !== "client") return false;
  }
  return evaluateConditionGroup(question.conditionalLogic, answerMap);
}

function validateQuestionValue(question, value) {
  const errors = [];
  const warnings = [];
  const rules = [...(question.validationRules || [])];
  if (question.required && !rules.some((rule) => rule.type === "required")) rules.push({ type: "required" });
  for (const rule of rules) {
    const bucket = rule.severity === "warning" ? warnings : errors;
    if (rule.type === "required" && (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length))) {
      bucket.push(rule.message || `${question.label} is required`);
    }
    if (rule.type === "min" && Number(value) < Number(rule.value)) bucket.push(rule.message || `${question.label} is below minimum`);
    if (rule.type === "max" && Number(value) > Number(rule.value)) bucket.push(rule.message || `${question.label} exceeds maximum`);
    if (rule.type === "minLength" && String(value || "").length < Number(rule.value)) bucket.push(rule.message || `${question.label} is too short`);
    if (rule.type === "maxLength" && String(value || "").length > Number(rule.value)) bucket.push(rule.message || `${question.label} is too long`);
    if (rule.type === "regex" && rule.value && !new RegExp(rule.value).test(String(value || ""))) bucket.push(rule.message || `${question.label} has invalid format`);
    if (rule.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) bucket.push(rule.message || `${question.label} must be a valid email`);
    if (rule.type === "phone" && value && String(value).replace(/\D/g, "").length < Number(rule.value || 7)) bucket.push(rule.message || `${question.label} must be a valid phone number`);
    if (rule.type === "date" && value && Number.isNaN(new Date(value).getTime())) bucket.push(rule.message || `${question.label} must be a valid date`);
  }
  if (question.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push(`${question.label} must be a valid email`);
  if (question.type === "phone" && value && String(value).replace(/\D/g, "").length < 7) errors.push(`${question.label} must be a valid phone number`);
  if (["date", "datetime"].includes(question.type) && value && Number.isNaN(new Date(value).getTime())) errors.push(`${question.label} must be a valid date`);
  return { errors, warnings };
}

function validateResponse(questionnaire, questions, answerMap, user) {
  const errors = [];
  const warnings = [];
  const missingRequired = [];
  const seenUniqueValues = new Map();
  const visibleQuestions = questions.filter((question) => isQuestionVisible(question, answerMap, user));
  visibleQuestions.forEach((question) => {
    const value = getAnswerValue(answerMap, question.key);
    const validation = validateQuestionValue(question, value);
    validation.errors.forEach((message) => errors.push({ questionKey: question.key, label: question.label, message }));
    validation.warnings.forEach((message) => warnings.push({ questionKey: question.key, label: question.label, message }));
    if (question.required && !hasAnsweredValue(value)) missingRequired.push({ questionKey: question.key, label: question.label, sectionKey: question.sectionKey });
    if (question.metadata?.unique && hasAnsweredValue(value)) {
      const normalized = JSON.stringify(normalizeAnswerValue(question, value));
      if (seenUniqueValues.has(normalized)) {
        errors.push({ questionKey: question.key, label: question.label, message: `${question.label} duplicates ${seenUniqueValues.get(normalized)}` });
      } else {
        seenUniqueValues.set(normalized, question.label);
      }
    }
  });
  return {
    questionnaireId: questionnaire._id,
    questionnaireKey: questionnaire.key,
    questionnaireVersion: questionnaire.version,
    valid: errors.length === 0,
    errors,
    warnings,
    missingRequired,
    validatedAt: new Date(),
  };
}

function buildMappingOutput(questions, answerMap) {
  return questions.reduce((output, question) => {
    const mapping = question.mapping || {};
    if (!mapping.uscisFormNumber || !mapping.uscisFieldPath) return output;
    output[mapping.uscisFormNumber] = output[mapping.uscisFormNumber] || {};
    output[mapping.uscisFormNumber][mapping.uscisFieldPath] = getAnswerValue(answerMap, question.key);
    return output;
  }, {});
}

function calculateQuestionValue(question, answerMap) {
  const calculation = question.calculation || {};
  const dependencies = calculation.dependencies?.length ? calculation.dependencies : question.dependencies || [];
  const values = dependencies.map((key) => getAnswerValue(answerMap, key)).filter((value) => value !== undefined && value !== null && value !== "");
  if (calculation.operation === "sum") return values.reduce((total, value) => total + Number(value || 0), 0);
  if (calculation.operation === "count") return values.length;
  if (calculation.operation === "average") return values.length ? values.reduce((total, value) => total + Number(value || 0), 0) / values.length : 0;
  if (calculation.operation === "concat") return values.join(" ");
  return undefined;
}

function buildCalculatedFields(questions, answerMap) {
  return questions.reduce((output, question) => {
    if (question.type !== "computed" && question.type !== "number" && question.calculation?.operation === "none") return output;
    const value = calculateQuestionValue(question, answerMap);
    if (value !== undefined) output[question.key] = value;
    return output;
  }, {});
}

function copyQuestionnaireShape(questionnaire, overrides = {}) {
  const source = questionnaire.toObject ? questionnaire.toObject() : questionnaire;
  return {
    key: source.key,
    title: source.title,
    description: source.description,
    module: source.module,
    category: source.category,
    visaTypes: source.visaTypes,
    caseTypes: source.caseTypes,
    tags: source.tags,
    isTemplate: source.isTemplate,
    templateCategory: source.templateCategory,
    libraryVisibility: source.libraryVisibility,
    pages: source.pages,
    sections: source.sections,
    settings: source.settings,
    builder: source.builder,
    visibility: source.visibility,
    localization: source.localization,
    uscisMappings: source.uscisMappings,
    pdf: source.pdf,
    digitalSignature: source.digitalSignature,
    ...overrides,
  };
}

async function cloneQuestions(sourceQuestionnaireId, targetQuestionnaire, user) {
  const sourceQuestions = await Question.find({ questionnaire: sourceQuestionnaireId }).sort({ pageKey: 1, sectionKey: 1, order: 1 });
  const created = [];
  for (const question of sourceQuestions) {
    const copy = question.toObject();
    delete copy._id;
    delete copy.createdAt;
    delete copy.updatedAt;
    created.push(await Question.create({
      ...copy,
      questionnaire: targetQuestionnaire._id,
      questionnaireKey: targetQuestionnaire.key,
      questionnaireVersion: targetQuestionnaire.version,
      createdBy: user?._id,
      updatedBy: user?._id,
    }));
  }
  return created;
}

async function createQuestionnaire(payload, user, req) {
  assertCanDesign(user, "create questionnaires");
  const questionnaire = await Questionnaire.create({ ...payload, createdBy: user._id, updatedBy: user._id });
  if (!questionnaire.rootQuestionnaire) questionnaire.rootQuestionnaire = questionnaire._id;
  addQuestionnaireAudit(questionnaire, "create", user, payload, req);
  await questionnaire.save();
  await writeAuditLog("create", "questionnaire", questionnaire, user, payload, req);
  return questionnaire;
}

async function updateQuestionnaire(questionnaire, payload, user, req) {
  assertCanDesign(user, "update questionnaires");
  if (questionnaire.status === "published" && payload.status !== "archived") assertDraft(questionnaire);
  Object.assign(questionnaire, payload, { updatedBy: user._id });
  addQuestionnaireAudit(questionnaire, "update", user, payload, req);
  await questionnaire.save();
  await writeAuditLog("update", "questionnaire", questionnaire, user, payload, req);
  return questionnaire;
}

async function requestApproval(questionnaire, payload, user, req) {
  assertCanDesign(user, "request questionnaire approval");
  assertDraft(questionnaire);
  questionnaire.approval = {
    ...(questionnaire.approval?.toObject?.() || questionnaire.approval || {}),
    status: "pending_review",
    requestedBy: user._id,
    requestedAt: new Date(),
    notes: payload.notes,
    steps: payload.steps || questionnaire.approval?.steps || [],
  };
  addQuestionnaireAudit(questionnaire, "request_approval", user, payload, req);
  await questionnaire.save();
  await writeAuditLog("request_approval", "questionnaire", questionnaire, user, payload, req);
  return questionnaire;
}

async function approveQuestionnaireDefinition(questionnaire, payload, user, req) {
  if (!canReview(user)) {
    const error = new Error("Not authorized to approve questionnaire definitions");
    error.status = 403;
    throw error;
  }
  const approved = payload.approved !== false;
  questionnaire.approval = {
    ...(questionnaire.approval?.toObject?.() || questionnaire.approval || {}),
    status: approved ? "approved" : "rejected",
    reviewedBy: user._id,
    reviewedAt: new Date(),
    notes: payload.notes,
  };
  addQuestionnaireAudit(questionnaire, approved ? "approve_definition" : "reject_definition", user, payload, req);
  await questionnaire.save();
  await writeAuditLog(approved ? "approve_definition" : "reject_definition", "questionnaire", questionnaire, user, payload, req);
  return questionnaire;
}

async function publishQuestionnaire(questionnaire, user, req) {
  assertCanDesign(user, "publish questionnaires");
  if (questionnaire.settings?.requireReview && questionnaire.approval?.status && questionnaire.approval.status === "rejected") {
    const error = new Error("Rejected questionnaires cannot be published");
    error.status = 409;
    throw error;
  }
  questionnaire.status = "published";
  questionnaire.publishedAt = new Date();
  questionnaire.publishedBy = user._id;
  questionnaire.updatedBy = user._id;
  addQuestionnaireAudit(questionnaire, "publish", user, {}, req);
  await questionnaire.save();
  await writeAuditLog("publish", "questionnaire", questionnaire, user, {}, req);
  return questionnaire;
}

async function createNewVersion(questionnaire, user, req) {
  assertCanDesign(user, "version questionnaires");
  await Questionnaire.updateMany({ rootQuestionnaire: questionnaire.rootQuestionnaire || questionnaire._id }, { $set: { latestVersion: false } });
  const nextVersion = await Questionnaire.create(copyQuestionnaireShape(questionnaire, {
    version: questionnaire.version + 1,
    status: "draft",
    parentVersion: questionnaire._id,
    rootQuestionnaire: questionnaire.rootQuestionnaire || questionnaire._id,
    latestVersion: true,
    approval: { status: "draft" },
    createdBy: user._id,
    updatedBy: user._id,
  }));
  await cloneQuestions(questionnaire._id, nextVersion, user);
  addQuestionnaireAudit(nextVersion, "create_version", user, { source: questionnaire._id }, req);
  await nextVersion.save();
  await writeAuditLog("create_version", "questionnaire", nextVersion, user, { source: questionnaire._id }, req);
  return nextVersion;
}

async function cloneQuestionnaire(questionnaire, payload, user, req) {
  assertCanDesign(user, "clone questionnaires");
  const cloned = await Questionnaire.create(copyQuestionnaireShape(questionnaire, {
    key: payload.key || `${questionnaire.key}_copy_${Date.now()}`,
    title: payload.title || `${questionnaire.title} Copy`,
    version: 1,
    status: "draft",
    sourceQuestionnaire: questionnaire._id,
    rootQuestionnaire: undefined,
    latestVersion: true,
    isTemplate: payload.isTemplate ?? questionnaire.isTemplate,
    createdBy: user._id,
    updatedBy: user._id,
  }));
  cloned.rootQuestionnaire = cloned._id;
  await cloneQuestions(questionnaire._id, cloned, user);
  questionnaire.analytics.clonedCount += 1;
  await Promise.all([cloned.save(), questionnaire.save()]);
  await writeAuditLog("clone", "questionnaire", cloned, user, { source: questionnaire._id }, req);
  return cloned;
}

async function createQuestion(questionnaire, payload, user, req) {
  assertCanDesign(user, "manage questions");
  assertDraft(questionnaire);
  let normalizedPayload = normalizeQuestionPayload(payload);
  const libraryItemId = payload.libraryItemId || payload.libraryItem;
  if (libraryItemId) {
    const libraryItem = await QuestionLibraryItem.findById(libraryItemId);
    if (!libraryItem || !libraryItem.active) {
      const error = new Error("Active question library item not found");
      error.status = 404;
      throw error;
    }
    normalizedPayload = {
      key: payload.key || libraryItem.key.replace(/[^a-zA-Z0-9]+/g, "_"),
      sectionKey: payload.sectionKey || libraryItem.sectionKey,
      type: payload.type || libraryItem.type,
      label: payload.label || libraryItem.label,
      options: payload.options?.length ? payload.options : libraryItem.options,
      validationRules: payload.validationRules?.length ? payload.validationRules : libraryItem.validationRules,
      conditionalLogic: payload.conditionalLogic || libraryItem.conditionalLogic,
      dependencies: payload.dependencies?.length ? payload.dependencies : libraryItem.dependencies
        .map((dependency) => dependency.questionKey || dependency.sourceFieldId)
        .filter(Boolean),
      repeatable: payload.repeatable ?? libraryItem.repeatable,
      repeatableConfig: payload.repeatableConfig || libraryItem.repeatableConfig,
      required: payload.required ?? libraryItem.requirement === "required",
      ...normalizedPayload,
      mapping: {
        ...(normalizedPayload.mapping || {}),
        masterDataPath: normalizedPayload.mapping?.masterDataPath || libraryItem.canonicalPath,
        canonicalPath: normalizedPayload.mapping?.canonicalPath || libraryItem.canonicalPath,
      },
      metadata: {
        ...(normalizedPayload.metadata || {}),
        libraryRequirement: libraryItem.requirement,
        sourceForms: libraryItem.sourceForms,
      },
      libraryItem: libraryItem._id,
      libraryKey: libraryItem.key,
      libraryVersion: libraryItem.version,
    };
  }
  const question = await Question.create({
    ...normalizedPayload,
    questionnaire: questionnaire._id,
    questionnaireKey: questionnaire.key,
    questionnaireVersion: questionnaire.version,
    createdBy: user._id,
    updatedBy: user._id,
  });
  questionnaire.builder.questionOrder = Array.from(new Set([...(questionnaire.builder?.questionOrder || []), question.key]));
  addQuestionnaireAudit(questionnaire, "add_question", user, { questionId: question._id, key: question.key }, req);
  await questionnaire.save();
  await writeAuditLog("add_question", "questionnaire", questionnaire, user, { questionId: question._id }, req);
  return question;
}

async function bulkCreateQuestions(questionnaire, payload, user, req) {
  assertCanDesign(user, "bulk create questions");
  assertDraft(questionnaire);
  const created = [];
  for (const item of payload.questions || []) {
    created.push(await createQuestion(questionnaire, item, user, req));
  }
  return created;
}

async function updateQuestion(question, payload, user, req) {
  assertCanDesign(user, "manage questions");
  const questionnaire = await Questionnaire.findById(question.questionnaire);
  if (questionnaire) assertDraft(questionnaire);
  Object.assign(question, normalizeQuestionPayload(payload), { updatedBy: user._id });
  await question.save();
  await writeAuditLog("update", "question", question, user, payload, req);
  return question;
}

async function reorderQuestionnaire(questionnaire, payload, user, req) {
  assertCanDesign(user, "reorder questionnaire");
  assertDraft(questionnaire);
  if (payload.pageOrder) questionnaire.builder.pageOrder = payload.pageOrder;
  if (payload.sectionOrder) questionnaire.builder.sectionOrder = payload.sectionOrder;
  if (payload.questionOrder) questionnaire.builder.questionOrder = payload.questionOrder;
  const operations = (payload.questions || []).map((item) => Question.updateOne(
    { questionnaire: questionnaire._id, key: item.key },
    { $set: { order: item.order, pageKey: item.pageKey, sectionKey: item.sectionKey, groupKey: item.groupKey, updatedBy: user._id } }
  ));
  await Promise.all(operations);
  addQuestionnaireAudit(questionnaire, "reorder", user, payload, req);
  await questionnaire.save();
  await writeAuditLog("reorder", "questionnaire", questionnaire, user, payload, req);
  return questionnaire;
}

async function assignQuestionnaire(questionnaire, payload, user, req) {
  const caseData = await Case.findById(payload.caseId);
  if (!caseData) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }
  if (!caseService.canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to assign questionnaire to this case");
    error.status = 403;
    throw error;
  }
  const targetRole = payload.targetRole || questionnaire.checklistRole || "";
  const participant = payload.participantId
    ? participantService.findParticipant(caseData, { role: targetRole, participantId: payload.participantId })
    : participantService.findParticipant(caseData, { role: targetRole, userId: payload.assignedTo, email: payload.assignedEmail });
  const assignedTo = payload.assignedTo || participant?.userId || participantService.participantAssignee(caseData, targetRole) || caseData.user || caseData.clientProfile;
  const responseId = payload.responseId || responseIdFor(questionnaire._id, caseData._id, participant?._id || assignedTo);
  caseData.questionnaireReferences.push({
    questionnaireId: questionnaire._id,
    questionnaireTemplateId: questionnaire._id,
    responseId,
    title: questionnaire.title,
    targetRole,
    participantId: participant?._id,
    participantRole: participant?.role || participantService.normalizeParticipantRole(targetRole),
    status: "not_started",
    sentAt: new Date(),
    dueDate: payload.dueDate,
    assignedTo,
    sentBy: user._id,
    notes: payload.message,
  });
  if (participant) {
    participant.questionnaireId = questionnaire._id;
    participant.responseId = responseId;
    participant.progress = { ...(participant.progress?.toObject?.() || participant.progress || {}), status: "not_started" };
  }
  caseService.addTimelineEvent(caseData, "questionnaire", "Questionnaire Sent", `${questionnaire.title} sent`, user, { questionnaireId: questionnaire._id, responseId, participantId: participant?._id });
  caseService.addAuditEntry(caseData, "send_questionnaire", "Questionnaire sent", user, { questionnaireId: questionnaire._id, responseId, participantId: participant?._id }, req);
  await caseData.save();
  await caseService.writeAuditLog("send_questionnaire", caseData, user, { questionnaireId: questionnaire._id, responseId }, req);
  questionnaire.analytics.assignedCount += 1;
  await questionnaire.save();
  if (assignedTo) {
    const profileOnlyQuestionnaire = questionnaire.key === "i907_premium_processing_profile" || /i-?907|premium processing/i.test(questionnaire.title || "");
    await notificationService.createNotification({
      userId: assignedTo,
      type: "questionnaire_sent",
      title: "Questionnaire Available",
      message: payload.message || `Please complete ${questionnaire.title}.`,
      link: profileOnlyQuestionnaire ? "/dashboard/profile" : `/questionnaire/${responseId}`,
      caseId: caseData._id,
      source: "shared",
    }, user, req);
  }
  await workflowService.triggerWorkflow("questionnaire.sent", { caseId: caseData._id, questionnaireId: questionnaire._id, responseId }, user, req);
  return { responseId, case: caseData, questionnaire };
}

async function buildResponseState(responseId) {
  const answers = await Answer.find({ responseId }).populate("question").sort({ updatedAt: -1 });
  const answerMap = answers.reduce((map, answer) => {
    map[answer.questionKey] = answer;
    return map;
  }, {});
  const questionnaireId = answers[0]?.questionnaire;
  const questions = questionnaireId ? await Question.find({ questionnaire: questionnaireId, active: { $ne: false } }).sort({ pageKey: 1, sectionKey: 1, order: 1 }) : [];
  return { answers, answerMap, questions };
}

async function calculateCompletion(questionnaire, answerMap, user) {
  const questions = await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }).sort({ pageKey: 1, sectionKey: 1, order: 1 });
  const visibleQuestions = questions.filter((question) => isQuestionVisible(question, answerMap, user));
  const required = visibleQuestions.filter((question) => question.required);
  const answeredRequired = required.filter((question) => {
    const value = getAnswerValue(answerMap, question.key);
    return value !== undefined && value !== null && value !== "";
  });
  const answeredTotal = visibleQuestions.filter((question) => {
    const value = getAnswerValue(answerMap, question.key);
    return value !== undefined && value !== null && value !== "";
  });
  return {
    answeredRequired: answeredRequired.length,
    totalRequired: required.length,
    answeredTotal: answeredTotal.length,
    totalQuestions: visibleQuestions.length,
    percent: visibleQuestions.length ? Math.round((answeredTotal.length / visibleQuestions.length) * 100) : 0,
  };
}

function calculateSectionCompletion(questionnaire, visibleQuestions, answerMap) {
  return (questionnaire.sections || [])
    .filter((section) => section.isActive !== false)
    .sort((left, right) => (left.order || 0) - (right.order || 0))
    .map((section) => {
      const sectionQuestions = visibleQuestions.filter((question) => question.sectionKey === section.key);
      const answered = sectionQuestions.filter((question) => hasAnsweredValue(getAnswerValue(answerMap, question.key))).length;
      return {
        id: section._id,
        key: section.key,
        title: section.title,
        description: section.description,
        order: section.order,
        answeredQuestions: answered,
        visibleQuestions: sectionQuestions.length,
        completionPercentage: sectionQuestions.length ? Math.round((answered / sectionQuestions.length) * 100) : 100,
      };
    });
}

// Shared by calculateDetailedProgress's default path and by callers (e.g.
// listCaseChecklists) that need the visible-question list itself, not just
// the completion stats derived from it - see visibleQuestionsOverride below.
async function resolveVisibleQuestions(questionnaire, answerMap, user) {
  return (
    await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }).sort({ pageKey: 1, sectionKey: 1, order: 1 })
  ).filter((question) => isQuestionVisible(question, answerMap, user));
}

// visibleQuestionsOverride lets a caller that already fetched+filtered this
// questionnaire's questions (e.g. getQuestionnaireForCase) skip the redundant
// Question.find + isQuestionVisible pass this function used to always redo -
// confirmed as a real, measurable N+1 (getForCase ran the identical query
// twice per request; an employer-sponsored case's 3 simultaneous employer/
// business_plan/employee questionnaire fetches turned that into 6 Question
// queries instead of 3). Every other caller keeps the original self-contained
// behavior by simply omitting the 4th argument. It also lets a caller pass a
// filtered subset (e.g. file-type questions only) to get completion stats
// scoped to that subset instead of the whole questionnaire.
async function calculateDetailedProgress(questionnaire, answerMap, user, visibleQuestionsOverride) {
  const visibleQuestions = visibleQuestionsOverride || (await resolveVisibleQuestions(questionnaire, answerMap, user));
  const answeredQuestions = visibleQuestions.filter((question) => hasAnsweredValue(getAnswerValue(answerMap, question.key)));
  const required = visibleQuestions.filter((question) => question.required);
  const answeredRequiredKeys = new Set(
    required.filter((question) => hasAnsweredValue(getAnswerValue(answerMap, question.key))).map((question) => question.key)
  );
  const missingRequired = required
    .filter((question) => !answeredRequiredKeys.has(question.key))
    .map((question) => ({ key: question.key, label: question.label, type: question.type, evidenceCategory: question.evidenceCategory }));
  const completion = {
    answeredRequired: answeredRequiredKeys.size,
    totalRequired: required.length,
    answeredTotal: answeredQuestions.length,
    totalQuestions: visibleQuestions.length,
    percent: visibleQuestions.length ? Math.round((answeredQuestions.length / visibleQuestions.length) * 100) : 0,
  };
  return {
    ...completion,
    answeredQuestions: answeredQuestions.length,
    visibleQuestions: visibleQuestions.length,
    visibleQuestionKeys: visibleQuestions.map((question) => question.key),
    answeredQuestionKeys: answeredQuestions.map((question) => question.key),
    // Every required question still unanswered — the one place the "what's
    // still missing" list is computed, so every surface renders the same set.
    missingRequired,
    completionPercentage: completion.percent,
    sections: calculateSectionCompletion(questionnaire, visibleQuestions, answerMap),
  };
}

async function generateDocumentRequests({ questionnaire, caseData, answerMap, questions, user, req, persist = true }) {
  if (!caseData) return [];
  const existingItems = [...(caseData.checklistItems || []), ...(caseData.documentChecklist || [])];
  const existingNames = new Set(existingItems.map((item) => item.name));
  // Also dedup by documentType, not just name - a static registry document
  // (e.g. "Copy of the passport", documentType "passport") and a
  // questionnaire-generated evidence request for the same underlying
  // document (e.g. "Passport Evidence", documentType "passport") are the
  // same real-world requirement under different names, and must not both
  // appear as separate checklist rows.
  const existingDocumentTypes = new Set(existingItems.map((item) => item.documentType).filter(Boolean));
  const created = [];
  const requestedDate = new Date();

  for (const question of questions) {
    const value = getAnswerValue(answerMap, question.key);
    if (!answerTriggersEvidenceRequest(question, value)) continue;
    const name = documentRequestName(question);
    const documentType = question.evidenceCategory || question.key;
    if (existingNames.has(name) || existingDocumentTypes.has(documentType)) continue;

    const request = {
      name,
      description: `Generated from ${questionnaire.title}: ${question.label}`,
      required: Boolean(question.required),
      category: question.evidenceCategory || "evidence",
      documentType,
      status: "requested",
      requestedDate,
      notes: "Generated from questionnaire response",
    };
    if (persist) {
      caseData.checklistItems.push(request);
      caseData.documentChecklist.push(request);
    }
    existingNames.add(name);
    existingDocumentTypes.add(documentType);
    created.push(request);
  }

  if (persist && created.length) {
    caseService.addTimelineEvent(caseData, "document_request", "Document Requests Generated", `${created.length} questionnaire-based document request${created.length > 1 ? "s" : ""} generated`, user, {
      questionnaireId: questionnaire._id,
      requests: created.map((request) => request.name),
    });
    caseService.addAuditEntry(caseData, "generate_questionnaire_document_requests", "Questionnaire document requests generated", user, {
      questionnaireId: questionnaire._id,
      count: created.length,
    }, req);
    await caseData.save();
    await caseService.writeAuditLog("generate_questionnaire_document_requests", caseData, user, {
      questionnaireId: questionnaire._id,
      count: created.length,
    }, req);
  }

  return created;
}

function caseEvent(type, title, description, user, metadata = {}) {
  return { type, title, description, metadata, createdBy: user?._id, createdAt: new Date() };
}

function caseAudit(action, description, user, changes = {}, req) {
  return {
    action,
    description,
    changes,
    performedBy: user?._id,
    performedAt: new Date(),
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  };
}

async function addQuestionnaireDocumentRequestsAtomic(caseId, requests = [], questionnaire, user, req, operationId) {
  const inserted = [];
  for (const request of requests) {
    const query = {
      _id: caseId,
      "checklistItems.name": { $ne: request.name },
      "documentChecklist.name": { $ne: request.name },
    };
    // Same dedup widening as generateDocumentRequests' in-memory pre-check:
    // also guard against a documentType collision, not just a name
    // collision, so a race between two writers can't slip in a duplicate.
    if (request.documentType) {
      query["checklistItems.documentType"] = { $ne: request.documentType };
      query["documentChecklist.documentType"] = { $ne: request.documentType };
    }
    const result = await Case.updateOne(
      query,
      {
        $push: {
          checklistItems: request,
          documentChecklist: request,
        },
      }
    );
    if (result.modifiedCount) inserted.push(request);
  }
  if (!inserted.length) return [];
  const timeline = caseEvent("document_request", "Document Requests Generated", `${inserted.length} questionnaire-based document request${inserted.length > 1 ? "s" : ""} generated`, user, {
    questionnaireId: questionnaire._id,
    requests: inserted.map((request) => request.name),
    operationId,
  });
  const audit = caseAudit("generate_questionnaire_document_requests", "Questionnaire document requests generated", user, {
    questionnaireId: questionnaire._id,
    count: inserted.length,
    operationId,
  }, req);
  await Case.updateOne(
    { _id: caseId, "timeline.metadata.operationId": { $ne: operationId } },
    { $push: { timeline, auditHistory: audit } }
  );
  await caseService.writeAuditLog("generate_questionnaire_document_requests", { _id: caseId }, user, {
    questionnaireId: questionnaire._id,
    count: inserted.length,
    operationId,
  }, req);
  return inserted;
}

function flattenForSet(prefix, value, output = {}) {
  if (!value || typeof value !== "object" || value instanceof Date || Array.isArray(value)) {
    output[prefix] = value;
    return output;
  }
  Object.entries(value).forEach(([key, child]) => flattenForSet(`${prefix}.${key}`, child, output));
  return output;
}

async function applyQuestionnaireCaseSyncAtomic({ caseId, questionnaire, responseId, participantId, detailedProgress, responseValidation, masterCaseData, status, user, req, operationId }) {
  const now = new Date();
  const set = {
    "questionnaireData.responseId": responseId,
    "questionnaireData.questionnaireId": questionnaire._id,
    "questionnaireData.questionnaireKey": questionnaire.key,
    "questionnaireData.questionnaireVersion": questionnaire.version,
    "questionnaireData.progress": detailedProgress,
    "questionnaireData.validation": responseValidation,
    "questionnaireData.visibleQuestionKeys": detailedProgress.visibleQuestionKeys || [],
    "questionnaireData.answeredQuestionKeys": detailedProgress.answeredQuestionKeys || [],
    "questionnaireData.sectionProgress": detailedProgress.sections || [],
    "questionnaireData.lastSyncedAt": now,
    "questionnaireData.syncedBy": user?._id,
    "journeyProgress.metrics.questionnaire": detailedProgress,
    "journeyProgress.lastCalculatedAt": now,
    "journeyProgress.lastCalculatedBy": user?._id,
  };
  if (status === "auto_saved") set["questionnaireData.lastAutoSavedAt"] = now;
  if (status === "submitted") set["questionnaireData.lastSubmittedAt"] = now;
  flattenForSet("questionnaireData.masterData", masterCaseData.masterData || {}, set);
  if (participantId) {
    flattenForSet("participants.$[participant].canonicalProfile.profile", masterCaseData.masterData || {}, set);
    set["participants.$[participant].canonicalProfile.lastBuiltAt"] = now;
    set["participants.$[participant].canonicalProfile.lastBuiltBy"] = user?._id;
    set["participants.$[participant].canonicalProfile.source"] = "questionnaire_answers";
  }

  const nextReferenceStatus = status === "submitted"
    ? "submitted"
    : detailedProgress.totalRequired > 0 && detailedProgress.answeredRequired >= detailedProgress.totalRequired
      ? "completed"
      : "in_progress";

  const update = {
    $set: {
      ...set,
      "questionnaireReferences.$[reference].status": nextReferenceStatus,
      ...(status === "submitted" ? { "questionnaireReferences.$[reference].submittedAt": now } : {}),
      ...(participantId ? {
        "participants.$[participant].progress.status": nextReferenceStatus,
        "participants.$[participant].progress.percent": detailedProgress.percent || 0,
        "participants.$[participant].progress.questionnaire": detailedProgress,
        "participants.$[participant].progress.lastCalculatedAt": now,
        "participants.$[participant].submissionStatus": status === "submitted" ? "submitted" : "in_progress",
      } : {}),
    },
  };

  const timeline = caseEvent("questionnaire", status === "submitted" ? "Questionnaire Submitted" : "Questionnaire Auto Saved", `${questionnaire.title} ${status === "submitted" ? "submitted" : "auto-saved"}`, user, {
    responseId,
    participantId,
    questionnaireId: questionnaire._id,
    progress: detailedProgress.percent,
    operationId,
  });
  const audit = caseAudit(status === "submitted" ? "submit_questionnaire_answers" : "autosave_questionnaire_answers", "Questionnaire answers synchronized to master case data", user, {
    responseId,
    participantId,
    questionnaireId: questionnaire._id,
    progress: detailedProgress.percent,
    validation: { errors: responseValidation.errors.length, warnings: responseValidation.warnings.length },
    operationId,
  }, req);

  const baseFilter = { _id: caseId };
  const options = {
    arrayFilters: [{
      "reference.responseId": responseId,
      "reference.active": { $ne: false },
      "reference.status": { $nin: ["returned", "approved"] },
    }, ...(participantId ? [{ "participant._id": participantId }] : [])],
  };
  await Case.updateOne(baseFilter, update, options);
  await Case.updateOne(
    { _id: caseId, "timeline.metadata.operationId": { $ne: operationId } },
    { $push: { timeline, auditHistory: audit } }
  );
}

async function saveAnswers(payload, user, req, status = "auto_saved") {
  const operationId = operationIdFor(req, payload, status);
  const questionnaire = await Questionnaire.findById(payload.questionnaireId);
  if (!questionnaire) {
    const error = new Error("Questionnaire not found");
    error.status = 404;
    throw error;
  }
  let caseData;
  if (payload.caseId) {
    caseData = await Case.findById(payload.caseId);
    if (!caseService.canAccessCase(user, caseData)) {
      const error = new Error("Not authorized to answer this questionnaire");
      error.status = 403;
      throw error;
    }
  }
  const targetRole = payload.targetRole || questionnaire.checklistRole || "";
  const participant = caseData
    ? (participantService.findParticipant(caseData, { role: targetRole, participantId: payload.participantId, userId: payload.assignedTo || user?._id, email: payload.assignedEmail || user?.email }) ||
      (payload.participantId ? null : participantService.participantForUser(caseData, user, targetRole)))
    : null;
  const participantId = participant?._id || payload.participantId;
  const responseOwner = participantId || payload.assignedTo || user?._id;
  const responseId = payload.responseId || responseIdFor(questionnaire._id, payload.caseId, responseOwner);
  const questions = await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } });
  const questionByKey = questions.reduce((map, question) => {
    map[question.key] = question;
    return map;
  }, {});
  const previous = await Answer.find({ responseId });
  const answerMap = previous.reduce((map, answer) => {
    map[answer.questionKey] = answer;
    return map;
  }, {});
  const saved = [];
  const answerItems = payload.answers || (payload.questionKey ? [{ questionKey: payload.questionKey, value: payload.value, files: payload.files }] : []);
  for (const item of answerItems) {
    const question = questionByKey[item.questionKey];
    if (!question) continue;
    const visible = isQuestionVisible(question, { ...answerMap, [item.questionKey]: { value: item.value } }, user);
    if (status === "submitted") {
      const validation = validateQuestionValue(question, item.value);
      if (visible && validation.errors.length) {
        const error = new Error(validation.errors.join("; "));
        error.status = 400;
        throw error;
      }
    }
    const answer = await Answer.findOneAndUpdate(
      { responseId, questionKey: item.questionKey },
      {
        $set: {
          questionnaire: questionnaire._id,
          questionnaireKey: questionnaire.key,
          questionnaireVersion: questionnaire.version,
          question: question._id,
          questionKey: question.key,
          caseId: payload.caseId,
          participantId,
          participantRole: participant?.role || participantService.normalizeParticipantRole(targetRole),
          user: user?._id || payload.userId,
          clientId: payload.clientId || user?._id,
          client: payload.client || caseData?.clientProfile,
          beneficiary: payload.beneficiary || caseData?.beneficiary,
          companyId: payload.companyId || caseData?.companyId,
          assignedTo: payload.assignedTo || user?._id,
          assignedBy: payload.assignedBy,
          dueDate: payload.dueDate,
          value: item.value,
          normalizedValue: item.normalizedValue ?? normalizeAnswerValue(question, item.value),
          files: item.files || [],
          locale: payload.locale || questionnaire.settings?.defaultLocale || "en",
          currentStep: payload.currentStep || "",
          currentPageKey: item.pageKey || payload.currentPageKey,
          currentSectionKey: item.sectionKey || payload.currentSectionKey,
          branchPath: payload.branchPath || [],
          visible,
          status,
          masterDataPath: inferMasterDataPath(question),
          validation: {
            ...validateQuestionValue(question, item.value),
            validatedAt: new Date(),
          },
          startedAt: previous.length ? undefined : new Date(),
          lastAutoSavedAt: status === "auto_saved" ? new Date() : undefined,
        },
        // Folded into the same write as the $set above (was a separate
        // addAnswerAudit() + answer.save() round-trip) — same audit entry,
        // one write instead of two per answer.
        $push: {
          auditHistory: {
            action: status,
            changes: { value: item.value },
            performedBy: user?._id,
            performedAt: new Date(),
            ipAddress: req?.ip,
            userAgent: req?.headers?.["user-agent"],
          },
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    answerMap[item.questionKey] = answer;
    saved.push(answer);
  }
  const completion = await calculateCompletion(questionnaire, answerMap, user);
  const detailedProgress = await calculateDetailedProgress(questionnaire, answerMap, user);
  const mappingOutput = buildMappingOutput(questions, answerMap);
  const calculatedFields = buildCalculatedFields(questions, answerMap);
  const responseValidation = validateResponse(questionnaire, questions, answerMap, user);
  const masterCaseData = buildMasterCaseData(questionnaire, questions, answerMap, user);
  await Answer.updateMany({ responseId }, { $set: { completion, mappingOutput, calculatedFields, masterDataSnapshot: masterCaseData.masterData } });
  const documentRequests = await generateDocumentRequests({ questionnaire, caseData, answerMap, questions, user, req, persist: false });
  if (status === "auto_saved" && !previous.length) {
    questionnaire.analytics.startedCount += 1;
  }
  questionnaire.analytics.averageCompletionPercent = Math.round(((questionnaire.analytics.averageCompletionPercent || 0) + completion.percent) / 2);
  await questionnaire.save();
  await writeAuditLog(status, "answer", { responseId }, user, { questionnaireId: questionnaire._id, count: saved.length }, req);
  if (caseData) {
    // Merge onto the prior masterData rather than replacing it outright —
    // masterData also carries extension keys this rebuild doesn't know about
    // (e.g. employment-workflow's employeeQuestionnaireAssignment, set by
    // saveEmployeeQuestionnaire/inviteEmployee). A wholesale replacement here
    // silently erased that mode flag the moment any answer was saved.
    const priorMasterData = caseData.questionnaireData?.masterData;
    caseData.questionnaireData = {
      masterData: {
        ...(priorMasterData?.toObject ? priorMasterData.toObject() : (priorMasterData || {})),
        ...masterCaseData.masterData,
      },
      responseId,
      questionnaireId: questionnaire._id,
      questionnaireKey: questionnaire.key,
      questionnaireVersion: questionnaire.version,
      progress: detailedProgress,
      validation: responseValidation,
      visibleQuestionKeys: detailedProgress.visibleQuestionKeys || [],
      answeredQuestionKeys: detailedProgress.answeredQuestionKeys || [],
      sectionProgress: detailedProgress.sections || [],
      lastAutoSavedAt: status === "auto_saved" ? new Date() : caseData.questionnaireData?.lastAutoSavedAt,
      lastSubmittedAt: status === "submitted" ? new Date() : caseData.questionnaireData?.lastSubmittedAt,
      lastSyncedAt: new Date(),
      syncedBy: user?._id,
    };
    caseData.journeyProgress = {
      ...(caseData.journeyProgress?.toObject?.() || caseData.journeyProgress || {}),
      metrics: {
        ...(caseData.journeyProgress?.metrics || {}),
        questionnaire: detailedProgress,
      },
      lastCalculatedAt: new Date(),
      lastCalculatedBy: user?._id,
    };
    caseService.addTimelineEvent(caseData, "questionnaire", status === "submitted" ? "Questionnaire Submitted" : "Questionnaire Auto Saved", `${questionnaire.title} ${status === "submitted" ? "submitted" : "auto-saved"}`, user, {
      responseId,
      questionnaireId: questionnaire._id,
      progress: detailedProgress.percent,
    });
    caseService.addAuditEntry(caseData, status === "submitted" ? "submit_questionnaire_answers" : "autosave_questionnaire_answers", "Questionnaire answers synchronized to master case data", user, {
      responseId,
      questionnaireId: questionnaire._id,
      progress: detailedProgress.percent,
      validation: { errors: responseValidation.errors.length, warnings: responseValidation.warnings.length },
    }, req);
    // Checklist lifecycle: not_started -> in_progress on the first answer,
    // -> completed once every visible required question is answered.
    // submitResponse forces "submitted" right after calling saveAnswers, so
    // this only needs to run for autosaves.
    if (status !== "submitted") {
      const reference = caseData.questionnaireReferences.find((item) => item.responseId === responseId);
      if (reference && reference.active !== false && !["returned", "approved"].includes(reference.status)) {
        if (reference.status === "not_started") reference.status = "in_progress";
        if (reference.status === "in_progress" && detailedProgress.totalRequired > 0 && detailedProgress.answeredRequired >= detailedProgress.totalRequired) {
          reference.status = "completed";
        }
      }
    }
    await addQuestionnaireDocumentRequestsAtomic(caseData._id, documentRequests, questionnaire, user, req, `${operationId}:document_requests`);
    await applyQuestionnaireCaseSyncAtomic({
      caseId: caseData._id,
      questionnaire,
      responseId,
      participantId,
      detailedProgress,
      responseValidation,
      masterCaseData,
      status,
      user,
      req,
      operationId,
    });
    await caseService.writeAuditLog(status === "submitted" ? "submit_questionnaire_answers" : "autosave_questionnaire_answers", caseData, user, {
      responseId,
      participantId,
      questionnaireId: questionnaire._id,
      progress: detailedProgress.percent,
      operationId,
    }, req);
    await require("../uscis-forms/uscis-form.service").markCaseFormsStale(caseData._id, "questionnaire_master_data_changed", Object.keys(masterCaseData.fieldMetadata || {})).catch(() => null);
    await canonicalSyncService.syncCase(caseData._id, user, req, "questionnaire_answers_changed").catch(() => null);
  }
  return { responseId, completion, progress: detailedProgress, validation: responseValidation, masterData: masterCaseData.masterData, mappingOutput, calculatedFields, answers: saved, documentRequests };
}

async function storeAnswerFiles(files = [], context = {}) {
  const uploaded = [];
  for (const file of files) {
    const key = storageService.generateDocumentKey({
      caseId: context.caseId,
      userId: context.userId,
      originalName: file.originalname,
    }).replace("documents", "questionnaire-answers");
    const stored = await storageService.storeBuffer(key, file.buffer);
    uploaded.push({
      originalName: file.originalname,
      storageKey: stored.key,
      url: stored.url,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date(),
    });
  }
  return uploaded;
}

async function saveFileAnswer(payload, files, user, req) {
  const storedFiles = await storeAnswerFiles(files, { caseId: payload.caseId, userId: user?._id });
  return saveAnswers({
    ...payload,
    answers: [{
      questionKey: payload.questionKey,
      value: storedFiles.map((file) => file.originalName),
      files: storedFiles,
    }],
  }, user, req, "auto_saved");
}

// Symmetric counterpart to syncFileAnswerFromDocument, called when a Document
// is deleted: drops the deleted file from whichever Answer it was synced onto,
// deleting the Answer outright if that was its only file, so the question
// reverts to genuinely unanswered (getAnswerValue would otherwise treat a
// merely-nulled-out value as truthy — see getAnswerValue's `?? answerMap[key]`
// fallback — so "delete the Answer" is the only correct way to un-answer it).
async function removeFileAnswerForDocument(document) {
  if (!document?._id) return null;
  const answer = await Answer.findOne({ "files.documentId": document._id });
  if (!answer) return null;
  const remainingFiles = (answer.files || []).filter((file) => String(file.documentId) !== String(document._id));
  if (remainingFiles.length) {
    answer.files = remainingFiles;
    answer.value = remainingFiles.map((file) => file.originalName);
    await answer.save();
  } else {
    await Answer.deleteOne({ _id: answer._id });
  }
  return { responseId: answer.responseId, questionKey: answer.questionKey };
}

// Bridges the Document-upload flow (POST /documents/*, what every upload UI
// actually calls) into the questionnaire Answer system (what
// calculateDetailedProgress measures) so uploading a document that matches an
// assigned questionnaire's file-type question counts as answering it — without
// this, file-type question completeness could never reach 100% via real
// uploads, since Answer.files/saveFileAnswer is otherwise a separate storage
// path from the Document model entirely. Reuses saveAnswers (no parallel
// completion math); best-effort per reference so one bad match can't fail an
// upload. Returns the list of {questionnaireId, questionKey, responseId} synced.
async function syncFileAnswerFromDocument(caseData, document, user, req) {
  if (!caseData || !document?.documentType) return [];
  const activeReferences = (caseData.questionnaireReferences || []).filter((reference) => reference.active !== false && reference.questionnaireId);
  const synced = [];
  for (const reference of activeReferences) {
    try {
      const question = await Question.findOne({
        questionnaire: reference.questionnaireId,
        type: "file",
        "metadata.documentType": document.documentType,
        active: { $ne: false },
      });
      if (!question) continue;
      const result = await saveAnswers({
        questionnaireId: reference.questionnaireId,
        caseId: caseData._id,
        responseId: reference.responseId,
        assignedTo: reference.assignedTo,
        questionKey: question.key,
        value: [document.originalName],
        files: [{
          documentId: document._id,
          originalName: document.originalName,
          storageKey: document.storageKey,
          url: document.documentUrl,
          size: document.size,
          mimeType: document.mimeType,
          uploadedAt: new Date(),
        }],
      }, user, req, "auto_saved");
      synced.push({ questionnaireId: reference.questionnaireId, questionKey: question.key, responseId: result.responseId });
    } catch {
      // Best-effort: a misconfigured question/questionnaire must never fail a real upload.
    }
  }
  return synced;
}

async function submitResponse(payload, user, req) {
  const result = await saveAnswers(payload, user, req, "submitted");
  if (result.completion.answeredRequired < result.completion.totalRequired) {
    const error = new Error("Required questionnaire fields are incomplete");
    error.status = 400;
    throw error;
  }
  const now = new Date();
  await Answer.updateMany({ responseId: result.responseId }, { $set: { status: "submitted", submittedAt: now } });
  const questionnaire = await Questionnaire.findById(payload.questionnaireId);
  if (questionnaire) {
    questionnaire.analytics.submittedCount += 1;
    questionnaire.analytics.lastSubmittedAt = now;
    await questionnaire.save();
  }
  if (payload.caseId) {
    const caseData = await Case.findById(payload.caseId);
    if (caseData) {
      const reference = caseData.questionnaireReferences.find((item) => item.questionnaireId?.toString() === payload.questionnaireId?.toString());
      if (reference) {
        reference.status = "submitted";
        reference.submittedAt = now;
      }
      caseService.addTimelineEvent(caseData, "questionnaire", "Questionnaire Submitted", "Questionnaire submitted", user, { responseId: result.responseId });
      caseService.addAuditEntry(caseData, "submit_questionnaire", "Questionnaire submitted", user, { responseId: result.responseId }, req);
      await caseData.save();
      await caseService.writeAuditLog("submit_questionnaire", caseData, user, { responseId: result.responseId }, req);
      await workflowService.triggerWorkflow("questionnaire.submitted", { caseId: caseData._id, questionnaireId: payload.questionnaireId, responseId: result.responseId }, user, req);
      // Dynamic checklist assignment: evaluate this questionnaire's
      // checklistTriggers against the full answer set (not just what was in
      // this submit's payload - earlier autosaves may hold the triggering
      // answer) and assign/remove any dependent checklists. Best-effort - a
      // misconfigured rule must never fail a real submit.
      await Answer.find({ responseId: result.responseId }).then((allAnswers) => (
        require("./checklist-rule-engine.service").evaluateChecklistTriggers(caseData._id, questionnaire, getAnswerMapFromAnswers(allAnswers), user, req)
      )).catch(() => null);
      await require("../cases/case-lifecycle-orchestrator.service").recalculate(caseData._id, user, req, "questionnaire_submitted").catch(() => null);
    }
  }
  return result;
}

async function approveResponse(responseId, payload, user, req) {
  if (!canReview(user)) {
    const error = new Error("Not authorized to review questionnaire responses");
    error.status = 403;
    throw error;
  }
  const answers = await Answer.find({ responseId });
  if (!answers.length) {
    const error = new Error("Questionnaire response not found");
    error.status = 404;
    throw error;
  }
  const approved = payload.approved !== false;
  const status = approved ? "approved" : "rejected"; // Answer.status - unrelated to the checklist reference's own status below
  const referenceStatus = approved ? "approved" : "returned"; // Case.questionnaireReferences.status - the 6-state checklist lifecycle
  const now = new Date();
  await Answer.updateMany({ responseId }, {
    $set: {
      status,
      reviewedAt: now,
      reviewedBy: user._id,
      reviewNotes: payload.notes,
      approvedAt: status === "approved" ? now : undefined,
      approvedBy: status === "approved" ? user._id : undefined,
      rejectedAt: status === "rejected" ? now : undefined,
      rejectionReason: payload.reason,
    },
  });
  const first = answers[0];
  if (first.caseId) {
    const caseData = await Case.findById(first.caseId);
    if (caseData) {
      const reference = caseData.questionnaireReferences.find((item) => item.questionnaireId?.toString() === first.questionnaire?.toString());
      if (reference) {
        reference.status = referenceStatus;
        if (approved) reference.approvedAt = now;
      }
      caseService.addTimelineEvent(caseData, "questionnaire", approved ? "Questionnaire Approved" : "Questionnaire Returned", payload.reason || `Questionnaire ${referenceStatus}`, user, { responseId });
      caseService.addAuditEntry(caseData, `${referenceStatus}_questionnaire`, `Questionnaire ${referenceStatus}`, user, { responseId, reason: payload.reason }, req);
      await caseData.save();
      await caseService.writeAuditLog(`${referenceStatus}_questionnaire`, caseData, user, { responseId, reason: payload.reason }, req);
      await workflowService.triggerWorkflow(approved ? "questionnaire.approved" : "questionnaire.rejected", { caseId: caseData._id, questionnaireId: first.questionnaire, responseId }, user, req);
      await require("../cases/case-lifecycle-orchestrator.service").recalculate(caseData._id, user, req, `questionnaire_${referenceStatus}`).catch(() => null);
    }
  }
  await writeAuditLog(status, "answer", { responseId }, user, payload, req);
  return Answer.find({ responseId }).populate("question").sort({ updatedAt: -1 });
}

async function getVisibleQuestions(questionnaireId, responseId, user) {
  const questionnaire = await Questionnaire.findById(questionnaireId);
  if (!questionnaire) {
    const error = new Error("Questionnaire not found");
    error.status = 404;
    throw error;
  }
  const questions = await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }).sort({ pageKey: 1, sectionKey: 1, order: 1 });
  const answers = responseId ? await Answer.find({ responseId }) : [];
  const answerMap = answers.reduce((map, answer) => {
    map[answer.questionKey] = answer;
    return map;
  }, {});
  const visibleQuestions = questions.filter((question) => isQuestionVisible(question, answerMap, user));
  return { questionnaire, questions: visibleQuestions, completion: await calculateCompletion(questionnaire, answerMap, user) };
}

async function exportQuestionnaire(questionnaire, user, req) {
  const questions = await Question.find({ questionnaire: questionnaire._id }).sort({ pageKey: 1, sectionKey: 1, order: 1 });
  questionnaire.importExport.exportedAt = new Date();
  questionnaire.importExport.exportedBy = user?._id;
  await questionnaire.save();
  await writeAuditLog("export", "questionnaire", questionnaire, user, {}, req);
  return { questionnaire, questions, exportedAt: questionnaire.importExport.exportedAt };
}

async function importQuestionnaire(payload, user, req) {
  assertCanDesign(user, "import questionnaires");
  const source = payload.questionnaire || payload;
  const questionnaire = await createQuestionnaire({
    ...source,
    key: payload.key || source.key || `imported_${Date.now()}`,
    title: payload.title || source.title || "Imported Questionnaire",
    status: "draft",
    version: 1,
    importExport: {
      importedFrom: payload.importedFrom || "json",
      importedAt: new Date(),
      importedBy: user._id,
    },
  }, user, req);
  for (const question of payload.questions || []) {
    const copy = { ...question };
    delete copy._id;
    await createQuestion(questionnaire, copy, user, req);
  }
  return questionnaire;
}

function makeQuestion(key, label, type, sectionKey, order, extras = {}) {
  return normalizeQuestionPayload({
    key,
    label,
    type,
    sectionKey,
    pageKey: sectionKey,
    order,
    required: Boolean(extras.required),
    options: (extras.options || []).map((value) => typeof value === "object" ? value : { label: value, value }),
    placeholder: extras.placeholder,
    description: extras.description,
    showIf: extras.showIf,
    uscisMappings: extras.uscisMappings || [],
    eligibilityWeight: extras.eligibilityWeight || 0,
    evidenceCategory: extras.evidenceCategory,
    validationRules: extras.validationRules || [],
    metadata: extras.metadata || {},
    fileConstraints: extras.fileConstraints || {},
  });
}

const VISA_TEMPLATE_DEFINITIONS = [
  {
    key: "i907_premium_processing_profile",
    title: "Form I-907 Information Checklist",
    visaType: "I-907",
    description: "Premium Processing add-on intake fields used to prepare Form I-907 for an existing eligible case.",
    sections: ["Information About the Person Filing This Request", "Information About the Request"],
    questions: [
      makeQuestion("i907AlienRegistrationNumber", "Alien Registration Number (A-Number)", "text", "information_about_the_person_filing_this_request", 1, { uscisMappings: ["I907.part1.aNumber"], metadata: { profileField: "i907.alienRegistrationNumber" } }),
      makeQuestion("i907OnlineAccountNumber", "USCIS Online Account Number", "text", "information_about_the_person_filing_this_request", 2, { uscisMappings: ["I907.part1.uscisOnlineAccountNumber"], metadata: { profileField: "i907.uscisOnlineAccountNumber" } }),
      makeQuestion("i907FilerFamilyName", "Family Name (Last Name)", "text", "information_about_the_person_filing_this_request", 3, { required: true, uscisMappings: ["I907.part1.filer.lastName"], metadata: { profileField: "i907.filerFamilyName" } }),
      makeQuestion("i907FilerGivenName", "Given Name (First Name)", "text", "information_about_the_person_filing_this_request", 4, { required: true, uscisMappings: ["I907.part1.filer.firstName"], metadata: { profileField: "i907.filerGivenName" } }),
      makeQuestion("i907CompanyOrganizationName", "Company or Organization Named in the Related Case", "text", "information_about_the_person_filing_this_request", 5, { uscisMappings: ["I907.part1.companyOrganizationName"], metadata: { profileField: "i907.companyOrganizationName" } }),
      makeQuestion("i907MailingStreet", "Mailing Street Number and Name", "text", "information_about_the_person_filing_this_request", 6, { required: true, uscisMappings: ["I907.part1.mailingAddress.street"], metadata: { profileField: "i907.mailingStreet" } }),
      makeQuestion("i907MailingApt", "Mailing Apt/Ste/Flr", "text", "information_about_the_person_filing_this_request", 7, { uscisMappings: ["I907.part1.mailingAddress.apt" ], metadata: { profileField: "i907.mailingApt" } }),
      makeQuestion("i907MailingCity", "Mailing City or Town", "text", "information_about_the_person_filing_this_request", 8, { required: true, metadata: { profileField: "i907.mailingCity" } }),
      makeQuestion("i907MailingState", "Mailing State", "text", "information_about_the_person_filing_this_request", 9, { required: true, metadata: { profileField: "i907.mailingState" } }),
      makeQuestion("i907MailingZipCode", "Mailing ZIP Code", "text", "information_about_the_person_filing_this_request", 10, { required: true, metadata: { profileField: "i907.mailingZipCode" } }),
      makeQuestion("i907MailingProvince", "Mailing Province", "text", "information_about_the_person_filing_this_request", 11, { metadata: { profileField: "i907.mailingProvince" } }),
      makeQuestion("i907MailingPostalCode", "Mailing Postal Code", "text", "information_about_the_person_filing_this_request", 12, { metadata: { profileField: "i907.mailingPostalCode" } }),
      makeQuestion("i907MailingCountry", "Mailing Country", "text", "information_about_the_person_filing_this_request", 13, { required: true, metadata: { profileField: "i907.mailingCountry" } }),
      makeQuestion("i907SamePhysicalAddress", "Is your current mailing address the same as your physical address?", "radio", "information_about_the_person_filing_this_request", 14, { required: true, options: ["Yes", "No"], metadata: { profileField: "i907.samePhysicalAddress" } }),
      makeQuestion("i907PhysicalStreet", "Physical Street Number and Name", "text", "information_about_the_person_filing_this_request", 15, { showIf: { field: "i907SamePhysicalAddress", operator: "equals", value: "No" }, metadata: { profileField: "i907.physicalStreet" } }),
      makeQuestion("i907PhysicalApt", "Physical Apt/Ste/Flr", "text", "information_about_the_person_filing_this_request", 16, { showIf: { field: "i907SamePhysicalAddress", operator: "equals", value: "No" }, metadata: { profileField: "i907.physicalApt" } }),
      makeQuestion("i907PhysicalCity", "Physical City or Town", "text", "information_about_the_person_filing_this_request", 17, { showIf: { field: "i907SamePhysicalAddress", operator: "equals", value: "No" }, metadata: { profileField: "i907.physicalCity" } }),
      makeQuestion("i907PhysicalState", "Physical State", "text", "information_about_the_person_filing_this_request", 18, { showIf: { field: "i907SamePhysicalAddress", operator: "equals", value: "No" }, metadata: { profileField: "i907.physicalState" } }),
      makeQuestion("i907PhysicalZipCode", "Physical ZIP Code", "text", "information_about_the_person_filing_this_request", 19, { showIf: { field: "i907SamePhysicalAddress", operator: "equals", value: "No" }, metadata: { profileField: "i907.physicalZipCode" } }),
      makeQuestion("i907PhysicalProvince", "Physical Province", "text", "information_about_the_person_filing_this_request", 20, { showIf: { field: "i907SamePhysicalAddress", operator: "equals", value: "No" }, metadata: { profileField: "i907.physicalProvince" } }),
      makeQuestion("i907PhysicalPostalCode", "Physical Postal Code", "text", "information_about_the_person_filing_this_request", 21, { showIf: { field: "i907SamePhysicalAddress", operator: "equals", value: "No" }, metadata: { profileField: "i907.physicalPostalCode" } }),
      makeQuestion("i907PhysicalCountry", "Physical Country", "text", "information_about_the_person_filing_this_request", 22, { showIf: { field: "i907SamePhysicalAddress", operator: "equals", value: "No" }, metadata: { profileField: "i907.physicalCountry" } }),
      makeQuestion("i907RelatedFormNumber", "Form Number of Related Petition or Application", "text", "information_about_the_request", 1, { required: true, uscisMappings: ["I907.part2.relatedFormNumber"], metadata: { profileField: "i907.relatedFormNumber" } }),
      makeQuestion("i907RelatedReceiptNumber", "Receipt Number of Related Petition or Application", "text", "information_about_the_request", 2, { required: true, uscisMappings: ["I907.part2.relatedReceiptNumber"], metadata: { profileField: "i907.relatedReceiptNumber" } }),
      makeQuestion("i907RelatedReceiptNumber2", "Additional Receipt Number of Related Petition or Application", "text", "information_about_the_request", 3, { metadata: { profileField: "i907.relatedReceiptNumber2" } }),
      makeQuestion("i907PetitionerFamilyName", "Petitioner or Applicant Family Name", "text", "information_about_the_request", 4, { metadata: { profileField: "i907.petitionerFamilyName" } }),
      makeQuestion("i907PetitionerGivenName", "Petitioner or Applicant Given Name", "text", "information_about_the_request", 5, { metadata: { profileField: "i907.petitionerGivenName" } }),
      makeQuestion("i907BeneficiaryFamilyName", "Beneficiary Family Name", "text", "information_about_the_request", 6, { required: true, metadata: { profileField: "i907.beneficiaryFamilyName" } }),
      makeQuestion("i907BeneficiaryGivenName", "Beneficiary Given Name", "text", "information_about_the_request", 7, { required: true, metadata: { profileField: "i907.beneficiaryGivenName" } }),
      makeQuestion("i907PointOfContactFamilyName", "Point of Contact Family Name", "text", "information_about_the_request", 8, { metadata: { profileField: "i907.pointOfContactFamilyName" } }),
      makeQuestion("i907PointOfContactGivenName", "Point of Contact Given Name", "text", "information_about_the_request", 9, { metadata: { profileField: "i907.pointOfContactGivenName" } }),
      makeQuestion("i907PointOfContactTitle", "Point of Contact Position Title", "text", "information_about_the_request", 10, { metadata: { profileField: "i907.pointOfContactTitle" } }),
      makeQuestion("i907EmployerIdentificationNumber", "Company or Organization IRS Employer Identification Number (EIN)", "text", "information_about_the_request", 11, { uscisMappings: ["I907.part2.ein"], metadata: { profileField: "i907.ein" } }),
    ],
  },
  {
    key: "o1a_questionnaire",
    title: "O1A Questionnaire",
    visaType: "O1A",
    description: "Extraordinary ability intake for O-1A strategy, evidence planning, and petition drafting.",
    sections: ["Personal Information", "Employment", "Awards", "Memberships", "Judging", "Publications", "Media Coverage", "High Salary", "Evidence Uploads"],
    questions: [
      makeQuestion("fullName", "Full legal name", "text", "personal_information", 1, { required: true, uscisMappings: ["I129.part2.beneficiary.fullName"] }),
      makeQuestion("email", "Email address", "email", "personal_information", 2, { required: true }),
      makeQuestion("passportNumber", "Passport number", "text", "personal_information", 3, { uscisMappings: ["I129.part2.passportNumber", "I140.beneficiary.passportNumber"] }),
      makeQuestion("currentEmployer", "Current employer", "text", "employment", 1, { required: true, uscisMappings: ["I129.part5.employerName"] }),
      makeQuestion("positionTitle", "Position title", "text", "employment", 2, { required: true }),
      makeQuestion("hasAwards", "Have you received major awards or prizes?", "radio", "awards", 1, { options: ["Yes", "No"], eligibilityWeight: 25, evidenceCategory: "Award" }),
      makeQuestion("awardSummary", "Summarize your awards", "textarea", "awards", 2, { showIf: { field: "hasAwards", operator: "equals", value: "Yes" }, evidenceCategory: "Award" }),
      makeQuestion("hasMemberships", "Are you a member of selective professional associations?", "radio", "memberships", 1, { options: ["Yes", "No"], eligibilityWeight: 15, evidenceCategory: "Membership" }),
      makeQuestion("hasJudging", "Have you judged the work of others?", "radio", "judging", 1, { options: ["Yes", "No"], eligibilityWeight: 20, evidenceCategory: "Judging" }),
      makeQuestion("judgingCount", "How many judging or peer review activities?", "number", "judging", 2, { showIf: { field: "hasJudging", operator: "equals", value: "Yes" }, evidenceCategory: "Judging" }),
      makeQuestion("hasPublications", "Do you have publications?", "radio", "publications", 1, { options: ["Yes", "No"], eligibilityWeight: 15, evidenceCategory: "Publication" }),
      makeQuestion("publicationCount", "How many publications do you have?", "number", "publications", 2, { showIf: { field: "hasPublications", operator: "equals", value: "Yes" }, evidenceCategory: "Publication" }),
      makeQuestion("hasMediaCoverage", "Have you been covered by media or press?", "radio", "media_coverage", 1, { options: ["Yes", "No"], eligibilityWeight: 15, evidenceCategory: "Press" }),
      makeQuestion("hasHighSalary", "Do you have evidence of high salary or remuneration?", "radio", "high_salary", 1, { options: ["Yes", "No"], eligibilityWeight: 15, evidenceCategory: "High Salary" }),
      makeQuestion("publicationEvidence", "Upload publication evidence", "file-multiple", "evidence_uploads", 1, { showIf: { field: "publicationCount", operator: "greater_than", value: 0 }, evidenceCategory: "Publication" }),
      makeQuestion("awardEvidence", "Upload award certificates", "file-multiple", "evidence_uploads", 2, { showIf: { field: "hasAwards", operator: "equals", value: "Yes" }, evidenceCategory: "Award" }),
      makeQuestion("judgingEvidence", "Upload judging evidence", "file-multiple", "evidence_uploads", 3, { showIf: { field: "hasJudging", operator: "equals", value: "Yes" }, evidenceCategory: "Judging" }),
    ],
  },
  {
    key: "eb1a_questionnaire",
    title: "EB1A Questionnaire",
    visaType: "EB1A",
    description: "EB-1A intake for extraordinary ability criteria, evidence planning, and I-140 mapping.",
    sections: ["Personal Information", "Awards", "Memberships", "Judging", "Authorship", "Original Contributions", "Leading Role", "High Salary", "Evidence Uploads"],
    questions: [
      makeQuestion("fullName", "Full legal name", "text", "personal_information", 1, { required: true, uscisMappings: ["I140.beneficiary.fullName"] }),
      makeQuestion("passportNumber", "Passport number", "text", "personal_information", 2, { uscisMappings: ["I140.beneficiary.passportNumber"] }),
      makeQuestion("hasAwards", "Have you received nationally or internationally recognized awards?", "radio", "awards", 1, { options: ["Yes", "No"], eligibilityWeight: 25, evidenceCategory: "Award" }),
      makeQuestion("hasMemberships", "Do you have selective memberships?", "radio", "memberships", 1, { options: ["Yes", "No"], eligibilityWeight: 15, evidenceCategory: "Membership" }),
      makeQuestion("hasJudging", "Have you judged others' work?", "radio", "judging", 1, { options: ["Yes", "No"], eligibilityWeight: 20, evidenceCategory: "Judging" }),
      makeQuestion("hasAuthorship", "Have you authored scholarly articles?", "radio", "authorship", 1, { options: ["Yes", "No"], eligibilityWeight: 15, evidenceCategory: "Publication" }),
      makeQuestion("hasOriginalContributions", "Have you made original contributions of major significance?", "radio", "original_contributions", 1, { options: ["Yes", "No"], eligibilityWeight: 25, evidenceCategory: "Patent" }),
      makeQuestion("hasLeadingRole", "Have you held a leading or critical role?", "radio", "leading_role", 1, { options: ["Yes", "No"], eligibilityWeight: 20, evidenceCategory: "Leading Role" }),
      makeQuestion("hasHighSalary", "Do you command a high salary?", "radio", "high_salary", 1, { options: ["Yes", "No"], eligibilityWeight: 15, evidenceCategory: "High Salary" }),
      makeQuestion("awardEvidence", "Upload award evidence", "file-multiple", "evidence_uploads", 1, { showIf: { field: "hasAwards", operator: "equals", value: "Yes" }, evidenceCategory: "Award" }),
      makeQuestion("authorshipEvidence", "Upload authorship evidence", "file-multiple", "evidence_uploads", 2, { showIf: { field: "hasAuthorship", operator: "equals", value: "Yes" }, evidenceCategory: "Publication" }),
    ],
  },
  {
    key: "niw_questionnaire",
    title: "NIW Questionnaire",
    visaType: "NIW",
    description: "National Interest Waiver intake for proposed endeavor, qualifications, impact, and evidence collection.",
    sections: ["Personal Information", "Education", "Research", "National Importance", "Impact", "Evidence Uploads"],
    questions: [
      makeQuestion("fullName", "Full legal name", "text", "personal_information", 1, { required: true, uscisMappings: ["I140.beneficiary.fullName"] }),
      // masterDataPath overrides below avoid inferMasterDataPath's generic
      // sectionMap fallback, which would otherwise resolve an "education"-
      // section question to the top-level `education` slot buildMasterCaseData
      // pre-seeds as an ARRAY (meant for a repeatable education-history
      // shape) and then try to set a flat scalar key as a sibling property
      // of that array - MongoDB rejects this at save time ("Cannot create
      // field ... in element {education: []}"), confirmed empirically.
      makeQuestion("degreeLevel", "Highest degree level", "select", "education", 1, { required: true, options: ["Bachelor", "Master", "PhD", "MD", "Other"], uscisMappings: ["H1B.education.degree", "I140.beneficiary.education.degreeLevel"], metadata: { masterDataPath: "questionnaire.degreeLevel" } }),
      makeQuestion("fieldOfStudy", "Field of study", "text", "education", 2, { required: true, metadata: { masterDataPath: "questionnaire.fieldOfStudy" } }),
      makeQuestion("proposedEndeavor", "Describe your proposed endeavor", "textarea", "research", 1, { required: true }),
      makeQuestion("nationalImportance", "Why is the endeavor nationally important?", "textarea", "national_importance", 1, { required: true, eligibilityWeight: 30, evidenceCategory: "National Importance" }),
      makeQuestion("hasImpactEvidence", "Do you have evidence of impact?", "radio", "impact", 1, { options: ["Yes", "No"], eligibilityWeight: 25, evidenceCategory: "Impact" }),
      makeQuestion("impactSummary", "Summarize your impact", "textarea", "impact", 2, { showIf: { field: "hasImpactEvidence", operator: "equals", value: "Yes" }, evidenceCategory: "Impact" }),
      makeQuestion("impactEvidence", "Upload impact evidence", "file-multiple", "evidence_uploads", 1, { showIf: { field: "hasImpactEvidence", operator: "equals", value: "Yes" }, evidenceCategory: "Impact" }),
    ],
  },
  {
    key: "h1b_questionnaire",
    title: "H1B Questionnaire",
    visaType: "H1B",
    description: "H-1B intake for specialty occupation, education, employer, role, and supporting evidence.",
    sections: ["Personal Information", "Education", "Employment", "Employer Information", "Position Information", "Evidence Uploads"],
    questions: [
      makeQuestion("fullName", "Full legal name", "text", "personal_information", 1, { required: true, uscisMappings: ["I129.part2.beneficiary.fullName"] }),
      makeQuestion("passportNumber", "Passport number", "text", "personal_information", 2, { uscisMappings: ["I129.part2.passportNumber"] }),
      // Same masterDataPath-collision fix as niw_questionnaire above.
      makeQuestion("degreeLevel", "Highest degree level", "select", "education", 1, { required: true, options: ["Bachelor", "Master", "PhD", "Other"], uscisMappings: ["H1B.education.degree"], metadata: { masterDataPath: "questionnaire.degreeLevel" } }),
      makeQuestion("degreeField", "Degree field", "text", "education", 2, { required: true, metadata: { masterDataPath: "questionnaire.degreeField" } }),
      makeQuestion("hasUSDegree", "Was the degree earned in the United States?", "radio", "education", 3, { options: ["Yes", "No"], metadata: { masterDataPath: "questionnaire.hasUSDegree" } }),
      makeQuestion("currentStatus", "Current immigration status", "text", "employment", 1, { uscisMappings: ["I129.part2.currentStatus"] }),
      makeQuestion("employerName", "Employer legal name", "text", "employer_information", 1, { required: true, uscisMappings: ["I129.part1.employerName"] }),
      makeQuestion("jobTitle", "Offered position title", "text", "position_information", 1, { required: true, uscisMappings: ["I129.part5.jobTitle"] }),
      makeQuestion("jobDuties", "Describe job duties", "textarea", "position_information", 2, { required: true, eligibilityWeight: 30, evidenceCategory: "Specialty Occupation" }),
      makeQuestion("educationEvidence", "Upload degree and transcripts", "file-multiple", "evidence_uploads", 1, { required: true, evidenceCategory: "Education" }),
      makeQuestion("employmentEvidence", "Upload employment offer/support letter", "file-multiple", "evidence_uploads", 2, { required: true, evidenceCategory: "Employment" }),
    ],
  },
  ...EMPLOYMENT_CHECKLIST_DEFINITIONS,
  ...FAMILY_CHECKLIST_DEFINITIONS,
  ...SINGLE_PARTY_FILING_DEFINITIONS,
];

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// Master-content fields a definition update is allowed to reconcile on an
// already-provisioned Question, in place — never a delete/recreate. Compared
// by value (JSON) against the current DB record; only fields that actually
// differ get patched. Fields the definition doesn't specify are left alone.
const RECONCILABLE_QUESTION_FIELDS = [
  "label", "type", "sectionKey", "pageKey", "order", "required", "description",
  "options", "conditionalLogic", "metadata", "mapping", "evidenceCategory", "visibility", "repeatable",
];

function reconcileQuestionFields(existingDoc, definitionQuestion) {
  const patch = {};
  const existing = existingDoc.toObject();
  for (const field of RECONCILABLE_QUESTION_FIELDS) {
    if (!(field in definitionQuestion)) continue;
    if (JSON.stringify(definitionQuestion[field]) !== JSON.stringify(existing[field])) {
      patch[field] = definitionQuestion[field];
    }
  }
  return patch;
}

// Idempotent, non-destructive master-content provisioning: creates a
// Questionnaire/its Questions when missing (as before), and — when the
// content already exists — reconciles it to the current definition in place
// (label/section/order/required/etc. changes propagate) without ever
// deleting a record. A Question whose key the definition no longer lists is
// retired (active/isActive:false), not deleted, so any client answer or
// admin edit that already references it survives.
// This runs on every questionnaire fetch (getQuestionnaireForCase,
// resolveCaseQuestionnaires) as a defensive "make sure defaults exist" call —
// not just at server startup. The reconciliation work below (comparing every
// field of every question across ~10 definitions, some with 70+ questions)
// is real DB work, not a cheap no-op, so doing it on every single page load
// made every case/checklist page load take tens of seconds. Memoized for
// ENSURE_TTL_MS so normal traffic hits the cached result; a genuine content
// change (a deploy, or an admin re-seed via the /defaults/seed endpoint)
// still gets picked up within the TTL without needing a server restart.
let ensureCache = { at: 0, promise: null };

async function ensureDefaultVisaTemplates(user, req, { force = false } = {}) {
  const now = Date.now();
  if (!force && ensureCache.promise) return ensureCache.promise;
  const promise = ensureDefaultVisaTemplatesUncached(user, req).catch((error) => {
    // Don't cache a failure — the next call should retry against the DB.
    ensureCache = { at: 0, promise: null };
    throw error;
  });
  ensureCache = { at: now, promise };
  return promise;
}

async function ensureDefaultVisaTemplatesUncached(user, req) {
  const results = [];
  const systemUser = user || { _id: undefined, role: "super_admin" };
  for (const definition of VISA_TEMPLATE_DEFINITIONS) {
    let questionnaire = await Questionnaire.findOne({ key: definition.key, latestVersion: true });
    if (!questionnaire) {
      questionnaire = await Questionnaire.create({
        key: definition.key,
        title: definition.title,
        description: definition.description,
        version: 1,
        status: definition.status || "draft",
        type: "template",
        module: "cases",
        category: "immigration",
        visaType: definition.visaType,
        visaTypes: [definition.visaType],
        isActive: true,
        isTemplate: true,
        templateCategory: definition.visaType,
        checklistRole: definition.checklistRole || "",
        assignmentRules: definition.assignmentRules || undefined,
        isDefault: Boolean(definition.isDefault),
        latestVersion: true,
        sections: definition.sections.map((title, index) => ({
          key: slugSection(title),
          title,
          description: "",
          order: index + 1,
          isActive: true,
        })),
        pages: definition.sections.map((title, index) => ({
          key: slugSection(title),
          title,
          order: index + 1,
          sectionKeys: [slugSection(title)],
        })),
        builder: {
          layout: "wizard",
          pageOrder: definition.sections.map(slugSection),
          sectionOrder: definition.sections.map(slugSection),
          questionOrder: definition.questions.map((question) => question.key),
        },
        settings: {
          multiStep: true,
          autoSave: true,
          allowBackNavigation: true,
          requireReview: true,
          progressMode: "questions",
          defaultLocale: "en",
          enableBranching: true,
        },
        createdBy: systemUser._id,
        updatedBy: systemUser._id,
      });
      questionnaire.rootQuestionnaire = questionnaire._id;
      addQuestionnaireAudit(questionnaire, "seed_default_template", systemUser, { visaType: definition.visaType }, req);
      await questionnaire.save();
    } else {
      // Non-destructive content update: the master content's own copy (e.g.
      // an intro paragraph) or section list changed — patch the existing
      // record in place, never recreate it.
      let changed = false;
      if (questionnaire.description !== definition.description) {
        questionnaire.description = definition.description;
        changed = true;
      }
      if (definition.assignmentRules && questionnaire.assignmentRules?.requiresNewOfficePetition !== definition.assignmentRules.requiresNewOfficePetition) {
        questionnaire.assignmentRules = { ...(questionnaire.assignmentRules?.toObject?.() || questionnaire.assignmentRules || {}), ...definition.assignmentRules };
        changed = true;
      }
      const currentSectionTitles = (questionnaire.sections || []).map((section) => section.title);
      if (JSON.stringify(currentSectionTitles) !== JSON.stringify(definition.sections)) {
        questionnaire.sections = definition.sections.map((title, index) => {
          const existingSection = (questionnaire.sections || []).find((section) => section.key === slugSection(title));
          return { key: slugSection(title), title, description: existingSection?.description || "", order: index + 1, isActive: true };
        });
        questionnaire.pages = definition.sections.map((title, index) => ({
          key: slugSection(title),
          title,
          order: index + 1,
          sectionKeys: [slugSection(title)],
        }));
        questionnaire.builder = {
          ...(questionnaire.builder || {}),
          pageOrder: definition.sections.map(slugSection),
          sectionOrder: definition.sections.map(slugSection),
          questionOrder: definition.questions.map((question) => question.key),
        };
        changed = true;
      }
      if (changed) {
        addQuestionnaireAudit(questionnaire, "update_default_template", systemUser, { visaType: definition.visaType }, req);
        await questionnaire.save();
      }
    }

    const existingQuestions = await Question.find({ questionnaire: questionnaire._id });
    const existingByKey = new Map(existingQuestions.map((question) => [question.key, question]));
    const definitionKeys = new Set(definition.questions.map((question) => question.key));

    for (const question of definition.questions) {
      const existing = existingByKey.get(question.key);
      if (!existing) {
        await Question.create({
          ...question,
          questionnaire: questionnaire._id,
          questionnaireKey: questionnaire.key,
          questionnaireVersion: questionnaire.version,
          createdBy: systemUser._id,
          updatedBy: systemUser._id,
        });
        continue;
      }
      const patch = reconcileQuestionFields(existing, question);
      if (existing.active === false || existing.isActive === false) {
        patch.active = true;
        patch.isActive = true;
      }
      if (Object.keys(patch).length) {
        Object.assign(existing, patch, { updatedBy: systemUser._id });
        await existing.save();
      }
    }

    // A question the master definition no longer lists is retired, not
    // deleted — any client answer or admin edit referencing it stays intact;
    // it simply stops rendering/being required going forward.
    for (const existing of existingQuestions) {
      if (definitionKeys.has(existing.key)) continue;
      if (existing.active === false && existing.isActive === false) continue;
      existing.active = false;
      existing.isActive = false;
      existing.updatedBy = systemUser._id;
      await existing.save();
    }

    results.push(questionnaire);
  }
  return results;
}

async function getQuestionnaireForCase(caseId, user, targetRole, options = {}) {
  const timer = createStageTimer();
  const caseData = await Case.findById(caseId);
  timer.mark("case_lookup");
  if (!caseData) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }
  if (!caseService.canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to access this case questionnaire");
    error.status = 403;
    throw error;
  }
  await ensureDefaultVisaTemplates();
  timer.mark("template_initialization");
  const requestedParticipant = options.participantId
    ? participantService.findParticipant(caseData, { role: targetRole, participantId: options.participantId })
    : participantService.participantForUser(caseData, user, targetRole);
  const eligibleReferences = (caseData.questionnaireReferences || [])
    .filter((reference) => reference.active !== false && reference.status !== "returned")
    .filter((reference) => !targetRole || reference.targetRole === targetRole)
    .filter((reference) => !options.participantId || String(reference.participantId || "") === String(options.participantId));
  const activeReference = eligibleReferences
    .sort((left, right) => new Date(right.sentAt || right.submittedAt || 0) - new Date(left.sentAt || left.submittedAt || 0))[0];
  const visaType = String(caseData.visaType || "").replace(/[-\s]/g, "").toUpperCase();
  let questionnaire = activeReference?.questionnaireId
    ? await Questionnaire.findById(activeReference.questionnaireId)
    : null;
  timer.mark("assigned_questionnaire_lookup", { foundAssigned: Boolean(questionnaire), targetRole });
  // No case-specific assignment for this role — fall back to the deterministic
  // "isDefault" template for this visa type + role (e.g. the seeded H-1B Employer
  // Checklist), instead of the legacy regex/convention matching below.
  if (!questionnaire && targetRole) {
    questionnaire = await Questionnaire.findOne({
      status: { $ne: "archived" },
      isActive: { $ne: false },
      latestVersion: true,
      isDefault: true,
      checklistRole: targetRole,
      $or: [
        { visaType: new RegExp(`^${visaType}$`, "i") },
        { visaTypes: new RegExp(`^${visaType}$`, "i") },
      ],
    }).sort({ version: -1 });
    timer.mark("default_role_template_lookup", { foundDefault: Boolean(questionnaire), targetRole });
  }
  if (!questionnaire) {
    questionnaire = await Questionnaire.findOne({
      status: { $ne: "archived" },
      isActive: { $ne: false },
      latestVersion: true,
      $or: [
        { visaType: new RegExp(`^${visaType}$`, "i") },
        { visaTypes: new RegExp(`^${visaType}$`, "i") },
        { key: new RegExp(`^${visaType}_questionnaire$`, "i") },
      ],
    }).sort({ version: -1 });
    timer.mark("legacy_template_lookup", { foundLegacy: Boolean(questionnaire) });
  }
  if (!questionnaire) {
    const error = new Error("No questionnaire template found for this case visa type");
    error.status = 404;
    throw error;
  }
  const responseId = activeReference?.responseId || responseIdFor(questionnaire._id, caseData._id, requestedParticipant?._id || caseData.user || user?._id);
  const questions = await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }).sort({ pageKey: 1, sectionKey: 1, order: 1 }).lean();
  timer.mark("question_lookup", { count: questions.length });
  const answers = await Answer.find({ responseId }).populate("question", "key label type sectionKey pageKey order").sort({ updatedAt: -1 }).lean();
  timer.mark("answer_lookup", { count: answers.length });
  const answerMap = getAnswerMapFromAnswers(answers);
  const visibleQuestions = questions.filter((question) => isQuestionVisible(question, answerMap, user));
  const progress = await calculateDetailedProgress(questionnaire, answerMap, user, visibleQuestions);
  timer.mark("visibility_and_progress", { visibleCount: visibleQuestions.length });
  if (questionnaire.generation?.source === "uscis_question_library") {
    const intelligentState = IntelligentQuestionnaireService.buildCaseQuestionState(
      visibleQuestions,
      requestedParticipant?.canonicalProfile || caseData.canonicalProfile || {},
      answers,
    );
    timer.mark("intelligent_question_state", { pendingCount: intelligentState.pendingQuestions.length });
    logger.info("questionnaire_case_load_completed", {
      caseId,
      questionnaireId: questionnaire._id,
      responseId,
      targetRole,
      intelligent: true,
      ...timer.done(),
    });
    return {
      case: caseData,
      questionnaire,
      questions: intelligentState.pendingQuestions,
      documentQuestions: intelligentState.pendingQuestions.filter((question) => question.type === "file"),
      fieldQuestions: intelligentState.pendingQuestions.filter((question) => question.type !== "file"),
      completedQuestions: intelligentState.completedQuestions,
      prefill: intelligentState.prefill,
      conflicts: intelligentState.conflicts,
      answers,
      responseId,
      participant: participantService.participantSnapshot(requestedParticipant),
      progress: {
        ...progress,
        percent: intelligentState.summary.percent,
        intelligent: intelligentState.summary,
      },
    };
  }
  logger.info("questionnaire_case_load_completed", {
    caseId,
    questionnaireId: questionnaire._id,
    responseId,
    targetRole,
    intelligent: false,
    ...timer.done(),
  });
  return {
    case: caseData,
    questionnaire,
    questions: visibleQuestions,
    documentQuestions: visibleQuestions.filter((question) => question.type === "file"),
    fieldQuestions: visibleQuestions.filter((question) => question.type !== "file"),
    answers,
    responseId,
    participant: participantService.participantSnapshot(requestedParticipant),
    progress,
  };
}

// Every questionnaire/checklist actively relevant to a case: explicit
// case-specific assignments (questionnaireReferences) plus, for any
// checklistRole that reference set doesn't cover, that role's seeded
// "isDefault" template for the case's visa type - mirroring getQuestionnaireForCase's
// per-role fallback. Document-intelligence autofill uses this (instead of
// picking one arbitrary isTemplate match) so it can reach the same checklist
// the client is actually looking at (e.g. the H-1B Employee Checklist), not
// just whatever generic questionnaire happened to get auto-assigned first.
// Each entry's responseId matches exactly what getQuestionnaireForCase would
// compute/read for that questionnaire, so answers written here show up there.
async function resolveCaseQuestionnaires(caseId) {
  const timer = createStageTimer();
  const caseData = await Case.findById(caseId).select("questionnaireReferences visaType user participants").lean();
  timer.mark("case_lookup");
  if (!caseData) return [];
  await ensureDefaultVisaTemplates();
  timer.mark("template_initialization");
  const visaType = String(caseData.visaType || "").replace(/[-\s]/g, "").toUpperCase();

  const resolved = new Map();
  const assignedKeys = new Set();
  for (const reference of caseData.questionnaireReferences || []) {
    if (reference.active === false || reference.status === "returned" || !reference.questionnaireId) continue;
    const id = String(reference.questionnaireId);
    const assignedTo = reference.assignedTo ? String(reference.assignedTo) : "";
    const participantId = reference.participantId ? String(reference.participantId) : "";
    assignedKeys.add(`${id}:${participantId || assignedTo}`);
    const responseId = reference.responseId || responseIdFor(reference.questionnaireId, caseData._id, reference.assignedTo || caseData.user);
    const key = `${id}:${responseId}`;
    const existing = resolved.get(key);
    if (!existing || new Date(reference.sentAt || reference.submittedAt || 0) > new Date(existing.sentAt || 0)) {
      resolved.set(key, {
        referenceId: reference._id,
        questionnaireId: reference.questionnaireId,
        responseId,
        sentAt: reference.sentAt,
        submittedAt: reference.submittedAt,
        approvedAt: reference.approvedAt,
        assignedTo: reference.assignedTo,
        participantId: reference.participantId,
        participantRole: reference.participantRole,
        targetRole: reference.targetRole || "",
        title: reference.title,
        status: reference.status || "not_started",
        explicit: true,
      });
    }
  }
  timer.mark("assigned_reference_resolution", { count: resolved.size });

  if (visaType) {
    const defaults = await Questionnaire.find({
      status: { $ne: "archived" },
      isActive: { $ne: false },
      latestVersion: true,
      isDefault: true,
      $or: [{ visaType: new RegExp(`^${visaType}$`, "i") }, { visaTypes: new RegExp(`^${visaType}$`, "i") }],
    }).lean();
    timer.mark("default_template_lookup", { count: defaults.length, visaType });
    for (const questionnaire of defaults) {
      const id = String(questionnaire._id);
      const targetRole = questionnaire.checklistRole || "";
      const roleParticipants = participantService.activeParticipants(caseData, targetRole);
      const owners = roleParticipants.length
        ? roleParticipants.map((participant) => ({ participantId: participant._id, assignedTo: participant.userId }))
        : [{ participantId: null, assignedTo: caseData.user }];
      for (const owner of owners) {
        const assignedTo = owner.assignedTo ? String(owner.assignedTo) : "";
        const participantId = owner.participantId ? String(owner.participantId) : "";
        if (assignedKeys.has(`${id}:${participantId || assignedTo}`)) continue;
        const responseId = responseIdFor(questionnaire._id, caseData._id, owner.participantId || owner.assignedTo || caseData.user);
        resolved.set(`${id}:${responseId}`, {
          questionnaireId: questionnaire._id,
          responseId,
          participantId: owner.participantId,
          assignedTo: owner.assignedTo,
          targetRole,
          title: questionnaire.title,
          status: "not_started",
          explicit: false,
        });
      }
    }
    if (!resolved.size) {
      const legacy = await Questionnaire.findOne({
        status: { $ne: "archived" },
        isActive: { $ne: false },
        latestVersion: true,
        $or: [{ visaType: new RegExp(`^${visaType}$`, "i") }, { visaTypes: new RegExp(`^${visaType}$`, "i") }, { key: new RegExp(`^${visaType}_questionnaire$`, "i") }],
      }).sort({ version: -1 }).lean();
      timer.mark("legacy_template_lookup", { foundLegacy: Boolean(legacy), visaType });
      if (legacy) {
        const responseId = responseIdFor(legacy._id, caseData._id, caseData.user);
        resolved.set(`${legacy._id}:${responseId}`, {
          questionnaireId: legacy._id,
          responseId,
          targetRole: legacy.checklistRole || "",
          title: legacy.title,
          status: "not_started",
          explicit: false,
        });
      }
    }
  }

  if (!resolved.size) return [];
  const questionnaires = await Questionnaire.find({ _id: { $in: [...resolved.values()].map((entry) => entry.questionnaireId) }, status: { $ne: "archived" } });
  timer.mark("resolved_questionnaire_lookup", { count: questionnaires.length });
  const questionnaireById = new Map(questionnaires.map((questionnaire) => [String(questionnaire._id), questionnaire]));
  const result = [...resolved.values()]
    .map((entry) => {
      const questionnaire = questionnaireById.get(String(entry.questionnaireId));
      if (!questionnaire) return null;
      return { ...entry, questionnaire, responseId: entry.responseId || responseIdFor(questionnaire._id, caseData._id, entry.assignedTo || caseData.user) };
    })
    .filter(Boolean);
  logger.info("questionnaire_resolution_completed", {
    caseId,
    count: result.length,
    ...timer.done(),
  });
  return result;
}

// getQuestionnaireForCase only ever resolves the single most-recent
// questionnaire for one targetRole. This lists *every* actively-assigned
// checklist on the case (Employer + Employee + Business Plan, etc., with no
// hardcoded count) alongside each one's live completion percent, so "no limit
// on checklists assigned to a case" is actually visible/usable, not just
// theoretically supported by the underlying array.
async function listCaseChecklists(caseId, user) {
  const timer = createStageTimer();
  const caseData = await Case.findById(caseId);
  timer.mark("case_lookup");
  if (!caseData) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }
  if (!caseService.canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to access this case's checklists");
    error.status = 403;
    throw error;
  }
  const resolved = await resolveCaseQuestionnaires(caseId);
  timer.mark("questionnaire_resolution", { count: resolved.length });
  const responseIds = resolved.map((entry) => entry.responseId).filter(Boolean);
  const answers = responseIds.length ? await Answer.find({ responseId: { $in: responseIds } }).lean() : [];
  timer.mark("answer_batch_lookup", { responseCount: responseIds.length, answerCount: answers.length });
  const answersByResponseId = answers.reduce((map, answer) => {
    if (!map.has(answer.responseId)) map.set(answer.responseId, []);
    map.get(answer.responseId).push(answer);
    return map;
  }, new Map());
  const checklists = await Promise.all(resolved.map(async (entry) => {
    const responseAnswers = answersByResponseId.get(entry.responseId) || [];
    const answerMap = getAnswerMapFromAnswers(responseAnswers);
    const visibleQuestions = await resolveVisibleQuestions(entry.questionnaire, answerMap, user);
    const progress = await calculateDetailedProgress(entry.questionnaire, answerMap, user, visibleQuestions);
    // Scoped to upload (file-type) questions only, so UI that shows "document"
    // completion (as opposed to questionnaire-answer completion) doesn't mix
    // in unanswered field questions - see CRMCaseDetail.jsx's documentsProgress.
    const documentProgress = await calculateDetailedProgress(
      entry.questionnaire,
      answerMap,
      user,
      visibleQuestions.filter((question) => question.type === "file")
    );
    return {
      referenceId: entry.referenceId,
      questionnaireId: entry.questionnaire._id,
      title: entry.title || entry.questionnaire.title,
      targetRole: entry.targetRole || entry.questionnaire.checklistRole,
      participantId: entry.participantId,
      participant: participantService.participantSnapshot(participantService.findParticipant(caseData, { participantId: entry.participantId })),
      status: entry.status,
      sentAt: entry.sentAt,
      submittedAt: entry.submittedAt,
      approvedAt: entry.approvedAt,
      assignedTo: entry.assignedTo,
      responseId: entry.responseId,
      resolvedDynamically: !entry.explicit,
      progress,
      documentProgress,
    };
  }));
  timer.mark("progress_mapping", { count: checklists.length });
  logger.info("questionnaire_checklists_load_completed", {
    caseId,
    ...timer.done(),
  });
  return { caseId: caseData._id, checklists };
}

async function getAnswers(payload, user) {
  const questionnaire = await Questionnaire.findById(payload.questionnaireId);
  if (!questionnaire) {
    const error = new Error("Questionnaire not found");
    error.status = 404;
    throw error;
  }
  const responseId = payload.responseId || responseIdFor(questionnaire._id, payload.caseId, payload.userId || user?._id);
  if (!(await canAccessResponse(user, responseId)) && payload.caseId) {
    const caseData = await Case.findById(payload.caseId);
    if (!caseService.canAccessCase(user, caseData)) {
      const error = new Error("Not authorized to access questionnaire answers");
      error.status = 403;
      throw error;
    }
  }
  const answers = await Answer.find({ responseId }).populate("question questionnaire").sort({ updatedAt: -1 });
  const answerMap = getAnswerMapFromAnswers(answers);
  const progress = await calculateDetailedProgress(questionnaire, answerMap, user);
  return { responseId, answers, progress };
}

async function getUscisMappings(questionnaireId) {
  const questionnaire = await Questionnaire.findById(questionnaireId);
  if (!questionnaire) {
    const error = new Error("Questionnaire not found");
    error.status = 404;
    throw error;
  }
  const questions = await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }).sort({ sectionKey: 1, order: 1 });
  return questions
    .filter((question) => question.uscisMappings?.length || question.mapping?.uscisFieldPath)
    .map((question) => ({
      questionKey: question.key,
      label: question.label,
      uscisMappings: question.uscisMappings?.length
        ? question.uscisMappings
        : [`${question.mapping.uscisFormNumber}.${question.mapping.uscisFieldPath}`],
      transform: question.mapping?.transform,
    }));
}

async function getProgress(payload, user) {
  const questionnaire = await Questionnaire.findById(payload.questionnaireId);
  if (!questionnaire) {
    const error = new Error("Questionnaire not found");
    error.status = 404;
    throw error;
  }
  const responseId = payload.responseId || responseIdFor(questionnaire._id, payload.caseId, payload.userId || user?._id);
  const answers = await Answer.find({ responseId });
  return { responseId, progress: await calculateDetailedProgress(questionnaire, getAnswerMapFromAnswers(answers), user) };
}

async function validateAnswers(payload, user) {
  const questionnaire = await Questionnaire.findById(payload.questionnaireId);
  if (!questionnaire) {
    const error = new Error("Questionnaire not found");
    error.status = 404;
    throw error;
  }
  const responseId = payload.responseId || responseIdFor(questionnaire._id, payload.caseId, payload.userId || user?._id);
  if (!(await canAccessResponse(user, responseId)) && payload.caseId) {
    const caseData = await Case.findById(payload.caseId);
    if (!caseService.canAccessCase(user, caseData)) {
      const error = new Error("Not authorized to validate questionnaire answers");
      error.status = 403;
      throw error;
    }
  }
  const [answers, questions] = await Promise.all([
    Answer.find({ responseId }),
    Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }).sort({ pageKey: 1, sectionKey: 1, order: 1 }),
  ]);
  const answerMap = getAnswerMapFromAnswers(answers);
  return {
    responseId,
    validation: validateResponse(questionnaire, questions, answerMap, user),
    progress: await calculateDetailedProgress(questionnaire, answerMap, user),
    masterData: buildMasterCaseData(questionnaire, questions, answerMap, user).masterData,
  };
}

async function generateDocumentRequestsForResponse(payload, user, req) {
  const questionnaire = await Questionnaire.findById(payload.questionnaireId);
  const caseData = payload.caseId ? await Case.findById(payload.caseId) : null;
  if (!questionnaire) {
    const error = new Error("Questionnaire not found");
    error.status = 404;
    throw error;
  }
  if (caseData && !caseService.canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to generate document requests");
    error.status = 403;
    throw error;
  }
  const responseId = payload.responseId || responseIdFor(questionnaire._id, payload.caseId, payload.userId || user?._id);
  const [answers, questions] = await Promise.all([
    Answer.find({ responseId }),
    Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }),
  ]);
  const documentRequests = await generateDocumentRequests({ questionnaire, caseData, answerMap: getAnswerMapFromAnswers(answers), questions, user, req });
  return { responseId, documentRequests };
}

async function generateQuestionnaireFromPrompt(payload, user, req) {
  assertCanDesign(user, "generate questionnaires");
  const key = payload.key || `ai_${String(payload.title || payload.prompt || "questionnaire").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${Date.now()}`;
  const questionnaire = await createQuestionnaire({
    key,
    title: payload.title || "AI Generated Immigration Questionnaire",
    description: payload.prompt,
    module: payload.module || "cases",
    category: payload.category || "immigration",
    isTemplate: payload.isTemplate ?? true,
    pages: [{ key: "overview", title: "Overview", order: 1, sectionKeys: ["personal", "immigration", "documents"] }],
    sections: [
      { key: "personal", title: "Personal Information", order: 1 },
      { key: "immigration", title: "Immigration History", order: 2 },
      { key: "documents", title: "Documents", order: 3 },
    ],
    aiGeneration: {
      enabled: true,
      prompt: payload.prompt,
      provider: "internal-template-generator",
      model: "rule-based",
      generatedAt: new Date(),
      generatedBy: user._id,
    },
  }, user, req);
  const questions = payload.questions || [
    { key: "full_name", label: "Full Legal Name", type: "text", required: true, sectionKey: "personal", pageKey: "overview", order: 1 },
    { key: "date_of_birth", label: "Date of Birth", type: "date", required: true, sectionKey: "personal", pageKey: "overview", order: 2 },
    { key: "current_visa_status", label: "Current Visa Status", type: "select", sectionKey: "immigration", pageKey: "overview", order: 3, options: ["F-1", "H-1B", "L-1", "O-1", "Other"].map((value) => ({ label: value, value })) },
    { key: "has_prior_denial", label: "Have you ever had a visa or petition denied?", type: "boolean", sectionKey: "immigration", pageKey: "overview", order: 4 },
    { key: "prior_denial_details", label: "Prior Denial Details", type: "textarea", sectionKey: "immigration", pageKey: "overview", order: 5, conditionalLogic: { mode: "all", rules: [{ questionKey: "has_prior_denial", operator: "equals", value: true }] } },
    { key: "passport_upload", label: "Upload Passport Biographic Page", type: "file", required: true, sectionKey: "documents", pageKey: "overview", order: 6 },
  ];
  await bulkCreateQuestions(questionnaire, { questions }, user, req);
  return questionnaire;
}

async function lockQuestionnaire(questionnaire, payload, user, req) {
  assertCanDesign(user, "lock questionnaire builder");
  const now = new Date();
  questionnaire.collaboration.lockedBy = user._id;
  questionnaire.collaboration.lockedAt = now;
  questionnaire.collaboration.lockExpiresAt = new Date(now.getTime() + Number(payload.minutes || 30) * 60 * 1000);
  addQuestionnaireAudit(questionnaire, "lock", user, payload, req);
  await questionnaire.save();
  return questionnaire;
}

async function unlockQuestionnaire(questionnaire, user, req) {
  assertCanDesign(user, "unlock questionnaire builder");
  questionnaire.collaboration.lockedBy = undefined;
  questionnaire.collaboration.lockedAt = undefined;
  questionnaire.collaboration.lockExpiresAt = undefined;
  addQuestionnaireAudit(questionnaire, "unlock", user, {}, req);
  await questionnaire.save();
  return questionnaire;
}

async function addComment(questionnaire, payload, user, req) {
  if (!canReadQuestionnaires(user)) {
    const error = new Error("Not authorized to comment on questionnaires");
    error.status = 403;
    throw error;
  }
  questionnaire.collaboration.comments.push({
    user: user._id,
    body: payload.body,
    targetType: payload.targetType || "questionnaire",
    targetKey: payload.targetKey,
  });
  addQuestionnaireAudit(questionnaire, "comment", user, payload, req);
  await questionnaire.save();
  return questionnaire.collaboration.comments[questionnaire.collaboration.comments.length - 1];
}

async function getLibrary(filter = {}) {
  return Questionnaire.find({
    $or: [{ isTemplate: true }, { type: { $in: ["template", "library_item"] } }],
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.module ? { module: filter.module } : {}),
    ...(filter.visaType ? { visaTypes: filter.visaType } : {}),
    status: filter.status || { $ne: "archived" },
  }).sort({ category: 1, title: 1, version: -1 });
}

module.exports = {
  addComment,
  approveQuestionnaireDefinition,
  approveResponse,
  assignQuestionnaire,
  buildResponseState,
  bulkCreateQuestions,
  calculateDetailedProgress,
  canAccessResponse,
  canDesign,
  canReadQuestionnaires,
  canReview,
  cloneQuestionnaire,
  createNewVersion,
  createQuestion,
  createQuestionnaire,
  ensureDefaultVisaTemplates,
  exportQuestionnaire,
  generateDocumentRequests,
  generateDocumentRequestsForResponse,
  generateQuestionnaireFromPrompt,
  getAnswers,
  getLibrary,
  getProgress,
  getQuestionnaireForCase,
  listCaseChecklists,
  resolveVisibleQuestions,
  syncFileAnswerFromDocument,
  removeFileAnswerForDocument,
  getUscisMappings,
  getVisibleQuestions,
  importQuestionnaire,
  lockQuestionnaire,
  publishQuestionnaire,
  reorderQuestionnaire,
  requestApproval,
  resolveCaseQuestionnaires,
  responseIdFor,
  saveAnswers,
  saveFileAnswer,
  submitResponse,
  unlockQuestionnaire,
  updateQuestion,
  updateQuestionnaire,
  validateAnswers,
};
