const mongoose = require("mongoose");

const executionSchema = new mongoose.Schema(
  {
    actionType: String,
    status: { type: String, enum: ["pending", "running", "succeeded", "failed", "skipped", "retrying"], default: "pending" },
    attempts: { type: Number, default: 0 },
    nextRetryAt: Date,
    error: String,
    input: mongoose.Schema.Types.Mixed,
    output: mongoose.Schema.Types.Mixed,
    startedAt: Date,
    completedAt: Date,
    scheduledFor: Date,
    correlationId: String,
  },
  { _id: true }
);

const historySchema = new mongoose.Schema(
  {
    event: { type: String, required: true },
    fromStage: String,
    toStage: String,
    status: String,
    message: String,
    metadata: mongoose.Schema.Types.Mixed,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const approvalInstanceSchema = new mongoose.Schema(
  {
    level: { type: Number, default: 1 },
    name: String,
    status: { type: String, enum: ["pending", "approved", "rejected", "skipped"], default: "pending", index: true },
    requiredRoles: [String],
    requiredApprovals: { type: Number, default: 1 },
    approvedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
    notes: String,
    dueAt: Date,
    escalatedAt: Date,
  },
  { _id: true }
);

const workflowSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowTemplate", index: true },
    templateKey: { type: String, index: true },
    templateVersion: Number,
    name: { type: String, required: true },
    entityType: { type: String, default: "case", index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    currentStage: { type: String, index: true },
    activeStages: [{ type: String }],
    completedStages: [{ type: String }],
    blockedByStages: [{ type: String }],
    status: {
      type: String,
      enum: ["pending", "active", "waiting", "completed", "cancelled", "failed", "paused"],
      default: "active",
      index: true,
    },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", index: true },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },
    branchState: { type: mongoose.Schema.Types.Mixed, default: {} },
    approvals: [approvalInstanceSchema],
    dueAt: { type: Date, index: true },
    warningAt: Date,
    slaBreachedAt: Date,
    escalatedAt: Date,
    recurrence: {
      enabled: { type: Boolean, default: false },
      cron: String,
      timezone: String,
      nextRunAt: Date,
      lastRunAt: Date,
    },
    metrics: {
      tasksCreated: { type: Number, default: 0 },
      notificationsSent: { type: Number, default: 0 },
      actionsSucceeded: { type: Number, default: 0 },
      actionsFailed: { type: Number, default: 0 },
      approvalCycles: { type: Number, default: 0 },
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    history: [historySchema],
    executions: [executionSchema],
    auditHistory: [
      {
        action: String,
        changes: mongoose.Schema.Types.Mixed,
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        performedAt: { type: Date, default: Date.now },
        ipAddress: String,
        userAgent: String,
      },
    ],
  },
  { timestamps: true }
);

workflowSchema.index({ entityType: 1, entityId: 1, status: 1 });
workflowSchema.index({ caseId: 1, status: 1 });
workflowSchema.index({ dueAt: 1, status: 1 });
workflowSchema.index({ assignedTo: 1, status: 1, dueAt: 1 });
workflowSchema.index({ companyId: 1, status: 1 });
workflowSchema.index({ "recurrence.nextRunAt": 1, status: 1 });
// Supports workflow.service.js processScheduledWorkflows(): filters on
// top-level status:"waiting" + executions.scheduledFor ($lte) — none of the
// indexes above cover a bare status query since they all require a different
// leading field (caseId/companyId/dueAt/etc) first.
workflowSchema.index({ status: 1, "executions.scheduledFor": 1 });
// Supports retryFailedActions(): filters on the nested executions.status
// ("retrying") + executions.nextRetryAt ($lte), previously unindexed —
// same COLLSCAN shape as the notifications retryFailed bug.
workflowSchema.index({ "executions.status": 1, "executions.nextRetryAt": 1 });

module.exports = mongoose.model("Workflow", workflowSchema);
