const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const Task = require("../../models/Task");
const User = require("../../models/User");
const Workflow = require("../../models/Workflow");
const WorkflowTemplate = require("../../models/WorkflowTemplate");
const caseService = require("../cases/case.service");
const notificationService = require("../notifications/notification.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { DEFAULT_CASE_WORKFLOW_TEMPLATE } = require("./workflow.defaults");

const WORKFLOW_ADMIN_ROLES = ["super_admin", "admin"];
const WORKFLOW_DESIGNER_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const WORKFLOW_STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal", "reviewer", "finance", "hr"];

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function sameId(left, right) {
  return Boolean(left && right && idOf(left) === idOf(right));
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function canManageWorkflows(user) {
  return WORKFLOW_DESIGNER_ROLES.includes(roleOf(user));
}

function canAccessWorkflow(user, workflow) {
  if (!user || !workflow) return false;
  const role = roleOf(user);
  if (WORKFLOW_ADMIN_ROLES.includes(role)) return true;
  if (sameId(workflow.createdBy, user._id) || sameId(workflow.owner, user._id)) return true;
  if (workflow.assignedTo?.some((id) => sameId(id, user._id))) return true;
  if (workflow.context?.assignedUserIds?.some((id) => sameId(id, user._id))) return true;
  if (role === "client" && sameId(workflow.context?.clientUserId, user._id)) return true;
  if (role === "team_lead" && user.teamId && sameId(workflow.context?.teamId, user.teamId)) return true;
  if (role === "employer" && user.companyId && sameId(workflow.context?.companyId, user.companyId)) return true;
  return WORKFLOW_STAFF_ROLES.includes(role);
}

function addAuditEntry(entity, action, user, changes = {}, req) {
  entity.auditHistory.push({
    action,
    userAgent: req?.headers?.["user-agent"],
  });
}

async function writeAuditLog(action, entityType, entity, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType,
    entityId: entity?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} ${entityType} ${entity?.name || entity?._id}`,
  }).catch(() => {});
}

function assertDesigner(user, action = "manage workflows") {
  if (!canManageWorkflows(user)) {
    const error = new Error(`Not authorized to ${action}`);
    error.status = 403;
    throw error;
  }
}

function getField(context, field) {
  return String(field || "").split(".").reduce((value, key) => (value == null ? undefined : value[key]), context);
}

function evaluateCondition(condition, context = {}) {
  if (!condition) return true;
  if (condition.conditions?.length) {
    const nested = condition.conditions.map((item) => evaluateCondition(item, context));
    return condition.mode === "any" ? nested.some(Boolean) : nested.every(Boolean);
  }
  const actual = getField(context, condition.field);
  const expected = condition.value;
  switch (condition.operator) {
    case "not_equals":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual);
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "missing":
      return actual === undefined || actual === null || actual === "";
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "contains":
      return Array.isArray(actual) ? actual.includes(expected) : String(actual || "").includes(String(expected));
    case "regex":
      return expected ? new RegExp(expected).test(String(actual || "")) : false;
    case "equals":
    default:
      return actual === expected;
  }
}

function conditionsPass(conditions = [], context = {}) {
  return conditions.every((condition) => evaluateCondition(condition, context));
}

function copyTemplateShape(template, overrides = {}) {
  const source = template.toObject ? template.toObject() : template;
  return {
    key: source.key,
    name: source.name,
    description: source.description,
    module: source.module,
    entityType: source.entityType,
    type: source.type,
    isTemplate: source.isTemplate,
    category: source.category,
    tags: source.tags,
    triggers: source.triggers,
    triggerDefinitions: source.triggerDefinitions,
    stages: source.stages,
    transitions: source.transitions,
    builder: source.builder,
    scheduling: source.scheduling,
    sla: source.sla,
    approval: source.approval,
    variables: source.variables,
    ...overrides,
  };
}

async function ensureDefaultTemplates(user, req) {
  const existing = await WorkflowTemplate.findOne({ key: DEFAULT_CASE_WORKFLOW_TEMPLATE.key, version: DEFAULT_CASE_WORKFLOW_TEMPLATE.version });
  if (existing) {
    Object.assign(existing, DEFAULT_CASE_WORKFLOW_TEMPLATE, { rootTemplate: existing.rootTemplate || existing._id, updatedBy: user?._id });
    existing.auditHistory.push({ action: "refresh_default", performedBy: user?._id, changes: { key: existing.key, version: existing.version } });
    await existing.save();
    return existing;
  }
  const template = await WorkflowTemplate.create({ ...DEFAULT_CASE_WORKFLOW_TEMPLATE, rootTemplate: undefined, createdBy: user?._id, updatedBy: user?._id });
  template.rootTemplate = template._id;
  template.auditHistory.push({ action: "seed_default", performedBy: user?._id, changes: { key: template.key, version: template.version } });
  await template.save();
  await writeAuditLog("seed_default", "workflow_template", template, user, {}, req);
  return template;
}

function buildWorkflowFilter(query = {}, user) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.templateKey) filter.templateKey = query.templateKey;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.caseId) filter.caseId = query.caseId;
  if (query.companyId) filter.companyId = query.companyId;
  if (query.currentStage) filter.currentStage = query.currentStage;
  if (query.priority) filter.priority = query.priority;
  if (WORKFLOW_ADMIN_ROLES.includes(roleOf(user))) return filter;
  if (roleOf(user) === "team_lead" && user.teamId) filter["context.teamId"] = user.teamId;
  return filter;
}

async function createTemplate(payload, user, req) {
  assertDesigner(user, "manage workflow templates");
  const template = await WorkflowTemplate.create({ ...payload, createdBy: user._id, updatedBy: user._id });
  if (!template.rootTemplate) template.rootTemplate = template._id;
  template.auditHistory.push({ action: "create", performedBy: user._id, changes: payload });
  await template.save();
  await writeAuditLog("create", "workflow_template", template, user, payload, req);
  return template;
}

async function updateTemplate(template, payload, user, req) {
  assertDesigner(user, "manage workflow templates");
  if (template.status === "active" && payload.status !== "archived" && payload.status !== "superseded") {
    const error = new Error("Active workflow templates are immutable. Create a new version instead.");
    error.status = 409;
    throw error;
  }
  Object.assign(template, payload, { updatedBy: user._id });
  template.auditHistory.push({ action: "update", performedBy: user._id, changes: payload });
  await template.save();
  await writeAuditLog("update", "workflow_template", template, user, payload, req);
  return template;
}

async function publishTemplate(template, user, req) {
  assertDesigner(user, "publish workflow templates");
  template.status = "active";
  template.latestVersion = true;
  template.updatedBy = user._id;
  template.auditHistory.push({ action: "publish", performedBy: user._id });
  await template.save();
  await writeAuditLog("publish", "workflow_template", template, user, {}, req);
  return template;
}

async function createTemplateVersion(template, payload, user, req) {
  assertDesigner(user, "version workflow templates");
  await WorkflowTemplate.updateMany({ rootTemplate: template.rootTemplate || template._id }, { $set: { latestVersion: false, status: "superseded" } });
  const nextTemplate = await WorkflowTemplate.create(copyTemplateShape(template, {
    version: template.version + 1,
    status: "draft",
    parentVersion: template._id,
    rootTemplate: template.rootTemplate || template._id,
    latestVersion: true,
    versionLabel: payload.versionLabel,
    changeSummary: payload.changeSummary,
    createdBy: user._id,
    updatedBy: user._id,
  }));
  nextTemplate.auditHistory.push({ action: "create_version", performedBy: user._id, changes: { source: template._id, ...payload } });
  await nextTemplate.save();
  await writeAuditLog("create_version", "workflow_template", nextTemplate, user, payload, req);
  return nextTemplate;
}

async function cloneTemplate(template, payload, user, req) {
  assertDesigner(user, "clone workflow templates");
  const clone = await WorkflowTemplate.create(copyTemplateShape(template, {
    key: payload.key || `${template.key}_copy_${Date.now()}`,
    name: payload.name || `${template.name} Copy`,
    version: 1,
    status: "draft",
    sourceTemplate: template._id,
    rootTemplate: undefined,
    createdBy: user._id,
    updatedBy: user._id,
  }));
  clone.rootTemplate = clone._id;
  template.analytics = template.analytics || {};
  template.analytics.clonedCount = (template.analytics.clonedCount || 0) + 1;
  await Promise.all([clone.save(), template.save()]);
  await writeAuditLog("clone", "workflow_template", clone, user, { source: template._id }, req);
  return clone;
}

async function exportTemplate(template, user, req) {
  template.importExport = template.importExport || {};
  template.importExport.exportedAt = new Date();
  template.importExport.exportedBy = user?._id;
  await template.save();
  await writeAuditLog("export", "workflow_template", template, user, {}, req);
  return { template, exportedAt: template.importExport.exportedAt };
}

async function importTemplate(payload, user, req) {
  assertDesigner(user, "import workflow templates");
  const source = payload.template || payload;
  return createTemplate({
    ...source,
    key: payload.key || source.key || `imported_workflow_${Date.now()}`,
    name: payload.name || source.name || "Imported Workflow Template",
    version: 1,
    status: "draft",
    importExport: {
      importedFrom: payload.importedFrom || "json",
      importedAt: new Date(),
      importedBy: user._id,
    },
  }, user, req);
}

async function suggestWorkflow(payload, user, req) {
  assertDesigner(user, "generate workflow suggestions");
  const key = payload.key || `ai_workflow_${String(payload.name || payload.prompt || "immigration").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${Date.now()}`;
  return createTemplate({
    key,
    name: payload.name || "AI Suggested Immigration Workflow",
    description: payload.prompt,
    status: "draft",
    module: payload.module || "cases",
    entityType: payload.entityType || "case",
    triggers: ["case.created", "questionnaire.submitted", "document.approved", "attorney.review.completed", "case.filed", "rfe.received", "case.approved"],
    stages: [
      { key: "intake", name: "Intake", order: 1, requiredRoles: ["case_manager"], slaHours: 72 },
      { key: "evidence", name: "Evidence Collection", order: 2, requiredRoles: ["client", "case_manager"], slaHours: 168 },
      { key: "legal_review", name: "Legal Review", order: 3, requiredRoles: ["attorney"], slaHours: 72, approvalRequired: true },
      { key: "filing", name: "USCIS Filing", order: 4, requiredRoles: ["case_manager", "attorney"], slaHours: 48 },
      { key: "decision", name: "USCIS Decision", order: 5, requiredRoles: ["case_manager"], slaHours: 720 },
    ],
    transitions: [
      { from: "intake", to: "evidence", event: "questionnaire.submitted", automatic: true, actions: [{ type: "create_task", config: { title: "Review questionnaire", assignTo: "case_manager", dueInHours: 24, priority: "high" } }] },
      { from: "evidence", to: "legal_review", event: "document.approved", automatic: true, conditions: [{ field: "allDocumentsApproved", operator: "equals", value: true }], actions: [{ type: "create_task", config: { title: "Attorney legal review", assignTo: "attorney", dueInHours: 48, priority: "high" } }] },
      { from: "legal_review", to: "filing", event: "attorney.review.completed", automatic: true, actions: [{ type: "create_task", config: { title: "Prepare USCIS filing package", assignTo: "case_manager", dueInHours: 48, priority: "urgent" } }] },
      { from: "filing", to: "decision", event: "case.filed", automatic: true, actions: [{ type: "notify", config: { roles: ["client", "case_manager"], title: "Case filed", message: "USCIS filing submitted." } }] },
    ],
    aiSuggestions: {
      enabled: true,
      prompt: payload.prompt,
      suggestions: payload.suggestions || [],
      generatedAt: new Date(),
      generatedBy: user._id,
    },
  }, user, req);
}

function getInitialStage(template, payload = {}) {
  return payload.currentStage || template.stages?.sort((a, b) => a.order - b.order)[0]?.key || "intake";
}

function calculateDueAt(template, stageKey, payload = {}) {
  if (payload.dueAt) return payload.dueAt;
  const stage = template.stages?.find((item) => item.key === stageKey);
  const hours = stage?.slaHours || template.sla?.defaultHours;
  return hours ? new Date(Date.now() + Number(hours) * 60 * 60 * 1000) : undefined;
}

function resolveAssignee(caseData, assignTo) {
  if (!caseData) return undefined;
  const fieldByAssignee = {
    case_manager: "assignedCaseManager",
    attorney: "assignedAttorney",
    professor: "assignedProfessor",
    client: "user",
    finance: "assignedFinance",
  };
  return caseData[fieldByAssignee[assignTo]] || undefined;
}

async function getAvailableUser(role, teamId) {
  const candidates = await User.find({ role, ...(teamId ? { teamId } : {}), $or: [{ isActive: true }, { status: "active" }, { active: true }] }).select("_id role teamId lastLogin updatedAt").lean();
  if (!candidates.length) return null;
  const workloads = await Task.aggregate([
    { $match: { assignedTo: { $in: candidates.map((user) => user._id) }, status: { $nin: ["completed", "cancelled"] } } },
    { $group: { _id: "$assignedTo", activeTasks: { $sum: 1 }, urgentTasks: { $sum: { $cond: [{ $eq: ["$priority", "urgent"] }, 1, 0] } } } },
  ]);
  const workloadByUser = new Map(workloads.map((item) => [idOf(item._id), item]));
  return candidates
    .sort((left, right) => {
      const leftWorkload = workloadByUser.get(idOf(left._id)) || {};
      const rightWorkload = workloadByUser.get(idOf(right._id)) || {};
      if ((leftWorkload.activeTasks || 0) !== (rightWorkload.activeTasks || 0)) return (leftWorkload.activeTasks || 0) - (rightWorkload.activeTasks || 0);
      if ((leftWorkload.urgentTasks || 0) !== (rightWorkload.urgentTasks || 0)) return (leftWorkload.urgentTasks || 0) - (rightWorkload.urgentTasks || 0);
      return new Date(right.lastLogin || right.updatedAt || 0) - new Date(left.lastLogin || left.updatedAt || 0);
    })[0];
}

function buildApprovalInstances(template) {
  const levels = template.approval?.levels || [];
  return levels.map((level, index) => ({
    level: index + 1,
    name: level.name,
    requiredRoles: level.requiredRoles,
    requiredApprovals: level.requiredApprovals || 1,
    dueAt: level.escalationHours ? new Date(Date.now() + Number(level.escalationHours) * 60 * 60 * 1000) : undefined,
  }));
}

async function createWorkflow(payload, user, req) {
  const template = payload.templateId
    ? await WorkflowTemplate.findById(payload.templateId)
    : await WorkflowTemplate.findOne({ key: payload.templateKey || DEFAULT_CASE_WORKFLOW_TEMPLATE.key, status: "active" }).sort({ version: -1 });
  if (!template) {
    const error = new Error("Workflow template not found");
    error.status = 404;
    throw error;
  }
  const currentStage = getInitialStage(template, payload);
  const assignedTo = payload.assignedTo || payload.context?.assignedUserIds || [];
  const workflow = await Workflow.create({
    template: template._id,
    templateKey: template.key,
    templateVersion: template.version,
    name: payload.name || template.name,
    entityType: payload.entityType || template.entityType,
    entityId: payload.entityId || payload.caseId,
    caseId: payload.caseId,
    clientId: payload.clientId,
    beneficiaryId: payload.beneficiaryId,
    companyId: payload.companyId || payload.context?.companyId,
    owner: payload.owner || user?._id,
    assignedTo: Array.isArray(assignedTo) ? assignedTo.filter(Boolean) : [assignedTo].filter(Boolean),
    currentStage,
    activeStages: payload.activeStages || [currentStage],
    status: payload.status || "active",
    priority: payload.priority || "medium",
    progress: payload.progress || 0,
    context: payload.context || {},
    variables: { ...(template.variables || {}), ...(payload.variables || {}) },
    dueAt: calculateDueAt(template, currentStage, payload),
    warningAt: template.sla?.warningBeforeHours && calculateDueAt(template, currentStage, payload)
      ? new Date(calculateDueAt(template, currentStage, payload).getTime() - Number(template.sla.warningBeforeHours) * 60 * 60 * 1000)
      : undefined,
    recurrence: template.scheduling?.recurring ? {
      enabled: true,
      cron: template.scheduling.cron,
      timezone: template.scheduling.timezone,
    } : payload.recurrence,
    approvals: buildApprovalInstances(template),
    createdBy: user?._id,
    updatedBy: user?._id,
    history: [{ event: "workflow.started", toStage: currentStage, status: "active", performedBy: user?._id }],
  });
  template.analytics = template.analytics || {};
  template.analytics.startedCount = (template.analytics.startedCount || 0) + 1;
  addAuditEntry(workflow, "create", user, payload, req);
  await Promise.all([workflow.save(), template.save()]);
  await writeAuditLog("create", "workflow", workflow, user, payload, req);
  return workflow;
}

async function startCaseWorkflow(caseData, user, req) {
  await ensureDefaultTemplates(user, req);
  const existing = await Workflow.findOne({ caseId: caseData._id, templateKey: DEFAULT_CASE_WORKFLOW_TEMPLATE.key, status: { $in: ["active", "waiting", "paused"] } });
  if (existing) return existing;
  return createWorkflow({
    templateKey: DEFAULT_CASE_WORKFLOW_TEMPLATE.key,
    entityType: "case",
    entityId: caseData._id,
    caseId: caseData._id,
    clientId: caseData.clientProfile,
    beneficiaryId: caseData.beneficiary,
    companyId: caseData.companyId || caseData.company,
    currentStage: caseData.stage || "intake",
    assignedTo: [caseData.assignedCaseManager, caseData.assignedAttorney, caseData.assignedProfessor].filter(Boolean),
    context: {
      caseNumber: caseData.caseNumber,
      clientUserId: caseData.user,
      companyId: caseData.companyId || caseData.company,
      teamId: caseData.teamId,
      assignedUserIds: [caseData.assignedCaseManager, caseData.assignedAttorney, caseData.assignedProfessor].filter(Boolean),
    },
  }, user, req);
}

async function createTaskFromAction(workflow, action, user, req, caseData) {
  const config = action.config || {};
  const dueDate = config.dueDate || (config.dueInHours ? new Date(Date.now() + Number(config.dueInHours) * 60 * 60 * 1000) : undefined);
  const assignedTo = config.assignedTo || config.userId || resolveAssignee(caseData, config.assignTo) || (config.assignTo ? (await getAvailableUser(config.assignTo, caseData?.teamId || workflow.context?.teamId))?._id : undefined);
  const warningAt = dueDate && config.reminderBeforeHours ? new Date(new Date(dueDate).getTime() - Number(config.reminderBeforeHours) * 60 * 60 * 1000) : undefined;
  const task = await Task.create({
    title: config.title || `Workflow task - ${workflow.name}`,
    description: config.description,
    caseId: workflow.caseId,
    workflowId: workflow._id,
    workflowTemplateId: workflow.template,
    clientId: caseData?.user,
    assignedTo,
    assignedTeam: config.assignedTeam || config.teamId || caseData?.teamId || workflow.context?.teamId,
    assignedRole: config.assignTo || config.assignedRole,
    department: config.department,
    skillTags: config.skillTags || config.skills || [],
    assignedBy: user?._id || assignedTo,
    dueDate,
    priority: config.priority || workflow.priority || "medium",
    status: assignedTo ? "assigned" : "pending",
    category: config.category || "automation",
    companyId: caseData?.companyId || caseData?.company || workflow.companyId || workflow.context?.companyId,
    teamId: caseData?.teamId || workflow.context?.teamId,
    source: "workflow",
    tags: config.tags || ["workflow"],
    dependencies: config.dependencies || [],
    attachments: (config.attachments || []).map((document) => ({ document, label: config.attachmentLabel, attachedBy: user?._id })),
    reminders: [
      ...(warningAt ? [{ date: warningAt, sent: false }] : []),
      ...(config.reminders || []),
    ],
    sla: {
      warningAt,
      timezone: config.timezone || workflow.recurrence?.timezone || "UTC",
      businessDaysOnly: Boolean(config.businessDaysOnly),
    },
    estimatedHours: config.estimatedHours || 0,
  });
  task.auditHistory.push({ action: "workflow_create", performedBy: user?._id, changes: { workflowId: workflow._id }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await task.save();
  workflow.metrics.tasksCreated += 1;
  if (caseData) {
    caseService.addTimelineEvent(caseData, "task", "Task Assigned", task.title, user, { taskId: task._id, workflowId: workflow._id, assignedTo });
    await caseData.save();
  }
  if (assignedTo) {
    await notificationService.createNotification({
      userId: assignedTo,
      type: "task_assigned",
      title: "New Task Assigned",
      message: task.title,
      link: `/tasks/${task._id}`,
      caseId: workflow.caseId,
      taskId: task._id,
      source: "workflow",
    }, user, req);
    workflow.metrics.notificationsSent += 1;
  }
  return task;
}

async function scheduleReminderForTask(taskId, reminderDate) {
  if (!taskId || !reminderDate) return null;
  return Task.findByIdAndUpdate(taskId, { $push: { reminders: { date: reminderDate, sent: false } } }, { new: true });
}

async function executeAction(workflow, action, context, user, req) {
  const execution = {
    actionType: action.type,
    status: "running",
    attempts: 1,
    input: action.config,
    startedAt: new Date(),
    correlationId: context.correlationId,
  };
  workflow.executions.push(execution);
  const executionDoc = workflow.executions[workflow.executions.length - 1];
  try {
    const caseData = workflow.caseId ? await Case.findById(workflow.caseId) : null;
    const config = action.config || {};
    let output = {};
    if (action.type === "create_task") {
      output.taskId = (await createTaskFromAction(workflow, action, user, req, caseData))._id;
    } else if (action.type === "notify") {
      const roles = config.roles || [];
      if (roles.length) {
        await notificationService.createForRoles(roles, {
          title: config.title || "Workflow notification",
          message: config.message || workflow.name,
          type: config.notificationType || "workflow",
          caseId: workflow.caseId,
          source: "workflow",
        }, user, req);
      } else if (config.userId) {
        await notificationService.createNotification({ ...config, caseId: workflow.caseId, source: "workflow" }, user, req);
      }
      workflow.metrics.notificationsSent += 1;
    } else if (action.type === "advance_case_stage" && caseData) {
      caseService.setStage(caseData, config.stage || workflow.currentStage, user, `Workflow ${workflow.name}`);
      await caseData.save();
    } else if (action.type === "set_case_status" && caseData) {
      caseData.status = config.status || caseData.status;
      caseData.workflow.status = caseData.status;
      caseService.addTimelineEvent(caseData, "workflow", "Workflow Status Updated", `Workflow set status to ${caseData.status}`, user, { workflowId: workflow._id });
      await caseData.save();
    } else if (action.type === "update_case_fields" && caseData) {
      Object.assign(caseData, config.fields || {});
      caseService.addTimelineEvent(caseData, "workflow", "Case Updated by Workflow", config.message || workflow.name, user, { workflowId: workflow._id, fields: config.fields });
      await caseData.save();
    } else if (action.type === "assign_case_manager" && caseData) {
      const assignee = config.userId || (await getAvailableUser("case_manager", caseData.teamId))?._id;
      if (assignee) caseData.assignedCaseManager = assignee;
      await caseData.save();
      output.assignedTo = assignee;
    } else if (action.type === "assign_attorney" && caseData) {
      const assignee = config.userId || (await getAvailableUser("attorney", caseData.teamId))?._id;
      if (assignee) caseData.assignedAttorney = assignee;
      await caseData.save();
      output.assignedTo = assignee;
    } else if (action.type === "assign_professor" && caseData) {
      const assignee = config.userId || (await getAvailableUser("professor", caseData.teamId))?._id;
      if (assignee) caseData.assignedProfessor = assignee;
      await caseData.save();
      output.assignedTo = assignee;
    } else if (action.type === "assign_finance" && caseData) {
      const assignee = config.userId || (await getAvailableUser("finance", caseData.teamId))?._id;
      if (assignee) workflow.context.financeUserId = assignee;
      output.assignedTo = assignee;
    } else if (action.type === "schedule_reminder") {
      if (config.taskId) output.taskId = (await scheduleReminderForTask(config.taskId, config.reminderDate || new Date(Date.now() + Number(config.dueInHours || 24) * 60 * 60 * 1000)))?._id;
      else {
        executionDoc.scheduledFor = config.reminderDate || new Date(Date.now() + Number(config.dueInHours || 24) * 60 * 60 * 1000);
        output.scheduled = true;
      }
    } else if (action.type === "close_tasks") {
      const result = await Task.updateMany({ caseId: workflow.caseId, status: { $ne: "completed" }, ...(config.category ? { category: config.category } : {}) }, { $set: { status: config.status || "completed", completionDate: new Date(), progress: config.status === "cancelled" ? undefined : 100 } });
      output.modifiedCount = result.modifiedCount;
    } else if (action.type === "create_activity" && caseData) {
      caseService.addTimelineEvent(caseData, "workflow", config.title || "Workflow Activity", config.message || workflow.name, user, { workflowId: workflow._id, ...context });
      await caseData.save();
    } else if (action.type === "send_email") {
      output.queued = true;
      output.message = "Email action recorded for email service queue";
    } else if (action.type === "generate_questionnaire") {
      output.queued = true;
      output.message = "Questionnaire generation action recorded";
    } else if (action.type === "request_documents") {
      output.queued = true;
      output.message = "Document request action recorded";
    } else if (action.type === "generate_uscis_forms") {
      output.queued = true;
      output.message = "USCIS form generation action recorded";
    } else if (action.type === "trigger_ocr") {
      output.queued = true;
      output.message = "OCR action recorded";
    } else if (action.type === "ai_suggest") {
      output.suggestion = config.suggestion || "Review workflow context and recommend next action";
    } else if (action.type === "branch") {
      workflow.branchState = workflow.branchState || {};
      workflow.branchState[config.key || action._id?.toString() || "branch"] = conditionsPass(config.conditions || [], { ...workflow.context, ...context }) ? "matched" : "not_matched";
      workflow.markModified("branchState");
      output.branchState = workflow.branchState;
    } else if (action.type === "audit") {
      await writeAuditLog(config.action || "workflow_audit", "workflow", workflow, user, { context }, req);
    } else if (action.type === "webhook") {
      output.queued = true;
      output.message = "Webhook action recorded for external queue processing";
    } else if (action.type === "start_workflow") {
      output.workflowId = (await createWorkflow(config || {}, user, req))._id;
    } else if (action.type === "wait") {
      workflow.status = "waiting";
      executionDoc.scheduledFor = config.until || new Date(Date.now() + Number(config.minutes || 60) * 60 * 1000);
      output.waitingUntil = executionDoc.scheduledFor;
    }
    executionDoc.status = "succeeded";
    executionDoc.output = output;
    executionDoc.completedAt = new Date();
    workflow.metrics.actionsSucceeded += 1;
  } catch (error) {
    executionDoc.status = action.retry?.maxAttempts > 1 ? "retrying" : "failed";
    executionDoc.error = error.message;
    executionDoc.nextRetryAt = action.retry?.maxAttempts > 1 ? new Date(Date.now() + (action.retry.delayMinutes || 15) * 60 * 1000) : undefined;
    workflow.metrics.actionsFailed += 1;
  }
}

async function runActions(workflow, actions = [], context, user, req) {
  for (const action of actions) {
    await executeAction(workflow, action, context, user, req);
  }
}

function templateTriggerMatches(template, event, context = {}) {
  if (!template || template.status !== "active") return false;
  const triggers = template.triggers || [];
  const directMatch = triggers.includes(event) || triggers.includes("*");
  const definitionMatches = (template.triggerDefinitions || []).filter((trigger) => trigger.enabled !== false && (trigger.event === event || trigger.event === "*"));
  if (!directMatch && !definitionMatches.length) return false;
  if (definitionMatches.length) return definitionMatches.some((trigger) => conditionsPass(trigger.conditions || [], context));
  return true;
}

async function ensureWorkflowsForEvent(event, context = {}, user, req) {
  const templates = await WorkflowTemplate.find({
    status: "active",
    $or: [
      { triggers: event },
      { triggers: "*" },
      { "triggerDefinitions.event": event },
      { "triggerDefinitions.event": "*" },
    ],
  }).sort({ version: -1, updatedAt: -1 });
  const created = [];
  for (const template of templates) {
    const contextPayload = { event, ...context };
    if (!templateTriggerMatches(template, event, contextPayload)) continue;
    const entityId = context.entityId || context.caseId;
    const existing = await Workflow.findOne({
      template: template._id,
      entityId,
      status: { $in: ["pending", "active", "waiting", "paused"] },
    });
    if (existing) continue;
    const caseData = context.caseId ? await Case.findById(context.caseId) : null;
    const workflow = await createWorkflow({
      templateId: template._id,
      name: template.name,
      entityType: context.entityType || template.entityType || "case",
      entityId,
      caseId: context.caseId,
      clientId: context.clientId || caseData?.clientProfile,
      beneficiaryId: context.beneficiaryId || caseData?.beneficiary,
      companyId: context.companyId || caseData?.companyId || caseData?.company,
      currentStage: context.currentStage || caseData?.stage,
      assignedTo: context.assignedTo || [caseData?.assignedCaseManager, caseData?.assignedAttorney, caseData?.assignedProfessor].filter(Boolean),
      priority: context.priority || caseData?.priority || "medium",
      context: {
        ...(context || {}),
        caseNumber: context.caseNumber || caseData?.caseNumber,
        clientUserId: context.clientUserId || caseData?.user,
        companyId: context.companyId || caseData?.companyId || caseData?.company,
        teamId: context.teamId || caseData?.teamId,
        assignedUserIds: [caseData?.assignedCaseManager, caseData?.assignedAttorney, caseData?.assignedProfessor, ...(context.assignedUserIds || [])].filter(Boolean),
      },
    }, user, req);
    workflow.history.push({ event: "workflow.auto_started", status: workflow.status, message: `Started by event ${event}`, metadata: context, performedBy: user?._id });
    await workflow.save();
    if (caseData) {
      caseService.addTimelineEvent(caseData, "workflow", "Workflow Started", `${workflow.name} started by ${event}`, user, { workflowId: workflow._id, event });
      await caseData.save();
    }
    created.push(workflow);
  }
  return created;
}

async function triggerWorkflow(event, context = {}, user, req) {
  await ensureDefaultTemplates(user, req);
  const startedWorkflows = await ensureWorkflowsForEvent(event, context, user, req);
  const workflows = await Workflow.find({
    status: { $in: ["active", "waiting"] },
    $or: [
      { entityId: context.entityId },
      { caseId: context.caseId },
      { "context.caseNumber": context.caseNumber },
    ].filter((item) => Object.values(item)[0]),
  }).populate("template");
  const results = [];
  for (const workflow of workflows) {
    const template = workflow.template || await WorkflowTemplate.findOne({ key: workflow.templateKey, version: workflow.templateVersion });
    if (!template) continue;
    const transitions = (template.transitions || [])
      .filter((candidate) => {
        const fromMatches = candidate.from === "*" || candidate.from === workflow.currentStage || workflow.activeStages?.includes(candidate.from);
        return fromMatches && candidate.event === event;
      })
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const transition of transitions) {
      const contextPayload = { ...workflow.context, ...workflow.variables, ...context };
      const passed = conditionsPass(transition.conditions || [], contextPayload);
      if (!passed) {
        await runActions(workflow, transition.elseActions || [], contextPayload, user, req);
        continue;
      }
      const fromStage = workflow.currentStage;
      if (transition.to) {
        workflow.completedStages = Array.from(new Set([...(workflow.completedStages || []), fromStage].filter(Boolean)));
        workflow.currentStage = transition.to;
        workflow.activeStages = Array.from(new Set([...(workflow.activeStages || []).filter((stage) => stage !== fromStage), transition.to]));
      }
      const templateStages = template.stages || [];
      workflow.progress = templateStages.length ? Math.round((workflow.completedStages.length / templateStages.length) * 100) : workflow.progress;
      workflow.status = ["approved", "denied", "closed"].includes(workflow.currentStage) ? "completed" : "active";
      if (workflow.status === "completed") workflow.completedAt = new Date();
      workflow.history.push({ event, fromStage, toStage: workflow.currentStage, status: workflow.status, metadata: context, performedBy: user?._id });
      addAuditEntry(workflow, "trigger", user, { event, fromStage, toStage: workflow.currentStage }, req);
      if (workflow.caseId) {
        const caseData = await Case.findById(workflow.caseId);
        if (caseData) {
          caseService.addTimelineEvent(caseData, "workflow", "Workflow Advanced", `${workflow.name}: ${event}`, user, { workflowId: workflow._id, fromStage, toStage: workflow.currentStage, event });
          await caseData.save();
        }
      }
      await runActions(workflow, transition.actions || [], contextPayload, user, req);
    }
    await workflow.save();
    await writeAuditLog("trigger", "workflow", workflow, user, { event, currentStage: workflow.currentStage }, req);
    results.push(workflow);
  }
  return [...new Map([...startedWorkflows, ...results].map((workflow) => [idOf(workflow._id), workflow])).values()];
}

async function transitionWorkflow(workflow, payload, user, req) {
  const template = await WorkflowTemplate.findById(workflow.template);
  const transition = template?.transitions?.find((candidate) => {
    const fromMatches = candidate.from === "*" || candidate.from === workflow.currentStage;
    const toMatches = !payload.toStage || candidate.to === payload.toStage;
    const eventMatches = !payload.event || candidate.event === payload.event;
    return fromMatches && toMatches && eventMatches && conditionsPass(candidate.conditions || [], { ...workflow.context, ...(payload.context || {}) });
  });
  const fromStage = workflow.currentStage;
  workflow.currentStage = payload.toStage || transition?.to || workflow.currentStage;
  workflow.activeStages = Array.from(new Set([...(workflow.activeStages || []).filter((stage) => stage !== fromStage), workflow.currentStage]));
  workflow.completedStages = Array.from(new Set([...(workflow.completedStages || []), fromStage].filter(Boolean)));
  workflow.status = payload.status || workflow.status;
  workflow.progress = payload.progress ?? workflow.progress;
  workflow.history.push({ event: payload.event || "manual.transition", fromStage, toStage: workflow.currentStage, status: workflow.status, message: payload.message, metadata: payload.context, performedBy: user?._id });
  addAuditEntry(workflow, "transition", user, payload, req);
  await runActions(workflow, transition?.actions || payload.actions || [], payload.context || {}, user, req);
  await workflow.save();
  await writeAuditLog("transition", "workflow", workflow, user, payload, req);
  return workflow;
}

async function approveWorkflow(workflow, payload, user, req) {
  if (!canAccessWorkflow(user, workflow)) {
    const error = new Error("Not authorized to approve this workflow");
    error.status = 403;
    throw error;
  }
  const approval = workflow.approvals.id(payload.approvalId) || workflow.approvals.find((item) => item.status === "pending");
  if (!approval) {
    const error = new Error("Pending approval not found");
    error.status = 404;
    throw error;
  }
  const role = roleOf(user);
  if (approval.requiredRoles?.length && !approval.requiredRoles.includes(role)) {
    const error = new Error("User role cannot approve this workflow level");
    error.status = 403;
    throw error;
  }
  if (payload.approved === false) {
    approval.status = "rejected";
    approval.rejectedBy = user._id;
  } else {
    approval.approvedBy = Array.from(new Set([...(approval.approvedBy || []).map(idOf), idOf(user._id)]));
    if (approval.approvedBy.length >= approval.requiredApprovals) approval.status = "approved";
  }
  approval.decidedAt = new Date();
  approval.notes = payload.notes;
  workflow.metrics.approvalCycles += 1;
  workflow.history.push({ event: payload.approved === false ? "workflow.approval.rejected" : "workflow.approval.approved", status: workflow.status, message: payload.notes, performedBy: user._id, metadata: { approvalId: approval._id } });
  addAuditEntry(workflow, "approval", user, payload, req);
  await workflow.save();
  await writeAuditLog("approval", "workflow", workflow, user, payload, req);
  return workflow;
}

async function checkSlaBreaches(user, req) {
  const now = new Date();
  const workflows = await Workflow.find({ dueAt: { $lte: now }, status: { $in: ["active", "waiting"] }, slaBreachedAt: { $exists: false } });
  for (const workflow of workflows) {
    workflow.slaBreachedAt = now;
    workflow.escalatedAt = now;
    workflow.history.push({ event: "workflow.sla_breached", status: workflow.status, message: "Workflow SLA breached", performedBy: user?._id });
    await notificationService.createForRoles(["admin", "case_manager"], {
      type: "workflow_sla_breached",
      title: "Workflow SLA Breached",
      message: `${workflow.name} breached SLA.`,
      caseId: workflow.caseId,
      source: "workflow",
    }, user, req);
    await workflow.save();
  }
  const reminderTasks = await Task.find({
    status: { $nin: ["completed", "cancelled"] },
    "reminders.date": { $lte: now },
    "reminders.sent": { $ne: true },
  });
  let remindersSent = 0;
  for (const task of reminderTasks) {
    const pendingReminders = (task.reminders || []).filter((reminder) => reminder.date && reminder.date <= now && !reminder.sent);
    if (!pendingReminders.length) continue;
    pendingReminders.forEach((reminder) => {
      reminder.sent = true;
      reminder.sentAt = now;
    });
    if (task.assignedTo) {
      await notificationService.createNotification({
        userId: task.assignedTo,
        type: "task_due",
        title: "Task reminder",
        message: task.title,
        taskId: task._id,
        caseId: task.caseId,
        source: "workflow",
        priority: task.priority === "urgent" ? "high" : "medium",
      }, user, req).catch(() => null);
      remindersSent += 1;
    }
    task.auditHistory.push({ action: "workflow_reminder_sent", performedBy: user?._id, changes: { reminders: pendingReminders.length }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
    await task.save();
  }
  const overdueTasks = await Task.find({
    status: { $nin: ["completed", "cancelled"] },
    dueDate: { $lte: now },
    "sla.breachedAt": { $exists: false },
  });
  let escalatedTasks = 0;
  for (const task of overdueTasks) {
    task.sla = { ...(task.sla?.toObject?.() || task.sla || {}), breachedAt: now };
    task.escalation = {
      ...(task.escalation?.toObject?.() || task.escalation || {}),
      level: (task.escalation?.level || 0) + 1,
      escalatedAt: now,
      reason: "Task deadline breached",
    };
    task.auditHistory.push({ action: "task_sla_breached", performedBy: user?._id, changes: { dueDate: task.dueDate }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
    if (task.assignedTo) {
      await notificationService.createNotification({
        userId: task.assignedTo,
        type: "task_overdue",
        title: "Task overdue",
        message: `${task.title} is overdue.`,
        taskId: task._id,
        caseId: task.caseId,
        source: "workflow",
        priority: "high",
      }, user, req).catch(() => null);
    }
    await notificationService.createForRoles(["admin", "team_lead", "case_manager"], {
      type: "task_overdue",
      title: "Workflow task overdue",
      message: `${task.title} is overdue.`,
      taskId: task._id,
      caseId: task.caseId,
      source: "workflow",
      priority: "high",
    }, user, req).catch(() => null);
    await task.save();
    escalatedTasks += 1;
  }
  return { processedCount: workflows.length, remindersSent, escalatedTasks };
}

async function processScheduledWorkflows(user, req) {
  const now = new Date();
  const workflows = await Workflow.find({
    status: "waiting",
    "executions.scheduledFor": { $lte: now },
  });
  for (const workflow of workflows) {
    workflow.status = "active";
    workflow.history.push({ event: "workflow.resumed", status: "active", message: "Scheduled wait completed", performedBy: user?._id });
    await workflow.save();
  }
  return { processedCount: workflows.length };
}

async function retryFailedActions(user, req) {
  const now = new Date();
  const workflows = await Workflow.find({ "executions.status": "retrying", "executions.nextRetryAt": { $lte: now } });
  for (const workflow of workflows) {
    const dueExecutions = workflow.executions.filter((execution) => execution.status === "retrying" && execution.nextRetryAt && execution.nextRetryAt <= now);
    for (const execution of dueExecutions) {
      execution.status = "skipped";
      workflow.history.push({ event: "workflow.retry_due", status: workflow.status, message: `Retry due for ${execution.actionType}`, performedBy: user?._id, metadata: { executionId: execution._id } });
      await executeAction(workflow, {
        type: execution.actionType,
        config: execution.input || {},
        retry: { maxAttempts: Math.max((execution.attempts || 1) + 1, 2), delayMinutes: 15 },
      }, { correlationId: execution.correlationId, retryOf: execution._id }, user, req);
    }
    await workflow.save();
  }
  return { processedCount: workflows.length };
}

async function getAnalytics(query = {}) {
  const match = {};
  if (query.templateKey) match.templateKey = query.templateKey;
  if (query.status) match.status = query.status;
  if (query.entityType) match.entityType = query.entityType;
  if (query.caseId) match.caseId = query.caseId;
  if (query.companyId) match.companyId = query.companyId;
  if (query.teamId) match["context.teamId"] = query.teamId;
  const taskMatch = {};
  if (query.caseId) taskMatch.caseId = query.caseId;
  if (query.companyId) taskMatch.companyId = query.companyId;
  if (query.teamId) taskMatch.$or = [{ teamId: query.teamId }, { assignedTeam: query.teamId }];
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [statusCounts, stageCounts, sla, taskStatusCounts, taskPriorityCounts, upcomingDeadlines, overdueTasks, escalatedTasks] = await Promise.all([
    Workflow.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Workflow.aggregate([{ $match: match }, { $group: { _id: "$currentStage", count: { $sum: 1 } } }]),
    Workflow.aggregate([{ $match: { ...match, slaBreachedAt: { $exists: true } } }, { $count: "breached" }]),
    Task.aggregate([{ $match: taskMatch }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: { ...taskMatch, status: { $nin: ["completed", "cancelled"] } } }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
    Task.find({ ...taskMatch, status: { $nin: ["completed", "cancelled"] }, dueDate: { $gte: now, $lte: sevenDaysFromNow } })
      .sort({ dueDate: 1 })
      .limit(20)
      .select("title status priority dueDate caseId assignedTo assignedTeam category")
      .lean(),
    Task.find({ ...taskMatch, status: { $nin: ["completed", "cancelled"] }, dueDate: { $lt: now } })
      .sort({ dueDate: 1 })
      .limit(20)
      .select("title status priority dueDate caseId assignedTo assignedTeam category escalation")
      .lean(),
    Task.countDocuments({ ...taskMatch, "escalation.level": { $gt: 0 }, status: { $nin: ["completed", "cancelled"] } }),
  ]);
  return {
    statusCounts,
    stageCounts,
    slaBreaches: sla[0]?.breached || 0,
    tasks: {
      statusCounts: taskStatusCounts,
      priorityCounts: taskPriorityCounts,
      upcomingDeadlines,
      overdueTasks,
      escalatedTasks,
    },
  };
}

function populateWorkflowQuery(query) {
  return query.populate([
    { path: "template", select: "key name version status module" },
    { path: "caseId", select: "caseNumber clientName stage status" },
    { path: "createdBy", select: "name displayName email role" },
  ]);
}

module.exports = {
  approveWorkflow,
  buildWorkflowFilter,
  canAccessWorkflow,
  canManageWorkflows,
  checkSlaBreaches,
  cloneTemplate,
  createTemplate,
  createTemplateVersion,
  createWorkflow,
  ensureDefaultTemplates,
  exportTemplate,
  getAnalytics,
  importTemplate,
  populateWorkflowQuery,
  processScheduledWorkflows,
  publishTemplate,
  retryFailedActions,
  startCaseWorkflow,
  suggestWorkflow,
  transitionWorkflow,
  triggerWorkflow,
  updateTemplate,
};
