const mongoose = require("mongoose");

// Immiglance document -> the Drive copy a user made of it in THEIR Drive, per destination folder. Lets a repeat "Add to Drive" update the same Drive file
// instead of creating a duplicate. The Drive file ID is saved BEFORE the upload (pre-generated), so a crash mid-upload cannot orphan a copy.
const googleDriveFileLinkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case" },
    driveFolderId: { type: String, required: true },
    driveFolderName: String,
    driveFileId: { type: String, required: true },
    driveName: String,
    webViewLink: String,
    status: { type: String, enum: ["pending", "linked"], default: "pending" },
    sourceChecksum: String,
    sourceVersion: Number,
    driveMd5: String,
    lastSyncedAt: Date,
  },
  { timestamps: true }
);

googleDriveFileLinkSchema.index({ userId: 1, documentId: 1, driveFolderId: 1 }, { unique: true });
googleDriveFileLinkSchema.index({ userId: 1, driveFileId: 1 }, { unique: true });

module.exports = mongoose.models.GoogleDriveFileLink || mongoose.model("GoogleDriveFileLink", googleDriveFileLinkSchema);
