const mongoose = require("mongoose");

const reminderSchema = new mongoose.Schema(
  {
    date: Date,
    sent: { type: Boolean, default: false },
    sentAt: Date,
  },
  { _id: true }
);

const taskAuditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    changes: mongoose.Schema.Types.Mixed,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
    ipAddress: String,
    userAgent: String,
  },
  { _id: true }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow", index: true },
    workflowTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowTemplate", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    assignedRole: String,
    department: String,
    skillTags: [String],
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    dueDate: { type: Date, index: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium", index: true },
    status: {
      type: String,
      enum: ["pending", "assigned", "in_progress", "waiting", "blocked", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
    category: {
      type: String,
      enum: [
        "case_preparation",
        "document_review",
        "legal_review",
        "expert_letter",
        "filing",
        "rfe_response",
        "follow_up",
        "administrative",
        "finance",
        "client_communication",
        "renewal",
        "deadline",
        "escalation",
        "approval",
        "automation",
        "other",
      ],
      default: "case_preparation",
      index: true,
    },
    documentation: {
      workType: {
        type: String,
        enum: [
          "intake_review",
          "document_request",
          "document_collection",
          "ocr_verification",
          "document_classification",
          "evidence_index",
          "quality_control",
          "translation",
          "certification",
          "uscis_notice",
          "rfe_evidence",
          "filing_package",
          "client_follow_up",
          "other",
        ],
      },
      documentType: { type: String, trim: true },
      evidenceCategory: {
        type: String,
        enum: ["identity", "immigration", "education", "employment", "financial", "civil", "business", "medical", "legal", "supporting", "other"],
      },
      instructions: { type: String, trim: true },
      reviewRequired: { type: Boolean, default: true },
      reviewStatus: {
        type: String,
        enum: ["not_started", "in_review", "changes_requested", "approved", "not_required"],
        default: "not_started",
      },
      reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    comments: [
      {
        text: String,
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    completionDate: Date,
    dependencies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
    attachments: [
      {
        document: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
        label: String,
        attachedAt: { type: Date, default: Date.now },
        attachedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
    reminders: [reminderSchema],
    completionHistory: [
      {
        status: String,
        progress: Number,
        note: String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        changedAt: { type: Date, default: Date.now },
      },
    ],
    escalation: {
      level: { type: Number, default: 0 },
      escalatedAt: Date,
      escalatedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      reason: String,
    },
    sla: {
      warningAt: Date,
      breachedAt: Date,
      timezone: String,
      businessDaysOnly: { type: Boolean, default: false },
    },
    tags: [String],
    estimatedHours: { type: Number, default: 0 },
    actualHours: { type: Number, default: 0 },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", index: true },
    source: { type: String, enum: ["manual", "workflow", "automation", "shared"], default: "shared" },
    auditHistory: [taskAuditSchema],
  },
  { timestamps: true }
);

taskSchema.pre("save", function setCompletionDate(next) {
  if (this.isModified("status")) {
    this.completionHistory = this.completionHistory || [];
    this.completionHistory.push({
      status: this.status,
      progress: this.progress,
      note: "Task status updated",
      changedBy: this.assignedBy,
      changedAt: new Date(),
    });
    if (this.completionHistory.length > 250) this.completionHistory = this.completionHistory.slice(-250);
  }
  if (this.isModified("status") && this.status === "completed" && !this.completionDate) {
    this.completionDate = new Date();
    this.progress = 100;
  }
  if (this.isModified("status") && this.status !== "completed" && this.completionDate) {
    this.completionDate = undefined;
  }
  next();
});

taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ caseId: 1, status: 1 });
taskSchema.index({ status: 1, dueDate: 1 });
taskSchema.index({ teamId: 1, status: 1 });
taskSchema.index({ assignedTeam: 1, status: 1, dueDate: 1 });
taskSchema.index({ "sla.warningAt": 1, status: 1 });

module.exports = mongoose.model("Task", taskSchema);
