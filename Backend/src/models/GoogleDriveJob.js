const mongoose = require("mongoose");

// One "Add to Drive" action: the chosen folder and a per-document result. Items live inside the job (capped at 100 per job by the service).
const itemSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
    name: String,
    status: { type: String, enum: ["pending", "uploading", "synced", "updated", "skipped", "failed"], default: "pending" },
    reason: String,
    errorCode: String,
    driveFileId: String,
    webViewLink: String,
    attempts: { type: Number, default: 0 },
  },
  { _id: false }
);

const googleDriveJobSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case" },
    folderId: { type: String, required: true },
    folderName: String,
    folderLink: String,
    force: { type: Boolean, default: false },
    status: { type: String, enum: ["queued", "running", "completed", "completed_with_errors", "failed"], default: "queued" },
    items: [itemSchema],
    startedAt: Date,
    finishedAt: Date,
    // Auto-removed 60 days after creation (history only; the Drive copies and links are kept).
    expireAt: { type: Date, default: () => new Date(Date.now() + 60 * 24 * 3600 * 1000), index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

module.exports = mongoose.models.GoogleDriveJob || mongoose.model("GoogleDriveJob", googleDriveJobSchema);
