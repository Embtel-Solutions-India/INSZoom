const mongoose = require("mongoose");

// Outbound queue: CRM -> GHL stage moves. A worker claims jobs atomically and
// re-checks `caseSyncVersion` against the case immediately before calling GHL,
// so a stale job (the user dragged again) is never sent.
const ghlSyncJobSchema = new mongoose.Schema(
  {
    // "stage" = move a card (the original job). The others act on an EMPLOYEE card and recompute what to do when they
    // run, so a stale job can never push stale data:
    //   create_opportunity  a new employee card has no GHL opportunity yet
    //   set_status          removed -> abandoned, restored -> open
    //   rename              the employee was identified: "Employer, Employee"
    type: { type: String, enum: ["stage", "create_opportunity", "set_status", "rename"], default: "stage" },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    // Only a stage move carries these; the other types look everything up when they run.
    opportunityId: { type: String, required: function stageOnly() { return this.type === "stage"; } },
    pipelineId: { type: String, required: function stageOnly() { return this.type === "stage"; } },
    pipelineStageId: { type: String, required: function stageOnly() { return this.type === "stage"; } },
    caseSyncVersion: { type: Number, required: function stageOnly() { return this.type === "stage"; } },
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
ghlSyncJobSchema.index({ caseId: 1, type: 1, status: 1 });
ghlSyncJobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14, partialFilterExpression: { status: { $in: ["done", "superseded"] } } });

module.exports = mongoose.model("GHLSyncJob", ghlSyncJobSchema);
