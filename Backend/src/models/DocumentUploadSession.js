const mongoose = require("mongoose");

const documentUploadSessionSchema = new mongoose.Schema(
  {
    uploadId: { type: String, required: true, unique: true, immutable: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", index: true },
    originalName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    expectedSize: { type: Number, required: true, min: 1 },
    expectedChecksum: { type: String, trim: true, lowercase: true },
    chunkSize: { type: Number, required: true, min: 262144 },
    totalChunks: { type: Number, required: true, min: 1 },
    receivedChunks: [{ type: Number, min: 0 }],
    receivedBytes: { type: Number, default: 0, min: 0 },
    chunkChecksums: { type: Map, of: String, default: {} },
    status: {
      type: String,
      enum: ["initiated", "uploading", "assembling", "completed", "failed", "cancelled", "expired"],
      default: "initiated",
      index: true,
    },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    finalDocument: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    lastError: String,
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

documentUploadSessionSchema.index({ user: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model("DocumentUploadSession", documentUploadSessionSchema);
