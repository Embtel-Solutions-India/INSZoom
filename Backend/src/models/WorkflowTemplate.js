const mongoose = require("mongoose");

const conditionSchema = new mongoose.Schema(
  {
    field: String,
    operator: {
      type: String,
      enum: ["equals", "not_equals", "in", "not_in", "exists", "missing", "gt", "gte", "lt", "lte", "contains", "regex"],
      default: "equals",
    },
    value: mongoose.Schema.Types.Mixed,
    mode: { type: String, enum: ["all", "any"], default: "all" },
    conditions: [{ type: mongoose.Schema.Types.Mixed }],
  },
  { _id: false }
);

const actionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "create_task",
        "notify",
        "advance_case_stage",
        "set_case_status",
        "audit",
        "webhook",
        "start_workflow",
        "assign_case_manager",
        "assign_finance",
        "send_email",
        "schedule_reminder",
        "close_tasks",
        "update_case_fields",
        "create_activity",
        "generate_questionnaire",
        "request_documents",
        "generate_uscis_forms",
        "trigger_ocr",
        "ai_suggest",
        "branch",
        "wait",
        "noop",
      ],
      required: true,
    },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    retry: {
      maxAttempts: { type: Number, default: 1 },
      delayMinutes: { type: Number, default: 15 },
    },
  },
  { _id: true }
);

const transitionSchema = new mongoose.Schema(
  {
    from: String,
    to: String,
    event: String,
    conditions: [conditionSchema],
    actions: [actionSchema],
    elseActions: [actionSchema],
    automatic: { type: Boolean, default: false },
    priority: { type: Number, default: 0 },
  },
  { _id: true }
);

const approvalSchema = new mongoose.Schema(
  {
    name: String,
    requiredRoles: [String],
    requiredApprovals: { type: Number, default: 1 },
    escalationHours: Number,
    onApproveActions: [actionSchema],
    onRejectActions: [actionSchema],
  },
  { _id: true }
);

const stageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, default: 0 },
    description: String,
    requiredRoles: [String],
    slaHours: Number,
    deadlineOffsetHours: Number,
    approvalRequired: { type: Boolean, default: false },
    approval: approvalSchema,
    parallelGroup: String,
    sequenceGroup: String,
    allowParallelEntry: { type: Boolean, default: false },
    entryActions: [actionSchema],
    exitActions: [actionSchema],
    escalationRules: [
      {
        afterHours: Number,
        notifyRoles: [String],
        actions: [actionSchema],
      },
    ],
  },
  { _id: true }
);

const workflowTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: String,
    version: { type: Number, default: 1 },
    status: { type: String, enum: ["draft", "active", "archived", "superseded"], default: "draft", index: true },
    type: { type: String, enum: ["workflow", "template", "automation_rule", "library_item"], default: "workflow", index: true },
    module: { type: String, enum: ["cases", "clients", "beneficiaries", "companies", "documents", "payments", "appointments", "messages", "questionnaires", "forms", "ocr", "ai", "custom"], default: "cases" },
    entityType: { type: String, default: "case" },
    isTemplate: { type: Boolean, default: true, index: true },
    category: { type: String, default: "immigration", index: true },
    tags: [{ type: String, index: true }],
    sourceTemplate: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowTemplate" },
    rootTemplate: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowTemplate" },
    parentVersion: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowTemplate" },
    latestVersion: { type: Boolean, default: true, index: true },
    versionLabel: String,
    changeSummary: String,
    triggers: [{ type: String, index: true }],
    triggerDefinitions: [
      {
        event: String,
        source: { type: String, enum: ["api", "case", "document", "questionnaire", "payment", "appointment", "ocr", "forms", "ai", "scheduler", "webhook"], default: "api" },
        enabled: { type: Boolean, default: true },
        conditions: [conditionSchema],
      },
    ],
    stages: [stageSchema],
    transitions: [transitionSchema],
    builder: {
      visualBuilderEnabled: { type: Boolean, default: true },
      nodes: [{ type: mongoose.Schema.Types.Mixed }],
      edges: [{ type: mongoose.Schema.Types.Mixed }],
      layout: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    scheduling: {
      recurring: { type: Boolean, default: false },
      cron: String,
      timezone: { type: String, default: "UTC" },
      maxConcurrentRuns: { type: Number, default: 1 },
    },
    sla: {
      enabled: { type: Boolean, default: true },
      defaultHours: Number,
      warningBeforeHours: Number,
      escalationRoles: [{ type: String }],
    },
    approval: {
      enabled: { type: Boolean, default: false },
      levels: [approvalSchema],
    },
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },
    analytics: {
      startedCount: { type: Number, default: 0 },
      completedCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
      averageCompletionHours: { type: Number, default: 0 },
      clonedCount: { type: Number, default: 0 },
    },
    aiSuggestions: {
      enabled: { type: Boolean, default: false },
      prompt: String,
      suggestions: [{ type: mongoose.Schema.Types.Mixed }],
      generatedAt: Date,
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    importExport: {
      importedFrom: String,
      importedAt: Date,
      importedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      exportedAt: Date,
      exportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    auditHistory: [
      {
        action: String,
        changes: mongoose.Schema.Types.Mixed,
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        performedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

workflowTemplateSchema.index({ key: 1, version: 1 }, { unique: true });
workflowTemplateSchema.index({ module: 1, status: 1 });
workflowTemplateSchema.index({ rootTemplate: 1, version: -1 });
workflowTemplateSchema.index({ isTemplate: 1, category: 1, status: 1 });

module.exports = mongoose.model("WorkflowTemplate", workflowTemplateSchema);
