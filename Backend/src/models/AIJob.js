const mongoose = require("mongoose");

const aiJobSchema = new mongoose.Schema(
  {
    jobType: {
      type: String,
      enum: ["copilot", "case_review", "semantic_search", "task_suggestions", "draft", "ocr_review", "data_quality"],
      required: true,
      index: true,
    },
    status: { type: String, enum: ["queued", "processing", "completed", "failed", "cancelled"], default: "queued", index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    providerKey: { type: String, index: true },
    provider: String,
    model: String,
    promptTemplate: { type: mongoose.Schema.Types.ObjectId, ref: "AIPromptTemplate" },
    promptKey: String,
    promptVersion: Number,
    promptHash: { type: String, index: true },
    promptMetadata: {
      variableKeys: [String],
      redactedPreview: String,
      characterCount: Number,
    },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    output: { type: mongoose.Schema.Types.Mixed, default: {} },
    confidence: { type: Number, min: 0, max: 100 },
    citations: [mongoose.Schema.Types.Mixed],
    suggestions: [mongoose.Schema.Types.Mixed],
    review: {
      status: { type: String, enum: ["pending", "approved", "partially_approved", "rejected"], default: "pending", index: true },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: Date,
      notes: String,
      approvedSuggestionIndexes: [Number],
    },
    usage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      estimatedCost: { type: Number, default: 0 },
      currency: { type: String, default: "USD" },
      latencyMs: { type: Number, default: 0 },
      cacheHit: { type: Boolean, default: false },
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextAttemptAt: Date,
    error: {
      code: String,
      message: String,
      retryable: Boolean,
    },
    startedAt: Date,
    completedAt: Date,
    expiresAt: Date,
    auditHistory: [
      {
        action: String,
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        performedAt: { type: Date, default: Date.now },
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],
  },
  { timestamps: true }
);

aiJobSchema.index({ requestedBy: 1, createdAt: -1 });
aiJobSchema.index({ caseId: 1, jobType: 1, createdAt: -1 });
aiJobSchema.index({ status: 1, nextAttemptAt: 1 });
aiJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.model("AIJob", aiJobSchema);
