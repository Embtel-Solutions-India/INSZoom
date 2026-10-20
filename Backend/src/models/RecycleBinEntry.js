const mongoose = require("mongoose");

// One deleted case (with its child cases and orphaned client accounts) held in the recycle bin. The full documents - the cases, the accounts and every
// linked record the deletion sweeps (answers, documents, forms, tasks, messages, audit rows, ...) - are copied into "recyclebinchunks" before they are removed
// from the live collections, and the uploaded files are kept in storage; after `expiresAt` (30 days by default) the copies and the files are removed for good
// (modules/recycle-bin). Restoring puts the same documents back with their original ids.
const recycleBinEntrySchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, index: true },
    caseIds: [{ type: mongoose.Schema.Types.ObjectId }],
    caseNumbers: [String],
    userIds: [{ type: mongoose.Schema.Types.ObjectId }],
    emails: [String],
    clientNames: [String],
    deletedBy: { type: mongoose.Schema.Types.ObjectId },
    deletedByName: String,
    // capturing: the linked records are still being copied · in_bin: complete and restorable · restoring · restored · purged
    status: { type: String, enum: ["capturing", "in_bin", "restoring", "restored", "purged"], default: "capturing", index: true },
    expiresAt: { type: Date, required: true, index: true },
    // documents copied per collection
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    // uploaded files kept in storage until the entry is purged
    fileKeys: [String],
    restoredAt: Date,
    restoredBy: { type: mongoose.Schema.Types.ObjectId },
    purgedAt: Date,
    lastError: String,
  },
  { timestamps: true, collection: "recyclebinentries" }
);

recycleBinEntrySchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.models.RecycleBinEntry || mongoose.model("RecycleBinEntry", recycleBinEntrySchema);
