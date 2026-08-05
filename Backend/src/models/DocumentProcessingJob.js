const mongoose = require("mongoose");

const documentProcessingJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, immutable: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reqMeta: mongoose.Schema.Types.Mixed,
    status: {
      type: String,
      enum: ["queued", "processing", "retrying", "completed", "failed"],
      default: "queued",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    availableAt: { type: Date, default: Date.now, index: true },
    startedAt: Date,
    completedAt: Date,
    lastError: String,
    errorCode: String,
    lockedBy: String,
    lockedAt: Date,
  },
  { timestamps: true }
);

documentProcessingJobSchema.index({ status: 1, availableAt: 1 });
documentProcessingJobSchema.index({ documentId: 1, status: 1 });

module.exports = mongoose.model("DocumentProcessingJob", documentProcessingJobSchema);
