const mongoose = require("mongoose");

// Outbound queue: CRM -> GHL stage moves. A worker claims jobs atomically and
// re-checks `caseSyncVersion` against the case immediately before calling GHL,
// so a stale job (the user dragged again) is never sent.
const ghlSyncJobSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    opportunityId: { type: String, required: true },
    pipelineId: { type: String, required: true },
    pipelineStageId: { type: String, required: true },
    caseSyncVersion: { type: Number, required: true },
    operationId: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "done", "failed", "superseded"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: Date,
    lastError: String,
    completedAt: Date,
  },
  { timestamps: true }
);

ghlSyncJobSchema.index({ status: 1, nextAttemptAt: 1 });
ghlSyncJobSchema.index({ caseId: 1, status: 1 });
ghlSyncJobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14, partialFilterExpression: { status: { $in: ["done", "superseded"] } } });

module.exports = mongoose.model("GHLSyncJob", ghlSyncJobSchema);
