const Workflow = require("../../models/Workflow");
const WorkflowTemplate = require("../../models/WorkflowTemplate");
const workflowService = require("./workflow.service");

exports.seedDefaults = async (req, res, next) => {
  try {
    const template = await workflowService.ensureDefaultTemplates(req.user, req);
    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

exports.getTemplates = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.module) filter.module = req.query.module;
    if (req.query.key) filter.key = req.query.key;
    const templates = await WorkflowTemplate.find(filter).sort({ key: 1, version: -1 });
    res.json({ success: true, count: templates.length, data: templates });
  } catch (error) {
    next(error);
  }
};

exports.getTemplate = async (req, res, next) => {
  try {
    const template = await WorkflowTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Workflow template not found" });
    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

exports.createTemplate = async (req, res, next) => {
  try {
    const template = await workflowService.createTemplate(req.body, req.user, req);
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    const template = await WorkflowTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Workflow template not found" });
    const updated = await workflowService.updateTemplate(template, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.publishTemplate = async (req, res, next) => {
  try {
    const template = await WorkflowTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Workflow template not found" });
    const updated = await workflowService.publishTemplate(template, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.createTemplateVersion = async (req, res, next) => {
  try {
    const template = await WorkflowTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Workflow template not found" });
    const nextTemplate = await workflowService.createTemplateVersion(template, req.body, req.user, req);
    res.status(201).json({ success: true, data: nextTemplate });
  } catch (error) {
    next(error);
  }
};

exports.cloneTemplate = async (req, res, next) => {
  try {
    const template = await WorkflowTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Workflow template not found" });
    const clone = await workflowService.cloneTemplate(template, req.body, req.user, req);
    res.status(201).json({ success: true, data: clone });
  } catch (error) {
    next(error);
  }
};

exports.exportTemplate = async (req, res, next) => {
  try {
    const template = await WorkflowTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Workflow template not found" });
    const exported = await workflowService.exportTemplate(template, req.user, req);
    res.json({ success: true, data: exported });
  } catch (error) {
    next(error);
  }
};

exports.importTemplate = async (req, res, next) => {
  try {
    const template = await workflowService.importTemplate(req.body, req.user, req);
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

exports.suggestWorkflow = async (req, res, next) => {
  try {
    const template = await workflowService.suggestWorkflow(req.body, req.user, req);
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

exports.getWorkflows = async (req, res, next) => {
  try {
    const filter = workflowService.buildWorkflowFilter(req.query, req.user);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;
    const workflows = await workflowService.populateWorkflowQuery(Workflow.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit));
    const data = workflows.filter((workflow) => workflowService.canAccessWorkflow(req.user, workflow));
    const total = await Workflow.countDocuments(filter);
    res.json({ success: true, count: data.length, total, page, pages: Math.ceil(total / limit), data });
  } catch (error) {
    next(error);
  }
};

exports.getWorkflow = async (req, res, next) => {
  try {
    const workflow = await workflowService.populateWorkflowQuery(Workflow.findById(req.params.id));
    if (!workflow) return res.status(404).json({ success: false, message: "Workflow not found" });
    if (!workflowService.canAccessWorkflow(req.user, workflow)) return res.status(403).json({ success: false, message: "Not authorized to access this workflow" });
    res.json({ success: true, data: workflow });
  } catch (error) {
    next(error);
  }
};

exports.createWorkflow = async (req, res, next) => {
  try {
    const workflow = await workflowService.createWorkflow(req.body, req.user, req);
    res.status(201).json({ success: true, data: workflow });
  } catch (error) {
    next(error);
  }
};

exports.startCaseWorkflow = async (req, res, next) => {
  try {
    const Case = require("../../models/Case");
    const caseData = await Case.findById(req.params.caseId);
    if (!caseData) return res.status(404).json({ success: false, message: "Case not found" });
    const workflow = await workflowService.startCaseWorkflow(caseData, req.user, req);
    res.status(201).json({ success: true, data: workflow });
  } catch (error) {
    next(error);
  }
};

exports.transitionWorkflow = async (req, res, next) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, message: "Workflow not found" });
    if (!workflowService.canAccessWorkflow(req.user, workflow)) return res.status(403).json({ success: false, message: "Not authorized to transition this workflow" });
    const updated = await workflowService.transitionWorkflow(workflow, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.approveWorkflow = async (req, res, next) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, message: "Workflow not found" });
    const updated = await workflowService.approveWorkflow(workflow, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.triggerWorkflow = async (req, res, next) => {
  try {
    const workflows = await workflowService.triggerWorkflow(req.body.event, req.body.context || {}, req.user, req);
    res.json({ success: true, count: workflows.length, data: workflows });
  } catch (error) {
    next(error);
  }
};

exports.checkSlaBreaches = async (req, res, next) => {
  try {
    const result = await workflowService.checkSlaBreaches(req.user, req);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.processScheduledWorkflows = async (req, res, next) => {
  try {
    const result = await workflowService.processScheduledWorkflows(req.user, req);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.retryFailedActions = async (req, res, next) => {
  try {
    const result = await workflowService.retryFailedActions(req.user, req);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getAnalytics = async (req, res, next) => {
  try {
    const analytics = await workflowService.getAnalytics(req.query);
    res.json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
};
