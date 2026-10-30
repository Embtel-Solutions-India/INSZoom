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
    // The user whose Google Drive receives the copies; jobs are private to them.
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Which of the user's connected Google accounts received (or will receive) the copies; fixed when the job starts, so switching the
    // active account afterwards never redirects a running job.
    connectionId: { type: mongoose.Schema.Types.ObjectId, ref: "GoogleDriveConnection", index: true },
    accountEmail: String,
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case" },
    folderId: { type: String, required: true },
    folderName: String,
    folderLink: String,
    folderParentId: String, // the destination's parent folder and shared-drive IDs as Google reported them when the job started
    folderDriveId: String,
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
